/** Factory commodity 生产决策 — 纯函数层（审计缺口 6：产业链只有 battery 压缩）。 */

/** 配方摘要（从引擎 COMMODITIES 裁剪；components 缺失 = 不可生产）。 */
export interface CommodityRecipe {
  resourceType: string;
  /** 生产等级门槛（0 = 无门槛；factory.level 须 ≥ 此值）。 */
  level: number;
  /** 原料表（资源 → 单批用量；factory.produce 从 factory.store 扣）。 */
  components: Record<string, number>;
}

/** 合并库存视图（资源 → 可用量）。 */
export type StockView = Readonly<Record<string, number>>;

/**
 * 选择生产目标：梯度高者优先（T3 > T2 > T1，静态价值序 — 市场价波动由
 * terminal-manager 挂单层自适应，此处只定结构梯度），原料 = factory +
 * storage 合计（distributor 负责把 storage 部分搬进 factory）。
 * 返回 undefined = 无可产目标（原料都不齐）。
 */
export function selectCommodityTarget(
  factoryStore: StockView,
  storageStore: StockView,
  factoryLevel: number,
  recipes: readonly CommodityRecipe[],
  energyReserve: number,
): CommodityRecipe | undefined {
  let best: CommodityRecipe | undefined;
  for (const r of recipes) {
    if (r.level > factoryLevel) continue;
    // 能量是生存资源：合计扣掉储备地板后须仍够本配方能量份额。
    const energyNeeded = r.components.energy ?? 0;
    const energyAvailable = (factoryStore.energy ?? 0) + (storageStore.energy ?? 0) - energyReserve;
    if (energyNeeded > energyAvailable) continue;
    let feasible = true;
    for (const [res, amount] of Object.entries(r.components)) {
      if (res === "energy") continue;
      const available = (factoryStore[res] ?? 0) + (storageStore[res] ?? 0);
      if (available < amount) {
        feasible = false;
        break;
      }
    }
    if (!feasible) continue;
    // 梯度高者优先（先到先得 — recipes 按梯度降序传入）。
    if (!best) best = r;
  }
  return best;
}

/**
 * factory 内的原料缺口（资源 → 还需多少才够单批配方）。
 * distributor 据此从 storage 取料补进 factory（负值/0 不补）。
 */
export function missingComponents(
  factoryStore: StockView,
  recipe: CommodityRecipe,
): Record<string, number> {
  const missing: Record<string, number> = {};
  for (const [res, amount] of Object.entries(recipe.components)) {
    const gap = amount - (factoryStore[res] ?? 0);
    if (gap > 0) missing[res] = gap;
  }
  return missing;
}
