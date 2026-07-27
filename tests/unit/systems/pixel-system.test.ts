import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pixelSystem } from "../../../src/systems/pixel-system";
import { CONFIG } from "../../../src/config";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";

/**
 * Pixel System 门禁回归测试。
 *
 * 两层门禁：
 *   1. CONFIG.pixel.enabled 总开关（默认关闭）— 放血清零 bucket 与 global reset
 *      撞车会触发 reload death loop（bundle 加载即被杀、bucket 永不回充）。
 *   2. tier 门禁 — 仅 healthy 且 bucket 满仓时放血。
 */

function makeCtx(tier: CpuTier): TickContext {
  return {
    tick: 100,
    budget: {
      tier,
      softLimit: 17.5,
      hardLimit: 19.2,
      canStart: () => true,
      isExhausted: () => false,
      spent: () => 0,
    },
    getSnapshot: () => undefined,
    snapshots: () => [],
    globalSiteCount: 0,
  } as unknown as TickContext;
}

describe("Pixel System — 总开关与 tier 门禁", () => {
  let generatePixelSpy: ReturnType<typeof vi.fn>;
  let originalGame: unknown;

  beforeEach(() => {
    originalGame = (globalThis as Record<string, unknown>).Game;
    generatePixelSpy = vi.fn(() => 0);
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: {
        bucket: 10000,
        generatePixel: generatePixelSpy,
      },
    };
    (globalThis as Record<string, unknown>).Memory = { kernel: {} };
  });

  afterEach(() => {
    if (originalGame !== undefined) {
      (globalThis as Record<string, unknown>).Game = originalGame;
    } else {
      delete (globalThis as Record<string, unknown>).Game;
    }
    // 恢复默认关闭状态，避免污染其他测试。
    (CONFIG.pixel as { enabled: boolean }).enabled = false;
  });

  it("默认（enabled=false）：healthy + 满 bucket 也不放血 — 防 reload death loop", () => {
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("开关开启后：healthy + bucket >= 10000 才放血，并记录 pixelAt", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).toHaveBeenCalledTimes(1);
    expect((globalThis as any).Memory.kernel.pixelAt).toBe(100);
  });

  it("does NOT call generatePixel when guarded (even with bucket >= 10000)", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    pixelSystem.run(makeCtx("guarded"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("does NOT call generatePixel when conserve", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    pixelSystem.run(makeCtx("conserve"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("does NOT call generatePixel when recovery", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    pixelSystem.run(makeCtx("recovery"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("does NOT call generatePixel when healthy but bucket < 10000", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: {
        bucket: 9999,
        generatePixel: generatePixelSpy,
      },
    };
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("does NOT throw when generatePixel API is unavailable (private server)", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: {
        bucket: 10000,
        // generatePixel 不存在
      },
    };
    expect(() => pixelSystem.run(makeCtx("healthy"))).not.toThrow();
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });
});
