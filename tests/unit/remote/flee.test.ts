/**
 * 远矿威胁检测测试。
 *
 * 覆盖：shouldFleeForeignRoom 触发条件（含 transit 中间房）、getRoomThreats 缓存、fleeToHome 行为。
 *
 * 修复背景：旧 shouldRemoteFlee 仅在 creep.room.name === remoteTarget 时检测威胁，
 * 导致远矿角色在 home ↔ remoteTarget 的过境中间房遇袭不逃跑（transit 盲区）。
 * 泛化后的 shouldFleeForeignRoom 对任意「非 home 房」扫描当前房敌人。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldFleeForeignRoom, fleeToHome } from "../../../src/creeps/engine/lifecycle";
import { resetGlobals, mockPos, mockCreep } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 构建一个返回指定 hostile 列表的 room mock，并注册到 Game.rooms（getRoomThreats 读 Game.rooms）。 */
function roomWithHostiles(roomName: string, hostiles: unknown[]) {
  const room = {
    name: roomName,
    find: vi.fn((_type: number, opts?: any) => {
      if (opts?.filter) return hostiles.filter(opts.filter);
      return hostiles;
    }),
  };
  (globalThis as any).Game.rooms[roomName] = room;
  return room;
}

describe("remote flee — shouldFleeForeignRoom", () => {
  it("无 remoteTarget 时返回 false（本地角色不走此路径）", () => {
    const creep = mockCreep({ role: "harvester", home: "W1N1" });
    expect(shouldFleeForeignRoom(creep)).toBe(false);
  });

  it("在 home 房时返回 false（交由 shouldFlee 的 home snapshot 处理）", () => {
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: mockPos(25, 25, "W1N1"), // 在 home 房
    });
    creep.memory.remoteTarget = "W2N1";
    expect(shouldFleeForeignRoom(creep)).toBe(false);
  });

  it("在 remoteTarget 房且无敌人时返回 false", () => {
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: mockPos(25, 25, "W2N1"),
    });
    creep.memory.remoteTarget = "W2N1";
    creep.room = roomWithHostiles("W2N1", []);
    expect(shouldFleeForeignRoom(creep)).toBe(false);
  });

  it("在 remoteTarget 房且有威胁 creep 在范围内时返回 true", () => {
    const hostile = {
      pos: mockPos(26, 25, "W2N1"),
      owner: { username: "enemy" },
      body: [{ type: "attack" }],
    };
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: mockPos(25, 25, "W2N1"),
    });
    creep.memory.remoteTarget = "W2N1";
    creep.room = roomWithHostiles("W2N1", [hostile]);
    expect(shouldFleeForeignRoom(creep)).toBe(true);
  });

  // ── 核心修复：transit 中间房盲区 ──
  it("在 transit 中间房（非 remoteTarget 非 home）遇威胁时返回 true", () => {
    // creep 从 home W1N1 去 remoteTarget W3N1，途经 W2N1 遇袭。
    const hostile = {
      pos: mockPos(26, 25, "W2N1"),
      owner: { username: "enemy" },
      body: [{ type: "attack" }],
    };
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: mockPos(25, 25, "W2N1"), // 在中间房 W2N1，既非 home 也非 remoteTarget
    });
    creep.memory.remoteTarget = "W3N1";
    creep.room = roomWithHostiles("W2N1", [hostile]);
    // 旧实现：creep.room.name (W2N1) !== remoteTarget (W3N1) → 返回 false（盲区）。
    // 新实现：W2N1 非 home → 扫描当前房 → 有威胁 → true。
    expect(shouldFleeForeignRoom(creep)).toBe(true);
  });

  it("在 remoteTarget 房但威胁 creep 在范围外时返回 false", () => {
    const hostile = {
      pos: { ...mockPos(40, 40, "W2N1"), getRangeTo: vi.fn(() => 20) },
      owner: { username: "enemy" },
      body: [{ type: "attack" }],
    };
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: { ...mockPos(25, 25, "W2N1"), getRangeTo: vi.fn(() => 20) },
    });
    creep.memory.remoteTarget = "W2N1";
    creep.room = roomWithHostiles("W2N1", [hostile]);
    expect(shouldFleeForeignRoom(creep)).toBe(false);
  });

  it("无攻击部件的过境 creep 不触发逃跑", () => {
    const scout = {
      pos: mockPos(26, 25, "W2N1"),
      owner: { username: "traveler" },
      body: [{ type: "move" }],
    };
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: mockPos(25, 25, "W2N1"),
    });
    creep.memory.remoteTarget = "W2N1";
    creep.room = roomWithHostiles("W2N1", [scout]);
    expect(shouldFleeForeignRoom(creep)).toBe(false);
  });
});

describe("remote flee — fleeToHome", () => {
  it("释放 assignment 并向 home 移动", () => {
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: mockPos(25, 25, "W2N1"),
    });
    creep.memory.remoteTarget = "W2N1";
    creep.memory.assignment = { id: "test", kind: "harvest" };
    creep.room = {
      name: "W2N1",
      findExitTo: vi.fn(() => 3), // FIND_EXIT_RIGHT
      find: vi.fn(() => []),
    };
    creep.pos.findClosestByRange = vi.fn(() => mockPos(49, 25, "W2N1"));
    creep.moveTo = vi.fn(() => OK);

    fleeToHome(creep);
    expect(creep.memory.assignment).toBeUndefined();
  });

  it("在 home 房时不调用 moveTowardRoom", () => {
    const creep = mockCreep({
      role: "remoteHarvester",
      home: "W1N1",
      pos: mockPos(25, 25, "W1N1"),
    });
    creep.memory.remoteTarget = "W2N1";
    creep.room = { name: "W1N1" };

    // fleeToHome 只在 creep.room.name !== home 时 moveTowardRoom，不应抛错。
    expect(() => fleeToHome(creep)).not.toThrow();
    expect(creep.memory.assignment).toBeUndefined();
  });
});
