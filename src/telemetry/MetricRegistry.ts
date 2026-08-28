/** Metric Registry — 指标注册中心。 */

import {
  buildMetricName,
  type AllowedLabel,
  type CounterMetric,
  type GaugeMetric,
  type HistogramMetric,
  type LabelSet,
  type TelemetryDomain,
  type TimerHandle,
} from "./schema";

export type { TimerHandle };
import { globalCache } from "../kernel/global-cache";

// ─── Label Key ────────────────────────────────────────────

/** 将 LabelSet 序列化为稳定的 label key（用于 Map 查找）。 */
function labelKey(labels: LabelSet): string {
  const entries = Object.entries(labels).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}="${v}"`).join(",");
}

// ─── Per-label-set Metric Instance ────────────────────────

interface CounterInstance {
  value: number;
}

interface GaugeInstance {
  value: number;
}

interface HistogramInstance {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

// ─── Metric Descriptor ─────────────────────────────────────

interface MetricDescriptor {
  readonly domain: TelemetryDomain;
  readonly metric: string;
  readonly unit?: string;
  readonly help: string;
  readonly allowedLabels: readonly AllowedLabel[];
  readonly kind: "counter" | "gauge" | "histogram";
  /**
   * 若为 true，counter 在 flush 时不会重置（累积计数器）。
   * 用于低频事件 counter（如 T3 evaluation），避免每次 flush 归零导致 Prometheus rate() 看到 0。
   * 默认 false：flush 窗口内递增，flush 后归零（适合高频每 tick 递增的 counter）。
   */
  readonly cumulative?: boolean;
}

// ─── Storage on globalCache ───────────────────────────────

interface MetricStore {
  /** Metric name → descriptor */
  descriptors: Map<string, MetricDescriptor>;
  /** Counter: name → labelKey → instance */
  counters: Map<string, Map<string, CounterInstance>>;
  /** Gauge: name → labelKey → instance */
  gauges: Map<string, Map<string, GaugeInstance>>;
  /** Histogram: name → labelKey → instance */
  histograms: Map<string, Map<string, HistogramInstance>>;
  /** Histogram bucket thresholds per metric */
  histogramBuckets: Map<string, number[]>;
}

const DEFAULT_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5];

function store(): MetricStore {
  const g = globalCache() as Record<string, unknown>;
  if (!g.__telemetryMetrics) {
    g.__telemetryMetrics = {
      descriptors: new Map(),
      counters: new Map(),
      gauges: new Map(),
      histograms: new Map(),
      histogramBuckets: new Map(),
    } as MetricStore;
  }
  return g.__telemetryMetrics as MetricStore;
}

// ─── Public API ────────────────────────────────────────────

/**
 * 注册或获取一个 Counter。
 * @param cumulative 若为 true，flush 时不重置（累积计数器，适合低频事件如 T3 evaluation）。
 */
export function registerCounter(
  domain: TelemetryDomain,
  metric: string,
  help: string,
  labels: AllowedLabel[] = [],
  unit?: string,
  cumulative?: boolean,
): void {
  const name = buildMetricName(domain, metric, unit);
  const s = store();
  if (!s.descriptors.has(name)) {
    s.descriptors.set(name, { domain, metric, unit, help, allowedLabels: labels, kind: "counter", cumulative: cumulative === true });
    s.counters.set(name, new Map());
  }
}

/** 注册或获取一个 Gauge。 */
export function registerGauge(
  domain: TelemetryDomain,
  metric: string,
  help: string,
  labels: AllowedLabel[] = [],
  unit?: string,
): void {
  const name = buildMetricName(domain, metric, unit);
  const s = store();
  if (!s.descriptors.has(name)) {
    s.descriptors.set(name, { domain, metric, unit, help, allowedLabels: labels, kind: "gauge" });
    s.gauges.set(name, new Map());
  }
}

/** 注册或获取一个 Histogram。 */
export function registerHistogram(
  domain: TelemetryDomain,
  metric: string,
  help: string,
  labels: AllowedLabel[] = [],
  buckets: number[] = DEFAULT_BUCKETS,
  unit?: string,
): void {
  const name = buildMetricName(domain, metric, unit);
  const s = store();
  if (!s.descriptors.has(name)) {
    s.descriptors.set(name, { domain, metric, unit, help, allowedLabels: labels, kind: "histogram" });
    s.histograms.set(name, new Map());
    s.histogramBuckets.set(name, buckets);
  }
}

/** 递增 Counter。 */
export function incrementCounter(name: string, value: number = 1, labels: LabelSet = {}): void {
  const s = store();
  const map = s.counters.get(name);
  if (!map) return; // 未注册的 metric 静默跳过
  const key = labelKey(labels);
  let inst = map.get(key);
  if (!inst) {
    inst = { value: 0 };
    map.set(key, inst);
  }
  inst.value += value;
}

/** 设置 Gauge。 */
export function setGauge(name: string, value: number, labels: LabelSet = {}): void {
  const s = store();
  const map = s.gauges.get(name);
  if (!map) return;
  const key = labelKey(labels);
  let inst = map.get(key);
  if (!inst) {
    inst = { value: 0 };
    map.set(key, inst);
  }
  inst.value = value;
}

/** 观察 Histogram 值。 */
export function observeHistogram(name: string, value: number, labels: LabelSet = {}): void {
  const s = store();
  const map = s.histograms.get(name);
  if (!map) return;
  const key = labelKey(labels);
  let inst = map.get(key);
  if (!inst) {
    const buckets = s.histogramBuckets.get(name) ?? DEFAULT_BUCKETS;
    inst = { count: 0, sum: 0, buckets: new Map(buckets.map(b => [b, 0])) };
    map.set(key, inst);
  }
  inst.count++;
  inst.sum += value;
  for (const [threshold] of inst.buckets) {
    if (value <= threshold) {
      inst.buckets.set(threshold, (inst.buckets.get(threshold) ?? 0) + 1);
    }
  }
}

/** 开始计时器，返回 handle。end() 返回耗时（秒）。 */
export function startTimer(name: string, labels: LabelSet = {}): TimerHandle {
  const before = Game.cpu.getUsed();
  return {
    end(): number {
      const after = Game.cpu.getUsed();
      const elapsed = after - before;
      const seconds = elapsed / 1000; // CPU seconds
      observeHistogram(name, seconds, labels);
      return seconds;
    },
  };
}

// ─── Snapshot for Export ───────────────────────────────────

export interface MetricSnapshot {
  readonly name: string;
  readonly help: string;
  readonly kind: "counter" | "gauge" | "histogram";
  readonly domain: TelemetryDomain;
  readonly entries: ReadonlyArray<{
    readonly labels: LabelSet;
    readonly value: number;
  }>;
  /** Histogram-only fields */
  readonly buckets?: number[];
  readonly histogramEntries?: ReadonlyArray<{
    readonly labels: LabelSet;
    readonly count: number;
    readonly sum: number;
    readonly bucketCounts: ReadonlyArray<{ threshold: number; count: number }>;
  }>;
}

/** 导出所有指标快照（供 exporter 消费）。 */
export function snapshotMetrics(): MetricSnapshot[] {
  const s = store();
  const results: MetricSnapshot[] = [];

  // Counters
  for (const [name, desc] of s.descriptors) {
    if (desc.kind === "counter") {
      const map = s.counters.get(name);
      if (!map) continue;
      const entries: { labels: LabelSet; value: number }[] = [];
      for (const [key, inst] of map) {
        entries.push({ labels: parseLabelKey(key), value: inst.value });
      }
      results.push({ name, help: desc.help, kind: "counter", domain: desc.domain, entries });
    } else if (desc.kind === "gauge") {
      const map = s.gauges.get(name);
      if (!map) continue;
      const entries: { labels: LabelSet; value: number }[] = [];
      for (const [key, inst] of map) {
        entries.push({ labels: parseLabelKey(key), value: inst.value });
      }
      results.push({ name, help: desc.help, kind: "gauge", domain: desc.domain, entries });
    } else if (desc.kind === "histogram") {
      const map = s.histograms.get(name);
      if (!map) continue;
      const buckets = s.histogramBuckets.get(name) ?? DEFAULT_BUCKETS;
      const histEntries: Array<{
        labels: LabelSet;
        count: number;
        sum: number;
        bucketCounts: Array<{ threshold: number; count: number }>;
      }> = [];
      for (const [key, inst] of map) {
        const bucketCounts = buckets.map(t => ({ threshold: t, count: inst.buckets.get(t) ?? 0 }));
        histEntries.push({
          labels: parseLabelKey(key),
          count: inst.count,
          sum: inst.sum,
          bucketCounts,
        });
      }
      results.push({
        name,
        help: desc.help,
        kind: "histogram",
        domain: desc.domain,
        entries: [],
        buckets,
        histogramEntries: histEntries,
      });
    }
  }

  return results;
}

/** 解析 label key 回 LabelSet。 */
function parseLabelKey(key: string): LabelSet {
  if (!key) return {};
  const result: LabelSet = {};
  const parts = key.split(",");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).replace(/"/g, "");
    const v = part.slice(eq + 1).replace(/"/g, "");
    result[k as AllowedLabel] = v;
  }
  return result;
}

/**
 * 重置 Counter（flush 后调用）。Gauge 和 Histogram 不重置（保持当前值/累积）。
 * 标记为 cumulative 的 counter 不重置（适合低频事件，依赖 Prometheus rate() 计算速率）。
 */
export function resetCounters(): void {
  const s = store();
  for (const [name, map] of s.counters) {
    const desc = s.descriptors.get(name);
    if (desc?.cumulative) continue; // 累积 counter 不重置
    for (const inst of map.values()) {
      inst.value = 0;
    }
  }
}

/** 获取已注册指标数量（R6 上限审计用）。 */
export function metricCount(): number {
  return store().descriptors.size;
}
