/** Decision Explanation */

import type { ExpansionPlan } from "./plan";
import type { ExpansionPressureResult } from "./pressure";
import type { TieredExpansionBudget } from "./budget";
import type { RiskResult } from "./risk";
import type { PaybackResult } from "./payback";
import type { ExpansionCostEstimate } from "./cost-model";
import type { ExpansionReadinessResult } from "../strategy/readiness";

/** 决策结论。 */
export type DecisionOutcome =
  | "APPROVE"      // 批准扩张
  | "HOLD"         // 暂缓（条件接近满足但防抖未过）
  | "REJECT"       // 不推荐
  | "INSUFFICIENT_BUDGET" // 预算不足
  | "NOT_READY";   // 就绪度不足

/** 决策解释结果。 */
export interface DecisionExplanation {
  /** 决策结论。 */
  outcome: DecisionOutcome;
  /** 候选房名。 */
  roomName: string;
  /** 人类可读摘要（单行）。 */
  summary: string;
  /** 详细证据链（每行一条）。 */
  evidence: string[];
  /** 阻碍因素（阻止扩张的具体原因）。 */
  blockers: string[];
  /** 推荐因素（支持扩张的具体原因）。 */
  enablers: string[];
}

/**
 * 生成扩张决策的完整解释（纯函数）。

 * 输入所有评估结果，输出人类可读的决策理由。
 */
export function explainDecision(input: {
  plan: ExpansionPlan;
  pressure: ExpansionPressureResult;
  budget: TieredExpansionBudget;
  readiness: ExpansionReadinessResult;
  tick: number;
}): DecisionExplanation {
  const { plan, pressure, budget, readiness, tick } = input;

  const evidence: string[] = [];
  const blockers: string[] = [];
  const enablers: string[] = [];

  // ── Pressure ──
  evidence.push(`Pressure: ${pressure.level} (${pressure.score.toFixed(2)})`);
  if (pressure.level === "HIGH") enablers.push("high expansion pressure");
  if (pressure.level === "LOW") blockers.push("low expansion pressure (no driving force)");

  // ── Readiness ──
  evidence.push(`Readiness: ${readiness.readiness}`);
  if (readiness.readiness === "NOT_READY") {
    blockers.push(`readiness NOT_READY: ${readiness.evidence}`);
  } else {
    enablers.push(`readiness ${readiness.readiness}`);
  }

  // ── Budget ──
  evidence.push(`Budget: available=${budget.availableExpansion} cost=${plan.cost.totalCost}`);
  if (budget.coreInvaded) {
    blockers.push("CORE RESERVE INVADED - expansion blocked");
  }
  if (budget.availableExpansion < plan.cost.totalCost) {
    blockers.push(`insufficient budget: ${budget.availableExpansion} < ${plan.cost.totalCost}`);
  } else {
    enablers.push(`budget sufficient: ${budget.availableExpansion} ≥ ${plan.cost.totalCost}`);
  }

  // ── Risk ──
  evidence.push(`Risk: ${plan.risk.level} (${plan.risk.score.toFixed(2)})`);
  if (plan.risk.level === "CRITICAL") {
    blockers.push(`critical risk: ${plan.risk.evidence}`);
  } else if (plan.risk.level === "HIGH") {
    blockers.push(`high risk: ${plan.risk.evidence}`);
  } else {
    enablers.push(`risk ${plan.risk.level}`);
  }

  // ── Payback ──
  evidence.push(`Payback: ${plan.payback.paybackTicks === Infinity ? "∞" : plan.payback.paybackTicks + "t"} ROI=${plan.payback.roi.toFixed(2)}`);
  if (plan.payback.worthwhile) {
    enablers.push(`payback ${plan.payback.paybackTicks}t, ROI ${plan.payback.roi.toFixed(2)}`);
  } else {
    blockers.push(`payback too long or ROI too low: ${plan.payback.evidence}`);
  }

  // ── Score ──
  evidence.push(`Score: ${plan.candidateScore.toFixed(2)} (threshold=${plan.priority})`);

  // ── 决策 ──
  let outcome: DecisionOutcome;
  if (blockers.length === 0) {
    outcome = "APPROVE";
  } else if (readiness.readiness === "NOT_READY") {
    outcome = "NOT_READY";
  } else if (budget.availableExpansion < plan.cost.totalCost || budget.coreInvaded) {
    outcome = "INSUFFICIENT_BUDGET";
  } else if (plan.risk.level === "CRITICAL" || plan.risk.level === "HIGH") {
    outcome = "REJECT";
  } else if (plan.payback.paybackTicks > 50000) {
    outcome = "REJECT";
  } else {
    outcome = "HOLD";
  }

  const summary = [
    `${plan.planId}: ${outcome}`,
    `${blockers.length} blocker(s), ${enablers.length} enabler(s)`,
    `pressure=${pressure.level} readiness=${readiness.readiness}`,
  ].join(" | ");

  return {
    outcome,
    roomName: plan.roomName,
    summary,
    evidence,
    blockers,
    enablers,
  };
}

/**
 * 生成简短决策摘要（用于 log / dashboard 一行展示）。
 */
export function explainShort(plan: ExpansionPlan, outcome: DecisionOutcome): string {
  return `${plan.roomName}: ${outcome} | score=${plan.candidateScore.toFixed(2)} cost=${plan.cost.totalCost} risk=${plan.risk.level} payback=${plan.payback.paybackTicks === Infinity ? "∞" : plan.payback.paybackTicks + "t"}`;
}
