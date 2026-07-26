import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pixelSystem } from "../../../src/systems/pixel-system";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";

/**
 * Pixel System tier 门禁回归测试。
 *
 * 验证 generatePixel 只在 healthy tier 下执行。
 * 在非 healthy tier 下运行 generatePixel 会消耗 5000 bucket，
 * 可能导致 bucket 跌破 conserve/recovery 阈值，触发降级死亡螺旋。
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

describe("Pixel System — tier 门禁", () => {
  let generatePixelSpy: ReturnType<typeof vi.fn>;
  let originalGame: unknown;

  beforeEach(() => {
    originalGame = (globalThis as Record<string, unknown>).Game;
    generatePixelSpy = vi.fn();
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: {
        bucket: 10000,
        generatePixel: generatePixelSpy,
      },
    };
  });

  afterEach(() => {
    if (originalGame !== undefined) {
      (globalThis as Record<string, unknown>).Game = originalGame;
    } else {
      delete (globalThis as Record<string, unknown>).Game;
    }
  });

  it("calls generatePixel when healthy and bucket >= 10000", () => {
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT call generatePixel when guarded (even with bucket >= 10000)", () => {
    pixelSystem.run(makeCtx("guarded"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("does NOT call generatePixel when conserve", () => {
    pixelSystem.run(makeCtx("conserve"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("does NOT call generatePixel when recovery", () => {
    pixelSystem.run(makeCtx("recovery"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("does NOT call generatePixel when healthy but bucket < 10000", () => {
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
