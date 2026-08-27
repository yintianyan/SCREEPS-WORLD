/** A6.4 Calibration Domain — 统一出口。 */

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
