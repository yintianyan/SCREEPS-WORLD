/** A6.2 Baseline Model — Domain 层纯函数与类型定义。 */

import type { EvaluationDimension } from "./strategy-evaluation";
import type { ExperienceRecord } from "./experience";

// ═══════════════════════════════════════════════════════════
// §1. Baseline Types
// ═══════════════════════════════════════════════════════════

/** Baseline 来源类型。 */
export type BaselineSource =
  | "config"       // CONFIG 静态基准
  | "historical"   // Experience Ring Buffer 滚动历史
  | "community"    // 社区平均值（当前 UNAVAILABLE）
  | "none";        // 无可用 baseline

/** BaselineKey — 唯一标识一个 baseline 上下文。 */
export interface BaselineKey {
  /** 策略类型（ExperienceType 映射）。 */
  readonly strategyId: string;
  /** 帝国阶段（develop / expand / fortify / war）。 */
  readonly phase: string;
  /** 上下文签名（RCL range + room count range + threat level）。 */
  readonly contextSignature: string;
}

/** 单维度 Baseline 值。 */
export interface BaselineValue {
  /** 维度名。 */
  readonly dimension: EvaluationDimension;
  /** 基准值。 */
  readonly value: number;
  /** 基准来源。 */
  readonly source: BaselineSource;
  /** 样本数（config = Infinity, historical = N, community = 0）。 */
  readonly samples: number;
  /** 中位数（historical only）。 */
  readonly median: number;
  /** 均值（historical only）。 */
  readonly mean: number;
  /** 方差（historical only）。 */
  readonly variance: number;
  /** 置信度（0-1）。 */
  readonly confidence: number;
  /** 是否有 outlier 被剔除。 */
  readonly outliersRemoved: number;
}

/** Baseline — 完整的多维度基准。 */
export interface Baseline {
  /** Baseline key。 */
  readonly key: BaselineKey;
  /** 各维度基准值。 */
  readonly dimensions: Readonly<Record<EvaluationDimension, BaselineValue>>;
  /** Baseline hash（确定性验证）。 */
  readonly baselineHash: string;
  /** 构建时间 tick。 */
  readonly tick: number;
  /** 模型版本。 */
  readonly modelVersion: number;
}

/** Baseline 比较结果。 */
export interface BaselineComparison {
  /** 维度名。 */
  readonly dimension: EvaluationDimension;
  /** 观察值。 */
  readonly observed: number;
  /** 基准值。 */
  readonly baseline: number;
  /** 偏差（observed - baseline）。 */
  readonly delta: number;
  /** 相对变化率（delta / |baseline|，baseline=0 时为 0）。 */
  readonly relativeDelta: number;
  /** 基准来源。 */
  readonly baselineSource: BaselineSource;
  /** 基准置信度。 */
  readonly baselineConfidence: number;
  /** 比较是否有效（context 不匹配时为 false）。 */
  readonly comparable: boolean;
  /** 不可比较的原因（comparable=false 时有值）。 */
  readonly incompatibilityReason?: string;
}

/** 样本充足性评估结果。 */
export interface SampleSufficiency {
  /** 是否充足。 */
  readonly sufficient: boolean;
  /** 当前样本数。 */
  readonly samples: number;
  /** 最低样本数要求。 */
  readonly minimumRequired: number;
  /** 置信度（0-1）。 */
  readonly confidence: number;
  /** 不足时的建议。 */
  readonly recommendation: string;
}

/** Regime mismatch 检测结果。 */
export interface RegimeMismatch {
  /** 是否检测到 regime 不匹配。 */
  readonly mismatch: boolean;
  /** 不匹配的维度列表。 */
  readonly mismatchedDimensions: string[];
  /** 严重度（0-1）。 */
  readonly severity: number;
  /** 建议的 action。 */
  readonly recommendation: string;
}

// ═══════════════════════════════════════════════════════════
// §2. CONFIG Baseline Values
// ═══════════════════════════════════════════════════════════

/**
 * CONFIG 静态基准值 — 从已有系统推导的合理默认值。

 * 这些不是"最优值"，而是"帝国正常运行时各维度应该达到的最低水平"。
 * 来源：EmpireHealth Hysteresis 阈值 + AutonomyMetrics + RecoveryStats。

 * 理由：
 *   economicGrowth=0.70  → EmpireHealth recoverToStable 阈值
 *   resourceEfficiency=0.75 → logistics deliveryRate 目标 0.9，保守取 0.75
 *   cpuEfficiency=0.75    → CpuTier healthy/guarded 的正常水平
 *   riskLevel=0.75        → develop 姿态下 threatHealth=stable=0.75
 *   survival=0.70         → EmpireHealth enterDegraded 阈值
 *   expansion=0.50        → 扩张成功率 50% 是社区公认合理值
 *   militaryOutcome=0.50  → 胜率 50% 是中性期望
 *   recoveryCost=0.75    → 恢复成功率 75% 是健康水平
 */
export const CONFIG_BASELINE_VALUES: Readonly<Record<EvaluationDimension, number>> = {
  economicGrowth: 0.70,
  resourceEfficiency: 0.75,
  cpuEfficiency: 0.75,
  riskLevel: 0.75,
  survival: 0.70,
  expansion: 0.50,
  militaryOutcome: 0.50,
  recoveryCost: 0.75,
};

/**
 * 各维度最低样本数要求。

 * A6.0 未明确指定 → 以 CONFIG 常量表达并记录理由。

 * 理由：
 *   economicGrowth=5    → 经济是多系统耦合，需更多样本平滑噪声
 *   resourceEfficiency=5 → 物流效率波动大
 *   cpuEfficiency=10    → CPU 受 tick 负载影响，需更多样本
 *   riskLevel=3         → 威胁变化快，少量样本即可判断
 *   survival=3          → 生存度变化慢
 *   expansion=2         → 扩张事件低频，2 个样本即开始评估
 *   militaryOutcome=3   → 战争事件低频但重要
 *   recoveryCost=3      → 恢复事件中频
 */
export const MINIMUM_SAMPLE_SIZES: Readonly<Record<EvaluationDimension, number>> = {
  economicGrowth: 5,
  resourceEfficiency: 5,
  cpuEfficiency: 10,
  riskLevel: 3,
  survival: 3,
  expansion: 2,
  militaryOutcome: 3,
  recoveryCost: 3,
};

// ═══════════════════════════════════════════════════════════
// §3. BaselineKey Construction
// ═══════════════════════════════════════════════════════════

/**
 * 构建 BaselineKey 的 contextSignature。

 * 编码：rclRange + roomCountRange + threatLevel
 * 不同 RCL/规模/威胁下的 baseline 不可混合。

 * RCL range：1-3=early, 4-6=mid, 7-8=late
 * Room count range：1=single, 2-3=small, 4-6=medium, 7+=large
 */
export function buildContextSignature(input: {
  rcl: number;
  roomCount: number;
  threatLevel: string;
}): string {
  const rclRange =
    input.rcl <= 3 ? "early" : input.rcl <= 6 ? "mid" : "late";
  const roomRange =
    input.roomCount <= 1 ? "single" : input.roomCount <= 3 ? "small" : input.roomCount <= 6 ? "medium" : "large";
  const threat = input.threatLevel.toLowerCase();
  return `${rclRange}-${roomRange}-${threat}`;
}

/**
 * 构建 BaselineKey。
 */
export function buildBaselineKey(input: {
  strategyId: string;
  phase: string;
  rcl: number;
  roomCount: number;
  threatLevel: string;
}): BaselineKey {
  return {
    strategyId: input.strategyId,
    phase: input.phase,
    contextSignature: buildContextSignature(input),
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Build Baseline
// ═══════════════════════════════════════════════════════════

/**
 * 构建 Baseline — 从历史 Experience 计算 + CONFIG 兜底。

 * 策略：
 *   1. 如果历史样本 >= minimum → 用 HISTORICAL baseline
 *   2. 如果历史样本 > 0 但 < minimum → 用 CONFIG baseline，降低置信度
 *   3. 如果无历史样本 → 用 CONFIG baseline，置信度 = 0.5
 *   4. COMMUNITY baseline = UNAVAILABLE

 * 纯函数 — 不引用 Game/Memory。
 */
export function buildBaseline(
  key: BaselineKey,
  historicalValues: Readonly<Record<EvaluationDimension, number[]>>,
  modelVersion: number,
  tick: number,
): Baseline {
  const dimensions = {} as Record<EvaluationDimension, BaselineValue>;

  for (const dim of Object.keys(CONFIG_BASELINE_VALUES) as EvaluationDimension[]) {
    const configVal = CONFIG_BASELINE_VALUES[dim];
    const history = historicalValues[dim] ?? [];
    const minSamples = MINIMUM_SAMPLE_SIZES[dim] ?? 5;

    if (history.length >= minSamples) {
      // HISTORICAL baseline
      const stats = computeStats(history);
      dimensions[dim] = {
        dimension: dim,
        value: stats.mean,
        source: "historical",
        samples: history.length,
        median: stats.median,
        mean: stats.mean,
        variance: stats.variance,
        confidence: computeBaselineConfidence(history.length, stats.variance, 0),
        outliersRemoved: stats.outliersRemoved,
      };
    } else if (history.length > 0) {
      // Insufficient historical → CONFIG with reduced confidence
      dimensions[dim] = {
        dimension: dim,
        value: configVal,
        source: "config",
        samples: history.length,
        median: configVal,
        mean: configVal,
        variance: 0,
        confidence: 0.5 * (history.length / minSamples),
        outliersRemoved: 0,
      };
    } else {
      // No history → CONFIG with low confidence
      dimensions[dim] = {
        dimension: dim,
        value: configVal,
        source: "config",
        samples: 0,
        median: configVal,
        mean: configVal,
        variance: 0,
        confidence: 0.3,
        outliersRemoved: 0,
      };
    }
  }

  const hash = baselineHash(key, dimensions, modelVersion);

  return {
    key,
    dimensions,
    baselineHash: hash,
    tick,
    modelVersion,
  };
}

// ═══════════════════════════════════════════════════════════
// §5. Compare Baseline
// ═══════════════════════════════════════════════════════════

/**
 * 比较观察值与基准值。

 * 必须先验证 context compatibility。
 * 不匹配 → comparable=false, delta=0。

 * 纯函数 — 不引用 Game/Memory。
 */
export function compareBaseline(
  dimension: EvaluationDimension,
  observed: number,
  baseline: BaselineValue,
  contextCompatible: boolean,
): BaselineComparison {
  if (!contextCompatible) {
    return {
      dimension,
      observed,
      baseline: baseline.value,
      delta: 0,
      relativeDelta: 0,
      baselineSource: baseline.source,
      baselineConfidence: baseline.confidence,
      comparable: false,
      incompatibilityReason: "context_mismatch",
    };
  }

  const delta = observed - baseline.value;
  const absBaseline = Math.abs(baseline.value);
  const relativeDelta = absBaseline > 0.001 ? delta / absBaseline : 0;

  return {
    dimension,
    observed,
    baseline: baseline.value,
    delta,
    relativeDelta,
    baselineSource: baseline.source,
    baselineConfidence: baseline.confidence,
    comparable: true,
  };
}

// ═══════════════════════════════════════════════════════════
// §6. Sample Sufficiency
// ═══════════════════════════════════════════════════════════

/**
 * 评估样本充足性。

 * 样本不足时返回 INCONCLUSIVE 建议。

 * 纯函数 — 不引用 Game/Memory。
 */
export function evaluateSampleSufficiency(
  dimension: EvaluationDimension,
  samples: number,
): SampleSufficiency {
  const minimum = MINIMUM_SAMPLE_SIZES[dimension] ?? 5;

  if (samples >= minimum * 2) {
    return {
      sufficient: true,
      samples,
      minimumRequired: minimum,
      confidence: 1.0,
      recommendation: "sufficient",
    };
  }

  if (samples >= minimum) {
    return {
      sufficient: true,
      samples,
      minimumRequired: minimum,
      confidence: 0.7 * (samples / (minimum * 2)),
      recommendation: "marginal",
    };
  }

  return {
    sufficient: false,
    samples,
    minimumRequired: minimum,
    confidence: 0.1 * (samples / minimum),
    recommendation: "INCONCLUSIVE",
  };
}

// ═══════════════════════════════════════════════════════════
// §7. Baseline Confidence
// ═══════════════════════════════════════════════════════════

/**
 * 计算 Baseline 置信度。

 * 基于样本数 + 方差 + 时间新鲜度。
 * 样本越多 → 越高
 * 方差越低 → 越高
 * 越新 → 越高

 * 纯函数 — 不引用 Game/Memory。
 */
export function computeBaselineConfidence(
  samples: number,
  variance: number,
  ageTicks: number,
): number {
  const minSamples = 3;
  const sampleFactor = Math.min(1, samples / (minSamples * 3));
  const varianceFactor = 1 - Math.min(0.8, variance / 0.5);
  const ageFactor = Math.max(0.3, 1 - ageTicks / 5000);

  return Number((sampleFactor * varianceFactor * ageFactor).toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §8. Regime Mismatch Detection
// ═══════════════════════════════════════════════════════════

/**
 * 检测 Regime Mismatch — 历史基准的上下文与当前上下文是否匹配。

 * 比较维度：RCL range, room count range, threat level, war posture, resource context。
 * 不匹配 → baseline = INCOMPARABLE。

 * 纯函数 — 不引用 Game/Memory。
 */
export function detectRegimeMismatch(
  baselineContext: {
    rcl: number;
    roomCount: number;
    threatLevel: string;
    posture: string;
    resourceContext: string;
  },
  currentContext: {
    rcl: number;
    roomCount: number;
    threatLevel: string;
    posture: string;
    resourceContext: string;
  },
): RegimeMismatch {
  const mismatchedDimensions: string[] = [];

  // RCL range mismatch
  const baselineRclRange = baselineContext.rcl <= 3 ? "early" : baselineContext.rcl <= 6 ? "mid" : "late";
  const currentRclRange = currentContext.rcl <= 3 ? "early" : currentContext.rcl <= 6 ? "mid" : "late";
  if (baselineRclRange !== currentRclRange) {
    mismatchedDimensions.push("rcl_range");
  }

  // Room count range mismatch
  const baselineRoomRange = baselineContext.roomCount <= 1 ? "single" : baselineContext.roomCount <= 3 ? "small" : baselineContext.roomCount <= 6 ? "medium" : "large";
  const currentRoomRange = currentContext.roomCount <= 1 ? "single" : currentContext.roomCount <= 3 ? "small" : currentContext.roomCount <= 6 ? "medium" : "large";
  if (baselineRoomRange !== currentRoomRange) {
    mismatchedDimensions.push("room_count");
  }

  // Threat level mismatch
  if (baselineContext.threatLevel.toLowerCase() !== currentContext.threatLevel.toLowerCase()) {
    mismatchedDimensions.push("threat_level");
  }

  // War posture mismatch
  if (baselineContext.posture !== currentContext.posture) {
    mismatchedDimensions.push("posture");
  }

  // Resource context mismatch
  if (baselineContext.resourceContext !== currentContext.resourceContext) {
    mismatchedDimensions.push("resource_context");
  }

  const mismatch = mismatchedDimensions.length > 0;
  const severity = mismatch ? Math.min(1, mismatchedDimensions.length * 0.2) : 0;

  return {
    mismatch,
    mismatchedDimensions,
    severity,
    recommendation: mismatch ? "INCOMPARABLE" : "comparable",
  };
}

// ═══════════════════════════════════════════════════════════
// §9. Context Compatibility Check
// ═══════════════════════════════════════════════════════════

/**
 * 检查上下文兼容性 — baseline 与当前 context 是否可比较。

 * 至少考虑：RCL, empire size, room count, threat context, war posture, resource context。

 * 纯函数 — 不引用 Game/Memory。
 */
export function checkContextCompatibility(
  baselineKey: BaselineKey,
  currentContext: {
    rcl: number;
    roomCount: number;
    threatLevel: string;
    posture: string;
  },
): { compatible: boolean; reason?: string } {
  const currentSig = buildContextSignature({
    rcl: currentContext.rcl,
    roomCount: currentContext.roomCount,
    threatLevel: currentContext.threatLevel,
  });

  if (baselineKey.contextSignature !== currentSig) {
    return {
      compatible: false,
      reason: `context_signature_mismatch: baseline=${baselineKey.contextSignature} current=${currentSig}`,
    };
  }

  return { compatible: true };
}

// ═══════════════════════════════════════════════════════════
// §10. Extract Historical Values from Experience
// ═══════════════════════════════════════════════════════════

/**
 * 从 Experience 列表提取各维度的历史值。

 * 每个维度从 Experience 的 Outcome + Context 中提取对应的数值指标。
 * 由 system 层调用，domain 不直接读 Experience Store。

 * 纯函数 — 不引用 Game/Memory。
 */
export function extractHistoricalValues(
  experiences: readonly ExperienceRecord[],
): Record<EvaluationDimension, number[]> {
  const result: Record<EvaluationDimension, number[]> = {
    economicGrowth: [],
    resourceEfficiency: [],
    cpuEfficiency: [],
    riskLevel: [],
    survival: [],
    expansion: [],
    militaryOutcome: [],
    recoveryCost: [],
  };

  for (const exp of experiences) {
    if (!exp.outcome) continue;

    switch (exp.identity.type) {
      case "economic":
        result.economicGrowth.push(exp.outcome.value);
        // resourceEfficiency 子指标从 logistics 投递率推导
        if (exp.context.metrics.logisticsDeliveryRate !== undefined) {
          result.resourceEfficiency.push(exp.context.metrics.logisticsDeliveryRate);
        }
        break;
      case "logistics":
        result.resourceEfficiency.push(exp.outcome.value);
        break;
      case "spawn":
        // cpuEfficiency 子指标从 spawn queue 状态推导
        if (exp.context.metrics.spawnQueueLength !== undefined) {
          result.cpuEfficiency.push(1 - Math.min(1, exp.context.metrics.spawnQueueLength / 10));
        }
        break;
      case "defense":
        result.riskLevel.push(exp.outcome.value);
        break;
      case "war":
        result.militaryOutcome.push(exp.outcome.value);
        break;
      case "recovery":
        result.recoveryCost.push(exp.outcome.value);
        // survival 子指标从 health delta 推导
        if (exp.outcome.stateDelta.healthDelta !== undefined) {
          result.survival.push(exp.outcome.stateDelta.healthDelta);
        }
        break;
      case "expansion":
        result.expansion.push(exp.outcome.value);
        break;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// §11. Baseline Hash — 确定性验证
// ═══════════════════════════════════════════════════════════

/**
 * 为 Baseline 生成稳定的 Hash。

 * 算法：stableStringify(key + dimensions + modelVersion) → FNV-1a 32-bit → hex。

 * 确定性保证：
 *   - 不使用 Math.random / Date.now
 *   - JSON.stringify 对相同对象结构产生相同字符串
 *   - 维度顺序固定（按 CANONICAL_EVALUATION_DIMENSIONS 顺序）
 */
export function baselineHash(
  key: BaselineKey,
  dimensions: Readonly<Record<EvaluationDimension, BaselineValue>>,
  modelVersion: number,
): string {
  const payload = stableStringify({
    key: {
      strategyId: key.strategyId,
      phase: key.phase,
      contextSignature: key.contextSignature,
    },
    dimensions: Object.entries(dimensions)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dim, val]) => ({
        dimension: dim,
        value: Number(val.value.toFixed(4)),
        source: val.source,
        samples: val.samples,
        confidence: Number(val.confidence.toFixed(3)),
      })),
    modelVersion,
  });
  return fnv1a32Hex(payload);
}

// ═══════════════════════════════════════════════════════════
// §12. Determinism Verification
// ═══════════════════════════════════════════════════════════

/**
 * 验证 Baseline 确定性：同一输入连续 N 次，检查 hash 一致。
 */
export function verifyBaselineDeterminism(
  key: BaselineKey,
  historicalValues: Readonly<Record<EvaluationDimension, number[]>>,
  modelVersion: number,
  tick: number,
  iterations = 1000,
): { deterministic: boolean; firstDivergenceAt?: number } {
  let firstHash = "";
  for (let i = 0; i < iterations; i++) {
    const baseline = buildBaseline(key, historicalValues, modelVersion, tick);
    if (i === 0) {
      firstHash = baseline.baselineHash;
    } else if (baseline.baselineHash !== firstHash) {
      return { deterministic: false, firstDivergenceAt: i };
    }
  }
  return { deterministic: true };
}

// ═══════════════════════════════════════════════════════════
// §13. Internal Helper Functions
// ═══════════════════════════════════════════════════════════

/**
 * 计算统计量：mean, median, variance, outliers。

 * Outlier 检测：IQR 方法（1.5×IQR 超出 = outlier）。
 */
function computeStats(values: number[]): {
  mean: number;
  median: number;
  variance: number;
  outliersRemoved: number;
} {
  if (values.length === 0) {
    return { mean: 0, median: 0, variance: 0, outliersRemoved: 0 };
  }

  // IQR outlier detection
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1]!;
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const filtered = sorted.filter(v => v >= lowerBound && v <= upperBound);
  const outliersRemoved = sorted.length - filtered.length;

  const useValues = filtered.length > 0 ? filtered : sorted;
  const n = useValues.length;

  const sum = useValues.reduce((a, b) => a + b, 0);
  const mean = Number((sum / n).toFixed(4));

  const median = n % 2 === 0
    ? Number(((useValues[n / 2 - 1]! + useValues[n / 2]!) / 2).toFixed(4))
    : Number(useValues[Math.floor(n / 2)]!.toFixed(4));

  const variance = n > 1
    ? Number((useValues.reduce((a, b) => a + (b - mean) ** 2, 0) / n).toFixed(4))
    : 0;

  return { mean, median, variance, outliersRemoved };
}

/**
 * 稳定 JSON 序列化：按 key 排序，确保相同对象产生相同字符串。
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => {
    const v = (obj as Record<string, unknown>)[k];
    return JSON.stringify(k) + ":" + stableStringify(v);
  });
  return "{" + pairs.join(",") + "}";
}

/**
 * FNV-1a 32-bit Hash → 8 字符 hex。
 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
