/** 敌方 reservation 运行时退出接线测试（组①-1c）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { mockContext, mockCreep, mockSnapshot, resetGlobals, syncSquadIndex } from "../../role-helpers";

const targetRoom = "W2N1";
const homeRoom = "W7N4"; // 与 mockSnapshot 默认 roomName 对齐。

/** 远矿房 mock：controller 被指定玩家预定，find 一律返回空（无核心/无敌 creep）。 */
function makeReservedRoom(name: string, reserverName: string) {
  return {
    name,
    find: vi.fn(() => []),
    controller: { reservation: { username: reserverName }, pos: { x: 25, y: 25 } },
  };
}

/** 己方房 snapshot，controller.owner 设为本帝国用户名（myUsername 来源）。 */
function ownedSnapshot(myName: string) {
  const base = mockSnapshot({ rcl: 5, spawns: [{} as never] });
  return {
    ...base,
    controller: { ...(base.controller as object), owner: { username: myName } },
  } as never;
}

function seedMemory(now: number) {
  const g = globalThis as any;
  g.Memory.rooms[homeRoom] = {
    colonyState: "normal",
    spawnQueue: [],
    remoteOps: {
      [targetRoom]: { state: "active", sources: 2, haulerNeed: 2, createdAt: now - 500, lastSeen: now },
    },
    intel: {
      [targetRoom]: { kind: "normal", status: "normal", lastSeen: now },
    },
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("remote-mining-manager — 敌方 reservation 运行时退出", () => {
  it("敌方预定 → 废弃运营 + 写 dangerUntil + 回收现役 creep", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;

    g.Game.rooms[targetRoom] = makeReservedRoom(targetRoom, "enemyPlayer");
    const reserver = mockCreep({ name: "rs1", role: "reserver", home: homeRoom });
    reserver.memory.remoteTarget = targetRoom;
    g.Game.creeps = { rs1: reserver };
    syncSquadIndex();

    seedMemory(now);
    remoteMiningManagerSystem.run(mockContext(ownedSnapshot("me")));

    const roomMem = g.Memory.rooms[homeRoom];
    expect(roomMem.remoteOps[targetRoom].state).toBe("abandoned");
    // P1-G：dangerUntil 迁至 remoteOps（remote-mining-manager 唯一写入）。
    expect(roomMem.remoteOps[targetRoom].dangerUntil).toBeGreaterThan(now);
    expect(reserver.memory.recycle).toBe(true);
  });

  it("己方续期（reservation === myUsername）不触发退出", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;

    g.Game.rooms[targetRoom] = makeReservedRoom(targetRoom, "me");
    seedMemory(now);
    remoteMiningManagerSystem.run(mockContext(ownedSnapshot("me")));

    const roomMem = g.Memory.rooms[homeRoom];
    // 己方预定不应废弃运营，也不写危险冷却。
    expect(roomMem.remoteOps[targetRoom].state).toBe("active");
    expect(roomMem.remoteOps[targetRoom].dangerUntil).toBeUndefined();
  });

  it("Invader NPC 预定不是玩家争矿 — 不废弃（交给核心分类链）", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;

    g.Game.rooms[targetRoom] = makeReservedRoom(targetRoom, "Invader");
    seedMemory(now);
    remoteMiningManagerSystem.run(mockContext(ownedSnapshot("me")));

    const roomMem = g.Memory.rooms[homeRoom];
    expect(roomMem.remoteOps[targetRoom].state).toBe("active");
    expect(roomMem.remoteOps[targetRoom].dangerUntil).toBeUndefined();
  });
});
