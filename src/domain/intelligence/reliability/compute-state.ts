/**
 * A6.5 IntelligenceState Projection — 聚合入口 + State Hash。
 *
 * 职责：
 *   - 从 A6.1-A6.4 既有数据聚合为 IntelligenceState
 *   - 计算确定性 stateHash
 *
 * READ-ONLY PROJECTION（REL-001）：
 *   不持久化，不写入 globalCache。
 *   每次运行时从既有数据重新计算。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 * REL-005 (Deterministic)：相同输入 → 相同输出。
 * REL-012 (No Reliability Score)：不产出单一分数。
 */

import type { Prediction } from "../prediction/types";
import type { PredictionContext } from "../prediction/context";
import { buildPredictionContextSignature } from "../prediction/context";
import { stableStringify, fnv1a32Hex } from "../prediction/hashing";
import type {
  ModelCalibrationProfile,
  ResolutionResult,
  ModelFailureStats,
} from "../calibration/types";
import { isCalibratable } from "../calibration/types";
import { makeModelKey } from "../calibration/metrics";
import { MIN_SAMPLES_FOR_PROFILE } from "../calibration/types";
import type {
  IntelligenceState,
  ModelReliabilityAssessment,
  CalibrationHealthSummary,
  DataSufficiencySummary,
  RegimeFitSummary,
  UncertaintySummary,
  PredictionConflict,
  FreshnessSummary,
  ProfileSource,
  SampleSufficiency,
  DriftDirection,
  CalibrationHealthStatus,
} from "./types";
import {
  MIN_SAMPLES_FOR_REGIME_PROFILE,
} from "./types";
import { computeRegimeFit, getRegimeSampleCount } from "./regime-fit";
import { detectCalibrationDrift, isProfileStale } from "./temporal-drift";
import { detectConflicts } from "./conflict-detect";
import {
  computeFreshness,
  computeDataSufficiency,
  computePredictionCoverage,
} from "./freshness";
import { aggregateUncertainty } from "./uncertainty";

/**
 * IntelligenceState 计算输入。
 */
export interface IntelligenceStateInput {
  readonly predictions: readonly Prediction[];
  readonly resolutions: readonly ResolutionResult[];
  readonly profiles: readonly ModelCalibrationProfile[];
  readonly failureStats: readonly { modelKey: string; stats: ModelFailureStats }[];
  readonly currentContext: PredictionContext;
  readonly currentTick: number;
}

/**
 * 计算 IntelligenceState — A6.5 的唯一入口。
 *
 * 纯函数 — 不引用 Game/Memory。
 * 确定性 — 相同输入 → 相同 stateHash。
 * 只读 — 不修改任何输入数据。
 *
 * @param input - A6.1-A6.4 的既有数据
 * @returns IntelligenceState（只读投影）
 */
export function computeIntelligenceState(
  input: IntelligenceStateInput,
): IntelligenceState {
  const { predictions, resolutions, profiles, currentContext, currentTick } =
    input;

  // ── 1. Prediction Coverage ──
  const coverage = computePredictionCoverage(predictions, resolutions);

  // ── 2. Regime Fit ──
  const regimeFit = computeRegimeFit(
    profiles,
    resolutions,
    predictions,
    currentContext,
  );

  // ── 3. Model Reliability ──
  const modelReliability = computeModelReliability(
    profiles,
    resolutions,
    predictions,
    currentContext,
    currentTick,
  );

  // ── 4. Calibration Health ──
  const calibrationHealth = computeCalibrationHealth(
    modelReliability,
    profiles,
    currentTick,
  );

  // ── 5. Data Sufficiency ──
  const dataSufficiency = computeDataSufficiency(
    profiles,
    resolutions,
    predictions,
  );

  // ── 6. Freshness ──
  const knowledgeFreshness = computeFreshness(
    profiles,
    resolutions,
    predictions,
    currentTick,
  );

  // ── 7. Conflict Detection ──
  const activePredictions = predictions.filter(p => p.status === "active");
  const predictionConflicts = detectConflicts(
    activePredictions,
    currentContext,
    currentTick,
  );

  // ── 8. Uncertainty ──
  const uncertainty = aggregateUncertainty(
    dataSufficiency,
    regimeFit,
    calibrationHealth,
    predictionConflicts,
    knowledgeFreshness,
  );

  // ── 9. 组装 IntelligenceState ──
  const stateWithoutHash: Omit<IntelligenceState, "stateHash"> = {
    predictionCoverage: {
      implementedModels: coverage.implementedModels,
      plannedModels: coverage.plannedModels,
      coveredTargets: coverage.coveredTargets,
      missingTargets: coverage.missingTargets,
      activePredictions: coverage.activePredictions,
    },
    modelReliability,
    calibrationHealth,
    dataSufficiency,
    regimeFit,
    uncertainty,
    predictionConflicts,
    knowledgeFreshness,
    assessedAt: currentTick,
  };

  const stateHash = intelligenceStateHash(stateWithoutHash);

  return { ...stateWithoutHash, stateHash };
}

// ═══════════════════════════════════════════════════════════
// §2. Model Reliability Assessment
// ═══════════════════════════════════════════════════════════

/**
 * 计算各模型的可靠性评估。
 */
function computeModelReliability(
  profiles: readonly ModelCalibrationProfile[],
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  currentContext: PredictionContext,
  currentTick: number,
): ModelReliabilityAssessment[] {
  const currentSignature = buildPredictionContextSignature(currentContext);

  const assessments: ModelReliabilityAssessment[] = [];

  for (const profile of profiles) {
    const assessment = computeSingleModelReliability(
      profile,
      resolutions,
      predictions,
      currentSignature,
      currentTick,
    );
    assessments.push(assessment);
  }

  // 按 modelKey 排序确保确定性
  assessments.sort((a, b) => a.modelKey.localeCompare(b.modelKey));

  return assessments;
}

/**
 * 计算单个模型的可靠性评估。
 */
function computeSingleModelReliability(
  profile: ModelCalibrationProfile,
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  currentSignature: string,
  currentTick: number,
): ModelReliabilityAssessment {
  // Regime Profile 查找
  const regimeSampleCount = getRegimeSampleCount(
    profile.modelKey,
    resolutions,
    predictions,
    currentSignature,
  );

  const profileSource = determineProfileSource(
    regimeSampleCount,
    profile.calibratableCount,
  );

  const sampleSufficiency = determineSampleSufficiency(
    regimeSampleCount,
    profile.calibratableCount,
  );

  // Drift Detection
  const drift = detectCalibrationDrift(
    resolutions,
    predictions,
    profile.modelKey,
    profile.ece,
  );

  // 可靠性 Hash
  const reliabilityHash = computeReliabilityHash(
    profile.modelKey,
    profile.profileHash,
    profileSource,
    sampleSufficiency,
    drift.driftDetected,
    drift.driftDirection,
  );

  return {
    modelKey: profile.modelKey,
    target: profile.target,
    regimeProfileAvailable: regimeSampleCount > 0,
    profileSource,
    regimeSampleCount,
    calibrationVerdict: profile.calibrationVerdict,
    ece: profile.ece,
    brierScore: profile.brierScore,
    falsePositiveRate: profile.falsePositiveRate,
    falseNegativeRate: profile.falseNegativeRate,
    driftDetected: drift.driftDetected,
    driftDirection: drift.driftDirection,
    recentEce: drift.recentEce,
    overallEce: drift.overallEce,
    sampleSufficiency,
    profileHash: profile.profileHash,
    reliabilityHash,
  };
}

/**
 * 判定 Profile 来源。
 */
function determineProfileSource(
  regimeSampleCount: number,
  globalCalibratableCount: number,
): ProfileSource {
  if (regimeSampleCount >= MIN_SAMPLES_FOR_REGIME_PROFILE) {
    return "REGIME";
  }
  if (globalCalibratableCount >= MIN_SAMPLES_FOR_PROFILE) {
    return "FALLBACK_GLOBAL";
  }
  return "NONE";
}

/**
 * 判定样本充足性。
 */
function determineSampleSufficiency(
  regimeSampleCount: number,
  globalCalibratableCount: number,
): SampleSufficiency {
  if (regimeSampleCount >= MIN_SAMPLES_FOR_REGIME_PROFILE) {
    return "SUFFICIENT";
  }
  if (globalCalibratableCount >= MIN_SAMPLES_FOR_PROFILE) {
    return "FALLBACK_GLOBAL";
  }
  if (regimeSampleCount > 0) {
    return "INSUFFICIENT_FOR_REGIME";
  }
  return "INSUFFICIENT_DATA";
}

// ═══════════════════════════════════════════════════════════
// §3. Calibration Health
// ═══════════════════════════════════════════════════════════

/**
 * 计算校准健康度。
 */
function computeCalibrationHealth(
  modelReliability: readonly ModelReliabilityAssessment[],
  profiles: readonly ModelCalibrationProfile[],
  currentTick: number,
): CalibrationHealthSummary {
  if (profiles.length === 0) {
    return {
      status: "COLD_START",
      driftDetected: false,
      driftDirection: "UNKNOWN",
      profileStale: false,
      modelEceSummary: [],
    };
  }

  let anyDrift = false;
  let anyStale = false;
  let worstDirection: DriftDirection = "STABLE";

  const modelEceSummary = modelReliability.map(m => ({
    modelKey: m.modelKey,
    ece: m.ece,
    recentEce: m.recentEce,
  }));

  // 按模型排序确保确定性
  modelEceSummary.sort((a, b) => a.modelKey.localeCompare(b.modelKey));

  for (const m of modelReliability) {
    if (m.driftDetected) {
      anyDrift = true;
      // 优先级：DEGRADING > IMPROVING > STABLE > UNKNOWN
      if (m.driftDirection === "DEGRADING") {
        worstDirection = "DEGRADING";
      } else if (m.driftDirection === "IMPROVING" && worstDirection !== "DEGRADING") {
        worstDirection = "IMPROVING";
      }
    }
  }

  // 检查 Profile aging
  for (const profile of profiles) {
    if (isProfileStale(profile.statisticsTick, currentTick)) {
      anyStale = true;
    }
  }

  // 判定整体状态
  let status: CalibrationHealthStatus;
  if (anyStale) {
    status = "STALE";
  } else if (anyDrift) {
    status = "DRIFT_DETECTED";
  } else {
    // 检查是否所有模型都有足够数据
    const allSufficient = modelReliability.every(
      m => m.sampleSufficiency === "SUFFICIENT" || m.sampleSufficiency === "FALLBACK_GLOBAL",
    );
    status = allSufficient ? "HEALTHY" : "INSUFFICIENT_DATA";
  }

  return {
    status,
    driftDetected: anyDrift,
    driftDirection: worstDirection,
    profileStale: anyStale,
    modelEceSummary,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Hash Functions
// ═══════════════════════════════════════════════════════════

/**
 * IntelligenceState 确定性 Hash。
 * 复用 A6.3 stableStringify + fnv1a32Hex。
 */
export function intelligenceStateHash(
  state: Omit<IntelligenceState, "stateHash">,
): string {
  return fnv1a32Hex(stableStringify(state));
}

/**
 * ModelReliabilityAssessment 确定性 Hash。
 */
function computeReliabilityHash(
  modelKey: string,
  profileHash: string,
  profileSource: ProfileSource,
  sampleSufficiency: SampleSufficiency,
  driftDetected: boolean,
  driftDirection: DriftDirection,
): string {
  return fnv1a32Hex(
    stableStringify({
      modelKey,
      profileHash,
      profileSource,
      sampleSufficiency,
      driftDetected,
      driftDirection,
    }),
  );
}
