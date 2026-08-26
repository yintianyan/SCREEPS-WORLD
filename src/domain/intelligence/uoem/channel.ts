/**
 * UOEM Core — Memory-backed bounded OutcomeChannel.
 *
 * STEP 1.2：FIFO 有界 OutcomeChannel 实现。
 *
 * 核心约束：
 *   capacity = 32（固定不可变）
 *   FIFO（旧→新）
 *   terminal OutcomeEvent only（MilestoneEvent 禁止进入）
 *   duplicate outcome 被拒绝（operationId 去重）
 *   bounded（无论 producer 数量 / tick / duplicate / restart 都不突破 capacity）
 *   drain 后已消费事件移除
 *   reset/restart 后 Memory-backed event identity 保持
 *
 * 纯 Domain 层：不引用 Game / RawMemory / CPU。
 * Channel 不拥有 Decision Authority，不执行 Game API。
 * Channel 是 Event Transport，不是 State Store，不是 Strategy。
 */

import type { OperationId } from "./identity";
import type { OutcomeEvent, UOEMEvent } from "./guards";
import { isTerminalEvent } from "./guards";

// ── Constants ────────────────────────────────────────────────

/** OutcomeChannel 固定容量。 */
export const OUTCOME_CHANNEL_CAPACITY = 32;

// ── Types ────────────────────────────────────────────────────

/**
 * OutcomeChannel Entry — channel 中的一条记录。
 * 只能接受 OutcomeEvent，不接受 MilestoneEvent。
 */
export interface OutcomeChannelEntry {
  readonly event: OutcomeEvent;
  readonly sequence: number;
}

/**
 * Emit 结果。
 */
export type EmitResult =
  | { readonly status: "ACCEPTED"; readonly sequence: number }
  | { readonly status: "DUPLICATE_REJECTED"; readonly existingSequence: number }
  | { readonly status: "OVERFLOW"; readonly evictedSequence: number };

/**
 * OutcomeChannel 的可序列化快照（用于 Memory 持久化）。
 *
 * 存储格式：{ entries, seq, seen }
 * - entries: OutcomeChannelEntry[]（FIFO，cap=32）
 * - seq: 下一个 sequence number
 * - seen: 已见 operationId 集合（与 entries 同步，用于 O(1) 幂等检查）
 *
 * Memory 预算：32 × ~100B (entry) + 32 × ~40B (seen) ≈ 4.5KB worst-case
 */
export interface OutcomeChannelSnapshot {
  entries: OutcomeChannelEntry[];
  seq: number;
  seen: string[]; // OperationId 的字符串表示
}

// ── Channel Factory ──────────────────────────────────────────

/**
 * 创建空的 OutcomeChannel 快照。
 */
export function createEmptySnapshot(): OutcomeChannelSnapshot {
  return { entries: [], seq: 0, seen: [] };
}

// ── Core Operations（纯函数）──────────────────────────────────

/**
 * 获取 channel 当前大小。
 */
export function channelSize(snapshot: OutcomeChannelSnapshot): number {
  return snapshot.entries.length;
}

/**
 * 获取 channel 容量（固定 32）。
 */
export function channelCapacity(): number {
  return OUTCOME_CHANNEL_CAPACITY;
}

/**
 * Peek — 返回 channel 中的事件（不移除）。
 * @param limit 最多返回多少条（默认全部）
 */
export function peek(snapshot: OutcomeChannelSnapshot, limit?: number): OutcomeEvent[] {
  const entries = limit !== undefined ? snapshot.entries.slice(0, limit) : snapshot.entries;
  return entries.map(e => e.event);
}

/**
 * Emit — 向 channel 提交一个事件。
 *
 * 规则：
 * 1. 只接受 OutcomeEvent（MilestoneEvent 在类型层被拒绝）
 * 2. 同一 operationId 的第二条 OutcomeEvent → DUPLICATE_REJECTED
 * 3. 超过 capacity 时，FIFO 溢出最老条目（OVERFLOW）
 *
 * 返回新的 snapshot（不可变）和 emit 结果。
 */
export function emitOutcome(
  snapshot: OutcomeChannelSnapshot,
  event: OutcomeEvent,
): { snapshot: OutcomeChannelSnapshot; result: EmitResult } {
  // 幂等检查：operationId 已存在？
  const existingIdx = snapshot.entries.findIndex(
    e => e.event.operationId === event.operationId,
  );

  if (existingIdx >= 0) {
    return {
      snapshot,
      result: {
        status: "DUPLICATE_REJECTED",
        existingSequence: snapshot.entries[existingIdx]!.sequence,
      },
    };
  }

  // 分配 sequence
  const sequence = snapshot.seq;
  const entry: OutcomeChannelEntry = { event, sequence };

  // FIFO 追加 + bounded 溢出
  const newEntries = [...snapshot.entries, entry];
  let evictedSequence: number | undefined;

  if (newEntries.length > OUTCOME_CHANNEL_CAPACITY) {
    // 溢出最老条目
    const evicted = newEntries.shift()!;
    evictedSequence = evicted.sequence;
  }

  // 同步 seen 集合（移除溢出条目的 operationId，添加新条目的 operationId）
  const newSeen = newEntries.map(e => e.event.operationId as unknown as string);

  return {
    snapshot: {
      entries: newEntries,
      seq: snapshot.seq + 1,
      seen: newSeen,
    },
    result: evictedSequence !== undefined
      ? { status: "OVERFLOW", evictedSequence }
      : { status: "ACCEPTED", sequence },
  };
}

/**
 * Drain — 消费并移除所有事件（FIFO 顺序）。
 *
 * 返回所有事件，并清空 channel。
 * drain 后再次 drain 返回空数组。
 */
export function drain(snapshot: OutcomeChannelSnapshot): {
  events: OutcomeEvent[];
  snapshot: OutcomeChannelSnapshot;
} {
  const events = snapshot.entries.map(e => e.event);
  return {
    events,
    snapshot: { entries: [], seq: snapshot.seq, seen: [] },
  };
}

/**
 * Drain N — 消费并移除前 N 条事件。
 */
export function drainN(
  snapshot: OutcomeChannelSnapshot,
  n: number,
): {
  events: OutcomeEvent[];
  snapshot: OutcomeChannelSnapshot;
} {
  const toTake = Math.min(n, snapshot.entries.length);
  const taken = snapshot.entries.slice(0, toTake);
  const remaining = snapshot.entries.slice(toTake);
  const events = taken.map(e => e.event);
  return {
    events,
    snapshot: {
      entries: remaining,
      seq: snapshot.seq,
      seen: remaining.map(e => e.event.operationId as unknown as string),
    },
  };
}

// ── Safety Guards ────────────────────────────────────────────

/**
 * 验证 snapshot 合法性。
 * - entries 不超过 capacity
 * - seen 与 entries 同步
 * - sequence 单调递增
 */
export function isValidSnapshot(snapshot: OutcomeChannelSnapshot): boolean {
  if (snapshot.entries.length > OUTCOME_CHANNEL_CAPACITY) return false;
  if (snapshot.seen.length !== snapshot.entries.length) return false;
  for (let i = 0; i < snapshot.entries.length; i++) {
    if (snapshot.entries[i]!.event.operationId as unknown as string !== snapshot.seen[i]) {
      return false;
    }
  }
  // sequence 单调递增
  for (let i = 1; i < snapshot.entries.length; i++) {
    if (snapshot.entries[i]!.sequence <= snapshot.entries[i - 1]!.sequence) {
      return false;
    }
  }
  return true;
}

/**
 * 从 UOEMEvent 提取 OutcomeEvent（如果事件是 terminal）。
 *
 * MilestoneEvent → undefined（不进入 channel）
 * OutcomeEvent → event 本身
 *
 * 这是防止 MilestoneEvent 进入 channel 的运行时保护。
 */
export function extractOutcomeIfTerminal(event: UOEMEvent): OutcomeEvent | undefined {
  if (isTerminalEvent(event)) {
    return event;
  }
  return undefined;
}

/**
 * 重建 snapshot 从裸 entry 列表（用于 Memory 恢复）。
 *
 * 如果 entries 中有同 operationId 的重复，保留第一个（幂等语义）。
 * 如果 entries 超过 capacity，截断到最近 capacity 条。
 */
export function rebuildSnapshot(entries: OutcomeChannelEntry[]): OutcomeChannelSnapshot {
  const seen = new Set<string>();
  const deduped: OutcomeChannelEntry[] = [];

  for (const entry of entries) {
    const opId = entry.event.operationId as unknown as string;
    if (!seen.has(opId)) {
      seen.add(opId);
      deduped.push(entry);
    }
    // 重复的被静默丢弃
  }

  // 截断到 capacity
  const bounded = deduped.length > OUTCOME_CHANNEL_CAPACITY
    ? deduped.slice(deduped.length - OUTCOME_CHANNEL_CAPACITY)
    : deduped;

  // 重新分配 sequence（确保单调递增）
  const resequenced = bounded.map((entry, i) => ({
    event: entry.event,
    sequence: i,
  }));

  const maxSeq = resequenced.length > 0
    ? resequenced[resequenced.length - 1]!.sequence + 1
    : 0;

  return {
    entries: resequenced,
    seq: maxSeq,
    seen: resequenced.map(e => e.event.operationId as unknown as string),
  };
}
