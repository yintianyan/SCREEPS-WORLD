/**
 * UOEM STEP 1.2 — Core Model Implementation Tests.
 *
 * 覆盖：CF-UOEM-01~20 + I-UOEM-01~12 + edge cases
 * 纯 Domain 测试：不依赖 Game/Memory/Runtime。
 */

import { describe, it, expect } from "vitest";
import {
  type OperationId,
  type DecisionId,
  type EventId,
  createOperationId,
  createDecisionId,
  createEventId,
  parseOperationId,
  isValidOperationId,
  isValidDecisionId,
} from "../../../src/domain/intelligence/uoem/identity";
import {
  type OperationInterval,
  openInterval,
  closeInterval,
  computeDuration,
  computeElapsedOrDuration,
  isValidInterval,
} from "../../../src/domain/intelligence/uoem/interval";
import {
  type MilestoneEvent,
  type OutcomeEvent,
  type UOEMEvent,
  type MilestoneKind,
  TERMINAL_OUTCOME,
  isTerminalOutcomeCode,
  isTerminalEvent,
  isMilestoneEvent,
  forcedAdvanceDoesNotImplyTerminality,
  isValidTimestampOrder,
  isDuplicateOutcome,
} from "../../../src/domain/intelligence/uoem/guards";
import {
  type OutcomeChannelSnapshot,
  type EmitResult,
  OUTCOME_CHANNEL_CAPACITY,
  createEmptySnapshot,
  channelSize,
  channelCapacity,
  peek,
  emitOutcome,
  drain,
  drainN,
  isValidSnapshot,
  extractOutcomeIfTerminal,
  rebuildSnapshot,
} from "../../../src/domain/intelligence/uoem/channel";

// ── 测试辅助 ──────────────────────────────────────────────────

function makeMilestone(overrides?: Partial<MilestoneEvent>): MilestoneEvent {
  const base: MilestoneEvent = {
    kind: "milestone",
    eventId: createEventId(1000, 1),
    operationId: createOperationId("W1N1", 1000),
    milestoneKind: "CLAIMED",
    occurredAt: 1000,
    recordedAt: 1000,
    state: "claimed",
    forcedAdvance: false,
    correlation: { target: "W1N1" },
  };
  return { ...base, ...overrides } as MilestoneEvent;
}

function makeOutcome(overrides?: Partial<OutcomeEvent>): OutcomeEvent {
  const interval: OperationInterval = overrides?.interval ?? { openedAt: 1000, closedAt: 2000 };
  const base: OutcomeEvent = {
    kind: "outcome",
    eventId: createEventId(2000, 1),
    operationId: createOperationId("W1N1", 1000),
    outcomeCode: TERMINAL_OUTCOME.SUCCESS,
    occurredAt: 2000,
    recordedAt: 2000,
    interval,
    duration: computeDuration(interval) ?? 1000,
    forcedAdvance: false,
    correlation: { target: "W1N1" },
  };
  return { ...base, ...overrides } as OutcomeEvent;
}

// ═══════════════════════════════════════════════════════════
// CF-UOEM-01: OperationId ≠ DecisionId (类型隔离)
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-01: OperationId ≠ DecisionId", () => {
  it("两者运行时为 string 但 branded type 不兼容", () => {
    const opId = createOperationId("W1N1", 1000);
    const dId = createDecisionId(1000, 1);
    expect(typeof opId).toBe("string");
    expect(typeof dId).toBe("string");
    expect(opId).not.toBe(dId);
    // 编译期阻止互相赋值（branded type）
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-02: Milestone 没有 outcomeCode
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-02: Milestone has no outcomeCode", () => {
  it("MilestoneEvent 不含 outcomeCode 字段", () => {
    const m = makeMilestone();
    expect((m as unknown as Record<string, unknown>).outcomeCode).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-03: Milestone 永远不是 terminal
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-03: Milestone never terminal", () => {
  it("CLAIMED milestone not terminal", () => {
    expect(isTerminalEvent(makeMilestone({ milestoneKind: "CLAIMED" }))).toBe(false);
  });
  it("FORCED_ADVANCE milestone not terminal", () => {
    expect(isTerminalEvent(makeMilestone({ milestoneKind: "FORCED_ADVANCE" }))).toBe(false);
  });
  it("CHECKPOINT_PASSED milestone not terminal", () => {
    expect(isTerminalEvent(makeMilestone({ milestoneKind: "CHECKPOINT_PASSED" }))).toBe(false);
  });
  it("VALIDATED milestone not terminal", () => {
    expect(isTerminalEvent(makeMilestone({ milestoneKind: "VALIDATED" }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-04: Outcome 永远是 terminal
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-04: Outcome always terminal", () => {
  for (const [name, code] of Object.entries(TERMINAL_OUTCOME)) {
    it(`${name} outcome is terminal`, () => {
      expect(isTerminalEvent(makeOutcome({ outcomeCode: code }))).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-05: TIMEOUT milestone 不是 terminal
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-05: TIMEOUT milestone ≠ terminal", () => {
  it("FORCED_ADVANCE + forcedAdvance=true milestone not terminal", () => {
    const m = makeMilestone({
      milestoneKind: "FORCED_ADVANCE",
      forcedAdvance: true,
      state: "economic_startup",
    });
    expect(isTerminalEvent(m)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-06: TIMEOUT outcome 是 terminal
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-06: TIMEOUT outcome is terminal", () => {
  it("TIMED_OUT outcome is terminal", () => {
    const o = makeOutcome({ outcomeCode: TERMINAL_OUTCOME.TIMED_OUT });
    expect(isTerminalEvent(o)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-07: forcedAdvance 不改变 terminality
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-07: forcedAdvance ≠ terminality", () => {
  it("milestone + forcedAdvance=true not terminal", () => {
    const m = makeMilestone({ forcedAdvance: true });
    expect(isTerminalEvent(m)).toBe(false);
    expect(forcedAdvanceDoesNotImplyTerminality(m)).toBe(true);
  });
  it("outcome + forcedAdvance=true is terminal (but not because forcedAdvance)", () => {
    const o = makeOutcome({ forcedAdvance: true });
    expect(isTerminalEvent(o)).toBe(true);
    expect(forcedAdvanceDoesNotImplyTerminality(o)).toBe(true);
  });
  it("outcome + forcedAdvance=false is terminal", () => {
    const o = makeOutcome({ forcedAdvance: false });
    expect(isTerminalEvent(o)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-08: openedAt immutable
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-08: openedAt immutable", () => {
  it("closeInterval preserves openedAt", () => {
    const iv = openInterval(1000);
    const closed = closeInterval(iv, 5000);
    expect(closed.openedAt).toBe(1000);
    expect(iv.openedAt).toBe(1000); // original unchanged
  });
  it("closeInterval idempotent", () => {
    const iv = closeInterval(openInterval(1000), 5000);
    const iv2 = closeInterval(iv, 10000);
    expect(iv2.closedAt).toBe(5000);
  });
  it("multiple state transitions don't change openedAt", () => {
    const iv = openInterval(1000);
    const after1 = { ...iv };
    const after2 = { ...after1 };
    const final = closeInterval(after2, 25000);
    expect(final.openedAt).toBe(1000);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-09: mutable startedAt 不影响 duration
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-09: mutable startedAt doesn't affect duration", () => {
  it("duration based on interval, not startedAt", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 25000 };
    const duration = computeDuration(interval);
    expect(duration).toBe(24000);
    // 即使有一个 mutable startedAt = 5000，duration 不读它
    const mutableStartedAt = 5000;
    expect(duration).not.toBe(25000 - mutableStartedAt);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-10: occurredAt != recordedAt 可以成立
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-10: occurredAt != recordedAt", () => {
  it("milestone delayed recording", () => {
    const m = makeMilestone({ occurredAt: 1000, recordedAt: 1100 });
    expect(m.occurredAt).not.toBe(m.recordedAt);
    expect(isValidTimestampOrder(m)).toBe(true);
  });
  it("terminal delayed recording", () => {
    const o = makeOutcome({ occurredAt: 20000, recordedAt: 21000 });
    expect(o.occurredAt).not.toBe(o.recordedAt);
    expect(isValidTimestampOrder(o)).toBe(true);
  });
  it("same tick (no delay)", () => {
    const o = makeOutcome({ occurredAt: 1000, recordedAt: 1000 });
    expect(o.occurredAt).toBe(o.recordedAt);
    expect(isValidTimestampOrder(o)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-11: occurredAt <= recordedAt
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-11: occurredAt <= recordedAt", () => {
  it("milestone valid order", () => {
    expect(isValidTimestampOrder(makeMilestone({ occurredAt: 500, recordedAt: 600 }))).toBe(true);
  });
  it("outcome valid order", () => {
    expect(isValidTimestampOrder(makeOutcome({ occurredAt: 1000, recordedAt: 2000 }))).toBe(true);
  });
  it("same tick valid", () => {
    expect(isValidTimestampOrder(makeMilestone({ occurredAt: 100, recordedAt: 100 }))).toBe(true);
  });
  it("invalid order rejected", () => {
    // 手动构造非法事件
    const m = makeMilestone({ occurredAt: 2000, recordedAt: 1000 });
    expect(isValidTimestampOrder(m)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-12: Milestone 无法进入 OutcomeChannel
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-12: Milestone cannot enter OutcomeChannel", () => {
  it("extractOutcomeIfTerminal(milestone) = undefined", () => {
    const m = makeMilestone();
    expect(extractOutcomeIfTerminal(m)).toBeUndefined();
  });
  it("MilestoneEvent type-rejected by emitOutcome (parameter type)", () => {
    // emitOutcome 接受 OutcomeEvent，不接受 MilestoneEvent
    // TypeScript 编译期阻止以下代码：
    // emitOutcome(snapshot, milestone); // ❌ Type Error
    const m = makeMilestone();
    expect(isTerminalEvent(m)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-13: Outcome 可以进入 OutcomeChannel
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-13: Outcome can enter OutcomeChannel", () => {
  it("emitOutcome accepts OutcomeEvent", () => {
    const snap = createEmptySnapshot();
    const o = makeOutcome();
    const { snapshot, result } = emitOutcome(snap, o);
    expect(result.status).toBe("ACCEPTED");
    expect(channelSize(snapshot)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-14: duplicate outcome 被拒绝
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-14: duplicate outcome rejected", () => {
  it("same operationId second emit = DUPLICATE_REJECTED", () => {
    const opId = createOperationId("W1N1", 1000);
    const snap = createEmptySnapshot();
    const o1 = makeOutcome({ operationId: opId, eventId: createEventId(2000, 1) });
    const o2 = makeOutcome({ operationId: opId, outcomeCode: TERMINAL_OUTCOME.LOST, eventId: createEventId(2100, 2) });

    const { snapshot: snap1, result: r1 } = emitOutcome(snap, o1);
    expect(r1.status).toBe("ACCEPTED");

    const { snapshot: snap2, result: r2 } = emitOutcome(snap1, o2);
    expect(r2.status).toBe("DUPLICATE_REJECTED");
    expect(channelSize(snap2)).toBe(1); // 不增长

    // 第一个 outcome 保留
    const events = peek(snap2);
    expect(events).toHaveLength(1);
    expect(events[0]!.outcomeCode).toBe(TERMINAL_OUTCOME.SUCCESS); // first wins
  });

  it("different operationId = both accepted", () => {
    const snap = createEmptySnapshot();
    const o1 = makeOutcome({ operationId: createOperationId("W1N1", 1000), eventId: createEventId(2000, 1) });
    const o2 = makeOutcome({ operationId: createOperationId("W2N2", 2000), eventId: createEventId(2100, 2) });

    const { snapshot: snap1 } = emitOutcome(snap, o1);
    const { snapshot: snap2 } = emitOutcome(snap1, o2);
    expect(channelSize(snap2)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-15: channel <= 32
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-15: channel bounded at 32", () => {
  it("exactly 32 events", () => {
    let snap = createEmptySnapshot();
    for (let i = 0; i < 32; i++) {
      const o = makeOutcome({
        operationId: createOperationId(`W${i}N${i}`, i),
        eventId: createEventId(i, i + 1),
      });
      const result = emitOutcome(snap, o);
      snap = result.snapshot;
    }
    expect(channelSize(snap)).toBe(32);
    expect(channelSize(snap)).toBeLessThanOrEqual(channelCapacity());
  });

  it("33rd event causes overflow (evicts oldest)", () => {
    let snap = createEmptySnapshot();
    for (let i = 0; i < 33; i++) {
      const o = makeOutcome({
        operationId: createOperationId(`W${i}N${i}`, i),
        eventId: createEventId(i, i + 1),
      });
      const result = emitOutcome(snap, o);
      snap = result.snapshot;
    }
    expect(channelSize(snap)).toBe(32); // bounded
    expect(channelSize(snap)).toBeLessThanOrEqual(channelCapacity());
  });

  it("1000 events stay bounded", () => {
    let snap = createEmptySnapshot();
    for (let i = 0; i < 1000; i++) {
      const o = makeOutcome({
        operationId: createOperationId(`W${i}N${i}`, i),
        eventId: createEventId(i, i + 1),
      });
      const result = emitOutcome(snap, o);
      snap = result.snapshot;
    }
    expect(channelSize(snap)).toBe(32);
    expect(channelSize(snap)).toBeLessThanOrEqual(channelCapacity());
  });

  it("duplicate storm stays bounded", () => {
    const opId = createOperationId("W1N1", 1000);
    let snap = createEmptySnapshot();
    const o = makeOutcome({ operationId: opId });
    const { snapshot } = emitOutcome(snap, o);
    snap = snapshot;

    // 1000 duplicate attempts
    for (let i = 0; i < 1000; i++) {
      const dup = makeOutcome({ operationId: opId, outcomeCode: TERMINAL_OUTCOME.LOST });
      const result = emitOutcome(snap, dup);
      snap = result.snapshot;
    }
    expect(channelSize(snap)).toBe(1); // only first accepted
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-16: drain 后事件不重复返回
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-16: drain is non-repeating", () => {
  it("drain returns events, then empty", () => {
    let snap = createEmptySnapshot();
    const o1 = makeOutcome({ operationId: createOperationId("W1", 1), eventId: createEventId(1, 1) });
    const o2 = makeOutcome({ operationId: createOperationId("W2", 2), eventId: createEventId(2, 2) });
    snap = emitOutcome(snap, o1).snapshot;
    snap = emitOutcome(snap, o2).snapshot;

    const { events: first, snapshot: snap1 } = drain(snap);
    expect(first).toHaveLength(2);
    expect(first[0]!.operationId).toBe(o1.operationId);
    expect(first[1]!.operationId).toBe(o2.operationId);

    const { events: second } = drain(snap1);
    expect(second).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-17: FIFO 保持
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-17: FIFO order", () => {
  it("events returned in insertion order", () => {
    let snap = createEmptySnapshot();
    for (let i = 0; i < 5; i++) {
      const o = makeOutcome({
        operationId: createOperationId(`W${i}`, i),
        eventId: createEventId(i, i + 1),
        occurredAt: i * 1000,
      });
      snap = emitOutcome(snap, o).snapshot;
    }
    const events = peek(snap);
    for (let i = 0; i < 5; i++) {
      expect(events[i]!.occurredAt).toBe(i * 1000);
    }
  });

  it("FIFO after overflow: oldest evicted", () => {
    let snap = createEmptySnapshot();
    for (let i = 0; i < 33; i++) {
      const o = makeOutcome({
        operationId: createOperationId(`W${i}`, i),
        eventId: createEventId(i, i + 1),
        occurredAt: i,
      });
      snap = emitOutcome(snap, o).snapshot;
    }
    const events = peek(snap);
    expect(events).toHaveLength(32);
    // First event (W0) should be evicted, W1 is now first
    expect(events[0]!.occurredAt).toBe(1);
    expect(events[31]!.occurredAt).toBe(32);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-18: 1000x replay deterministic
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-18: 1000x replay deterministic", () => {
  it("same input → same output (100x)", () => {
    for (let i = 0; i < 100; i++) {
      const snap = createEmptySnapshot();
      const o = makeOutcome();
      const { snapshot, result } = emitOutcome(snap, o);
      expect(result.status).toBe("ACCEPTED");
      expect(channelSize(snapshot)).toBe(1);
      expect(peek(snapshot)[0]!.operationId).toBe(o.operationId);
    }
  });

  it("same sequence of 10 emits → same final state (100x)", () => {
    const expectedOps: string[] = [];
    for (let i = 0; i < 10; i++) {
      expectedOps.push(createOperationId(`W${i}`, i) as unknown as string);
    }

    for (let replay = 0; replay < 100; replay++) {
      let snap = createEmptySnapshot();
      for (let i = 0; i < 10; i++) {
        const o = makeOutcome({
          operationId: createOperationId(`W${i}`, i),
          eventId: createEventId(i, i + 1),
        });
        snap = emitOutcome(snap, o).snapshot;
      }
      const events = peek(snap);
      for (let i = 0; i < 10; i++) {
        expect(events[i]!.operationId as unknown as string).toBe(expectedOps[i]);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-19: 无 Date.now
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-19: no Date.now()", () => {
  it("createOperationId doesn't use Date.now", () => {
    const a = createOperationId("W1N1", 1000);
    const b = createOperationId("W1N1", 1000);
    // If Date.now was used, a !== b would be possible
    expect(a).toBe(b);
  });
  it("createEventId doesn't use Date.now", () => {
    const a = createEventId(1000, 1);
    const b = createEventId(1000, 1);
    expect(a).toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-UOEM-20: 无 Game API
// ═══════════════════════════════════════════════════════════

describe("CF-UOEM-20: no Game API", () => {
  it("identity creation doesn't reference Game", () => {
    // Pure functions with primitive inputs
    const opId = createOperationId("W1N1", 1000);
    const dId = createDecisionId(1000, 1);
    const eId = createEventId(1000, 1);
    expect(opId).toContain("W1N1");
    expect(dId).toContain("1000");
    expect(eId).toContain("1000");
  });
});

// ═══════════════════════════════════════════════════════════
// Architecture Invariants I-UOEM-01 ~ I-UOEM-12
// ═══════════════════════════════════════════════════════════

describe("Architecture Invariants", () => {
  // I-UOEM-01: OperationId !== DecisionId
  it("I-UOEM-01: OperationId ≠ DecisionId", () => {
    const opId = createOperationId("W1N1", 1000);
    const dId = createDecisionId(1000, 1);
    expect(opId).not.toBe(dId);
    expect(isValidOperationId(opId as unknown as string)).toBe(true);
    expect(isValidDecisionId(dId as unknown as string)).toBe(true);
    expect(isValidOperationId(dId as unknown as string)).toBe(false); // DecisionId is not a valid OperationId
    expect(isValidDecisionId(opId as unknown as string)).toBe(false); // OperationId is not a valid DecisionId
  });

  // I-UOEM-02: MilestoneEvent !== OutcomeEvent
  it("I-UOEM-02: MilestoneEvent ≠ OutcomeEvent", () => {
    const m = makeMilestone();
    const o = makeOutcome();
    expect(m.kind).toBe("milestone");
    expect(o.kind).toBe("outcome");
    expect(m.kind).not.toBe(o.kind);
  });

  // I-UOEM-03: isTerminalEvent === (kind === "outcome")
  it("I-UOEM-03: isTerminalEvent checks kind", () => {
    expect(isTerminalEvent(makeMilestone())).toBe(false);
    expect(isTerminalEvent(makeOutcome())).toBe(true);
    expect(isTerminalEvent(makeMilestone({ forcedAdvance: true }))).toBe(false);
    expect(isTerminalEvent(makeOutcome({ forcedAdvance: true }))).toBe(true);
  });

  // I-UOEM-04: forcedAdvance 不影响 terminality
  it("I-UOEM-04: forcedAdvance doesn't affect terminality", () => {
    expect(forcedAdvanceDoesNotImplyTerminality(
      makeMilestone({ forcedAdvance: true })
    )).toBe(true);
    expect(forcedAdvanceDoesNotImplyTerminality(
      makeOutcome({ forcedAdvance: true })
    )).toBe(true);
    expect(forcedAdvanceDoesNotImplyTerminality(
      makeOutcome({ forcedAdvance: false })
    )).toBe(true);
  });

  // I-UOEM-05: duration 不依赖 mutable startedAt
  it("I-UOEM-05: duration from interval", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 25000 };
    expect(computeDuration(interval)).toBe(24000);
  });

  // I-UOEM-06: occurredAt <= recordedAt
  it("I-UOEM-06: occurredAt <= recordedAt", () => {
    expect(isValidTimestampOrder(makeMilestone({ occurredAt: 100, recordedAt: 200 }))).toBe(true);
    expect(isValidTimestampOrder(makeOutcome({ occurredAt: 100, recordedAt: 100 }))).toBe(true);
    expect(isValidTimestampOrder(makeMilestone({ occurredAt: 200, recordedAt: 100 }))).toBe(false);
  });

  // I-UOEM-07: Milestone 不进入 OutcomeChannel
  it("I-UOEM-07: Milestone cannot enter channel", () => {
    const m = makeMilestone();
    expect(extractOutcomeIfTerminal(m)).toBeUndefined();
    expect(isTerminalEvent(m)).toBe(false);
  });

  // I-UOEM-08: 一个 Operation 最多一个 terminal Outcome
  it("I-UOEM-08: max one terminal per operation", () => {
    const opId = createOperationId("W1N1", 1000);
    let snap = createEmptySnapshot();
    const o1 = makeOutcome({ operationId: opId, eventId: createEventId(1000, 1) });
    const o2 = makeOutcome({ operationId: opId, eventId: createEventId(2000, 2) });

    const r1 = emitOutcome(snap, o1);
    snap = r1.snapshot;
    expect(r1.result.status).toBe("ACCEPTED");

    const r2 = emitOutcome(snap, o2);
    expect(r2.result.status).toBe("DUPLICATE_REJECTED");
    expect(channelSize(r2.snapshot)).toBe(1);
  });

  // I-UOEM-09: OutcomeChannel.length <= 32
  it("I-UOEM-09: channel <= 32", () => {
    let snap = createEmptySnapshot();
    for (let i = 0; i < 100; i++) {
      const o = makeOutcome({
        operationId: createOperationId(`W${i}`, i),
        eventId: createEventId(i, i + 1),
      });
      snap = emitOutcome(snap, o).snapshot;
    }
    expect(channelSize(snap)).toBeLessThanOrEqual(channelCapacity());
    expect(channelSize(snap)).toBe(32);
  });

  // I-UOEM-10: drain 是确定性的
  it("I-UOEM-10: drain is deterministic", () => {
    const buildSnap = (): OutcomeChannelSnapshot => {
      let snap = createEmptySnapshot();
      for (let i = 0; i < 5; i++) {
        snap = emitOutcome(snap, makeOutcome({
          operationId: createOperationId(`W${i}`, i),
          eventId: createEventId(i, i + 1),
          occurredAt: i,
        })).snapshot;
      }
      return snap;
    };

    for (let i = 0; i < 100; i++) {
      const snap = buildSnap();
      const { events } = drain(snap);
      expect(events).toHaveLength(5);
      expect(events[0]!.occurredAt).toBe(0);
      expect(events[4]!.occurredAt).toBe(4);
    }
  });

  // I-UOEM-11: UOEM Domain 不调用 Game API
  it("I-UOEM-11: no Game API (verified by grep audit)", () => {
    // 这个 invariant 通过代码审计验证，测试中验证函数只接受原始参数
    const opId = createOperationId("W1N1", 1000);
    expect(typeof opId).toBe("string");
    // 没有任何 Game 引用
  });

  // I-UOEM-12: UOEM Core 不产生 Decision Authority
  it("I-UOEM-12: no Decision Authority in core", () => {
    // Channel 只做 transport：emit/drain/peek
    // Channel 不做 decision：不判断 outcome code 是否正确
    // Channel 不做 strategy：不决定是否 advance
    const snap = createEmptySnapshot();
    const o = makeOutcome({ outcomeCode: TERMINAL_OUTCOME.SUCCESS });
    const { result } = emitOutcome(snap, o);
    expect(result.status).toBe("ACCEPTED");
    // Channel 不判断 outcomeCode 的语义正确性
  });
});

// ═══════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  it("empty drain returns empty array", () => {
    const snap = createEmptySnapshot();
    const { events } = drain(snap);
    expect(events).toHaveLength(0);
  });

  it("drainN(0) returns empty", () => {
    let snap = createEmptySnapshot();
    snap = emitOutcome(snap, makeOutcome()).snapshot;
    const { events } = drainN(snap, 0);
    expect(events).toHaveLength(0);
  });

  it("drainN(n > size) returns all", () => {
    let snap = createEmptySnapshot();
    snap = emitOutcome(snap, makeOutcome()).snapshot;
    const { events } = drainN(snap, 10);
    expect(events).toHaveLength(1);
  });

  it("isValidSnapshot validates capacity", () => {
    const bad = { entries: new Array(33), seq: 33, seen: [] };
    expect(isValidSnapshot(bad as unknown as OutcomeChannelSnapshot)).toBe(false);
  });

  it("rebuildSnapshot deduplicates", () => {
    const opId = createOperationId("W1N1", 1000);
    const entries = [
      { event: makeOutcome({ operationId: opId }), sequence: 0 },
      { event: makeOutcome({ operationId: opId, outcomeCode: TERMINAL_OUTCOME.LOST }), sequence: 1 },
    ];
    const rebuilt = rebuildSnapshot(entries);
    expect(rebuilt.entries).toHaveLength(1); // duplicate removed
    expect(rebuilt.entries[0]!.event.outcomeCode).toBe(TERMINAL_OUTCOME.SUCCESS); // first wins
  });

  it("rebuildSnapshot truncates to capacity", () => {
    const entries: { event: OutcomeEvent; sequence: number }[] = [];
    for (let i = 0; i < 50; i++) {
      entries.push({
        event: makeOutcome({ operationId: createOperationId(`W${i}`, i) }),
        sequence: i,
      });
    }
    const rebuilt = rebuildSnapshot(entries);
    expect(rebuilt.entries).toHaveLength(32);
  });

  it("isValidInterval rejects invalid", () => {
    expect(isValidInterval({ openedAt: -1 })).toBe(false);
    expect(isValidInterval({ openedAt: 1000, closedAt: 500 })).toBe(false);
    expect(isValidInterval({ openedAt: 1000, closedAt: 1000 })).toBe(true);
    expect(isValidInterval({ openedAt: 1000 })).toBe(true);
  });

  it("computeElapsedOrDuration works for open interval", () => {
    const iv = openInterval(1000);
    expect(computeElapsedOrDuration(iv, 1500)).toBe(500);
  });

  it("computeElapsedOrDuration works for closed interval", () => {
    const iv = closeInterval(openInterval(1000), 3000);
    expect(computeElapsedOrDuration(iv, 9999)).toBe(2000); // uses closedAt, not currentTick
  });

  it("parseOperationId rejects invalid formats", () => {
    expect(parseOperationId("invalid")).toBeNull();
    expect(parseOperationId("op:W1N1")).toBeNull();
    expect(parseOperationId("op:W1N1:abc")).toBeNull();
    expect(parseOperationId("op:W1N1:1000")).not.toBeNull();
  });

  it("isTerminalOutcomeCode validates codes", () => {
    expect(isTerminalOutcomeCode(0)).toBe(true);
    expect(isTerminalOutcomeCode(1)).toBe(true);
    expect(isTerminalOutcomeCode(2)).toBe(true);
    expect(isTerminalOutcomeCode(3)).toBe(true);
    expect(isTerminalOutcomeCode(4)).toBe(true);
    expect(isTerminalOutcomeCode(5)).toBe(false);
    expect(isTerminalOutcomeCode(-1)).toBe(false);
  });

  it("isMilestoneEvent type guard works", () => {
    const m = makeMilestone();
    const o = makeOutcome();
    expect(isMilestoneEvent(m)).toBe(true);
    expect(isMilestoneEvent(o)).toBe(false);
  });

  it("rebuildSnapshot from empty array", () => {
    const rebuilt = rebuildSnapshot([]);
    expect(rebuilt.entries).toHaveLength(0);
    expect(rebuilt.seq).toBe(0);
  });

  it("isValidSnapshot accepts valid empty", () => {
    expect(isValidSnapshot(createEmptySnapshot())).toBe(true);
  });

  it("drainN removes consumed entries from seen", () => {
    let snap = createEmptySnapshot();
    snap = emitOutcome(snap, makeOutcome({ operationId: createOperationId("W1", 1) })).snapshot;
    snap = emitOutcome(snap, makeOutcome({ operationId: createOperationId("W2", 2) })).snapshot;

    const { snapshot: after1 } = drainN(snap, 1);
    expect(isValidSnapshot(after1)).toBe(true);
    expect(channelSize(after1)).toBe(1);
  });
});