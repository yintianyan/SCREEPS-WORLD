/**
 * Scout 角色 + 侦察视野捕获测试（R6b 主动情报执行端）。
 *
 * 覆盖：
 *   - scout 站到目标房：无任何主动作（不攻击/不采集），纯站桩提供视野
 *   - 在 home/过境：ensureHome 导航向 remoteTarget（findExitTo 被调用）
 *   - room-observer 的 captureScoutVision：prospect 任务存续期间，
 *     scout 所在目标房的 sources/owner 写入 sponsor intel（决策就绪情报）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoutRole } from "../../../src/creeps/roles/scout";
import { roomObserverSystem } from "../../../src/systems/room-observer";
import { mockContext, mockCreep, mockPos, mockSnapshot, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

function makeScout(roomName: string): any {
  const creep = mockCreep({
    name: "scout_1",
    role: "scout",
    mode: "acquire",
    home: "W7N4",
    used: 0,
    capacity: 0,
    pos: mockPos(25, 25, roomName),
  });
  creep.memory.remoteTarget = "W6N4";
  creep.room = {
    name: roomName,
    findExitTo: vi.fn(() => -1),
    find: vi.fn(() => []),
  };
  return creep;
}

describe("scout 角色 — 执行端行为", () => {
  it("站到目标房：无主动作（纯站桩提供视野）", () => {
    const creep = makeScout("W6N4"); // 已在目标房

    scoutRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.attack).not.toHaveBeenCalled();
    expect(creep.move).not.toHaveBeenCalled();
    expect(creep.memory.recycle).toBeUndefined(); // 收摊由 prospect-manager 判定
  });

  it("在 home（未出发）：ensureHome 导航向目标房（findExitTo 被调用）", () => {
    const creep = makeScout("W7N4");

    scoutRole.run(creep, mockContext(mockSnapshot()));

    // 归建/出发导航：向 remoteTarget 方向移动（mock 无出口，仅验证意图）。
    expect(creep.room.findExitTo).toHaveBeenCalledWith("W6N4");
  });
});

describe("room-observer — 侦察视野捕获（R6b 接线）", () => {
  it("prospect 任务存续 + scout 在目标房 → intel 落库（sources/owner/towers）", () => {
    (globalThis as any).Memory.kernel = {
      prospect: { target: "W6N4", sponsor: "W7N4", startedAt: 900, spawned: 1 },
    };
    (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: [], buildQueue: [], intel: {} };

    // 目标房可见（scout 视野）：2 source + 1 敌方 tower + 无主。
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true }, find: vi.fn(() => []) },
      W6N4: {
        controller: {},
        find: vi.fn((kind: number) => {
          if (kind === FIND_SOURCES) return [1, 2];
          if (kind === FIND_MINERALS) return [];
          if (kind === FIND_HOSTILE_STRUCTURES) {
            return [{ structureType: STRUCTURE_TOWER }];
          }
          return [];
        }),
      },
    };
    (globalThis as any).Game.map = {
      describeExits: () => null, // 短路邻房扫描，聚焦视野捕获路径
      getRoomStatus: () => ({ status: "normal" }),
    };
    const creep = makeScout("W6N4");
    (globalThis as any).Game.creeps = { scout_1: creep };

    roomObserverSystem.run(mockContext(mockSnapshot()));

    const intel = (globalThis as any).Memory.rooms.W7N4.intel.W6N4;
    expect(intel).toBeDefined();
    expect(intel.sources).toBe(2);
    expect(intel.towers).toBe(1);
    expect(intel.owner).toBeUndefined();
  });

  it("无 prospect 任务 → 不扫描（零开销守卫）", () => {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Game.creeps = {};
    (globalThis as any).Game.map = {
      describeExits: () => null,
      getRoomStatus: () => ({ status: "normal" }),
    };

    expect(() => roomObserverSystem.run(mockContext(mockSnapshot()))).not.toThrow();
  });
});
