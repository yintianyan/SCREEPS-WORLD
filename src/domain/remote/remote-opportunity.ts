/** Remote Opportunity */

import type { RemoteSource } from "./remote-source";
import type { RemoteResourceValue, ValueGrade } from "./remote-value";

// ─── Opportunity 状态 ────────────────────────────────────

/**
 * Opportunity Status — 机会生命周期状态。

 * 状态流转：
 *   WAITING_EXECUTION → APPROVED → EXECUTING → COMPLETED
 *                    ↘ REJECTED
 *                    ↘ EXPIRED

 * - WAITING_EXECUTION: 等待 specialization-planner 评估
 * - APPROVED: 已批准——planner 决定开新远矿，等待 remote-mining-manager 执行
 * - REJECTED: 已拒绝——planner 决定不开（经济不划算/风险过高/名额已满）
 * - EXECUTING: 执行中——remote-mining-manager 已开始运营
 * - COMPLETED: 完成——远矿运营已稳定或已放弃
 * - EXPIRED: 过期——等待评估超过有效期
 */
export type OpportunityStatus =
  | "waiting_execution"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "expired";

/**
 * 判定 Opportunity 是否活跃（等待评估或已批准）。
 * 纯函数。
 */
export function isOpportunityActive(status: OpportunityStatus): boolean {
  return status === "waiting_execution" || status === "approved";
}

/**
 * 判定 Opportunity 是否终态。
 * 纯函数。
 */
export function isOpportunityTerminal(status: OpportunityStatus): boolean {
  return status === "completed" || status === "rejected" || status === "expired";
}

// ─── Opportunity 模型 ────────────────────────────────────

/**
 * Remote Opportunity — 远矿机会提议。
 */
export interface RemoteOpportunity {
  /** 幂等键（与 Remote Source ID 相同）。 */
  id: string;
  /** Remote Source ID。 */
  sourceId: string;
  /** 孵化房。 */
  homeRoom: string;
  /** 目标房。 */
  targetRoom: string;

  // ── 评估快照（创建时冻结）──
  /** 净价值评估快照。 */
  value: RemoteResourceValue;
  /** 价值等级快照。 */
  valueGrade: ValueGrade;
  /** Remote Source 快照摘要。 */
  sourceSnapshot: {
    sourceCount: number;
    expectedYield: number;
    pathCost: number;
    linearDistance: number;
    riskLevel: number;
    hasInvaderCore: boolean;
    reserved: boolean;
  };

  // ── 生命周期 ──
  /** 当前状态。 */
  status: OpportunityStatus;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近状态变更 tick。 */
  updatedAt: number;
  /** 过期 tick（超过此 tick 未评估则 EXPIRED）。 */
  expiresAt: number;

  /** 拒绝原因（REJECTED 时填充）。 */
  rejectReason: string | undefined;
  /** 批准原因（APPROVED 时填充）。 */
  approveReason: string | undefined;
}

// ─── Opportunity 创建 ────────────────────────────────────

/**
 * 创建 Opportunity 输入。
 */
export interface OpportunityInput {
  source: RemoteSource;
  value: RemoteResourceValue;
  tick: number;
  /** 有效期 tick 数（默认 1000，即 10 个评估周期）。 */
  validityTicks: number;
}

/**
 * 创建 Remote Opportunity（初始状态 = WAITING_EXECUTION）。

 * 从 Remote Source + Value Assessment 产出 Opportunity。
 * Opportunity 的评估快照在创建时冻结——后续 Remote Source 状态变化
 * 不影响已有 Opportunity（需要新评估则创建新 Opportunity）。

 * 纯函数 — 不访问 Game/Memory。
 */
export function createOpportunity(input: OpportunityInput): RemoteOpportunity {
  const { source, value, tick, validityTicks } = input;
  return {
    id: source.id,
    sourceId: source.id,
    homeRoom: source.homeRoom,
    targetRoom: source.targetRoom,
    value,
    valueGrade: value.grade,
    sourceSnapshot: {
      sourceCount: source.sourceCount,
      expectedYield: source.expectedYield,
      pathCost: source.pathCost,
      linearDistance: source.linearDistance,
      riskLevel: source.riskLevel,
      hasInvaderCore: source.hasInvaderCore,
      reserved: source.reserved,
    },
    status: "waiting_execution",
    createdAt: tick,
    updatedAt: tick,
    expiresAt: tick + validityTicks,
    rejectReason: undefined,
    approveReason: undefined,
  };
}

// ─── 状态转换 ────────────────────────────────────────────

/**
 * 更新 Opportunity 状态。
 * 纯函数 — 返回新对象。
 */
export function updateOpportunityStatus(
  opp: RemoteOpportunity,
  newStatus: OpportunityStatus,
  tick: number,
  reason?: string,
): RemoteOpportunity {
  return {
    ...opp,
    status: newStatus,
    updatedAt: tick,
    rejectReason: newStatus === "rejected" ? reason : opp.rejectReason,
    approveReason: newStatus === "approved" ? reason : opp.approveReason,
  };
}

/**
 * 批准 Opportunity（WAITING_EXECUTION → APPROVED）。
 * 纯函数。
 */
export function approveOpportunity(
  opp: RemoteOpportunity,
  tick: number,
  reason: string = "planner-approved",
): RemoteOpportunity {
  return updateOpportunityStatus(opp, "approved", tick, reason);
}

/**
 * 拒绝 Opportunity（WAITING_EXECUTION → REJECTED）。
 * 纯函数。
 */
export function rejectOpportunity(
  opp: RemoteOpportunity,
  tick: number,
  reason: string,
): RemoteOpportunity {
  return updateOpportunityStatus(opp, "rejected", tick, reason);
}

/**
 * 标记为执行中（APPROVED → EXECUTING）。
 * 纯函数。
 */
export function markExecuting(
  opp: RemoteOpportunity,
  tick: number,
): RemoteOpportunity {
  return updateOpportunityStatus(opp, "executing", tick, "remote-mining-manager-started");
}

/**
 * 完成机会（→ COMPLETED）。
 * 纯函数。
 */
export function completeOpportunity(
  opp: RemoteOpportunity,
  tick: number,
): RemoteOpportunity {
  return updateOpportunityStatus(opp, "completed", tick, "operation-stable");
}

/**
 * 过期机会（→ EXPIRED）。
 * 纯函数。
 */
export function expireOpportunity(
  opp: RemoteOpportunity,
  tick: number,
): RemoteOpportunity {
  return updateOpportunityStatus(opp, "expired", tick, "validity-expired");
}

// ─── 过期检测 ────────────────────────────────────────────

/**
 * 检查 Opportunity 是否已过期。
 * 纯函数。
 */
export function isExpired(opp: RemoteOpportunity, tick: number): boolean {
  if (isOpportunityTerminal(opp.status)) return false;
  return tick > opp.expiresAt;
}

/**
 * 批量检查并过期 Opportunities。
 * 返回更新后的列表（不可变）。
 * 纯函数。
 */
export function expireStaleOpportunities(
  opps: readonly RemoteOpportunity[],
  tick: number,
): RemoteOpportunity[] {
  return opps.map(opp => {
    if (isExpired(opp, tick) && !isOpportunityTerminal(opp.status)) {
      return expireOpportunity(opp, tick);
    }
    return opp;
  });
}

// ─── 查询 ────────────────────────────────────────────────

/**
 * 过滤出等待评估的 Opportunities。
 * 纯函数。
 */
export function filterWaitingExecution(
  opps: readonly RemoteOpportunity[],
): RemoteOpportunity[] {
  return opps.filter(o => o.status === "waiting_execution");
}

/**
 * 过滤出活跃的 Opportunities。
 * 纯函数。
 */
export function filterActiveOpportunities(
  opps: readonly RemoteOpportunity[],
): RemoteOpportunity[] {
  return opps.filter(o => isOpportunityActive(o.status));
}

/**
 * 过滤出终态的 Opportunities（可归档删除）。
 * 纯函数。
 */
export function filterTerminalOpportunities(
  opps: readonly RemoteOpportunity[],
): RemoteOpportunity[] {
  return opps.filter(o => isOpportunityTerminal(o.status));
}

/**
 * 查找指定 Remote Source 的非终态 Opportunity。
 * 纯函数。
 */
export function findActiveOpportunity(
  opps: readonly RemoteOpportunity[],
  sourceId: string,
): RemoteOpportunity | undefined {
  return opps.find(o => o.sourceId === sourceId && !isOpportunityTerminal(o.status));
}

/**
 * 检查是否已存在指定 Remote Source 的非终态 Opportunity。
 * 纯函数。
 */
export function hasActiveOpportunity(
  opps: readonly RemoteOpportunity[],
  sourceId: string,
): boolean {
  return findActiveOpportunity(opps, sourceId) !== undefined;
}
