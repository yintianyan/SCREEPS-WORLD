/**
 * A6.6 Evidence Builder — 从 A6.1–A6.5 数据构建可追溯证据链。
 *
 * 职责：
 *   - 从 Experience / Evaluation / Prediction / Calibration / Reliability 提取 EvidenceItem
 *   - 组装 EvidenceTrace（完整链 + 缺失检测）
 *   - 计算 minConfidence（证据链最低置信度）
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * REC-010：每条 Recommendation 必须有可追溯 evidence。
 */

import type { ExperienceRecord, OutcomeRecord, Attribution } from "../experience";
import type { StrategyEvaluation, EvaluationFinding } from "../strategy-evaluation";
import type { Prediction } from "../prediction/types";
import type { ResolutionResult, ModelCalibrationProfile } from "../calibration/types";
import type { IntelligenceState, ModelReliabilityAssessment } from "../reliability/types";
import type { EvidenceItem, EvidenceStage, EvidenceTrace } from "./types";
import { MAX_EVIDENCE_ITEMS } from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Evidence ID Construction
// ═══════════════════════════════════════════════════════════

/**
 * 创建 Evidence ID（确定性：EVI-{stage}-{seq}）。
 */
export function makeEvidenceId(stage: EvidenceStage, seq: number): string {
  return `EVI-${stage}-${seq}`;
}

// ═══════════════════════════════════════════════════════════
// §2. Evidence Builders — 从各阶段数据提取 EvidenceItem
// ═══════════════════════════════════════════════════════════

/**
 * 从 A6.1 Experience 构建证据。
 *
 * OBSERVED 阶段：Experience + Outcome。
 */
export function buildExperienceEvidence(
  experiences: readonly ExperienceRecord[],
  maxItems: number = MAX_EVIDENCE_ITEMS,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let seq = 0;

  for (const exp of experiences) {
    if (items.length >= maxItems) break;
    if (!exp.outcome) continue;

    items.push({
      evidenceId: makeEvidenceId("OBSERVED", seq++),
      stage: "OBSERVED",
      source: "a61-experience",
      sourceId: exp.identity.experienceId,
      description: `Experience ${exp.identity.type}: ${exp.decision.selectedAction} → ${exp.outcome.classification}`,
      confidence: exp.outcome ? 1.0 : 0.0, // 观测的事实 confidence = 1.0
      data: {
        experienceType: exp.identity.type,
        outcome: exp.outcome.classification,
        metric: exp.outcome.metric,
        value: Number(exp.outcome.value.toFixed(3)),
        delay: exp.outcome.delay,
      },
      collectedAt: exp.outcome.measurementTick,
    });
  }

  return items;
}

/**
 * 从 A6.1 Attribution 构建证据。
 *
 * ATTRIBUTED 阶段：归因结果。
 */
export function buildAttributionEvidence(
  experiences: readonly ExperienceRecord[],
  maxItems: number = MAX_EVIDENCE_ITEMS,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let seq = 0;

  for (const exp of experiences) {
    if (items.length >= maxItems) break;
    if (!exp.attribution) continue;

    items.push({
      evidenceId: makeEvidenceId("ATTRIBUTED", seq++),
      stage: "ATTRIBUTED",
      source: "a61-attribution",
      sourceId: exp.attribution.attributionHash,
      description: `Attribution: primaryCause=${exp.attribution.primaryCause}, method=${exp.attribution.method}`,
      confidence: exp.attribution.confidence,
      data: {
        primaryCause: exp.attribution.primaryCause,
        method: exp.attribution.method,
        systemAttribution: exp.attribution.systemAttribution,
        contributingFactors: exp.attribution.contributingFactors.length,
        externalFactors: exp.attribution.externalFactors.length,
      },
      collectedAt: exp.identity.tick,
    });
  }

  return items;
}

/**
 * 从 A6.2 StrategyEvaluation 构建证据。
 *
 * INFERRED 阶段：评估发现。
 */
export function buildEvaluationEvidence(
  evaluation: StrategyEvaluation | undefined,
  maxItems: number = MAX_EVIDENCE_ITEMS,
): EvidenceItem[] {
  if (!evaluation) return [];

  const items: EvidenceItem[] = [];
  let seq = 0;

  for (const finding of evaluation.findings) {
    if (items.length >= maxItems) break;

    items.push({
      evidenceId: makeEvidenceId("INFERRED", seq++),
      stage: "INFERRED",
      source: "a62-evaluation",
      sourceId: finding.findingId,
      description: finding.description,
      confidence: finding.confidence,
      data: {
        dimension: finding.dimension,
        evidenceType: finding.evidenceType,
        hasExternalFactor: finding.hasExternalFactor,
        evidenceCount: finding.evidenceIds.length,
      },
      collectedAt: evaluation.tick,
    });
  }

  return items;
}

/**
 * 从 A6.3 Prediction 构建证据。
 *
 * PREDICTED 阶段：预测结果。
 */
export function buildPredictionEvidence(
  predictions: readonly Prediction[],
  maxItems: number = MAX_EVIDENCE_ITEMS,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let seq = 0;

  for (const pred of predictions) {
    if (items.length >= maxItems) break;
    if (pred.status !== "active") continue;

    items.push({
      evidenceId: makeEvidenceId("PREDICTED", seq++),
      stage: "PREDICTED",
      source: "a63-prediction",
      sourceId: pred.id,
      description: `Prediction ${pred.target}: value=${pred.value.toFixed(3)}, confidence=${pred.confidence.toFixed(3)}`,
      confidence: pred.confidence,
      data: {
        target: pred.target,
        method: pred.method,
        value: Number(pred.value.toFixed(3)),
        windowStart: pred.window.startTick,
        windowEnd: pred.window.endTick,
        duration: pred.window.duration,
        regimeCompatible: pred.evidence.regimeCompatibility.compatible,
        confidenceMultiplier: pred.evidence.regimeCompatibility.confidenceMultiplier,
        sampleCount: pred.evidence.sampleRange.count,
      },
      collectedAt: pred.generatedAt,
    });
  }

  return items;
}

/**
 * 从 A6.4 Calibration 构建证据。
 *
 * CALIBRATED 阶段：校准结果。
 */
export function buildCalibrationEvidence(
  resolutions: readonly ResolutionResult[],
  profiles: readonly ModelCalibrationProfile[],
  maxItems: number = MAX_EVIDENCE_ITEMS,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let seq = 0;

  // Profile-level evidence
  for (const profile of profiles) {
    if (items.length >= maxItems) break;

    items.push({
      evidenceId: makeEvidenceId("CALIBRATED", seq++),
      stage: "CALIBRATED",
      source: "a64-calibration",
      sourceId: profile.profileHash,
      description: `Calibration ${profile.calibrationVerdict}: model=${profile.modelKey}, ece=${profile.ece.toFixed(3)}`,
      confidence: profile.ece <= 0.05 ? 0.9 : profile.ece <= 0.15 ? 0.6 : 0.3, // ECE 越低置信度越高
      data: {
        modelKey: profile.modelKey,
        calibrationVerdict: profile.calibrationVerdict,
        ece: Number(profile.ece.toFixed(3)),
        falsePositiveRate: Number(profile.falsePositiveRate.toFixed(3)),
        falseNegativeRate: Number(profile.falseNegativeRate.toFixed(3)),
        totalResolutions: profile.totalResolutions,
        calibratableCount: profile.calibratableCount,
      },
      collectedAt: profile.statisticsTick,
    });
  }

  // Resolution-level evidence (recent only)
  for (const res of resolutions) {
    if (items.length >= maxItems) break;

    items.push({
      evidenceId: makeEvidenceId("CALIBRATED", seq++),
      stage: "CALIBRATED",
      source: "a64-resolution",
      sourceId: res.resolutionHash,
      description: `Resolution ${res.resolution}: pred=${res.predictedValue.toFixed(2)} vs actual=${res.actualValue.toFixed(2)}`,
      confidence: res.resolution === "CORRECT" ? 0.9 : res.resolution === "PARTIAL" ? 0.5 : 0.2,
      data: {
        resolution: res.resolution,
        predictedValue: Number(res.predictedValue.toFixed(3)),
        actualValue: Number(res.actualValue.toFixed(3)),
        absoluteError: Number(res.absoluteError.toFixed(3)),
        relativeError: Number(res.relativeError.toFixed(3)),
        directionCorrect: res.directionCorrect,
        withinHorizon: res.withinHorizon,
      },
      collectedAt: res.resolvedTick,
    });
  }

  return items;
}

/**
 * 从 A6.5 IntelligenceState 构建证据。
 *
 * RELIABILITY_ASSESSED 阶段：可靠性评估。
 */
export function buildReliabilityEvidence(
  state: IntelligenceState | undefined,
  maxItems: number = MAX_EVIDENCE_ITEMS,
): EvidenceItem[] {
  if (!state) return [];

  const items: EvidenceItem[] = [];
  let seq = 0;

  // Model reliability evidence
  for (const m of state.modelReliability) {
    if (items.length >= maxItems) break;

    items.push({
      evidenceId: makeEvidenceId("RELIABILITY_ASSESSED", seq++),
      stage: "RELIABILITY_ASSESSED",
      source: "a65-reliability",
      sourceId: m.reliabilityHash,
      description: `Model ${m.modelKey}: verdict=${m.calibrationVerdict}, drift=${m.driftDetected}, sufficiency=${m.sampleSufficiency}`,
      confidence: m.calibrationVerdict === "WELL_CALIBRATED" ? 0.8 : m.calibrationVerdict === "OVERCONFIDENT" ? 0.4 : 0.5,
      data: {
        modelKey: m.modelKey,
        calibrationVerdict: m.calibrationVerdict,
        ece: Number(m.ece.toFixed(3)),
        driftDetected: m.driftDetected,
        driftDirection: m.driftDirection,
        sampleSufficiency: m.sampleSufficiency,
        profileSource: m.profileSource,
      },
      collectedAt: state.assessedAt,
    });
  }

  // Data sufficiency evidence
  items.push({
    evidenceId: makeEvidenceId("RELIABILITY_ASSESSED", seq++),
    stage: "RELIABILITY_ASSESSED",
    source: "a65-data-sufficiency",
    sourceId: state.stateHash,
    description: `Data sufficiency: ${state.dataSufficiency.sufficient ? "sufficient" : "insufficient"}, total=${state.dataSufficiency.totalResolutions}`,
    confidence: state.dataSufficiency.sufficient ? 0.8 : 0.3,
    data: {
      sufficient: state.dataSufficiency.sufficient,
      totalResolutions: state.dataSufficiency.totalResolutions,
      modelsWithSufficientData: state.dataSufficiency.modelsWithSufficientData,
    },
    collectedAt: state.assessedAt,
  });

  // Freshness evidence
  items.push({
    evidenceId: makeEvidenceId("RELIABILITY_ASSESSED", seq++),
    stage: "RELIABILITY_ASSESSED",
    source: "a65-freshness",
    sourceId: state.stateHash,
    description: `Knowledge freshness: ${state.knowledgeFreshness.overallFreshness}`,
    confidence: state.knowledgeFreshness.overallFreshness === "FRESH" ? 0.9
      : state.knowledgeFreshness.overallFreshness === "RECENT" ? 0.7
      : state.knowledgeFreshness.overallFreshness === "STALE" ? 0.3
      : 0.1,
    data: {
      overallFreshness: state.knowledgeFreshness.overallFreshness,
      sourceCount: state.knowledgeFreshness.sources.length,
    },
    collectedAt: state.assessedAt,
  });

  return items;
}

// ═══════════════════════════════════════════════════════════
// §3. Evidence Trace Assembly
// ═══════════════════════════════════════════════════════════

/**
 * 组装证据链。
 *
 * 检查每个必需阶段是否有证据，计算 minConfidence。
 */
export function assembleEvidenceTrace(
  items: readonly EvidenceItem[],
): EvidenceTrace {
  // 必需阶段（OBSERVED 或 INFERRED 至少一个，加上 PREDICTED）
  const requiredStages: EvidenceStage[] = ["OBSERVED", "INFERRED", "PREDICTED"];

  const presentStages = new Set(items.map(i => i.stage));

  const missingStages: EvidenceStage[] = [];
  // 至少需要 OBSERVED 或 INFERRED（有历史数据或评估）
  const hasObserved = presentStages.has("OBSERVED");
  const hasInferred = presentStages.has("INFERRED");
  if (!hasObserved && !hasInferred) {
    if (!hasObserved) missingStages.push("OBSERVED");
    if (!hasInferred) missingStages.push("INFERRED");
  }
  // PREDICTED 是可选的（冷启动时无预测）
  // 但如果 category 需要 prediction 支撑，调用方应检查

  // 允许缺少 CALIBRATED / RELIABILITY_ASSESSED（冷启动期）

  const complete = missingStages.length === 0 && items.length > 0;

  // minConfidence = 最低证据置信度
  const confidences = items.map(i => i.confidence).filter(c => c > 0);
  const minConfidence = confidences.length > 0
    ? Number(Math.min(...confidences).toFixed(3))
    : 0;

  return {
    items,
    complete,
    missingStages,
    minConfidence,
  };
}

/**
 * 从 EvidenceTrace 获取特定阶段的证据。
 */
export function getEvidenceByStage(
  trace: EvidenceTrace,
  stage: EvidenceStage,
): readonly EvidenceItem[] {
  return trace.items.filter(i => i.stage === stage);
}

/**
 * 获取证据链摘要（可观测性）。
 */
export function evidenceTraceSummary(trace: EvidenceTrace): string {
  const stages = trace.items.map(i => i.stage);
  const uniqueStages = [...new Set(stages)];
  return `items=${trace.items.length}, stages=[${uniqueStages.join(",")}], complete=${trace.complete}, minConf=${trace.minConfidence.toFixed(2)}`;
}
