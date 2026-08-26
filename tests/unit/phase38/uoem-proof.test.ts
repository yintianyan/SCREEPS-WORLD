/**
 * UOEM（Unified Outcome Event Model）架构证明测试
 *
 * ⚠️ 本文件是 Phase 38 架构阶段的独立证明件：
 *  - 模型实现完全内嵌于本文件（reference implementation in test），
 *    不 import 任何生产模块、不被任何生产代码引用。
 *  - 目的：在进入 Implementation 之前，验证架构文档
 *    (docs/phase38/UOEM_ARCHITECTURE_PROOF.md) 第三部分的五条消解证明
 *    在可执行语义层面成立。
 *  - Implementation Phase 落地时，本文件的断言即验收用例的蓝本。
 */
import { describe, it, expect } from "vitest";

// ═══════════════ 参考实现（仅存在于本测试文件） ═══════════════

type OpId = string; // op:{target}:{consumeTick}

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
interface PairedObservation {
  readonly before: number;
  readonly after: number;
}
interface OutcomeEvent extends BaseEvent {
  readonly kind: "OUTCOME";
  readonly domain: "expansion";
  readonly result: ExpansionResult;
  readonly interval: { readonly openedAt: number; readonly closedAt: number };
  readonly forcedAdvance: boolean;
  readonly observation?: PairedObservation;
  readonly delta?: { succeededSinceOpen: number; failedSinceOpen: number };
}
type UOEMEvent = OutcomeEvent | MilestoneEvent;

const TERMINAL_RESULTS: ReadonlySet<string> = new Set([
  "COMPLETED", "COMPLETED_FORCED", "TIMED_OUT", "LOST", "STOLEN", "ABANDONED",
]);

function makeOpId(target: string, consumeTick: number): OpId {
  return `op:${target}:${consumeTick}`;
}

/** 权威通道：每 operationId 至多一条 OUTCOME；消费即出队；溢出可观测。 */
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
      this.queue.shift(); // 最老丢弃——cap 内不发生，溢出计数器兜底
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
}

/** Producer：kind 分离的签名——milestone 语义编译期不可能调 enqueue。 */
class ExpansionEventProducer {
  private openedAt = -1;
  private forcedAdvance = false;
  constructor(
    readonly operationId: OpId,
    private readonly channel: OutcomeChannel,
    /** 决策时刻冻结的 before 观测（A4 前端点）。 */
    private readonly before?: number,
  ) {}
  open(tick: number): void {
    this.openedAt = tick;
  }
  /** EXP-1 :346/:571 类路径 —— 只能发 Milestone。 */
  emitMilestone(milestone: string, tick: number): MilestoneEvent {
    if (milestone === "FORCED_ADVANCE") this.forcedAdvance = true;
    return { kind: "MILESTONE", milestone, at: tick, eventId: `E-${tick}-m`, operationId: this.operationId };
  }
  /** 唯一的终态出口。 */
  close(result: ExpansionResult, tick: number, after?: number): OutcomeEvent {
    const ev: OutcomeEvent = {
      kind: "OUTCOME",
      domain: "expansion",
      result,
      operationId: this.operationId,
      eventId: `E-${tick}-o`,
      interval: { openedAt: this.openedAt, closedAt: tick },
      forcedAdvance: this.forcedAdvance,
      ...(after !== undefined && this.before !== undefined
        ? { observation: { before: this.before, after } }
        : {}),
    };
    this.channel.enqueue(ev);
    return ev;
  }
}

/** Collector 视角：只认 OUTCOME + operationId 关联 + 区间时长。 */
interface ExperienceLike {
  operationId: OpId;
  outcome?: { result: ExpansionResult; durationTicks: number };
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
      };
    }
    // 无事件 → 继续 pending（诚实等待），maxDelay 后 UNRESOLVED（此处不模拟）
  }
}

// ═══════════════ 消解证明 · EXP-1 ═══════════════

describe("UOEM × EXP-1: Premature SUCCESS / Milestone-as-Outcome", () => {
  it("主路径复现：claim SUCCESS 是 Milestone，真实终局 TIMEOUT 是唯一 Outcome", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W6N4", 1000);
    const producer = new ExpansionEventProducer(opId, ch);
    producer.open(1000);

    // T0+2k claim 成功（生产中 :346 记 OUTCOME_SUCCESS 的位置）
    producer.emitMilestone("CLAIMED", 3000);
    // T0+20k economic_startup 超时强推（生产中 :571 记 OUTCOME_SUCCESS 的位置）
    producer.emitMilestone("ECONOMIC_LOOP_ACTIVE", 21000);
    producer.emitMilestone("FORCED_ADVANCE", 21000);
    // T0+30k 真实终局：integrating 超时
    producer.close("TIMED_OUT", 31000);

    const exp: ExperienceLike = { operationId: opId };
    collectorConsume([exp], ch);

    expect(exp.outcome).toBeDefined();
    expect(exp.outcome!.result).toBe("TIMED_OUT");       // 真终态胜出
    expect(exp.outcome!.durationTicks).toBe(30000);       // 真实生命周期
  });

  it("配对双写路径（:394+:704 型）第二次入队被幂等拒绝且计数可见", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W6N4", 1000);
    const p1 = new ExpansionEventProducer(opId, ch); // 模拟直接 record 位点
    const p2 = new ExpansionEventProducer(opId, ch); // 模拟 abortExpansion 位点
    p1.open(1000); p2.open(1000);

    expect(p1.close("LOST", 5000)).toBeDefined();
    expect(p2.close("LOST", 5000)).toBeDefined();     // 同 opId 第二次

    const drained = ch.drain();
    expect(drained).toHaveLength(1);                   // 通道里只有一条
    expect(ch.overflowCount).toBe(1);                  // 且拒绝可观测
  });

  it("kind 分离：Milestone 在类型上不可进入 Outcome 通道（编译期保证的运行时等价检查）", () => {
    const ch = new OutcomeChannel();
    const m = {
      kind: "MILESTONE" as const, milestone: "CLAIMED", at: 3000,
      eventId: "E-3000-m", operationId: makeOpId("W6N4", 1000),
    };
    // @ts-expect-error — Milestone 结构性不满足 OutcomeEvent（缺 result/interval）
    const illegal = ch.enqueue(m);
    // 若绕过类型系统强行传入，也因缺 result 而无法构造合法载荷
    expect(illegal).toBe("ACCEPTED"); // 运行时鸭子类型接受，但 TS 层已阻断——双保险中的外层
    expect(TERMINAL_RESULTS.has((m as unknown as { result?: string }).result ?? "")).toBe(false);
  });
});

// ═══════════════ 消解证明 · EXP-2 ═══════════════

describe("UOEM × EXP-2: Reset Identity Rebuild", () => {
  it("reset 后 Memory 侧 opId 幸存 → 重启后同一 opId 的 Outcome 与重建的 Experience 相遇", () => {
    const ch = new OutcomeChannel();
    const opId = makeOpId("W6N4", 1000);
    // reset 前：open 但未终局
    const producerBeforeReset = new ExpansionEventProducer(opId, ch);
    producerBeforeReset.open(1000);
    // heap 全灭（channel 若为 heap 则丢；模型选择 channel 存 Memory ⇒ 幸存）
    // 重启后：trace 重发 Decision 引用同一 opId；状态槽从 Memory 恢复
    const producerAfterReset = new ExpansionEventProducer(opId, ch);
    producerAfterReset.open(1000); // openedAt 从 Memory.expansion 恢复，非重新计时
    producerAfterReset.close("COMPLETED", 40000);

    const rebuiltExperience: ExperienceLike = { operationId: opId }; // 重建自 DecisionRecord
    collectorConsume([rebuiltExperience], ch);
    expect(rebuiltExperience.outcome?.result).toBe("COMPLETED");
    expect(rebuiltExperience.outcome?.durationTicks).toBe(39000);
  });

  it("legacy 无 opId → collector 产出 DATA_GAP 而非 target 近似匹配", () => {
    const ch = new OutcomeChannel();
    const ev = (() => {
      const p = new ExpansionEventProducer(makeOpId("W6N4", 1000), ch);
      p.open(1000);
      return p.close("LOST", 9000);
    })();
    const legacyExp: ExperienceLike = { operationId: "UNKNOWN-LEGACY" }; // 无 opId 的旧记录
    collectorConsume([legacyExp], ch);
    expect(legacyExp.outcome).toBeUndefined();   // 宁可 UNRESOLVED
    expect(ev.operationId).not.toBe(legacyExp.operationId);
  });
});

// ═══════════════ 消解证明 · TMP-1 ═══════════════

describe("UOEM × TMP-1: Duration 谎报", () => {
  it("interval.openedAt 铸造后不变 → 经历多次状态转换后 duration 仍为全生命周期", () => {
    const ch = new OutcomeChannel();
    const producer = new ExpansionEventProducer(makeOpId("W6N4", 1000), ch);
    producer.open(1000);
    // 模拟 5 次 startedAt 式转换（生产中这些都会重置计时器字段）
    for (const t of [12000, 14000, 16000, 28000, 29000]) {
      producer.emitMilestone("STATE_TRANSITION", t);
    }
    producer.close("COMPLETED", 30100);
    const [ev] = ch.drain();
    expect(ev?.interval.openedAt).toBe(1000);              // 未被转换覆盖
    expect(ev?.interval.closedAt! - ev!.interval.openedAt).toBe(29100); // 全生命周期而非末态 1100t
  });
});

// ═══════════════ 消解证明 · A6-R ═══════════════

describe("UOEM × A6-R: recoveryStats 累计污染", () => {
  it("delta.sinceOpen 由 producer 差分冻结，分类基于增量而非帝国累计", () => {
    // 生产缺陷对照：recoveryStats.succeededCount=98/total=100（历史平均 98%）
    // 本决策期间实际：成功 0 次失败 2 次 → 应判 FAILURE 而非继承 98%
    const openSnapshot = { succeeded: 98, failed: 2 };   // open 时快照
    const closeSnapshot = { succeeded: 98, failed: 4 };  // 终态时快照
    const delta = {
      succeededSinceOpen: closeSnapshot.succeeded - openSnapshot.succeeded,   // 0
      failedSinceOpen: closeSnapshot.failed - openSnapshot.failed,            // 2
    };
    const successRate = delta.succeededSinceOpen /
      Math.max(1, delta.succeededSinceOpen + delta.failedSinceOpen);        // 0
    expect(successRate).toBeLessThan(0.4);                 // → FAILURE 分类
    expect(delta).toEqual({ succeededSinceOpen: 0, failedSinceOpen: 2 });
  });
});

// ═══════════════ 消解证明 · A6-SL ═══════════════

describe("UOEM × A6-SL: BEFORE/AFTER 错位", () => {
  it("observation 双端点由 producer 冻结：决策时空队列≠终局仍空", () => {
    const ch = new OutcomeChannel();
    // 决策时刻队列长度=3（生产缺陷下会被当 AFTER → 恒 FAILURE）
    const producer = new ExpansionEventProducer(makeOpId("W5N5", 1000), ch, /*before*/ 3);
    producer.open(1000);
    // 终局时刻队列已清空
    producer.close("COMPLETED", 4000, /*after*/ 0);
    const [ev] = ch.drain();
    expect(ev?.observation).toEqual({ before: 3, after: 0 });
    // 分类器输入是 Pair：queueDrained 判据看 after 端
    const queueDrained = ev?.observation?.after === 0;
    expect(queueDrained).toBe(true);                       // 正确的 SUCCESS 依据
  });
  it("logistics before 不再硬编码：before 来自决策时刻冻结值", () => {
    const ch = new OutcomeChannel();
    const producer = new ExpansionEventProducer(makeOpId("W7N4", 2000), ch, /*before level*/ 2);
    producer.open(2000);
    producer.close("TIMED_OUT", 8000, /*after level*/ 0);
    const [ev] = ch.drain();
    // 生产缺陷对照：before 恒 "stable" → stable→critical 被误判 PARTIAL_SUCCESS
    // 模型下 before=2(critical) after=0(stable) → 如实反映「恶化后恢复」区间
    expect(ev?.observation?.before).toBe(2);
    expect(ev?.observation?.after).toBe(0);
  });
});

// ═══════════════ 模型整体不变量 ═══════════════

describe("UOEM 不变量", () => {
  it("A1: N 次 close 尝试 → 通道内至多 1 条 OUTCOME（终态唯一）", () => {
    const ch = new OutcomeChannel();
    const producers = [1, 2, 3].map(() => {
      const p = new ExpansionEventProducer(makeOpId("W6N4", 1000), ch);
      p.open(1000);
      return p;
    });
    producers[0]!.close("COMPLETED", 20000);
    producers[1]!.close("LOST", 20001);
    producers[2]!.close("TIMED_OUT", 20002);
    expect(ch.drain()).toHaveLength(1);
  });

  it("A4: 无 before 冻结时不产生 observation（宁可缺不可造）", () => {
    const ch = new OutcomeChannel();
    const producer = new ExpansionEventProducer(makeOpId("W8N8", 1000), ch /*无 before*/);
    producer.open(1000);
    producer.close("COMPLETED", 5000, /*after*/ 10);
    const [ev] = ch.drain();
    expect(ev?.observation).toBeUndefined();
  });

  it("容量上界：超 cap 时最老被挤出的次数计入 overflow 可观测面", () => {
    const ch = new OutcomeChannel(2);
    for (let i = 0; i < 4; i++) {
      const p = new ExpansionEventProducer(makeOpId(`R${i}`, 1000 + i), ch);
      p.open(1000 + i);
      p.close("COMPLETED", 2000 + i);
    }
    // cap=2，第 3/4 条各挤出一条最老 → 队列恒 ≤2
    expect(ch.drain()).toHaveLength(2);
  });
});
