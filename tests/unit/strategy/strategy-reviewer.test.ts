/** 策略复盘纯函数单元测试。 */
import { describe, expect, it } from "vitest";
import { reviewStrategy, type StrategyReviewInput } from "../../../src/domain/strategy/strategy-reviewer";
import { STRATEGY_BOUNDS } from "../../../src/domain/tuning/bounds";

/** 构造默认输入（全部无异常状态）。 */
function makeInput(overrides: Partial<StrategyReviewInput> = {}): StrategyReviewInput {
  return {
    postureHistory: [],
    netFlowHistory: [],
    reserveHistory: [],
    healthHistory: [],
    noProgress: { detected: false, stuckDimensions: [] },
    thrashing: { detected: false, type: "", frequency: 0 },
    tick: 10000,
    currentOverrides: undefined,
    defaultPosture: {
      threatWindow: 3000,
      warPatience: 5000,
      warExitPatienceTicks: 1000,
      minDwell: 1000,
      expandMinBucket: 7000,
      expandMaxPressure: 0.4,
      expandMaxCpuRatio: 0.6,
      warMaxPressure: 0.4,
      colonizeSponsorRcl: 7,
      colonizeSponsorFloor: 8000,
      colonizeYoungestFloorRcl: 5,
    },
    ...overrides,
  };
}

describe("reviewStrategy", () => {
  it("无信号时返回空建议", () => {
    const result = reviewStrategy(makeInput());
    expect(result.suggestions).toHaveLength(0);
    expect(result.summary).toContain("no suggestions");
  });

  it("姿态振荡 → 建议 minDwell 增加", () => {
    // 1000t 内 4 次切换（> 3 阈值）
    const postureHistory = [
      { tick: 9100, posture: "develop" },
      { tick: 9200, posture: "expand" },
      { tick: 9300, posture: "develop" },
      { tick: 9400, posture: "expand" },
      { tick: 9500, posture: "develop" },
    ];
    const result = reviewStrategy(makeInput({ postureHistory, tick: 10000 }));
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.param).toBe("posture.minDwell");
    expect(result.suggestions[0]!.value).toBe(1200); // 1000 + 200
    expect(result.suggestions[0]!.oldValue).toBe(1000);
  });

  it("No-Progress netFlow → 建议 expandMaxPressure 放宽", () => {
    const result = reviewStrategy(
      makeInput({
        noProgress: { detected: true, stuckDimensions: ["netFlow"] },
      }),
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.param).toBe("posture.expandMaxPressure");
    expect(result.suggestions[0]!.value).toBeCloseTo(0.45, 5);
  });

  it("Thrashing posture_oscillation → 建议 warPatience 拉长", () => {
    const result = reviewStrategy(
      makeInput({
        thrashing: { detected: true, type: "posture_oscillation", frequency: 5 },
      }),
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.param).toBe("posture.warPatience");
    expect(result.suggestions[0]!.value).toBe(6000); // 5000 + 1000
  });

  it("长期健康 + 储备上升 → 建议 expandMinBucket 降低", () => {
    const healthHistory = Array.from({ length: 20 }, (_, i) => ({
      tick: 1000 + i * 100,
      level: "healthy",
      score: 0.9,
    }));
    const reserveHistory = Array.from({ length: 10 }, (_, i) => 100000 + i * 10000);
    const result = reviewStrategy(
      makeInput({ healthHistory, reserveHistory, tick: 10000 }),
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.param).toBe("posture.expandMinBucket");
    expect(result.suggestions[0]!.value).toBe(6500); // 7000 - 500
  });

  it("冷却期内不产生建议", () => {
    const postureHistory = [
      { tick: 9100, posture: "develop" },
      { tick: 9200, posture: "expand" },
      { tick: 9300, posture: "develop" },
      { tick: 9400, posture: "expand" },
      { tick: 9500, posture: "develop" },
    ];
    const result = reviewStrategy(
      makeInput({
        postureHistory,
        tick: 10000,
        currentOverrides: {
          "posture.minDwell": {
            value: 1000,
            adjustedAt: 8000, // 2000t 前，冷却 5000t 未过
            reason: "prev",
          },
        },
      }),
    );
    expect(result.suggestions).toHaveLength(0);
  });

  it("冷却期过后可以产生建议", () => {
    const postureHistory = [
      { tick: 14100, posture: "develop" },
      { tick: 14200, posture: "expand" },
      { tick: 14300, posture: "develop" },
      { tick: 14400, posture: "expand" },
      { tick: 14500, posture: "develop" },
    ];
    const result = reviewStrategy(
      makeInput({
        postureHistory,
        tick: 15000, // 15000 - 8000 = 7000 > 5000 冷却
        currentOverrides: {
          "posture.minDwell": {
            value: 1000,
            adjustedAt: 8000,
            reason: "prev",
          },
        },
      }),
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.oldValue).toBe(1000); // 从 override 读 oldValue
    expect(result.suggestions[0]!.value).toBe(1200); // 1000 + 200
  });

  it("STRATEGY_BOUNDS 边界钳制生效", () => {
    // minDwell ceiling = 3000，从 2900 只能 +100（到 3000），不会超
    const postureHistory = [
      { tick: 9100, posture: "develop" },
      { tick: 9200, posture: "expand" },
      { tick: 9300, posture: "develop" },
      { tick: 9400, posture: "expand" },
      { tick: 9500, posture: "develop" },
    ];
    const result = reviewStrategy(
      makeInput({
        postureHistory,
        tick: 10000,
        currentOverrides: {
          "posture.minDwell": {
            value: 2900,
            adjustedAt: 4000, // 冷却已过
            reason: "prev",
          },
        },
      }),
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.value).toBe(3000); // clamp to ceiling
  });

  it("多个信号同时触发产生多条建议", () => {
    const postureHistory = [
      { tick: 9100, posture: "develop" },
      { tick: 9200, posture: "expand" },
      { tick: 9300, posture: "develop" },
      { tick: 9400, posture: "expand" },
      { tick: 9500, posture: "develop" },
    ];
    const result = reviewStrategy(
      makeInput({
        postureHistory,
        noProgress: { detected: true, stuckDimensions: ["netFlow"] },
        thrashing: { detected: true, type: "posture_oscillation", frequency: 5 },
        tick: 10000,
      }),
    );
    expect(result.suggestions).toHaveLength(3);
    const params = result.suggestions.map(s => s.param);
    expect(params).toContain("posture.minDwell");
    expect(params).toContain("posture.expandMaxPressure");
    expect(params).toContain("posture.warPatience");
  });

  it("储备不足窗口时不触发长期健康建议", () => {
    const healthHistory = Array.from({ length: 20 }, (_, i) => ({
      tick: 1000 + i * 100,
      level: "healthy",
      score: 0.9,
    }));
    const reserveHistory = Array.from({ length: 5 }, () => 100000); // 不足 10 个
    const result = reviewStrategy(
      makeInput({ healthHistory, reserveHistory, tick: 10000 }),
    );
    expect(result.suggestions).toHaveLength(0);
  });

  it("健康度不全是 healthy 时不触发长期健康建议", () => {
    const healthHistory = Array.from({ length: 20 }, (_, i) => ({
      tick: 1000 + i * 100,
      level: i === 10 ? "degraded" : "healthy", // 有一个不是 healthy
      score: 0.9,
    }));
    const reserveHistory = Array.from({ length: 10 }, (_, i) => 100000 + i * 10000);
    const result = reviewStrategy(
      makeInput({ healthHistory, reserveHistory, tick: 10000 }),
    );
    expect(result.suggestions).toHaveLength(0);
  });

  it("储备趋势下降时不触发长期健康建议", () => {
    const healthHistory = Array.from({ length: 20 }, (_, i) => ({
      tick: 1000 + i * 100,
      level: "healthy",
      score: 0.9,
    }));
    const reserveHistory = Array.from({ length: 10 }, (_, i) => 200000 - i * 10000); // 下降
    const result = reviewStrategy(
      makeInput({ healthHistory, reserveHistory, tick: 10000 }),
    );
    expect(result.suggestions).toHaveLength(0);
  });
});

describe("STRATEGY_BOUNDS", () => {
  it("包含 4 个策略参数", () => {
    expect(Object.keys(STRATEGY_BOUNDS)).toHaveLength(4);
    expect(STRATEGY_BOUNDS["posture.minDwell"]).toBeDefined();
    expect(STRATEGY_BOUNDS["posture.warPatience"]).toBeDefined();
    expect(STRATEGY_BOUNDS["posture.expandMinBucket"]).toBeDefined();
    expect(STRATEGY_BOUNDS["posture.expandMaxPressure"]).toBeDefined();
  });

  it("minDwell floor < default(1000) < ceiling", () => {
    const b = STRATEGY_BOUNDS["posture.minDwell"]!;
    expect(b.floor).toBeLessThan(1000);
    expect(b.ceiling).toBeGreaterThan(1000);
  });

  it("expandMaxPressure floor(0.2) < default(0.4) < ceiling(0.6)", () => {
    const b = STRATEGY_BOUNDS["posture.expandMaxPressure"]!;
    expect(b.floor).toBe(0.2);
    expect(b.ceiling).toBe(0.6);
  });
});
