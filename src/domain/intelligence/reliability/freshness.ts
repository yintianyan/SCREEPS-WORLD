/**
 * A6.5 Freshness & Data Sufficiency — 数据新鲜度 + 充足性评估。
 *
 * 职责：
 *   - Freshness: 基于实际 tick / cadence 评估各数据源的新鲜度
 *   - Data Sufficiency: 跨模型聚合数据充足性
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 * REL-001 (Read-Only)：只读消费，不修改输入。
 * REL-005 (Deterministic)：相同输入 → 相同输出。
 * REL-007 (No New Sampler)：不新建采样通道。
 *
 * 禁止 Date.now() / wall clock。必须 deterministic。
 */

import type { Prediction } from "../prediction/types";
import type {
  ModelCalibrationProfile,
  ResolutionResult,
} from "../calibration/types";
import { isCalibratable } from "../calibration/types";
import { makeModelKey } from "../calibration/metrics";
import { MIN_SAMPLES_FOR_PROFILE } from "../calibration/types";
import type {
  DataSufficiencySummary,
  FreshnessSummary,
  FreshnessSource,
  FreshnessLevel,
  OverallFreshness,
} from "./types";
import {
  FRESHNESS_FRESH_TICKS,
  FRESHNESS_RECENT_TICKS,
  FRESHNESS_STALE_TICKS,
} from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Freshness
// ═══════════════════════════════════════════════════════════

/**
 * 计算知识新鲜度。
 *
 * 纯函数 — 从各数据源的 tick 信息计算。
 *
 * @param profiles - 所有 ModelCalibrationProfile
 * @param resolutions - 所有 ResolutionResult
 * @param predictions - 所有 Prediction
 * @param currentTick - 当前 tick
 * @returns 新鲜度摘要
 */
export function computeFreshness(
  profiles: readonly ModelCalibrationProfile[],
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  currentTick: number,
): FreshnessSummary {
  const sources: FreshnessSource[] = [];

  // CalibrationProfile 新鲜度
  for (const profile of profiles) {
    const age = currentTick - profile.statisticsTick;
    sources.push({
      source: `profile:${profile.modelKey}`,
      freshness: ageToFreshness(age),
      ageInTicks: age,
    });
  }

  // ResolutionResult 新鲜度（取最新一条）
  if (resolutions.length > 0) {
    const sorted = [...resolutions].sort(
      (a, b) => b.resolvedTick - a.resolvedTick,
    );
    const latest = sorted[0]!;
    const age = currentTick - latest.resolvedTick;
    sources.push({
      source: "resolutions",
      freshness: ageToFreshness(age),
      ageInTicks: age,
    });
  }

  // Prediction 新鲜度（取最新一条 active）
  const activePreds = predictions.filter(p => p.status === "active");
  if (activePreds.length > 0) {
    const sorted = [...activePreds].sort(
      (a, b) => b.generatedAt - a.generatedAt,
    );
    const latest = sorted[0]!;
    const age = currentTick - latest.generatedAt;
    sources.push({
      source: "predictions",
      freshness: ageToFreshness(age),
      ageInTicks: age,
    });
  }

  // 按 source 排序确保确定性
  sources.sort((a, b) => a.source.localeCompare(b.source));

  return {
    sources,
    overallFreshness: computeOverallFreshness(sources, currentTick),
  };
}

/**
 * 将年龄（tick）映射到新鲜度等级。
 */
function ageToFreshness(age: number): FreshnessLevel {
  if (age < 0) return "FRESH"; // 防御性：tick 异常
  if (age <= FRESHNESS_FRESH_TICKS) return "FRESH";
  if (age <= FRESHNESS_RECENT_TICKS) return "RECENT";
  if (age <= FRESHNESS_STALE_TICKS) return "STALE";
  return "EXPIRED";
}

/**
 * 计算整体新鲜度 — 取最差的数据源等级。
 */
function computeOverallFreshness(
  sources: readonly FreshnessSource[],
  currentTick: number,
): OverallFreshness {
  if (sources.length === 0) return "COLD_START";

  // 优先级：EXPIRED > STALE > RECENT > FRESH
  let hasExpired = false;
  let hasStale = false;
  let hasRecent = false;

  for (const s of sources) {
    switch (s.freshness) {
      case "EXPIRED":
        hasExpired = true;
        break;
      case "STALE":
        hasStale = true;
        break;
      case "RECENT":
        hasRecent = true;
        break;
    }
  }

  if (hasExpired) return "EXPIRED";
  if (hasStale) return "STALE";
  if (hasRecent) return "RECENT";
  return "FRESH";
}

// ═══════════════════════════════════════════════════════════
// §2. Data Sufficiency
// ═══════════════════════════════════════════════════════════

/**
 * 计算数据充足性聚合。
 *
 * 纯函数 — 从 A6.4 Profile + A6.3 Prediction 聚合。
 *
 * @param profiles - 所有 ModelCalibrationProfile
 * @param resolutions - 所有 ResolutionResult
 * @param predictions - 所有 Prediction
 * @returns 数据充足性摘要
 */
export function computeDataSufficiency(
  profiles: readonly ModelCalibrationProfile[],
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
): DataSufficiencySummary {
  const totalResolutions = resolutions.length;

  if (profiles.length === 0) {
    return {
      sufficient: false,
      totalResolutions,
      modelsWithSufficientData: 0,
      minSamplesModel: null,
      insufficientDimensions: ["NO_PROFILES"],
    };
  }

  let modelsWithSufficientData = 0;
  let minCount = Infinity;
  let minModelKey = "";
  const insufficientDims: string[] = [];

  for (const profile of profiles) {
    const count = profile.calibratableCount;
    if (count >= MIN_SAMPLES_FOR_PROFILE) {
      modelsWithSufficientData++;
    } else {
      insufficientDims.push(profile.modelKey);
    }
    if (count < minCount) {
      minCount = count;
      minModelKey = profile.modelKey;
    }
  }

  const sufficient =
    modelsWithSufficientData === profiles.length && profiles.length > 0;

  return {
    sufficient,
    totalResolutions,
    modelsWithSufficientData,
    minSamplesModel:
      minCount < Infinity ? { modelKey: minModelKey, count: minCount } : null,
    insufficientDimensions: insufficientDims.sort(),
  };
}

// ═══════════════════════════════════════════════════════════
// §3. Prediction Coverage
// ═══════════════════════════════════════════════════════════

/**
 * 已实现的预测模型 target 列表。
 * 从 Prediction 和 ResolutionResult 中推导。
 */
export function computePredictionCoverage(
  predictions: readonly Prediction[],
  resolutions: readonly ResolutionResult[],
): {
  implementedModels: number;
  plannedModels: number;
  coveredTargets: readonly string[];
  missingTargets: readonly string[];
  activePredictions: number;
} {
  const PLANNED_TARGETS = [
    "energy-shortage",
    "spawn-starvation",
    "logistics-bottleneck",
    "room-collapse",
    "remote-mining-failure",
    "expansion-readiness",
    "cpu-pressure",
  ] as const;

  // 从 predictions 提取已实现的 targets
  const implemented = new Set<string>();
  for (const p of predictions) {
    implemented.add(p.target);
  }
  // 从 resolutions 也提取（可能有已过期但曾实现的模型）
  for (const r of resolutions) {
    // resolution 只存 predictionId，不直接存 target
    // 需要从 predictions 找
  }

  const covered = [...implemented].sort();
  const missing = PLANNED_TARGETS.filter(t => !implemented.has(t)).sort();
  const activeCount = predictions.filter(p => p.status === "active").length;

  return {
    implementedModels: implemented.size,
    plannedModels: PLANNED_TARGETS.length,
    coveredTargets: covered,
    missingTargets: missing,
    activePredictions: activeCount,
  };
}
