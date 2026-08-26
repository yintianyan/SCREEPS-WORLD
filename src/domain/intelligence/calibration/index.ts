/**
 * A6.4 Calibration Domain — 统一出口。
 *
 * 分层结构：
 *   types.ts       — Calibration 类型定义（ResolutionResult, ModelCalibrationProfile 等）
 *   resolve.ts     — Resolution Engine（resolvePrediction 纯函数）
 *   metrics.ts     — Resolution Metric Registry（按模型注册 Metric 函数）
 *   calibration.ts — Calibration Engine（置信度分桶 + ECE + Brier Score）
 *   failure-attribution.ts — 失败归因（对 INCORRECT Prediction 进行归因）
 *   ring-buffer.ts — Calibration Ring Buffer（有界存储 + GC）
 *   guards.ts      — CAL-001 ~ CAL-010 守卫验证函数
 *
 * 纯函数律：本模块不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * Shadow-Only（CAL-001）：
 *   所有函数只做计算，不执行 Game API，不修改运行时状态。
 *
 * 确定性（CAL-005）：
 *   同输入 → 同输出。禁止 Math.random / Date.now / 无序迭代 / 浮点误差。
 *
 * 依赖方向（A6_4_CONTRACT.md §八）：
 *   A6.4 Calibration Domain
 *     ↓ imports (只读)
 *   A6.3 Prediction Domain (types, context, hashing)
 *     ↓ imports (只读)
 *   A6.1 Experience Domain (types only)
 *   A6.2 Strategy Evaluation Domain (types only)
 */

// ── Calibration Types ──
export type {
  CalibrationResolution,
  ObservationSample,
  ExternalFactorSignal,
  ResolutionResult,
  ConfidenceBucketStats,
  CalibrationVerdict,
  ModelCalibrationProfile,
  FailureAttributionCategory,
  FailureAttributionResult,
  ModelFailureStats,
  CalibrationRingBuffer,
} from "./types";

export {
  isCalibratable,
  isResolutionSuccess,
  RESOLUTION_GRACE_PERIOD,
  MIN_OBSERVATION_SAMPLES,
  MAX_OBSERVATION_GAP,
  CORRECT_RELATIVE_ERROR_THRESHOLD,
  INCORRECT_RELATIVE_ERROR_THRESHOLD,
  CONFIDENCE_BUCKET_COUNT,
  MIN_SAMPLES_PER_BUCKET,
  MIN_SAMPLES_FOR_PROFILE,
  MIN_SAMPLES_FOR_VERDICT,
  ECE_WELL_CALIBRATED_THRESHOLD,
  CALIBRATION_BIAS_THRESHOLD,
  RESOLUTION_RING_BUFFER_CAPACITY,
  RESOLUTION_MAX_AGE,
  MAX_PROFILES,
  CALIBRATION_INTERVAL,
  CALIBRATION_PROFILE_INTERVAL,
} from "./types";

// ── Resolution Engine ──
export {
  resolvePrediction,
  resolutionResultHash,
  verifyResolutionDeterminism,
} from "./resolve";

// ── Resolution Metric Registry ──
export type { ResolutionMetricFn } from "./metrics";

export {
  makeModelKey,
  registerResolutionMetric,
  getResolutionMetric,
  getRegisteredModelKeys,
  clearResolutionMetricRegistry,
  energyShortageMetric,
  spawnStarvationMetric,
  registerDefaultMetrics,
} from "./metrics";

// ── Calibration Engine ──
export {
  computeConfidenceBuckets,
  computeECE,
  computeBrierScore,
  computeFalsePositiveRate,
  computeFalseNegativeRate,
  determineCalibrationVerdict,
  computeCalibrationProfile,
  computeCalibrationStatistics,
  calibrationProfileHash,
  hasSufficientSamples,
} from "./calibration";

// ── Calibration Ring Buffer ──
export {
  createCalibrationRingBuffer,
  pushResolution,
  getAllResolutions,
  getRecentResolutions,
  isPredictionResolved,
  getPendingResolutionIds,
  updateProfile,
  getProfile,
  updateFailureStats,
  getFailureStats,
  gcCalibrationBuffer,
  calibrationBufferStats,
} from "./ring-buffer";

// ── Architecture Guards ──
export type { GuardResult } from "../prediction/guards";

export {
  guardCalShadowOnly,
  guardCalDomainPurity,
  guardCalNoGameApi,
  guardCalNoRuntimeMutation,
  guardCalDeterminism,
  guardCalBoundedMemory,
  guardCalNoNewSampler,
  guardCalNoSecondMetrics,
  guardCalNoStrategyMutation,
  guardCalEvidenceTraceability,
  validateResolutionResult,
  validateCalibrationBuffer,
} from "./guards";
