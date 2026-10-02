import { describe, expect, it, vi } from "vitest";
import type { TuningSignals } from "../../../src/domain/tuning/types";

/**
 * 探索随机源的**注入是否真的生效**（#62 的第二半）。
 *
 * `deterministic-random.test.ts` 只验了种子本身；这里验评估层**用不用**注入进来的那个源 ——
 * e2e 可复现的前提是"种子决定探索抽到哪个参数、哪个方向"，只要评估层还从别处取 Math.random，
 * 落种子就毫无作用（10-01 那次正是这样：同 E2E_RANDOM_SEED 连跑两遍，世界仍分叉）。
 *
 * 反向实验（供复跑核对）：把 `exploreParameter` 内两处改回直接调 `Math.random` ⇒
 * "同一段抽取 ⇒ 同一结果"与"抽取值改变 ⇒ 方向变 down"两例必红，三条护栏/默认值用例仍绿。
 */

function signals(overrides: Partial<TuningSignals> = {}): TuningSignals {
  return {
    avgReserveDelta: 40,
    avgPressure: 0.1,
    avgDrainScore: 0,
    crisisRatio: 0,
    avgStorageEnergy: 30_000,
    containerFillRatio: 0.5,
    spawnFillRatio: 0.8,
    haulerCount: 2,
    harvesterCount: 2,
    upgraderCount: 3,
    builderCount: 1,
    buildQueueBacklog: 1,
    srcRatio: 0,
    tierRank: 1,
    rcl: 5,
    hasStorage: true,
    ...overrides,
  };
}

const BOUNDS = {
  hauler: { minCount: 2, maxCount: 4 },
  harvester: { minCount: 2, maxCount: 4 },
  upgrader: { minCount: 1, maxCount: 3 },
  builder: { minCount: 1, maxCount: 4 },
};

type Explore = typeof import("../../../src/domain/tuning/evaluator").exploreParameter;

/**
 * 每个用例一份干净模块：`explorationState` 是模块级堆状态（生产里换码即清，测试里同理必须重置）。
 * 且要**先空跑满 EXPLORATION_STABLE_THRESHOLD=3 拍** —— 前两拍按设计就返回 null
 * （稳态计数没到阈值不探索），没到阈值就断言非 null 会把我自己的门槛当成 bug。
 */
async function freshWarmedExplore(overrides: Partial<TuningSignals> = {}): Promise<Explore> {
  vi.resetModules();
  const mod = await import("../../../src/domain/tuning/evaluator");
  const s = signals(overrides);
  for (let i = 0; i < 2; i++) {
    expect(mod.exploreParameter(s, BOUNDS, {}, 100_000, () => 0)).toBeNull();
  }
  return mod.exploreParameter;
}

describe("#62 探索随机源注入", () => {
  it("前两拍不探索（稳态计数未达阈值）—— 上面已断言，这里只确认第 3 拍开始有输出", async () => {
    const explore = await freshWarmedExplore();
    expect(explore(signals(), BOUNDS, {}, 100_000, () => 0)).not.toBeNull();
  });

  it("同一段抽取在 6 个独立进程态里跑出**完全相同**的 (参数, 方向)（确定性）", async () => {
    // 只能在**各自全新模块**之间比较：探索一旦成交就把 stableCount 归零，
    // 同模块内第二次调用要再攒满 3 拍稳态才会出结果（那是设计，不是 bug —— 上面第一例刚踩过）。
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const explore = await freshWarmedExplore();
      const r = explore(signals(), BOUNDS, {}, 100_000, () => 0);
      expect(r).not.toBeNull();
      seen.add(
        `${r!.adjustment.param}:${r!.adjustment.newValue > r!.adjustment.oldValue ? "up" : "down"}`,
      );
    }
    // 撤掉注入（改回 Math.random）时，6 次全等的概率约 (1/参数数 × 1/2)^5 ⇒ 这一例必红，且不会偶发通过。
    expect(seen.size).toBe(1);
    expect([...seen][0]!.endsWith(":up")).toBe(true);
  });

  it("抽取值改变 ⇒ 方向变 down（注入源是唯一随机来源）", async () => {
    const explore = await freshWarmedExplore();
    const result = explore!(signals(), BOUNDS, {}, 100_000, () => 0.9);

    expect(result).not.toBeNull();
    expect(result!.adjustment.newValue).toBeLessThan(result!.adjustment.oldValue); // down
  });

  it("不传随机源时走 Math.random（默认值 ⇒ 现有调用方与生产行为一字不变）", async () => {
    const explore = await freshWarmedExplore();
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.0);

    explore(signals(), BOUNDS, {}, 100_300);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("tierRank ≥ guarded 时不探索（护栏没被这次改动带松）", async () => {
    vi.resetModules();
    const mod = await import("../../../src/domain/tuning/evaluator");
    const s = signals({ tierRank: 2 });
    for (let i = 0; i < 6; i++) {
      expect(mod.exploreParameter(s, BOUNDS, {}, 100_000 + i, () => 0)).toBeNull();
    }
  });

  it("crisisRatio ≥ 0.1 时不探索（另一条护栏）", async () => {
    vi.resetModules();
    const mod = await import("../../../src/domain/tuning/evaluator");
    const s = signals({ crisisRatio: 0.2 });
    for (let i = 0; i < 6; i++) {
      expect(mod.exploreParameter(s, BOUNDS, {}, 100_000 + i, () => 0)).toBeNull();
    }
  });
});
