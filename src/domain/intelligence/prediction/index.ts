/**
 * A6.3 Prediction Domain — 统一出口。
 *
 * 分层结构：
 *   time-series.ts      — 通用有界时间序列容器（线性回归、趋势、GC）
 *   context.ts          — 预测上下文签名 + 体制兼容性检查
 *   types.ts            — Prediction/Evidence/Window 核心类型
 *   ring-buffer.ts      — 预测结果环形缓冲
 *   hashing.ts          — 确定性序列化 + FNV-1a 哈希 + 回放验证
 *   evidence-builder.ts — 预测证据链构建（A6.3.2）
 *   resolve.ts          — 预测应验/失效判定（A6.3.2）
 *   energy-shortage.ts  — 能量短缺预测模型（A6.3.2）
 *   spawn-starvation.ts — 孵化饥饿预测模型（A6.3.2）
 *
 * 纯函数律：本模块不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * Shadow-Only（PRED-001）：
 *   所有函数只做计算，不执行 Game API，不修改运行时状态。
 *
 * 确定性（PRED-003）：
 *   同输入 → 同输出。禁止 Math.random / Date.now / 无序迭代 / 浮点误差。
 */

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
