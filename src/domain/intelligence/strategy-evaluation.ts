/** A6.2 Strategy Evaluation Domain — 纯函数与类型定义。 */

import type { ExperienceRecord, Attribution, OutcomeRecord } from "./experience";
import type { Baseline, BaselineComparison, BaselineKey } from "./baseline";

// ═══════════════════════════════════════════════════════════
// §1. Canonical Evaluation Dimensions
// ═══════════════════════════════════════════════════════════

/**
 * CANONICAL_EVALUATION_DIMENSIONS — 策略评估的 8 个独立维度。

 * 权威来源：A6_0_STRATEGY_EVALUATION.md §2.2 + §2.3
 * 仲裁文档：A6_2_CONTRACT_RESOLUTION.md

 * 绝对禁止：
 *   - 不同模块使用不同维度集合
 *   - 将多维合并为单一万能分数
 *   - 使用此列表之外的维度名称
 */
export const CANONICAL_EVALUATION_DIMENSIONS = [
  "economicGrowth",
  "resourceEfficiency",
  "cpuEfficiency",
  "riskLevel",
  "survival",
  "expansion",
  "militaryOutcome",
  "recoveryCost",
] as const;

export type EvaluationDimension = (typeof CANONICAL_EVALUATION_DIMENSIONS)[number];

// ═══════════════════════════════════════════════════════════
// §2. Evaluation Types
// ═══════════════════════════════════════════════════════════

/** 证据类型 — 区分观察事实、归因结论、推导判断。 */
export type EvidenceType =
  | "OBSERVED"     // 直接观察到的结果
  | "ATTRIBUTED"  // 已经经过 A6.1 归因
  | "INFERRED";   // Evaluation 根据证据推导出的判断

/** 评估判定。 */
export type EvaluationVerdict =
  | "IMPROVING"
  | "STABLE"
  | "DEGRADING"
  | "INCONCLUSIVE"
  | "CONFLICTING_TREND";

/** 评估时间窗口 — 显式对象，禁止 currentTick - arbitrary history。 */
export interface EvaluationWindow {
  /** 窗口起始 tick。 */
  readonly startTick: number;
  /** 窗口结束 tick。 */
  readonly endTick: number;
  /** 窗口持续 tick 数。 */
  readonly duration: number;
  /** 窗口类型。 */
  readonly type: WindowType;
}

/** 窗口类型 — A6.0 定义。 */
export type WindowType =
  | "short_term"    // 短期窗口（~500 tick）
  | "medium_term"   // 中期窗口（~2000 tick）
  | "long_term";    // 长期窗口（~10000 tick）

/** 单维度评分。 */
export interface DimensionScore {
  /** 维度名。 */
  readonly dimension: EvaluationDimension;
  /** 观察值。 */
  readonly observed: number;
  /** 基准值。 */
  readonly baseline: number;
  /** 与基准的偏差（observed - baseline）。 */
  readonly delta: number;
  /** 相对变化率。 */
  readonly relativeDelta: number;
  /** 量化指标名。 */
  readonly metric: string;
  /** 样本数。 */
  readonly samples: number;
  /** 置信度（0-1）。 */
  readonly confidence: number;
  /** 基准来源。 */
  readonly baselineSource: string;
  /** 基准比较是否有效。 */
  readonly comparable: boolean;
  /** 证据类型。 */
  readonly evidenceType: EvidenceType;
  /** 证据 ID 列表（可追溯到 Experience / Attribution）。 */
  readonly evidenceIds: readonly string[];
  /** Attribution 置信度（纳入 Evaluation Confidence）。 */
  readonly attributionConfidence: number;
  /** 趋势（基于时间窗口内的变化方向）。 */
  readonly trend: TrendDirection;
  /** 不可比较的原因（comparable=false 时有值）。 */
  readonly incompatibilityReason?: string;
}

/** 趋势方向。 */
export type TrendDirection = "up" | "down" | "flat" | "unknown";

/** StrategyScore — 多维评分结果（禁止合并为总分）。 */
export interface StrategyScore {
  /** 评估的策略类型。 */
  readonly strategyType: string;
  /** 评估时间窗口。 */
  readonly window: EvaluationWindow;
  /** 样本总数。 */
  readonly samples: number;
  /** 各维度评分（独立，不合并为总分）。 */
  readonly dimensions: Readonly<Record<EvaluationDimension, DimensionScore>>;
  /** 评估时间 tick。 */
  readonly evaluatedAt: number;
  /** 模型版本。 */
  readonly modelVersion: number;
  /** 整体置信度（各维度最低置信度，非"总分"）。 */
  readonly confidence: number;
  /** 整体判定。 */
  readonly verdict: EvaluationVerdict;
  /** 评估 Hash（确定性验证）。 */
  readonly evaluationHash: string;
  /** Informational aggregate indicator（仅参考，无决策权）。 */
  readonly informationalScore: number;
}

/** Evaluation Finding — 单条评估发现。 */
export interface EvaluationFinding {
  /** 发现 ID。 */
  readonly findingId: string;
  /** 关联的维度。 */
  readonly dimension: EvaluationDimension;
  /** 发现描述。 */
  readonly description: string;
  /** 证据类型。 */
  readonly evidenceType: EvidenceType;
  /** 置信度。 */
  readonly confidence: number;
  /** 证据 ID 列表。 */
  readonly evidenceIds: readonly string[];
  /** 是否外部因素干扰。 */
  readonly hasExternalFactor: boolean;
  /** 外部因素描述。 */
  readonly externalFactorDescription?: string;
}

/** Recommendation Candidate — Shadow Output（不自动执行）。 */
export interface RecommendationCandidate {
  /** 建议 ID。 */
  readonly recommendationId: string;
  /** 关联的维度。 */
  readonly dimension: EvaluationDimension;
  /** 建议描述。 */
  readonly description: string;
  /** 建议理由。 */
  readonly rationale: string;
  /** 置信度。 */
  readonly confidence: number;
  /** 是否 shadow-only（始终 true）。 */
  readonly shadowOnly: true;
  /** 绝对禁止自动执行。 */
  readonly autoApply: false;
}

/** Evaluation Result — 完整评估结果。 */
export interface StrategyEvaluation {
  /** 评估的 StrategyScore。 */
  readonly score: StrategyScore;
  /** 评估发现列表。 */
  readonly findings: readonly EvaluationFinding[];
  /** 建议 Shadow Output。 */
  readonly recommendations: readonly RecommendationCandidate[];
  /** 使用的 Baseline。 */
  readonly baseline: Baseline;
  /** 评估 Hash。 */
  readonly evaluationHash: string;
  /** 评估时间 tick。 */
  readonly tick: number;
  /** 模型版本。 */
  readonly modelVersion: number;
}

// ═══════════════════════════════════════════════════════════
// §3. Evaluation Input DTO
// ═══════════════════════════════════════════════════════════

/**
 * EvaluationInput — 纯 DTO，由 system 层组装注入。

 * Domain 不自行读取 Runtime State。
 */
export interface EvaluationInput {
  /** 策略类型（ExperienceType 映射）。 */
  readonly strategyType: string;
  /** 评估时间窗口。 */
  readonly window: EvaluationWindow;
  /** 评估窗口内的 Experience 列表。 */
  readonly experiences: readonly ExperienceRecord[];
  /** 已采集的 Outcome 列表。 */
  readonly outcomes: readonly OutcomeRecord[];
  /** 已采集的 Attribution 列表。 */
  readonly attributions: readonly Attribution[];
  /** 指标快照（各维度的当前观察值）。 */
  readonly metrics: MetricSnapshot;
  /** Baseline（由 system 层从 buildBaseline 获取）。 */
  readonly baseline: Baseline;
  /** BaselineKey。 */
  readonly baselineKey: BaselineKey;
  /** 当前上下文（用于 context compatibility check）。 */
  readonly currentContext: ContextInfo;
  /** 模型版本。 */
  readonly modelVersion: number;
  /** 当前 tick。 */
  readonly tick: number;
}

/** MetricSnapshot — 各维度的当前观察值。 */
export interface MetricSnapshot {
  /** 经济增长率（empireHealth.energyScore delta）。 */
  readonly economicGrowth: number;
  /** 资源利用效率（deliveryRate）。 */
  readonly resourceEfficiency: number;
  /** CPU 效率（cpu/产出比 → 归一化 0-1）。 */
  readonly cpuEfficiency: number;
  /** 风险水平（threat score, 越低越好 → 归一化）。 */
  readonly riskLevel: number;
  /** 生存能力（empireHealth score）。 */
  readonly survival: number;
  /** 扩张效果（success rate）。 */
  readonly expansion: number;
  /** 军事结果（war win rate）。 */
  readonly militaryOutcome: number;
  /** 恢复代价（recovery success rate）。 */
  readonly recoveryCost: number;
  /** 外部能量注入量（用于 attribution 校正）。 */
  readonly externalEnergyInflow?: number;
}

/** ContextInfo — 当前上下文摘要。 */
export interface ContextInfo {
  /** RCL。 */
  readonly rcl: number;
  /** 房间数。 */
  readonly roomCount: number;
  /** 威胁等级。 */
  readonly threatLevel: string;
  /** 帝国姿态。 */
  readonly posture: string;
  /** 资源上下文。 */
  readonly resourceContext: string;
}

// ═══════════════════════════════════════════════════════════
// §4. Evaluate Strategy (main entry point)
// ═══════════════════════════════════════════════════════════

/**
 * 评估策略效果 — 主入口函数。

 * 8 维独立计算，每维产出 DimensionScore。
 * 消费 A6.1 Attribution，不重新实现归因。

 * 纯函数 — 不引用 Game/Memory。
 */
export function evaluateStrategy(input: EvaluationInput): StrategyEvaluation {
  // ── 1. 检查 context compatibility ──
  const compatibility = checkContextCompatibility(input.baselineKey, input.currentContext);

  // ── 2. 评估每个维度 ──
  const dimensions = {} as Record<EvaluationDimension, DimensionScore>;
  for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
    dimensions[dim] = evaluateDimension(dim, input, compatibility.compatible, compatibility.reason);
  }

  // ── 3. 计算整体置信度（各维度最低值，非"总分"）──
  const confidences = CANONICAL_EVALUATION_DIMENSIONS.map(d => dimensions[d].confidence);
  const overallConfidence = Math.min(...confidences);

  // ── 4. 计算趋势和 verdict ──
  const trend = computeOverallTrend(dimensions);
  const verdict = computeVerdict(dimensions, trend, input);

  // ── 5. 计算 informational score（仅参考，无决策权）──
  const informationalScore = computeInformationalScore(dimensions);

  // ── 6. 构建 StrategyScore ──
  const score: StrategyScore = {
    strategyType: input.strategyType,
    window: input.window,
    samples: input.experiences.length,
    dimensions,
    evaluatedAt: input.tick,
    modelVersion: input.modelVersion,
    confidence: overallConfidence,
    verdict,
    evaluationHash: "",
    informationalScore,
  };

  // ── 7. 生成 findings ──
  const findings = generateFindings(dimensions, input);

  // ── 8. 生成 shadow recommendations ──
  const recommendations = generateRecommendations(dimensions, input);

  // ── 9. 计算 hash ──
  const hash = evaluationHash(score, findings, input.modelVersion);
  const finalScore = { ...score, evaluationHash: hash };

  return {
    score: finalScore,
    findings,
    recommendations,
    baseline: input.baseline,
    evaluationHash: hash,
    tick: input.tick,
    modelVersion: input.modelVersion,
  };
}

// ═══════════════════════════════════════════════════════════
// §5. Dimension Evaluation
// ═══════════════════════════════════════════════════════════

/**
 * 评估单个维度。

 * 纯函数 — 不引用 Game/Memory。
 */
function evaluateDimension(
  dim: EvaluationDimension,
  input: EvaluationInput,
  contextCompatible: boolean,
  incompatibilityReason?: string,
): DimensionScore {
  const observed = getMetricValue(dim, input.metrics);
  const baselineVal = input.baseline.dimensions[dim];

  // 不可比较时
  if (!contextCompatible) {
    return {
      dimension: dim,
      observed,
      baseline: baselineVal.value,
      delta: 0,
      relativeDelta: 0,
      metric: getMetricName(dim),
      samples: countRelevantExperiences(dim, input.experiences),
      confidence: 0,
      baselineSource: baselineVal.source,
      comparable: false,
      evidenceType: "INFERRED",
      evidenceIds: [],
      attributionConfidence: 0,
      trend: "unknown",
      incompatibilityReason,
    };
  }

  const delta = observed - baselineVal.value;
  const absBaseline = Math.abs(baselineVal.value);
  const relativeDelta = absBaseline > 0.001 ? delta / absBaseline : 0;

  // 样本充足性
  const sampleCount = countRelevantExperiences(dim, input.experiences);
  const minSamples = getMinSampleSize(dim);

  // Attribution 置信度（纳入 Evaluation Confidence）
  const attributionConfidence = getAttributionConfidence(dim, input);

  // 样本不足 → 低置信度
  const sampleConfidence = Math.min(1, sampleCount / (minSamples * 2));

  // 外部因素检测
  const hasExternalFactor = detectExternalFactor(dim, input);
  const externalFactorPenalty = hasExternalFactor ? 0.3 : 0;

  // 综合置信度
  const confidence = Number(Math.min(
    1,
    baselineVal.confidence * 0.4 + sampleConfidence * 0.3 + attributionConfidence * 0.3 - externalFactorPenalty,
  ).toFixed(3));

  // 证据类型
  const evidenceType: EvidenceType = sampleCount > 0 ? "ATTRIBUTED" : "OBSERVED";

  // 证据 ID 列表
  const evidenceIds = collectEvidenceIds(dim, input);

  // 趋势
  const trend = computeTrend(dim, input);

  return {
    dimension: dim,
    observed,
    baseline: baselineVal.value,
    delta,
    relativeDelta,
    metric: getMetricName(dim),
    samples: sampleCount,
    confidence,
    baselineSource: baselineVal.source,
    comparable: true,
    evidenceType,
    evidenceIds,
    attributionConfidence,
    trend,
  };
}

// ═══════════════════════════════════════════════════════════
// §6. Verdict Computation
// ═══════════════════════════════════════════════════════════

/**
 * 计算整体 verdict。

 * 规则：
 *   - 任何维度 INCONCLUSIVE → INCONCLUSIVE（样本不足优先）
 *   - short-term 和 long-term 趋势冲突 → CONFLICTING_TREND
 *   - 多数维度 delta > 阈值 → IMPROVING
 *   - 多数维度 delta < -阈值 → DEGRADING
 *   - 其余 → STABLE

 * 纯函数 — 不引用 Game/Memory。
 */
function computeVerdict(
  dimensions: Readonly<Record<EvaluationDimension, DimensionScore>>,
  trend: { shortTerm: TrendDirection; longTerm: TrendDirection },
  input: EvaluationInput,
): EvaluationVerdict {
  // 样本不足 → INCONCLUSIVE
  const anyInconclusive = CANONICAL_EVALUATION_DIMENSIONS.some(d => {
    const dim = dimensions[d];
    return !dim.comparable || dim.samples < getMinSampleSize(d);
  });
  if (anyInconclusive) {
    return "INCONCLUSIVE";
  }

  // 不可比较 → INCONCLUSIVE
  const anyIncomparable = CANONICAL_EVALUATION_DIMENSIONS.some(d => !dimensions[d].comparable);
  if (anyIncomparable) {
    return "INCONCLUSIVE";
  }

  // 趋势冲突 → CONFLICTING_TREND
  if (trend.shortTerm === "up" && trend.longTerm === "down") {
    return "CONFLICTING_TREND";
  }
  if (trend.shortTerm === "down" && trend.longTerm === "up") {
    return "CONFLICTING_TREND";
  }

  // 统计改善/恶化维度数
  const threshold = 0.05;
  let improving = 0;
  let degrading = 0;
  let stable = 0;

  for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
    const score = dimensions[dim];
    if (!score.comparable) continue;
    if (score.relativeDelta > threshold) {
      improving++;
    } else if (score.relativeDelta < -threshold) {
      degrading++;
    } else {
      stable++;
    }
  }

  if (degrading > improving && degrading > stable) {
    return "DEGRADING";
  }
  if (improving > degrading && improving > stable) {
    return "IMPROVING";
  }
  return "STABLE";
}

// ═══════════════════════════════════════════════════════════
// §7. Trend Computation
// ═══════════════════════════════════════════════════════════

/**
 * 计算整体趋势（短期 + 长期）。
 */
function computeOverallTrend(dimensions: Readonly<Record<EvaluationDimension, DimensionScore>>): {
  shortTerm: TrendDirection;
  longTerm: TrendDirection;
} {
  // 简化：以维度趋势的多数投票作为整体趋势
  const trends = CANONICAL_EVALUATION_DIMENSIONS.map(d => dimensions[d].trend);
  const upCount = trends.filter(t => t === "up").length;
  const downCount = trends.filter(t => t === "down").length;

  let shortTerm: TrendDirection;
  if (upCount > downCount && upCount > trends.length / 2) {
    shortTerm = "up";
  } else if (downCount > upCount && downCount > trends.length / 2) {
    shortTerm = "down";
  } else {
    shortTerm = "flat";
  }

  // 长期趋势当前与短期相同（A6.2 只有一个窗口类型实现）
  // A6.0 定义的窗口类型中 long_term 标注为 deferred
  const longTerm: TrendDirection = shortTerm;

  return { shortTerm, longTerm };
}

/**
 * 计算单维度趋势。

 * 基于窗口内的 Experience 值序列变化方向。
 */
function computeTrend(
  dim: EvaluationDimension,
  input: EvaluationInput,
): TrendDirection {
  const values = getDimensionValues(dim, input.experiences);
  if (values.length < 2) return "unknown";

  // 简单线性趋势：前半段 vs 后半段
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);

  if (firstHalf.length === 0 || secondHalf.length === 0) return "unknown";

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  const threshold = 0.05;
  const diff = secondAvg - firstAvg;

  if (diff > threshold) return "up";
  if (diff < -threshold) return "down";
  return "flat";
}

// ═══════════════════════════════════════════════════════════
// §8. Informational Score
// ═══════════════════════════════════════════════════════════

/**
 * 计算 Informational Aggregate Score。

 * 明确标注：informational only，无决策权。
 * 禁止用于 if score > X then strategy good。
 */
function computeInformationalScore(
  dimensions: Readonly<Record<EvaluationDimension, DimensionScore>>,
): number {
  // 简单加权平均（仅参考）
  const weights: Partial<Record<EvaluationDimension, number>> = {
    economicGrowth: 0.2,
    resourceEfficiency: 0.15,
    cpuEfficiency: 0.1,
    riskLevel: 0.1,
    survival: 0.15,
    expansion: 0.1,
    militaryOutcome: 0.1,
    recoveryCost: 0.1,
  };

  let sum = 0;
  let weightSum = 0;
  for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
    const w = weights[dim] ?? 0.1;
    const score = dimensions[dim];
    if (score.comparable) {
      // 归一化 observed 到 0-1（大部分指标已经在 0-1 范围）
      const normalized = Math.max(0, Math.min(1, score.observed));
      sum += normalized * w;
      weightSum += w;
    }
  }

  return weightSum > 0 ? Number((sum / weightSum).toFixed(3)) : 0;
}

// ═══════════════════════════════════════════════════════════
// §9. Findings Generation
// ═══════════════════════════════════════════════════════════

/**
 * 生成评估发现 — 每条发现可追溯到 Experience / Attribution / Metric。

 * 禁止 score = 0.72 但不知道为什么。
 */
function generateFindings(
  dimensions: Readonly<Record<EvaluationDimension, DimensionScore>>,
  input: EvaluationInput,
): EvaluationFinding[] {
  const findings: EvaluationFinding[] = [];

  for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
    const score = dimensions[dim];

    // 不可比较的维度
    if (!score.comparable) {
      findings.push({
        findingId: `F-${dim}-incomparable`,
        dimension: dim,
        description: `Dimension ${dim} is incomparable due to ${score.incompatibilityReason ?? "context mismatch"}`,
        evidenceType: "INFERRED",
        confidence: 0,
        evidenceIds: [],
        hasExternalFactor: false,
      });
      continue;
    }

    // 样本不足
    if (score.samples < getMinSampleSize(dim)) {
      findings.push({
        findingId: `F-${dim}-insufficient`,
        dimension: dim,
        description: `Dimension ${dim} has insufficient samples (${score.samples}/${getMinSampleSize(dim)} required)`,
        evidenceType: "OBSERVED",
        confidence: score.confidence,
        evidenceIds: score.evidenceIds,
        hasExternalFactor: false,
      });
      continue;
    }

    // 显著改善
    if (score.relativeDelta > 0.1) {
      findings.push({
        findingId: `F-${dim}-improving`,
        dimension: dim,
        description: `Dimension ${dim} is improving: observed=${score.observed.toFixed(3)} baseline=${score.baseline.toFixed(3)} delta=${score.delta.toFixed(3)}`,
        evidenceType: score.evidenceType,
        confidence: score.confidence,
        evidenceIds: score.evidenceIds,
        hasExternalFactor: detectExternalFactor(dim, input),
        externalFactorDescription: detectExternalFactor(dim, input)
          ? "External energy inflow detected, attribution confidence reduced"
          : undefined,
      });
      continue;
    }

    // 显著恶化
    if (score.relativeDelta < -0.1) {
      findings.push({
        findingId: `F-${dim}-degrading`,
        dimension: dim,
        description: `Dimension ${dim} is degrading: observed=${score.observed.toFixed(3)} baseline=${score.baseline.toFixed(3)} delta=${score.delta.toFixed(3)}`,
        evidenceType: score.evidenceType,
        confidence: score.confidence,
        evidenceIds: score.evidenceIds,
        hasExternalFactor: detectExternalFactor(dim, input),
        externalFactorDescription: detectExternalFactor(dim, input)
          ? "External energy inflow detected, results may not be fully attributable to strategy"
          : undefined,
      });
    }
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════
// §10. Recommendation Generation (Shadow Only)
// ═══════════════════════════════════════════════════════════

/**
 * 生成 Shadow Recommendation — 不自动执行。

 * Recommendation 始终 shadowOnly=true, autoApply=false。
 */
function generateRecommendations(
  dimensions: Readonly<Record<EvaluationDimension, DimensionScore>>,
  input: EvaluationInput,
): RecommendationCandidate[] {
  const recs: RecommendationCandidate[] = [];

  for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
    const score = dimensions[dim];
    if (!score.comparable) continue;
    if (score.samples < getMinSampleSize(dim)) continue;

    if (score.relativeDelta < -0.15) {
      recs.push({
        recommendationId: `R-${dim}-below-baseline`,
        dimension: dim,
        description: `Dimension ${dim} is consistently below baseline`,
        rationale: `observed=${score.observed.toFixed(3)} vs baseline=${score.baseline.toFixed(3)}, delta=${score.delta.toFixed(3)}, confidence=${score.confidence.toFixed(2)}`,
        confidence: score.confidence,
        shadowOnly: true,
        autoApply: false,
      });
    }
  }

  return recs;
}

// ═══════════════════════════════════════════════════════════
// §11. External Factor Detection
// ═══════════════════════════════════════════════════════════

/**
 * 检测外部因素干扰。

 * 例如：策略表现好但 externalEnergyInflow > 0 → 不能全归功于策略。
 */
function detectExternalFactor(
  dim: EvaluationDimension,
  input: EvaluationInput,
): boolean {
  // 外部能量注入检测
  if (dim === "economicGrowth" || dim === "resourceEfficiency") {
    if (input.metrics.externalEnergyInflow && input.metrics.externalEnergyInflow > 0) {
      return true;
    }
  }

  // 检查 Attribution 是否有外部因素
  for (const attr of input.attributions) {
    if (attr.externalFactors.length > 0) {
      return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════
// §12. Attribution Confidence
// ═══════════════════════════════════════════════════════════

/**
 * 获取维度相关的 Attribution 置信度。

 * Evaluation 必须消费 Attribution，并把 Attribution Confidence 纳入 Evaluation Confidence。
 */
function getAttributionConfidence(
  dim: EvaluationDimension,
  input: EvaluationInput,
): number {
  const relevantType = dimensionToExperienceType(dim);
  const relevant = input.attributions.filter(
    a => input.experiences.some(e =>
      e.identity.type === relevantType && e.attribution === a,
    ),
  );

  if (relevant.length === 0) return 0.3;
  const avgConfidence = relevant.reduce((sum, a) => sum + a.confidence, 0) / relevant.length;
  return Number(avgConfidence.toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §13. Evidence ID Collection
// ═══════════════════════════════════════════════════════════

/**
 * 收集维度相关的证据 ID 列表。

 * 每个结论必须能追溯到 Experience / Outcome / Attribution。
 */
function collectEvidenceIds(
  dim: EvaluationDimension,
  input: EvaluationInput,
): string[] {
  const relevantType = dimensionToExperienceType(dim);
  const ids: string[] = [];

  for (const exp of input.experiences) {
    if (exp.identity.type === relevantType) {
      ids.push(exp.identity.experienceId);
      if (exp.attribution) {
        ids.push(exp.attribution.attributionHash);
      }
    }
  }

  return ids;
}

// ═══════════════════════════════════════════════════════════
// §14. Helper Functions
// ═══════════════════════════════════════════════════════════

function getMetricValue(dim: EvaluationDimension, metrics: MetricSnapshot): number {
  return metrics[dim] ?? 0;
}

function getMetricName(dim: EvaluationDimension): string {
  const names: Record<EvaluationDimension, string> = {
    economicGrowth: "empireHealth.energyScoreDelta",
    resourceEfficiency: "deliveryRate",
    cpuEfficiency: "cpuEfficiencyRatio",
    riskLevel: "threatScore",
    survival: "empireHealthScore",
    expansion: "expansionSuccessRate",
    militaryOutcome: "warWinRate",
    recoveryCost: "recoverySuccessRate",
  };
  return names[dim];
}

function getMinSampleSize(dim: EvaluationDimension): number {
  const sizes: Record<EvaluationDimension, number> = {
    economicGrowth: 5,
    resourceEfficiency: 5,
    cpuEfficiency: 10,
    riskLevel: 3,
    survival: 3,
    expansion: 2,
    militaryOutcome: 3,
    recoveryCost: 3,
  };
  return sizes[dim];
}

function dimensionToExperienceType(dim: EvaluationDimension): string {
  const map: Record<EvaluationDimension, string> = {
    economicGrowth: "economic",
    resourceEfficiency: "logistics",
    cpuEfficiency: "spawn",
    riskLevel: "defense",
    survival: "recovery",
    expansion: "expansion",
    militaryOutcome: "war",
    recoveryCost: "recovery",
  };
  return map[dim];
}

function countRelevantExperiences(
  dim: EvaluationDimension,
  experiences: readonly ExperienceRecord[],
): number {
  const relevantType = dimensionToExperienceType(dim);
  return experiences.filter(e => e.identity.type === relevantType && e.outcome !== undefined).length;
}

function getDimensionValues(
  dim: EvaluationDimension,
  experiences: readonly ExperienceRecord[],
): number[] {
  const relevantType = dimensionToExperienceType(dim);
  const values: number[] = [];
  for (const exp of experiences) {
    if (exp.identity.type === relevantType && exp.outcome) {
      values.push(exp.outcome.value);
    }
  }
  return values;
}

// ═══════════════════════════════════════════════════════════
// §15. Context Compatibility Check
// ═══════════════════════════════════════════════════════════

/**
 * 检查上下文兼容性 — baseline 与当前 context 是否可比较。
 */
function checkContextCompatibility(
  baselineKey: BaselineKey,
  currentContext: ContextInfo,
): { compatible: boolean; reason?: string } {
  // 构建 context signature
  const rclRange = currentContext.rcl <= 3 ? "early" : currentContext.rcl <= 6 ? "mid" : "late";
  const roomRange = currentContext.roomCount <= 1 ? "single" : currentContext.roomCount <= 3 ? "small" : currentContext.roomCount <= 6 ? "medium" : "large";
  const threat = currentContext.threatLevel.toLowerCase();
  const currentSig = `${rclRange}-${roomRange}-${threat}`;

  if (baselineKey.contextSignature !== currentSig) {
    return {
      compatible: false,
      reason: `context_signature_mismatch: baseline=${baselineKey.contextSignature} current=${currentSig}`,
    };
  }

  return { compatible: true };
}

// ═══════════════════════════════════════════════════════════
// §16. Evaluation Hash — 确定性验证
// ═══════════════════════════════════════════════════════════

/**
 * 为 Evaluation 生成稳定的 Hash。

 * 算法：stableStringify(score + findings + modelVersion) → FNV-1a 32-bit → hex。

 * 确定性保证：
 *   - 不使用 Math.random / Date.now
 *   - 维度顺序固定
 *   - 数值精度固定（toFixed）
 */
export function evaluationHash(
  score: StrategyScore,
  findings: readonly EvaluationFinding[],
  modelVersion: number,
): string {
  const payload = stableStringify({
    strategyType: score.strategyType,
    window: {
      startTick: score.window.startTick,
      endTick: score.window.endTick,
      duration: score.window.duration,
      type: score.window.type,
    },
    samples: score.samples,
    dimensions: CANONICAL_EVALUATION_DIMENSIONS.map(dim => {
      const d = score.dimensions[dim];
      return {
        dimension: dim,
        observed: Number(d.observed.toFixed(4)),
        baseline: Number(d.baseline.toFixed(4)),
        delta: Number(d.delta.toFixed(4)),
        relativeDelta: Number(d.relativeDelta.toFixed(4)),
        confidence: Number(d.confidence.toFixed(3)),
        comparable: d.comparable,
        evidenceType: d.evidenceType,
        trend: d.trend,
      };
    }),
    verdict: score.verdict,
    confidence: Number(score.confidence.toFixed(3)),
    informationalScore: Number(score.informationalScore.toFixed(3)),
    findings: findings.map(f => ({
      findingId: f.findingId,
      dimension: f.dimension,
      evidenceType: f.evidenceType,
      confidence: Number(f.confidence.toFixed(3)),
      hasExternalFactor: f.hasExternalFactor,
    })),
    modelVersion,
  });
  return fnv1a32Hex(payload);
}

// ═══════════════════════════════════════════════════════════
// §17. Determinism Verification
// ═══════════════════════════════════════════════════════════

/**
 * 验证 Evaluation 确定性：同一输入连续 N 次，检查 hash 一致。
 */
export function verifyEvaluationDeterminism(
  input: EvaluationInput,
  iterations = 1000,
): { deterministic: boolean; firstDivergenceAt?: number } {
  let firstHash = "";
  for (let i = 0; i < iterations; i++) {
    const result = evaluateStrategy(input);
    if (i === 0) {
      firstHash = result.evaluationHash;
    } else if (result.evaluationHash !== firstHash) {
      return { deterministic: false, firstDivergenceAt: i };
    }
  }
  return { deterministic: true };
}

// ═══════════════════════════════════════════════════════════
// §18. Internal Utility Functions
// ═══════════════════════════════════════════════════════════

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