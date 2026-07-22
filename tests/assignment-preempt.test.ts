import { describe, expect, it } from "vitest";
import { shouldPreemptAssignments } from "../src/systems/assignment-service";

describe("assignment-service — shouldPreemptAssignments (P1-2 边沿触发)", () => {
  it("正常 → 紧急（上升沿）：触发抢占", () => {
    expect(shouldPreemptAssignments(true, false)).toBe(true);
  });

  it("持续紧急：不重复触发（避免每 tick 抖动）", () => {
    expect(shouldPreemptAssignments(true, true)).toBe(false);
  });

  it("持续正常：不触发", () => {
    expect(shouldPreemptAssignments(false, false)).toBe(false);
  });

  it("紧急 → 正常（下降沿）：不触发（恢复期不清空 assignment）", () => {
    expect(shouldPreemptAssignments(false, true)).toBe(false);
  });

  it("完整事件序列：一次紧急只触发一次", () => {
    // 模拟 tick 序列：正常 → 紧急 → 紧急 → 紧急 → 恢复 → 正常 → 再次紧急
    const sequence: [boolean, boolean][] = [
      [true, false],   // 进入紧急 → 触发
      [true, true],    // 持续 → 不触发
      [true, true],    // 持续 → 不触发
      [false, true],   // 恢复 → 不触发
      [false, false],  // 正常 → 不触发
      [true, false],   // 再次进入紧急 → 触发
    ];
    const expected = [true, false, false, false, false, true];
    const results = sequence.map(([e, w]) => shouldPreemptAssignments(e, w));
    expect(results).toEqual(expected);
    // 6 tick 中仅 2 次紧急事件 → 仅 2 次抢占。
    expect(results.filter(Boolean)).toHaveLength(2);
  });
});
