/** moveTowardRoom 跨房路由测试（R6b 扩张修复 Fix #2）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveTowardRoom } from "../../../src/creeps/movement/pathfinding";
import { mockCreep, mockPos, resetGlobals } from "../../support/factories";

function scoutIn(roomName: string, target: string, avoidRooms?: string[]): any {
  const creep = mockCreep({ role: "scout", home: "W7N4", mode: "acquire", pos: mockPos(25, 25, roomName) });
  creep.memory.remoteTarget = target;
  if (avoidRooms) creep.memory.avoidRooms = avoidRooms;
  creep.room = { name: roomName, findExitTo: vi.fn(() => 3), lookForAt: vi.fn(() => []) };
  return creep;
}

describe("moveTowardRoom — avoidRooms 跨房绕行", () => {
  beforeEach(() => resetGlobals());

  it("无 avoidRooms：几何出口，不调 findRoute", () => {
    const findRoute = vi.fn();
    (globalThis as any).Game.map.findRoute = findRoute;
    const creep = scoutIn("W7N4", "W8N4");

    moveTowardRoom(creep, "W8N4");

    expect(findRoute).not.toHaveBeenCalled();
    expect(creep.room.findExitTo).toHaveBeenCalledWith("W8N4");
  });

  it("有 avoidRooms：findRoute 选绕行首跳，routeCallback 隔离 hostile 途经房", () => {
    const findRoute = vi.fn(() => [{ exit: 1, room: "W7N3" }]);
    (globalThis as any).Game.map.findRoute = findRoute;
    const creep = scoutIn("W7N4", "W8N4", ["W8N4"]); // 几何最近出口会径直进 hostile W8N4

    moveTowardRoom(creep, "W8N4");

    expect(findRoute).toHaveBeenCalled();
    const cb = (findRoute as any).mock.calls[0][2].routeCallback;
    expect(cb("W8N4", "W7N4")).toBe(Infinity); // hostile 途经房 → 禁行
    expect(cb("W7N3", "W7N4")).toBe(1); // 干净房 → 正常成本
    expect(cb("W8N4", "")).toBe(1); // 起点房（fromRoomName 空）→ 不打惩罚
    // findExitTo 朝向绕行后的第一跳 W7N3，而非几何目标 W8N4。
    expect(creep.room.findExitTo).toHaveBeenCalledWith("W7N3");
  });

  it("findRoute 无路可绕（ERR_NO_PATH）→ 回退几何出口", () => {
    const findRoute = vi.fn(() => -2); // ERR_NO_PATH
    (globalThis as any).Game.map.findRoute = findRoute;
    const creep = scoutIn("W7N4", "W8N4", ["W8N4"]);

    moveTowardRoom(creep, "W8N4");

    expect(creep.room.findExitTo).toHaveBeenCalledWith("W8N4");
  });
});
