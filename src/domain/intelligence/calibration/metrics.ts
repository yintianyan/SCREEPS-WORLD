/**
 * A6.4 Resolution Metric Registry — 按模型注册 Resolution Metric。
 *
 * 合同锚点：A6_4_CONTRACT.md §二.2 + A6_4_RESOLUTION_DESIGN.md §三.4
 *
 * 职责：
 *   - 注册每个预测模型的 Resolution Metric 函数
 *   - 每个模型定义自己的 "actualValue" 计算方式
 *   - 不建立万能 Resolution Metric
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * 确定性（CAL-005）：
 *   相同 Prediction + 相同 Observation → 相同 Metric 输出。
 *
 * 禁止（A6_4_RESOLUTION_DESIGN.md §三.4）：
 *   - 建立万能 Resolution Metric
 *   - 将不同模型的 Metric 混合
 */

import type { Prediction } from "../prediction/types";
import type { ObservationSample } from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Resolution Metric Function Type
// ═══════════════════════════════════════════════════════════

/**
 * Resolution Metric 函数类型 — 按模型注册。
 *
 * 每个模型定义如何从 Prediction 和 Observation 计算：
 *   - actualValue: 实际值
 *   - relativeError: 相对误差
 *   - directionCorrect: 方向是否正确
 *   - withinHorizon: 是否在预测窗口内
 *
 * 来源：A6_4_CONTRACT.md §二.2
 */
export type ResolutionMetricFn = (
  prediction: Prediction,
  observations: readonly ObservationSample[],
) => {
  actualValue: number;
  relativeError: number;
  directionCorrect: boolean;
  withinHorizon: boolean;
};

// ═══════════════════════════════════════════════════════════
// §2. Metric Registry
// ═══════════════════════════════════════════════════════════

/**
 * Metric Registry — 按模型 key 注册的 Metric 函数集合。
 *
 * 不使用 Map（确保确定性遍历）。
 * 不引用 Game/Memory。
 */
const metricRegistry: Map<string, ResolutionMetricFn> = new Map();

/**
 * 生成模型 key（格式：target-method-modelVersion）。
 *
 * 确定性：相同参数 → 相同 key。
 */
export function makeModelKey(
  target: string,
  method: string,
  modelVersion: number,
): string {
  return `${target}-${method}-${modelVersion}`;
}

/**
 * 注册 Resolution Metric（按 modelKey）。
 *
 * 重复注册会覆盖（用于热重载场景）。
 * 纯函数（对 registry 的 mutation 是 module-level 单例，不影响确定性）。
 */
export function registerResolutionMetric(
  modelKey: string,
  fn: ResolutionMetricFn,
): void {
  metricRegistry.set(modelKey, fn);
}

/**
 * 获取已注册的 Resolution Metric。
 *
 * 如果未注册返回 null。
 */
export function getResolutionMetric(modelKey: string): ResolutionMetricFn | null {
  return metricRegistry.get(modelKey) ?? null;
}

/**
 * 获取所有已注册的 modelKey。
 *
 * 确定性：按字母序排序。
 */
export function getRegisteredModelKeys(): readonly string[] {
  return [...metricRegistry.keys()].sort();
}

/**
 * 清理 Metric Registry（用于测试）。
 */
export function clearResolutionMetricRegistry(): void {
  metricRegistry.clear();
}

// ═══════════════════════════════════════════════════════════
// §3. Energy Shortage Resolution Metric
// ═══════════════════════════════════════════════════════════

/**
 * Energy Shortage Resolution Metric。
 *
 * 来源：A6_4_RESOLUTION_DESIGN.md §三.4
 *
 * Metric 计算：
 *   - actualValue = 窗口内最低储备值（shortage 预测看是否触底）
 *   - relativeError = |actual - predicted| / |predicted|
 *   - directionCorrect = 预测下降 vs 实际下降（误差 < 50%）
 *   - withinHorizon = 窗口内有观测
 *
 * 纯函数。
 */
export function energyShortageMetric(
  prediction: Prediction,
  observations: readonly ObservationSample[],
): {
  actualValue: number;
  relativeError: number;
  directionCorrect: boolean;
  withinHorizon: boolean;
} {
  // 窗口内观测
  const inWindow = observations.filter(
    s => s.tick >= prediction.window.startTick && s.tick <= prediction.window.endTick,
  );

  const withinHorizon = inWindow.length > 0;

  // actualValue = 窗口内最低储备值
  let actualValue: number;
  if (inWindow.length > 0) {
    const sorted = [...inWindow].sort((a, b) => a.value - b.value);
    actualValue = sorted[0]!.value;
  } else if (observations.length > 0) {
    const sorted = [...observations].sort((a, b) => a.tick - b.tick);
    actualValue = sorted[sorted.length - 1]!.value;
  } else {
    actualValue = prediction.value;
  }

  // 相对误差
  let relativeError: number;
  if (Math.abs(prediction.value) < 1e-10) {
    relativeError = Math.abs(actualValue) > 1e-10 ? 1.0 : 0.0;
  } else {
    relativeError = Math.abs(actualValue - prediction.value) / Math.abs(prediction.value);
  }
  relativeError = Number(relativeError.toFixed(3));

  // 方向正确 = 相对误差 < 50%
  const directionCorrect = relativeError < 0.5;

  return {
    actualValue: Number(actualValue.toFixed(3)),
    relativeError,
    directionCorrect,
    withinHorizon,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Spawn Starvation Resolution Metric
// ═══════════════════════════════════════════════════════════

/**
 * Spawn Starvation Resolution Metric。
 *
 * 来源：A6_4_RESOLUTION_DESIGN.md §三.4
 *
 * Metric 计算：
 *   - actualValue = 窗口结束时的队列深度
 *   - relativeError = |actual - predicted| / max(|predicted|, 1)
 *   - directionCorrect = 预测增长 vs 实际增长（趋势匹配）
 *   - withinHorizon = 窗口内有观测
 *
 * 纯函数。
 */
export function spawnStarvationMetric(
  prediction: Prediction,
  observations: readonly ObservationSample[],
): {
  actualValue: number;
  relativeError: number;
  directionCorrect: boolean;
  withinHorizon: boolean;
} {
  // 窗口内观测
  const inWindow = observations.filter(
    s => s.tick >= prediction.window.startTick && s.tick <= prediction.window.endTick,
  );

  const withinHorizon = inWindow.length > 0;

  // actualValue = 窗口内最后一个观测值（队列深度）
  let actualValue: number;
  let firstValue: number | null = null;
  let lastValue: number | null = null;

  if (inWindow.length > 0) {
    const sorted = [...inWindow].sort((a, b) => a.tick - b.tick);
    firstValue = sorted[0]!.value;
    lastValue = sorted[sorted.length - 1]!.value;
    actualValue = lastValue;
  } else if (observations.length > 0) {
    const sorted = [...observations].sort((a, b) => a.tick - b.tick);
    actualValue = sorted[sorted.length - 1]!.value;
    firstValue = sorted[0]!.value;
    lastValue = actualValue;
  } else {
    actualValue = prediction.value;
  }

  // 相对误差 — 队列深度用 max(|predicted|, 1) 防除零
  const denominator = Math.max(Math.abs(prediction.value), 1);
  const relativeError = Number((Math.abs(actualValue - prediction.value) / denominator).toFixed(3));

  // 方向正确 = 预测值和实际值在趋势方向上一致
  // 如果预测值 > 0（预测有队列）且实际值 > 0 → 方向一致
  // 如果预测值接近 0 且实际值也接近 0 → 方向一致
  let directionCorrect: boolean;
  if (firstValue !== null && lastValue !== null) {
    // 有趋势数据 → 检查预测方向和实际趋势方向
    const actualTrendUp = lastValue > firstValue;
    const predictedTrendUp = prediction.value > (firstValue ?? 0);
    directionCorrect = actualTrendUp === predictedTrendUp || relativeError < 0.5;
  } else {
    directionCorrect = relativeError < 0.5;
  }

  return {
    actualValue: Number(actualValue.toFixed(3)),
    relativeError,
    directionCorrect,
    withinHorizon,
  };
}

// ═══════════════════════════════════════════════════════════
// §5. Auto-Registration
// ═══════════════════════════════════════════════════════════

/**
 * 注册默认的 Resolution Metrics。
 *
 * 在模块加载时自动注册已知的模型 Metric。
 * 如果需要重新注册，调用 clearResolutionMetricRegistry() 后重新调用。
 */
export function registerDefaultMetrics(): void {
  registerResolutionMetric(
    makeModelKey("energy-shortage", "trend-extrapolation", 1),
    energyShortageMetric,
  );
  registerResolutionMetric(
    makeModelKey("spawn-starvation", "threshold-projection", 1),
    spawnStarvationMetric,
  );
}

// 模块加载时自动注册
registerDefaultMetrics();
