/**
 * A6.5 Uncertainty Aggregation — 不确定性聚合。
 *
 * 职责：
 *   - 从 Regime Fit / Drift / Conflict / Data Sufficiency 聚合不确定性来源
 *   - 识别主要不确定性来源
 *
 * REL-012 (No Reliability Score)：
 *   禁止 uncertaintyScore: number。
 *   不确定性是分类标签 + 描述，不是单一值。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 */

import type {
  UncertaintySource,
  UncertaintySummary,
  DataSufficiencySummary,
  FreshnessSummary,
} from "./types";
import type { PredictionConflict } from "./types";
import type { RegimeFitSummary } from "./types";
import type { CalibrationHealthSummary } from "./types";

/**
 * 聚合不确定性。
 *
 * 纯函数 — 从各维度的评估结果聚合。
 */
export function aggregateUncertainty(
  dataSufficiency: DataSufficiencySummary,
  regimeFit: RegimeFitSummary,
  calibrationHealth: CalibrationHealthSummary,
  conflicts: readonly PredictionConflict[],
  freshness: FreshnessSummary,
): UncertaintySummary {
  const sources: UncertaintySource[] = [];

  // ── 1. Epistemic: 数据不足 ──
  if (!dataSufficiency.sufficient) {
    sources.push({
      type: "epistemic",
      description: `Insufficient data: ${dataSufficiency.insufficientDimensions.length} model(s) below threshold`,
      severity: 0.8,
    });
  }

  if (dataSufficiency.totalResolutions === 0) {
    sources.push({
      type: "epistemic",
      description: "Cold start: no resolution data available",
      severity: 1.0,
    });
  }

  // ── 2. Systematic: 模型冲突 ──
  if (conflicts.length > 0) {
    const maxSeverity = Math.max(...conflicts.map(c => c.severity));
    sources.push({
      type: "systematic",
      description: `${conflicts.length} prediction conflict(s) detected`,
      severity: Number(maxSeverity.toFixed(6)),
    });
  }

  // ── 3. Distributional: Regime 不匹配 ──
  if (!regimeFit.currentRegimeMatched) {
    const mismatchedModels = regimeFit.modelRegimeFit.filter(
      e => !e.regimeMatched && e.profileSource !== "NONE",
    );
    if (mismatchedModels.length > 0) {
      sources.push({
        type: "distributional",
        description: `${mismatchedModels.length} model(s) without regime-specific profile`,
        severity: 0.6,
      });
    }
  }

  // ── 4. Temporal: 时间退化 ──
  if (calibrationHealth.driftDetected) {
    sources.push({
      type: "temporal",
      description: `Calibration drift detected: ${calibrationHealth.driftDirection}`,
      severity: calibrationHealth.driftDirection === "DEGRADING" ? 0.7 : 0.3,
    });
  }

  if (calibrationHealth.profileStale) {
    sources.push({
      type: "temporal",
      description: "Calibration profile is stale",
      severity: 0.5,
    });
  }

  // ── 5. Environmental: 数据过期 ──
  if (freshness.overallFreshness === "EXPIRED" || freshness.overallFreshness === "COLD_START") {
    sources.push({
      type: "environmental",
      description: `Data freshness: ${freshness.overallFreshness}`,
      severity: 0.9,
    });
  } else if (freshness.overallFreshness === "STALE") {
    sources.push({
      type: "environmental",
      description: "Some data sources are stale",
      severity: 0.4,
    });
  }

  // 按 severity 降序排序确保确定性
  sources.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return a.type.localeCompare(b.type);
  });

  // 识别主要来源
  const dominantSource = sources.length > 0 ? sources[0]!.type : null;

  const description =
    sources.length === 0
      ? "No significant uncertainty sources detected"
      : `Primary uncertainty: ${dominantSource} (${sources.length} source(s))`;

  // 对不确定性评估本身的置信度
  // 数据越少 → 评估本身的置信度越低
  const confidenceInAssessment = computeAssessmentConfidence(
    dataSufficiency,
    sources.length,
  );

  return {
    sources,
    dominantSource,
    description,
    confidenceInAssessment,
  };
}

/**
 * 计算对不确定性评估本身的置信度。
 *
 * 数据充足 → 评估本身可信 → confidence 高
 * 数据不足 → 评估本身也不可信 → confidence 低
 */
function computeAssessmentConfidence(
  dataSufficiency: DataSufficiencySummary,
  sourceCount: number,
): number {
  if (dataSufficiency.totalResolutions === 0) return 0;
  if (!dataSufficiency.sufficient) return 0.3;

  // 数据充足且来源不多 → 评估可信
  const base = 0.7;
  const sourcePenalty = Math.min(sourceCount * 0.05, 0.2);
  return Number(Math.max(base - sourcePenalty, 0.3).toFixed(6));
}
