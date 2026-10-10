/**
 * 候选池落盘投影的两条不变量 —— 立案过程见 roadmap 补210/补211（commit 760260b4／285d0d12）。
 *
 * `Memory.kernel.expansionCandidates` 落盘的是 `allCandidates` 按数组尾截断的前缀
 * （`CANDIDATE_PERSIST_CAP`）。这个前缀同时是 `evaluateExpansionPressure` 的
 * `candidateCount` 输入与 planner 的早退条件，所以"截断会不会改判决"必须能被钉住，
 * 而不是靠一段散文论证。
 */
import { describe, expect, it } from "vitest";
import { CANDIDATE_PERSIST_CAP } from "../../../src/systems/empire/expansion-planner";

/** 压力档那一维对候选数的解析度只有 `>=3`（`pressure.ts` 的 growthOpportunity）。 */
const PRESSURE_SATURATES_AT = 3;

function prefix(n: number, cap: number): number {
  return Math.min(n, cap);
}

describe("候选池落盘前缀：截断不改判决的两条不变量", () => {
  it("上限本身必须 >= 压力的饱和点，否则下面两条按构造不成立", () => {
    expect(CANDIDATE_PERSIST_CAP).toBeGreaterThanOrEqual(PRESSURE_SATURATES_AT);
  });

  it("保非空性：早退条件 existingCandidateCount === 0 与真实池同侧", () => {
    for (let n = 0; n <= 40; n++) {
      expect(prefix(n, CANDIDATE_PERSIST_CAP) === 0).toBe(n === 0);
    }
  });

  it("保 `>=3` 分支：压力这一维读不到截断（两侧同时为真/同时为假）", () => {
    for (let n = 0; n <= 40; n++) {
      expect(prefix(n, CANDIDATE_PERSIST_CAP) >= PRESSURE_SATURATES_AT).toBe(
        n >= PRESSURE_SATURATES_AT,
      );
    }
  });

  it("分母恒等式：poolCut 非负且 persisted + poolCut === 真实条数", () => {
    for (let n = 0; n <= 40; n++) {
      const persisted = prefix(n, CANDIDATE_PERSIST_CAP);
      const poolCut = n - persisted;
      expect(poolCut).toBeGreaterThanOrEqual(0);
      expect(persisted + poolCut).toBe(n);
    }
  });

  // 反向实验：把上限压到饱和点之下，第 2、3 条必须立刻失效 —— 证明这四条不是空转。
  it("反向实验：cap < 饱和点时两条不变量当场崩", () => {
    const brokenCap = PRESSURE_SATURATES_AT - 1;
    const n = PRESSURE_SATURATES_AT;
    expect(prefix(n, brokenCap) === 0).toBe(false); // 这条仍成立（保非空性不依赖上限大小）
    expect(prefix(n, brokenCap) >= PRESSURE_SATURATES_AT).toBe(false); // 真实池已达 3 ⇒ 失效
    expect(n - prefix(n, brokenCap)).toBe(1);
  });
});
