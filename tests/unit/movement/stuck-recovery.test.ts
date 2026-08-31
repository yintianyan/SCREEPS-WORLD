/** 卡位检测测试 — updateStuckTicks 的疲劳豁免（MV-1 / G-MV-06 / G-MEM-07）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { updateStuckTicks } from "../../../src/creeps/movement";
import { resetGlobals } from "../../support/factories";

/** 最小 creep mock — updateStuckTicks 只读 fatigue/pos/memory。 */
function makeCreep(x: number, y: number, fatigue: number, memory: Record<string, unknown> = {}): Creep {
  return { fatigue, pos: { x, y }, memory } as unknown as Creep;
}

beforeEach(() => {
  resetGlobals();
});

describe("updateStuckTicks — 疲劳豁免（G-MV-06/G-MEM-07）", () => {
  it("疲劳期位置不变：stuckTicks 不递增（不是卡位）", () => {
    const memory = { lastPos: 25 * 50 + 25, stuckTicks: 1 };
    const creep = makeCreep(25, 25, 4, memory);

    expect(updateStuckTicks(creep)).toBe(1);
    expect(memory.stuckTicks).toBe(1); // 不增
  });

  it("疲劳期也不归零已有计数（恢复移动前保留卡位历史）", () => {
    const memory = { lastPos: 20 * 50 + 20, stuckTicks: 2 };
    // 位置已变化（上 tick 挪动过），本 tick 疲劳 — 计数保持，不被清零。
    const creep = makeCreep(21, 20, 8, memory);

    expect(updateStuckTicks(creep)).toBe(2);
    expect(memory.stuckTicks).toBe(2);
  });

  it("无疲劳且位置不变：正常递增（卡位检测不被削弱）", () => {
    const memory = { lastPos: 25 * 50 + 25, stuckTicks: 1 };
    const creep = makeCreep(25, 25, 0, memory);

    expect(updateStuckTicks(creep)).toBe(2);
  });

  it("无疲劳且位置变化：归零", () => {
    const memory = { lastPos: 25 * 50 + 25, stuckTicks: 3 };
    const creep = makeCreep(26, 25, 0, memory);

    expect(updateStuckTicks(creep)).toBe(0);
    expect(memory.lastPos).toBe(26 * 50 + 25);
  });

  it("连续疲劳等待多 tick 不会累积到 Level 3 阈值（沼泽满载场景）", () => {
    const memory = { lastPos: 25 * 50 + 25, stuckTicks: 0 };
    // 满载 creep 在沼泽疲劳等待 6 tick — 修复前会累积到 4+ 触发弃目标。
    for (let i = 0; i < 6; i++) {
      const creep = makeCreep(25, 25, 30, memory);
      updateStuckTicks(creep);
    }
    expect(memory.stuckTicks).toBe(0);
  });
});
