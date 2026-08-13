/**
 * Attacker 角色行为测试（R3 战时闭环进攻执行端）。
 *
 * 覆盖：
 *   - 目标房内有敌守军 → 攻击最近的敌 creep
 *   - 目标房内无守军但有敌结构 → 攻击高值结构（spawn/tower 优先于 rampart）
 *   - 低血（< 30% hitsMax）→ 标记 recycle 撤退，不再攻击
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attackerRole } from "../../../src/creeps/roles/attacker";
import { mockContext, mockCreep, mockPos, mockSnapshot, mockStructure, resetGlobals } from "../../role-helpers";

const FIND_HOSTILE_CREEPS = 4;
const FIND_HOSTILE_STRUCTURES = 109;

beforeEach(() => {
  resetGlobals();
});

function enemyCreep(name = "enemy_1"): any {
  return { id: name, name, pos: mockPos(10, 10), owner: { username: "Enemy" } };
}

/** 目标房 room mock：find 按常量分派。 */
function targetRoomMock(hostiles: any[], structs: any[]): any {
  return {
    name: "W6N4",
    find: vi.fn((kind: number) => {
      if (kind === FIND_HOSTILE_CREEPS) return hostiles;
      if (kind === FIND_HOSTILE_STRUCTURES) return structs;
      return [];
    }),
  };
}

/** 构造已到达 war 目标房（W6N4）的 attacker。hits 可选覆盖。 */
function attackerInTarget(overrides: { hits?: number; room?: any } = {}): any {
  const creep = mockCreep({
    name: "attacker_1",
    role: "attacker",
    mode: "acquire",
    home: "W7N4",
    used: 0,
    capacity: 0,
    pos: mockPos(25, 25, "W6N4"),
  });
  creep.memory.remoteTarget = "W6N4";
  if (overrides.hits !== undefined) creep.hits = overrides.hits;
  creep.room = overrides.room ?? targetRoomMock([], []);
  return creep;
}

describe("attacker 角色", () => {
  it("目标房内有敌守军 → 攻击最近的敌 creep", () => {
    const enemy = enemyCreep();
    const creep = attackerInTarget({ room: targetRoomMock([enemy], []) });

    attackerRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.attack).toHaveBeenCalledWith(enemy);
  });

  it("目标房内无守军但有敌结构 → 攻击高值结构（spawn 优先于 rampart）", () => {
    const spawn = mockStructure("spawn", { id: "enemy_spawn", energy: 0 });
    const rampart = mockStructure("rampart", { id: "enemy_ramp", energy: 0 });
    const creep = attackerInTarget({ room: targetRoomMock([], [spawn, rampart]) });

    attackerRole.run(creep, mockContext(mockSnapshot()));

    // spawn 价值档 4 > rampart 档 1 → 打 spawn。
    expect(creep.attack).toHaveBeenCalledWith(spawn);
  });

  it("低血（< 30% hitsMax）→ 标记 recycle 撤退，不再攻击", () => {
    const enemy = enemyCreep();
    const creep = attackerInTarget({ hits: 200, room: targetRoomMock([enemy], []) });

    attackerRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.memory.recycle).toBe(true);
    expect(creep.attack).not.toHaveBeenCalled();
  });

  it("目标房无可攻击目标（无守军无结构）→ 待命不攻击", () => {
    const creep = attackerInTarget({ room: targetRoomMock([], []) });

    attackerRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.attack).not.toHaveBeenCalled();
    // 未触发回收 — 只是无目标待命。
    expect(creep.memory.recycle).toBeUndefined();
  });
});