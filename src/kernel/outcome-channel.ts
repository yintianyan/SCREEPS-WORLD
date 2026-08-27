/**
 * OutcomeChannel — Memory 持久化的有界 FIFO 通道。
 *
 * Phase 38 UOEM Model A 实现：权威通道（幂等、Memory 持久、容量可观测）。
 *
 * 设计约束（冻结契约 docs/phase38/PHASE38_B_FINAL_VERDICT.md §11）：
 *   - 存 Memory（≤3.2KB，cap=16 条 OutcomeEvent，压缩字段名）
 *   - 每 operationId 至多一条 OUTCOME（幂等去重）
 *   - FIFO 顺序（drain 取出全部）
 *   - 通道溢出可观测，不静默丢失
 *   - eventId 确定性、有序、可去重
 *   - duplicate outcome 被拒绝且计数可查
 *
 * 压缩策略（满足 3.2KB 冻结契约）：
 *   - SerializedOutcomeEvent 字段名缩短（eid/oid/r/oa/ca/fa/ob/oa2/ds/df）
 *   - OutcomeChannelMemory 字段名缩短（q/s/dr/oe）
 *   - cap=16，满载最大事件 JSON ≤ 2.4KB（远低于 3.2KB）
 *   - seen 数组每次 drain 裁剪到 cap，drain 前 ≤ cap×2
 *
 * 安全不变式：
 *   - channel 完全停止时帝国照常安全运行（Shadow-Only consumer）
 *   - channel 是 experience-collector 的唯一 outcome 数据源
 *   - 不修改任何业务状态
 *   - overflowEvicted 后可观测：日志 + 计数器，不静默丢失
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

// ─── Memory 持久化结构（压缩字段名以满足 3.2KB 契约）────────

/**
 * Memory 中 OutcomeChannel 的序列化结构。
 * 字段名压缩以满足 3.2KB 冻结契约（q/s/dr/oe）。
 */
export interface OutcomeChannelMemory {
  /** FIFO 队列（数组头部=最老，尾部=最新）。 */
  q: SerializedOutcomeEvent[];
  /** 已入队的 operationId 集合（去重用）。每次 drain 裁剪到 cap。 */
  s: OperationId[];
  /** 被拒绝的重复 outcome 数。 */
  dr: number;
  /** 因容量不足被丢弃的最老事件数。 */
  oe: number;
}

/**
 * 序列化的 OutcomeEvent（压缩字段名以控制 Memory 体积）。
 * 每条最大 ~128B（满载 observation + delta）。
 */
export interface SerializedOutcomeEvent {
  /** eventId: E-{tick}-{seq} */
  eid: string;
  /** operationId: op:{target}:{consumeTick} */
  oid: OperationId;
  /** ExpansionResult */
  r: string;
  /** openedAt（不可变生命周期锚点） */
  oa: number;
  /** closedAt（终态 tick） */
  ca: number;
  /** forcedAdvance 标志 */
  fa: boolean;
  /** observation.before（可选） */
  ob?: number;
  /** observation.after（可选） */
  oa2?: number;
  /** delta.succeededSinceOpen（可选） */
  ds?: number;
  /** delta.failedSinceOpen（可选） */
  df?: number;
}

// ─── 常量 ─────────────────────────────────────────────────

/**
 * Channel 容量上限。
 * cap=16 × ~128B(max event) + 16 × ~20B(seen) + 16B(counters) ≈ 2.4KB < 3.2KB。
 * 冻结契约：≤3.2KB（docs/phase38/PHASE38_B_FINAL_VERDICT.md §11）。
 */
export const OUTCOME_CHANNEL_CAPACITY = 16;

// ─── 工具函数 ─────────────────────────────────────────────

/** 生成确定性 eventId: E-{tick}-{seq}。 */
export function makeEventId(tick: number, seq: number): string {
  return `E-${tick}-${seq}`;
}

/** 将 OutcomeEvent 序列化为 Memory 存储格式（压缩字段名）。 */
function serializeOutcome(ev: OutcomeEvent): SerializedOutcomeEvent {
  const out: SerializedOutcomeEvent = {
    eid: ev.eventId,
    oid: ev.operationId,
    r: ev.result,
    oa: ev.interval.openedAt,
    ca: ev.interval.closedAt,
    fa: ev.forcedAdvance,
  };
  if (ev.observation) {
    out.ob = ev.observation.before;
    out.oa2 = ev.observation.after;
  }
  if (ev.delta) {
    out.ds = ev.delta.succeededSinceOpen;
    out.df = ev.delta.failedSinceOpen;
  }
  return out;
}

/** 将 Memory 存储格式反序列化为 OutcomeEvent。 */
export function deserializeOutcome(s: SerializedOutcomeEvent): OutcomeEvent {
  const ev: OutcomeEvent = {
    kind: "OUTCOME",
    domain: "expansion",
    eventId: s.eid,
    operationId: s.oid,
    result: s.r as OutcomeEvent["result"],
    interval: { openedAt: s.oa, closedAt: s.ca },
    forcedAdvance: s.fa,
  };
  if (s.ob !== undefined && s.oa2 !== undefined) {
    (ev as { observation?: { before: number; after: number } }).observation = { before: s.ob, after: s.oa2 };
  }
  if (s.ds !== undefined && s.df !== undefined) {
    (ev as { delta?: { succeededSinceOpen: number; failedSinceOpen: number } }).delta = {
      succeededSinceOpen: s.ds,
      failedSinceOpen: s.df,
    };
  }
  return ev;
}

// ─── Channel 操作 ────────────────────────────────────────

/**
 * 获取或初始化 Memory 中的 OutcomeChannel。
 * 幂等 — 多次调用安全。
 * 兼容旧字段名（queue/seen/duplicateRejected/overflowEvicted）——迁移期自动转换。
 */
export function getOutcomeChannel(mem: { kernel?: Record<string, unknown> }): OutcomeChannelMemory {
  if (!mem.kernel) (mem as { kernel: Record<string, unknown> }).kernel = {};
  if (!mem.kernel!.outcomeEvents) {
    mem.kernel!.outcomeEvents = {
      q: [],
      s: [],
      dr: 0,
      oe: 0,
    };
  }
  const ch = mem.kernel!.outcomeEvents as unknown as Record<string, unknown>;
  // 兼容旧字段名迁移（queue→q, seen→s, duplicateRejected→dr, overflowEvicted→oe）
  if (!ch.q && ch.queue) {
    ch.q = ch.queue as SerializedOutcomeEvent[];
    delete ch.queue;
  }
  if (!ch.s && ch.seen) {
    ch.s = ch.seen as OperationId[];
    delete ch.seen;
  }
  if (ch.dr === undefined && ch.duplicateRejected !== undefined) {
    ch.dr = ch.duplicateRejected as number;
    delete ch.duplicateRejected;
  }
  if (ch.oe === undefined && ch.overflowEvicted !== undefined) {
    ch.oe = ch.overflowEvicted as number;
    delete ch.overflowEvicted;
  }
  // 确保字段存在
  if (!ch.q) ch.q = [];
  if (!ch.s) ch.s = [];
  if (ch.dr === undefined) ch.dr = 0;
  if (ch.oe === undefined) ch.oe = 0;
  return ch as unknown as OutcomeChannelMemory;
}

/**
 * 入队一个 OutcomeEvent。
 * - 同一 operationId 的重复 outcome 被拒绝（DUPLICATE_REJECTED）。
 * - 超过容量时最老事件被丢弃（overflowEvicted 计数 + 日志告警）。
 * - 返回入队结果。
 */
export function enqueueOutcome(
  channel: OutcomeChannelMemory,
  ev: OutcomeEvent,
): EnqueueResult {
  // 幂等去重：同一 operationId 只接受第一条
  if (channel.s.includes(ev.operationId)) {
    channel.dr++;
    return "DUPLICATE_REJECTED";
  }

  // 容量检查：超出时丢弃最老 + 日志告警（不静默丢失）
  while (channel.q.length >= OUTCOME_CHANNEL_CAPACITY) {
    const evicted = channel.q.shift();
    channel.oe++;
    if (evicted) {
      console.log(`[OutcomeChannel] overflow evict: op=${evicted.oid} (evicted=${channel.oe})`);
    }
  }

  // 入队
  channel.q.push(serializeOutcome(ev));
  channel.s.push(ev.operationId);
  return "ACCEPTED";
}

/**
 * 排空通道：取出全部 OutcomeEvent 并清空队列。
 * seen 数组不清除（保持去重幂等），但每次 drain 裁剪到 cap 条。
 */
export function drainOutcomes(channel: OutcomeChannelMemory): OutcomeEvent[] {
  if (channel.q.length === 0) {
    // 即使队列空也裁剪 seen（防只入队不 drain 的边界场景下 seen 无限增长）
    if (channel.s.length > OUTCOME_CHANNEL_CAPACITY) {
      channel.s = channel.s.slice(-OUTCOME_CHANNEL_CAPACITY);
    }
    return [];
  }
  const events = channel.q.map(deserializeOutcome);
  channel.q = [];
  // 裁剪 seen 数组（保留最近 capacity 条，防止无限增长）
  if (channel.s.length > OUTCOME_CHANNEL_CAPACITY) {
    channel.s = channel.s.slice(-OUTCOME_CHANNEL_CAPACITY);
  }
  return events;
}

/**
 * 窥视通道（不排空）：返回当前队列中的 OutcomeEvent。
 */
export function peekOutcomes(channel: OutcomeChannelMemory): OutcomeEvent[] {
  return channel.q.map(deserializeOutcome);
}

/**
 * 获取通道溢出信息。
 */
export function getChannelOverflowInfo(channel: OutcomeChannelMemory): ChannelOverflowInfo {
  return {
    duplicateRejected: channel.dr,
    overflowEvicted: channel.oe,
  };
}

/**
 * 检查 operationId 是否已在通道中（已入队过终态 outcome）。
 */
export function hasTerminalOutcome(channel: OutcomeChannelMemory, opId: OperationId): boolean {
  return channel.s.includes(opId);
}

/**
 * 获取通道当前长度。
 */
export function getChannelSize(channel: OutcomeChannelMemory): number {
  return channel.q.length;
}
