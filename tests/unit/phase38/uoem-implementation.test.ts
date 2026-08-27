/** UOEM Implementation Tests — Phase 6 生产代码验证。 */
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
  return { q: [], s: [], dr: 0, oe: 0 };
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
    expect(ch.q).toEqual([]);
    expect(ch.s).toEqual([]);
    expect(ch.dr).toBe(0);
    expect(ch.oe).toBe(0);
  });
});

// ─── Phase 6 第四阶段：Memory 序列化上限证明 ───────────────

describe("UOEM Implementation: Memory 序列化上限", () => {
  it("满队列 + observation + delta 的 JSON 大小 ≤ 6KB", () => {
    const ch = makeChannel();
    // 填满 cap=16 条，每条都携带 observation + delta（最大载荷场景）
    for (let i = 0; i < OUTCOME_CHANNEL_CAPACITY; i++) {
      const opId = makeOperationId(`W${i}N${i}`, 1000 + i);
      const ev: OutcomeEvent = {
        kind: "OUTCOME",
        domain: "expansion",
        result: "COMPLETED_FORCED",
        operationId: opId,
        eventId: makeEventId(2000 + i, i),
        interval: { openedAt: 1000 + i, closedAt: 2000 + i },
        forcedAdvance: true,
        observation: { before: 100, after: 50 },
        delta: { succeededSinceOpen: 10, failedSinceOpen: 2 },
      };
      enqueueOutcome(ch, ev);
    }
    // seen 数组在 drain 前最大
    const jsonSize = JSON.stringify(ch).length;
    // 压缩字段名后：16 * ~128B (event) + 16 * ~20B (seen) + 16B (counters) ≈ 2.4KB
    // 冻结契约：≤3.2KB（PHASE38_B_FINAL_VERDICT.md §11）
    expect(jsonSize).toBeLessThan(3200);
  });

  it("seen 数组始终有界（≤ cap × 2，drain 后 ≤ cap）", () => {
    const ch = makeChannel();
    // 第一批：填满 cap
    for (let i = 0; i < OUTCOME_CHANNEL_CAPACITY; i++) {
      enqueueOutcome(ch, makeOutcome(makeOperationId(`A${i}`, 1000 + i), "COMPLETED", 1000 + i, 2000 + i));
    }
    // drain 裁剪 seen 到 cap
    drainOutcomes(ch);
    expect(ch.s.length).toBeLessThanOrEqual(OUTCOME_CHANNEL_CAPACITY);
    // 第二批：再填满 cap — seen 最大 = cap(旧) + cap(新) = cap × 2
    for (let i = 0; i < OUTCOME_CHANNEL_CAPACITY; i++) {
      enqueueOutcome(ch, makeOutcome(makeOperationId(`B${i}`, 1000 + i), "LOST", 1000 + i, 2000 + i));
    }
    // seen 在 drain 前最大 = cap × 2
    expect(ch.s.length).toBeLessThanOrEqual(OUTCOME_CHANNEL_CAPACITY * 2);
    // drain 后裁剪到 cap
    drainOutcomes(ch);
    expect(ch.s.length).toBeLessThanOrEqual(OUTCOME_CHANNEL_CAPACITY);
  });

  it("overflow 语义：超出容量时最老被丢弃且 overflowEvicted 计数", () => {
    const ch = makeChannel();
    // 入队 cap+10 条
    for (let i = 0; i < OUTCOME_CHANNEL_CAPACITY + 10; i++) {
      enqueueOutcome(ch, makeOutcome(makeOperationId(`O${i}`, 1000 + i), "COMPLETED", 1000 + i, 2000 + i));
    }
    // queue 不超 cap
    expect(getChannelSize(ch)).toBe(OUTCOME_CHANNEL_CAPACITY);
    // 10 条被丢弃
    expect(getChannelOverflowInfo(ch).overflowEvicted).toBe(10);
    // 最老的 10 条不在 queue 中
    const peek = peekOutcomes(ch);
    expect(peek[0]!.operationId).toBe(makeOperationId("O10", 1010));
  });

  it("duplicate outcome 不重复进入 queue（幂等去重）", () => {
    const ch = makeChannel();
    const opId = makeOperationId("W1N1", 1000);
    // 同 opId 入队 5 次
    for (let i = 0; i < 5; i++) {
      enqueueOutcome(ch, makeOutcome(opId, "COMPLETED", 1000, 2000 + i));
    }
    expect(getChannelSize(ch)).toBe(1);
    expect(getChannelOverflowInfo(ch).duplicateRejected).toBe(4);
  });

  it("drain 不重复返回已消费事件", () => {
    const ch = makeChannel();
    enqueueOutcome(ch, makeOutcome(makeOperationId("W1N1", 1000), "COMPLETED", 1000, 2000));
    enqueueOutcome(ch, makeOutcome(makeOperationId("W2N2", 1000), "LOST", 1000, 3000));

    const first = drainOutcomes(ch);
    expect(first).toHaveLength(2);

    const second = drainOutcomes(ch);
    expect(second).toHaveLength(0);
  });

  it("global reset 后 channel 可从 Memory 恢复", () => {
    const mem = { kernel: {} } as { kernel?: Record<string, unknown> };
    // 模拟 reset 前：写入 channel
    const ch1 = getOutcomeChannel(mem);
    enqueueOutcome(ch1, makeOutcome(makeOperationId("W1N1", 1000), "COMPLETED", 1000, 2000));
    enqueueOutcome(ch1, makeOutcome(makeOperationId("W2N2", 1000), "LOST", 1000, 3000));

    // 模拟 global reset：heap 清空，Memory 幸存
    // (mem 本身就是 Memory 的模拟，不依赖 heap)

    // reset 后：重新获取 channel
    const ch2 = getOutcomeChannel(mem);
    expect(ch2).toBe(ch1); // 同一对象（Memory 持久化）
    expect(getChannelSize(ch2)).toBe(2);

    const drained = drainOutcomes(ch2);
    expect(drained).toHaveLength(2);
    expect(drained[0]!.operationId).toBe(makeOperationId("W1N1", 1000));
    expect(drained[1]!.operationId).toBe(makeOperationId("W2N2", 1000));
  });
});
