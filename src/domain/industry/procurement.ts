/**
 * 采购需求纯函数 — terminal/lab/factory 市场改造阶段 1。
 *
 * 消费方（lab-system / factory-manager）发布 ProcurementDemand 到 globalCache，
 * 采购方（terminal-manager）汇总后按 priority 排序，在 deal 窗口内按序尝试买入。
 *
 * 纯函数层：不访问 Game/Memory，可 Vitest 测试。
 */
import type { ProcurementDemand } from "../../kernel/global-cache";

/** 基础矿物集合 — 用于区分基础矿与中间产物/化合物的价格策略。 */
const BASE_MINERALS = new Set(["H", "O", "U", "L", "K", "Z", "X"]);

/** 中间产物集合 — 反应链的中间步骤产出（OH/ZK/UL/G）。 */
const INTERMEDIATE_COMPOUNDS = new Set(["OH", "ZK", "UL", "G"]);

/** 判断资源是否为基础矿物。 */
export function isBaseMineral(resource: string): boolean {
  return BASE_MINERALS.has(resource);
}

/** 判断资源是否为中间产物（OH/ZK/UL/G）。 */
export function isIntermediateCompound(resource: string): boolean {
  return INTERMEDIATE_COMPOUNDS.has(resource);
}

/**
 * 根据资源类型计算市场买入价格上限。
 *
 * 分级策略：
 * - 基础矿：直接用 CONFIG.market.maxBuyPrice。
 * - 中间产物：最贵基础矿 maxBuyPrice × 2（加工溢价容忍）。
 * - 化合物（T1-T3）：最贵基础矿 maxBuyPrice × 5（高级加工溢价）。
 * - 其他资源（power/G 等）：配置值或回退。
 *
 * @param resource 资源类型。
 * @param maxBuyPrice CONFIG.market.maxBuyPrice 映射。
 * @returns 价格上限（credits/单位），0 表示不买。
 */
export function computeMaxBuyPrice(
  resource: string,
  maxBuyPrice: Readonly<Record<string, number>>,
): number {
  // 基础矿：直接查表。
  const direct = maxBuyPrice[resource];
  if (direct !== undefined && direct > 0) return direct;

  // 非基础矿：以最贵基础矿价格为基准。
  const maxBase = Math.max(...Object.values(maxBuyPrice));

  // 中间产物：×2（1 步加工溢价）。
  if (isIntermediateCompound(resource)) return maxBase * 2;

  // T1+ 化合物：×5（多步加工溢价）。
  // G 也走中间产物通道（×2），但 G 也可走 maxBuyPrice 直查（如果配置了）。
  return maxBase * 5;
}

/**
 * 汇总多房间的采购需求表，按 priority 降序排序，过期需求清除。
 * 同资源的多个需求取最大 priority + 合并 amount（取 max 而非 sum 防重复计数）。
 *
 * @param byRoom 按房名索引的需求表。
 * @param currentTick 当前 tick（用于过滤过期需求）。
 * @returns 按 priority 降序排列的去重需求列表。
 */
export function collectDemands(
  byRoom: Readonly<Record<string, ProcurementDemand[]>>,
  currentTick: number,
): ProcurementDemand[] {
  // resource → 合并后的需求（取 max priority + max amount）。
  const merged = new Map<string, ProcurementDemand>();

  for (const demands of Object.values(byRoom)) {
    for (const d of demands) {
      // 过期需求跳过（防僵尸需求无限累积）。
      if (d.deadline <= currentTick) continue;
      if (d.amount <= 0) continue;

      const existing = merged.get(d.resource);
      if (existing) {
        // 同资源：取更高的 priority 和更大的 amount。
        merged.set(d.resource, {
          resource: d.resource,
          priority: Math.max(existing.priority, d.priority),
          amount: Math.max(existing.amount, d.amount),
          deadline: Math.max(existing.deadline, d.deadline),
          reason: existing.priority >= d.priority ? existing.reason : d.reason,
        });
      } else {
        merged.set(d.resource, { ...d });
      }
    }
  }

  // 按 priority 降序排列。
  return Array.from(merged.values()).sort((a, b) => b.priority - a.priority);
}

/**
 * 从反应链计划展开原料缺口需求（阶段 3 扩展：含中间产物）。
 *
 * 反应链的每个 step 需要两种输入原料。基础矿物缺口直接发采购需求；
 * 中间产物（OH/ZK/UL/G）缺口也发采购需求 — 阶段 3 扩展，允许市场买入
 * 中间产物以加速反应链（自产是主通道，市场是加速通道）。
 * 已有库存满足的部分不计入缺口。
 *
 * @param reactionPlan 反应链计划。
 * @param inventory 完整库存视图。
 * @param tick 当前 tick。
 * @param deadlineOffset 需求有效期。
 * @returns 采购需求列表（基础矿 + 中间产物缺口）。
 */
export function expandReactionDemands(
  reactionPlan: { steps: ReadonlyArray<{ input1: string; input2: string; output: string; amount: number }>; target: string; targetAmount: number },
  inventory: Readonly<Record<string, number>>,
  tick: number,
  deadlineOffset: number,
): ProcurementDemand[] {
  const demands: ProcurementDemand[] = [];

  for (const step of reactionPlan.steps) {
    for (const input of [step.input1, step.input2]) {
      const have = inventory[input] ?? 0;
      const need = step.amount;
      const deficit = need - have;
      if (deficit <= 0) continue;

      // 基础矿 priority=25；中间产物 priority=20（市场买入是加速通道，
      // 不如自产经济 — 但缺料时比不产强）。
      const priority = isBaseMineral(input) ? 25 : 20;

      demands.push({
        resource: input,
        amount: deficit,
        priority,
        deadline: tick + deadlineOffset,
        reason: "lab-reaction",
      });
    }
  }

  return demands;
}

/**
 * 从 commodity 配方展开原料缺口需求。
 *
 * @param targetResource 目标产物资源类型。
 * @param components 配方原料表（资源 → 单批用量）。
 * @param inventory 完整库存视图。
 * @param tick 当前 tick。
 * @param deadlineOffset 需求有效期（tick）。
 * @returns 采购需求列表（配方的非 energy 原料缺口）。
 */
export function expandCommodityDemands(
  targetResource: string,
  components: Readonly<Record<string, number>>,
  inventory: Readonly<Record<string, number>>,
  tick: number,
  deadlineOffset: number,
): ProcurementDemand[] {
  const demands: ProcurementDemand[] = [];

  for (const [res, amount] of Object.entries(components)) {
    // energy 不买（走能量互济/危机能量买入通道）。
    if (res === RESOURCE_ENERGY) continue;

    const have = inventory[res] ?? 0;
    const deficit = amount - have;
    if (deficit <= 0) continue;

    demands.push({
      resource: res,
      amount: deficit,
      priority: 12, // commodity 原料：低优先级（非生存）。
      deadline: tick + deadlineOffset,
      reason: "factory-commodity",
    });
  }

  return demands;
}
