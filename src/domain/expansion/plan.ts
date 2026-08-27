/** Expansion Plan Model */

import type { ExpansionCandidateV2, ExpansionReason } from "./candidate";
import type { ExpansionCostEstimate } from "./cost-model";
import type { PaybackResult } from "./payback";
import type { RiskResult } from "./risk";

/** Plan 生命周期状态。 */
export type PlanStatus =
  | "DISCOVERED"        // 候选已发现，待评估
  | "EVALUATED"         // 已完成评分 + 成本 + 风险评估
  | "READY"             // 所有门控通过，等待批准
  | "APPROVED"          // 已批准，等待执行
  | "WAITING_EXECUTION" // 等待 A3.3 执行层接管
  | "EXECUTING"         // A3.3 执行中（A3.2 不进入此状态）
  | "COMPLETED"         // 扩张成功
  | "CANCELLED"         // 被取消（条件变化/失败止损）
  | "BLACKLISTED";      // 失败黑名单冷却

/** Plan 优先级。 */
export type PlanPriority = "P0" | "P1" | "P2" | "P3";

/**
 * Expansion Plan — 扩张计划完整数据模型。
 */
export interface ExpansionPlan {
  /** 全局唯一 planId（roomName + discoveredAt 派生）。 */
  planId: string;
  /** 候选房名（稳定 key）。 */
  roomName: string;
  /** Sponsor 房名。 */
  sponsorRoom: string;
  /** 扩张动机（四类之一）。 */
  reason: ExpansionReason;
  /** 优先级。 */
  priority: PlanPriority;
  // ── 评估快照 ──
  /** 候选评分（七因子总分）。 */
  candidateScore: number;
  /** 估算成本。 */
  cost: ExpansionCostEstimate;
  /** 回收期评估。 */
  payback: PaybackResult;
  /** 风险评估。 */
  risk: RiskResult;
  /** 候选快照（评估时点）。 */
  candidate: ExpansionCandidateV2;
  // ── 生命周期 ──
  /** 当前状态。 */
  status: PlanStatus;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近更新 tick。 */
  updatedAt: number;
  /** 批准 tick。 */
  approvedAt?: number;
  /** 取消原因。 */
  cancelReason?: string;
  /** 取消条件（自动执行，EXPANSION §5）。 */
  cancelConditions: string[];
  /** 依赖列表（前置条件，如「需先尽调」）。 */
  dependencies: string[];
  /** 人类可读决策理由。 */
  explanation: string;
}

/** Plan 创建输入。 */
export interface PlanInput {
  candidate: ExpansionCandidateV2;
  reason: ExpansionReason;
  cost: ExpansionCostEstimate;
  payback: PaybackResult;
  risk: RiskResult;
  tick: number;
  dependencies?: string[];
  cancelConditions?: string[];
}

/**
 * 从评估结果创建扩张计划（纯函数）。
 */
export function createPlan(input: PlanInput): ExpansionPlan {
  const { candidate, reason, cost, payback, risk, tick, dependencies = [], cancelConditions = [] } = input;

  const planId = `${candidate.roomName}@${candidate.discoveredAt}`;

  // 优先级判定：score + payback + risk 综合推导
  const priority = derivePriority(candidate.score, payback.roi, risk.score);

  // 默认取消条件（EXPANSION §5 失败降级表）
  const defaultCancelConditions = [
    "claim stolen / timeout",
    "spawn not built within pioneerTimeout",
    "bootstrap net flow negative beyond threshold",
    "empire CPU below Guarded",
  ];

  const explanation = [
    `Plan ${planId}: ${reason} priority=${priority}`,
    `score=${candidate.score.toFixed(2)} cost=${cost.totalCost} payback=${payback.paybackTicks === Infinity ? "∞" : payback.paybackTicks + "t"} risk=${risk.level}`,
  ].join(" | ");

  return {
    planId,
    roomName: candidate.roomName,
    sponsorRoom: candidate.sponsorRoom,
    reason,
    priority,
    candidateScore: candidate.score,
    cost,
    payback,
    risk,
    candidate,
    status: "EVALUATED",
    createdAt: tick,
    updatedAt: tick,
    cancelConditions: [...defaultCancelConditions, ...cancelConditions],
    dependencies,
    explanation,
  };
}

/**
 * 从评分 + ROI + 风险推导优先级。

 * P0: score ≥ 0.8, ROI ≥ 2.0, risk ≤ MEDIUM
 * P1: score ≥ 0.6, ROI ≥ 1.5, risk ≤ HIGH
 * P2: score ≥ 0.5, ROI ≥ 1.0, risk < CRITICAL
 * P3: 其他合格候选
 */
export function derivePriority(
  score: number,
  roi: number,
  riskScore: number,
): PlanPriority {
  if (score >= 0.8 && roi >= 2.0 && riskScore < 0.6) return "P0";
  if (score >= 0.6 && roi >= 1.5 && riskScore < 0.8) return "P1";
  if (score >= 0.5 && roi >= 1.0 && riskScore < 0.8) return "P2";
  return "P3";
}

/**
 * 更新 Plan 状态（返回新对象，不可变更新）。
 */
export function updatePlanStatus(
  plan: ExpansionPlan,
  newStatus: PlanStatus,
  tick: number,
  reason?: string,
): ExpansionPlan {
  return {
    ...plan,
    status: newStatus,
    updatedAt: tick,
    approvedAt: newStatus === "APPROVED" || newStatus === "WAITING_EXECUTION" ? tick : plan.approvedAt,
    cancelReason: newStatus === "CANCELLED" || newStatus === "BLACKLISTED" ? reason : plan.cancelReason,
  };
}
