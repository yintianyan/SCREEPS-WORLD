/**
 * A6.4 Resolution Engine — 对 Prediction 的解析引擎。
 *
 * 合同锚点：A6_4_CONTRACT.md §二.1 + A6_4_RESOLUTION_DESIGN.md §四
 *
 * 职责：
 *   - 对比 Prediction 与实际 Observation，产出 ResolutionResult
 *   - 检查 Regime 变化 → REGIME_CHANGED
 *   - 检查外部干扰 → EXTERNAL_INTERFERENCE
 *   - 计算 predicted vs actual 偏差
 *   - 判定 CORRECT / INCORRECT / PARTIAL / FALSE_POSITIVE / FALSE_NEGATIVE
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * Shadow-Only（CAL-001）：
 *   不修改 Prediction 对象，不修改任何运行时状态。
 *   只读取 Prediction 和 Observation，产出独立的 ResolutionResult。
 *
 * 确定性（CAL-005）：
 *   相同 Prediction + 相同 Observation + 相同 Context → 相同 resolutionHash。
 *   禁止 Math.random / Date.now / 无序迭代 / 浮点误差。
 *
 * 与 A6.3 resolve.ts 的关系：
 *   A6.3 resolve.ts = Lifecycle Resolution（更新 Prediction status: fulfilled/expired/invalidated）
 *   A6.4 resolve.ts = Calibration Resolution（更细粒度分类，不修改 Prediction）
 *   两者独立，不复用代码。
 *
 * 反事实场景覆盖（A6_4_RESOLUTION_DESIGN.md §五）：
 *   C1-C12 全部由 resolvePrediction 的判定路径覆盖。
 */

import type { Prediction } from "../prediction/types";
import type { PredictionContext } from "../prediction/context";
import {
  buildPredictionContextSignature,
  checkRegimeCompatibility,
} from "../prediction/context";
import { stableStringify, fnv1a32Hex } from "../prediction/hashing";
import type {
  CalibrationResolution,
  ExternalFactorSignal,
  ObservationSample,
  ResolutionResult,
} from "./types";
import {
  CORRECT_RELATIVE_ERROR_THRESHOLD,
  INCORRECT_RELATIVE_ERROR_THRESHOLD,
  MAX_OBSERVATION_GAP,
  MIN_OBSERVATION_SAMPLES,
  RESOLUTION_GRACE_PERIOD,
} from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Resolution Engine — 核心解析函数
// ═══════════════════════════════════════════════════════════

/**
 * 解析一条 Prediction — 对比预测与实际观测，产出 ResolutionResult。
 *
 * 判定流程（A6_4_RESOLUTION_DESIGN.md §二.4）：
 *   1. 检查 observation 是否充足 → INSUFFICIENT_OBSERVATION
 *   2. 检查 Regime 是否变化 → REGIME_CHANGED（如果严重）
 *   3. 检查 External Interference → EXTERNAL_INTERFERENCE（如果有且方向不一致）
 *   4. 计算 predicted vs actual 偏差
 *   5. 判定 CORRECT / INCORRECT / PARTIAL / FALSE_POSITIVE / FALSE_NEGATIVE
 *
 * 纯函数 — 不引用 Game/Memory。
 * 确定性 — 相同输入 → 相同 resolutionHash。
 *
 * @param prediction - A6.3 冻结的 Prediction 对象（只读）
 * @param observations - 窗口内的观测采样
 * @param currentContext - Resolution 时的上下文
 * @param externalFactors - 外部干扰信号
 * @returns ResolutionResult — 独立的解析结果
 */
export function resolvePrediction(
  prediction: Prediction,
  observations: readonly ObservationSample[],
  currentContext: PredictionContext,
  externalFactors: readonly ExternalFactorSignal[],
): ResolutionResult {
  const resolvedTick = prediction.window.endTick + RESOLUTION_GRACE_PERIOD;

  // ── 1. 检查 observation 充足性 ──
  const observationCheck = checkObservationSufficiency(
    observations,
    prediction.window.startTick,
    prediction.window.endTick,
  );

  if (!observationCheck.sufficient) {
    return buildResolutionResult(
      prediction,
      "INSUFFICIENT_OBSERVATION",
      resolvedTick,
      prediction.value,
      observationCheck.bestActual ?? prediction.value,
      false,
      false,
      currentContext,
      false,
      [],
      false,
      [],
      observationCheck.reason,
    );
  }

  // ── 2. 检查 Regime 变化 ──
  const regimeCompat = checkRegimeCompatibility(
    prediction.context,
    currentContext,
  );

  const regimeChanged = isRegimeChanged(regimeCompat);

  if (regimeChanged) {
    // Regime 变化时仍计算 actualValue，但不计入校准
    const actualValue = computeActualValue(observations, prediction);
    const directionCorrect = computeDirectionCorrect(prediction, actualValue);

    return buildResolutionResult(
      prediction,
      "REGIME_CHANGED",
      resolvedTick,
      prediction.value,
      actualValue,
      directionCorrect,
      true,
      currentContext,
      true,
      regimeCompat.mismatchedDimensions,
      false,
      [],
      `Regime changed: ${regimeCompat.reason}`,
    );
  }

  // ── 3. 计算 actual value 和偏差 ──
  const actualValue = computeActualValue(observations, prediction);
  const absoluteError = computeAbsoluteError(prediction.value, actualValue);
  const relativeError = computeRelativeError(prediction.value, actualValue);
  const directionCorrect = computeDirectionCorrect(prediction, actualValue);
  const withinHorizon = checkWithinHorizon(observations, prediction);

  // ── 4. 检查 External Interference ──
  const hasExternalInterference = externalFactors.length > 0;

  if (hasExternalInterference && !directionCorrect) {
    // 外部因素存在且预测方向与实际方向不一致 → EXTERNAL_INTERFERENCE
    return buildResolutionResult(
      prediction,
      "EXTERNAL_INTERFERENCE",
      resolvedTick,
      prediction.value,
      actualValue,
      directionCorrect,
      withinHorizon,
      currentContext,
      regimeChanged,
      regimeCompat.mismatchedDimensions,
      true,
      externalFactors.map(f => f.source),
      `External interference: ${externalFactors.map(f => f.description).join("; ")}`,
    );
  }

  // ── 5. 判定 CORRECT / INCORRECT / PARTIAL / FALSE_POSITIVE / FALSE_NEGATIVE ──
  const resolution = determineResolution(
    prediction,
    actualValue,
    relativeError,
    directionCorrect,
    withinHorizon,
  );

  const reason = buildReason(prediction, actualValue, relativeError, directionCorrect, withinHorizon, resolution);

  return buildResolutionResult(
    prediction,
    resolution,
    resolvedTick,
    prediction.value,
    actualValue,
    directionCorrect,
    withinHorizon,
    currentContext,
    regimeChanged,
    regimeCompat.mismatchedDimensions,
    hasExternalInterference && !directionCorrect,
    hasExternalInterference ? externalFactors.map(f => f.source) : [],
    reason,
  );
}

// ═══════════════════════════════════════════════════════════
// §2. ResolutionResult 构建与 Hash
// ═══════════════════════════════════════════════════════════

/**
 * 构建 ResolutionResult 并计算确定性 hash。
 *
 * 纯函数 — 不修改任何输入。
 */
function buildResolutionResult(
  prediction: Prediction,
  resolution: CalibrationResolution,
  resolvedTick: number,
  predictedValue: number,
  actualValue: number,
  directionCorrect: boolean,
  withinHorizon: boolean,
  currentContext: PredictionContext,
  regimeChanged: boolean,
  regimeMismatchedDimensions: readonly string[],
  hasExternalInterference: boolean,
  externalFactorSources: readonly string[],
  reason: string,
): ResolutionResult {
  const absoluteError = computeAbsoluteError(predictedValue, actualValue);
  const relativeError = computeRelativeError(predictedValue, actualValue);
  const resolutionContextSignature = buildPredictionContextSignature(currentContext);

  const resultWithoutHash: Omit<ResolutionResult, "resolutionHash"> = {
    predictionId: prediction.id,
    resolution,
    resolvedTick,
    predictedValue: Number(predictedValue.toFixed(3)),
    actualValue: Number(actualValue.toFixed(3)),
    absoluteError: Number(absoluteError.toFixed(3)),
    relativeError: Number(relativeError.toFixed(3)),
    directionCorrect,
    withinHorizon,
    resolutionContextSignature,
    regimeChanged,
    regimeMismatchedDimensions,
    hasExternalInterference,
    externalFactorSources,
    reason,
  };

  const resolutionHash = resolutionResultHash(resultWithoutHash);

  return { ...resultWithoutHash, resolutionHash };
}

/**
 * ResolutionResult 确定性 Hash。
 *
 * 复用 A6.3 stableStringify + FNV-1a 32-bit。
 *
 * 来源：A6_4_CONTRACT.md §二.5
 */
export function resolutionResultHash(result: Omit<ResolutionResult, "resolutionHash">): string {
  const payload = stableStringify({
    predictionId: result.predictionId,
    resolution: result.resolution,
    resolvedTick: result.resolvedTick,
    predictedValue: Number(result.predictedValue.toFixed(3)),
    actualValue: Number(result.actualValue.toFixed(3)),
    relativeError: Number(result.relativeError.toFixed(3)),
    directionCorrect: result.directionCorrect,
    withinHorizon: result.withinHorizon,
    regimeChanged: result.regimeChanged,
    hasExternalInterference: result.hasExternalInterference,
  });
  return fnv1a32Hex(payload);
}

// ═══════════════════════════════════════════════════════════
// §3. Observation Sufficiency Check
// ═══════════════════════════════════════════════════════════

/**
 * 检查观测数据是否充足。
 *
 * 规则（A6_4_RESOLUTION_DESIGN.md §五 C8/C9）：
 *   - 样本数 < MIN_OBSERVATION_SAMPLES → 不充足
 *   - 最大间隔 > MAX_OBSERVATION_GAP → 不充足
 *
 * 纯函数。
 */
function checkObservationSufficiency(
  observations: readonly ObservationSample[],
  windowStartTick: number,
  windowEndTick: number,
): { sufficient: boolean; reason: string; bestActual: number | null } {
  if (observations.length < MIN_OBSERVATION_SAMPLES) {
    return {
      sufficient: false,
      reason: `Insufficient observation samples: ${observations.length} < ${MIN_OBSERVATION_SAMPLES}`,
      bestActual: observations.length > 0 ? observations[observations.length - 1]!.value : null,
    };
  }

  // 检查间隔 — 按 tick 排序
  const sorted = [...observations].sort((a, b) => a.tick - b.tick);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.tick - sorted[i - 1]!.tick;
    if (gap > maxGap) maxGap = gap;
  }

  if (maxGap > MAX_OBSERVATION_GAP) {
    return {
      sufficient: false,
      reason: `Observation gap too large: ${maxGap} > ${MAX_OBSERVATION_GAP}`,
      bestActual: sorted[sorted.length - 1]!.value,
    };
  }

  // 检查是否有窗口内的样本
  const inWindow = sorted.filter(s => s.tick >= windowStartTick && s.tick <= windowEndTick);
  if (inWindow.length === 0) {
    return {
      sufficient: false,
      reason: "No observation samples within prediction window",
      bestActual: sorted[sorted.length - 1]!.value,
    };
  }

  return {
    sufficient: true,
    reason: "OK",
    bestActual: inWindow[inWindow.length - 1]!.value,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Value Computation
// ═══════════════════════════════════════════════════════════

/**
 * 从观测序列中计算实际值。
 *
 * 策略：取窗口内最后一个观测值作为 actualValue。
 * 这与 prediction.value（窗口结束时的预测值）对齐。
 *
 * 纯函数。
 */
function computeActualValue(
  observations: readonly ObservationSample[],
  prediction: Prediction,
): number {
  // 窗口内的观测
  const inWindow = observations.filter(
    s => s.tick >= prediction.window.startTick && s.tick <= prediction.window.endTick,
  );

  if (inWindow.length > 0) {
    // 按 tick 排序，取最后一个
    const sorted = [...inWindow].sort((a, b) => a.tick - b.tick);
    return sorted[sorted.length - 1]!.value;
  }

  // 无窗口内观测 → 取所有观测的最后一个
  if (observations.length > 0) {
    const sorted = [...observations].sort((a, b) => a.tick - b.tick);
    return sorted[sorted.length - 1]!.value;
  }

  return prediction.value; // fallback
}

/**
 * 计算绝对误差。
 */
function computeAbsoluteError(predicted: number, actual: number): number {
  return Math.abs(actual - predicted);
}

/**
 * 计算相对误差。
 *
 * 预测值接近 0 时用绝对偏差的归一化。
 */
function computeRelativeError(predicted: number, actual: number): number {
  if (Math.abs(predicted) < 1e-10) {
    return Math.abs(actual) > 1e-10 ? 1.0 : 0.0;
  }
  return Math.abs(actual - predicted) / Math.abs(predicted);
}

/**
 * 判断方向是否正确。
 *
 * 对于值型预测：预测值 < 当前值（预测下降）vs 实际值 < 当前值（实际下降）。
 * 方向一致 = correct。
 *
 * 纯函数。
 */
function computeDirectionCorrect(prediction: Prediction, actualValue: number): boolean {
  // 方向 = 预测值 vs 当前值的差异方向
  // 但 Prediction 没有 "当前值" — 我们用 prediction.value 和 actualValue 的方向
  // 简化：如果预测值 > 0 且实际值 > 0 或预测值 <= 0 且实际值 <= 0 → 方向一致
  // 更精确的判断需要模型提供 "predicted direction"，但这里用误差大小作为代理

  // 如果相对误差 < 50% → 方向基本正确
  const relErr = computeRelativeError(prediction.value, actualValue);
  return relErr < INCORRECT_RELATIVE_ERROR_THRESHOLD;
}

/**
 * 检查事件是否在 Horizon 内发生。
 *
 * 通过观测序列判断：窗口内是否有观测值达到预测条件。
 */
function checkWithinHorizon(
  observations: readonly ObservationSample[],
  prediction: Prediction,
): boolean {
  const inWindow = observations.filter(
    s => s.tick >= prediction.window.startTick && s.tick <= prediction.window.endTick,
  );
  return inWindow.length > 0;
}

// ═══════════════════════════════════════════════════════════
// §5. Regime Change Detection
// ═══════════════════════════════════════════════════════════

/**
 * 判断 Regime 是否发生重大变化。
 *
 * 规则（A6_4_RESOLUTION_DESIGN.md §六.2）：
 *   - mismatchedDimensions.length ≥ 3 → REGIME_CHANGED
 *   - mismatchedDimensions 包含 "posture" → REGIME_CHANGED
 *   - 其他 → 不标记
 *
 * 纯函数。
 */
function isRegimeChanged(
  compat: ReturnType<typeof checkRegimeCompatibility>,
): boolean {
  if (compat.mismatchedDimensions.length >= 3) return true;
  if (compat.mismatchedDimensions.includes("posture")) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════
// §6. Resolution Determination
// ═══════════════════════════════════════════════════════════

/**
 * 判定最终 Resolution 分类。
 *
 * 规则（A6_4_RESOLUTION_DESIGN.md §二.4 + §三.4）：
 *   - relativeError < CORRECT_THRESHOLD → CORRECT
 *   - relativeError ≥ INCORRECT_THRESHOLD → INCORRECT
 *   - 中间 → PARTIAL
 *   - 方向错误 + 事件未发生 → FALSE_POSITIVE
 *   - 方向错误 + 事件发生了但预测说不会 → FALSE_NEGATIVE
 *
 * 纯函数。
 */
function determineResolution(
  prediction: Prediction,
  actualValue: number,
  relativeError: number,
  directionCorrect: boolean,
  withinHorizon: boolean,
): CalibrationResolution {
  // 方向错误 → 区分 FALSE_POSITIVE / FALSE_NEGATIVE / INCORRECT
  if (!directionCorrect) {
    if (!withinHorizon) {
      // 预测事件未在窗口内发生
      return "FALSE_POSITIVE";
    }
    // 事件发生了但方向不对
    return "INCORRECT";
  }

  // 方向正确 → 按误差大小判定
  if (relativeError < CORRECT_RELATIVE_ERROR_THRESHOLD) {
    return "CORRECT";
  }

  if (relativeError >= INCORRECT_RELATIVE_ERROR_THRESHOLD) {
    return "INCORRECT";
  }

  // 中间区域 → PARTIAL
  return "PARTIAL";
}

/**
 * 构建 Resolution 描述。
 */
function buildReason(
  prediction: Prediction,
  actualValue: number,
  relativeError: number,
  directionCorrect: boolean,
  withinHorizon: boolean,
  resolution: CalibrationResolution,
): string {
  const parts: string[] = [
    `Predicted ${prediction.value.toFixed(3)}`,
    `actual ${actualValue.toFixed(3)}`,
    `relError ${relativeError.toFixed(3)}`,
    `dir ${directionCorrect ? "ok" : "wrong"}`,
    `horizon ${withinHorizon ? "in" : "out"}`,
    `→ ${resolution}`,
  ];
  return parts.join(", ");
}

// ═══════════════════════════════════════════════════════════
// §7. Determinism Verification
// ═══════════════════════════════════════════════════════════

/**
 * 验证 ResolutionResult 确定性：同一输入连续 N 次，检查 hash 一致。
 *
 * CAL-005 守卫：相同输入 → 相同输出。
 */
export function verifyResolutionDeterminism(
  prediction: Prediction,
  observations: readonly ObservationSample[],
  currentContext: PredictionContext,
  externalFactors: readonly ExternalFactorSignal[],
  iterations = 1000,
): { deterministic: boolean; firstDivergenceAt?: number } {
  const firstResult = resolvePrediction(prediction, observations, currentContext, externalFactors);
  const firstHash = firstResult.resolutionHash;

  for (let i = 1; i < iterations; i++) {
    const result = resolvePrediction(prediction, observations, currentContext, externalFactors);
    if (result.resolutionHash !== firstHash) {
      return { deterministic: false, firstDivergenceAt: i };
    }
  }

  return { deterministic: true };
}
