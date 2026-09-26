import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pixelSystem } from "../../../src/systems/empire/pixel-system";
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
    // 门槛 = 生成成本本身（CONFIG.pixel.cpuCost，引擎 PIXEL_CPU_COST=10000）。
    // 旧实现是 `10000 + bucketReserve(3000) = 13000`，而 bucket 上限就是 10000 ——
    // 门槛恒迈不过去，pixel 从未生成过；本文件当年用 mock bucket=13000 把这条
    // 不可达路径钉成了绿灯。现在 beforeEach 用真上限，边界另设用例。
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

  it("开关开启后：healthy + bucket >= 门槛(=生成成本) 才放血，并记录 pixelAt", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    // bucket=10000（默认 beforeEach 已设）= 引擎 PIXEL_CPU_COST → 达门槛，放血。
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).toHaveBeenCalledTimes(1);
    expect((globalThis as any).Memory.kernel.pixelAt).toBe(100);
  });

  it("门槛边界：差 1 点不放血，正好满成本即放血", () => {
    // 旧实现门槛是 13000，本用例（bucket=10000）会断"不放血"却把"永远不生成"
    // 当成正确行为 —— 边界必须钉在成本上，而不是钉在一个不可达的数字上。
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    const cpu = (globalThis as unknown as { Game: { cpu: { bucket: number } } }).Game.cpu;

    cpu.bucket = CONFIG.pixel.cpuCost - 1;
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();

    cpu.bucket = CONFIG.pixel.cpuCost;
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).toHaveBeenCalledTimes(1);
  });

  it("war 姿态：healthy + 满 bucket 也不放血（bucket 突发容量留给战时计算）", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    (globalThis as any).Memory = {
      kernel: {
        strategy: {
          posture: "war",
          since: 100,
          expansionAllowed: false,
          newRemoteOpsAllowed: false,
        },
      },
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
