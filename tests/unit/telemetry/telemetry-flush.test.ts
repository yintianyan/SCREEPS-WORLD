import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock globalCache ──────────────────────────────────────
const mockGlobal: Record<string, unknown> = {};

vi.mock("../../../src/kernel/global-cache", () => ({
  globalCache: () => mockGlobal,
}));

// ── Mock segment-store 的 Prometheus 写入（避免真实 segment I/O）────
let writePrometheusSegmentMock = vi.fn();
vi.mock("../../../src/kernel/segment-store", () => ({
  writePrometheusSegment: (...args: unknown[]) => writePrometheusSegmentMock(...args),
}));

// ── Mock log ──────────────────────────────────────────────
const infoMock = vi.fn();
const errorMock = vi.fn();
vi.mock("../../../src/kernel/log", () => ({
  log: { info: (...a: unknown[]) => infoMock(...a), error: (...a: unknown[]) => errorMock(...a) },
}));

// ── Mock Game ─────────────────────────────────────────────
let mockCpuUsed = 0.5;
let mockCpuLimit = 20;
let mockGameTime = 1000;

vi.stubGlobal("Game", {
  time: 1000,
  cpu: {
    getUsed: () => mockCpuUsed,
    limit: mockCpuLimit,
  },
});

// ── Import after mocks ────────────────────────────────────
import { runFlush, initTelemetryFlush } from "../../../src/telemetry/TelemetryFlush";
import { registerGauge, setGauge } from "../../../src/telemetry/MetricRegistry";

beforeEach(() => {
  for (const key of Object.keys(mockGlobal)) delete mockGlobal[key];
  writePrometheusSegmentMock = vi.fn();
  infoMock.mockClear();
  errorMock.mockClear();
  mockCpuUsed = 0.5;
  mockCpuLimit = 20;
  mockGameTime = 1000;
  (Game as any).time = mockGameTime;
  (Game as any).cpu.getUsed = () => mockCpuUsed;
  (Game as any).cpu.limit = mockCpuLimit;
  initTelemetryFlush();
});

describe("TelemetryFlush — runFlush 成功路径", () => {
  it("flushed=true 时收集指标并写 segment", () => {
    registerGauge("runtime", "cpu_used", "CPU used", [], "");
    setGauge("screeps_runtime_cpu_used", 0.72);

    // Game.time 距 lastFlushTick(=0) ≥ 10 → shouldFlush()=true
    (Game as any).time = 1000;
    mockCpuUsed = 0.5; // 远低于 95% limit

    const result = runFlush("healthy");

    expect(result.skipped).toBe(false);
    expect(result.flushed).toBe(true);
    expect(result.metricCount).toBeGreaterThan(0);
    // 成功路径必须写出 Prometheus segment
    expect(writePrometheusSegmentMock).toHaveBeenCalledTimes(1);
    expect(typeof writePrometheusSegmentMock.mock.calls[0]![0]).toBe("string");
  });

  it("decision 计数随 package 上报", async () => {
    // 引入 DecisionRegistry 便于验证 decisionCount
    const decisionMod = await import("../../../src/telemetry/DecisionRegistry");
    decisionMod.recordDecision("empire", "EXPAND", "surplus", { target: "W9N3" });

    (Game as any).time = 1010;
    mockCpuUsed = 0.5;

    const result = runFlush("healthy");
    expect(result.flushed).toBe(true);
    expect(result.decisionCount).toBeGreaterThan(0);
  });

  it("not_due（距上次 flush < 10 tick）时跳过", () => {
    // initTelemetryFlush 设 lastFlushTick=0，取 Game.time=5 使 5-0 < 10
    (Game as any).time = 5;
    const result = runFlush("healthy");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("not_due");
    expect(writePrometheusSegmentMock).not.toHaveBeenCalled();
  });

  it("CPU 逼近上限（>95%）时跳过保命", () => {
    mockCpuUsed = 19.5; // limit=20, 19.5 > 19 (95%)
    (Game as any).time = 1000;
    const result = runFlush("healthy");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("cpu_near_limit");
    expect(writePrometheusSegmentMock).not.toHaveBeenCalled();
  });
});