import { beforeEach, describe, expect, it, vi } from "vitest";
import { tuningRandom } from "../../../src/kernel/deterministic-random";

/**
 * #62 的可复现随机源单测。
 *
 * 为什么值得单独一份：长 soak 的 e2e 不可复现，根因是调优的随机探索（`exploreParameter` 抽随机参数
 * + 随机方向）；而 bot 跑在 @screeps/driver 的 isolated-vm isolate 里，**测试进程替换 Math.random 到不了它**
 * （10-01 实测：同 `E2E_RANDOM_SEED` 连跑两遍场景 22，firstWar 仍 5002 vs 5003）。
 * ⇒ 种子必须经 isolate 读得到的通道进来（Memory），且随机源要注入进"纯函数"的评估层。
 *
 * 这里同时是本次改动的**反向实验**：把注入撤掉（评估层直接吃 Math.random）时，
 * 「同种子 ⇒ 同一条探索序列」这条断言必红，其余控制组照绿。
 */

function resetMemory(seed?: number): void {
  (globalThis as unknown as { Memory: { kernel: Record<string, unknown> } }).Memory = {
    kernel: seed === undefined ? {} : { testRandomSeed: seed },
  };
}

function series(seed: number | undefined, n: number): number[] {
  resetMemory(seed);
  return Array.from({ length: n }, () => tuningRandom());
}

describe("tuningRandom（#62：探索随机源的可复现化）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("未落种子 ⇒ 逐次调用真 Math.random，且不动 Memory（生产行为一字不变）", () => {
    resetMemory(undefined);
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.42);
    expect(tuningRandom()).toBe(0.42);
    expect(tuningRandom()).toBe(0.42);
    expect(spy).toHaveBeenCalledTimes(2);
    const kernel = (Memory as unknown as { kernel: Record<string, unknown> }).kernel;
    expect(kernel.testRandomCalls).toBeUndefined();
  });

  it("Memory 不存在时退回真 Math.random（纯函数环境不炸）", () => {
    delete (globalThis as unknown as { Memory?: unknown }).Memory;
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.77);
    expect(tuningRandom()).toBe(0.77);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("同 seed 两遍跑出同一条序列 —— 撤掉注入后这条必红（反向实验的那一支）", () => {
    expect(series(7, 12)).toEqual(series(7, 12));
  });

  it("不同 seed 给出不同序列，且值全落在 [0,1)", () => {
    const a = series(1, 30);
    const b = series(2, 30);
    expect(a).not.toEqual(b);
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("同 seed 下 30 次不会退化成常值（可复现 ≠ 把探索变成一个固定答案）", () => {
    expect(new Set(series(7, 30)).size).toBeGreaterThan(20);
  });

  it("方向位（第二次抽取）在若干 seed 下 up/down 都取得到 —— 种子不缩小可达集合", () => {
    const directions = new Set<"up" | "down">();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      resetMemory(seed);
      tuningRandom(); // 第一次抽取 = 选参数
      directions.add(tuningRandom() < 0.5 ? "up" : "down"); // 第二次 = 选方向
    }
    expect(directions.size).toBe(2);
  });
});
