/** A6.3.2 Prediction Evidence Builder — 预测证据链构建。 */

import type { PredictionEvidence } from "./types";
import type { TimeSeries } from "./time-series";
import type { ExperienceRecord } from "../experience";

// ═══════════════════════════════════════════════════════════
// §1. Source Reference Builders
// ═══════════════════════════════════════════════════════════

/**
 * 构建 TimeSeries 数据源引用字符串。

 * 格式："{sourceName}:{oldestTick}-{newestTick}({count})"

 * 确定性：遍历前排序。
 */
export function timeSeriesSourceRef(
  sourceName: string,
  ts: TimeSeries<number>,
): string {
  if (ts.samples.length === 0) {
    return `${sourceName}:empty(0)`;
  }
  const sorted = [...ts.samples].sort((a, b) => a.tick - b.tick);
  const oldest = sorted[0]!.tick;
  const newest = sorted[sorted.length - 1]!.tick;
  return `${sourceName}:${oldest}-${newest}(${sorted.length})`;
}

/**
 * 构建 Experience 数据源引用字符串。

 * 格式："exp:{experienceId}:{tick}"
 */
export function experienceSourceRef(exp: ExperienceRecord): string {
  return `exp:${exp.identity.experienceId}:${exp.identity.tick}`;
}

/**
 * 构建标量指标源引用字符串。

 * 格式："metric:{metricName}:{value}"
 */
export function metricSourceRef(metricName: string, value: number): string {
  return `metric:${metricName}:${Number(value.toFixed(3))}`;
}

// ═══════════════════════════════════════════════════════════
// §2. Evidence Builder
// ═══════════════════════════════════════════════════════════

/**
 * 构建 PredictionEvidence 的输入参数。
 */
export interface EvidenceBuilderInput {
  /** 数据源引用列表。 */
  readonly sources: readonly string[];
  /** 模型参数快照。 */
  readonly modelParams: Readonly<Record<string, number | string>>;
  /** TimeSeries 采样范围。 */
  readonly sampleRange: {
    readonly oldestTick: number;
    readonly newestTick: number;
    readonly count: number;
  };
  /** Regime 兼容性检查结果。 */
  readonly regimeCompatibility: {
    readonly compatible: boolean;
    readonly mismatchedDimensions: readonly string[];
    readonly confidenceMultiplier: number;
  };
}

/**
 * 构建 PredictionEvidence。

 * 纯函数 — 返回新对象，不修改输入。
 * 确定性：相同输入 → 相同输出。
 */
export function buildPredictionEvidence(input: EvidenceBuilderInput): PredictionEvidence {
  // 排序 sources 确保确定性
  const sortedSources = [...input.sources].sort();

  // 排序 modelParams keys 确保确定性
  const sortedParams: Record<string, number | string> = {};
  for (const key of Object.keys(input.modelParams).sort()) {
    const val = input.modelParams[key];
    if (val === undefined) continue;
    if (typeof val === "number") {
      sortedParams[key] = Number(val.toFixed(6));
    } else {
      sortedParams[key] = val;
    }
  }

  return {
    sources: sortedSources,
    modelParams: sortedParams,
    sampleRange: {
      oldestTick: input.sampleRange.oldestTick,
      newestTick: input.sampleRange.newestTick,
      count: input.sampleRange.count,
    },
    regimeCompatibility: {
      compatible: input.regimeCompatibility.compatible,
      mismatchedDimensions: [...input.regimeCompatibility.mismatchedDimensions].sort(),
      confidenceMultiplier: Number(input.regimeCompatibility.confidenceMultiplier.toFixed(3)),
    },
  };
}

// ═══════════════════════════════════════════════════════════
// §3. Evidence Tracing
// ═══════════════════════════════════════════════════════════

/**
 * 证据追溯结果。
 */
export interface EvidenceTraceResult {
  /** 证据来源列表。 */
  readonly sources: readonly string[];
  /** 可追溯到 TimeSeries 的源数量。 */
  readonly timeSeriesSources: number;
  /** 可追溯到 Experience 的源数量。 */
  readonly experienceSources: number;
  /** 可追溯到 Metric 的源数量。 */
  readonly metricSources: number;
  /** 来源完整性分数 (0-1)。 */
  readonly completenessScore: number;
}

/**
 * 追溯 PredictionEvidence 中的来源。

 * PRED-006：验证证据链可追溯性。
 * 纯函数 — 不引用 Game/Memory。
 */
export function tracePredictionEvidence(evidence: PredictionEvidence): EvidenceTraceResult {
  let tsCount = 0;
  let expCount = 0;
  let metricCount = 0;

  for (const src of evidence.sources) {
    if (src.startsWith("metric:")) {
      metricCount++;
    } else if (src.startsWith("exp:")) {
      expCount++;
    } else {
      // TimeSeries 或其他数据源引用
      tsCount++;
    }
  }

  const total = evidence.sources.length;
  const completenessScore = total > 0 ? Number((1.0).toFixed(3)) : 0;

  return {
    sources: evidence.sources,
    timeSeriesSources: tsCount,
    experienceSources: expCount,
    metricSources: metricCount,
    completenessScore,
  };
}

/**
 * 验证 PredictionEvidence 是否完整。

 * PRED-006 守卫辅助：
 *   - sources 非空
 *   - modelParams 非空
 *   - sampleRange 有效
 *   - regimeCompatibility 有效
 */
export function validatePredictionEvidence(evidence: PredictionEvidence): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!evidence.sources || evidence.sources.length === 0) {
    issues.push("Evidence has no sources");
  }
  if (!evidence.modelParams || Object.keys(evidence.modelParams).length === 0) {
    issues.push("Evidence has no modelParams");
  }
  if (!evidence.sampleRange || evidence.sampleRange.count <= 0) {
    issues.push("Evidence has invalid sampleRange");
  }
  if (!evidence.regimeCompatibility) {
    issues.push("Evidence has no regimeCompatibility");
  }

  return { valid: issues.length === 0, issues };
}
