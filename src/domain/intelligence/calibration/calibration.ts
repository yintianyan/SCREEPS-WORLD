/** A6.4 Calibration Engine — 置信度校准引擎。 */

import type { Prediction } from "../prediction/types";
import { stableStringify, fnv1a32Hex } from "../prediction/hashing";
import type {
  CalibrationRingBuffer,
  CalibrationVerdict,
  ConfidenceBucketStats,
  ModelCalibrationProfile,
  ResolutionResult,
} from "./types";
import {
  CALIBRATION_BIAS_THRESHOLD,
  CONFIDENCE_BUCKET_COUNT,
  ECE_WELL_CALIBRATED_THRESHOLD,
  MIN_SAMPLES_FOR_PROFILE,
  MIN_SAMPLES_FOR_VERDICT,
  MIN_SAMPLES_PER_BUCKET,
} from "./types";
import { isCalibratable, isResolutionSuccess } from "./types";
import { makeModelKey } from "./metrics";

// ═══════════════════════════════════════════════════════════
// §1. Confidence Buckets — 置信度分桶
// ═══════════════════════════════════════════════════════════

/**
 * 计算置信度分桶统计。

 * 10 个桶：[0,0.1), [0.1,0.2), ..., [0.9,1.0]
 * 每桶统计：
 *   - avgConfidence: 桶内预测的平均置信度
 *   - observedSuccessRate: 桶内 CORRECT / calibratable total
 *   - calibrationError: |avgConfidence - observedSuccessRate|
 *   - sufficient: 样本数 ≥ MIN_SAMPLES_PER_BUCKET

 * 纯函数 — 不引用 Game/Memory。
 * 确定性：按 predictionId 排序后遍历。

 * 来源：A6_4_CONTRACT.md §1.5 + A6_4_CONFIDENCE_CALIBRATION.md
 */
export function computeConfidenceBuckets(
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
): ConfidenceBucketStats[] {
  // 构建 prediction map（按 id 索引）
  const predMap = new Map<string, Prediction>();
  for (const p of predictions) {
    predMap.set(p.id, p);
  }

  // 只取 calibratable resolutions
  const calibratable = resolutions
    .filter(r => isCalibratable(r.resolution))
    .filter(r => predMap.has(r.predictionId));

  // 按 predictionId 排序确保确定性
  calibratable.sort((a, b) => a.predictionId.localeCompare(b.predictionId));

  // 初始化 10 个桶
  const buckets: {
    sumConfidence: number;
    count: number;
    correct: number;
    incorrect: number;
    partial: number;
    falsePositive: number;
    falseNegative: number;
  }[] = [];

  for (let i = 0; i < CONFIDENCE_BUCKET_COUNT; i++) {
    buckets.push({
      sumConfidence: 0,
      count: 0,
      correct: 0,
      incorrect: 0,
      partial: 0,
      falsePositive: 0,
      falseNegative: 0,
    });
  }

  // 分配每个 resolution 到对应的桶
  for (const r of calibratable) {
    const pred = predMap.get(r.predictionId)!;
    const confidence = pred.confidence;

    // 找到对应的桶
    let bucketIndex = Math.floor(confidence * CONFIDENCE_BUCKET_COUNT);
    // confidence = 1.0 → 最后一个桶
    if (bucketIndex >= CONFIDENCE_BUCKET_COUNT) {
      bucketIndex = CONFIDENCE_BUCKET_COUNT - 1;
    }

    const bucket = buckets[bucketIndex]!;
    bucket.sumConfidence += confidence;
    bucket.count++;

    switch (r.resolution) {
      case "CORRECT": bucket.correct++; break;
      case "INCORRECT": bucket.incorrect++; break;
      case "PARTIAL": bucket.partial++; break;
      case "FALSE_POSITIVE": bucket.falsePositive++; break;
      case "FALSE_NEGATIVE": bucket.falseNegative++; break;
    }
  }

  // 构建 ConfidenceBucketStats
  return buckets.map((b, i) => {
    const low = i / CONFIDENCE_BUCKET_COUNT;
    const high = (i + 1) / CONFIDENCE_BUCKET_COUNT;
    const avgConfidence = b.count > 0 ? b.sumConfidence / b.count : 0;
    const observedSuccessRate = b.count > 0 ? b.correct / b.count : 0;
    const calibrationError = Math.abs(avgConfidence - observedSuccessRate);

    return {
      bucketIndex: i,
      confidenceLow: Number(low.toFixed(3)),
      confidenceHigh: Number(high.toFixed(3)),
      avgConfidence: Number(avgConfidence.toFixed(3)),
      observedSuccessRate: Number(observedSuccessRate.toFixed(3)),
      sampleCount: b.count,
      resolutionCounts: {
        CORRECT: b.correct,
        INCORRECT: b.incorrect,
        PARTIAL: b.partial,
        FALSE_POSITIVE: b.falsePositive,
        FALSE_NEGATIVE: b.falseNegative,
      },
      calibrationError: Number(calibrationError.toFixed(3)),
      sufficient: b.count >= MIN_SAMPLES_PER_BUCKET,
    };
  });
}

// ═══════════════════════════════════════════════════════════
// §2. ECE — Expected Calibration Error
// ═══════════════════════════════════════════════════════════

/**
 * 计算预期校准误差（ECE）。

 * ECE = Σ (|B_i| / N) × |acc(B_i) - conf(B_i)|

 * 其中：
 *   B_i = 第 i 个桶
 *   |B_i| = 桶内样本数
 *   N = 总样本数
 *   acc(B_i) = 桶内观测成功率
 *   conf(B_i) = 桶内平均置信度

 * ECE ∈ [0, 1]，越低越好。
 * ECE < 0.05 → WELL_CALIBRATED

 * 纯函数。
 * 确定性：遍历桶时按索引序。
 */
export function computeECE(buckets: readonly ConfidenceBucketStats[]): number {
  let totalSamples = 0;
  for (const b of buckets) {
    totalSamples += b.sampleCount;
  }

  if (totalSamples === 0) return 0;

  let ece = 0;
  for (const b of buckets) {
    const weight = b.sampleCount / totalSamples;
    ece += weight * b.calibrationError;
  }

  return Number(ece.toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §3. Brier Score
// ═══════════════════════════════════════════════════════════

/**
 * 计算 Brier Score。

 * Brier = (1/N) × Σ (f_i - o_i)²

 * 其中：
 *   f_i = 预测置信度
 *   o_i = 实际结果（1 = 成功, 0 = 失败）
 *   N = 样本数

 * Brier ∈ [0, 1]，越低越好。
 * 需要 calibratable resolutions 才有意义。

 * 纯函数。
 */
export function computeBrierScore(
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
): number | null {
  const predMap = new Map<string, Prediction>();
  for (const p of predictions) {
    predMap.set(p.id, p);
  }

  const calibratable = resolutions
    .filter(r => isCalibratable(r.resolution))
    .filter(r => predMap.has(r.predictionId));

  if (calibratable.length === 0) return null;

  let sumSquaredError = 0;
  for (const r of calibratable) {
    const pred = predMap.get(r.predictionId)!;
    const forecasted = pred.confidence;
    const actual = isResolutionSuccess(r.resolution) ? 1 : 0;
    const error = forecasted - actual;
    sumSquaredError += error * error;
  }

  return Number((sumSquaredError / calibratable.length).toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §4. False Positive / Negative Rates
// ═══════════════════════════════════════════════════════════

/**
 * 计算 False Positive Rate。

 * FPR = FALSE_POSITIVE / (FALSE_POSITIVE + CORRECT + PARTIAL)

 * 含义：预测说会发生但没发生的比例。

 * 纯函数。
 */
export function computeFalsePositiveRate(
  resolutions: readonly ResolutionResult[],
): number {
  let fp = 0;
  let tp = 0;
  let partial = 0;

  for (const r of resolutions) {
    if (!isCalibratable(r.resolution)) continue;
    if (r.resolution === "FALSE_POSITIVE") fp++;
    else if (r.resolution === "CORRECT") tp++;
    else if (r.resolution === "PARTIAL") partial++;
  }

  const denominator = fp + tp + partial;
  return denominator > 0 ? Number((fp / denominator).toFixed(3)) : 0;
}

/**
 * 计算 False Negative Rate。

 * FNR = FALSE_NEGATIVE / (FALSE_NEGATIVE + CORRECT + PARTIAL)

 * 含义：预测说不会发生但发生了的比例。

 * 纯函数。
 */
export function computeFalseNegativeRate(
  resolutions: readonly ResolutionResult[],
): number {
  let fn = 0;
  let tp = 0;
  let partial = 0;

  for (const r of resolutions) {
    if (!isCalibratable(r.resolution)) continue;
    if (r.resolution === "FALSE_NEGATIVE") fn++;
    else if (r.resolution === "CORRECT") tp++;
    else if (r.resolution === "PARTIAL") partial++;
  }

  const denominator = fn + tp + partial;
  return denominator > 0 ? Number((fn / denominator).toFixed(3)) : 0;
}

// ═══════════════════════════════════════════════════════════
// §5. Calibration Verdict
// ═══════════════════════════════════════════════════════════

/**
 * 判定校准判定。

 * 规则：
 *   - 总样本 < MIN_SAMPLES_FOR_VERDICT → INSUFFICIENT_DATA
 *   - ECE < ECE_WELL_CALIBRATED_THRESHOLD → WELL_CALIBRATED
 *   - avgConfidence > observedSuccessRate + BIAS → OVERCONFIDENT
 *   - avgConfidence < observedSuccessRate - BIAS → UNDERCONFIDENT
 *   - 否则 → WELL_CALIBRATED

 * 纯函数。
 */
export function determineCalibrationVerdict(
  buckets: readonly ConfidenceBucketStats[],
  ece: number,
): CalibrationVerdict {
  // 计算总样本数
  let totalSamples = 0;
  for (const b of buckets) {
    totalSamples += b.sampleCount;
  }

  if (totalSamples < MIN_SAMPLES_FOR_VERDICT) {
    return "INSUFFICIENT_DATA";
  }

  if (ece < ECE_WELL_CALIBRATED_THRESHOLD) {
    return "WELL_CALIBRATED";
  }

  // 计算加权平均
  let weightedConfidence = 0;
  let weightedSuccessRate = 0;
  for (const b of buckets) {
    const weight = b.sampleCount / Math.max(1, totalSamples);
    weightedConfidence += weight * b.avgConfidence;
    weightedSuccessRate += weight * b.observedSuccessRate;
  }

  const bias = weightedConfidence - weightedSuccessRate;

  if (bias > CALIBRATION_BIAS_THRESHOLD) {
    return "OVERCONFIDENT";
  }

  if (bias < -CALIBRATION_BIAS_THRESHOLD) {
    return "UNDERCONFIDENT";
  }

  return "WELL_CALIBRATED";
}

// ═══════════════════════════════════════════════════════════
// §6. ModelCalibrationProfile
// ═══════════════════════════════════════════════════════════

/**
 * 计算单个模型的 Calibration Profile。

 * 纯函数 — 不引用 Game/Memory。
 * 确定性：相同输入 → 相同 profileHash。

 * 来源：A6_4_CONTRACT.md §二.3
 */
export function computeCalibrationProfile(
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  modelKey: string,
): ModelCalibrationProfile {
  // 过滤属于此模型的 resolutions
  const modelResolutions = resolutions.filter(r => {
    const pred = predictions.find(p => p.id === r.predictionId);
    if (!pred) return false;
    return makeModelKey(pred.target, pred.method, pred.modelVersion) === modelKey;
  });

  const modelPredictions = predictions.filter(p =>
    makeModelKey(p.target, p.method, p.modelVersion) === modelKey,
  );

  // 统计各分类
  let calibratableCount = 0;
  let regimeChangedCount = 0;
  let externalInterferenceCount = 0;
  let insufficientObservationCount = 0;

  for (const r of modelResolutions) {
    if (isCalibratable(r.resolution)) {
      calibratableCount++;
    } else if (r.resolution === "REGIME_CHANGED") {
      regimeChangedCount++;
    } else if (r.resolution === "EXTERNAL_INTERFERENCE") {
      externalInterferenceCount++;
    } else if (r.resolution === "INSUFFICIENT_OBSERVATION") {
      insufficientObservationCount++;
    }
  }

  // 计算分桶
  const buckets = computeConfidenceBuckets(modelResolutions, modelPredictions);

  // 计算 ECE
  const ece = computeECE(buckets);

  // 计算 Brier Score
  const brierScore = computeBrierScore(modelResolutions, modelPredictions);

  // 计算 FPR / FNR
  const falsePositiveRate = computeFalsePositiveRate(modelResolutions);
  const falseNegativeRate = computeFalseNegativeRate(modelResolutions);

  // 判定 verdict
  const calibrationVerdict = determineCalibrationVerdict(buckets, ece);

  // 从 modelKey 提取信息
  const [target, method, versionStr] = modelKey.split("-");
  const modelVersion = parseInt(versionStr ?? "1", 10);

  // 从第一个匹配的 prediction 获取 statisticsTick
  const statisticsTick = modelResolutions.length > 0
    ? modelResolutions[0]!.resolvedTick
    : 0;

  const profileWithoutHash: Omit<ModelCalibrationProfile, "profileHash"> = {
    modelKey,
    target: target ?? "unknown",
    method: method ?? "unknown",
    modelVersion: isNaN(modelVersion) ? 1 : modelVersion,
    statisticsTick,
    totalResolutions: modelResolutions.length,
    calibratableCount,
    regimeChangedCount,
    externalInterferenceCount,
    insufficientObservationCount,
    buckets,
    calibrationVerdict,
    ece,
    brierScore,
    falsePositiveRate,
    falseNegativeRate,
  };

  const profileHash = calibrationProfileHash(profileWithoutHash);

  return { ...profileWithoutHash, profileHash };
}

/**
 * 计算所有模型的 Calibration Statistics。

 * 纯函数 — 不引用 Game/Memory。
 * 确定性：按 modelKey 排序。

 * 来源：A6_4_CONTRACT.md §二.3
 */
export function computeCalibrationStatistics(
  resolutionRingBuffer: CalibrationRingBuffer,
  predictions: readonly Prediction[],
): readonly ModelCalibrationProfile[] {
  // 收集所有 resolutions
  const resolutions: ResolutionResult[] = [];
  for (let i = 0; i < resolutionRingBuffer.resolutionRecords.length; i++) {
    const r = resolutionRingBuffer.resolutionRecords[i];
    if (r) resolutions.push(r);
  }

  // 收集所有 modelKey
  const modelKeys = new Set<string>();
  for (const p of predictions) {
    modelKeys.add(makeModelKey(p.target, p.method, p.modelVersion));
  }

  // 按字母序排序确保确定性
  const sortedKeys = [...modelKeys].sort();

  const profiles: ModelCalibrationProfile[] = [];
  for (const key of sortedKeys) {
    profiles.push(computeCalibrationProfile(resolutions, predictions, key));
  }

  return profiles;
}

// ═══════════════════════════════════════════════════════════
// §7. Calibration Profile Hash
// ═══════════════════════════════════════════════════════════

/**
 * ModelCalibrationProfile 确定性 Hash。

 * 复用 A6.3 stableStringify + FNV-1a 32-bit。

 * 来源：A6_4_CONTRACT.md §二.5
 */
export function calibrationProfileHash(
  profile: Omit<ModelCalibrationProfile, "profileHash">,
): string {
  const payload = stableStringify({
    modelKey: profile.modelKey,
    target: profile.target,
    method: profile.method,
    modelVersion: profile.modelVersion,
    statisticsTick: profile.statisticsTick,
    totalResolutions: profile.totalResolutions,
    calibratableCount: profile.calibratableCount,
    regimeChangedCount: profile.regimeChangedCount,
    externalInterferenceCount: profile.externalInterferenceCount,
    insufficientObservationCount: profile.insufficientObservationCount,
    buckets: profile.buckets.map(b => ({
      bucketIndex: b.bucketIndex,
      avgConfidence: Number(b.avgConfidence.toFixed(3)),
      observedSuccessRate: Number(b.observedSuccessRate.toFixed(3)),
      sampleCount: b.sampleCount,
      calibrationError: Number(b.calibrationError.toFixed(3)),
    })),
    calibrationVerdict: profile.calibrationVerdict,
    ece: Number(profile.ece.toFixed(3)),
    brierScore: profile.brierScore !== null ? Number(profile.brierScore.toFixed(3)) : null,
    falsePositiveRate: Number(profile.falsePositiveRate.toFixed(3)),
    falseNegativeRate: Number(profile.falseNegativeRate.toFixed(3)),
  });
  return fnv1a32Hex(payload);
}

// ═══════════════════════════════════════════════════════════
// §8. Sufficient Check
// ═══════════════════════════════════════════════════════════

/**
 * 检查是否有足够样本来生成 Profile。

 * 需要 ≥ MIN_SAMPLES_FOR_PROFILE 个 calibratable resolutions。
 */
export function hasSufficientSamples(
  resolutions: readonly ResolutionResult[],
): boolean {
  let count = 0;
  for (const r of resolutions) {
    if (isCalibratable(r.resolution)) count++;
  }
  return count >= MIN_SAMPLES_FOR_PROFILE;
}
