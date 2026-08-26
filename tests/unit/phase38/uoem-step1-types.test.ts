/**
 * UOEM STEP 1.1 — Type Model Foundation Tests.
 *
 * 纯 Domain 类型测试：验证类型系统结构性保护。
 * 不测试 Runtime 行为，不依赖 Game/Memory。
 *
 * 覆盖：TYPE-01 ~ TYPE-12 + Domain Invariants I-UOEM-01 ~ I-UOEM-08
 */

import { describe, it, expect } from "vitest";
import {
  type OperationId,
  type DecisionId,
  type EventId,
  type MilestoneEvent,
  type OutcomeEvent,
  type UOEMEvent,
  type OperationInterval,
  type OutcomeChannelEntry,
  TERMINAL_OUTCOME,
  makeOperationId,
  makeEventId,
  closeInterval,
  computeDuration,
  isTerminalEvent,
  isMilestoneEvent,
  isTerminalOutcomeCode,
  isDuplicateOutcome,
} from "../../../src/domain/expansion/uoem-types";

// ── 测试辅助：构造合法 Event ─────────────────────────────────

function makeMilestone(overrides?: Partial<MilestoneEvent>): MilestoneEvent {
  const base: MilestoneEvent = {
    kind: "milestone",
    eventId: makeEventId(1000, 1),
    operationId: makeOperationId("W1N1", 1000),
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
    eventId: makeEventId(2000, 1),
    operationId: makeOperationId("W1N1", 1000),
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

/** 辅助：构造 DecisionId */
function makeDecisionId(tick: number, seq: number): DecisionId {
  return `D-${tick}-${seq}` as unknown as DecisionId;
}

// ═══════════════════════════════════════════════════════════
// TYPE-01: OperationId 与 DecisionId 类型不可混用
// ═══════════════════════════════════════════════════════════

describe("TYPE-01: OperationId ≠ DecisionId (branded type separation)", () => {
  it("makeOperationId 返回 OperationId", () => {
    const opId = makeOperationId("W1N1", 1000);
    expect(opId).toBe("op:W1N1:1000");
  });

  it("OperationId 和 DecisionId 在运行时是 string，但类型不兼容", () => {
    const opId = makeOperationId("W1N1", 1000);
    const dId = makeDecisionId(1000, 1);
    expect(typeof opId).toBe("string");
    expect(typeof dId).toBe("string");
    // branded type 在编译期阻止互相赋值
    // 以下代码在 TypeScript 中会报错：
    // const x: OperationId = dId; // ❌ Type 'DecisionId' is not assignable to type 'OperationId'
  });

  it("makeOperationId 是确定性的", () => {
    const a = makeOperationId("W1N1", 1000);
    const b = makeOperationId("W1N1", 1000);
    expect(a).toBe(b);
  });

  it("不同 target 或 tick 产生不同 operationId", () => {
    const a = makeOperationId("W1N1", 1000);
    const b = makeOperationId("W2N2", 1000);
    const c = makeOperationId("W1N1", 2000);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-02: MilestoneEvent 不具有 terminal outcome
// ═══════════════════════════════════════════════════════════

describe("TYPE-02: MilestoneEvent has no terminal outcome", () => {
  it("MilestoneEvent 没有 outcomeCode 字段", () => {
    const m = makeMilestone();
    expect((m as unknown as Record<string, unknown>).outcomeCode).toBeUndefined();
  });

  it("MilestoneEvent.kind === 'milestone'", () => {
    const m = makeMilestone();
    expect(m.kind).toBe("milestone");
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-03: OutcomeEvent 必须具有 terminal outcome
// ═══════════════════════════════════════════════════════════

describe("TYPE-03: OutcomeEvent has terminal outcome", () => {
  it("OutcomeEvent 有 outcomeCode", () => {
    const o = makeOutcome();
    expect(o.outcomeCode).toBeDefined();
    expect(typeof o.outcomeCode).toBe("number");
  });

  it("OutcomeEvent.kind === 'outcome'", () => {
    const o = makeOutcome();
    expect(o.kind).toBe("outcome");
  });

  it("outcomeCode 是合法的 TerminalOutcomeCode", () => {
    const o = makeOutcome();
    expect(isTerminalOutcomeCode(o.outcomeCode)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-04: isTerminalEvent(milestone) === false
// ═══════════════════════════════════════════════════════════

describe("TYPE-04: isTerminalEvent(milestone) === false", () => {
  it("CLAIMED milestone 不是 terminal", () => {
    const m = makeMilestone({ milestoneKind: "CLAIMED" });
    expect(isTerminalEvent(m)).toBe(false);
  });

  it("FORCED_ADVANCE milestone 不是 terminal", () => {
    const m = makeMilestone({ milestoneKind: "FORCED_ADVANCE" });
    expect(isTerminalEvent(m)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-05: isTerminalEvent(outcome) === true
// ═══════════════════════════════════════════════════════════

describe("TYPE-05: isTerminalEvent(outcome) === true", () => {
  it("SUCCESS outcome 是 terminal", () => {
    const o = makeOutcome({ outcomeCode: TERMINAL_OUTCOME.SUCCESS });
    expect(isTerminalEvent(o)).toBe(true);
  });

  it("LOST outcome 是 terminal", () => {
    const o = makeOutcome({ outcomeCode: TERMINAL_OUTCOME.LOST });
    expect(isTerminalEvent(o)).toBe(true);
  });

  it("TIMED_OUT outcome 是 terminal", () => {
    const o = makeOutcome({ outcomeCode: TERMINAL_OUTCOME.TIMED_OUT });
    expect(isTerminalEvent(o)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-06: TIMEOUT milestone 不是 terminal event
// ═══════════════════════════════════════════════════════════

describe("TYPE-06: TIMEOUT milestone ≠ terminal event", () => {
  it("BOOTSTRAP_TIMEOUT milestone 不是 terminal（即使 forcedAdvance=true）", () => {
    const m = makeMilestone({
      milestoneKind: "FORCED_ADVANCE",
      forcedAdvance: true,
      state: "economic_startup",
    });
    expect(isTerminalEvent(m)).toBe(false);
  });

  it("ECONOMIC_STARTUP_TIMEOUT milestone 不是 terminal", () => {
    const m = makeMilestone({
      milestoneKind: "FORCED_ADVANCE",
      forcedAdvance: true,
      state: "integrating",
    });
    expect(isTerminalEvent(m)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-07: forcedAdvance 不改变 terminality
// ═══════════════════════════════════════════════════════════

describe("TYPE-07: forcedAdvance does not imply terminality", () => {
  it("forcedAdvance=true 的 milestone 不是 terminal", () => {
    const m = makeMilestone({ forcedAdvance: true });
    expect(isTerminalEvent(m)).toBe(false);
  });

  it("forcedAdvance=true 的 outcome 是 terminal（但不是因为 forcedAdvance）", () => {
    const o = makeOutcome({ forcedAdvance: true });
    expect(isTerminalEvent(o)).toBe(true); // terminality 来自 kind，不来自 forcedAdvance
  });

  it("forcedAdvance=false 的 outcome 也是 terminal", () => {
    const o = makeOutcome({ forcedAdvance: false });
    expect(isTerminalEvent(o)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-08: openedAt 与 closedAt 正确计算 duration
// ═══════════════════════════════════════════════════════════

describe("TYPE-08: duration = closedAt - openedAt", () => {
  it("正常 duration 计算", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 30000 };
    expect(computeDuration(interval)).toBe(29000);
  });

  it("30k tick 长 Operation duration", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 31000 };
    expect(computeDuration(interval)).toBe(30000);
  });

  it("未 closed 的 interval 返回 undefined", () => {
    const interval: OperationInterval = { openedAt: 1000 };
    expect(computeDuration(interval)).toBeUndefined();
  });

  it("OutcomeEvent.duration 与 interval 一致", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 2000 };
    const o = makeOutcome({ interval, duration: 1000 });
    expect(o.duration).toBe(computeDuration(interval));
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-09: openedAt 不能被 transition 语义改变
// ═══════════════════════════════════════════════════════════

describe("TYPE-09: openedAt immutable", () => {
  it("closeInterval 不修改 openedAt", () => {
    const interval: OperationInterval = { openedAt: 1000 };
    const closed = closeInterval(interval, 5000);
    expect(closed.openedAt).toBe(1000);
    expect(closed.closedAt).toBe(5000);
  });

  it("closeInterval 幂等：已关闭的 interval 不变", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 5000 };
    const closed = closeInterval(interval, 10000);
    expect(closed.closedAt).toBe(5000); // 原值不变
  });

  it("多个状态转换不影响 openedAt", () => {
    const interval: OperationInterval = { openedAt: 1000 };
    // 模拟多次状态转换：每次都不修改 openedAt
    const afterState1 = { ...interval }; // preparing
    const afterState2 = { ...afterState1 }; // claiming
    const afterState3 = { ...afterState2 }; // claimed
    const afterState4 = { ...afterState3 }; // bootstrapping
    const finalInterval = closeInterval(afterState4, 25000);
    expect(finalInterval.openedAt).toBe(1000);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-10: OutcomeChannelEntry 类型不能接受 MilestoneEvent
// ═══════════════════════════════════════════════════════════

describe("TYPE-10: OutcomeChannelEntry rejects MilestoneEvent", () => {
  it("OutcomeChannelEntry.event 只能是 OutcomeEvent", () => {
    const o = makeOutcome();
    const entry: OutcomeChannelEntry = { event: o, sequence: 0 };
    expect(entry.event.kind).toBe("outcome");
  });

  // TypeScript 编译期阻止：
  // const m = makeMilestone();
  // const entry: OutcomeChannelEntry = { event: m, sequence: 0 }; // ❌ Type Error
  // 因为 MilestoneEvent 不满足 OutcomeEvent 类型
  it("MilestoneEvent 不能赋值给 OutcomeChannelEntry.event", () => {
    const m = makeMilestone();
    // 运行时验证：milestone 的 kind 是 "milestone"，不是 "outcome"
    expect(m.kind).toBe("milestone");
    expect(isTerminalEvent(m)).toBe(false);
    // 如果强行赋值，类型系统会在编译期拒绝
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-11: target 不是 identity
// ═══════════════════════════════════════════════════════════

describe("TYPE-11: target is not identity", () => {
  it("不同 Operation 可以有相同 target", () => {
    const op1 = makeOperationId("W1N1", 1000);
    const op2 = makeOperationId("W1N1", 5000);
    expect(op1).not.toBe(op2); // 同 target 不同 tick → 不同 operationId
  });

  it("target 只是 correlation 的 business attribute", () => {
    const o = makeOutcome();
    expect(o.correlation.target).toBe("W1N1");
    // target 不是 OperationId
    expect(o.correlation.target).not.toBe(o.operationId);
  });
});

// ═══════════════════════════════════════════════════════════
// TYPE-12: decisionId 不是 operationId
// ═══════════════════════════════════════════════════════════

describe("TYPE-12: decisionId ≠ operationId", () => {
  it("OutcomeEvent 有 operationId 和 decisionId 两个不同字段", () => {
    const opId = makeOperationId("W1N1", 1000);
    const dId = makeDecisionId(1000, 1);
    const o = makeOutcome({
      operationId: opId,
      decisionId: dId,
    });
    expect(o.operationId).toBe(opId);
    expect(o.decisionId).toBe(dId);
    expect(o.operationId).not.toBe(o.decisionId);
  });

  it("isDuplicateOutcome 用 operationId 去重，不用 decisionId", () => {
    const opId1 = makeOperationId("W1N1", 1000);
    const opId2 = makeOperationId("W1N1", 1000); // 同 operation
    const opId3 = makeOperationId("W2N2", 1000); // 不同 operation

    expect(isDuplicateOutcome(
      { operationId: opId1 },
      { operationId: opId2 },
    )).toBe(true); // 同 operation → duplicate

    expect(isDuplicateOutcome(
      { operationId: opId1 },
      { operationId: opId3 },
    )).toBe(false); // 不同 operation → 不 duplicate
  });
});

// ═══════════════════════════════════════════════════════════
// Domain Invariants: I-UOEM-01 ~ I-UOEM-08
// ═══════════════════════════════════════════════════════════

describe("Domain Invariants", () => {
  // I-UOEM-01: Every OutcomeEvent is terminal
  it("I-UOEM-01: every OutcomeEvent is terminal", () => {
    const outcomes: OutcomeEvent[] = [
      makeOutcome({ outcomeCode: TERMINAL_OUTCOME.SUCCESS }),
      makeOutcome({ outcomeCode: TERMINAL_OUTCOME.STOLEN }),
      makeOutcome({ outcomeCode: TERMINAL_OUTCOME.TIMED_OUT }),
      makeOutcome({ outcomeCode: TERMINAL_OUTCOME.LOST }),
      makeOutcome({ outcomeCode: TERMINAL_OUTCOME.ABANDONED }),
    ];
    for (const o of outcomes) {
      expect(isTerminalEvent(o)).toBe(true);
    }
  });

  // I-UOEM-02: No MilestoneEvent is terminal
  it("I-UOEM-02: no MilestoneEvent is terminal", () => {
    const milestones: MilestoneEvent[] = [
      makeMilestone({ milestoneKind: "CLAIMED" }),
      makeMilestone({ milestoneKind: "FORCED_ADVANCE", forcedAdvance: true }),
      makeMilestone({ milestoneKind: "CHECKPOINT_PASSED" }),
      makeMilestone({ milestoneKind: "VALIDATED" }),
    ];
    for (const m of milestones) {
      expect(isTerminalEvent(m)).toBe(false);
    }
  });

  // I-UOEM-03: MilestoneEvent cannot enter OutcomeChannel
  it("I-UOEM-03: MilestoneEvent cannot enter OutcomeChannel (type-level)", () => {
    const m = makeMilestone();
    const o = makeOutcome();
    // OutcomeChannelEntry 只接受 OutcomeEvent
    const entry: OutcomeChannelEntry = { event: o, sequence: 0 };
    expect(entry.event.kind).toBe("outcome");
    // m 不能赋值给 entry.event — 编译期保护
    expect(isTerminalEvent(m)).toBe(false);
  });

  // I-UOEM-04: OperationId distinct from DecisionId
  it("I-UOEM-04: OperationId distinct from DecisionId", () => {
    const opId = makeOperationId("W1N1", 1000);
    const dId = makeDecisionId(1000, 1);
    expect(opId).not.toBe(dId);
    // branded type 在编译期阻止互相赋值
  });

  // I-UOEM-05: openedAt immutable
  it("I-UOEM-05: openedAt immutable", () => {
    const interval: OperationInterval = { openedAt: 1000 };
    const closed = closeInterval(interval, 5000);
    expect(closed.openedAt).toBe(1000);
    expect(interval.openedAt).toBe(1000); // 原对象不变
  });

  // I-UOEM-06: Duration derived from OperationInterval
  it("I-UOEM-06: duration derived from OperationInterval", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 25000 };
    const duration = computeDuration(interval);
    expect(duration).toBe(24000);
    // 不依赖 expansion.startedAt
  });

  // I-UOEM-07: forcedAdvance does not imply terminality
  it("I-UOEM-07: forcedAdvance does not imply terminality", () => {
    const m = makeMilestone({ forcedAdvance: true });
    const o = makeOutcome({ forcedAdvance: true });
    // forcedAdvance=true 的 milestone 仍不是 terminal
    expect(isTerminalEvent(m)).toBe(false);
    // forcedAdvance=true 的 outcome 是 terminal，但不是因为 forcedAdvance
    expect(isTerminalEvent(o)).toBe(true);
  });

  // I-UOEM-08: Outcome code does not determine event kind
  it("I-UOEM-08: outcomeCode does not determine event kind", () => {
    // MilestoneEvent 没有 outcomeCode 字段
    const m = makeMilestone();
    expect((m as unknown as Record<string, unknown>).outcomeCode).toBeUndefined();

    // OutcomeEvent 有 outcomeCode，但 terminality 来自 kind
    const o = makeOutcome({ outcomeCode: TERMINAL_OUTCOME.TIMED_OUT });
    expect(isTerminalEvent(o)).toBe(true); // 因为 kind="outcome"，不是因为 outcomeCode=TIMED_OUT
  });
});

// ═══════════════════════════════════════════════════════════
// Determinism Tests
// ═══════════════════════════════════════════════════════════

describe("Determinism", () => {
  it("makeOperationId is deterministic (100x replay)", () => {
    const expected = "op:W1N1:1000";
    for (let i = 0; i < 100; i++) {
      expect(makeOperationId("W1N1", 1000)).toBe(expected);
    }
  });

  it("makeEventId is deterministic (100x replay)", () => {
    const expected = "E-1000-1";
    for (let i = 0; i < 100; i++) {
      expect(makeEventId(1000, 1)).toBe(expected);
    }
  });

  it("computeDuration is deterministic", () => {
    const interval: OperationInterval = { openedAt: 1000, closedAt: 30000 };
    for (let i = 0; i < 100; i++) {
      expect(computeDuration(interval)).toBe(29000);
    }
  });

  it("isTerminalEvent is deterministic", () => {
    const m = makeMilestone();
    const o = makeOutcome();
    for (let i = 0; i < 100; i++) {
      expect(isTerminalEvent(m)).toBe(false);
      expect(isTerminalEvent(o)).toBe(true);
    }
  });

  it("isDuplicateOutcome is deterministic", () => {
    const opId = makeOperationId("W1N1", 1000);
    for (let i = 0; i < 100; i++) {
      expect(isDuplicateOutcome({ operationId: opId }, { operationId: opId })).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Counterfactual: EXP-1 structural prevention
// ═══════════════════════════════════════════════════════════

describe("Counterfactual: EXP-1 structural prevention", () => {
  it("CF-UOEM-01: claim success (milestone) cannot enter channel", () => {
    const claimMilestone = makeMilestone({
      milestoneKind: "CLAIMED",
      state: "claimed",
      forcedAdvance: false,
    });
    // isTerminalEvent = false → 不能进入 OutcomeChannel
    expect(isTerminalEvent(claimMilestone)).toBe(false);
  });

  it("CF-UOEM-02: forced advance (timeout+spawn) cannot enter channel", () => {
    const forcedMilestone = makeMilestone({
      milestoneKind: "FORCED_ADVANCE",
      state: "economic_startup",
      forcedAdvance: true,
    });
    expect(isTerminalEvent(forcedMilestone)).toBe(false);
  });

  it("CF-UOEM-03: only actual terminal outcome enters channel", () => {
    const terminalOutcome = makeOutcome({
      outcomeCode: TERMINAL_OUTCOME.SUCCESS,
      forcedAdvance: true, // 强推后成功
    });
    expect(isTerminalEvent(terminalOutcome)).toBe(true);
  });

  it("CF-UOEM-04: multiple milestones + single terminal = one channel entry", () => {
    const opId = makeOperationId("W1N1", 1000);
    const m1 = makeMilestone({ operationId: opId, milestoneKind: "CLAIMED", eventId: makeEventId(1000, 1) });
    const m2 = makeMilestone({ operationId: opId, milestoneKind: "FORCED_ADVANCE", eventId: makeEventId(2000, 2), forcedAdvance: true });
    const m3 = makeMilestone({ operationId: opId, milestoneKind: "FORCED_ADVANCE", eventId: makeEventId(3000, 3), forcedAdvance: true });
    const o = makeOutcome({ operationId: opId, eventId: makeEventId(25000, 4) });

    // 只有 outcome 能进入 channel
    const channelEntries: OutcomeChannelEntry[] = [];
    for (const ev of [m1, m2, m3, o] as UOEMEvent[]) {
      if (isTerminalEvent(ev)) {
        channelEntries.push({ event: ev, sequence: channelEntries.length });
      }
    }
    expect(channelEntries).toHaveLength(1);
    expect(channelEntries[0]!.event.kind).toBe("outcome");
  });

  it("CF-UOEM-05: same operation duplicate terminal is rejected", () => {
    const opId = makeOperationId("W1N1", 1000);
    const existing = { operationId: opId };
    const incoming = { operationId: opId };
    expect(isDuplicateOutcome(existing, incoming)).toBe(true);
  });
});
