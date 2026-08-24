/**
 * Resource Network Snapshot — A3.1 Empire Resource Network 全局供需快照。
 *
 * Network Snapshot 是某一时刻 Empire Resource Network 的完整投影：
 *   Supply Nodes + Demand Nodes + Reservations + Active Operations +
 *   Pending Requests + Allocation Plan + 供需汇总 + Timestamp
 *
 * 特性：
 *   - 可观察：完整反映网络状态
 *   - 可测试：纯函数构建，不依赖 Game/Memory
 *   - 不可无限增长：只存活跃节点，终态后移除
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { SupplyNode, sumSupplyTransferable } from "./supply-node";
import type { DemandNode, sumDemandRemaining } from "./demand-node";
import type { AllocationPlan } from "./allocation";
import type { OperationContext } from "./agenda-item";
import type { ReservationTable } from "./reservation";
import { sumSupplyTransferable as sumSupply } from "./supply-node";
import { sumDemandRemaining as sumDemand } from "./demand-node";

/**
 * Resource Network Snapshot — 全局供需网络快照。
 */
export interface NetworkSnapshot {
  /** 采样 tick。 */
  tick: number;
  /** 供给节点列表（按 transferable 降序）。 */
  supplyNodes: SupplyNode[];
  /** 需求节点列表（按 criticality 升序）。 */
  demandNodes: DemandNode[];
  /** 活跃 Reservation 总数。 */
  reservationCount: number;
  /** 活跃 Operation 总数。 */
  activeOperationCount: number;
  /** 待处理 AllocationPlan 列表。 */
  allocationPlans: AllocationPlan[];
  /** 总供给量（所有 Supply Nodes 的 transferable 之和）。 */
  totalSupply: number;
  /** 总需求量（所有 Demand Nodes 的 requested 之和）。 */
  totalDemand: number;
  /** 总剩余需求量（所有 Demand Nodes 的 remaining 之和）。 */
  totalRemaining: number;
  /** 总已满足量。 */
  totalFulfilled: number;
  /** 供需缺口 = totalRemaining - totalSupply（正=缺口，负=盈余）。 */
  gap: number;
}

/**
 * 构建 Resource Network Snapshot。
 *
 * 从 Supply Nodes + Demand Nodes + Operations + Reservations + AllocationPlans
 * 组装全局快照。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param tick 当前 tick
 * @param supplyNodes 供给节点列表
 * @param demandNodes 需求节点列表
 * @param operations 活跃 Operation 列表
 * @param reservations 活跃 Reservation 表
 * @param allocationPlans 分配计划列表
 */
export function buildNetworkSnapshot(
  tick: number,
  supplyNodes: readonly SupplyNode[],
  demandNodes: readonly DemandNode[],
  operations: readonly OperationContext[],
  reservations: ReservationTable,
  allocationPlans: readonly AllocationPlan[],
): NetworkSnapshot {
  const totalSupply = sumSupply(supplyNodes);
  const totalDemand = demandNodes.reduce((s, n) => s + n.requested, 0);
  const totalRemaining = sumDemand(demandNodes);
  const totalFulfilled = totalDemand - totalRemaining;

  return {
    tick,
    supplyNodes: [...supplyNodes],
    demandNodes: [...demandNodes],
    reservationCount: reservations.size,
    activeOperationCount: operations.filter(op =>
      op.status !== "completed" &&
      op.status !== "failed" &&
      op.status !== "cancelled" &&
      op.status !== "expired"
    ).length,
    allocationPlans: [...allocationPlans],
    totalSupply,
    totalDemand,
    totalRemaining,
    totalFulfilled: Math.max(0, totalFulfilled),
    gap: totalRemaining - totalSupply,
  };
}

/**
 * 判断 Network 状态是否需要 rebalance。
 * 当 supply/demand 变化超过阈值时返回 true。
 *
 * 纯函数。
 */
export function needsRebalance(
  current: NetworkSnapshot,
  previous: NetworkSnapshot | undefined,
  threshold = 0.1,
): boolean {
  if (!previous) return true;
  if (previous.tick === current.tick) return false;

  // Supply 变化超过阈值
  const supplyDelta = Math.abs(current.totalSupply - previous.totalSupply);
  if (previous.totalSupply > 0 && supplyDelta / previous.totalSupply > threshold) return true;

  // Demand 变化超过阈值
  const demandDelta = Math.abs(current.totalRemaining - previous.totalRemaining);
  if (previous.totalRemaining > 0 && demandDelta / previous.totalRemaining > threshold) return true;

  // Operation 数量变化
  if (current.activeOperationCount !== previous.activeOperationCount) return true;

  // 供需缺口方向反转
  if (Math.sign(current.gap) !== Math.sign(previous.gap) && current.gap !== 0) return true;

  return false;
}
