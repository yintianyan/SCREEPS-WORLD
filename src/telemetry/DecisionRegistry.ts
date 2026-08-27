/** Decision Registry — AI 决策记录中心。 */

import { globalCache } from "../kernel/global-cache";
import type { DecisionRecord } from "./schema";

// ─── Storage ──────────────────────────────────────────────

interface DecisionStore {
  /** Ring buffer of recent decisions */
  records: DecisionRecord[];
  /** 上次 flush tick */
  lastFlushTick: number;
  /** 已 flush 总数 */
  totalFlushed: number;
}

const MAX_DECISIONS = 100;
const FLUSH_INTERVAL = 25; // 每 25 tick flush

function store(): DecisionStore {
  const g = globalCache() as Record<string, unknown>;
  if (!g.__telemetryDecisions) {
    g.__telemetryDecisions = {
      records: [],
      lastFlushTick: 0,
      totalFlushed: 0,
    } as DecisionStore;
  }
  return g.__telemetryDecisions as DecisionStore;
}

// ─── Public API ───────────────────────────────────────────

/** 记录一个 AI 决策。O(1) — ring push。 */
export function recordDecision(
  planner: string,
  decision: string,
  reason: string,
  options?: {
    target?: string;
    confidence?: number;
    expectedOutcome?: Record<string, unknown>;
  },
): void {
  const s = store();
  // Ring buffer: 超容量时丢弃最老的
  if (s.records.length >= MAX_DECISIONS) {
    s.records.shift();
  }
  s.records.push({
    tick: Game.time,
    planner,
    decision,
    reason,
    target: options?.target,
    confidence: options?.confidence,
    expectedOutcome: options?.expectedOutcome,
  });
}

/** 排空并返回所有缓冲的决策记录。 */
export function drainDecisions(): DecisionRecord[] {
  const s = store();
  const records = s.records;
  s.records = [];
  s.lastFlushTick = Game.time;
  s.totalFlushed += records.length;
  return records;
}

/** 是否到了 flush 时间。 */
export function shouldFlushDecisions(): boolean {
  const s = store();
  return Game.time - s.lastFlushTick >= FLUSH_INTERVAL && s.records.length > 0;
}

/** 获取缓冲区当前决策数。 */
export function decisionBufferSize(): number {
  return store().records.length;
}

/** 获取已 flush 总数。 */
export function totalDecisionsFlushed(): number {
  return store().totalFlushed;
}

// ─── Decision → Outcome 追踪（1.md §29）───────────────────

/**
 * 期望 vs 实际结果追踪。
 * 当一个 Operation/Expansion 完成时，可以回溯对应 Decision，
 * 比较 expectedOutcome vs actualOutcome，计算 deviation。
 */
interface OutcomeRecord {
  readonly decisionTick: number;
  readonly planner: string;
  readonly decision: string;
  readonly expected: Record<string, unknown>;
  readonly actual: Record<string, unknown>;
  readonly deviation: number; // 百分比偏差
  readonly tick: number;
}

interface OutcomeStore {
  records: OutcomeRecord[];
  lastFlushTick: number;
}

function outcomeStore(): OutcomeStore {
  const g = globalCache() as Record<string, unknown>;
  if (!g.__telemetryOutcomes) {
    g.__telemetryOutcomes = {
      records: [],
      lastFlushTick: 0,
    } as OutcomeStore;
  }
  return g.__telemetryOutcomes as OutcomeStore;
}

const MAX_OUTCOMES = 50;

/** 记录一个 Decision → Outcome 评估。 */
export function recordOutcome(
  decisionTick: number,
  planner: string,
  decision: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  deviation: number,
): void {
  const s = outcomeStore();
  if (s.records.length >= MAX_OUTCOMES) {
    s.records.shift();
  }
  s.records.push({
    decisionTick,
    planner,
    decision,
    expected,
    actual,
    deviation,
    tick: Game.time,
  });
}

/** 排空 Outcome 记录。 */
export function drainOutcomes(): OutcomeRecord[] {
  const s = outcomeStore();
  const records = s.records;
  s.records = [];
  s.lastFlushTick = Game.time;
  return records;
}

export type { OutcomeRecord };
