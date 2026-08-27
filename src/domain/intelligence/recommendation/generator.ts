/** A6.6 Recommendation Generator — 规则匹配 + Recommendation 生成。 */

import type {
  EvidenceItem,
  EvidenceTrace,
  RecommendationCandidate,
  RecommendationCategory,
  RecommendationResult,
  RecommendationUrgency,
  RecommendationValidity,
  NoRecommendationResult,
} from "./types";
import {
  NO_RECOMMENDATION,
  DEFAULT_TTL,
  MIN_EVIDENCE_ITEMS,
  MIN_CONFIDENCE_THRESHOLD,
  RECOMMENDATION_MODEL_VERSION,
} from "./types";
import { recommendationHash } from "./hashing";

// ═══════════════════════════════════════════════════════════
// §1. Confidence Propagation
// ═══════════════════════════════════════════════════════════

/**
 * 计算建议置信度。

 * 硬约束：confidence <= min(evidence confidence)。

 * 考虑因素（每项有明确语义，非 magic number）：
 *   1. evidence minConfidence（基础）
 *   2. evidence 完整性（缺阶段则降权）
 *   3. 数据充足性（样本少则降权）
 *   4. Regime 兼容性（不匹配则降权）

 * 禁止任意 confidence += / confidence *= magic number。
 */
export function computeRecommendationConfidence(
  trace: EvidenceTrace,
  dataSufficient: boolean,
  regimeCompatible: boolean,
): number {
  // 基础：最低证据置信度
  let confidence = trace.minConfidence;

  // 因素 1: evidence 完整性
  // 缺少必需阶段 → 降权 0.3
  if (!trace.complete) {
    confidence = confidence * 0.7;
  }

  // 因素 2: 数据充足性
  // 数据不足 → 降权 0.5
  if (!dataSufficient) {
    confidence = confidence * 0.5;
  }

  // 因素 3: Regime 兼容性
  // Regime 不匹配 → 降权 0.5
  if (!regimeCompatible) {
    confidence = confidence * 0.5;
  }

  // 硬约束：confidence 不能超过 min(evidence confidence)
  // 由于上面的操作都是 ×（降权），结果已经 <= minConfidence
  // 但浮点精度保护
  confidence = Math.min(confidence, trace.minConfidence);

  // 截断到 3 位小数（消除浮点误差）
  return Number(confidence.toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §2. Trigger Conditions
// ═══════════════════════════════════════════════════════════

/**
 * Trigger Condition — 触发条件评估。

 * 每个条件评估一个 category 的触发可能性和参数。
 * 返回 null 表示 NO_RECOMMENDATION。
 */
interface TriggerResult {
  readonly category: RecommendationCategory;
  readonly target: string;
  readonly description: string;
  readonly rationale: string;
  readonly urgency: RecommendationUrgency;
  readonly expectedBenefit: number | null;
  readonly expectedCost: number | null;
}

/**
 * 评估 Economic 触发条件。

 * 证据来源：
 *   - A6.2 Evaluation: economicGrowth / resourceEfficiency 维度恶化
 *   - A6.3 Prediction: energy-shortage 预测
 *   - A6.1 Experience: economic 类型失败 Outcome
 */
export function evaluateEconomicTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const evalEvidence = trace.items.filter(i => i.stage === "INFERRED");
  const predEvidence = trace.items.filter(i => i.stage === "PREDICTED");
  const expEvidence = trace.items.filter(i => i.stage === "OBSERVED");

  // 检查 economic 维度的评估发现
  const economicFinding = evalEvidence.find(
    e => e.data["dimension"] === "economicGrowth" || e.data["dimension"] === "resourceEfficiency",
  );

  // 检查 energy-shortage 预测
  const energyPred = predEvidence.find(
    e => e.data["target"] === "energy-shortage",
  );

  // 检查 economic 失败 outcome
  const economicFailure = expEvidence.find(
    e => e.data["experienceType"] === "economic" && e.data["outcome"] === "FAILURE",
  );

  if (!economicFinding && !energyPred && !economicFailure) {
    return null;
  }

  // 判断 urgency
  let urgency: RecommendationUrgency = "low";
  if (energyPred && energyPred.confidence > 0.5) {
    urgency = "high";
  } else if (economicFailure) {
    urgency = "medium";
  } else if (economicFinding && economicFinding.confidence > 0.3) {
    urgency = "medium";
  }

  const description = economicFinding?.description
    ?? energyPred?.description
    ?? economicFailure?.description
    ?? "Economic signal detected";

  return {
    category: "economic",
    target: "empire",
    description: `Economic concern: ${description}`,
    rationale: `Evidence: ${evalEvidence.length} eval, ${predEvidence.length} pred, ${expEvidence.length} exp`,
    urgency,
    expectedBenefit: null,
    expectedCost: null,
  };
}

/**
 * 评估 Spawn 触发条件。
 */
export function evaluateSpawnTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const predEvidence = trace.items.filter(i => i.stage === "PREDICTED");

  const starvationPred = predEvidence.find(
    e => e.data["target"] === "spawn-starvation",
  );

  if (!starvationPred) return null;

  let urgency: RecommendationUrgency = "medium";
  if (starvationPred.confidence > 0.6) {
    urgency = "critical";
  } else if (starvationPred.confidence > 0.3) {
    urgency = "high";
  }

  return {
    category: "spawn",
    target: "empire",
    description: `Spawn starvation predicted: confidence=${starvationPred.confidence.toFixed(2)}`,
    rationale: `Prediction ${starvationPred.sourceId}: value=${starvationPred.data["value"]}`,
    urgency,
    expectedBenefit: null,
    expectedCost: null,
  };
}

/**
 * 评估 Defense 触发条件。
 */
export function evaluateDefenseTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const expEvidence = trace.items.filter(i => i.stage === "OBSERVED");
  const defenseExp = expEvidence.find(
    e => e.data["experienceType"] === "defense",
  );

  if (!defenseExp) return null;

  const isFailure = defenseExp.data["outcome"] === "FAILURE"
    || defenseExp.data["outcome"] === "ABORTED";

  if (!isFailure) return null;

  return {
    category: "defense",
    target: "empire",
    description: `Defense outcome: ${defenseExp.data["outcome"]}`,
    rationale: `Experience ${defenseExp.sourceId}: ${defenseExp.description}`,
    urgency: "high",
    expectedBenefit: null,
    expectedCost: null,
  };
}

/**
 * 评估 Logistics 触发条件。
 */
export function evaluateLogisticsTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const evalEvidence = trace.items.filter(i => i.stage === "INFERRED");

  const logisticsFinding = evalEvidence.find(
    e => e.data["dimension"] === "resourceEfficiency"
      && e.confidence > 0.2
      && e.data["evidenceType"] !== undefined,
  );

  if (!logisticsFinding) return null;

  return {
    category: "logistics",
    target: "empire",
    description: `Logistics efficiency concern: ${logisticsFinding.description}`,
    rationale: `Evaluation finding ${logisticsFinding.sourceId}`,
    urgency: "medium",
    expectedBenefit: null,
    expectedCost: null,
  };
}

/**
 * 评估 Recovery 触发条件。
 */
export function evaluateRecoveryTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const expEvidence = trace.items.filter(i => i.stage === "OBSERVED");

  const recoveryFailure = expEvidence.find(
    e => e.data["experienceType"] === "recovery"
      && (e.data["outcome"] === "FAILURE" || e.data["outcome"] === "ABORTED"),
  );

  if (!recoveryFailure) return null;

  return {
    category: "recovery",
    target: "empire",
    description: `Recovery failure: ${recoveryFailure.description}`,
    rationale: `Experience ${recoveryFailure.sourceId}`,
    urgency: "critical",
    expectedBenefit: null,
    expectedCost: null,
  };
}

/**
 * 评估 Posture 触发条件。
 */
export function evaluatePostureTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const relEvidence = trace.items.filter(i => i.stage === "RELIABILITY_ASSESSED");

  // 检查是否有 drift 检测
  const drift = relEvidence.find(
    e => e.data["driftDetected"] === true
      && e.data["driftDirection"] === "DEGRADING",
  );

  if (!drift) return null;

  return {
    category: "posture",
    target: "empire",
    description: `Model drift detected: ${drift.data["modelKey"]}`,
    rationale: `Reliability ${drift.sourceId}: drift=${drift.data["driftDirection"]}`,
    urgency: "low",
    expectedBenefit: null,
    expectedCost: null,
  };
}

/**
 * 评估 Expansion 触发条件。
 */
export function evaluateExpansionTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const expEvidence = trace.items.filter(i => i.stage === "OBSERVED");

  const expansionExp = expEvidence.find(
    e => e.data["experienceType"] === "expansion",
  );

  if (!expansionExp) return null;

  const isSuccess = expansionExp.data["outcome"] === "SUCCESS"
    || expansionExp.data["outcome"] === "PARTIAL_SUCCESS";

  if (!isSuccess) return null;

  return {
    category: "expansion",
    target: "empire",
    description: `Expansion success: ${expansionExp.description}`,
    rationale: `Experience ${expansionExp.sourceId}`,
    urgency: "low",
    expectedBenefit: null,
    expectedCost: null,
  };
}

/**
 * 评估 Military 触发条件。
 */
export function evaluateMilitaryTrigger(
  trace: EvidenceTrace,
): TriggerResult | null {
  const expEvidence = trace.items.filter(i => i.stage === "OBSERVED");

  const warExp = expEvidence.find(
    e => e.data["experienceType"] === "war",
  );

  if (!warExp) return null;

  const isFailure = warExp.data["outcome"] === "FAILURE"
    || warExp.data["outcome"] === "ABORTED";

  if (!isFailure) return null;

  return {
    category: "military",
    target: "empire",
    description: `Military outcome: ${warExp.data["outcome"]}`,
    rationale: `Experience ${warExp.sourceId}: ${warExp.description}`,
    urgency: "high",
    expectedBenefit: null,
    expectedCost: null,
  };
}

// ═══════════════════════════════════════════════════════════
// §3. Recommendation Builder
// ═══════════════════════════════════════════════════════════

/**
 * 从 TriggerResult + EvidenceTrace 构建 RecommendationCandidate。

 * 纯函数 — 不修改输入参数。
 */
export function buildRecommendation(
  trigger: TriggerResult,
  trace: EvidenceTrace,
  confidence: number,
  contextSignature: string,
  currentTick: number,
  seq: number,
  conflictIds: readonly string[] = [],
): RecommendationCandidate {
  const ttl = DEFAULT_TTL[trigger.category];
  const validity: RecommendationValidity = {
    createdTick: currentTick,
    expiresTick: currentTick + ttl,
    ttl,
  };

  const recommendationId = `REC-${currentTick}-${seq}`;

  // 构建不含 hash 的对象
  const recWithoutHash: Omit<RecommendationCandidate, "recommendationHash"> = {
    recommendationId,
    category: trigger.category,
    target: trigger.target,
    description: trigger.description,
    rationale: trigger.rationale,
    evidence: trace.items,
    evidenceComplete: trace.complete,
    confidence,
    urgency: trigger.urgency,
    expectedBenefit: trigger.expectedBenefit,
    expectedCost: trigger.expectedCost,
    validity,
    contextSignature,
    lifecycle: "created",
    supersededBy: null,
    supersedes: null,
    conflictIds,
    shadowOnly: true,
    autoApply: false,
    modelVersion: RECOMMENDATION_MODEL_VERSION,
    createdAt: currentTick,
  };

  const hash = recommendationHash(recWithoutHash);

  return {
    ...recWithoutHash,
    recommendationHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Main Generation Entry
// ═══════════════════════════════════════════════════════════

/**
 * Recommendation Generator Input — 由 system 层组装注入。
 */
export interface RecommendationGeneratorInput {
  /** 证据链。 */
  readonly trace: EvidenceTrace;
  /** 当前上下文签名。 */
  readonly contextSignature: string;
  /** 数据是否充足（来自 A6.5 DataSufficiency）。 */
  readonly dataSufficient: boolean;
  /** Regime 是否兼容（来自 A6.5 RegimeFit）。 */
  readonly regimeCompatible: boolean;
  /** 当前 tick。 */
  readonly currentTick: number;
  /** 序列号。 */
  readonly seq: number;
}

/**
 * 生成 Recommendations — 主入口。

 * 遍历所有 trigger conditions，为每个匹配的 trigger 生成一条 Recommendation。

 * 不满足条件时产出 NO_RECOMMENDATION。
 */
export function generateRecommendations(
  input: RecommendationGeneratorInput,
): RecommendationResult[] {
  const { trace, contextSignature, dataSufficient, regimeCompatible, currentTick, seq } = input;

  // 前置检查 1: 证据不足
  if (trace.items.length < MIN_EVIDENCE_ITEMS) {
    return [{
      type: NO_RECOMMENDATION,
      reason: "INSUFFICIENT_EVIDENCE",
      description: `Evidence items ${trace.items.length} < minimum ${MIN_EVIDENCE_ITEMS}`,
      category: "general",
      evaluatedAt: currentTick,
      missingStages: trace.missingStages,
    }];
  }

  // 前置检查 2: 证据链不完整
  if (!trace.complete) {
    return [{
      type: NO_RECOMMENDATION,
      reason: "INSUFFICIENT_EVIDENCE",
      description: `Evidence chain incomplete: missing ${trace.missingStages.join(", ")}`,
      category: "general",
      evaluatedAt: currentTick,
      missingStages: trace.missingStages,
    }];
  }

  // 前置检查 3: 最低置信度太低
  if (trace.minConfidence < MIN_CONFIDENCE_THRESHOLD) {
    return [{
      type: NO_RECOMMENDATION,
      reason: "LOW_CONFIDENCE",
      description: `Min evidence confidence ${trace.minConfidence.toFixed(3)} < threshold ${MIN_CONFIDENCE_THRESHOLD}`,
      category: "general",
      evaluatedAt: currentTick,
      missingStages: [],
    }];
  }

  // 前置检查 4: Regime 不兼容
  if (!regimeCompatible) {
    return [{
      type: NO_RECOMMENDATION,
      reason: "REGIME_MISMATCH",
      description: "Current regime is not compatible with evidence context",
      category: "general",
      evaluatedAt: currentTick,
      missingStages: [],
    }];
  }

  // 评估所有 trigger conditions
  const triggers: (TriggerResult | null)[] = [
    evaluateEconomicTrigger(trace),
    evaluateSpawnTrigger(trace),
    evaluateDefenseTrigger(trace),
    evaluateLogisticsTrigger(trace),
    evaluateRecoveryTrigger(trace),
    evaluatePostureTrigger(trace),
    evaluateExpansionTrigger(trace),
    evaluateMilitaryTrigger(trace),
  ];

  const results: RecommendationResult[] = [];
  let currentSeq = seq;

  for (const trigger of triggers) {
    if (trigger === null) continue;

    // 计算 confidence
    const confidence = computeRecommendationConfidence(
      trace,
      dataSufficient,
      regimeCompatible,
    );

    // confidence 太低 → NO_RECOMMENDATION
    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      results.push({
        type: NO_RECOMMENDATION,
        reason: "LOW_CONFIDENCE",
        description: `Computed confidence ${confidence.toFixed(3)} < threshold for ${trigger.category}`,
        category: trigger.category,
        evaluatedAt: currentTick,
        missingStages: [],
      });
      continue;
    }

    // 构建 Recommendation
    const rec = buildRecommendation(
      trigger,
      trace,
      confidence,
      contextSignature,
      currentTick,
      currentSeq++,
    );

    results.push(rec);
  }

  // 如果没有任何 trigger 匹配 → NO_ACTIONABLE_SIGNAL
  if (results.length === 0) {
    return [{
      type: NO_RECOMMENDATION,
      reason: "NO_ACTIONABLE_SIGNAL",
      description: "No actionable signal detected from evidence",
      category: "general",
      evaluatedAt: currentTick,
      missingStages: [],
    }];
  }

  return results;
}
