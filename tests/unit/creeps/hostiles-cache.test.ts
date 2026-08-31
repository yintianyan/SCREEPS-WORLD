/** getHostilesCached — per-tick per-room hostile 缓存测试（P1-C）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHostilesCached } from "../../../src/creeps/support/targeting";
import { resetGlobals } from "../../support/factories";

const targetRoom = "W2N1";

function makeHostile(username: string): Creep {
  return { owner: { username } } as unknown as Creep;
}

function roomWithFind(findFn: ReturnType<typeof vi.fn>): Room {
  return { name: targetRoom, find: findFn } as unknown as Room;
}

beforeEach(() => {
  resetGlobals();
});

describe("getHostilesCached — per-tick per-room 缓存", () => {
  it("同 tick 同房两次调用返回同一数组引用（缓存命中）", () => {
    const hostiles = [makeHostile("enemy1"), makeHostile("enemy2")];
    const findFn = vi.fn(() => hostiles);
    (globalThis as any).Game.rooms[targetRoom] = roomWithFind(findFn);

    const first = getHostilesCached(Game.rooms[targetRoom] as Room);
    const second = getHostilesCached(Game.rooms[targetRoom] as Room);

    // 同一数组引用 — 缓存命中
    expect(second).toBe(first);
    // find 只调用一次 — 第二次走缓存
    expect(findFn).toHaveBeenCalledTimes(1);
  });

  it("tick 推进后缓存失效，重新 find（返回新数组）", () => {
    const tick1Hostiles = [makeHostile("enemy1")];
    const tick2Hostiles = [makeHostile("enemy1"), makeHostile("enemy2")];
    const findFn = vi.fn(() => tick1Hostiles);
    (globalThis as any).Game.rooms[targetRoom] = roomWithFind(findFn);

    // tick 1000（resetGlobals 默认）
    const first = getHostilesCached(Game.rooms[targetRoom] as Room);
    expect(first).toBe(tick1Hostiles);
    expect(findFn).toHaveBeenCalledTimes(1);

    // 推进 tick
    (globalThis as any).Game.time = 1001;
    findFn.mockReturnValue(tick2Hostiles);

    const second = getHostilesCached(Game.rooms[targetRoom] as Room);
    // 新 tick → 缓存失效 → 重新 find
    expect(second).toBe(tick2Hostiles);
    expect(second).not.toBe(first);
    expect(findFn).toHaveBeenCalledTimes(2);
  });

  it("不同房间独立缓存（不互相干扰）", () => {
    const roomA = { name: "W1N1", find: vi.fn(() => [makeHostile("a")]) } as unknown as Room;
    const roomB = { name: "W2N2", find: vi.fn(() => [makeHostile("b")]) } as unknown as Room;
    (globalThis as any).Game.rooms["W1N1"] = roomA;
    (globalThis as any).Game.rooms["W2N2"] = roomB;

    const a = getHostilesCached(roomA);
    const b = getHostilesCached(roomB);

    expect(a).not.toBe(b);
    expect(a[0]!.owner.username).toBe("a");
    expect(b[0]!.owner.username).toBe("b");
    expect((roomA.find as any)).toHaveBeenCalledTimes(1);
    expect((roomB.find as any)).toHaveBeenCalledTimes(1);
  });
});
