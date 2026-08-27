/** A6.4 Calibration Types — 校准层基础类型定义。 */

import type { PredictionContext } from "../prediction/context";
import type { Prediction } from "../prediction/types";

// ═══════════════════════════════════════════════════════════
// §1. CalibrationResolution — 8 种解析分类
// ═══════════════════════════════════════════════════════════

/**
 * A6.4 Calibration Resolution — 对 Prediction 的解析结果分类。

 * 与 A6.3 PredictionStatus（active/fulfilled/expired/invalidated）不同：
 * CalibrationResolution 是更细粒度的校准分类。

 * 来源：A6_4_RESOLUTION_DESIGN.md §二
 */
export type CalibrationResolution =
  | "CORRECT"
  | "INCORRECT"
  | "PARTIAL"
  | "FALSE_POSITIVE"
  | "FALSE_NEGATIVE"
  | "REGIME_CHANGED"
  | "EXTERNAL_INTERFERENCE"
  | "INSUFFICIENT_OBSERVATION";

/**
 * 判断 Resolution 是否计入 Calibration denominator。

 * REGIME_CHANGED / EXTERNAL_INTERFERENCE / INSUFFICIENT_OBSERVATION 不计入。
 * 来源：A6_4_RESOLUTION_DESIGN.md §二.2
 */
export function isCalibratable(resolution: CalibrationResolution): boolean {
  return (
    resolution === "CORRECT" ||
    resolution === "INCORRECT" ||
    resolution === "PARTIAL" ||
    resolution === "FALSE_POSITIVE" ||
    resolution === "FALSE_NEGATIVE"
  );
}

/**
 * 判断 Resolution 是否为"成功"（用于 observedSuccessRate 分子）。

 * 只有 CORRECT 计入成功。
 * PARTIAL / FALSE_POSITIVE / FALSE_NEGATIVE 计入失败。
 */
export function isResolutionSuccess(resolution: CalibrationResolution): boolean {
  return resolution === "CORRECT";
}

// ═══════════════════════════════════════════════════════════
// §2. ObservationSample — 窗口内观测采样
// ═══════════════════════════════════════════════════════════

/**
 * 窗口内的一次观测采样。

 * 不包含 Game/Memory 引用。
 * 由 System 层从 globalCache 既有数据构建，不新建采样通道（CAL-007）。
 */
export interface ObservationSample {
  /** 采样 tick。 */
  readonly tick: number;
  /** 观测值。 */
  readonly value: number;
  /** 数据来源标识（如 "empireHealth.reserve", "spawnQueueDepth"）。 */
  readonly source: string;
}

// ═══════════════════════════════════════════════════════════
// §3. ExternalFactorSignal — 外部干扰信号
// ═══════════════════════════════════════════════════════════

/**
 * 外部干扰信号 — 从 A6.1 Attribution 和 A6.2 Evaluation 提取。

 * 来源：A6_4_CONTRACT.md §1.3
 */
export interface ExternalFactorSignal {
  /** 来源标识（"a61-attribution" | "a62-evaluation" | "globalCache"）。 */
  readonly source: string;
  /** 描述。 */
  readonly description: string;
  /** 强度（0-1）。 */
  readonly magnitude: number;
}

// ═══════════════════════════════════════════════════════════
// §4. ResolutionResult — 解析结果
// ═══════════════════════════════════════════════════════════

/**
 * Resolution Result — 对一条 Prediction 的 Resolution 结果。

 * 纯数据对象，不引用 Game/Memory/Prediction 可变状态。
 * 确定性：相同 Prediction + 相同 Observation → 相同 ResolutionResult。

 * A6.4 不修改 Prediction 对象。A6.4 只读取 Prediction 和 Observation，
 * 产出独立的 ResolutionResult。

 * 来源：A6_4_CONTRACT.md §1.4
 */
export interface ResolutionResult {
  /** 关联的 Prediction ID。 */
  readonly predictionId: string;
  /** Resolution 分类。 */
  readonly resolution: CalibrationResolution;
  /** Resolution 执行 tick。 */
  readonly resolvedTick: number;
  /** 预测值（从 Prediction 复制，用于独立 hash）。 */
  readonly predictedValue: number;
  /** 实际值（Resolution 时的观测值）。 */
  readonly actualValue: number;
  /** 绝对误差。 */
  readonly absoluteError: number;
  /** 相对误差。 */
  readonly relativeError: number;
  /** 方向是否正确。 */
  readonly directionCorrect: boolean;
  /** 是否在 Horizon 内发生。 */
  readonly withinHorizon: boolean;
  /** Resolution 时的 Regime 签名。 */
  readonly resolutionContextSignature: string;
  /** Regime 是否发生变化。 */
  readonly regimeChanged: boolean;
  /** Regime 变化的维度列表。 */
  readonly regimeMismatchedDimensions: readonly string[];
  /** 是否有外部因素干扰。 */
  readonly hasExternalInterference: boolean;
  /** 外部因素来源列表（引用 A6.1 attribution.externalFactors 或 A6.2 findings）。 */
  readonly externalFactorSources: readonly string[];
  /** Resolution 描述。 */
  readonly reason: string;
  /** 确定性 hash。 */
  readonly resolutionHash: string;
}

// ═══════════════════════════════════════════════════════════
// §5. ConfidenceBucketStats — 置信度分桶统计
// ═══════════════════════════════════════════════════════════

/**
 * 置信度分桶统计 — 单个桶的校准统计。

 * 10 个桶：[0,0.1), [0.1,0.2), ..., [0.9,1.0]

 * 来源：A6_4_CONTRACT.md §1.5
 */
export interface ConfidenceBucketStats {
  /** 桶索引（0-9）。 */
  readonly bucketIndex: number;
  /** 桶下界（含）。 */
  readonly confidenceLow: number;
  /** 桶上界（不含，最后一桶含 1.0）。 */
  readonly confidenceHigh: number;
  /** 桶内平均置信度。 */
  readonly avgConfidence: number;
  /** 观测成功率（CORRECT / calibratable total）。 */
  readonly observedSuccessRate: number;
  /** 样本数。 */
  readonly sampleCount: number;
  /** 各 Resolution 分类的计数。 */
  readonly resolutionCounts: {
    readonly CORRECT: number;
    readonly INCORRECT: number;
    readonly PARTIAL: number;
    readonly FALSE_POSITIVE: number;
    readonly FALSE_NEGATIVE: number;
  };
  /** 校准误差（|avgConfidence - observedSuccessRate|）。 */
  readonly calibrationError: number;
  /** 是否有足够样本（≥ MIN_SAMPLES_PER_BUCKET）。 */
  readonly sufficient: boolean;
}

// ═══════════════════════════════════════════════════════════
// §6. CalibrationVerdict — 校准判定
// ═══════════════════════════════════════════════════════════

/**
 * 校准判定 — 对模型置信度可信度的整体评价。

 * 来源：A6_4_CONTRACT.md §1.6
 */
export type CalibrationVerdict =
  | "WELL_CALIBRATED"
  | "OVERCONFIDENT"
  | "UNDERCONFIDENT"
  | "INSUFFICIENT_DATA";

// ═══════════════════════════════════════════════════════════
// §7. ModelCalibrationProfile — 模型校准档案
// ═══════════════════════════════════════════════════════════

/**
 * 模型校准档案 — 单个预测模型的完整校准统计。

 * 来源：A6_4_CONTRACT.md §1.7
 */
export interface ModelCalibrationProfile {
  /** 模型 key（格式：target-method-modelVersion）。 */
  readonly modelKey: string;
  /** 预测目标。 */
  readonly target: string;
  /** 预测方法。 */
  readonly method: string;
  /** 模型版本。 */
  readonly modelVersion: number;
  /** 统计 tick。 */
  readonly statisticsTick: number;
  /** 总解析数。 */
  readonly totalResolutions: number;
  /** 可校准数（不含 REGIME_CHANGED / EXTERNAL_INTERFERENCE / INSUFFICIENT_OBSERVATION）。 */
  readonly calibratableCount: number;
  /** Regime 变化数。 */
  readonly regimeChangedCount: number;
  /** 外部干扰数。 */
  readonly externalInterferenceCount: number;
  /** 观测不足数。 */
  readonly insufficientObservationCount: number;
  /** 10 个置信度桶。 */
  readonly buckets: readonly ConfidenceBucketStats[];
  /** 校准判定。 */
  readonly calibrationVerdict: CalibrationVerdict;
  /** 预期校准误差。 */
  readonly ece: number;
  /** Brier 分数（可选，需要足够样本）。 */
  readonly brierScore: number | null;
  /** 假阳性率。 */
  readonly falsePositiveRate: number;
  /** 假阴性率。 */
  readonly falseNegativeRate: number;
  /** 档案确定性 hash。 */
  readonly profileHash: string;
}

// ═══════════════════════════════════════════════════════════
// §8. FailureAttribution — 失败归因
// ═══════════════════════════════════════════════════════════

/**
 * 失败归因分类。

 * 来源：A6_4_CONTRACT.md §1.8
 */
export type FailureAttributionCategory =
  | "MODEL_ERROR"
  | "INSUFFICIENT_DATA"
  | "LOW_R2"
  | "HORIZON_MISMATCH"
  | "OBSERVATION_GAP"
  | "OUTCOME_AMBIGUOUS";

/**
 * 失败归因结果 — 对一条失败 Prediction 的归因。

 * 来源：A6_4_CONTRACT.md §1.9
 */
export interface FailureAttributionResult {
  /** 关联的 Prediction ID。 */
  readonly predictionId: string;
  /** 关联的 Resolution hash。 */
  readonly resolutionHash: string;
  /** 归因分类。 */
  readonly category: FailureAttributionCategory;
  /** 归因描述。 */
  readonly reason: string;
  /** A6.1 Attribution primaryCause（如果有关联）。 */
  readonly a61PrimaryCause: string | null;
  /** A6.1 Attribution externalFactors（如果有关联）。 */
  readonly a61ExternalFactors: readonly string[];
  /** A6.2 Finding 描述（如果有关联）。 */
  readonly a62FindingDescription: string | null;
  /** 模型 R²（从 prediction.evidence.modelParams 读取）。 */
  readonly modelR2: number | null;
  /** 样本数。 */
  readonly sampleCount: number;
  /** 归因确定性 hash。 */
  readonly attributionHash: string;
}

/**
 * 模型级失败统计。

 * 来源：A6_4_CONTRACT.md §1.10
 */
export interface ModelFailureStats {
  /** 模型 key。 */
  readonly modelKey: string;
  /** 总失败数。 */
  readonly totalFailures: number;
  /** 各归因分类计数。 */
  readonly attributionCounts: {
    readonly MODEL_ERROR: number;
    readonly INSUFFICIENT_DATA: number;
    readonly LOW_R2: number;
    readonly HORIZON_MISMATCH: number;
    readonly OBSERVATION_GAP: number;
    readonly OUTCOME_AMBIGUOUS: number;
  };
  /** 主导失败分类（数量最多的分类）。 */
  readonly dominantFailureCategory: FailureAttributionCategory | null;
  /** 统计确定性 hash。 */
  readonly statsHash: string;
}

// ═══════════════════════════════════════════════════════════
// §9. CalibrationRingBuffer — 校准环形缓冲
// ═══════════════════════════════════════════════════════════

/**
 * Calibration Ring Buffer — 存储 Resolution 结果的有界环形缓冲。

 * 同构于 PredictionRingBuffer / ExperienceRingBuffer / EvaluationRingBuffer。
 * 容量固定，超出时环形覆盖最旧数据。

 * 来源：A6_4_CONTRACT.md §1.11
 */
export interface CalibrationRingBuffer {
  /** Resolution 结果数组。 */
  resolutionRecords: (ResolutionResult | undefined)[];
  /** 容量。 */
  resolutionCapacity: number;
  /** 当前条数。 */
  resolutionCount: number;
  /** 写入游标（环形覆盖位置）。 */
  resolutionCursor: number;
  /** 已解析的 Prediction ID 集合（防止重复解析）。 */
  resolvedPredictionIds: Set<string>;
  /** 模型校准档案（按 modelKey 索引）。 */
  profiles: Map<string, ModelCalibrationProfile>;
  /** 模型失败统计（按 modelKey 索引）。 */
  failureStats: Map<string, ModelFailureStats>;
  /** 上次 Profile 计算 tick。 */
  lastProfileTick: number;
}

// ═══════════════════════════════════════════════════════════
// §10. 常量
// ═══════════════════════════════════════════════════════════

/**
 * Resolution Grace Period（tick）。
 * 允许数据延迟到达，在 endTick + grace 后执行 Resolution。
 */
export const RESOLUTION_GRACE_PERIOD = 100;

/** 最小观测样本数。 */
export const MIN_OBSERVATION_SAMPLES = 3;

/** 最大观测间隔（tick）—— 超过视为 INSUFFICIENT_OBSERVATION。 */
export const MAX_OBSERVATION_GAP = 500;

/** CORRECT 相对误差阈值。 */
export const CORRECT_RELATIVE_ERROR_THRESHOLD = 0.2;

/** INCORRECT 相对误差阈值。 */
export const INCORRECT_RELATIVE_ERROR_THRESHOLD = 0.5;

/** 置信度桶数量。 */
export const CONFIDENCE_BUCKET_COUNT = 10;

/** 每桶最小样本数。 */
export const MIN_SAMPLES_PER_BUCKET = 30;

/** 生成 Profile 的最小总样本数。 */
export const MIN_SAMPLES_FOR_PROFILE = 100;

/** 生成 Verdict 的最小总样本数。 */
export const MIN_SAMPLES_FOR_VERDICT = 200;

/** ECE 良校准阈值。 */
export const ECE_WELL_CALIBRATED_THRESHOLD = 0.05;

/** 校准偏差阈值。 */
export const CALIBRATION_BIAS_THRESHOLD = 0.1;

/** Resolution Ring Buffer 容量。 */
export const RESOLUTION_RING_BUFFER_CAPACITY = 500;

/** Resolution 最大存活 tick。 */
export const RESOLUTION_MAX_AGE = 100000;

/** 最大 Profile 数量。 */
export const MAX_PROFILES = 10;

/** Calibration System 执行间隔（tick）。 */
export const CALIBRATION_INTERVAL = 500;

/** Profile 重计算间隔（tick）。 */
export const CALIBRATION_PROFILE_INTERVAL = 5000;
