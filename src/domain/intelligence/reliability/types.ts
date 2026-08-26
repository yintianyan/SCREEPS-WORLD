/**
 * A6.5 Reliability Types — IntelligenceState 及所有子类型定义。
 *
 * 合同锚点：A6_5_ARCHITECTURE.md §三
 *
 * 职责：
 *   - 定义 IntelligenceState（多维只读投影，不持久化）
 *   - 定义 ModelReliabilityAssessment（单模型可靠性评估）
 *   - 定义 CalibrationHealthSummary / DataSufficiencySummary / RegimeFitSummary
 *   - 定义 UncertaintySummary / PredictionConflict / FreshnessSummary
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * REL-001 (Read-Only)：类型定义不执行任何行为。
 * REL-005 (Deterministic)：所有 hash 使用 stableStringify + FNV-1a。
 * REL-012 (No Reliability Score)：禁止 reliabilityScore: number 字段。
 *
 * 依赖方向：
 *   A6.5 Reliability Domain
 *     ↓ imports (只读)
 *   A6.4 Calibration Domain (types only)
 *   A6.3 Prediction Domain (types only)
 */

import type { CalibrationVerdict } from "../calibration/types";

// ═══════════════════════════════════════════════════════════
// §1. Prediction Coverage
// ═══════════════════════════════════════════════════════════

/**
 * 预测覆盖度 — 系统已实现多少种预测模型。
 */
export interface PredictionCoverage {
  /** 已实现的 PredictionTarget 数量。 */
  readonly implementedModels: number;
  /** 规划的 PredictionTarget 总数（当前 7）。 */
  readonly plannedModels: number;
  /** 已实现的 target 列表。 */
  readonly coveredTargets: readonly string[];
  /** 未实现的 target 列表。 */
  readonly missingTargets: readonly string[];
  /** 当前活跃预测数。 */
  readonly activePredictions: number;
}

// ═══════════════════════════════════════════════════════════
// §2. Model Reliability Assessment
// ═══════════════════════════════════════════════════════════

/**
 * 单个模型的可靠性评估。
 *
 * REL-012：禁止 reliabilityScore: number。
 * Reliability 是多维评估，不是单一分数。
 */
export interface ModelReliabilityAssessment {
  /** 模型 key（target-method-modelVersion）。 */
  readonly modelKey: string;
  /** 预测目标。 */
  readonly target: string;

  // ── Regime Profile ──
  /** 当前 Regime 的 Profile 是否存在。 */
  readonly regimeProfileAvailable: boolean;
  /** 使用的 Profile 来源。 */
  readonly profileSource: ProfileSource;
  /** Regime Profile 的可校准样本数。 */
  readonly regimeSampleCount: number;

  // ── 校准状态 ──
  /** 校准判定。 */
  readonly calibrationVerdict: CalibrationVerdict;
  /** 预期校准误差。 */
  readonly ece: number;
  /** Brier 分数。 */
  readonly brierScore: number | null;
  /** 假阳性率。 */
  readonly falsePositiveRate: number;
  /** 假阴性率。 */
  readonly falseNegativeRate: number;

  // ── 时效性 ──
  /** 是否检测到 drift。 */
  readonly driftDetected: boolean;
  /** Drift 方向。 */
  readonly driftDirection: DriftDirection;
  /** 最近窗口 ECE。 */
  readonly recentEce: number | null;
  /** 全历史 ECE。 */
  readonly overallEce: number;

  // ── 样本充足性 ──
  /** 样本充足性状态。 */
  readonly sampleSufficiency: SampleSufficiency;

  // ── 可追溯 ──
  /** 关联的 Profile hash。 */
  readonly profileHash: string;
  /** 本评估的确定性 hash。 */
  readonly reliabilityHash: string;
}

/**
 * Profile 来源类型。
 */
export type ProfileSource = "REGIME" | "FALLBACK_GLOBAL" | "NONE";

/**
 * Drift 方向。
 */
export type DriftDirection = "DEGRADING" | "IMPROVING" | "STABLE" | "UNKNOWN";

/**
 * 样本充足性状态。
 */
export type SampleSufficiency =
  | "SUFFICIENT"
  | "INSUFFICIENT_FOR_REGIME"
  | "FALLBACK_GLOBAL"
  | "INSUFFICIENT_DATA";

// ═══════════════════════════════════════════════════════════
// §3. Calibration Health Summary
// ═══════════════════════════════════════════════════════════

/**
 * 校准健康度 — 整体校准系统的健康状态。
 */
export interface CalibrationHealthSummary {
  /** 整体状态。 */
  readonly status: CalibrationHealthStatus;
  /** 是否检测到 drift。 */
  readonly driftDetected: boolean;
  /** Drift 方向。 */
  readonly driftDirection: DriftDirection;
  /** Profile 是否过期。 */
  readonly profileStale: boolean;
  /** 各模型 ECE 摘要。 */
  readonly modelEceSummary: readonly ModelEceEntry[];
}

/**
 * 校准健康状态。
 */
export type CalibrationHealthStatus =
  | "HEALTHY"
  | "DRIFT_DETECTED"
  | "STALE"
  | "INSUFFICIENT_DATA"
  | "COLD_START";

/**
 * 单模型 ECE 摘要条目。
 */
export interface ModelEceEntry {
  readonly modelKey: string;
  readonly ece: number;
  readonly recentEce: number | null;
}

// ═══════════════════════════════════════════════════════════
// §4. Data Sufficiency Summary
// ═══════════════════════════════════════════════════════════

/**
 * 数据充足性聚合 — 跨模型的数据充足性视图。
 */
export interface DataSufficiencySummary {
  /** 数据是否整体充足。 */
  readonly sufficient: boolean;
  /** 总 Resolution 数。 */
  readonly totalResolutions: number;
  /** 有充足数据的模型数。 */
  readonly modelsWithSufficientData: number;
  /** 最少样本的模型及其样本数。 */
  readonly minSamplesModel: { modelKey: string; count: number } | null;
  /** 不足维度列表。 */
  readonly insufficientDimensions: readonly string[];
}

// ═══════════════════════════════════════════════════════════
// §5. Regime Fit Summary
// ═══════════════════════════════════════════════════════════

/**
 * Regime 适配度 — 当前 Regime 下各模型的适配情况。
 */
export interface RegimeFitSummary {
  /** 当前 Regime 是否有匹配的 Profile。 */
  readonly currentRegimeMatched: boolean;
  /** 当前 ContextSignature。 */
  readonly currentSignature: string;
  /** 各模型的 Regime 适配情况。 */
  readonly modelRegimeFit: readonly ModelRegimeFitEntry[];
}

/**
 * 单模型 Regime 适配条目。
 */
export interface ModelRegimeFitEntry {
  readonly modelKey: string;
  readonly regimeMatched: boolean;
  readonly profileSource: ProfileSource;
}

// ═══════════════════════════════════════════════════════════
// §6. Uncertainty Summary
// ═══════════════════════════════════════════════════════════

/**
 * 不确定性来源。
 */
export interface UncertaintySource {
  readonly type: UncertaintyType;
  readonly description: string;
  readonly severity: number;  // 0-1
}

/**
 * 不确定性类型。
 */
export type UncertaintyType =
  | "epistemic"        // 数据不足
  | "systematic"       // 模型冲突
  | "distributional"   // Regime 变化
  | "temporal"         // 时间退化
  | "environmental";   // 外部干扰

/**
 * 不确定性聚合 — 系统级不确定性来源。
 *
 * REL-012：禁止 uncertaintyScore: number。
 */
export interface UncertaintySummary {
  readonly sources: readonly UncertaintySource[];
  readonly dominantSource: string | null;
  readonly description: string;
  /** 对不确定性评估本身的置信度。 */
  readonly confidenceInAssessment: number;
}

// ═══════════════════════════════════════════════════════════
// §7. Prediction Conflict
// ═══════════════════════════════════════════════════════════

/**
 * 预测冲突 — 两个活跃预测之间的矛盾。
 *
 * REL-011：A6.5 只检测和标记冲突，不解决冲突。
 */
export interface PredictionConflict {
  /** 冲突 ID。 */
  readonly conflictId: string;
  /** 冲突类型。 */
  readonly type: ConflictType;
  /** 参与冲突的预测 ID 列表。 */
  readonly predictionIds: readonly string[];
  /** 描述。 */
  readonly description: string;
  /** 严重度 [0,1]。 */
  readonly severity: number;
  /** 检测 tick。 */
  readonly detectedAt: number;
  /** 确定性 hash。 */
  readonly conflictHash: string;
}

/**
 * 冲突类型。
 */
export type ConflictType = "logical" | "temporal" | "evidence" | "regime";

// ═══════════════════════════════════════════════════════════
// §8. Freshness Summary
// ═══════════════════════════════════════════════════════════

/**
 * 新鲜度来源条目。
 */
export interface FreshnessSource {
  /** 数据源名称。 */
  readonly source: string;
  /** 新鲜度等级。 */
  readonly freshness: FreshnessLevel;
  /** 距当前 tick 的年龄。 */
  readonly ageInTicks: number;
}

/**
 * 新鲜度等级。
 */
export type FreshnessLevel = "FRESH" | "RECENT" | "STALE" | "EXPIRED" | "EMPTY";

/**
 * 知识新鲜度聚合。
 */
export interface FreshnessSummary {
  readonly sources: readonly FreshnessSource[];
  readonly overallFreshness: OverallFreshness;
}

/**
 * 整体新鲜度等级。
 */
export type OverallFreshness =
  | "FRESH"
  | "RECENT"
  | "STALE"
  | "EXPIRED"
  | "COLD_START";

// ═══════════════════════════════════════════════════════════
// §9. IntelligenceState
// ═══════════════════════════════════════════════════════════

/**
 * IntelligenceState — 多维 Intelligence 健康状态。
 *
 * READ-ONLY PROJECTION（REL-001）：
 *   不持久化，不写入 globalCache。
 *   每次运行时从 A6.1-A6.4 既有数据重新计算。
 *
 * REL-012：禁止 intelligenceScore / overallScore / reliabilityScore 字段。
 *
 * 禁止合并为单一 IntelligenceScore。
 */
export interface IntelligenceState {
  // ── 预测覆盖 ──
  readonly predictionCoverage: PredictionCoverage;

  // ── 模型可靠性 ──
  readonly modelReliability: readonly ModelReliabilityAssessment[];

  // ── 校准健康度 ──
  readonly calibrationHealth: CalibrationHealthSummary;

  // ── 数据充足性 ──
  readonly dataSufficiency: DataSufficiencySummary;

  // ── Regime 适配 ──
  readonly regimeFit: RegimeFitSummary;

  // ── 不确定性 ──
  readonly uncertainty: UncertaintySummary;

  // ── 冲突状态 ──
  readonly predictionConflicts: readonly PredictionConflict[];

  // ── 知识新鲜度 ──
  readonly knowledgeFreshness: FreshnessSummary;

  // ── 元数据 ──
  /** 评估 tick。 */
  readonly assessedAt: number;
  /** 评估确定性 hash。 */
  readonly stateHash: string;
}

// ═══════════════════════════════════════════════════════════
// §10. 常量
// ═══════════════════════════════════════════════════════════

/** Regime Profile 最小样本数（低于此回退到全局）。 */
export const MIN_SAMPLES_FOR_REGIME_PROFILE = 100;

/** Rolling Window 大小（最近 N 条 Resolution）。 */
export const ROLLING_WINDOW_SIZE = 100;

/** Rolling Window 最小可校准样本数。 */
export const ROLLING_WINDOW_MIN_CALIBRATABLE = 30;

/** Drift 恶化倍数（recentEce > overallEce × 此值 → DEGRADING）。 */
export const DRIFT_DEGRADING_MULTIPLIER = 1.5;

/** Drift 改善倍数（recentEce < overallEce × 此值 → IMPROVING）。 */
export const DRIFT_IMPROVING_MULTIPLIER = 0.5;

/** Profile 过期 tick 数（超过此值未更新 → STALE）。 */
export const PROFILE_STALE_TICKS = 15000;

/** Freshness 等级阈值（tick）。 */
export const FRESHNESS_FRESH_TICKS = 5000;
export const FRESHNESS_RECENT_TICKS = 20000;
export const FRESHNESS_STALE_TICKS = 50000;

/** Temporal 冲突阈值（value 差异比例 > 此值 → temporal conflict）。 */
export const TEMPORAL_CONFLICT_THRESHOLD = 0.3;

/** 规划的预测模型总数。 */
export const PLANNED_PREDICTION_MODELS = 7;

/** IntelligenceState 最大序列化大小（bytes）。 */
export const INTELLIGENCE_STATE_MAX_BYTES = 2048;

/** A6.5 System 执行间隔（tick）。 */
export const INTELLIGENCE_STATE_INTERVAL = 500;
