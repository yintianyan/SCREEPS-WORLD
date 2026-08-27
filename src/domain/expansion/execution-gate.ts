/** Execution Gate */

import type { ExpansionPlan } from "./plan";
import type { TieredExpansionBudget } from "./budget";

/** Gate 检查项。 */
export type GateCheckId =
  | "GATE_PLAN_VALID"        // Plan 仍然有效（非 CANCELLED/BLACKLISTED）
  | "GATE_CANDIDATE_VALID"   // 候选仍然有效（未被占领/未变 hostile）
  | "GATE_TARGET_CLAIMABLE"  // 目标 controller 仍然可 claim
  | "GATE_EMPIRE_READY"      // Empire 仍然 READY
  | "GATE_BUDGET_SUFFICIENT" // 预算仍然足够
  | "GATE_CORE_SAFE"         // Core Reserve 未被侵入
  | "GATE_NOT_OWNED"         // 尚未拥有该房
  | "GATE_NO_CONCURRENT_OP"  // 无同类 Operation
  | "GATE_NO_OTHER_EXPANSION" // 无其他活跃 Expansion Operation
  | "GATE_INTEL_FRESH"       // Intel 未过期
  | "GATE_THREAT_UNCHANGED";  // 威胁未升级

/** 单项 Gate 结果。 */
export interface GateResult {
  /** 检查项 ID。 */
  id: GateCheckId;
  /** 是否通过。 */
  passed: boolean;
  /** 当前值。 */
  value: string;
  /** 通过条件描述。 */
  condition: string;
}

/** Execution Gate 输入。 */
export interface ExecutionGateInput {
  /** 待执行的 Plan。 */
  plan: ExpansionPlan;
  /** 当前 Tiered Budget。 */
  budget: TieredExpansionBudget;
  /** Empire 就绪度。 */
  isEmpireReady: boolean;
  /** 是否已拥有该房。 */
  alreadyOwned: boolean;
  /** 是否已有同类 Operation。 */
  hasConcurrentOp: boolean;
  /** 是否有其他活跃 Expansion Operation。 */
  hasOtherExpansion: boolean;
  /** Intel 是否过期。 */
  intelStale: boolean;
  /** 威胁是否升级。 */
  threatEscalated: boolean;
  /** 目标房是否可 claim。 */
  targetClaimable: boolean;
  /** 候选是否仍然有效。 */
  candidateValid: boolean;
}

/** Execution Gate 结果。 */
export interface ExecutionGateResult {
  /** 所有 Gate 检查结果。 */
  gates: GateResult[];
  /** 是否全部通过。 */
  allPassed: boolean;
  /** 失败的 Gate 列表。 */
  failedGates: GateCheckId[];
  /** 人类可读证据。 */
  evidence: string;
}

/**
 * 执行 11 项 TOCTOU 验证（纯函数）。

 * 任何 Gate Failure → 阻止执行，Plan 保持 WAITING_EXECUTION
 * 或降级为 CANCELLED / REPLAN。
 */
export function validateExecutionGate(input: ExecutionGateInput): ExecutionGateResult {
  const gates: GateResult[] = [];

  // GATE_PLAN_VALID
  const g1 = input.plan.status === "WAITING_EXECUTION";
  gates.push({
    id: "GATE_PLAN_VALID",
    passed: g1,
    value: input.plan.status,
    condition: "plan.status === WAITING_EXECUTION",
  });

  // GATE_CANDIDATE_VALID
  gates.push({
    id: "GATE_CANDIDATE_VALID",
    passed: input.candidateValid,
    value: String(input.candidateValid),
    condition: "candidate still valid (not taken/hostile)",
  });

  // GATE_TARGET_CLAIMABLE
  gates.push({
    id: "GATE_TARGET_CLAIMABLE",
    passed: input.targetClaimable,
    value: String(input.targetClaimable),
    condition: "controller is claimable",
  });

  // GATE_EMPIRE_READY
  gates.push({
    id: "GATE_EMPIRE_READY",
    passed: input.isEmpireReady,
    value: String(input.isEmpireReady),
    condition: "empire readiness !== NOT_READY",
  });

  // GATE_BUDGET_SUFFICIENT
  const g5 = input.budget.availableExpansion >= input.plan.cost.totalCost;
  gates.push({
    id: "GATE_BUDGET_SUFFICIENT",
    passed: g5,
    value: `${input.budget.availableExpansion} >= ${input.plan.cost.totalCost}`,
    condition: "available budget >= estimated cost",
  });

  // GATE_CORE_SAFE
  const g6 = !input.budget.coreInvaded;
  gates.push({
    id: "GATE_CORE_SAFE",
    passed: g6,
    value: input.budget.coreInvaded ? "INVADED" : "safe",
    condition: "coreInvaded === false",
  });

  // GATE_NOT_OWNED
  gates.push({
    id: "GATE_NOT_OWNED",
    passed: !input.alreadyOwned,
    value: String(input.alreadyOwned),
    condition: "not already owned",
  });

  // GATE_NO_CONCURRENT_OP
  gates.push({
    id: "GATE_NO_CONCURRENT_OP",
    passed: !input.hasConcurrentOp,
    value: String(input.hasConcurrentOp),
    condition: "no concurrent claim operation",
  });

  // GATE_NO_OTHER_EXPANSION
  gates.push({
    id: "GATE_NO_OTHER_EXPANSION",
    passed: !input.hasOtherExpansion,
    value: String(input.hasOtherExpansion),
    condition: "no other active expansion operation",
  });

  // GATE_INTEL_FRESH
  gates.push({
    id: "GATE_INTEL_FRESH",
    passed: !input.intelStale,
    value: String(input.intelStale),
    condition: "intel is fresh (not stale)",
  });

  // GATE_THREAT_UNCHANGED
  gates.push({
    id: "GATE_THREAT_UNCHANGED",
    passed: !input.threatEscalated,
    value: String(input.threatEscalated),
    condition: "threat level not escalated",
  });

  const failedGates = gates.filter(g => !g.passed).map(g => g.id);
  const allPassed = failedGates.length === 0;
  const evidence = allPassed
    ? "all 11 gates passed"
    : `failed: ${failedGates.join(", ")}`;

  return { gates, allPassed, failedGates, evidence };
}
