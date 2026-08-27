/** P1-4 findReplacementForDeadLink 单测（staged link 拆改）。 */
import { describe, expect, it, beforeEach } from "vitest";
import { findReplacementForDeadLink } from "../../../src/systems/layout-planner";
import type { RoomSnapshot } from "../../../src/kernel/contracts";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 构造最小 RoomSnapshot（findReplacementForDeadLink 只用 sources + links）。 */
function makeSnapshot(sources: { x: number; y: number }[], links: { id: string; pos: { x: number; y: number } }[] = []): RoomSnapshot {
  return {
    roomName: "W7N4",
    sources: sources.map((s, i) => ({ id: `source${i}` as Id<Source>, pos: { x: s.x, y: s.y, roomName: "W7N4" } })),
    links: links.map(l => ({ id: l.id as Id<StructureLink>, pos: { x: l.pos.x, y: l.pos.y, roomName: "W7N4" }, store: { getUsedCapacity: () => 0, getFreeCapacity: () => 800, getCapacity: () => 800 } as any })),
  } as unknown as RoomSnapshot;
}

/** 构造 link build task。 */
function makeLinkTask(key: string, x: number, y: number, state: BuildTask["state"] = "queued"): BuildTask {
  return {
    key,
    pos: { x, y, roomName: "W7N4" },
    structureType: STRUCTURE_LINK,
    priority: 1,
    state,
    attempts: 0,
    retryAt: 0,
  };
}

describe("P1-4 findReplacementForDeadLink — 替代任务关联", () => {
  it("死 link 紧邻 source，queue 中有紧邻同一 source 的 queued link 任务 → 返回该任务", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 11, y: 10 } }; // 紧邻 source
    const snapshot = makeSnapshot([source], [deadLink]);
    const replacement = makeLinkTask("logistics.link.source.source0", 10, 11); // 紧邻同一 source，不同位置
    const result = findReplacementForDeadLink(deadLink, snapshot, [replacement]);
    expect(result).toBe(replacement);
  });

  it("queue 中有 done 状态的 link 任务 → 不匹配（只找 queued）", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 11, y: 10 } };
    const snapshot = makeSnapshot([source], [deadLink]);
    const doneTask = makeLinkTask("key1", 10, 11, "done");
    const result = findReplacementForDeadLink(deadLink, snapshot, [doneTask]);
    expect(result).toBeUndefined();
  });

  it("queue 中有非 link 任务紧邻同一 source → 不匹配", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 11, y: 10 } };
    const snapshot = makeSnapshot([source], [deadLink]);
    const roadTask: BuildTask = {
      key: "road1",
      pos: { x: 10, y: 11, roomName: "W7N4" },
      structureType: STRUCTURE_ROAD,
      priority: 1,
      state: "queued",
      attempts: 0,
      retryAt: 0,
    };
    const result = findReplacementForDeadLink(deadLink, snapshot, [roadTask]);
    expect(result).toBeUndefined();
  });

  it("queue 中 link 任务紧邻不同 source → 不匹配", () => {
    const source1 = { x: 10, y: 10 };
    const source2 = { x: 30, y: 30 };
    const deadLink = { id: "deadLink1", pos: { x: 11, y: 10 } }; // 紧邻 source1
    const snapshot = makeSnapshot([source1, source2], [deadLink]);
    const otherSourceTask = makeLinkTask("key2", 31, 30); // 紧邻 source2
    const result = findReplacementForDeadLink(deadLink, snapshot, [otherSourceTask]);
    expect(result).toBeUndefined();
  });

  it("死 link 不紧邻任何 source → 返回 undefined", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 40, y: 40 } }; // 远离 source
    const snapshot = makeSnapshot([source], [deadLink]);
    const task = makeLinkTask("key1", 11, 10);
    const result = findReplacementForDeadLink(deadLink, snapshot, [task]);
    expect(result).toBeUndefined();
  });

  it("queue 为空 → 返回 undefined", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 11, y: 10 } };
    const snapshot = makeSnapshot([source], [deadLink]);
    const result = findReplacementForDeadLink(deadLink, snapshot, []);
    expect(result).toBeUndefined();
  });

  it("多个 queued link 任务紧邻同一 source → 返回第一个匹配", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 11, y: 10 } };
    const snapshot = makeSnapshot([source], [deadLink]);
    const task1 = makeLinkTask("key1", 10, 11);
    const task2 = makeLinkTask("key2", 9, 10);
    const result = findReplacementForDeadLink(deadLink, snapshot, [task1, task2]);
    expect(result).toBe(task1);
  });

  it("range 边界：source 和 link 对角相邻（dx=1, dy=1）→ 匹配", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 11, y: 11 } }; // 对角相邻
    const snapshot = makeSnapshot([source], [deadLink]);
    const replacement = makeLinkTask("key1", 10, 11); // 紧邻同一 source
    const result = findReplacementForDeadLink(deadLink, snapshot, [replacement]);
    expect(result).toBe(replacement);
  });

  it("range 边界：source 和 link 相距 2 格 → 不匹配（range > 1）", () => {
    const source = { x: 10, y: 10 };
    const deadLink = { id: "deadLink1", pos: { x: 12, y: 10 } }; // 相距 2 格
    const snapshot = makeSnapshot([source], [deadLink]);
    const task = makeLinkTask("key1", 10, 11);
    const result = findReplacementForDeadLink(deadLink, snapshot, [task]);
    expect(result).toBeUndefined();
  });
});
