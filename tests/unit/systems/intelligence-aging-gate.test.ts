/**
 * 老化批到期门（#115）的纯算术回归测试。
 *
 * 立案理由（线上实测）：原先是单拍相位门 `(tick - PARENT_PHASE) % 100 === 0`，
 * 而本系统每 10 拍才跑一次 —— 到期那一拍若被调度器跳过（CPU 紧张时 kernel 跳过低优先级系统），
 * 整批老化就延后一整个 10 拍；实测本窗 3 次延后、最长 +400 拍。
 * 这里只钉"到点必跑、延后上界 = 系统自身 interval"这条算术：
 * 老化块本体要吃 Memory/RawMemory 段与 Game，手拼假引擎夹具测到的是夹具而不是行为。
 */
import { describe, expect, it } from "vitest";
import { agingDue } from "../../../src/systems/intelligence";

const AGING = 100;
const SYS_INTERVAL = 10; // intelligence 系统自身的 interval

describe("agingDue — #115 老化批到期门", () => {
  it("从未跑过（boot / 换码后）第一拍就跑", () => {
    expect(agingDue(1_000, undefined)).toBe(true);
  });

  it("刚好满周期即到期，差一拍不到期", () => {
    expect(agingDue(1_000 + AGING - 1, 1_000)).toBe(false);
    expect(agingDue(1_000 + AGING, 1_000)).toBe(true);
  });

  it("同一拍不会二次触发（时间戳先行落盘的后果）", () => {
    const t = 1_000 + AGING;
    expect(agingDue(t, 1_000)).toBe(true);
    expect(agingDue(t, t)).toBe(false); // 调用方把 lastAgingTick 前移到 t
  });

  it("★延后上界就是系统自身的 interval —— 到期拍被跳过后，下一个可用拍必跑", () => {
    const last = 1_000;
    for (let t = last + SYS_INTERVAL; t < last + AGING; t += SYS_INTERVAL) {
      expect(agingDue(t, last)).toBe(false); // 正确的节流：没到 100 拍不开
    }
    const due = last + AGING; // 1100 这一拍被调度器跳过（系统没跑）
    const next = due + SYS_INTERVAL; // 1110 是下一个可用拍
    expect(agingDue(next, last)).toBe(true);
    expect(next - last).toBe(AGING + SYS_INTERVAL); // 延后量有上界，不是随机漂
  });

  it("旧形状在同一组拍下不开门（这条记录的是为什么要换）", () => {
    // 系统运行拍 ≡ phase (mod 10)，旧门 (tick-phase)%100===0 只在"到期那拍恰好被调度"时开。
    // 到期拍 1100 被跳过 ⇒ 下一个可用拍 1110：旧门这一拍不开（还要再等 90 拍），新门当拍即补。
    // phase 取 0 不失一般性（判定只看相对差）。
    const phase = 0;
    const last = 1_000;
    const next = last + AGING + SYS_INTERVAL;
    expect((next - phase) % AGING).toBe(SYS_INTERVAL); // 旧门：这一拍不开
    expect(agingDue(next, last)).toBe(true); // 新门：这一拍就补
  });
});
