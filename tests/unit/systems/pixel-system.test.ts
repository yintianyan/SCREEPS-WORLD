import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pixelSystem } from "../../../src/systems/empire/pixel-system";
import { CONFIG } from "../../../src/config";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";

/**
 * Pixel System 门禁回归测试。

 * 四层门禁：
 *   1. CONFIG.pixel.enabled 总开关 — **出厂为关闭**，它才是真正拦住放血的那一层：
 *      bucket 在本仓库首先是档位时钟（healthy≥7000/guarded≥3000/conserve≥1000），
 *      一次放血把它清光 ⇒ 实测 1,500+ tick 才回得来，期间 P3 系统近乎每 tick 被拒；
 *      另有 reload death loop 风险（清零时刻撞上 global reset ⇒ bundle 加载即被杀）。
 *   2. tier 门禁 — 仅 healthy 且 bucket 满仓时放血。
 *   3. war 姿态门禁 — 战时 bucket 突发容量留给军事计算，不放血。
 *   4. 借用互斥门禁 — 近 ~100 tick CPU 峰值达到每 tick 限额时不放血。**必要但不充分，
 *      2026-09-27 线上判效失败**：放血前是 bucket=10000 + healthy + cpu 12.7~15.4（峰值
 *      够不到 limit ⇒ 闸放行），同段却有 18~19 项/tick 被拒 ⇒ 不存在"产能用不满"的自洽
 *      状态。现仅作纵深防御保留，判据正确性以第 1 层为准。
 */

// 出厂默认值在模块加载时抓一次 — 用例会把 CONFIG.pixel.enabled 逐条翻转，
// 事后必须恢复到这里（而不是硬编码 true/false，那样改默认值后就成假绿）。
const SHIPPED_ENABLED = CONFIG.pixel.enabled;

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
    // 恢复到**出厂默认**（SHIPPED_ENABLED，见模块顶部）而不是硬编码某个值 —
    // 本文件的用例逐条翻转过 enabled，硬编码 true/false 都会在某次改默认值后变成假绿。
    (CONFIG.pixel as { enabled: boolean }).enabled = SHIPPED_ENABLED;
  });

  /**
   * 出厂值必须是关闭。立案依据（线上实测 2026-09-27）：bucket 在本仓库首先是**档位时钟**，
   * 一次放血把它清光 ⇒ 1,500+ tick 回不来，期间 layout-planner/room-observer 实测
   * 500 tick 窗口内被拒 478 次（≈每 tick）。而"只在真富余时放血"这道闸救不了它 ——
   * 放血前那段是 bucket=10000 + healthy + cpu 12.7~15.4 却仍有 18~19 项/tick 被拒，
   * 本帝国不存在"产能用不满"的自洽状态。重新开启要显式改 CONFIG 并说明这笔账。
   */
  it("出厂默认 enabled=false（放血会清掉档位时钟）", () => {
    expect(SHIPPED_ENABLED).toBe(false);
  });

  it("开关关闭（enabled=false）：healthy + 满 bucket 也不放血 — 防 reload death loop", () => {
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
