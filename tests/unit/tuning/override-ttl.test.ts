/**
 * 自进化 L1 的 strategyOverrides 有效期（读时过期）。
 *
 * 现场立案依据：线上 `Memory.kernel.tuning.strategyOverrides` 里一条
 * `posture.minDwell=1400 @82993339` 已在 ~397k 拍前写入并**至今仍在合并链顶层生效**
 * （`adjustedAt` 只被用来做"防重写冷却"，没有任何消费者看它是否已经过期）。
 * 复盘规则含「No-Progress + netFlow 停滞 → 放宽 `expandMaxPressure`」⇒ 无有效期的 override
 * 等于让一次瞬时状态永久压低扩张标准。
 *
 * 本用例锁的是**判别式**（`isStrategyOverrideLive`）：`resolveStrategyOverrides` 是
 * `empire-strategy.ts` 的模块私有函数，不为测试而导出 ⇒ 合并链末端的行为（回落 CONFIG 基线）
 * 由这里的边界 + 代码走查共同保证，不声称已被端到端覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  isStrategyOverrideLive,
  STRATEGY_OVERRIDE_TTL_TICKS,
} from "../../../src/domain/strategy/strategy-reviewer";

const TICK = 1_000_000;

describe("strategyOverrides 读时过期", () => {
  it("TTL 是复盘冷却的 3 倍（自改必须被持续重新争取，但允许条件间歇成立）", () => {
    // 冷却 = 5,000（reviewer 内的 STRATEGY_COOLDOWN_TICKS）⇒ TTL = 15,000
    expect(STRATEGY_OVERRIDE_TTL_TICKS).toBe(15_000);
  });

  it("刚写入的条目生效（正常路径不被本次改动影响）", () => {
    expect(isStrategyOverrideLive({ adjustedAt: TICK }, TICK)).toBe(true);
  });

  it("恰好到 TTL 边界仍生效（<= 而不是 <，免得在两次复核之间闪断）", () => {
    expect(isStrategyOverrideLive({ adjustedAt: TICK - 15_000 }, TICK)).toBe(true);
  });

  it("越过 TTL 一条即失效 ⇒ 回落 CONFIG/DEFAULT 基线", () => {
    expect(isStrategyOverrideLive({ adjustedAt: TICK - 15_001 }, TICK)).toBe(false);
  });

  it("线上那条 397k 拍前的 minDwell 必须判为失效（本条用例的立案现场）", () => {
    const liveAdjustedAt = 82_993_339;
    expect(isStrategyOverrideLive({ adjustedAt: liveAdjustedAt }, 83_390_339)).toBe(false);
  });

  it("畸形/缺失条目按不生效处理（宁回落基线，也不拿坏数据当覆盖）", () => {
    expect(isStrategyOverrideLive(undefined, TICK)).toBe(false);
    expect(isStrategyOverrideLive({}, TICK)).toBe(false);
    expect(isStrategyOverrideLive({ adjustedAt: Number.NaN }, TICK)).toBe(false);
  });
});

// ── 物理清理（2026-11-21 批次 3，立案 #11）──
// 读时过期（上方判别式）只保证"不生效"；过期条目永留 Memory 会误导复盘
// （线上实证：49 万拍前的 minDwell=1600 看起来像现行配置）。写侧清理才是"不留尸体"。
import { pruneExpiredStrategyOverrides } from "../../../src/domain/strategy/strategy-reviewer";

describe("pruneExpiredStrategyOverrides（物理删除过期条目）", () => {
  it("过期条目被物理移除，现行条目原样保留", () => {
    const overrides = {
      "posture.minDwell": { value: 1600, adjustedAt: TICK - 500_000, reason: "stale" },
      "posture.warPatience": { value: 4000, adjustedAt: TICK - 100, reason: "fresh" },
    };
    const pruned = pruneExpiredStrategyOverrides(overrides, TICK);
    expect(pruned["posture.minDwell"]).toBeUndefined();
    expect(pruned["posture.warPatience"]).toEqual(overrides["posture.warPatience"]);
  });

  it("边界：恰好 TTL 的条目保留，TTL+1 移除（与读侧判别式同一把尺）", () => {
    const overrides = {
      a: { value: 1, adjustedAt: TICK - STRATEGY_OVERRIDE_TTL_TICKS, reason: "" },
      b: { value: 2, adjustedAt: TICK - STRATEGY_OVERRIDE_TTL_TICKS - 1, reason: "" },
    };
    const pruned = pruneExpiredStrategyOverrides(overrides, TICK);
    expect(pruned.a).toBeDefined();
    expect(pruned.b).toBeUndefined();
  });

  it("畸形条目（缺 adjustedAt）按不生效处理 ⇒ 被清理（宁缺勿假）", () => {
    const pruned = pruneExpiredStrategyOverrides({ bad: { value: 3, reason: "" } } as never, TICK);
    expect(pruned).toEqual({});
  });

  it("undefined/空输入 → 空对象（调用方按条数差写回，零写放大）", () => {
    expect(pruneExpiredStrategyOverrides(undefined, TICK)).toEqual({});
    expect(pruneExpiredStrategyOverrides({}, TICK)).toEqual({});
  });
});
