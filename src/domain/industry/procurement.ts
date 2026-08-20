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

/** 判断资源是否为基础矿物。 */
export function isBaseMineral(resource: string): boolean {
  return BASE_MINERALS.has(resource);
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
 * 从反应链计划展开基础矿物缺口需求。
 *
 * 反应链的每个 step 需要两种输入原料，回溯到基础矿物层。
 * 已有库存满足的部分不计入缺口。
 *
 * @param reactionTarget 当前反应目标产物。
 * @param reactionPlan 反应链计划（含有序步骤）。
 * @param inventory 完整库存视图（collectFullInventory 的结果）。
 * @param tick 当前 tick。
 * @param deadlineOffset 需求有效期（tick）。
 * @returns 采购需求列表（仅基础矿物层缺口）。
 */
export function expandReactionDemands(
  reactionPlan: { steps: ReadonlyArray<{ input1: string; input2: string; output: string; amount: number }>; target: string; targetAmount: number },
  inventory: Readonly<Record<string, number>>,
  tick: number,
  deadlineOffset: number,
): ProcurementDemand[] {
  const demands: ProcurementDemand[] = [];

  // 从步骤中提取需要的基础矿物原料。
  // 每步需要的输入量 = step.amount（总批次量），已有库存抵扣。
  for (const step of reactionPlan.steps) {
    for (const input of [step.input1, step.input2]) {
      // 只对基础矿物发需求（中间产物由反应链自产，不直接买）。
      if (!isBaseMineral(input)) continue;

      const have = inventory[input] ?? 0;
      const need = step.amount;
      const deficit = need - have;
      if (deficit <= 0) continue;

      demands.push({
        resource: input,
        amount: deficit,
        priority: 25, // 反应原料：中等优先级。
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
