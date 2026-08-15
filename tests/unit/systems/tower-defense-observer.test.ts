/**
 * 塔防侦察兵修复测试（R7c）— 满能量塔对贴身侦察兵不开火的根因与修复。
 *
 * 根因：无害敌对（无威胁部件）在场时，塔防走维修分支，显式 tower.repair
 * 占用塔的本 tick 动作 → 引擎的自动攻击被抑制 → 侦察兵贴着满能量塔穿行。
 * 修复：无害敌对在场时塔不接任何任务，放空动作让引擎自动点杀。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { towerDefenseSystem } from "../../../src/systems/tower-defense";
import { mockContext, mockPos, mockSnapshot, mockStore, resetGlobals } from "../../role-helpers";

function scoutMock(): any {
  return { id: "scout_1", name: "scout_1", owner: { username: "Enemy" }, body: [], hits: 100, hitsMax: 100, pos: mockPos(10, 10, "W7N4") };
}

function towerMock(): any {
  return {
    structureType: "tower",
    store: mockStore(800, 1000),
    repair: vi.fn(() => OK),
    attack: vi.fn(() => OK),
    heal: vi.fn(() => OK),
    pos: mockPos(25, 25, "W7N4"),
  };
}

function repairTargetMock(): any {
  return { id: "ext_1", structureType: "extension", hits: 100, hitsMax: 1000, pos: mockPos(22, 25, "W7N4") };
}

beforeEach(() => {
  resetGlobals();
});

describe("tower-defense — 无害敌对在场（R7c 修复）", () => {
  it("侦察兵在场 + 满能量塔 + 维修目标 → 塔不接维修（放空让引擎自动攻击）", () => {
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: [],
      buildQueue: [],
      colonyState: "normal",
    };
    const tower = towerMock();
    const snap = mockSnapshot({
      towers: [tower],
      hostileCreeps: [scoutMock()],
      threatCreeps: [], // 无害侦察兵 — 非威胁
      criticalRepairTarget: repairTargetMock(),
    });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
    // 我们也不显式攻击 — 交给引擎自动开火（引擎行为不在 mock 范围内）。
    expect(tower.attack).not.toHaveBeenCalled();
  });

  it("回归：无任何敌对 + 维修目标 → 塔照常维修（维修链不因修复受损）", () => {
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: [],
      buildQueue: [],
      colonyState: "normal",
    };
    const tower = towerMock();
    const target = repairTargetMock();
    const snap = mockSnapshot({
      towers: [tower],
      hostileCreeps: [],
      threatCreeps: [],
      criticalRepairTarget: target,
    });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).toHaveBeenCalledWith(target);
  });

  it("威胁敌人仍在场 → 既有开火路径不受影响", () => {
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: [],
      buildQueue: [],
      colonyState: "normal",
    };
    const tower = towerMock();
    const threat: any = {
      id: "atk_1", name: "atk_1", owner: { username: "Enemy" },
      body: [{ type: ATTACK, hits: 100 }], hits: 1000, hitsMax: 1000,
      pos: mockPos(26, 25, "W7N4"),
    };
    const snap = mockSnapshot({
      towers: [tower],
      hostileCreeps: [threat],
      threatCreeps: [threat],
    });

    towerDefenseSystem.run(mockContext(snap));

    // 显式集火路径：塔 attack 被调用（assessEngagement 默认可交战）。
    expect(tower.attack).toHaveBeenCalledWith(threat);
  });
});
