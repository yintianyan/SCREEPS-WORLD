/** Abort Recovery Mapping */

import type { RecoveryAction, RecoveryActionType } from "../strategy/recovery-priority";
import type { FailureDomain } from "../strategy/failure-propagation";

// ═══════════════════════════════════════════════════════════
// §1. AbortReason 枚举（与 war-planner.ts REASON_* 对齐）
// ═══════════════════════════════════════════════════════════

/** 战争止损原因（与 war-planner.ts 的 REASON_* 编码对齐）。 */
export type WarAbortReason =
  | "POSTURE"        // 姿态退出（非 war）
  | "ATTRITION"      // 消耗战失败
  | "NO_TARGET"      // 无合格目标
  | "PLAN_TIMEOUT";  // 计划超期

/** 战后核验结果。 */
export type WarOutcome = "success" | "failure" | "unknown";

// ═══════════════════════════════════════════════════════════
// §2. WarAbortSignal（与 globalCache.warAbortSignals 结构一致）
// ═══════════════════════════════════════════════════════════

/** 军事止损信号（由 war-planner demobilize 写入 globalCache）。 */
export interface WarAbortSignal {
  /** 写入 tick。 */
  tick: number;
  /** 止损原因标签。 */
  reason: string;
  /** 目标房间。 */
  targetRoom: string;
  /** 发起方房间（sponsor）。 */
  sponsor: string;
  /** 已孵化投入数。 */
  spawned: number;
  /** 战后核验结果。 */
  outcome: string;
  /** A5.3 operationId（如果来自 A5.3 路径）。 */
  operationId?: string;
}

// ═══════════════════════════════════════════════════════════
// §3. AbortReason → RecoveryActionType 映射表
// ═══════════════════════════════════════════════════════════

/**
 * 止损原因到恢复动作类型的映射。

 * 每个止损原因都有明确的 Recovery 语义：
 * - POSTURE → expansion_pause：姿态退出意味着停止进攻，暂停扩张以恢复经济
 * - ATTRITION → population_rebuild：消耗战失败意味着大量 Creep 损失，需重建
 * - NO_TARGET → auto_resolve：无目标 = 自然收摊，无需特殊恢复
 * - PLAN_TIMEOUT → population_rebuild：计划超期可能有未完成投入，需重建

 * 注意：LOGISTICS_FAILURE / REINFORCEMENT_TIMEOUT / RECOVERY_UNAVAILABLE
 * 不是 war-planner 的止损原因——它们是 A5.3 operation.ts 的 AbortCondition，
 * 在当前架构中，war-planner 的 demobilize 只产生 4 种 reason。
 * 如果未来 A5.3 完整 Operation lifecycle 接管止损，
 * AbortCondition 将通过本接口的 extendAbortReason 映射。
 */
const ABORT_REASON_MAP: Record<string, {
  actionType: RecoveryActionType;
  domain: FailureDomain;
  description: string;
  recommendation: string;
  cost: number;
  time: number;
  urgent: boolean;
}> = {
  POSTURE: {
    actionType: "expansion_pause",
    domain: "expansion",
    description: "War posture ended — pause expansion to recover economy",
    recommendation: "pause expansion for economic recovery",
    cost: 0,
    time: 0,
    urgent: false,
  },
  ATTRITION: {
    actionType: "population_rebuild",
    domain: "colony",
    description: "War attrition lost — rebuild population",
    recommendation: "rebuild military population via spawn priority adjustment",
    cost: 800,
    time: 500,
    urgent: true,
  },
  NO_TARGET: {
    actionType: "auto_resolve",
    domain: "colony",
    description: "No war target available — natural stand-down",
    recommendation: "no recovery needed — natural stand-down",
    cost: 0,
    time: 0,
    urgent: false,
  },
  PLAN_TIMEOUT: {
    actionType: "population_rebuild",
    domain: "colony",
    description: "War plan timed out — rebuild population",
    recommendation: "rebuild population after plan timeout",
    cost: 800,
    time: 500,
    urgent: false,
  },
};

// ═══════════════════════════════════════════════════════════
// §4. 核心纯函数：WarAbortSignal → RecoveryAction
// ═══════════════════════════════════════════════════════════

/**
 * 将战争止损信号转换为 RecoveryAction。

 * 这是 Military → Recovery 的唯一桥梁：
 * - Military 只产出 RecoveryAction（建议），不执行
 * - A4.6 recovery-execution-system 负责执行
 * - 幂等性由 recoveryIdempotencyKey 保证

 * @param signal 止损信号
 * @returns RecoveryAction 或 null（无匹配映射时）
 */
export function mapAbortToRecoveryAction(signal: WarAbortSignal): RecoveryAction | null {
  const mapping = ABORT_REASON_MAP[signal.reason];
  if (!mapping) {
    return null;
  }

  // outcome = failure 时提升 urgency
  const isFailure = signal.outcome === "failure";

  return {
    id: `war-abort:${signal.sponsor}:${signal.reason}:${signal.tick}`,
    type: mapping.actionType,
    targetFailureId: `war-abort:${signal.sponsor}`,
    domain: mapping.domain,
    priority: computePriority(signal, mapping.urgent),
    estimatedCost: mapping.cost,
    estimatedBenefit: computeBenefit(signal),
    roi: mapping.cost > 0 ? computeBenefit(signal) / mapping.cost : computeBenefit(signal),
    urgent: mapping.urgent || isFailure,
    estimatedRecoveryTime: mapping.time,
    description: mapping.description,
    recommendation: mapping.recommendation,
  };
}

/**
 * 计算恢复优先级（0-100）。

 * 基于：止损原因 urgency + outcome severity + spawned investment。
 */
function computePriority(signal: WarAbortSignal, baseUrgent: boolean): number {
  let score = 50; // 基础分

  // 消耗战止损优先级最高
  if (signal.reason === "ATTRITION") score += 30;
  // 计划超期次之
  if (signal.reason === "PLAN_TIMEOUT") score += 15;

  // outcome = failure 提升优先级
  if (signal.outcome === "failure") score += 15;
  if (signal.outcome === "unknown") score += 5;

  // 投入越多越需要恢复
  if (signal.spawned > 5) score += 10;

  if (baseUrgent) score = Math.min(100, score + 5);

  return Math.min(100, Math.max(0, score));
}

/**
 * 计算预估收益。
 */
function computeBenefit(signal: WarAbortSignal): number {
  let benefit = 30;

  // 消耗战失败收益高（不恢复会持续 degraded）
  if (signal.reason === "ATTRITION") benefit += 40;

  // 投入大 → 恢复收益大
  benefit += Math.min(30, signal.spawned * 3);

  return benefit;
}

// ═══════════════════════════════════════════════════════════
// §5. 批量转换 + 确定性
// ═══════════════════════════════════════════════════════════

/**
 * 将止损信号列表批量转换为 RecoveryAction 列表。

 * 确定性：输出顺序与输入顺序一致（不排序、不 shuffle）。
 * 幂等性：同一 signal 产出相同 action（相同 id）。
 * 去重由 A4.6 recovery-lifecycle 的 shouldSubmitAction 保证。
 */
export function mapAbortSignalsToRecoveryActions(
  signals: readonly WarAbortSignal[],
): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  for (const signal of signals) {
    const action = mapAbortToRecoveryAction(signal);
    if (action) actions.push(action);
  }
  return actions;
}

/**
 * 生成止损信号的确定性 Hash。

 * 相同 WarPlan + 相同 World Snapshot → 相同 AbortSignal Hash。
 * 用于 A5.3.1 确定性审计。
 */
export function abortSignalHash(signal: WarAbortSignal): string {
  const payload = JSON.stringify({
    tick: signal.tick,
    reason: signal.reason,
    targetRoom: signal.targetRoom,
    sponsor: signal.sponsor,
    spawned: signal.spawned,
    outcome: signal.outcome,
    operationId: signal.operationId ?? "",
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
