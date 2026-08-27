/**
 * OutcomeChannel — Memory 持久化的有界 FIFO 通道。
 *
 * Phase 38 UOEM Model A 实现：权威通道（幂等、Memory 持久、容量可观测）。
 *
 * 设计约束：
 *   - 存 Memory（≤3.2KB，cap=32 条 OutcomeEvent）
 *   - 每 operationId 至多一条 OUTCOME（幂等去重）
 *   - FIFO 顺序（drain 取出全部）
 *   - 通道溢出可观测，不静默丢失
 *   - eventId 确定性、有序、可去重
 *   - duplicate outcome 被拒绝且计数可查
 *
 * 安全不变式：
 *   - channel 完全停止时帝国照常安全运行（Shadow-Only consumer）
 *   - channel 是 experience-collector 的唯一 outcome 数据源
 *   - 不修改任何业务状态
 *
 * 合同锚点：docs/phase38/PHASE38_B_FINAL_VERDICT.md §11
 * 证明测试：tests/unit/phase38/uoem-proof.test.ts（reference implementation）
 */
import type {
  OutcomeEvent,
  OperationId,
  EnqueueResult,
  ChannelOverflowInfo,
} from "../domain/expansion/uoem-types";

// ─── Memory 持久化结构 ───────────────────────────────────

/** Memory 中 OutcomeChannel 的序列化结构。 */
export interface OutcomeChannelMemory {
  /** FIFO 队列（数组头部=最老，尾部=最新）。 */
  queue: SerializedOutcomeEvent[];
  /** 已入队的 operationId 集合（去重用）。 */
  seen: OperationId[];
  /** 被拒绝的重复 outcome 数。 */
  duplicateRejected: number;
  /** 因容量不足被丢弃的最老事件数。 */
  overflowEvicted: number;
}

/** 序列化的 OutcomeEvent（只存必要字段，控制 Memory 体积）。 */
export interface SerializedOutcomeEvent {
  eventId: string;
  operationId: OperationId;
  result: string;
  openedAt: number;
  closedAt: number;
  forcedAdvance: boolean;
  obsBefore?: number;
  obsAfter?: number;
  deltaSucceeded?: number;
  deltaFailed?: number;
}

// ─── 常量 ─────────────────────────────────────────────────

/** Channel 容量上限。32 × ~100B ≈ 3.2KB。 */
export const OUTCOME_CHANNEL_CAPACITY = 32;

// ─── 工具函数 ─────────────────────────────────────────────

/** 生成确定性 eventId: E-{tick}-{seq}。 */
export function makeEventId(tick: number, seq: number): string {
  return `E-${tick}-${seq}`;
}

/** 将 OutcomeEvent 序列化为 Memory 存储格式。 */
function serializeOutcome(ev: OutcomeEvent): SerializedOutcomeEvent {
  const out: SerializedOutcomeEvent = {
    eventId: ev.eventId,
    operationId: ev.operationId,
    result: ev.result,
    openedAt: ev.interval.openedAt,
    closedAt: ev.interval.closedAt,
    forcedAdvance: ev.forcedAdvance,
  };
  if (ev.observation) {
    out.obsBefore = ev.observation.before;
    out.obsAfter = ev.observation.after;
  }
  if (ev.delta) {
    out.deltaSucceeded = ev.delta.succeededSinceOpen;
    out.deltaFailed = ev.delta.failedSinceOpen;
  }
  return out;
}

/** 将 Memory 存储格式反序列化为 OutcomeEvent。 */
export function deserializeOutcome(s: SerializedOutcomeEvent): OutcomeEvent {
  const ev: OutcomeEvent = {
    kind: "OUTCOME",
    domain: "expansion",
    eventId: s.eventId,
    operationId: s.operationId,
    result: s.result as OutcomeEvent["result"],
    interval: { openedAt: s.openedAt, closedAt: s.closedAt },
    forcedAdvance: s.forcedAdvance,
  };
  if (s.obsBefore !== undefined && s.obsAfter !== undefined) {
    (ev as { observation?: { before: number; after: number } }).observation = { before: s.obsBefore, after: s.obsAfter };
  }
  if (s.deltaSucceeded !== undefined && s.deltaFailed !== undefined) {
    (ev as { delta?: { succeededSinceOpen: number; failedSinceOpen: number } }).delta = {
      succeededSinceOpen: s.deltaSucceeded,
      failedSinceOpen: s.deltaFailed,
    };
  }
  return ev;
}

// ─── Channel 操作 ────────────────────────────────────────

/**
 * 获取或初始化 Memory 中的 OutcomeChannel。
 * 幂等 — 多次调用安全。
 */
export function getOutcomeChannel(mem: { kernel?: Record<string, unknown> }): OutcomeChannelMemory {
  if (!mem.kernel) (mem as { kernel: Record<string, unknown> }).kernel = {};
  if (!mem.kernel!.outcomeEvents) {
    mem.kernel!.outcomeEvents = {
      queue: [],
      seen: [],
      duplicateRejected: 0,
      overflowEvicted: 0,
    };
  }
  return mem.kernel!.outcomeEvents as OutcomeChannelMemory;
}

/**
 * 入队一个 OutcomeEvent。
 * - 同一 operationId 的重复 outcome 被拒绝（DUPLICATE_REJECTED）。
 * - 超过容量时最老事件被丢弃（overflowEvicted 计数）。
 * - 返回入队结果。
 */
export function enqueueOutcome(
  channel: OutcomeChannelMemory,
  ev: OutcomeEvent,
): EnqueueResult {
  // 幂等去重：同一 operationId 只接受第一条
  if (channel.seen.includes(ev.operationId)) {
    channel.duplicateRejected++;
    return "DUPLICATE_REJECTED";
  }

  // 容量检查：超出时丢弃最老
  while (channel.queue.length >= OUTCOME_CHANNEL_CAPACITY) {
    channel.queue.shift();
    channel.overflowEvicted++;
  }

  // 入队
  channel.queue.push(serializeOutcome(ev));
  channel.seen.push(ev.operationId);
  return "ACCEPTED";
}

/**
 * 排空通道：取出全部 OutcomeEvent 并清空队列。
 * 注意：seen 数组不清除（保持去重幂等——同一 operation 不会被二次入队）。
 * seen 数组会在 channel 超过容量时自动裁剪。
 */
export function drainOutcomes(channel: OutcomeChannelMemory): OutcomeEvent[] {
  if (channel.queue.length === 0) return [];
  const events = channel.queue.map(deserializeOutcome);
  channel.queue = [];
  // 裁剪 seen 数组（保留最近 capacity 条，防止无限增长）
  if (channel.seen.length > OUTCOME_CHANNEL_CAPACITY * 2) {
    channel.seen = channel.seen.slice(-OUTCOME_CHANNEL_CAPACITY);
  }
  return events;
}

/**
 * 窥视通道（不排空）：返回当前队列中的 OutcomeEvent。
 */
export function peekOutcomes(channel: OutcomeChannelMemory): OutcomeEvent[] {
  return channel.queue.map(deserializeOutcome);
}

/**
 * 获取通道溢出信息。
 */
export function getChannelOverflowInfo(channel: OutcomeChannelMemory): ChannelOverflowInfo {
  return {
    duplicateRejected: channel.duplicateRejected,
    overflowEvicted: channel.overflowEvicted,
  };
}

/**
 * 检查 operationId 是否已在通道中（已入队过终态 outcome）。
 */
export function hasTerminalOutcome(channel: OutcomeChannelMemory, opId: OperationId): boolean {
  return channel.seen.includes(opId);
}

/**
 * 获取通道当前长度。
 */
export function getChannelSize(channel: OutcomeChannelMemory): number {
  return channel.queue.length;
}
