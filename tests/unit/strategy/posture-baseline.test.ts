/** 环境自适应姿态基线纯函数单元测试。 */
import { describe, expect, it } from "vitest";
import { selectEnvBaseline, type EnvBaselineInput } from "../../../src/domain/strategy/posture-baseline";

function makeInput(overrides: Partial<EnvBaselineInput> = {}): EnvBaselineInput {
  return {
    marketActivity: "moderate",
    neighborPressure: "medium",
    gclProgressRate: 0,
    hasLiveThreat: false,
    ...overrides,
  };
}

describe("selectEnvBaseline", () => {
  it("中等环境不产生覆盖（保持 CONFIG 默认）", () => {
    const result = selectEnvBaseline(makeInput());
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("高邻居压力 → 缩短威胁窗口 + 拉长战争耐心 + 收紧扩张", () => {
    const result = selectEnvBaseline(makeInput({ neighborPressure: "high" }));
    expect(result.threatWindow).toBe(1500);
    expect(result.warPatience).toBe(7000);
    expect(result.expandMinBucket).toBe(8000);
    expect(result.expandMaxPressure).toBe(0.3);
  });

  it("低邻居压力 → 拉长威胁窗口 + 缩短战争耐心 + 放宽扩张", () => {
    const result = selectEnvBaseline(makeInput({ neighborPressure: "low" }));
    expect(result.threatWindow).toBe(5000);
    expect(result.warPatience).toBe(3000);
    expect(result.expandMinBucket).toBe(6000);
    expect(result.expandMaxPressure).toBe(0.5);
  });

  it("市场活跃 → 扩张 CPU 比例收窄（可激进）", () => {
    const result = selectEnvBaseline(makeInput({ marketActivity: "active" }));
    expect(result.expandMaxCpuRatio).toBe(0.65);
  });

  it("市场萧条 → 扩张 CPU 比例降低（保守）", () => {
    const result = selectEnvBaseline(makeInput({ marketActivity: "thin" }));
    expect(result.expandMaxCpuRatio).toBe(0.55);
  });

  it("GCL 增长 + 低邻居压力 → 扩张门槛进一步降低", () => {
    const result = selectEnvBaseline(
      makeInput({ gclProgressRate: 0.001, neighborPressure: "low" }),
    );
    // 低压力已设 6000，GCL 增长再减 500 → 5500，但 floor 5000 兜底
    expect(result.expandMinBucket).toBe(5500);
  });

  it("GCL 增长 + 高邻居压力 → 扩张门槛不降（安全侧）", () => {
    const result = selectEnvBaseline(
      makeInput({ gclProgressRate: 0.001, neighborPressure: "high" }),
    );
    // 高压力已设 8000，GCL 增长但高压力不降门槛
    expect(result.expandMinBucket).toBe(8000);
  });

  it("GCL 停滞 → 不升扩张门槛（无法区分停滞 vs 首次采样）", () => {
    const result = selectEnvBaseline(
      makeInput({ gclProgressRate: 0, neighborPressure: "medium" }),
    );
    // GCL 速率=0 不触发停滞判定（防首次采样误升门槛）
    expect(result.expandMinBucket).toBeUndefined();
  });

  it("GCL 停滞 + 低邻居压力 → 低压力门槛不变", () => {
    const result = selectEnvBaseline(
      makeInput({ gclProgressRate: 0, neighborPressure: "low" }),
    );
    // 低压力设 6000，GCL=0 不触发停滞判定 → 保持 6000
    expect(result.expandMinBucket).toBe(6000);
  });

  it("环境画像缺失时返回中性值（不产生覆盖）", () => {
    const result = selectEnvBaseline({
      marketActivity: "moderate",
      neighborPressure: "medium",
      gclProgressRate: 0,
      hasLiveThreat: false,
    });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("多环境信号同时触发产生组合覆盖", () => {
    const result = selectEnvBaseline(
      makeInput({
        neighborPressure: "high",
        marketActivity: "thin",
        gclProgressRate: 0,
      }),
    );
    // 高压力 + 萧条市场
    expect(result.threatWindow).toBe(1500);
    expect(result.warPatience).toBe(7000);
    expect(result.expandMinBucket).toBe(8000);
    expect(result.expandMaxPressure).toBe(0.3);
    expect(result.expandMaxCpuRatio).toBe(0.55);
  });
});
