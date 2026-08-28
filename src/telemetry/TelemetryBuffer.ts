/** Telemetry Buffer — flush 前的指标快照缓冲区。 */

import { globalCache } from "../kernel/global-cache";
import type { MetricSnapshot } from "./MetricRegistry";
import { snapshotMetrics, resetCounters } from "./MetricRegistry";
import type { DecisionRecord } from "./schema";
import type { OutcomeRecord } from "./DecisionRegistry";
import { drainDecisions, shouldFlushDecisions, drainOutcomes } from "./DecisionRegistry";

// ─── Buffer Structure ─────────────────────────────────────

interface TelemetryBuffer {
  /** 上次 flush tick */
  lastFlushTick: number;
  /** flush 次数计数 */
  flushCount: number;
  /** 上次 flush 的 CPU 开销 */
  lastFlushCpu: number;
  /** 最近一次 flush 的 metric 数量 */
  lastMetricCount: number;
  /** 最近一次 flush 的 event 数量（已停用 EventRegistry，恒为 0） */
  lastEventCount: number;
  /** 最近一次 flush 的 decision 数量 */
  lastDecisionCount: number;
}

const FLUSH_INTERVAL = 10;

function buffer(): TelemetryBuffer {
  const g = globalCache() as Record<string, unknown>;
  if (!g.__telemetryBuffer) {
    g.__telemetryBuffer = {
      lastFlushTick: 0,
      flushCount: 0,
      lastFlushCpu: 0,
      lastMetricCount: 0,
      lastEventCount: 0,
      lastDecisionCount: 0,
    } as TelemetryBuffer;
  }
  return g.__telemetryBuffer as TelemetryBuffer;
}

// ─── Flush Data Package ───────────────────────────────────

export interface FlushPackage {
  readonly tick: number;
  readonly metrics: MetricSnapshot[];
  readonly decisions: DecisionRecord[];
  readonly outcomes: OutcomeRecord[];
}

/**
 * 收集所有数据，构建一个 flush package。
 * 调用后 buffer 被清空（drain 语义）。
 */
export function collectFlushPackage(): FlushPackage {
  const metrics = snapshotMetrics();
  const decisions = shouldFlushDecisions() ? drainDecisions() : [];
  const outcomes = drainOutcomes();

  return {
    tick: Game.time,
    metrics,
    decisions,
    outcomes,
  };
}

/** 是否到了 flush 时间。 */
export function shouldFlush(): boolean {
  const buf = buffer();
  return Game.time - buf.lastFlushTick >= FLUSH_INTERVAL;
}

/** 记录 flush 完成（更新计数器）。 */
export function markFlushed(cpuCost: number, metricCount: number, eventCount: number, decisionCount: number): void {
  const buf = buffer();
  buf.lastFlushTick = Game.time;
  buf.flushCount++;
  buf.lastFlushCpu = cpuCost;
  buf.lastMetricCount = metricCount;
  buf.lastEventCount = eventCount;
  buf.lastDecisionCount = decisionCount;
}

/**
 * 执行 flush：
 * 1. 收集 flush package
 * 2. 重置 counters（gauge/histogram 保持）
 * 3. 返回 package 供 exporter 消费

 * 用法：TelemetryFlush.run() 内部调用此函数后，
 * 将返回的 package 传给各 exporter。
 */
export function flush(): FlushPackage {
  const cpuBefore = Game.cpu.getUsed();
  const pkg = collectFlushPackage();
  // 重置 counters — 下一个 flush 窗口重新从 0 计数
  resetCounters();
  const cpuAfter = Game.cpu.getUsed();
  markFlushed(
    cpuAfter - cpuBefore,
    pkg.metrics.length,
    0, // events 已停用
    pkg.decisions.length,
  );
  return pkg;
}

// ─── Buffer Status ────────────────────────────────────────

export function bufferStatus(): {
  lastFlushTick: number;
  flushCount: number;
  lastFlushCpu: number;
  lastMetricCount: number;
  lastEventCount: number;
  lastDecisionCount: number;
} {
  const buf = buffer();
  return {
    lastFlushTick: buf.lastFlushTick,
    flushCount: buf.flushCount,
    lastFlushCpu: buf.lastFlushCpu,
    lastMetricCount: buf.lastMetricCount,
    lastEventCount: buf.lastEventCount,
    lastDecisionCount: buf.lastDecisionCount,
  };
}
