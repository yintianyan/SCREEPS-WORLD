/**
 * 期望违例的事件记账限流 —— 自我诊断通道不能反过来把观测系统打穿。
 * 立案依据（线上实测）：一段约 430 tick 跨度的事件环里装了 394 条 ExpectationViolation，
 * CreepDeath / WarOutcome / ProspectOutcome 全被挤出环外；而违例本身是「持续状态」
 * （一条卡住的孵化请求会连续成千上万 tick 都在 violations 里）。
 */
import { describe, expect, it } from "vitest";
import {
  EXPECTATION_EVENT_HEARTBEAT_TICKS,
  shouldRecordExpectationEvent,
} from "../../../src/kernel/expectations";

const E3 = "spawnQueueStale:W37S58";
const E2 = "p3Starved:layout-planner";

describe("expectations — 违例事件限流", () => {
  it("首次检出必报（没有历史记账就敲铃）", () => {
    expect(shouldRecordExpectationEvent(undefined, E3, 1000)).toBe(true);
  });

  it("同一组违例在心跳间隔内不重报 —— 洪水就是被这一条挡住的", () => {
    const prev = { signature: E3, tick: 1000 };
    expect(shouldRecordExpectationEvent(prev, E3, 1001)).toBe(false);
    expect(
      shouldRecordExpectationEvent(prev, E3, 1000 + EXPECTATION_EVENT_HEARTBEAT_TICKS - 1),
    ).toBe(false);
  });

  it("同一组违例到心跳间隔即重报（证明它还活着，而不是已自愈）", () => {
    const prev = { signature: E3, tick: 1000 };
    expect(shouldRecordExpectationEvent(prev, E3, 1000 + EXPECTATION_EVENT_HEARTBEAT_TICKS)).toBe(
      true,
    );
  });

  it("违例组合变化立刻重报 —— 换凶手的那一拍必须可见", () => {
    const prev = { signature: E3, tick: 1000 };
    expect(shouldRecordExpectationEvent(prev, E2, 1001)).toBe(true);
    expect(shouldRecordExpectationEvent(prev, `${E2},${E3}`, 1001)).toBe(true);
  });

  it("签名与顺序无关（多条违例不会因遍历顺序抖动成「变化」而绕过限流）", () => {
    const a = [E2, E3].sort().join(",");
    const b = [E3, E2].sort().join(",");
    const prev = { signature: a, tick: 1000 };
    expect(b).toBe(a);
    expect(shouldRecordExpectationEvent(prev, b, 1001)).toBe(false);
  });
});
