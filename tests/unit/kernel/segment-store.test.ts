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

  it("同批别的段已送达 → 本段确认为空，可写入（新档写得出第一段）", () => {
    requestSegments(); // tick 100
    mockState.time = 101;
    // 服务端一次性交付全部激活段：只要有一段有内容，激活就确实发生了。
    mockState.segments[SEGMENT_LAYOUT] = makeCpuRaw(90);

    const seg = readCpuSegment();
    ringPush(seg.cpu, makeSample(101));
    markCpuDirty();
    flushSegments();

    expect(mockState.segments[SEGMENT_CPU]).toBeDefined();
    const written = JSON.parse(mockState.segments[SEGMENT_CPU]!);
    expect(ringToArray(written.cpu)).toHaveLength(1);
  });

  it("一个段都没送达：宽限期内不得写入，超期后放行（否则新档永久写不出段）", () => {
    requestSegments(); // tick 100
    for (const t of [101, 102, 103, 104]) {
      mockState.time = t;
      const seg = readCpuSegment();
      ringPush(seg.cpu, makeSample(t));
      markCpuDirty();
      flushSegments();
      // 状态未知 → 保守：不覆盖尚未送达的历史。
      expect(mockState.segments[SEGMENT_CPU]).toBeUndefined();
    }

    mockState.time = 110; // 超出 ACTIVATION_GRACE_TICKS
    const seg = readCpuSegment();
    ringPush(seg.cpu, makeSample(110));
    markCpuDirty();
    flushSegments();
    expect(mockState.segments[SEGMENT_CPU]).toBeDefined();
  });

  it("setActiveSegments 抛错：不得永久放弃重试，且期间一律不覆盖历史", () => {
    const rm = (globalThis as unknown as { RawMemory: { setActiveSegments: () => void } })
      .RawMemory;
    rm.setActiveSegments = () => {
      throw new Error("simulated activation failure");
    };

    expect(() => requestSegments()).not.toThrow();
    readCpuSegment();
    markCpuDirty();
    flushSegments();
    expect(mockState.segments[SEGMENT_CPU]).toBeUndefined();

    // 下一 tick 请求恢复：若首帧就把 requested 置了位，这里永远不会再激活。
    rm.setActiveSegments = () => undefined;
    mockState.time = 101;
    requestSegments();
    mockState.segments[SEGMENT_LAYOUT] = makeCpuRaw(90); // 送达信号
    const seg = readCpuSegment();
    ringPush(seg.cpu, makeSample(101));
    markCpuDirty();
    flushSegments();
    expect(mockState.segments[SEGMENT_CPU]).toBeDefined();
  });

  it("未调用 requestSegments 时状态未知 — 保守，不写（旧行为会直接覆盖历史）", () => {
    // 不调用 requestSegments：既没请求过、也没观察到送达。
    const seg = readCpuSegment();
    ringPush(seg.cpu, makeSample(100));
    markCpuDirty();
    flushSegments();

    expect(mockState.segments[SEGMENT_CPU]).toBeUndefined();
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
});
