/** Segment Store 可用性守卫测试。 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  requestSegments,
  readCpuSegment,
  markCpuDirty,
  readLayoutSegment,
  getRoomLayoutData,
  markLayoutDirty,
  flushSegments,
  SEGMENT_CPU,
  SEGMENT_LAYOUT,
} from "../../../src/kernel/segment-store";
import { createRingBuffer, ringPush, ringToArray } from "../../../src/kernel/ring-buffer";
import type { CpuSample } from "../../../src/kernel/timeseries";

/** 可变 mock 状态：Game.time 与 RawMemory.segments。 */
const mockState = {
  time: 100,
  segments: {} as Record<number, string | undefined>,
};

function makeSample(t: number): CpuSample {
  return { t, cpu: 1, bk: 10000, ti: 0, sk: 0, er: 0 } as CpuSample;
}

/** 构造含 1 条历史样本的 CPU segment 原始数据。 */
function makeCpuRaw(sampleTick: number): string {
  const buf = createRingBuffer<CpuSample>(300);
  ringPush(buf, makeSample(sampleTick));
  return JSON.stringify({ cpu: buf });
}

beforeEach(() => {
  mockState.time = 100;
  mockState.segments = {};
  // 重置 segCache（挂在 globalThis 上）— 模拟 global reset。
  delete (globalThis as Record<string, unknown>).__segStore;
  Object.assign(globalThis, {
    Game: {
      get time() {
        return mockState.time;
      },
    },
    RawMemory: {
      segments: mockState.segments,
      setActiveSegments: () => undefined,
    },
  });
});

describe("segment-store — P1-2 可用性守卫", () => {
  it("reset 首 tick：segment 未加载时写入不 flush，历史不被空数据覆盖", () => {
    // 首 tick：requestSegments 与读写同 tick 发生，raw 为 undefined。
    requestSegments();
    const seg = readCpuSegment();
    ringPush(seg.cpu, makeSample(100));
    markCpuDirty();
    flushSegments();

    // 守卫生效：不写 RawMemory — 若写了，真实场景中会覆盖尚未加载的历史数据。
    expect(mockState.segments[SEGMENT_CPU]).toBeUndefined();
  });

  it("次 tick segment 加载后：历史数据完整读回并可追加", () => {
    // 首 tick 触发守卫。
    requestSegments();
    readCpuSegment();

    // 次 tick：segment 加载完成，历史数据可见。
    mockState.time = 101;
    mockState.segments[SEGMENT_CPU] = makeCpuRaw(90);

    const seg = readCpuSegment();
    const history = ringToArray(seg.cpu) as CpuSample[];
    expect(history).toHaveLength(1);
    expect(history[0]!.t).toBe(90);

    // 追加新样本并 flush — 历史 + 新样本都在。
    ringPush(seg.cpu, makeSample(101));
    markCpuDirty();
    flushSegments();
    const written = JSON.parse(mockState.segments[SEGMENT_CPU]!);
    expect(ringToArray(written.cpu)).toHaveLength(2);
  });

  it("全新服务器：次 tick 起 undefined 视为真空 segment，写入不被永久阻塞", () => {
    requestSegments(); // tick 100
    mockState.time = 101; // 次 tick，segment 已激活但从未写入（raw 仍 undefined）

    const seg = readCpuSegment();
    ringPush(seg.cpu, makeSample(101));
    markCpuDirty();
    flushSegments();

    // 守卫不再拦截 — 正常写入。
    expect(mockState.segments[SEGMENT_CPU]).toBeDefined();
    const written = JSON.parse(mockState.segments[SEGMENT_CPU]!);
    expect(ringToArray(written.cpu)).toHaveLength(1);
  });

  it("layout segment 同样受守卫保护：reset 首 tick 写入不覆盖", () => {
    requestSegments();
    const data = getRoomLayoutData("W1N1");
    data.overrides["core.ext.01"] = 1234;
    markLayoutDirty();
    flushSegments();

    expect(mockState.segments[SEGMENT_LAYOUT]).toBeUndefined();

    // 次 tick：历史 layout 数据完整读回。
    mockState.time = 101;
    mockState.segments[SEGMENT_LAYOUT] = JSON.stringify({
      W1N1: { overrides: { "core.ext.05": 42 }, blocked: {} },
    });
    const loaded = readLayoutSegment();
    expect(loaded.W1N1!.overrides["core.ext.05"]).toBe(42);
  });

  it("未调用 requestSegments 的环境守卫不生效（单测向后兼容）", () => {
    // 不调用 requestSegments — requestedAt 为 undefined。
    const seg = readCpuSegment();
    ringPush(seg.cpu, makeSample(100));
    markCpuDirty();
    flushSegments();

    // 旧行为：正常缓存 + 写入。
    expect(mockState.segments[SEGMENT_CPU]).toBeDefined();
  });
});
