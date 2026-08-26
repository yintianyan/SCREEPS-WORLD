/**
 * Phase 38 · TIMEOUT-SEMANTICS 反事实测试
 *
 * 验证 UOEM 模型对 TIMEOUT 的三态语义正确处理：
 *   - TIMEOUT as Terminal Failure → OutcomeEvent(result: "TIMED_OUT")
 *   - TIMEOUT as Transition (Milestone) → MilestoneEvent("FORCED_ADVANCE")
 *   - TIMEOUT as Forced Success → OutcomeEvent(result: "COMPLETED_FORCED", forcedAdvance: true)
 *
 * 测试基于 UOEM 参考实现（与 uoem-proof.test.ts 同构），不依赖生产代码。
 * 生产代码当前不满足这些 invariant——这些测试固化 UOEM 模型的目标语义。
 *
 *   T1: bootstrapping timeout → economic_startup → final success
 *       → 不能因为中间出现 TIMEOUT 就把最终 Outcome 判定为 TIMEOUT
 *   T2: bootstrapping timeout → economic_startup → final failure
 *       → 最终 Outcome 必须是 FAILURE (TIMED_OUT)
 *   T3: bootstrapping timeout → collector 在 timeout 后立即运行
 *       → collector 不能提前把 timeout 当成 terminal outcome
 *   T4: bootstrapping timeout → reset → operation continues → final success
 *       → reset 不改变最终 Outcome
 *   T5: multiple timeout milestones → final success
 *       → 所有 timeout 都只能作为 lifecycle evidence，不能产生多个 terminal outcomes
 */
import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════
// UOEM 参考实现（与 uoem-proof.test.ts 同构，扩展 TIMEOUT 语义）
// ═══════════════════════════════════════════════════════════

type OpId = string;

interface BaseEvent {
  readonly eventId: string;
  readonly operationId: OpId;
}
interface MilestoneEvent extends BaseEvent {
  readonly kind: "MILESTONE";
  readonly milestone: string;
  readonly at: number;
}
type ExpansionResult =
  | "COMPLETED" | "COMPLETED_FORCED"
  | "TIMED_OUT" | "LOST" | "STOLEN" | "ABANDONED";
interface OutcomeEvent extends BaseEvent {
  readonly kind: "OUTCOME";
  readonly domain: "expansion";
  readonly result: ExpansionResult;
  readonly interval: { readonly openedAt: number; readonly closedAt: number };
  readonly forcedAdvance: boolean;
  readonly milestoneHistory: readonly string[];
}
type UOEMEvent = OutcomeEvent | MilestoneEvent;

class OutcomeChannel {
  private readonly queue: OutcomeEvent[] = [];
  private readonly seen = new Set<OpId>();
  private rejected = 0;
  constructor(private readonly capacity = 32) {}
  enqueue(ev: OutcomeEvent): "ACCEPTED" | "DUPLICATE_REJECTED" {
    if (this.seen.has(ev.operationId)) {
      this.rejected++;
      return "DUPLICATE_REJECTED";
    }
    if (this.queue.length >= this.capacity) {
      this.queue.shift();
    }
    this.seen.add(ev.operationId);
    this.queue.push(ev);
    return "ACCEPTED";
  }
  drain(): OutcomeEvent[] {
    return this.queue.splice(0, this.queue.length);
  }
  get overflowCount(): number {
    return this.rejected;
  }
  hasOutcome(opId: OpId): boolean {
    return this.seen.has(opId);
  }
}

/**
 * Producer：模拟 Expansion State Machine 的 UOEM 感知版本。
 * 关键区别：milestone 与 outcome 走不同函数，不共用 recordExpansionOutcome。
 */
class ExpansionProducer {
  private openedAt = -1;
  private forcedAdvance = false;
  private readonly milestones: string[] = [];

  constructor(
    readonly operationId: OpId,
    private readonly channel: OutcomeChannel,
  ) {}

  open(tick: number): void {
    this.openedAt = tick;
  }

  /** Milestone：状态转换、checkpoint 通过、timeout+强推。
   * 不进入 outcome 通道。 */
  emitMilestone(name: string, tick: number): MilestoneEvent {
    this.milestones.push(name);
    if (name === "FORCED_ADVANCE") this.forcedAdvance = true;
    return {
      kind: "MILESTONE",
      milestone: name,
      at: tick,
      eventId: `E-${tick}-m-${this.milestones.length}`,
      operationId: this.operationId,
    };
  }

  /** Terminal Outcome：唯一终态出口。
   * forcedAdvance 标志传播：如果历史上经历过任何 FORCED_ADVANCE，标记为 true。 */
  close(result: ExpansionResult, tick: number): OutcomeEvent {
    const ev: OutcomeEvent = {
      kind: "OUTCOME",
      domain: "expansion",
      result,
      operationId: this.operationId,
      eventId: `E-${tick}-o`,
      interval: { openedAt: this.openedAt, closedAt: tick },
      forcedAdvance: this.forcedAdvance,
      milestoneHistory: [...this.milestones],
    };
    this.channel.enqueue(ev);
    return ev;
  }

  get hasForcedAdvance(): boolean {
    return this.forcedAdvance;
  }
}

/** Collector：只认 OUTCOME + operationId 关联。 */
interface ExperienceLike {
  operationId: OpId;
  outcome?: { result: ExpansionResult; durationTicks: number; forcedAdvance: boolean };
  unresolved?: boolean;
}
function collectorConsume(
  pending: ExperienceLike[],
  channel: OutcomeChannel,
): void {
  const events = channel.drain();
  for (const exp of pending) {
    const ev = events.find(e => e.operationId === exp.operationId);
    if (ev) {
      exp.outcome = {
        result: ev.result,
        durationTicks: ev.interval.closedAt - ev.interval.openedAt,
        forcedAdvance: ev.forcedAdvance,
      };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────

function makeOpId(target: string, consumeTick: number): OpId {
  return `op:${target}:${consumeTick}`;
}

// ═══════════════════════════════════════════════════════════
// T1: bootstrapping timeout → economic_startup → final success
// ═══════════════════════════════════════════════════════════

describe("T1: bootstrapping timeout milestone does not contaminate final SUCCESS", () => {
  it("中间出现 TIMEOUT milestone → 最终 Outcome 是 COMPLETED，不是 TIMED_OUT", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    // T0+5k: bootstrapping timeout + spawn exists → MILESTONE (not Outcome!)
    producer.emitMilestone("FORCED_ADVANCE", 6000);

    // T0+15k: economic_startup CP3+CP4 passed → state transition (milestone)
    producer.emitMilestone("CP3_PASSED", 16000);
    producer.emitMilestone("CP4_PASSED", 16000);

    // T0+25k: integrating CP5 passed → TERMINAL OUTCOME
    producer.close("COMPLETED", 26000);

    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);

    // 验证：最终 Outcome 是 COMPLETED
    expect(exp.outcome).toBeDefined();
    expect(exp.outcome!.result).toBe("COMPLETED");
    expect(exp.outcome!.result).not.toBe("TIMED_OUT");

    // 验证：forcedAdvance = true（经历过 bootstrapping timeout 强推）
    expect(exp.outcome!.forcedAdvance).toBe(true);

    // 验证：duration 是完整生命周期（26000 - 1000 = 25000）
    expect(exp.outcome!.durationTicks).toBe(25000);

    // 验证：channel 中只有一条 OUTCOME（没有中间 TIMEOUT）
    expect(ch.overflowCount).toBe(0);
  });

  it("如果 producer 错误地把 milestone 当 outcome 写入 → channel 幂等拒绝", () => {
    // 这是为了证明：即使 producer 有 bug，channel 层也能防住
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    // 模拟 bug：milestone 被错误地 close 成 TIMED_OUT
    producer.close("TIMED_OUT", 6000);
    // 后续正确的 terminal
    producer.close("COMPLETED", 26000);

    // channel 幂等：第二次 enqueue 被拒绝
    expect(ch.overflowCount).toBe(1);
    const events = ch.drain();
    expect(events).toHaveLength(1);
    expect(events[0]!.result).toBe("TIMED_OUT"); // 第一次写入保留
    // ⚠️ 这暴露了一个问题：如果 milestone 被错误地 enqueue，它会占据 channel 槽位
    // 正确的修复是：milestone 根本不走 enqueue（UOEM 的 kind 分离保证）
  });
});

// ═══════════════════════════════════════════════════════════
// T2: bootstrapping timeout → economic_startup → final failure
// ═══════════════════════════════════════════════════════════

describe("T2: bootstrapping timeout milestone → final failure is TIMED_OUT", () => {
  it("中间 TIMEOUT milestone + 最终 TIMEOUT terminal → 最终 Outcome 是 TIMED_OUT", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    // T0+5k: bootstrapping timeout + spawn exists → MILESTONE
    producer.emitMilestone("FORCED_ADVANCE", 6000);

    // T0+15k: economic_startup timeout + no cp3 → TERMINAL OUTCOME
    producer.close("TIMED_OUT", 16000);

    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);

    expect(exp.outcome).toBeDefined();
    expect(exp.outcome!.result).toBe("TIMED_OUT");

    // forcedAdvance = true（经历过 bootstrapping timeout 强推）
    expect(exp.outcome!.forcedAdvance).toBe(true);

    // duration = 16000 - 1000 = 15000
    expect(exp.outcome!.durationTicks).toBe(15000);
  });
});

// ═══════════════════════════════════════════════════════════
// T3: collector 在 timeout milestone 后立即运行
// ═══════════════════════════════════════════════════════════

describe("T3: collector cannot treat timeout milestone as terminal outcome", () => {
  it("milestone 后 channel 无 Outcome → collector pending（诚实等待）", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    // T0+5k: bootstrapping timeout → MILESTONE (不进 outcome 通道)
    producer.emitMilestone("FORCED_ADVANCE", 6000);

    // T0+5k+1: collector 到达测量窗口 — channel 中无 Outcome
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);

    // 没有 Outcome → pending 继续（诚实等待）
    expect(exp.outcome).toBeUndefined();
    expect(exp.unresolved).toBeFalsy(); // 还不到 maxDelay，只是 pending

    // channel 仍然空
    expect(ch.hasOutcome(opId)).toBe(false);
  });

  it("milestone 后最终 Outcome 到达 → collector 正确消费", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    producer.emitMilestone("FORCED_ADVANCE", 6000);
    producer.emitMilestone("CP3_PASSED", 16000);

    // T0+25k: terminal outcome
    producer.close("COMPLETED", 26000);

    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);

    expect(exp.outcome).toBeDefined();
    expect(exp.outcome!.result).toBe("COMPLETED");
    expect(exp.outcome!.forcedAdvance).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// T4: bootstrapping timeout → reset → operation continues → final success
// ═══════════════════════════════════════════════════════════

describe("T4: reset does not change final Outcome", () => {
  it("reset 前有 milestone → reset 后 Memory 幸存 → final Outcome 不变", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);

    // reset 前：open + milestone
    const producerBeforeReset = new ExpansionProducer(opId, ch);
    producerBeforeReset.open(1000);
    producerBeforeReset.emitMilestone("FORCED_ADVANCE", 6000);

    // 模拟 global reset：heap 全灭（channel 若存 Memory 则幸存）
    // 在 UOEM 模型中 channel 存 Memory → reset 后 channel 仍可用

    // reset 后：重建 producer 引用同一 opId
    const producerAfterReset = new ExpansionProducer(opId, ch);
    // openedAt 从 Memory 恢复（在实际实现中）
    // 此处模拟：producer 知道 openedAt=1000
    producerAfterReset.open(1000);

    // 最终 terminal outcome
    producerAfterReset.close("COMPLETED", 26000);

    const rebuiltExperience: ExperienceLike = { operationId: opId };
    collectorConsume([rebuiltExperience], ch);

    expect(rebuiltExperience.outcome).toBeDefined();
    expect(rebuiltExperience.outcome!.result).toBe("COMPLETED");
    // forcedAdvance 信息在 milestone 中，reset 后 milestone 丢失
    // 但 producer 可以从 Memory 中恢复 forcedAdvance 标志
    // 此处简化：reset 后 forcedAdvance 信息取决于实现
  });
});

// ═══════════════════════════════════════════════════════════
// T5: multiple timeout milestones → final success
// ═══════════════════════════════════════════════════════════

describe("T5: multiple timeout milestones produce single terminal outcome", () => {
  it("两次 FORCED_ADVANCE milestone → 只有一个 COMPLETED_FORCED terminal outcome", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    // 第一次 timeout milestone (bootstrapping → economic_startup)
    producer.emitMilestone("FORCED_ADVANCE", 6000);

    // 第二次 timeout milestone (economic_startup → integrating)
    producer.emitMilestone("FORCED_ADVANCE", 16000);

    // 最终 timeout + netFlow>0 + integrated → forced success
    producer.close("COMPLETED_FORCED", 26000);

    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);

    // 只有一个 terminal outcome
    expect(exp.outcome).toBeDefined();
    expect(exp.outcome!.result).toBe("COMPLETED_FORCED");

    // forcedAdvance = true（经历过两次强推）
    expect(exp.outcome!.forcedAdvance).toBe(true);

    // duration 是完整生命周期
    expect(exp.outcome!.durationTicks).toBe(25000);

    // channel 中只有一条 OUTCOME
    expect(ch.overflowCount).toBe(0);
    expect(ch.drain()).toHaveLength(0); // 已 drain
  });

  it("milestone 历史保留在 outcome event 中（审计用）", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    producer.emitMilestone("CLAIMED", 3000);
    producer.emitMilestone("FORCED_ADVANCE", 6000);
    producer.emitMilestone("CP3_PASSED", 16000);
    producer.emitMilestone("FORCED_ADVANCE", 16001);

    const terminalEv = producer.close("COMPLETED_FORCED", 26000);

    // milestone 历史作为审计字段保留
    expect(terminalEv.milestoneHistory).toContain("CLAIMED");
    expect(terminalEv.milestoneHistory).toContain("FORCED_ADVANCE");
    expect(terminalEv.milestoneHistory.filter(m => m === "FORCED_ADVANCE")).toHaveLength(2);
    expect(terminalEv.forcedAdvance).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Invariant 验证
// ═══════════════════════════════════════════════════════════

describe("TIMEOUT-SEMANTICS Invariants", () => {
  // I11: Terminal Semantics
  it("I11: outcome.result == TIMED_OUT 只在 terminal state 产生", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    // milestone 不产生 outcome
    producer.emitMilestone("FORCED_ADVANCE", 6000);
    expect(ch.hasOutcome(opId)).toBe(false);

    // terminal 才产生 outcome
    producer.close("TIMED_OUT", 16000);
    expect(ch.hasOutcome(opId)).toBe(true);
    const [ev] = ch.drain();
    expect(ev!.result).toBe("TIMED_OUT");
  });

  // I12: Continuation Safety
  it("I12: milestone 后 operation 继续 → 不产生 outcome", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    producer.emitMilestone("FORCED_ADVANCE", 6000);
    producer.emitMilestone("CP3_PASSED", 16000);

    // operation 继续 → 无 outcome
    expect(ch.hasOutcome(opId)).toBe(false);

    // collector 无 outcome 可消费
    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);
    expect(exp.outcome).toBeUndefined();
  });

  // I13: Finality
  it("I13: 只有 terminal state 才产生 OutcomeEvent", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    // 多次 milestone 都不产生 outcome
    producer.emitMilestone("CLAIMED", 3000);
    producer.emitMilestone("FORCED_ADVANCE", 6000);
    producer.emitMilestone("CP3_PASSED", 16000);
    expect(ch.hasOutcome(opId)).toBe(false);

    // 只有 close (terminal) 才产生
    producer.close("COMPLETED", 26000);
    expect(ch.hasOutcome(opId)).toBe(true);
  });

  // I14: Monotonic Resolution
  it("I14: terminal outcome 产生后，后续 milestone 不改变已解析的 outcome", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W1N1", 1000);
    const producer = new ExpansionProducer(opId, ch);
    producer.open(1000);

    producer.close("COMPLETED", 26000);

    // 尝试再次 close → channel 幂等拒绝
    producer.close("TIMED_OUT", 27000);
    expect(ch.overflowCount).toBe(1);

    const events = ch.drain();
    expect(events).toHaveLength(1);
    expect(events[0]!.result).toBe("COMPLETED"); // 第一次保留
  });
});
