/** Factory commodity 生产决策 — 纯函数层（审计缺口 6：产业链只有 battery 压缩）。 */
import { commodityConvertRoi } from "./market-pricing";
import type { MarketPriceSnapshot } from "../../kernel/global-cache";

/** 配方摘要（从引擎 COMMODITIES 裁剪；components 缺失 = 不可生产）。 */
export interface CommodityRecipe {
  resourceType: string;
  /** 生产等级门槛（0 = 无门槛；factory.level 须 ≥ 此值）。 */
  level: number;
  /** 原料表（资源 → 单批用量；factory.produce 从 factory.store 扣）。 */
  components: Record<string, number>;
  /** 单批产量（COMMODITIES[x].amount）— ROI 闸算收益要用；缺省按 1。 */
  amount?: number;
}

/** 合并库存视图（资源 → 可用量）。 */
export type StockView = Readonly<Record<string, number>>;

/**
 * 生产侧 ROI 闸参数（可选 — 不传＝完全按旧行为只看梯度与原料）。
 * 传了则：行情**判得了且不划算**的配方一律跳过（自有库存的机会成本也是成本）。
 */
export interface CommodityRoiGate {
  /** 行情快照表；空表 ⇒ 判不了 ⇒ 不拦（私服/测试环境无市场 API 时保持可产）。 */
  prices: Readonly<Record<string, MarketPriceSnapshot>>;
  /** 余量系数（CONFIG.factory.commodityRoiMargin）。 */
  margin: number;
}

/**
 * 选择生产目标：梯度高者优先（T3 > T2 > T1，静态价值序），原料 = factory +
 * storage 合计（distributor 负责把 storage 部分搬进 factory）。
 * 返回 undefined = 无可产目标（原料都不齐，或全部被 ROI 闸拦下）。
 *
 * ⚠️ 「梯度高者优先」只是**结构**序，不含价值判断 —— 这一条在便宜原料的行情里成立，
 * 在倒挂行情里会把 factory 变成碎钞机。官服 shard3 实测（tick 83,725,692，全部按当拍
 * 最优买单价算）：oxidant 500 O(37.846)+200 energy(32.186) → 100 GO(134.474)
 * ＝投入 25,360 对产出 13,447（回收 53%，不计能量也有 71%）；reductant 500 H(127.578)
 * → 100 UL(102.899) ＝回收 16%。两条都深度倒挂，而 `commodityBatchRoi` 那道闸只挂在
 * "发布采购需求"支路（factory-manager.ts 的 publishDesiredCommodityDemands），选目标这条路
 * 上一个闸都没有 ⇒ 只要 distributor 把料送进来，factory 就会稳定亏钱。故本函数接受 `roiGate`。
 *（battery 同一口径下回收率也只有 52%，但它被 collectRecipes 排除在本链之外 —— 满仓压缩的
 * 语义是"能量马上要在源头被浪费"的止损，不是增值，不该被本闸拦。）
 */
export function selectCommodityTarget(
  factoryStore: StockView,
  storageStore: StockView,
  factoryLevel: number,
  recipes: readonly CommodityRecipe[],
  energyReserve: number,
  roiGate?: CommodityRoiGate,
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
    // 转换 ROI 闸：判不了（无行情）时放行，判得了且不划算时跳过。
    if (roiGate) {
      const roi = commodityConvertRoi(
        r.components,
        roiGate.prices,
        r.resourceType,
        r.amount ?? 1,
        roiGate.margin,
      );
      if (roi.judgeable && !roi.profitable) continue;
    }
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
