/** Attacker 角色行为测试（R3 战时闭环进攻执行端 + R4 波次集结）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attackerHold,
  attackerRole,
  markRetreat,
} from "../../../src/creeps/roles/attacker";
import { mockContext, mockCreep, mockPos, mockSnapshot, mockStructure, resetGlobals } from "../../support/factories";
import { CONFIG } from "../../../src/config";

beforeEach(() => {
  resetGlobals();
});

function enemyCreep(name = "enemy_1"): any {
  return { id: name, name, pos: mockPos(10, 10), owner: { username: "Enemy" } };
}

/** 目标房 room mock：find 按官方常量分派（值来自 setup.ts 注入的 SSOT，R20②）。 */
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

  it("同价值档残血结构优先（集火加速摧毁）", () => {
    const full = mockStructure("spawn", { id: "enemy_spawn_full", hits: 4000, hitsMax: 4000 });
    const damaged = mockStructure("spawn", { id: "enemy_spawn_dmg", hits: 1000, hitsMax: 4000 });
    const creep = attackerInTarget({ room: targetRoomMock([], [full, damaged]) });

    attackerRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.attack).toHaveBeenCalledWith(damaged);
  });
});

describe("attackerHold — R4 战备集结决策矩阵", () => {
  function setPlan(plan: any): void {
    (globalThis as any).Memory.kernel.warPlan = plan;
  }

  /** home 房 room mock（findExitTo 返回 -1：无出口，仅验证意图）。 */
  function homeRoomMock(): any {
    return { name: "W7N4", find: vi.fn(() => []), findExitTo: vi.fn(() => -1) };
  }

  it("无 warPlan → 不接管（false，正常管线）", () => {
    const creep = attackerInTarget({ room: homeRoomMock() });
    expect(attackerHold(creep, mockContext(mockSnapshot()))).toBe(false);
  });

  it("phase = advance → 不接管（整波推进中）", () => {
    setPlan({ targetRoom: "W6N4", sponsor: "W7N4", phase: "advance" });
    const creep = attackerInTarget({ room: homeRoomMock() });
    expect(attackerHold(creep, mockContext(mockSnapshot()))).toBe(false);
  });

  it("计划目标与己方 remoteTarget 不一致 → 不接管", () => {
    setPlan({ targetRoom: "W5N5", sponsor: "W7N4", phase: "build" });
    const creep = attackerInTarget({ room: homeRoomMock() });
    expect(attackerHold(creep, mockContext(mockSnapshot()))).toBe(false);
  });

  it("build + 在 home → 接管并停驻待命（不导航去目标房）", () => {
    setPlan({ targetRoom: "W6N4", sponsor: "W7N4", phase: "build" });
    const creep = attackerInTarget({ room: homeRoomMock() });

    expect(attackerHold(creep, mockContext(mockSnapshot()))).toBe(true);
    // 停驻（parkIdleCreep 对精简 room mock 无操作）— 关键断言：没有向目标房导航。
    expect(creep.room.findExitTo).not.toHaveBeenCalled();
    expect(creep.memory.recycle).toBeUndefined();
  });

  it("build + 在外（目标房/过境房）→ 接管并归建（向 home 移动）", () => {
    setPlan({ targetRoom: "W6N4", sponsor: "W7N4", phase: "build" });
    const creep = attackerInTarget({ room: targetRoomMock([], []) });
    creep.room.findExitTo = vi.fn(() => -1);

    expect(attackerHold(creep, mockContext(mockSnapshot()))).toBe(true);
    // 归建路径：向 home 房方向移动（本 mock 无出口，仅验证归建意图）。
    expect(creep.room.findExitTo).toHaveBeenCalledWith("W7N4");
  });

  it("build + 低血 → 标记回收并接管（归航由 spawn-manager 处理）", () => {
    setPlan({ targetRoom: "W6N4", sponsor: "W7N4", phase: "build" });
    const creep = attackerInTarget({ hits: 100, room: homeRoomMock() }); // 0.1 < 0.3

    expect(attackerHold(creep, mockContext(mockSnapshot()))).toBe(true);
    expect(creep.memory.recycle).toBe(true);
    // 低血先于移动决策：不导航、不归建。
    expect(creep.room.findExitTo).not.toHaveBeenCalled();
  });
});

describe("markRetreat — 低血撤退边界", () => {
  it("hits < hitsMax × retreatRatio → 标记回收", () => {
    const creep = attackerInTarget({ hits: 299 });
    expect(markRetreat(creep)).toBe(true);
    expect(creep.memory.recycle).toBe(true);
  });

  it("血量恰在撤退线上 → 不标记（严格小于）", () => {
    const creep = attackerInTarget({ hits: Math.floor(1000 * CONFIG.war.retreatRatio) });
    expect(markRetreat(creep)).toBe(false);
    expect(creep.memory.recycle).toBeUndefined();
  });
});