/**
 * A6.1 Intelligence Domain — 统一出口。
 *
 * 分层结构：
 *   experience.ts  — Experience 模型 + Ring Buffer + 构建函数
 *   outcome.ts     — Outcome 采集（消费已有系统）
 *   attribution.ts — Attribution 归因（Evidence-based）
 *
 * 纯函数律：本模块不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 */

// ── Experience ──
export type {
  ExperienceType,
  ExperienceLifecycle,
  OutcomeClassification,
  AttributionMethod,
  AttributionFactor,
  ExperienceIdentity,
  DecisionRef,
  ExperienceContext,
  OutcomeRecord,
  StateDelta,
  AttributionEvidence,
  Attribution,
  ExperienceRecord,
  ExperienceRingBuffer,
} from "./experience";

export {
  createExperienceRingBuffer,
  pushExperience,
  getRecentExperiences,
  getUnattributed,
  getPendingOutcomes,
  makeExperienceId,
  buildDecisionRef,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  expireExperience,
  unresolveExperience,
  MEASUREMENT_DELAYS,
  isDecisionReadyForOutcome,
  categoryToExperienceType,
  gcExperienceBuffer,
  experienceStats,
} from "./experience";

// ── Outcome ──
export type {
  OutcomeCollectionInput,
} from "./outcome";

export {
  collectOutcome,
  computeOutcomeConfidence,
} from "./outcome";

// ── Attribution ──
export type {
  AttributionInput,
} from "./attribution";

export {
  collectAttribution,
  computeAttributionConfidence,
  attributionHash,
  verifyAttributionDeterminism,
} from "./attribution";

// ── A6.2 Strategy Evaluation ──
export type {
  EvaluationDimension,
  EvidenceType,
  EvaluationVerdict,
  EvaluationWindow,
  WindowType,
  DimensionScore as EvaluationDimensionScore,
  TrendDirection,
  StrategyScore,
  EvaluationFinding,
  RecommendationCandidate,
  StrategyEvaluation,
  EvaluationInput,
  MetricSnapshot,
  ContextInfo,
} from "./strategy-evaluation";

export {
  CANONICAL_EVALUATION_DIMENSIONS,
  evaluateStrategy,
  evaluationHash,
  verifyEvaluationDeterminism,
} from "./strategy-evaluation";

// ── A6.2 Baseline ──
export type {
  BaselineSource,
  BaselineKey,
  BaselineValue,
  Baseline,
  BaselineComparison,
  SampleSufficiency,
  RegimeMismatch,
} from "./baseline";

export {
  CONFIG_BASELINE_VALUES,
  MINIMUM_SAMPLE_SIZES,
  buildContextSignature,
  buildBaselineKey,
  buildBaseline,
  compareBaseline,
  evaluateSampleSufficiency,
  computeBaselineConfidence,
  detectRegimeMismatch,
  checkContextCompatibility,
  extractHistoricalValues,
  baselineHash,
  verifyBaselineDeterminism,
} from "./baseline";

// ── A6.2 Evaluation Evidence ──
export type {
  EvaluationEvidence,
  EvidenceChain,
  EvidenceChainNode,
  EvidenceCompleteness,
} from "./evaluation-evidence";

export {
  buildEvaluationEvidence,
  traceEvidence,
  validateEvidenceCompleteness,
} from "./evaluation-evidence";

// ── A6.3 Prediction Infrastructure ──
export type {
  TimeSeriesPoint,
  LinearRegressionResult as PredictionTrendDirection,
  TimeSeries,
  PredictionContext,
  RegimeCompatibility,
  PredictionTarget,
  PredictionMethod,
  PredictionStatus,
  PredictionWindow,
  PredictionEvidence,
  Prediction,
  PredictionResult,
  PredictionRingBuffer,
  GuardResult,
} from "./prediction";

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
  buildPredictionContextSignature,
  makePredictionContext,
  checkRegimeCompatibility,
  applyRegimeMultiplier,
  INSUFFICIENT_DATA,
  NO_PREDICTION,
  isValidPrediction,
  isInsufficientData,
  makePredictionId,
  isPredictionExpired,
  isPredictionActive,
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
  stableStringify,
  fnv1a32Hex,
  predictionHash,
  verifyPredictionDeterminism,
  verifyRingBufferDeterminism,
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
} from "./prediction";

// ── A6.3.2 Prediction Models & Evidence & Resolution ──
export type {
  EvidenceBuilderInput,
  EvidenceTraceResult,
  PredictionResolution,
  PredictionVerificationInput,
  PredictionVerificationResult,
  BatchResolutionResult,
  EnergyShortageStatus,
  EnergyShortageInput,
  SpawnStarvationStatus,
  SpawnStarvationInput,
} from "./prediction";

export {
  timeSeriesSourceRef,
  experienceSourceRef,
  metricSourceRef,
  buildPredictionEvidenceFromInput,
  tracePredictionEvidence,
  validatePredictionEvidence,
  FULFILLMENT_DEVIATION_THRESHOLD,
  INVALIDATION_DEVIATION_THRESHOLD,
  verifyPrediction,
  resolvePredictionStatus,
  batchResolvePredictions,
  ENERGY_SHORTAGE_MODEL_VERSION,
  DEFAULT_ENERGY_HORIZON,
  SHORTAGE_IMMINENT_TICKS,
  ENERGY_MIN_SAMPLES,
  ENERGY_SUFFICIENT_SAMPLES,
  predictEnergyShortage,
  analyzeEnergyShortage,
  SPAWN_STARVATION_MODEL_VERSION,
  DEFAULT_SPAWN_HORIZON,
  STARVATION_IMMINENT_TICKS,
  SPAWN_MIN_SAMPLES,
  SPAWN_SUFFICIENT_SAMPLES,
  predictSpawnStarvation,
  analyzeSpawnStarvation,
} from "./prediction";
