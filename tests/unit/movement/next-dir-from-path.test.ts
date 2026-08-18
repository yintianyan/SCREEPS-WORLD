/**
 * nextDirFromPath 单测 — 缓存路径提取下一步方向。
 *
 * 覆盖：
 *   - creep 在路径上 → 返回到下一格的方向；
 *   - 路径终点 / 跨房断点 → undefined；
 *   - 偏离路径且不相邻起点 → undefined；
 *   - 回归（修复橡皮筋 bug）：偏离路径但紧邻旧起点 path[0] → undefined（不再走向旧起点，
 *     否则 creep 被拉回旧起点→前进→再拉回 2-循环打转，线上 scout thrash 根因）。
 */
import { describe, expect, it } from "vitest";
import { nextDirFromPath } from "../../../src/creeps/movement/intent";

const R = "W7N4";

/** 极简 creep mock：pos 仅暴露 nextDirFromPath 用到的字段 + 一个有向 getDirectionTo。 */
function creepAt(x: number, y: number): any {
  return {
    room: { name: R },
    pos: {
      x,
      y,
      roomName: R,
      getDirectionTo: (tx: number, ty: number): number => {
        if (tx > x) return 3; // RIGHT
        if (tx < x) return 7; // LEFT
        if (ty > y) return 5; // BOTTOM
        return 1; // TOP
      },
    },
  };
}

/** 极简 RoomPosition-like 路点。 */
function pos(x: number, y: number, roomName: string = R): any {
  return { x, y, roomName };
}

describe("nextDirFromPath", () => {
  it("creep 在路径上 → 返回到下一格的方向", () => {
    const path = [pos(10, 10), pos(11, 10), pos(12, 10)];
    expect(nextDirFromPath(creepAt(10, 10), path)).toBe(3); // RIGHT → (11,10)
    expect(nextDirFromPath(creepAt(11, 10), path)).toBe(3); // RIGHT → (12,10)
  });

  it("creep 在路径终点 → 返回 undefined（终点/跨房断点）", () => {
    const path = [pos(10, 10), pos(11, 10), pos(12, 10)];
    expect(nextDirFromPath(creepAt(12, 10), path)).toBeUndefined();
  });

  it("creep 偏离路径且不相邻起点 → 返回 undefined", () => {
    const path = [pos(10, 10), pos(11, 10), pos(12, 10)];
    expect(nextDirFromPath(creepAt(20, 20), path)).toBeUndefined();
  });

  it("回归：偏离路径但紧邻旧起点 path[0] → undefined（不橡皮筋回旧起点）", () => {
    // 旧实现会走向 path[0]=(10,10)（TOP），造成「拉回旧起点→前进→再拉回」2-循环；
    // 修复后必须返回 undefined，让调用方从 creep 当前位置重算正确路径。
    const path = [pos(10, 10), pos(11, 10), pos(12, 10)];
    expect(nextDirFromPath(creepAt(10, 11), path)).toBeUndefined(); // (10,11) 紧邻 (10,10) 但不在路径上
  });

  it("跨房断点：下一格在另一房 → 返回 undefined", () => {
    // 下一格 (0,10,"W8N4") 与 creep 当前房 (W7N4) 不同 → 路径在此跨房，返回 undefined 交还调用方处理。
    const path = [pos(10, 10, R), pos(0, 10, "W8N4")];
    expect(nextDirFromPath(creepAt(10, 10), path)).toBeUndefined();
  });
});
