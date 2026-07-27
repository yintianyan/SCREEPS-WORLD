import { describe, expect, it } from "vitest";
import { shouldPreemptAssignments } from "../../../src/systems/assignment-service";

describe("assignment-service — shouldPreemptAssignments (P1-2 边沿触发)", () => {
  it("正常 → 紧急（上升沿）：触发抢占（首次无冷却）", () => {
    expect(shouldPreemptAssignments(true, false, undefined, 100)).toBe(true);
  });

  it("持续紧急：不重复触发（避免每 tick 抖动）", () => {
    expect(shouldPreemptAssignments(true, true, undefined, 100)).toBe(false);
  });

  it("持续正常：不触发", () => {
    expect(shouldPreemptAssignments(false, false, undefined, 100)).toBe(false);
  });

  it("紧急 → 正常（下降沿）：不触发（恢复期不清空 assignment）", () => {
    expect(shouldPreemptAssignments(false, true, undefined, 100)).toBe(false);
  });

  it("完整事件序列：一次紧急只触发一次", () => {
    // 模拟 tick 序列：正常 → 紧急 → 紧急 → 紧急 → 恢复 → 正常 → 再次紧急
    // lastPreemptTick 设为 undefined 表示首次或已过冷却期
    const sequence: [boolean, boolean, number | undefined, number][] = [
      [true, false, undefined, 100],   // 进入紧急 → 触发
      [true, true, undefined, 101],    // 持续 → 不触发
      [true, true, undefined, 102],    // 持续 → 不触发
      [false, true, undefined, 103],   // 恢复 → 不触发
      [false, false, undefined, 104],  // 正常 → 不触发
      [true, false, undefined, 105],   // 再次进入紧急 → 触发（无冷却限制）
    ];
    const expected = [true, false, false, false, false, true];
    const results = sequence.map(([e, w, l, t]) => shouldPreemptAssignments(e, w, l, t));
    expect(results).toEqual(expected);
    // 6 tick 中仅 2 次紧急事件 → 仅 2 次抢占。
    expect(results.filter(Boolean)).toHaveLength(2);
  });
});

describe("assignment-service — shouldPreemptAssignments (TD-018 冷却机制)", () => {
  it("首次抢占不受冷却影响（lastPreemptTick 为 undefined）", () => {
    // 上升沿 + 无历史记录 → 必须触发
    expect(shouldPreemptAssignments(true, false, undefined, 500)).toBe(true);
  });

  it("抢占后 20 tick 内不再触发（冷却期内）", () => {
    // 上次抢占在 tick 100，当前 tick 110（间隔 10 < 20）
    expect(shouldPreemptAssignments(true, false, 100, 110)).toBe(false);
    // 当前 tick 119（间隔 19 < 20）
    expect(shouldPreemptAssignments(true, false, 100, 119)).toBe(false);
  });

  it("抢占后恰好 20 tick 可以再次触发（冷却边界）", () => {
    // 上次抢占在 tick 100，当前 tick 120（间隔 20，恰好满足 >= 20）
    expect(shouldPreemptAssignments(true, false, 100, 120)).toBe(true);
  });

  it("抢占后超过 20 tick 可以再次触发（冷却期后）", () => {
    // 上次抢占在 tick 100，当前 tick 150（间隔 50 > 20）
    expect(shouldPreemptAssignments(true, false, 100, 150)).toBe(true);
  });

  it("冷却期内即使上升沿也不触发（快速交替场景）", () => {
    // 模拟：tick 100 触发抢占 → tick 105 紧急缓解 → tick 108 再次紧急（上升沿）
    // 由于距上次抢占仅 8 tick，冷却期内不触发
    expect(shouldPreemptAssignments(true, false, 100, 108)).toBe(false);
  });

  it("冷却期后快速交替可再次触发", () => {
    // 上次抢占在 tick 100，tick 120 时再次出现上升沿（已过冷却期）
    expect(shouldPreemptAssignments(true, false, 100, 120)).toBe(true);
  });

  it("持续紧急期间冷却不生效（边沿优先）", () => {
    // wasEmergency=true 时即使冷却期已过也不触发（边沿检测优先于冷却）
    expect(shouldPreemptAssignments(true, true, 100, 200)).toBe(false);
  });
});
