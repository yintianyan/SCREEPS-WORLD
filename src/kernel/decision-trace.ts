/** DecisionTrace — 决策追踪基础结构（先建后用）。 */

import { globalCache } from "./global-cache";

export type TraceLayer = "goal" | "policy" | "intent" | "demand" | "task" | "action";

export interface TraceEntry {
  readonly seq: number;
  readonly tick: number;
  readonly layer: TraceLayer;
  /** 稳定键（Goal id / Intent stableKey / Task id…）。 */
  readonly key: string;
  /** 一句话摘要（≤120 字符，截断由本模块执行）。 */
  readonly summary: string;
  /** 关联引用（跨层串联：如 task 条目引用其 intentKey 与 goalId）。 */
  readonly refs?: { goalId?: string; intentKey?: string; taskId?: string };
}

export interface LayerRing {
  buf: (TraceEntry | undefined)[];
  head: number;
  count: number;
  nextSeq: number;
}

/** 挂在 globalCache 上的整体形态：按层的 ring 表。 */
export type TraceState = Partial<Record<TraceLayer, LayerRing>>;

const CAPACITY_PER_LAYER = 128;
const SUMMARY_MAX = 120;

function layerBuf(layer: TraceLayer): LayerRing {
  const g = globalCache();
  if (!g.decisionTrace) g.decisionTrace = {};
  const store = g.decisionTrace;
  let ring = store[layer];
  if (!ring) {
    ring = { buf: new Array(CAPACITY_PER_LAYER), head: 0, count: 0, nextSeq: 1 };
    store[layer] = ring;
  }
  return ring;
}

/** 记录一条决策轨迹。O(1)。 */
export function traceDecision(
  layer: TraceLayer,
  key: string,
  summary: string,
  refs?: TraceEntry["refs"],
  tick: number = Game.time,
): void {
  const b = layerBuf(layer);
  const entry: TraceEntry = {
    seq: b.nextSeq++,
    tick,
    layer,
    key,
    summary: summary.length > SUMMARY_MAX ? summary.slice(0, SUMMARY_MAX - 1) + "…" : summary,
    refs,
  };
  b.buf[b.head] = entry;
  b.head = (b.head + 1) % CAPACITY_PER_LAYER;
  if (b.count < CAPACITY_PER_LAYER) b.count++;
}

/** 按时间序读取某层最近 ≤limit 条。 */
export function getDecisionTrace(layer: TraceLayer, limit = 32): TraceEntry[] {
  const b = layerBuf(layer);
  const n = Math.min(b.count, limit);
  const start = b.count < CAPACITY_PER_LAYER ? 0 : b.head;
  const out: TraceEntry[] = [];
  for (let i = b.count - n; i < b.count; i++) {
    const idx = (start + i) % CAPACITY_PER_LAYER;
    const e = b.buf[idx];
    if (e) out.push(e);
  }
  return out;
}

/** 跨层串联查询：按引用键（如 intentKey）拉取相关轨迹（诊断用）。 */
export function traceByKey(key: string): TraceEntry[] {
  const layers: TraceLayer[] = ["goal", "policy", "intent", "demand", "task", "action"];
  const out: TraceEntry[] = [];
  for (const l of layers) {
    for (const e of getDecisionTrace(l, CAPACITY_PER_LAYER)) {
      if (e.key === key || e.refs?.intentKey === key || e.refs?.taskId === key || e.refs?.goalId === key) {
        out.push(e);
      }
    }
  }
  return out;
}

/** 测试辅助。 */
export function resetDecisionTraceForTest(): void {
  globalCache().decisionTrace = undefined;
}
