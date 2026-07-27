/**
 * scheduler bucket 阈值的单一真相源测试。
 *
 * 背景：scheduler 曾硬编码 TIER_BUCKET_MIN（7000/3000/1000/0），
 * 与 CONFIG.cpu.tiers[*].min 双源并存 — 调 config 静默不生效。
 * 修复后 scheduler 从 CONFIG 取值；本文件用 CONFIG 值断言档位边界，
 * 保证两者永远一致（config 改动会同步反映在断言输入上）。
 */
import { describe, expect, it } from "vitest";
import { resolveTier } from "../../../src/kernel/scheduler";
import { CONFIG } from "../../../src/config";

describe("scheduler — bucket 阈值以 CONFIG.cpu.tiers 为唯一真相源", () => {
  it("恰好达到各档 min 时归入该档", () => {
    expect(resolveTier(undefined, 0, CONFIG.cpu.tiers.healthy.min).tier).toBe("healthy");
    expect(resolveTier(undefined, 0, CONFIG.cpu.tiers.guarded.min).tier).toBe("guarded");
    expect(resolveTier(undefined, 0, CONFIG.cpu.tiers.conserve.min).tier).toBe("conserve");
    expect(resolveTier(undefined, 0, CONFIG.cpu.tiers.recovery.min).tier).toBe("recovery");
  });

  it("低于各档 min 一点即落入下一档（边界与 CONFIG 对齐）", () => {
    expect(resolveTier(undefined, 0, CONFIG.cpu.tiers.healthy.min - 1).tier).toBe("guarded");
    expect(resolveTier(undefined, 0, CONFIG.cpu.tiers.guarded.min - 1).tier).toBe("conserve");
    expect(resolveTier(undefined, 0, CONFIG.cpu.tiers.conserve.min - 1).tier).toBe("recovery");
  });

  it("升档滞回阈值同样由 CONFIG 派生", () => {
    // guarded → healthy：需 bucket ≥ healthy.min + recoveryHysteresis 且持续 recoveryTicks。
    const threshold = CONFIG.cpu.tiers.healthy.min + CONFIG.cpu.tiers.guarded.recoveryHysteresis;
    // 低于滞回阈值：保持 guarded，计数归零。
    expect(resolveTier("guarded", 5, threshold - 1)).toEqual({ tier: "guarded", recoveryTicks: 0 });
    // 达到阈值但未满驻留：计数递增。
    expect(resolveTier("guarded", 0, threshold)).toEqual({ tier: "guarded", recoveryTicks: 1 });
    // 驻留满：升档。
    expect(
      resolveTier("guarded", CONFIG.cpu.tiers.guarded.recoveryTicks - 1, threshold).tier,
    ).toBe("healthy");
  });
});
