/**
 * B1-3 回归：recovery 档的事件 flush 必须真的执行。
 *
 * 旧实现用裸 `tick % populationInterval`，而 kernel 把本系统错峰到
 * tick ≡ systemPhase(name, cpuSampleInterval) (mod cpuSampleInterval) —— 两个同余式
 * 没有交集时，"CPU 越危机、事件日志越空白"就是静默常态。
 * 这里同时钉住两个方向：该 flush 的运行 tick 必须 flush；不该 flush 的不能顺手全 flush。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";

const mocks = vi.hoisted(() => {
  const events: unknown[] = [];
  return {
    markEventLogDirty: vi.fn(),
    readEventLogSegment: vi.fn(() => ({ events: { d: events, h: 0, c: 8 } })),
    drainEventBuffer: vi.fn(() => [{ tick: 0, kind: 0, room: "W1N1", data: [] }]),
    ringPush: vi.fn(),
    ringToArray: vi.fn(() => []),
  };
});

vi.mock("../../../src/kernel/global-cache", () => {
  const g: Record<string, unknown> = {};
  return { globalCache: () => g };
});

vi.mock("../../../src/kernel/segment-store", () => ({
  readCpuSegment: () => ({ cpu: { d: [], h: 0, c: 8 }, population: null }),
  readEconomySegment: () => ({ economy: { d: [], h: 0, c: 8 } }),
  readEventLogSegment: mocks.readEventLogSegment,
  markCpuDirty: vi.fn(),
  markEconomyDirty: vi.fn(),
  markEventLogDirty: mocks.markEventLogDirty,
}));

vi.mock("../../../src/kernel/timeseries", () => ({
  sampleCpu: vi.fn(),
  sampleEconomy: vi.fn(),
}));

vi.mock("../../../src/kernel/event-log", () => ({
  drainEventBuffer: mocks.drainEventBuffer,
  EventKind: { PhaseTransition: 0, TierDowngrade: 1, TierUpgrade: 2 },
}));

vi.mock("../../../src/kernel/ring-buffer", () => ({
  ringPush: mocks.ringPush,
  ringToArray: mocks.ringToArray,
}));

vi.mock("../../../src/kernel/safe-run", () => ({
  getActionCpuSnapshot: () => new Map(),
}));

vi.mock("../../../src/config", () => ({
  CONFIG: {
    telemetry: { cpuSampleInterval: 10, economySampleInterval: 50, populationInterval: 100 },
    debug: { actionProfiling: false },
  },
}));

const { telemetryCollectorSystem } = await import("../../../src/systems/telemetry-collector");
const { systemPhase } = await import("../../../src/kernel/phase");

const SAMPLE_INTERVAL = 10;
const FLUSH_INTERVAL = 100;

function makeCtx(tier: CpuTier, tick: number): TickContext {
  return {
    tick,
    budget: {
      tier,
      softLimit: 5,
      hardLimit: 10,
      bucket: 100,
      canStart: () => true,
      isExhausted: () => false,
    },
  } as unknown as TickContext;
}

/** 本系统真正会被 kernel 调用的 tick 序列（tick ≡ phase mod cpuSampleInterval）。 */
function runTicks(phase: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => phase + i * SAMPLE_INTERVAL);
}

describe("telemetry-collector — recovery 档事件 flush 的相位", () => {
  const phase = systemPhase("telemetry-collector", SAMPLE_INTERVAL);

  beforeEach(() => {
    mocks.markEventLogDirty.mockClear();
    mocks.drainEventBuffer.mockClear();
  });

  it("kernel 错峰到的运行 tick 上必须 flush 事件缓冲", () => {
    // 前置条件：这条 tick 在旧的裸取模规则下不会触发。不满足就说明本用例是空判。
    const flushTick = phase + FLUSH_INTERVAL;
    expect(flushTick % SAMPLE_INTERVAL).toBe(phase % SAMPLE_INTERVAL);
    expect(flushTick % FLUSH_INTERVAL).not.toBe(0);

    telemetryCollectorSystem.run(makeCtx("recovery", flushTick));

    expect(mocks.drainEventBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.markEventLogDirty).toHaveBeenCalledTimes(1);
  });

  it("同一 tick 窗内的其它运行 tick 不得顺手 flush（防「永远在 flush」式假修）", () => {
    for (const tick of runTicks(phase, 20)) {
      if ((tick - phase) % FLUSH_INTERVAL === 0) continue; // 跳过本就该 flush 的那些
      telemetryCollectorSystem.run(makeCtx("recovery", tick));
    }
    expect(mocks.markEventLogDirty).not.toHaveBeenCalled();
  });

  it("2000 tick 的 recovery 期内 flush 次数与周期一致（不是一次也不是一次不停）", () => {
    let expected = 0;
    for (let tick = 0; tick < 2000; tick++) {
      if ((tick - phase) % SAMPLE_INTERVAL !== 0) continue; // kernel 不会在该 tick 调用本系统
      const shouldFlush = (tick - phase) % FLUSH_INTERVAL === 0;
      if (shouldFlush) expected++;
      telemetryCollectorSystem.run(makeCtx("recovery", tick));
    }
    expect(expected).toBe(20);
    expect(mocks.markEventLogDirty).toHaveBeenCalledTimes(expected);
  });
});
