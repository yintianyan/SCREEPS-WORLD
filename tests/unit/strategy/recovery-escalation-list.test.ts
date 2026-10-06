/**
 * 升级清单（escalation）的纯函数行为。
 *
 * 钉的是三件事，全都是"别把观测通道自己打穿"这一族：
 *  ① 同一案例（房×域×动作类型）只占一条 ⇒ 慢性失败不会逐拍把清单撑爆；
 *  ② 事件只在"新案例 / 跨过心跳窗 / 终态变化"时发 ⇒ 不把事件环刷满
 *     （期望自检违例曾把 430 拍的环塞进 394 条，挤掉了真正的复盘事件）；
 *  ③ 条数有上限且淘汰最旧的 ⇒ Memory 有界。
 */
import { describe, it, expect } from "vitest";
import {
  upsertEscalation,
  ESCALATIONS_CAP,
  ESCALATION_EVENT_HEARTBEAT_TICKS,
  type EscalationEntry,
} from "../../../src/domain/strategy/recovery-lifecycle";

const base = {
  room: "W1N1",
  domain: "development",
  actionType: "development_resume",
  attempts: 2,
  terminal: true,
};

describe("upsertEscalation", () => {
  it("空清单 + 首个案例 → 新建并发事件", () => {
    const r = upsertEscalation(undefined, { ...base, tick: 1000 });
    expect(r.list).toHaveLength(1);
    expect(r.list[0]).toMatchObject({
      room: "W1N1",
      firstAt: 1000,
      lastAt: 1000,
      repeats: 1,
      terminal: true,
    });
    expect(r.shouldEmit).toBe(true);
  });

  it("同一案例心跳内重复 → 只更新这一条，且不重发事件", () => {
    const first = upsertEscalation(undefined, { ...base, tick: 1000 });
    const second = upsertEscalation(first.list, { ...base, tick: 1000 + 100 });
    expect(second.list).toHaveLength(1);
    expect(second.list[0]).toMatchObject({ repeats: 2, firstAt: 1000, lastAt: 1100 });
    expect(second.shouldEmit).toBe(false);
  });

  it("同一案例跨过心跳窗 → 再发一次（证明它活着，而不是逐拍发）", () => {
    const first = upsertEscalation(undefined, { ...base, tick: 1000 });
    const later = upsertEscalation(first.list, {
      ...base,
      tick: 1000 + ESCALATION_EVENT_HEARTBEAT_TICKS,
    });
    expect(later.list).toHaveLength(1);
    expect(later.shouldEmit).toBe(true);
  });

  it("同一案例终态翻转 → 立刻值得再报一次（first→terminal 是信息量最大的一刻）", () => {
    const retryable = upsertEscalation(undefined, {
      ...base,
      terminal: false,
      tick: 1000,
    });
    const flipped = upsertEscalation(retryable.list, { ...base, terminal: true, tick: 1010 });
    expect(flipped.shouldEmit).toBe(true);
    expect(flipped.list[0]!.terminal).toBe(true);
  });

  it("不同房/不同域各占一条；超过上限时淘汰最旧的", () => {
    let list: EscalationEntry[] | undefined;
    for (let i = 0; i < ESCALATIONS_CAP + 3; i++) {
      const r = upsertEscalation(list, { ...base, room: `R${i}`, tick: 2000 + i });
      list = r.list;
    }
    expect(list).toHaveLength(ESCALATIONS_CAP);
    // 最新那条（R14）在首位；最旧的 R0 已被挤出。
    expect(list![0]!.room).toBe(`R${ESCALATIONS_CAP + 2}`);
    expect(list!.some(e => e.room === "R0")).toBe(false);
  });

  it("不修改入参清单（调用方负责写回 Memory）", () => {
    const original = upsertEscalation(undefined, { ...base, tick: 1000 });
    const snapshot = JSON.stringify(original.list);
    upsertEscalation(original.list, { ...base, tick: 1200, attempts: 9 });
    expect(JSON.stringify(original.list)).toBe(snapshot);
  });

  it("#139 回归：更新非队首条目时，repeats 必须是「那一条」的，不是 list[0] 的", () => {
    // 建 A（W1N1/development）→ 建 B（W9N9/mineral）。新条目 unshift ⇒ B 成队首，A 退到队尾，
    // 而"更新"是原地不移位的 —— 于是此后每次升级 A，`list[0]` 都是无关的 B。
    let r = upsertEscalation(undefined, { ...base, tick: 1000 });
    r = upsertEscalation(r.list, {
      ...base,
      room: "W9N9",
      domain: "mineral",
      actionType: "terminal_trade",
      tick: 1100,
    });
    expect(r.list[0]?.room).toBe("W9N9");

    // 反复升级 A 三次 ⇒ A 的 repeats = 1（首建）+ 3 = 4；B 始终 1。
    // 间隔取心跳常数（不从外面猜数——上一版我写死 100 拍，正好落在心跳窗内，
    // 于是 shouldEmit 断言红的是"我猜的间隔"，不是被测机制）。
    const step = ESCALATION_EVENT_HEARTBEAT_TICKS;
    for (const tick of [1000 + step, 1000 + 2 * step, 1000 + 3 * step]) {
      r = upsertEscalation(r.list, { ...base, tick });
    }
    const a = r.list.find(e => e.room === "W1N1");
    expect(a?.repeats).toBe(4);
    expect(r.list[0]?.repeats).toBe(1); // 队首是 B —— 修复前事件第三列报的就是这个 1
    expect(r.repeats).toBe(4); // 必须是本次被升级那条
    expect(r.shouldEmit).toBe(true); // 跨过心跳窗 ⇒ 仍应发事件（这条不该被 repeats 修复弄坏）
  });
});
