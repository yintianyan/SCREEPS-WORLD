/** A6.5 Temporal Drift — 时效性退化检测。 */

import type { Prediction } from "../prediction/types";
import type { ResolutionResult } from "../calibration/types";
import { isCalibratable } from "../calibration/types";
import { makeModelKey } from "../calibration/metrics";
import { computeECE } from "../calibration/calibration";
import { computeConfidenceBuckets } from "../calibration/calibration";
import type {
  DriftDirection,
} from "./types";
import {
  ROLLING_WINDOW_SIZE,
  ROLLING_WINDOW_MIN_CALIBRATABLE,
  DRIFT_DEGRADING_MULTIPLIER,
  DRIFT_IMPROVING_MULTIPLIER,
  PROFILE_STALE_TICKS,
} from "./types";

/**
 * Drift 检测结果。
 */
export interface DriftDetectionResult {
  readonly driftDetected: boolean;
  readonly driftDirection: DriftDirection;
  readonly recentEce: number | null;
  readonly overallEce: number;
}

/**
 * 检测模型校准的时间退化。

 * 纯函数 — 从 ResolutionResult 列表计算。

 * 策略：
 *   1. 取最近 ROLLING_WINDOW_SIZE 条 calibratable Resolution
 *   2. 如果 >= ROLLING_WINDOW_MIN_CALIBRATABLE，计算 recent ECE
 *   3. 对比 recentEce vs overallEce
 *   4. recentEce > overallEce × DRIFT_DEGRADING_MULTIPLIER → DEGRADING
 *   5. recentEce < overallEce × DRIFT_IMPROVING_MULTIPLIER → IMPROVING

 * @param resolutions - 全部 ResolutionResult
 * @param predictions - 全部 Prediction（用于匹配 modelKey）
 * @param modelKey - 模型标识
 * @param overallEce - 全历史 ECE（从 ModelCalibrationProfile 获取）
 * @returns Drift 检测结果
 */
export function detectCalibrationDrift(
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  modelKey: string,
  overallEce: number,
): DriftDetectionResult {
  // 找到属于此模型的 prediction IDs
  const modelPredictionIds = new Set(
    predictions
      .filter(
        p => makeModelKey(p.target, p.method, p.modelVersion) === modelKey,
      )
      .map(p => p.id),
  );

  // 过滤属于此模型的 calibratable resolutions
  const modelResolutions = resolutions.filter(
    r =>
      modelPredictionIds.has(r.predictionId) &&
      isCalibratable(r.resolution),
  );

  // 按 resolvedTick 降序排序后取最近 N 条
  const sorted = [...modelResolutions].sort(
    (a, b) => b.resolvedTick - a.resolvedTick,
  );
  const recent = sorted.slice(0, ROLLING_WINDOW_SIZE);

  // 样本不足时不检测 drift
  if (recent.length < ROLLING_WINDOW_MIN_CALIBRATABLE) {
    return {
      driftDetected: false,
      driftDirection: "UNKNOWN",
      recentEce: null,
      overallEce,
    };
  }

  // 计算最近窗口的 ECE
  // 需要从 recent resolutions 找到对应的 predictions
  const recentPredictionIds = new Set(recent.map(r => r.predictionId));
  const recentPredictions = predictions.filter(p =>
    recentPredictionIds.has(p.id),
  );

  const recentBuckets = computeConfidenceBuckets(recent, recentPredictions);
  const recentEce = computeECE(recentBuckets);

  // 对比
  const driftDirection = compareDrift(recentEce, overallEce);

  return {
    driftDetected: driftDirection !== "STABLE" && driftDirection !== "UNKNOWN",
    driftDirection,
    recentEce: Number(recentEce.toFixed(6)),
    overallEce,
  };
}

/**
 * 对比 recent ECE 和 overall ECE，判定 drift 方向。
 */
function compareDrift(
  recentEce: number,
  overallEce: number,
): DriftDirection {
  if (overallEce === 0) {
    // 全历史 ECE=0 但 recent 有 ECE → 恶化
    if (recentEce > 0) return "DEGRADING";
    return "STABLE";
  }

  const ratio = recentEce / overallEce;

  if (ratio > DRIFT_DEGRADING_MULTIPLIER) {
    return "DEGRADING";
  }
  if (ratio < DRIFT_IMPROVING_MULTIPLIER) {
    return "IMPROVING";
  }
  return "STABLE";
}

/**
 * 检测 Profile 是否过期。

 * @param statisticsTick - Profile 最后统计 tick
 * @param currentTick - 当前 tick
 * @returns 是否过期
 */
export function isProfileStale(
  statisticsTick: number,
  currentTick: number,
): boolean {
  return currentTick - statisticsTick > PROFILE_STALE_TICKS;
}
