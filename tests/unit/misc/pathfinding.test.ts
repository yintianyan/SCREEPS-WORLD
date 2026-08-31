/** pathfinding 模块单元测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCoreCenter } from "../../../src/creeps/movement";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

/** 构建一个最小可用的 mock room，find 可被 spy 拦截。 */
function mockRoom(spawns: Array<{ pos: { x: number; y: number } }>): {
  room: Room;
  findSpy: ReturnType<typeof vi.fn>;
} {
  const findSpy = vi.fn((constant: number) => {
    if (constant === FIND_MY_SPAWNS) return spawns;
    return [];
  });
  const room = { find: findSpy } as unknown as Room;
  return { room, findSpy };
}

/** 将 mock room 注入 Game.rooms。 */
function registerRoom(roomName: string, room: Room): void {
  (globalThis as any).Game.rooms[roomName] = room;
}

describe("getCoreCenter — tick 级缓存", () => {
  it("首次调用执行 room.find 并返回 spawn 位置", () => {
    const { room, findSpy } = mockRoom([{ pos: { x: 25, y: 25 } }]);
    registerRoom("W1N1", room);

    const result = getCoreCenter("W1N1");

    expect(result).toEqual({ x: 25, y: 25 });
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith(FIND_MY_SPAWNS);
  });

  it("同 tick 多次调用只 find 一次（缓存命中）", () => {
    const { room, findSpy } = mockRoom([{ pos: { x: 30, y: 30 } }]);
    registerRoom("W1N1", room);

    // 模拟 10 个 creep 同 tick 调用 getCoreCenter。
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");
    getCoreCenter("W1N1");

    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it("跨 tick（Game.time 变化）后重新 find", () => {
    const { room, findSpy } = mockRoom([{ pos: { x: 10, y: 10 } }]);
    registerRoom("W1N1", room);

    // tick 1000（setup.ts 默认值）。
    getCoreCenter("W1N1");
    expect(findSpy).toHaveBeenCalledTimes(1);

    // 模拟下一 tick。
    (globalThis as any).Game.time = 1001;
    getCoreCenter("W1N1");
    expect(findSpy).toHaveBeenCalledTimes(2);

    // 同 tick 再次命中。
    getCoreCenter("W1N1");
    expect(findSpy).toHaveBeenCalledTimes(2);
  });

  it("空 spawns 返回 undefined", () => {
    const { room, findSpy } = mockRoom([]);
    registerRoom("W1N1", room);

    const result = getCoreCenter("W1N1");

    expect(result).toBeUndefined();
    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it("room 不可见（Game.rooms 缺失）返回 undefined", () => {
    // 不注册任何 room → Game.rooms["W2N2"] 为 undefined。
    const result = getCoreCenter("W2N2");

    expect(result).toBeUndefined();
  });

  it("不同房间独立缓存（per-room key）", () => {
    const { room: room1, findSpy: spy1 } = mockRoom([{ pos: { x: 10, y: 10 } }]);
    const { room: room2, findSpy: spy2 } = mockRoom([{ pos: { x: 40, y: 40 } }]);
    registerRoom("W1N1", room1);
    registerRoom("W2N2", room2);

    const r1 = getCoreCenter("W1N1");
    const r2 = getCoreCenter("W2N2");
    const r1Again = getCoreCenter("W1N1");
    const r2Again = getCoreCenter("W2N2");

    expect(r1).toEqual({ x: 10, y: 10 });
    expect(r2).toEqual({ x: 40, y: 40 });
    expect(r1Again).toEqual({ x: 10, y: 10 });
    expect(r2Again).toEqual({ x: 40, y: 40 });
    // 每个房间各自只 find 一次。
    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
  });

  it("global reset 后（缓存被清）重新 find", () => {
    const { room, findSpy } = mockRoom([{ pos: { x: 20, y: 20 } }]);
    registerRoom("W1N1", room);

    getCoreCenter("W1N1");
    expect(findSpy).toHaveBeenCalledTimes(1);

    // 模拟 global reset — resetGlobals 会重建 Game 对象（清空 rooms）+ 清除 __coreCenter。
    // 需要重新注册 room 才能验证"缓存被清后重新 find"的行为。
    resetGlobals();
    registerRoom("W1N1", room);

    // 验证缓存确实被清。
    const g = globalThis as any;
    expect(g.__coreCenter).toBeUndefined();

    // 再次调用会重新 find（因缓存已被清）。
    getCoreCenter("W1N1");
    expect(findSpy).toHaveBeenCalledTimes(2);
  });
});
