import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pixelSystem } from "../../../src/systems/empire/pixel-system";
import { CONFIG } from "../../../src/config";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";

/**
 * Pixel System 门禁回归测试。

 * 四层门禁：
 *   1. CONFIG.pixel.enabled 总开关（默认关闭）— 放血清零 bucket 与 global reset
 *      撞车会触发 reload death loop（bundle 加载即被杀、bucket 永不回充）。
 *   2. tier 门禁 — 仅 healthy 且 bucket 满仓时放血。
 *   3. war 姿态门禁 — 战时 bucket 突发容量留给军事计算，不放血。
 *   4. 借用互斥门禁 — 近 ~100 tick 的 CPU 峰值已达到每 tick 限额时不放血：
 *      CONFIG.cpu.borrow 把满仓 bucket 当成突发额度在用，而放血代价 = bucket 上限，
 *      两者互斥（线上实测一次放血后 1,618 tick 才回到借用下界，期间每 tick 拒 ~26 项）。
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
        limit: 20,
        bucket: 10000,
        generatePixel: generatePixelSpy,
      },
    };
    // cpuMax10 = 12 < limit ⇒ 借用额度没在被依赖，本文件其余用例才是在测"该放血时放血"。
    // 借用互斥闸见文件头第 4 条。
    (globalThis as Record<string, unknown>).Memory = { kernel: { stats: { cpuMax10: 12 } } };
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

  it("借用互斥：cpuMax10 达到每 tick 限额 ⇒ 借来的额度在养常态负载，不放血", () => {
    // 线上实测态：cpuMax10=22.3 对 limit=20（借用上限 26 之内）。
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    (globalThis as any).Memory.kernel.stats.cpuMax10 = 22.3;
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();
  });

  it("借用互斥边界：cpuMax10 正好等于 limit 即不放血（>= 语义，不留 1 点缝）", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    (globalThis as any).Memory.kernel.stats.cpuMax10 = 20;
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();

    // 差 0.1 才算"没用满每 tick 限额" — 门槛是 limit 本身，不是 hardLimit。
    (globalThis as any).Memory.kernel.stats.cpuMax10 = 19.9;
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).toHaveBeenCalledTimes(1);
  });

  it("借用互斥：无负载历史（stats 缺失 / cpuMax10=0）按不放血处理", () => {
    (CONFIG.pixel as { enabled: boolean }).enabled = true;
    (globalThis as Record<string, unknown>).Memory = { kernel: {} };
    pixelSystem.run(makeCtx("healthy"));
    expect(generatePixelSpy).not.toHaveBeenCalled();

    (globalThis as Record<string, unknown>).Memory = { kernel: { stats: { cpuMax10: 0 } } };
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
