/** A6.3.2 Prediction Lifecycle Resolution — 预测应验/失效判定。 */

import type { Prediction, PredictionStatus } from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Resolution Types
// ═══════════════════════════════════════════════════════════

/** 预测分辨率结果。 */
export type PredictionResolution = "fulfilled" | "expired" | "invalidated";

/** 预测验证输入。 */
export interface PredictionVerificationInput {
  /** 预测对象。 */
  readonly prediction: Prediction;
  /** 当前实际值。 */
  readonly actualValue: number;
  /** 当前 tick。 */
  readonly currentTick: number;
}

/** 预测验证结果。 */
export interface PredictionVerificationResult {
  /** 分辨率结果。 */
  readonly resolution: PredictionResolution;
  /** 预测值与实际值的偏差比例 (0-1+)。 */
  readonly deviation: number;
  /** 是否在预测窗口内。 */
  readonly withinWindow: boolean;
  /** 验证描述。 */
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §2. Resolution Functions
// ═══════════════════════════════════════════════════════════

/** 应验偏差阈值（预测值与实际值偏差 < 20% → fulfilled）。 */
export const FULFILLMENT_DEVIATION_THRESHOLD = 0.2;

/** 推翻阈值（偏差 > 100% → invalidated）。 */
export const INVALIDATION_DEVIATION_THRESHOLD = 1.0;

/**
 * 验证单条 Prediction 的应验状态。

 * 判定规则：
 *   1. 窗口已到期（currentTick > endTick）：
 *      - 偏差 < 20% → fulfilled
 *      - 偏差 ≥ 20% 且 < 100% → expired
 *      - 偏差 ≥ 100% → invalidated
 *   2. 窗口未到期：
 *      - 偏差 ≥ 100% → invalidated（新数据推翻预测）
 *      - 否则 → 不变（仍 active）

 * 纯函数 — 不修改输入，不引用 Game/Memory。
 * 确定性：相同输入 → 相同输出。
 */
export function verifyPrediction(
  input: PredictionVerificationInput,
): PredictionVerificationResult {
  const predicted = input.prediction.value;
  const actual = input.actualValue;
  const withinWindow = input.currentTick <= input.prediction.window.endTick;

  // 计算偏差比例
  let deviation: number;
  if (Math.abs(predicted) < 1e-10) {
    // 预测值接近 0，用绝对偏差
    deviation = Math.abs(actual) > 1e-10 ? 1.0 : 0.0;
  } else {
    deviation = Math.abs(actual - predicted) / Math.abs(predicted);
  }
  deviation = Number(deviation.toFixed(3));

  // 窗口已到期
  if (!withinWindow) {
    if (deviation < FULFILLMENT_DEVIATION_THRESHOLD) {
      return {
        resolution: "fulfilled",
        deviation,
        withinWindow: false,
        reason: `Predicted ${predicted.toFixed(3)}, actual ${actual.toFixed(3)}, deviation ${deviation.toFixed(3)} < ${FULFILLMENT_DEVIATION_THRESHOLD}`,
      };
    }
    if (deviation >= INVALIDATION_DEVIATION_THRESHOLD) {
      return {
        resolution: "invalidated",
        deviation,
        withinWindow: false,
        reason: `Deviation ${deviation.toFixed(3)} >= ${INVALIDATION_DEVIATION_THRESHOLD}, prediction invalidated`,
      };
    }
    return {
      resolution: "expired",
      deviation,
      withinWindow: false,
      reason: `Deviation ${deviation.toFixed(3)} >= ${FULFILLMENT_DEVIATION_THRESHOLD}, prediction expired unfulfilled`,
    };
  }

  // 窗口未到期 — 只检查是否被推翻
  if (deviation >= INVALIDATION_DEVIATION_THRESHOLD) {
    return {
      resolution: "invalidated",
      deviation,
      withinWindow: true,
      reason: `Deviation ${deviation.toFixed(3)} >= ${INVALIDATION_DEVIATION_THRESHOLD}, prediction invalidated before window end`,
    };
  }

  // 仍然 active
  return {
    resolution: "fulfilled", // 标记为 fulfilled 但实际不变更 status
    deviation,
    withinWindow: true,
    reason: `Within window, deviation ${deviation.toFixed(3)}, prediction still active`,
  };
}

/**
 * 判断 Prediction 是否需要状态转换。

 * 返回新的 status（如果需要转换），否则返回当前 status。

 * 纯函数 — 不修改输入。
 */
export function resolvePredictionStatus(
  prediction: Prediction,
  actualValue: number,
  currentTick: number,
): PredictionStatus {
  // 已终态的预测不再转换
  if (prediction.status !== "active") {
    return prediction.status;
  }

  const result = verifyPrediction({ prediction, actualValue, currentTick });

  // 窗口未到期且未被推翻 → 保持 active
  if (result.withinWindow && result.resolution !== "invalidated") {
    return "active";
  }

  // 窗口已到期或被推翻 → 返回终态
  return result.resolution;
}

// ═══════════════════════════════════════════════════════════
// §3. Batch Resolution
// ═══════════════════════════════════════════════════════════

/**
 * 批量验证结果。
 */
export interface BatchResolutionResult {
  /** 已应验数量。 */
  readonly fulfilled: number;
  /** 已失效（未应验）数量。 */
  readonly expired: number;
  /** 已推翻数量。 */
  readonly invalidated: number;
  /** 仍活跃数量。 */
  readonly active: number;
  /** 应验率 (fulfilled / (fulfilled + expired + invalidated))。 */
  readonly fulfillmentRate: number;
}

/**
 * 批量验证预测列表。

 * 纯函数 — 不修改输入列表。
 * 确定性：遍历前按 id 排序。
 */
export function batchResolvePredictions(
  predictions: readonly Prediction[],
  actualValues: ReadonlyMap<string, number>,
  currentTick: number,
): BatchResolutionResult {
  // 按 id 排序确保确定性
  const sorted = [...predictions].sort((a, b) => a.id.localeCompare(b.id));

  let fulfilled = 0;
  let expired = 0;
  let invalidated = 0;
  let active = 0;

  for (const pred of sorted) {
    if (pred.status !== "active") {
      // 已终态的按当前 status 计数
      switch (pred.status) {
        case "fulfilled": fulfilled++; break;
        case "expired": expired++; break;
        case "invalidated": invalidated++; break;
      }
      continue;
    }

    const actual = actualValues.get(pred.id);
    if (actual === undefined) {
      // 无实际值 → 检查是否窗口到期
      if (pred.window.endTick < currentTick) {
        expired++;
      } else {
        active++;
      }
      continue;
    }

    const newStatus = resolvePredictionStatus(pred, actual, currentTick);
    switch (newStatus) {
      case "fulfilled": fulfilled++; break;
      case "expired": expired++; break;
      case "invalidated": invalidated++; break;
      case "active": active++; break;
    }
  }

  const resolved = fulfilled + expired + invalidated;
  const fulfillmentRate = resolved > 0
    ? Number((fulfilled / resolved).toFixed(3))
    : 0;

  return { fulfilled, expired, invalidated, active, fulfillmentRate };
}
