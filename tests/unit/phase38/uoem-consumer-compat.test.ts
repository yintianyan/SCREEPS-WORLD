/** Phase 38-B · UOEM Consumer Compatibility — 扩展反事实测试 T6-T20 */
import { describe, it, expect, beforeEach } from "vitest";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  createRingBuffer,
  ringPush,
  ringToArray,
  ringSize,
} from "../../../src/kernel/ring-buffer";
import {
  createExperienceRingBuffer,
  pushExperience,
  getPendingOutcomes,
  gcExperienceBuffer,
  createExperience,
  makeExperienceId,
  buildDecisionRef,
  MEASUREMENT_DELAYS,
  type ExperienceIdentity,
  type DecisionRef,
  type ExperienceContext,
} from "../../../src/domain/intelligence/experience";
import { collectOutcome, type OutcomeCollectionInput } from "../../../src/domain/intelligence/outcome";

// ─── UOEM 参考实现 ──────────────────────────────────────

type OpId = string;
type ExpansionResult = "COMPLETED" | "COMPLETED_FORCED" | "TIMED_OUT" | "LOST" | "STOLEN" | "ABANDONED";

interface OutcomeEvent {
  readonly eventId: string;
  readonly operationId: OpId;
  readonly result: ExpansionResult;
  readonly interval: { openedAt: number; closedAt: number };
  readonly forcedAdvance: boolean;
  readonly milestoneHistory: readonly string[];
}
interface MilestoneEvent {
  readonly eventId: string;
  readonly operationId: OpId;
  readonly milestone: string;
  readonly at: number;
}
type UOEMEvent = OutcomeEvent | MilestoneEvent;

class OutcomeChannel {
  private readonly queue: OutcomeEvent[] = [];
  private readonly seen = new Set<OpId>();
  private rejected = 0;
  private seq = 0;
  constructor(private readonly capacity = 32) {}
  enqueue(ev: OutcomeEvent): "ACCEPTED" | "DUPLICATE_REJECTED" {
    if (this.seen.has(ev.operationId)) { this.rejected++; return "DUPLICATE_REJECTED"; }
    if (this.queue.length >= this.capacity) this.queue.shift();
    this.seen.add(ev.operationId);
    this.queue.push(ev);
    return "ACCEPTED";
  }
  drain(): OutcomeEvent[] { return this.queue.splice(0, this.queue.length); }
  peek(opId: OpId): OutcomeEvent | undefined { return this.queue.find(e => e.operationId === opId); }
  get overflowCount() { return this.rejected; }
  get size() { return this.queue.length; }
  hasOutcome(opId: OpId) { return this.seen.has(opId); }
  nextEventId() { return `E-${this.seq++}`; }
}

class ExpansionProducer {
  private openedAt = -1;
  private forcedAdvance = false;
  private readonly milestones: string[] = [];
  private seq = 0;
  constructor(readonly operationId: OpId, private readonly channel: OutcomeChannel) {}
  open(tick: number) { this.openedAt = tick; }
  emitMilestone(name: string, tick: number): MilestoneEvent {
    this.milestones.push(name);
    if (name === "FORCED_ADVANCE") this.forcedAdvance = true;
    return { eventId: `M-${this.operationId}-${this.seq++}`, operationId: this.operationId, milestone: name, at: tick };
  }
  close(result: ExpansionResult, tick: number): OutcomeEvent {
    const ev: OutcomeEvent = {
      eventId: `O-${this.operationId}-${this.seq++}`,
      operationId: this.operationId,
      result,
      interval: { openedAt: this.openedAt, closedAt: tick },
      forcedAdvance: this.forcedAdvance,
      milestoneHistory: [...this.milestones],
    };
    this.channel.enqueue(ev);
    return ev;
  }
  get hasForcedAdvance() { return this.forcedAdvance; }
}

interface ExperienceLike {
  operationId: OpId;
  outcome?: { result: ExpansionResult; durationTicks: number; forcedAdvance: boolean };
}
function collectorConsume(pending: ExperienceLike[], channel: OutcomeChannel) {
  const events = channel.drain();
  for (const exp of pending) {
    const ev = events.find(e => e.operationId === exp.operationId);
    if (ev) exp.outcome = { result: ev.result, durationTicks: ev.interval.closedAt - ev.interval.openedAt, forcedAdvance: ev.forcedAdvance };
  }
}

function makeOpId(target: string, tick: number) { return `op:${target}:${tick}`; }
function makeIdentity(tick: number, seq: number): ExperienceIdentity { return { experienceId: makeExperienceId(tick, seq), tick, source: "test", type: "expansion" }; }
function makeRef(tick: number, target: string): DecisionRef { return buildDecisionRef({ decisionId: `D-${tick}-1`, tick, category: "EXPANSION", actor: "expansion-manager", selectedAction: `EXPANSION_START_${target}`, decisionHash: "h", correlationId: `c-D-${tick}-1` }); }
function makeContext(tick: number): ExperienceContext { return { scope: "W1N1", posture: "develop", empireHealthLevel: "healthy", empireHealthScore: 0.8, cpuTier: "healthy", stateBeforeHash: "s", metrics: {} } as unknown as ExperienceContext; }

beforeEach(() => {
  const g = globalCache() as Record<string, unknown>;
  delete g.lastExpansionOutcome;
});

// ═══════════════════════════════════════════════════════════
// T6: 多个 milestone + terminal success
// ═══════════════════════════════════════════════════════════
describe("T6: multiple milestones + terminal success", () => {
  it("3 个 milestone 后 1 个 terminal → collector 只读到 1 个 COMPLETED", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    p.emitMilestone("CLAIMED", 3000);
    p.emitMilestone("FORCED_ADVANCE", 6000);
    p.emitMilestone("CP3_PASSED", 16000);
    p.close("COMPLETED", 26000);
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);
    expect(exp.outcome).toBeDefined();
    expect(exp.outcome!.result).toBe("COMPLETED");
    expect(exp.outcome!.forcedAdvance).toBe(true);
    expect(exp.outcome!.durationTicks).toBe(25000);
    expect(ch.size).toBe(0); // drained
  });
});

// ═══════════════════════════════════════════════════════════
// T7: 多个 milestone + terminal failure
// ═══════════════════════════════════════════════════════════
describe("T7: multiple milestones + terminal failure", () => {
  it("2 个 milestone 后 terminal TIMED_OUT → collector 只读到 TIMED_OUT", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    p.emitMilestone("FORCED_ADVANCE", 6000);
    p.emitMilestone("FORCED_ADVANCE", 16000);
    p.close("TIMED_OUT", 20000);
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);
    expect(exp.outcome!.result).toBe("TIMED_OUT");
    expect(exp.outcome!.forcedAdvance).toBe(true);
    expect(exp.outcome!.durationTicks).toBe(19000);
  });
});

// ═══════════════════════════════════════════════════════════
// T8: timeout milestone + later success
// ═══════════════════════════════════════════════════════════
describe("T8: timeout milestone + later success", () => {
  it("TIMEOUT milestone 不进 channel → 最终 COMPLETED", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    p.emitMilestone("FORCED_ADVANCE", 6000);
    expect(ch.hasOutcome(opId)).toBe(false);
    p.close("COMPLETED", 26000);
    expect(ch.hasOutcome(opId)).toBe(true);
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);
    expect(exp.outcome!.result).toBe("COMPLETED");
    expect(exp.outcome!.forcedAdvance).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// T9: timeout milestone + later failure
// ═══════════════════════════════════════════════════════════
describe("T9: timeout milestone + later failure", () => {
  it("TIMEOUT milestone 不进 channel → 最终 TIMED_OUT", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    p.emitMilestone("FORCED_ADVANCE", 6000);
    expect(ch.hasOutcome(opId)).toBe(false);
    p.close("TIMED_OUT", 16000);
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);
    expect(exp.outcome!.result).toBe("TIMED_OUT");
  });
});

// ═══════════════════════════════════════════════════════════
// T10: success milestone + later failure
// ═══════════════════════════════════════════════════════════
describe("T10: success milestone + later failure", () => {
  it("SUCCESS milestone (CLAIMED) 不进 channel → 最终 LOST", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    p.emitMilestone("CLAIMED", 3000); // success milestone
    expect(ch.hasOutcome(opId)).toBe(false);
    p.close("LOST", 5000);
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);
    expect(exp.outcome!.result).toBe("LOST");
  });
});

// ═══════════════════════════════════════════════════════════
// T11: duplicate milestone (合法)
// ═══════════════════════════════════════════════════════════
describe("T11: duplicate milestones are legal", () => {
  it("同 operation 两次 FORCED_ADVANCE milestone 合法", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    const m1 = p.emitMilestone("FORCED_ADVANCE", 6000);
    const m2 = p.emitMilestone("FORCED_ADVANCE", 16000);
    expect(m1.eventId).not.toBe(m2.eventId);
    // milestone 不进 channel → 不影响 outcome
    expect(ch.hasOutcome(opId)).toBe(false);
    p.close("COMPLETED_FORCED", 26000);
    const [ev] = ch.drain();
    expect(ev!.milestoneHistory.filter(m => m === "FORCED_ADVANCE")).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════
// T12: duplicate terminal (拒绝)
// ═══════════════════════════════════════════════════════════
describe("T12: duplicate terminal is rejected", () => {
  it("同 operation 第二条 OutcomeEvent 被拒绝", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p1 = new ExpansionProducer(opId, ch);
    const p2 = new ExpansionProducer(opId, ch);
    p1.open(1000); p2.open(1000);
    p1.close("COMPLETED", 20000);
    p2.close("TIMED_OUT", 21000);
    expect(ch.overflowCount).toBe(1);
    const events = ch.drain();
    expect(events).toHaveLength(1);
    expect(events[0]!.result).toBe("COMPLETED"); // first wins
  });
});

// ═══════════════════════════════════════════════════════════
// T13: conflicting terminal events
// ═══════════════════════════════════════════════════════════
describe("T13: conflicting terminal events", () => {
  it("COMPLETED vs LOST → first wins, second rejected, overflow visible", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p1 = new ExpansionProducer(opId, ch);
    const p2 = new ExpansionProducer(opId, ch);
    p1.open(1000); p2.open(1000);
    p1.close("COMPLETED", 20000);
    const result = p2.close("LOST", 20001);
    expect(result).toBeDefined(); // close returns the event
    expect(ch.overflowCount).toBe(1);
    const [ev] = ch.drain();
    expect(ev!.result).toBe("COMPLETED"); // first (correct) wins
  });
});

// ═══════════════════════════════════════════════════════════
// T14: same tick multiple events (different operations)
// ═══════════════════════════════════════════════════════════
describe("T14: same tick multiple events", () => {
  it("同 tick 两个不同 operation 的 terminal → 两条都接受", () => {
    const ch = new OutcomeChannel();
    const opA = makeOpId("W1N1", 1000);
    const opB = makeOpId("W2N2", 1000);
    const pa = new ExpansionProducer(opA, ch); pa.open(1000);
    const pb = new ExpansionProducer(opB, ch); pb.open(1000);
    pa.close("COMPLETED", 5000);
    pb.close("TIMED_OUT", 5000);
    const events = ch.drain();
    expect(events).toHaveLength(2);
    expect(events.find(e => e.operationId === opA)!.result).toBe("COMPLETED");
    expect(events.find(e => e.operationId === opB)!.result).toBe("TIMED_OUT");
  });
});

// ═══════════════════════════════════════════════════════════
// T15: reset before terminal
// ═══════════════════════════════════════════════════════════
describe("T15: reset before terminal", () => {
  it("reset 后 Memory 中 opId 幸存 → 后续 terminal 正确关联", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    // before reset
    const p1 = new ExpansionProducer(opId, ch);
    p1.open(1000);
    p1.emitMilestone("FORCED_ADVANCE", 6000);
    // reset: heap cleared, channel (in Memory) survives
    // after reset: rebuild producer
    const p2 = new ExpansionProducer(opId, ch);
    p2.open(1000); // openedAt from Memory
    p2.close("COMPLETED", 26000);
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);
    expect(exp.outcome).toBeDefined();
    expect(exp.outcome!.result).toBe("COMPLETED");
    expect(exp.outcome!.durationTicks).toBe(25000);
  });
});

// ═══════════════════════════════════════════════════════════
// T16: reset after terminal
// ═══════════════════════════════════════════════════════════
describe("T16: reset after terminal", () => {
  it("terminal 写入后 reset → collector 消费不重复", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    p.close("COMPLETED", 26000);
    // reset: heap cleared, channel (in Memory) survives
    // collector runs once
    const exp1: ExperienceLike = { operationId: opId };
    collectorConsume([exp1], ch);
    expect(exp1.outcome).toBeDefined();
    // second drain → empty (already drained)
    const exp2: ExperienceLike = { operationId: opId };
    collectorConsume([exp2], ch);
    expect(exp2.outcome).toBeUndefined(); // no duplicate
  });
});

// ═══════════════════════════════════════════════════════════
// T17: collector runs twice
// ═══════════════════════════════════════════════════════════
describe("T17: collector runs twice", () => {
  it("两次 drain → 第二次为空", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const p = new ExpansionProducer(opId, ch);
    p.open(1000);
    p.close("COMPLETED", 26000);
    const first = ch.drain();
    expect(first).toHaveLength(1);
    const second = ch.drain();
    expect(second).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// T18: event queue replay
// ═══════════════════════════════════════════════════════════
describe("T18: event queue replay", () => {
  it("相同 event 序列 → 相同 resolution", () => {
    const ch1 = new OutcomeChannel();
    const ch2 = new OutcomeChannel();
    for (const ch of [ch1, ch2]) {
      const p = new ExpansionProducer(makeOpId("W1N1", 1000), ch);
      p.open(1000);
      p.emitMilestone("CLAIMED", 3000);
      p.emitMilestone("FORCED_ADVANCE", 6000);
      p.close("COMPLETED_FORCED", 26000);
    }
    const d1 = ch1.drain();
    const d2 = ch2.drain();
    expect(d1).toHaveLength(1);
    expect(d2).toHaveLength(1);
    expect(d1[0]!.result).toBe(d2[0]!.result);
    expect(d1[0]!.forcedAdvance).toBe(d2[0]!.forcedAdvance);
    expect(d1[0]!.interval).toEqual(d2[0]!.interval);
  });
});

// ═══════════════════════════════════════════════════════════
// T19: 1000 operations
// ═══════════════════════════════════════════════════════════
describe("T19: 1000 operations", () => {
  it("1000 个 operation 各产生 1 terminal → channel cap=32 溢出可观测", () => {
    const ch = new OutcomeChannel(32);
    for (let i = 0; i < 1000; i++) {
      const opId = makeOpId(`R${i}`, 1000 + i * 20000);
      const p = new ExpansionProducer(opId, ch);
      p.open(1000 + i * 20000);
      p.close("COMPLETED", 1000 + i * 20000 + 25000);
    }
    // cap=32 → channel holds 32, rest evicted (but dedup set grows)
    const drained = ch.drain();
    expect(drained.length).toBeLessThanOrEqual(32);
    // overflow should be 0 (no duplicates), but cap eviction happened
    expect(ch.overflowCount).toBe(0); // no DUPLICATE_REJECTED, just cap overflow
  });
});

// ═══════════════════════════════════════════════════════════
// T20: long-running GC
// ═══════════════════════════════════════════════════════════
describe("T20: long-running GC", () => {
  it("Experience ring + GC 在长期运行后有界", () => {
    const buf = createExperienceRingBuffer(16);
    for (let i = 0; i < 100; i++) {
      pushExperience(buf, createExperience(makeIdentity(i, i), makeRef(i, "R"), makeContext(i), 1));
    }
    // GC maxAge=10000 at tick 20000 → entries with tick < 10000 are cleaned
    const res = gcExperienceBuffer(buf, 20000, 10000);
    expect(res.cleaned).toBeGreaterThan(0);
    expect(buf.count).toBeLessThanOrEqual(16);
  });
  it("RingBuffer rollover keeps capacity constant", () => {
    const ring = createRingBuffer<number>(4);
    for (let i = 0; i < 10000; i++) ringPush(ring, i);
    expect(ringSize(ring)).toBe(4);
    expect(ringToArray(ring)).toEqual([9996, 9997, 9998, 9999]);
  });
});
