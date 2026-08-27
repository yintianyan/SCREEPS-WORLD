/** A6.3 Prediction Domain — 统一出口。 */

// ── TimeSeries ──
export type {
  TimeSeriesPoint,
  LinearRegressionResult,
  TrendDirection,
  TimeSeries,
} from "./time-series";

export {
  createTimeSeries,
  pushSample,
  recentSamples,
  allSamples,
  linearRegression,
  meanValue,
  trendDirection,
  gcTimeSeries,
  timeSeriesStats,
} from "./time-series";

// ── Context & Regime ──
export type {
  PredictionContext,
  RegimeCompatibility,
} from "./context";

export {
  buildPredictionContextSignature,
  makePredictionContext,
  checkRegimeCompatibility,
  applyRegimeMultiplier,
} from "./context";

// ── Prediction Types ──
export type {
  PredictionTarget,
  PredictionMethod,
  PredictionStatus,
  PredictionWindow,
  PredictionEvidence,
  Prediction,
  PredictionResult,
} from "./types";

export {
  INSUFFICIENT_DATA,
  NO_PREDICTION,
  isValidPrediction,
  isInsufficientData,
  makePredictionId,
  isPredictionExpired,
  isPredictionActive,
} from "./types";

// ── Prediction Ring Buffer ──
export type { PredictionRingBuffer } from "./ring-buffer";

export {
  createPredictionRingBuffer,
  pushPrediction,
  getRecentPredictions,
  activeByTarget,
  allActivePredictions,
  byTarget,
  resolvePrediction,
  expireOverduePredictions,
  gcPredictionBuffer,
  predictionStats,
} from "./ring-buffer";

// ── Hashing & Determinism ──
export {
  stableStringify,
  fnv1a32Hex,
  predictionHash,
  verifyPredictionDeterminism,
  verifyRingBufferDeterminism,
} from "./hashing";

// ── Architecture Guards ──
export type { GuardResult } from "./guards";

export {
  MAX_PREDICTION_DURATION,
  MIN_PREDICTION_DURATION,
  MIN_SAMPLES_FOR_PREDICTION,
  LOW_CONFIDENCE_SAMPLE_THRESHOLD,
  guardShadowOnly,
  guardDeterminism,
  guardHorizon,
  guardConfidence,
  guardEvidence,
  guardRegime,
  guardLifecycle,
  guardNoDirectSampling,
  validatePrediction,
  validateRingBuffer,
} from "./guards";

// ── A6.3.2 Evidence Builder ──
export type {
  EvidenceBuilderInput,
  EvidenceTraceResult,
} from "./evidence-builder";

export {
  timeSeriesSourceRef,
  experienceSourceRef,
  metricSourceRef,
  buildPredictionEvidence as buildPredictionEvidenceFromInput,
  tracePredictionEvidence,
  validatePredictionEvidence,
} from "./evidence-builder";

// ── A6.3.2 Prediction Resolution ──
export type {
  PredictionResolution,
  PredictionVerificationInput,
  PredictionVerificationResult,
  BatchResolutionResult,
} from "./resolve";

export {
  FULFILLMENT_DEVIATION_THRESHOLD,
  INVALIDATION_DEVIATION_THRESHOLD,
  verifyPrediction,
  resolvePredictionStatus,
  batchResolvePredictions,
} from "./resolve";

// ── A6.3.2 Energy Shortage Model ──
export type {
  EnergyShortageStatus,
  EnergyShortageInput,
} from "./energy-shortage";

export {
  ENERGY_SHORTAGE_MODEL_VERSION,
  DEFAULT_ENERGY_HORIZON,
  SHORTAGE_IMMINENT_TICKS,
  ENERGY_MIN_SAMPLES,
  ENERGY_SUFFICIENT_SAMPLES,
  predictEnergyShortage,
  analyzeEnergyShortage,
} from "./energy-shortage";

// ── A6.3.2 Spawn Starvation Model ──
export type {
  SpawnStarvationStatus,
  SpawnStarvationInput,
} from "./spawn-starvation";

export {
  SPAWN_STARVATION_MODEL_VERSION,
  DEFAULT_SPAWN_HORIZON,
  STARVATION_IMMINENT_TICKS,
  SPAWN_MIN_SAMPLES,
  SPAWN_SUFFICIENT_SAMPLES,
  predictSpawnStarvation,
  analyzeSpawnStarvation,
} from "./spawn-starvation";
