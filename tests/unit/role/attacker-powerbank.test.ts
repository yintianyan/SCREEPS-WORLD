/**
 * Attacker PB 分流测试（审计缺口 2 角色层）。
 *
 * 覆盖：
 *   - mission="powerBank" + 在目标房 + 房内有 PB → attack PB（hostile 链打不到）
 *   - mission="powerBank" → hold 钩子不集结（warPlan build 相位也放行）
 *   - 无 mission（war 编队）→ attackPowerBank 不激活，走常规 hostile 链
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attackerRole, attackerHold } from "../../../src/creeps/roles/attacker";
import { mockContext, mockCreep, mockSnapshot, resetGlobals } from "../../role-helpers";

const homeRoom = "W7N4";
const targetRoom = "W2N1";

function makePbRoom(): any {
  const pb = { id: "pb1", structureType: "powerBank", pos: { x: 25, y: 25, roomName: targetRoom } };
  return {
    name: targetRoom,
    find: vi.fn((t: number) => {
      if (t === FIND_STRUCTURES) return [pb];
      if (t === FIND_HOSTILE_CREEPS) return [];
      if (t === FIND_HOSTILE_STRUCTURES) return [];
      return [];
    }),
  };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  delete (globalThis as any).__powerBanks;
});

describe("attacker — PB 野采分流", () => {
  it("mission=powerBank + 在目标房 + 有 PB → attack PB", () => {
    const creep = mockCreep({ name: "attacker-1", role: "attacker" });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mission = "powerBank";
    creep.pos = {
      x: 24, y: 25, roomName: targetRoom,
      getRangeTo: vi.fn(() => 1),
      getDirectionTo: vi.fn(() => 3),
    };
    creep.room = makePbRoom();

    attackerRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.attack).toHaveBeenCalledWith(
      expect.objectContaining({ structureType: "powerBank" }),
    );
  });

  it("mission=powerBank → hold 不集结（warPlan build 相位也放行）", () => {
    (globalThis as any).Memory.kernel = {
      warPlan: { targetRoom: "W9N9", sponsor: homeRoom, squadSize: 3, since: 1000, towersSeen: 0, phase: "build" },
    };
    const creep = mockCreep({ name: "attacker-1", role: "attacker" });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mission = "powerBank";

    // hold 返回 false = 不接管（正常管线推进）。
    expect(attackerHold(creep, mockContext(mockSnapshot({ roomName: homeRoom })))).toBe(false);
  });

  it("无 mission（war 编队）→ attackPowerBank 不激活（不误打中立结构）", () => {
    const creep = mockCreep({ name: "attacker-1", role: "attacker" });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.pos = {
      x: 24, y: 25, roomName: targetRoom,
      getRangeTo: vi.fn(() => 1),
      getDirectionTo: vi.fn(() => 3),
    };
    creep.room = makePbRoom();

    attackerRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    // war 语义：不打中立 PB（attack 只可能针对 hostile —— 本房无 hostile 即无调用）。
    expect(creep.attack).not.toHaveBeenCalledWith(
      expect.objectContaining({ structureType: "powerBank" }),
    );
  });
});
