/** A6.5 Regime Fit — Regime 适配度计算。 */

import type { PredictionContext } from "../prediction/context";
import { buildPredictionContextSignature } from "../prediction/context";
import type { Prediction } from "../prediction/types";
import type {
  ModelCalibrationProfile,
  ResolutionResult,
} from "../calibration/types";
import { isCalibratable } from "../calibration/types";
import { makeModelKey } from "../calibration/metrics";
import type {
  ModelRegimeFitEntry,
  RegimeFitSummary,
} from "./types";
import {
  MIN_SAMPLES_FOR_REGIME_PROFILE,
} from "./types";

/**
 * 计算 Regime 适配度。

 * 纯函数 — 从 A6.4 Profile + A6.3 Context 计算。

 * @param profiles - 所有 ModelCalibrationProfile
 * @param resolutions - 所有 ResolutionResult
 * @param predictions - 所有 Prediction
 * @param currentContext - 当前 PredictionContext
 * @returns Regime 适配度摘要
 */
export function computeRegimeFit(
  profiles: readonly ModelCalibrationProfile[],
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  currentContext: PredictionContext,
): RegimeFitSummary {
  const currentSignature = buildPredictionContextSignature(currentContext);

  const modelRegimeFit: ModelRegimeFitEntry[] = [];

  for (const profile of profiles) {
    const entry = computeModelRegimeFit(
      profile,
      resolutions,
      predictions,
      currentSignature,
    );
    modelRegimeFit.push(entry);
  }

  // 按 modelKey 排序确保确定性
  modelRegimeFit.sort((a, b) => a.modelKey.localeCompare(b.modelKey));

  const currentRegimeMatched = modelRegimeFit.some(
    e => e.regimeMatched && e.profileSource === "REGIME",
  );

  return {
    currentRegimeMatched,
    currentSignature,
    modelRegimeFit,
  };
}

/**
 * 计算单个模型的 Regime 适配度。

 * 检查 ResolutionResult 中是否有足够多的 resolutionContextSignature 与当前签名匹配。
 */
function computeModelRegimeFit(
  profile: ModelCalibrationProfile,
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  currentSignature: string,
): ModelRegimeFitEntry {
  // 找到属于此模型的 predictions
  const modelPredictionIds = new Set(
    predictions
      .filter(
        p =>
          makeModelKey(p.target, p.method, p.modelVersion) ===
          profile.modelKey,
      )
      .map(p => p.id),
  );

  // 从 resolutions 中筛选属于此模型且签名匹配的
  let regimeSampleCount = 0;
  for (const r of resolutions) {
    if (!modelPredictionIds.has(r.predictionId)) continue;
    if (r.resolutionContextSignature === currentSignature) {
      if (isCalibratable(r.resolution)) {
        regimeSampleCount++;
      }
    }
  }

  // 判定 Profile 来源
  let profileSource: ModelRegimeFitEntry["profileSource"];
  let regimeMatched: boolean;

  if (regimeSampleCount >= MIN_SAMPLES_FOR_REGIME_PROFILE) {
    profileSource = "REGIME";
    regimeMatched = true;
  } else if (profile.calibratableCount >= MIN_SAMPLES_FOR_REGIME_PROFILE) {
    // Regime 样本不足但全局有数据 → fallback
    profileSource = "FALLBACK_GLOBAL";
    regimeMatched = false;
  } else {
    profileSource = "NONE";
    regimeMatched = false;
  }

  return {
    modelKey: profile.modelKey,
    regimeMatched,
    profileSource,
  };
}

/**
 * 获取某模型在当前 Regime 下的可校准样本数。
 */
export function getRegimeSampleCount(
  modelKey: string,
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  currentSignature: string,
): number {
  const modelPredictionIds = new Set(
    predictions
      .filter(
        p => makeModelKey(p.target, p.method, p.modelVersion) === modelKey,
      )
      .map(p => p.id),
  );

  let count = 0;
  for (const r of resolutions) {
    if (!modelPredictionIds.has(r.predictionId)) continue;
    if (r.resolutionContextSignature === currentSignature) {
      if (isCalibratable(r.resolution)) {
        count++;
      }
    }
  }
  return count;
}
