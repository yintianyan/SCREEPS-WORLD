/**
 * 期望自检回归测试 —— P3 饥饿自锁事故（stats 冻结 12.5k tick）的自我体感通道。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateExpectations,
  TELEMETRY_STALE_TICKS,
  P3_BOOT_GRACE_TICKS,
} from "../../../src/kernel/expectations";

const P3 = [{ name: "telemetry-collector", interval: 10 }];

describe("expectations — E1 遥测新鲜度", () => {
  it("lastSample 停摆超阈值 → telemetryStale 违例", () => {
    const r = evaluateExpectations({
      tick: 82414165,
      statsLastSample: 82414165 - TELEMETRY_STALE_TICKS - 1,
      systemLastRun: {},
      p3Systems: [],
    });
    expect(r.violations.some((v) => v.id === "telemetryStale")).toBe(true);
  });

  it("新鲜采样不违例", () => {
    const r = evaluateExpectations({
      tick: 82414165,
      statsLastSample: 82414160,
      systemLastRun: {},
      p3Systems: [],
    });
    expect(r.violations).toHaveLength(0);
  });
});

describe("expectations — E2 P3 存活", () => {
  it("boot 宽限期内从未运行不判饿", () => {
    const r = evaluateExpectations({
      tick: P3_BOOT_GRACE_TICKS - 1,
      statsLastSample: undefined,
      systemLastRun: {},
      p3Systems: P3,
    });
    expect(r.p3Starved).toBe(false);
  });

  it("宽限期后仍未见执行 → p3Starved（含从未运行）", () => {
    const r = evaluateExpectations({
      tick: 100000,
      statsLastSample: 99990,
      systemLastRun: {},
      p3Systems: P3,
    });
    expect(r.p3Starved).toBe(true);
    expect(r.violations.some((v) => v.id === "p3Starved:telemetry-collector")).toBe(true);
  });

  it("interval×GRACE 内跑过 → 健康", () => {
    const tick = 100000;
    const r = evaluateExpectations({
      tick,
      statsLastSample: tick - 5,
      systemLastRun: { "telemetry-collector": tick - 25 },
      p3Systems: P3,
    });
    expect(r.p3Starved).toBe(false);
    expect(r.violations).toHaveLength(0);
  });
});
