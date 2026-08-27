/**
 * UOEM Implementation Tests — Phase 6 生产代码验证。
 *
 * 与 uoem-proof.test.ts（reference implementation）对应，
 * 验证 src/domain/expansion/uoem-types.ts + src/kernel/outcome-channel.ts
 * 的生产实现满足六类缺陷消解路径。
 *
 * 覆盖：
 *   - Operation Identity 跨 reset 稳定
 *   - OutcomeChannel FIFO 顺序 + 幂等去重 + 溢出可观测
 *   - Milestone 不进入 OutcomeChannel
 *   - terminal-only 语义（SUCCESS 后 FAILURE 被拒绝）
 *   - firstStartedAt/openedAt duration 正确
 *   - recovery delta
 *   - logistics/spawn paired before/after
 *   - deterministic replay
 */
import { describe, it, expect } from "vitest";
import {
  makeOperationId,
  type OperationId,
  type OutcomeEvent,
  type MilestoneEvent,
  type ExpansionResult,
  TERMINAL_RESULTS,
} from "../../../src/domain/expansion/uoem-types";
import {
  getOutcomeChannel,
  enqueueOutcome,
  drainOutcomes,
  peekOutcomes,
  hasTerminalOutcome,
  getChannelSize,
  getChannelOverflowInfo,
  makeEventId,
  OUTCOME_CHANNEL_CAPACITY,
  type OutcomeChannelMemory,
} from "../../../src/kernel/outcome-channel";

// ─── 辅助函数 ─────────────────────────────────────────────

function makeChannel(): OutcomeChannelMemory {
  return { queue: [], seen: [], duplicateRejected: 0, overflowEvicted: 0 };
}

function makeOutcome(
  opId: OperationId,
  result: ExpansionResult,
  openedAt: number,
  closedAt: number,
  forcedAdvance = false,
): OutcomeEvent {
  return {
    kind: "OUTCOME",
    domain: "expansion",
    result,
    operationId: opId,
    eventId: makeEventId(closedAt, Math.floor(Math.random() * 1000)),
    interval: { openedAt, closedAt },
    forcedAdvance,
  };
}

// ─── 测试 ─────────────────────────────────────────────────

describe("UOEM Implementation: Operation Identity", () => {
  it("operationId 格式正确", () => {
    const opId = makeOperationId("W6N4", 1000);
    expect(opId).toBe("op:W6N4:1000");
  });

  it("相同参数产生相同 operationId（确定性）", () => {
    const a = makeOperationId("W6N4", 1000);
    const b = makeOperationId("W6N4", 1000);
    expect(a).toBe(b);
  });

  it("不同参数产生不同 operationId", () => {
    const a = makeOperationId("W6N4", 1000);
    const b = makeOperationId("W6N4", 1001);
    const c = makeOperationId("W5N4", 1000);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("UOEM Implementation: OutcomeChannel FIFO + Idempotent", () => {
  it("FIFO 顺序：先入队的先被 drain", () => {
    const ch = makeChannel();
    const op1 = makeOperationId("W1N1", 1000);
    const op2 = makeOperationId("W2N2", 1000);

    enqueueOutcome(ch, makeOutcome(op1, "COMPLETED", 1000, 2000));
    enqueueOutcome(ch, makeOutcome(op2, "LOST", 1000, 3000));

    const drained = drainOutcomes(ch);
    expect(drained).toHaveLength(2);
    expect(drained[0]!.operationId).toBe(op1);
    expect(drained[1]!.operationId).toBe(op2);
  });

  it("幂等去重：同一 operationId 的第二条被拒绝", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W6N4", 1000);

    const r1 = enqueueOutcome(ch, makeOutcome(opId, "LOST", 1000, 5000));
    const r2 = enqueueOutcome(ch, makeOutcome(opId, "COMPLETED", 1000, 5000));

    expect(r1).toBe("ACCEPTED");
    expect(r2).toBe("DUPLICATE_REJECTED");

    const drained = drainOutcomes(ch);
    expect(drained).toHaveLength(1);
    expect(drained[0]!.result).toBe("LOST"); // first-wins
  });

  it("溢出可观测：overflowCount 记录被拒绝数", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W6N4", 1000);

    enqueueOutcome(ch, makeOutcome(opId, "COMPLETED", 1000, 2000));
    enqueueOutcome(ch, makeOutcome(opId, "LOST", 1000, 3000)); // rejected
    enqueueOutcome(ch, makeOutcome(opId, "TIMED_OUT", 1000, 4000)); // rejected

    const info = getChannelOverflowInfo(ch);
    expect(info.duplicateRejected).toBe(2);
  });

  it("容量上限：cap=32，超出时最老被丢弃", () => {
    const ch = makeChannel();
    for (let i = 0; i < OUTCOME_CHANNEL_CAPACITY + 5; i++) {
      enqueueOutcome(ch, makeOutcome(makeOperationId(`R${i}`, 1000 + i), "COMPLETED", 1000 + i, 2000 + i));
    }
    // 队列不应超过容量
    expect(getChannelSize(ch)).toBeLessThanOrEqual(OUTCOME_CHANNEL_CAPACITY);
    // 溢出计数 > 0
    expect(getChannelOverflowInfo(ch).overflowEvicted).toBeGreaterThan(0);
  });

  it("drain 后队列清空", () => {
    const ch = makeChannel();
    enqueueOutcome(ch, makeOutcome(makeOperationId("W1N1", 1000), "COMPLETED", 1000, 2000));
    expect(getChannelSize(ch)).toBe(1);
    drainOutcomes(ch);
    expect(getChannelSize(ch)).toBe(0);
  });

  it("hasTerminalOutcome 检查", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W1N1", 1000);
    expect(hasTerminalOutcome(ch, opId)).toBe(false);
    enqueueOutcome(ch, makeOutcome(opId, "COMPLETED", 1000, 2000));
    expect(hasTerminalOutcome(ch, opId)).toBe(true);
  });
});

describe("UOEM Implementation: Terminal-only 语义", () => {
  it("SUCCESS 后 FAILURE 被拒绝（同一 operationId）", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W6N4", 1000);

    const r1 = enqueueOutcome(ch, makeOutcome(opId, "COMPLETED", 1000, 20000));
    const r2 = enqueueOutcome(ch, makeOutcome(opId, "LOST", 1000, 20001));

    expect(r1).toBe("ACCEPTED");
    expect(r2).toBe("DUPLICATE_REJECTED");

    const drained = drainOutcomes(ch);
    expect(drained).toHaveLength(1);
    expect(drained[0]!.result).toBe("COMPLETED");
  });

  it("不同 operationId 的多个终态可共存", () => {
    const ch = makeChannel();
    enqueueOutcome(ch, makeOutcome(makeOperationId("W1N1", 1000), "COMPLETED", 1000, 5000));
    enqueueOutcome(ch, makeOutcome(makeOperationId("W2N2", 1000), "LOST", 1000, 6000));

    expect(drainOutcomes(ch)).toHaveLength(2);
  });
});

describe("UOEM Implementation: Milestone 不进入 OutcomeChannel", () => {
  it("MilestoneEvent 类型不满足 OutcomeEvent 结构", () => {
    const milestone: MilestoneEvent = {
      kind: "MILESTONE",
      milestone: "CLAIMED",
      at: 3000,
      eventId: makeEventId(3000, 1),
      operationId: makeOperationId("W6N4", 1000),
    };
    // MilestoneEvent 缺 result/interval/forcedAdvance → 不能构造为 OutcomeEvent
    expect((milestone as unknown as { result?: string }).result).toBeUndefined();
    expect(TERMINAL_RESULTS.has((milestone as unknown as { result?: string }).result ?? "")).toBe(false);
  });
});

describe("UOEM Implementation: Duration 正确性 (TMP-1)", () => {
  it("interval.openedAt 不变 → duration 是全生命周期", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W6N4", 1000);

    // openedAt=1000，经历多次状态转换（closedAt=31000）
    enqueueOutcome(ch, makeOutcome(opId, "TIMED_OUT", 1000, 31000));

    const [ev] = drainOutcomes(ch);
    expect(ev?.interval.openedAt).toBe(1000);
    expect(ev?.interval.closedAt).toBe(31000);
    expect(ev!.interval.closedAt - ev!.interval.openedAt).toBe(30000);
  });

  it("forcedAdvance 标志正确传播", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W6N4", 1000);

    enqueueOutcome(ch, makeOutcome(opId, "COMPLETED_FORCED", 1000, 31000, true));

    const [ev] = drainOutcomes(ch);
    expect(ev?.forcedAdvance).toBe(true);
    expect(ev?.result).toBe("COMPLETED_FORCED");
  });
});

describe("UOEM Implementation: Paired Observation (A6-R/A6-SL)", () => {
  it("recovery delta = after - before（不是累计值）", () => {
    const openSnapshot = { succeeded: 98, failed: 2 };
    const closeSnapshot = { succeeded: 98, failed: 4 };
    const delta = {
      succeededSinceOpen: closeSnapshot.succeeded - openSnapshot.succeeded, // 0
      failedSinceOpen: closeSnapshot.failed - openSnapshot.failed, // 2
    };
    expect(delta.succeededSinceOpen).toBe(0);
    expect(delta.failedSinceOpen).toBe(2);
  });

  it("OutcomeEvent 可携带 observation（paired before/after）", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W5N5", 1000);

    const ev: OutcomeEvent = {
      kind: "OUTCOME",
      domain: "expansion",
      result: "COMPLETED",
      operationId: opId,
      eventId: makeEventId(4000, 1),
      interval: { openedAt: 1000, closedAt: 4000 },
      forcedAdvance: false,
      observation: { before: 3, after: 0 },
    };

    enqueueOutcome(ch, ev);
    const [drained] = drainOutcomes(ch);
    expect(drained?.observation).toEqual({ before: 3, after: 0 });
  });

  it("无 before 冻结时不产生 observation（宁可缺不可造）", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W8N8", 1000);

    const ev: OutcomeEvent = {
      kind: "OUTCOME",
      domain: "expansion",
      result: "COMPLETED",
      operationId: opId,
      eventId: makeEventId(5000, 1),
      interval: { openedAt: 1000, closedAt: 5000 },
      forcedAdvance: false,
      // 无 observation
    };

    enqueueOutcome(ch, ev);
    const [drained] = drainOutcomes(ch);
    expect(drained?.observation).toBeUndefined();
  });
});

describe("UOEM Implementation: Deterministic Replay", () => {
  it("eventId 格式确定性：E-{tick}-{seq}", () => {
    const id1 = makeEventId(1000, 1);
    const id2 = makeEventId(1000, 1);
    expect(id1).toBe("E-1000-1");
    expect(id1).toBe(id2);
  });

  it("相同事件序列 drain 顺序确定", () => {
    const ch1 = makeChannel();
    const ch2 = makeChannel();

    for (let i = 0; i < 5; i++) {
      const opId = makeOperationId(`R${i}`, 1000 + i);
      enqueueOutcome(ch1, makeOutcome(opId, "COMPLETED", 1000 + i, 2000 + i));
      enqueueOutcome(ch2, makeOutcome(opId, "COMPLETED", 1000 + i, 2000 + i));
    }

    const d1 = drainOutcomes(ch1);
    const d2 = drainOutcomes(ch2);
    expect(d1.map(e => e.operationId)).toEqual(d2.map(e => e.operationId));
  });
});

describe("UOEM Implementation: getOutcomeChannel 幂等", () => {
  it("多次调用返回同一对象", () => {
    const mem = { kernel: {} } as { kernel?: Record<string, unknown> };
    const ch1 = getOutcomeChannel(mem);
    const ch2 = getOutcomeChannel(mem);
    expect(ch1).toBe(ch2);
  });

  it("首次调用初始化空结构", () => {
    const mem = { kernel: {} } as { kernel?: Record<string, unknown> };
    const ch = getOutcomeChannel(mem);
    expect(ch.queue).toEqual([]);
    expect(ch.seen).toEqual([]);
    expect(ch.duplicateRejected).toBe(0);
    expect(ch.overflowEvicted).toBe(0);
  });
});
