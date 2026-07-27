import { describe, expect, it } from "vitest";
import { resolveTier } from "../../../src/kernel/scheduler";
import type { CpuTier } from "../../../src/kernel/contracts";

describe("Scheduler — resolveTier", () => {
  it("returns recovery for undefined previous tier and low bucket", () => {
    const result = resolveTier(undefined, 0, 500);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("returns healthy for undefined previous tier and high bucket", () => {
    const result = resolveTier(undefined, 0, 8000);
    expect(result.tier).toBe("healthy");
    expect(result.recoveryTicks).toBe(0);
  });

  it("immediately drops to a worse tier on low bucket", () => {
    // 当前 healthy，bucket 降至 7000 以下
    const result = resolveTier("healthy", 10, 6500);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(0);
  });

  it("immediately drops to recovery on very low bucket", () => {
    const result = resolveTier("healthy", 10, 500);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("does not immediately upgrade without hysteresis", () => {
    // 当前 recovery，bucket 在 1001（刚好超过 conserve 阈值）
    // 需要超过 1000 + 500 = 1500 才满足滞回
    const result = resolveTier("recovery", 0, 1001);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("starts recovery tick counter when bucket exceeds hysteresis threshold", () => {
    // 当前 recovery，bucket 超过 1500（1000 + 500 滞回）
    const result = resolveTier("recovery", 0, 1600);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(1);
  });

  it("increments recovery ticks on sustained high bucket", () => {
    const result = resolveTier("recovery", 15, 1600);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(16);
  });

  it("upgrades after 20 sustained ticks", () => {
    // 19 tick -> 仍为 recovery，tick = 20 时升级到 conserve
    const result = resolveTier("recovery", 19, 1600);
    expect(result.tier).toBe("conserve");
    expect(result.recoveryTicks).toBe(0);
  });

  it("resets recovery ticks when bucket drops below hysteresis", () => {
    const result = resolveTier("recovery", 15, 1200);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("guarded to healthy requires bucket above 7500 for 20 ticks", () => {
    // bucket 在 7400（低于 7000 + 500 = 7500）
    let result = resolveTier("guarded", 0, 7400);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(0);

    // bucket 在 7600（超过 7500）
    result = resolveTier("guarded", 0, 7600);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(1);

    // 20 tick 后
    result = resolveTier("guarded", 19, 7600);
    expect(result.tier).toBe("healthy");
    expect(result.recoveryTicks).toBe(0);
  });

  it("conserve to guarded requires bucket above 3500 for 20 ticks", () => {
    let result = resolveTier("conserve", 0, 3400);
    expect(result.tier).toBe("conserve");
    expect(result.recoveryTicks).toBe(0);

    result = resolveTier("conserve", 0, 3600);
    expect(result.tier).toBe("conserve");
    expect(result.recoveryTicks).toBe(1);

    result = resolveTier("conserve", 19, 3600);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(0);
  });
});

describe("Scheduler — 自愿放血宽限（generatePixel 后 recovery 地板抬到 conserve）", () => {
  it("宽限期内 bucket=0 → conserve 而非 recovery（P2 经济角色不冻结）", () => {
    const result = resolveTier("healthy", 0, 0, true);
    expect(result.tier).toBe("conserve");
  });

  it("无宽限时 bucket=0 → recovery（真实 CPU 失控的原有语义不变）", () => {
    const result = resolveTier("healthy", 0, 0, false);
    expect(result.tier).toBe("recovery");
  });

  it("宽限只抬 recovery 地板 — 自然档位为 guarded/conserve 时不受影响", () => {
    // bucket 5000 → 自然 guarded，宽限不改变。
    expect(resolveTier(undefined, 0, 5000, true).tier).toBe("guarded");
    // bucket 1500 → 自然 conserve，宽限不改变。
    expect(resolveTier(undefined, 0, 1500, true).tier).toBe("conserve");
  });

  it("宽限期内滞回爬升记账照常 — 从 conserve 向 guarded 的恢复不被干扰", () => {
    // 宽限地板下 tier=conserve，bucket 爬回 3600（> guarded.min+滞回）开始计数。
    const r1 = resolveTier("conserve", 0, 3600, true);
    expect(r1.tier).toBe("conserve");
    expect(r1.recoveryTicks).toBe(1);
    const r2 = resolveTier("conserve", 19, 3600, true);
    expect(r2.tier).toBe("guarded");
  });
});
