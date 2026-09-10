/** 方向 3：保底可观测性层测试。
 * 验证在 recovery tier 下 kernel 仍能直接采样关键指标，
 * 以及 P3 长期冻结告警的正确行为。 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { sampleBaselineMetrics, trackP3Frozen } from "../../../src/kernel/kernel";
import { globalCache } from "../../../src/kernel/global-cache";
import { EventKind, drainEventBuffer } from "../../../src/kernel/event-log";

const mockGame = {
  time: 0,
  cpu: { getUsed: () => 5, bucket: 0, limit: 20, tickLimit: 20 },
  creeps: {} as Record<string, unknown>,
  rooms: {} as Record<string, unknown>,
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { Game: { ...mockGame } });
  (globalThis as Record<string, unknown>).Memory = { kernel: {} };
  // Clear event buffer
  (globalThis as Record<string, unknown>).eventBuffer = { events: [] };
});

describe("sampleBaselineMetrics — 保底可观测性采样", () => {
  it("非 10 倍数 tick 不采样", () => {
    Game.time = 7;
    sampleBaselineMetrics(7, { tier: "recovery" } as any);
    const stats = (globalThis as any).Memory?.kernel?.stats;
    expect(stats).toBeUndefined();
  });

  it("10 倍数 tick 写入关键指标", () => {
    Game.time = 100;
    Game.cpu.bucket = 2500;
    (Game as any).creeps = { c1: {}, c2: {}, c3: {} };
    (Game as any).rooms = { W1N1: {}, W2N1: {} };

    sampleBaselineMetrics(100, { tier: "recovery" } as any);

    const stats = (globalThis as any).Memory.kernel.stats;
    expect(stats.baselineBucket).toBe(2500);
    expect(stats.baselineTier).toBe("recovery");
    expect(stats.baselineCreepCount).toBe(3);
    expect(stats.baselineRoomCount).toBe(2);
    expect(stats.baselineLastSample).toBe(100);
  });

  it("stats 不存在时自动初始化", () => {
    Game.time = 10;
    Game.cpu.bucket = 500;
    (Game as any).creeps = {};
    (Game as any).rooms = {};

    sampleBaselineMetrics(10, { tier: "recovery" } as any);

    const stats = (globalThis as any).Memory.kernel.stats;
    expect(stats).toBeDefined();
    expect(stats.lastSample).toBe(0);
    expect(stats.cpuAvg10).toBe(0);
    expect(stats.baselineBucket).toBe(500);
    expect(stats.baselineCreepCount).toBe(0);
  });

  it("kernel 不存在时不崩溃", () => {
    (globalThis as any).Memory = {};
    Game.time = 10;
    // 不应抛出
    sampleBaselineMetrics(10, { tier: "recovery" } as any);
    expect((globalThis as any).Memory.kernel).toBeUndefined();
  });

  it("连续多次采样：值覆盖为最新", () => {
    Game.time = 10;
    Game.cpu.bucket = 1000;
    (Game as any).creeps = { c1: {} };
    (Game as any).rooms = { W1N1: {} };
    sampleBaselineMetrics(10, { tier: "recovery" } as any);

    Game.time = 20;
    Game.cpu.bucket = 2000;
    (Game as any).creeps = { c1: {}, c2: {} };
    sampleBaselineMetrics(20, { tier: "conserve" } as any);

    const stats = (globalThis as any).Memory.kernel.stats;
    expect(stats.baselineBucket).toBe(2000);
    expect(stats.baselineTier).toBe("conserve");
    expect(stats.baselineCreepCount).toBe(2);
    expect(stats.baselineLastSample).toBe(20);
  });
});

describe("trackP3Frozen — P3 长期冻结跟踪", () => {
  it("bucket < conserve 最低值时设置 p3FrozenSince", () => {
    const mem: { p3FrozenSince?: number } = {};
    trackP3Frozen(1000, 500, mem);
    expect(mem.p3FrozenSince).toBe(1000);
  });

  it("首次冻结记录事件", () => {
    const mem: { p3FrozenSince?: number } = {};
    trackP3Frozen(1000, 500, mem);
    const events = drainEventBuffer();
    expect(events).toHaveLength(1);
    expect(events[0]!.k).toBe(EventKind.P3StarvationFrozen);
  });

  it("bucket >= conserve 最低值时清除 p3FrozenSince", () => {
    const mem: { p3FrozenSince?: number } = { p3FrozenSince: 500 };
    trackP3Frozen(600, 1500, mem);
    expect(mem.p3FrozenSince).toBeUndefined();
  });

  it("冻结持续 500 tick 时输出升级告警", () => {
    const mem: { p3FrozenSince?: number } = {};
    // 首次冻结（bucket < conserve.min = 1000）
    trackP3Frozen(1000, 500, mem);
    // 清空首次事件
    drainEventBuffer();
    // 500 tick 后
    trackP3Frozen(1500, 500, mem);
    const events = drainEventBuffer();
    expect(events).toHaveLength(1);
    expect(events[0]!.k).toBe(EventKind.P3StarvationFrozen);
    expect(events[0]!.d).toContain(500);
  });

  it("冻结持续 1000 tick 时再次输出告警", () => {
    const mem: { p3FrozenSince?: number } = {};
    trackP3Frozen(1000, 500, mem);
    drainEventBuffer();
    trackP3Frozen(1500, 500, mem);
    drainEventBuffer();
    trackP3Frozen(2000, 500, mem);
    const events = drainEventBuffer();
    expect(events).toHaveLength(1);
    expect(events[0]!.d).toContain(1000);
  });

  it("冻结非 500 倍数 tick 不输出升级告警", () => {
    const mem: { p3FrozenSince?: number } = {};
    trackP3Frozen(1000, 500, mem);
    drainEventBuffer();
    // 100 tick 后（非 500 倍数）
    trackP3Frozen(1100, 500, mem);
    const events = drainEventBuffer();
    expect(events).toHaveLength(0);
  });

  it("从冻结恢复后再次冻结重新计时", () => {
    const mem: { p3FrozenSince?: number } = {};
    // 首次冻结（bucket < conserve.min）
    trackP3Frozen(1000, 500, mem);
    expect(mem.p3FrozenSince).toBe(1000);
    // 恢复（bucket >= conserve.min）
    trackP3Frozen(1200, 1500, mem);
    expect(mem.p3FrozenSince).toBeUndefined();
    // 再次冻结
    trackP3Frozen(1500, 800, mem);
    expect(mem.p3FrozenSince).toBe(1500);
  });
});
