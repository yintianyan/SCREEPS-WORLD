/**
 * 期望自检的两处「信号本身会骗人」的判据：
 * ① 违例事件必须限流 —— 否则自我诊断通道把定长事件环刷满，其它观测全被挤出；
 * ② E2 的计时基准必须与 heap 的 systemLastRun 同生命周期 —— 否则每次部署后所有 P3
 *    系统都被判饥饿，而这个假信号会真的去续期饥饿旁路。
 * 立案依据（线上实测）：一段约 430 tick 跨度的事件环里装了 389 条 ExpectationViolation；
 * 部署后 8 分钟内 `p3Starved:tuning-engine(age=never)` 持续违例，而它只是还没轮到第一次执行。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateExpectations,
  EXPECTATION_EVENT_HEARTBEAT_TICKS,
  P3_BOOT_GRACE_TICKS,
  shouldRecordExpectationEvent,
  type P3SystemRef,
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

describe("expectations — E2 P3 饥饿的计时基准（必须与 heap 的 systemLastRun 同生命周期）", () => {
  const p3Systems: P3SystemRef[] = [{ name: "tuning-engine", interval: 500 }];
  const TICK = 200000;

  function run(overrides: Partial<Parameters<typeof evaluateExpectations>[0]> = {}) {
    return evaluateExpectations({
      tick: TICK,
      statsLastSample: TICK,
      bootTick: 1000, // Memory 里的启动 tick：跨 global reset 存活，已经很旧
      systemLastRun: {}, // heap：部署/重置后是空的 —— 真实"从未跑过"与"表被清空"无法区分
      p3Systems,
      ...overrides,
    });
  }

  it("回归：本次进程刚启动（processBootTick 新）时不得因表空而判饥饿", () => {
    const res = run({ p3BootTick: TICK - P3_BOOT_GRACE_TICKS + 100 });
    expect(res.violations.map(v => v.id)).not.toContain("p3Starved:tuning-engine");
    expect(res.p3Starved).toBe(false);
  });

  it("同一份旧 bootTick 下，进程真的老了仍必须报饥饿（旁路不能被削弱成永不自检）", () => {
    const res = run({ p3BootTick: TICK - P3_BOOT_GRACE_TICKS - 10000 });
    expect(res.violations.map(v => v.id)).toContain("p3Starved:tuning-engine");
    expect(res.p3Starved).toBe(true);
  });

  it("系统确实跑过就不报（与基准无关的正常态）", () => {
    const res = run({
      p3BootTick: TICK - P3_BOOT_GRACE_TICKS - 10000,
      systemLastRun: { "tuning-engine": TICK - 10 },
    });
    expect(res.violations.map(v => v.id)).not.toContain("p3Starved:tuning-engine");
  });

  it("p3BootTick 缺失时回退到 Memory bootTick（旧调用方语义不变）", () => {
    const res = run();
    expect(res.violations.map(v => v.id)).toContain("p3Starved:tuning-engine");
  });
});
