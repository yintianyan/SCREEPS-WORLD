/** Tick Aggregator — 每 tick 本地聚合 + 采集频率控制。 */

import { COLLECTION_FREQUENCY } from "./schema";
import { globalCache } from "../kernel/global-cache";

// ─── Frequency Gate ───────────────────────────────────────

interface FrequencyState {
  /** 上次采集 tick（per domain） */
  lastCollected: Record<string, number>;
}

function state(): FrequencyState {
  const g = globalCache() as Record<string, unknown>;
  if (!g.__telemetryFreq) {
    g.__telemetryFreq = {
      lastCollected: {},
    } as FrequencyState;
  }
  return g.__telemetryFreq as FrequencyState;
}

/**
 * 判断某域是否在本 tick 需要采集。
 * @param domainKey 频率表 key（如 "cpu", "creep", "economy"）
 * @returns true if should collect this tick
 */
export function shouldCollect(domainKey: string): boolean {
  const freq = COLLECTION_FREQUENCY[domainKey];
  if (freq === undefined) return false; // 未注册频率
  if (freq === 0) return false; // 事件驱动，不做周期采集
  if (freq === 1) return true; // 每 tick
  const s = state();
  const last = s.lastCollected[domainKey] ?? -freq;
  return Game.time - last >= freq;
}

/** 标记某域已采集。 */
export function markCollected(domainKey: string): void {
  const s = state();
  s.lastCollected[domainKey] = Game.time;
}

// ─── Tick Aggregation ─────────────────────────────────────

export interface TickAggregationResult {
  /** 本 tick 是否采集了各域 */
  collected: string[];
  /** 本 tick 是否应该 flush（基于 flush interval） */
  shouldFlush: boolean;
  /** flush 原因（如 "interval" 或 "buffer_full"） */
  flushReason?: string;
}

const FLUSH_INTERVAL = 10;

/**
 * 在 tick 末尾调用：汇总本 tick 采集了哪些域，判断是否需要 flush。
 */
export function aggregateTick(): TickAggregationResult {
  const s = state();
  const collected: string[] = [];

  for (const [key, freq] of Object.entries(COLLECTION_FREQUENCY)) {
    if (freq > 0 && Game.time - (s.lastCollected[key] ?? -freq) >= freq) {
      collected.push(key);
    }
  }

  // flush 判断：每 FLUSH_INTERVAL tick 一次
  const shouldFlush = Game.time % FLUSH_INTERVAL === 0;

  return {
    collected,
    shouldFlush,
    flushReason: shouldFlush ? "interval" : undefined,
  };
}

/** 重置频率状态（global reset 后由首 tick 重建）。 */
export function resetFrequencyState(): void {
  const g = globalCache() as Record<string, unknown>;
  g.__telemetryFreq = { lastCollected: {} };
}
