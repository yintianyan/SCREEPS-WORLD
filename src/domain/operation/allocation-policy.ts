/**
 * Allocation Policy v2 — A3.1 可解释多对多资源分配策略
 *（ECONOMY §1.2 跨房调拨权 + A3.1 Architecture Review §4.2）。
 *
 * 相比 A3.0 的 allocateMultiRoom，v2 的改进：
 *   1. 7 因子可解释排序（Criticality + Priority + Safety + Transferable
 *      + Distance + Health + Deadline）
 *   2. TOCTOU 防护：每创建一个 plan 后递减 source 可用量（不依赖外部 transferable 快照）
 *   3. Multi-Source Fulfillment：同一 Demand Node 可被多个 Supply Node 共同满足
 *   4. Partial Allocation：Supply < Demand 时不失败，产出部分分配
 *   5. Operation Storm 防护：全局上限 + per-source/target 上限
 *   6. 可解释性：输出每条分配的理由
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { SupplyNode } from "./supply-node";
import type { DemandNode } from "./demand-node";
import type { Criticality } from "./demand-node";
import type { AllocationPlan } from "./allocation";

/** 全局 Operation 上限（防 Operation Storm）。 */
export const MAX_GLOBAL_OPERATIONS = 20;

/** 单个 source 同时服务的最大 target 数。 */
export const MAX_TARGETS_PER_SOURCE = 3;

/** 单个 target 同时接受的最大 source 数。 */
export const MAX_SOURCES_PER_TARGET = 3;

/** 单次调拨最小量。 */
export const MIN_TRANSFER_AMOUNT = 1000;

/**
 * 可解释分配结果 — 包含分配计划 + 理由。
 */
export interface ExplainableAllocationResult {
  /** 分配计划列表。 */
  plans: AllocationPlan[];
  /** 每条计划的分配理由（key = `${source}:${target}`）。 */
  reasons: Map<string, string>;
  /** 总分配量。 */
  totalAllocated: number;
  /** 未满足的总需求量。 */
  totalUnsatisfied: number;
  /** 被跳过的 demand（完全无法满足的）。 */
  unsatisfiedDemand: string[];
}

/**
 * 路由距离信息（由系统侧注入）。
 */
export interface RouteDistance {
  /** 源房名。 */
  from: string;
  /** 目标房名。 */
  to: string;
  /** 路由跳数（-1 = 不可达）。 */
  hops: number;
  /** 是否可达。 */
  reachable: boolean;
}

/**
 * 7 因子可解释多对多分配。
 *
 * 算法：
 *   1. 对 Demand Nodes 按 7 因子综合评分排序（越紧急分越高）
 *   2. 对 Supply Nodes 按 transferable 降序 + health 降序排列
 *   3. 贪心分配：最紧急的 demand 从最富余+最近+最健康的 source 取
 *   4. Multi-Source：一个 demand 遍历多个 source 直到满足或 source 耗尽
 *   5. Partial Allocation：Supply < Demand 时产出部分分配
 *   6. 每条分配输出可解释理由
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param supplyNodes 供给节点列表（已排序）
 * @param demandNodes 需求节点列表（已排序）
 * @param routes 路由距离表（key = `${from}:${to}`）
 * @param activeOpsBySource 每个 source 的活跃 Operation 数
 * @param activeOpsByTarget 每个 target 的活跃 Operation 数
 * @param tick 当前 tick
 */
export function allocateNetwork(
  supplyNodes: readonly SupplyNode[],
  demandNodes: readonly DemandNode[],
  routes: ReadonlyMap<string, RouteDistance> = new Map(),
  activeOpsBySource: ReadonlyMap<string, number> = new Map(),
  activeOpsByTarget: ReadonlyMap<string, number> = new Map(),
  tick: number = 0,
): ExplainableAllocationResult {
  const plans: AllocationPlan[] = [];
  const reasons = new Map<string, string>();

  // 复制 supply 可用量（分配时递减 — TOCTOU 防护）
  const available = new Map<string, number>();
  const sourceTargetCount = new Map<string, number>();
  for (const s of supplyNodes) {
    available.set(s.room, s.transferable);
    sourceTargetCount.set(s.room, activeOpsBySource.get(s.room) ?? 0);
  }

  const targetSourceCount = new Map<string, number>();
  for (const d of demandNodes) {
    targetSourceCount.set(d.room, activeOpsByTarget.get(d.room) ?? 0);
  }

  const unsatisfiedDemand: string[] = [];
  let totalAllocated = 0;
  let totalUnsatisfied = 0;

  // 对 demand 按 7 因子综合评分排序
  const sortedDemand = [...demandNodes].sort((a, b) =>
    scoreDemand(b, tick) - scoreDemand(a, tick)
  );

  for (const demand of sortedDemand) {
    let remaining = demand.remaining;

    // 遍历 supply（按 7 因子匹配度排序）
    const sortedSupply = [...supplyNodes].sort((a, b) =>
      scoreSupplyForDemand(b, demand, routes) - scoreSupplyForDemand(a, demand, routes)
    );

    for (const supply of sortedSupply) {
      if (remaining < MIN_TRANSFER_AMOUNT) break;

      // Operation Storm 防护
      if (plans.length >= MAX_GLOBAL_OPERATIONS) break;

      const srcTargets = sourceTargetCount.get(supply.room) ?? 0;
      if (srcTargets >= MAX_TARGETS_PER_SOURCE) continue;

      const tgtSources = targetSourceCount.get(demand.room) ?? 0;
      if (tgtSources >= MAX_SOURCES_PER_TARGET) continue;

      const srcAvail = available.get(supply.room) ?? 0;
      if (srcAvail < MIN_TRANSFER_AMOUNT) continue;

      // 路由可达性检查
      const routeKey = `${supply.room}:${demand.room}`;
      const route = routes.get(routeKey);
      if (route && !route.reachable) continue;

      const allocate = Math.min(remaining, srcAvail);
      if (allocate < MIN_TRANSFER_AMOUNT) continue;

      const planKey = `${supply.room}:${demand.room}`;
      plans.push({
        sourceRoom: supply.room,
        targetRoom: demand.room,
        amount: allocate,
        priority: demand.priority,
      });

      // 生成可解释理由
      reasons.set(planKey, explainPlan(supply, demand, allocate, route));

      // 递减（TOCTOU 防护）
      available.set(supply.room, srcAvail - allocate);
      remaining -= allocate;
      totalAllocated += allocate;
      sourceTargetCount.set(supply.room, srcTargets + 1);
      targetSourceCount.set(demand.room, tgtSources + 1);
    }

    if (remaining > 0) {
      totalUnsatisfied += remaining;
      if (remaining >= demand.remaining) {
        // 完全未满足
        unsatisfiedDemand.push(demand.room);
      }
    }
  }

  return {
    plans,
    reasons,
    totalAllocated,
    totalUnsatisfied,
    unsatisfiedDemand,
  };
}

/**
 * 计算 Demand 的综合评分（7 因子加权）。
 * 分越高 = 越紧急。
 *
 * 因子权重：
 *   1. Criticality (40%) — 紧急度
 *   2. Priority (20%) — 操作优先级
 *   3. Remaining (15%) — 剩余需求量
 *   4. Deadline (10%) — 截止时间紧迫度
 *   5. Starvation (10%) — 饥饿时间
 *   6. Health (5%) — 经济健康度（越低越紧急）
 */
function scoreDemand(demand: DemandNode, tick: number): number {
  // Criticality 评分
  const criticalityScore = criticalityToScore(demand.criticality) * 40;

  // Priority 评分（0=最高 → 3=最低，反转后归一化）
  const priorityScore = (3 - demand.priority) / 3 * 20;

  // Remaining 评分（需求量越大越紧急，上限 10000）
  const remainingScore = Math.min(1, demand.remaining / 10000) * 15;

  // Deadline 评分（越近越紧急）
  const deadlineTicks = Math.max(1, demand.deadline - tick);
  const deadlineScore = Math.max(0, 1 - deadlineTicks / 2000) * 10;

  // Starvation 评分（等待越久越紧急）
  const ageTicks = Math.max(0, tick - demand.firstSeen);
  const starvationScore = Math.min(1, ageTicks / 1000) * 10;

  // Health 评分（demand 房的经济健康度越低越紧急 — 但 DemandNode 没有 health 字段，
  // 用 criticality 代理）
  const healthScore = (1 - criticalityToScore(demand.criticality)) * 5;

  return criticalityScore + priorityScore + remainingScore +
    deadlineScore + starvationScore + healthScore;
}

/**
 * 计算某 Supply 对某 Demand 的匹配度评分。
 * 分越高 = 越适合分配。
 *
 * 因子：
 *   1. Transferable (30%) — 可调拨量越大越好
 *   2. Distance (25%) — 距离越近越好
 *   3. Health (20%) — source 经济健康度越高越好
 *   4. Safety (15%) — 安全储备越充足越好
 *   5. Priority (10%) — source 优先级（低优先级 = 更适合调出）
 */
function scoreSupplyForDemand(
  supply: SupplyNode,
  demand: DemandNode,
  routes: ReadonlyMap<string, RouteDistance>,
): number {
  // Transferable 评分
  const transferableScore = Math.min(1, supply.transferable / 10000) * 30;

  // Distance 评分
  const routeKey = `${supply.room}:${demand.room}`;
  const route = routes.get(routeKey);
  const hops = route?.hops ?? 1;
  const distanceScore = Math.max(0, 1 - hops / 10) * 25;

  // Health 评分
  const healthScore = supply.health * 20;

  // Safety 评分（安全储备占容量比例越高越好）
  const safetyRatio = supply.capacity > 0 ? supply.safety / supply.capacity : 0;
  const safetyScore = Math.min(1, safetyRatio * 5) * 15;

  // Priority 评分（source 优先级越低 = 越适合调出）
  const priorityScore = (3 - supply.priority) / 3 * 10;

  return transferableScore + distanceScore + healthScore +
    safetyScore + priorityScore;
}

/**
 * 生成可解释分配理由。
 */
function explainPlan(
  supply: SupplyNode,
  demand: DemandNode,
  amount: number,
  route: RouteDistance | undefined,
): string {
  const parts: string[] = [];
  parts.push(`${supply.room}→${demand.room} ${amount}`);
  parts.push(`demand[${demand.criticality}, remaining=${demand.remaining}]`);
  parts.push(`supply[transferable=${supply.transferable}, health=${supply.health.toFixed(2)}]`);
  if (route) {
    parts.push(`route[hops=${route.hops}]`);
  }
  return parts.join(", ");
}

/**
 * Criticality → 评分（0..1）。
 */
function criticalityToScore(c: Criticality): number {
  switch (c) {
    case "critical": return 1.0;
    case "high": return 0.75;
    case "normal": return 0.5;
    case "low": return 0.25;
  }
}
