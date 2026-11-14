/** 尺度原语语义表 — flipLatch 的翻转/保持与 emaSample 的首窗/平滑公式。 */
import { describe, expect, it } from "vitest";
import { emaSample, flipLatch } from "../../../src/core/scale";

describe("flipLatch — 双条件闩锁翻转", () => {
  it("空闲时 trip 进入；无 trip 维持空闲", () => {
    expect(flipLatch(false, true, false, 0, 0, 0)).toBe(true);
    expect(flipLatch(false, false, false, 0, 0, 0)).toBe(false);
  });

  it("活跃时 release 退出；带内与 trip 均维持活跃", () => {
    expect(flipLatch(true, false, true, 0, 0, 0)).toBe(false);
    expect(flipLatch(true, false, false, 0, 0, 0)).toBe(true);
    expect(flipLatch(true, true, false, 0, 0, 0)).toBe(true);
  });

  it("双向最短保持：未满保持期不得翻转，满期且条件成立才翻", () => {
    expect(flipLatch(false, true, false, 1199, 1200, 0)).toBe(false);
    expect(flipLatch(false, true, false, 1200, 1200, 0)).toBe(true);
    expect(flipLatch(true, false, true, 1199, 0, 1200)).toBe(true);
    expect(flipLatch(true, false, true, 1200, 0, 1200)).toBe(false);
    expect(flipLatch(true, false, false, 5000, 0, 1200)).toBe(true);
    // 空闲态只由 trip 驱动，release 不参与判定
    expect(flipLatch(false, true, true, 5000, 1200, 1200)).toBe(true);
  });
});

describe("emaSample — 指数平滑", () => {
  it("首窗（undefined 或非法历史）直接取现值", () => {
    expect(emaSample(undefined, 42, 0.3)).toBe(42);
    expect(emaSample(Number.NaN, 42, 0.3)).toBe(42);
  });

  it("公式 = prev + α×(sample − prev)，等价于 prev×(1−α) + sample×α", () => {
    expect(emaSample(100, 0, 0.3)).toBe(70);
    expect(emaSample(100, 50, 0.1)).toBeCloseTo(95, 10);
    expect(emaSample(10, 10, 0.2)).toBe(10);
  });
});
