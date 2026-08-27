/** A6.3.1 TimeSeries<T> — 通用有界时间序列容器。 */

// ═══════════════════════════════════════════════════════════
// §1. Types
// ═══════════════════════════════════════════════════════════

/** 时间序列采样点。 */
export interface TimeSeriesPoint<T = number> {
  /** 采样发生的 tick。 */
  readonly tick: number;
  /** 采样值。 */
  readonly value: T;
}

/** 线性回归结果。 */
export interface LinearRegressionResult {
  /** 斜率（value/tick）。 */
  readonly slope: number;
  /** 截距。 */
  readonly intercept: number;
  /** 决定系数 R²（0-1）。 */
  readonly r2: number;
  /** 样本数。 */
  readonly samples: number;
}

/** 趋势方向。 */
export type TrendDirection = "up" | "down" | "flat" | null;

// ═══════════════════════════════════════════════════════════
// §2. TimeSeries Container
// ═══════════════════════════════════════════════════════════

/**
 * TimeSeries<T> — 有界时间序列容器。

 * 容量固定，超出时移除最旧的采样点（FIFO）。
 * 所有操作 O(n) 但 n ≤ capacity（默认 100）。

 * 确定性保证：
 *   - push 不依赖随机/时间来源
 *   - recent 返回按 tick 升序排序的数组
 *   - linearRegression 对相同输入产生相同结果
 *   - 所有浮点结果用 toFixed(3) 截断
 */
export interface TimeSeries<T = number> {
  /** 底层采样点数组。 */
  samples: TimeSeriesPoint<T>[];
  /** 最大容量。 */
  capacity: number;
  /** 当前采样点数。 */
  count: number;
}

/**
 * 创建新的 TimeSeries 容器。

 * 纯函数 — 返回新对象，不修改输入。
 */
export function createTimeSeries<T>(capacity: number): TimeSeries<T> {
  return {
    samples: [],
    capacity: Math.max(1, capacity),
    count: 0,
  };
}

/**
 * 向 TimeSeries 压入一个采样点。

 * 超出容量时移除最旧的采样点（FIFO 淘汰）。
 * 如果同一 tick 已有采样点，更新值（不重复）。

 * 确定性：不使用 Math.random / Date.now。
 */
export function pushSample<T>(ts: TimeSeries<T>, tick: number, value: T): void {
  // 检查是否已有同 tick 采样点
  const existingIdx = ts.samples.findIndex(s => s.tick === tick);
  if (existingIdx >= 0) {
    ts.samples[existingIdx] = { tick, value };
    return;
  }

  // 添加新采样点
  ts.samples.push({ tick, value });

  // 容量管理：超出时移除最旧的
  if (ts.samples.length > ts.capacity) {
    // 排序后移除第一个（最旧的）
    ts.samples.sort((a, b) => a.tick - b.tick);
    ts.samples.shift();
  }

  ts.count = ts.samples.length;
}

/**
 * 获取最近的 N 个采样点（按 tick 升序）。

 * 确定性：先排序再切片，保证遍历顺序一致。
 */
export function recentSamples<T>(ts: TimeSeries<T>, n: number): TimeSeriesPoint<T>[] {
  const sorted = [...ts.samples].sort((a, b) => a.tick - b.tick);
  return sorted.slice(-Math.min(n, sorted.length));
}

/**
 * 获取所有采样点（按 tick 升序）。

 * 确定性：排序后返回。
 */
export function allSamples<T>(ts: TimeSeries<T>): TimeSeriesPoint<T>[] {
  return [...ts.samples].sort((a, b) => a.tick - b.tick);
}

/**
 * 对数值型 TimeSeries 执行线性回归。

 * 返回 { slope, intercept, r2, samples }。
 * 样本数 < 2 时返回 null（无法回归）。

 * 确定性：相同输入 → 相同输出。浮点结果 toFixed(3)。
 */
export function linearRegression(ts: TimeSeries<number>): LinearRegressionResult | null {
  const samples = recentSamples(ts, ts.capacity);
  const n = samples.length;

  if (n < 2) return null;

  // 最小二乘法
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const s of samples) {
    sumX += s.tick;
    sumY += s.value;
    sumXY += s.tick * s.value;
    sumX2 += s.tick * s.tick;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (Math.abs(denominator) < 1e-10) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // 计算 R²
  const meanY = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (const s of samples) {
    const predicted = slope * s.tick + intercept;
    ssRes += (s.value - predicted) ** 2;
    ssTot += (s.value - meanY) ** 2;
  }
  const r2 = ssTot > 1e-10 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  return {
    slope: Number(slope.toFixed(6)),
    intercept: Number(intercept.toFixed(6)),
    r2: Number(Math.min(1, Math.max(0, r2)).toFixed(3)),
    samples: n,
  };
}

/**
 * 计算数值型 TimeSeries 的均值。

 * 样本数 = 0 时返回 null。
 * 确定性：排序后遍历，浮点结果 toFixed(3)。
 */
export function meanValue(ts: TimeSeries<number>): number | null {
  const samples = allSamples(ts);
  if (samples.length === 0) return null;
  const sum = samples.reduce((a, s) => a + s.value, 0);
  return Number((sum / samples.length).toFixed(3));
}

/**
 * 判断数值型 TimeSeries 的趋势方向。

 * 基于线性回归斜率：
 *   slope > threshold → "up"
 *   slope < -threshold → "down"
 *   |slope| <= threshold → "flat"
 *   样本不足 → null

 * threshold 默认 = 0.001（避免浮点噪声误判）。
 * 确定性：相同输入 → 相同输出。
 */
export function trendDirection(ts: TimeSeries<number>, threshold = 0.001): TrendDirection {
  const reg = linearRegression(ts);
  if (!reg) return null;
  if (reg.slope > threshold) return "up";
  if (reg.slope < -threshold) return "down";
  return "flat";
}

// ═══════════════════════════════════════════════════════════
// §3. GC / TTL
// ═══════════════════════════════════════════════════════════

/**
 * 清理 TimeSeries 中超过 maxAge tick 的采样点。

 * 确定性 GC：删除所有 tick < (currentTick - maxAge) 的采样点。
 * 不改变 samples 顺序（只 filter）。

 * 返回清理的采样点数。
 */
export function gcTimeSeries<T>(ts: TimeSeries<T>, currentTick: number, maxAge: number): { cleaned: number } {
  const before = ts.samples.length;
  const cutoff = currentTick - maxAge;
  ts.samples = ts.samples.filter(s => s.tick >= cutoff);
  ts.count = ts.samples.length;
  return { cleaned: before - ts.samples.length };
}

/**
 * 获取 TimeSeries 统计信息（用于可观测性）。

 * 确定性：遍历前排序。
 */
export function timeSeriesStats<T>(ts: TimeSeries<T>): {
  count: number;
  capacity: number;
  oldestTick: number | null;
  newestTick: number | null;
  spanTicks: number;
} {
  const samples = allSamples(ts);
  if (samples.length === 0) {
    return { count: 0, capacity: ts.capacity, oldestTick: null, newestTick: null, spanTicks: 0 };
  }
  const oldest = samples[0]!;
  const newest = samples[samples.length - 1]!;
  return {
    count: samples.length,
    capacity: ts.capacity,
    oldestTick: oldest.tick,
    newestTick: newest.tick,
    spanTicks: newest.tick - oldest.tick,
  };
}
