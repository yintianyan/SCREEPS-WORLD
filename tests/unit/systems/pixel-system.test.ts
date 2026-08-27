import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pixelSystem } from "../../../src/systems/pixel-system";
import { CONFIG } from "../../../src/config";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";

/**
 * Pixel System 门禁回归测试。

 * 三层门禁：
 *   1. CONFIG.pixel.enabled 总开关（默认关闭）— 放血清零 bucket 与 global reset
 *      撞车会触发 reload death loop（bundle 加载即被杀、bucket 永不回充）。
 *   2. tier 门禁 — 仅 healthy 且 bucket 满仓时放血。
 *   3. war 姿态门禁 — 战时 bucket 突发容量留给军事计算，不放血。
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
    // 保留缓冲策略：门槛 = 10000 + bucketReserve（默认 3000）= 13000。
    // beforeEach 默认设 bucket=13000 使「开关开启后放血」用例直接通过；
    // 需要测试「未达门槛」的用例在自身内覆盖 bucket 值。
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: {
        bucket: 13000,
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
    // 恢复线上默认（enabled=true），避免污染其他测试。
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
  });

  it("开关关闭（enabled=false）：healthy + 满 bucket 也不放血 — 防 reload death loop", () => {
    // 线上默认已切换为 enabled=true（自愿放血协议）；关闭态仍是回滚保险丝，
    // 本用例显式设置 false 锁定关闭行为。
    (CONFIG.pixel as { enabled: boolean }).enabled = false;
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("开关开启后：healthy + bucket >= 门槛(10000+reserve) 才放血，并记录 pixelAt", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    // bucket=13000（默认 beforeEach 已设），门槛 = 10000 + 3000 = 13000 → 放血。
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).toHaveBeenCalledTimes(1);
    expect((globalThis as any).Memory.kernel.pixelAt).toBe(100);
  });

  it("war 姿态：healthy + 满 bucket 也不放血（bucket 突发容量留给战时计算）", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    (globalThis as any).Memory = {
      kernel: { strategy: { posture: "war", since: 100, expansionAllowed: false, newRemoteOpsAllowed: false } },
    };
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
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

  it("does NOT call generatePixel when healthy but bucket < 门槛(10000+reserve)", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    // 门槛 = 10000 + 3000 = 13000；bucket=12999 未达门槛 → 不放血。
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: {
        bucket: 12999,
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
        bucket: 13000,
        // generatePixel 不存在
      },
    };
    expect(() => pixelSystem.run(makeCtx("healthy"))).not.toThrow();
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });
});
