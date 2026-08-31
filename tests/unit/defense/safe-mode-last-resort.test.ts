/** safe mode 保底判据测试 — 消耗性资源不因「打不出火力 + 近核」轻动用。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { towerDefenseSystem } from "../../../src/systems/tower-defense";
import {
  mockContext,
  mockSnapshot,
  mockStructure,
  registerObject,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  delete (globalThis as any).repairRooms;
  // reportThreatUnhandled 的心跳状态挂在 heap，跨测试必须清零。
  delete (globalThis as any).threatUnhandledAt;
});

function makeController(): any {
  return {
    ...mockStructure("controller", { id: "ctrl_1" }),
    my: true,
    level: 7,
    safeMode: 0,
    safeModeCooldown: 0,
    safeModeAvailable: 2,
    activateSafeMode: vi.fn(() => OK),
  };
}

/** 塔到威胁的距离决定盈亏判定的期望伤害（10 格 → 450 < 40 奶量）。 */
function makeTower(id: string, energy: number): any {
  const tower = mockStructure("tower", { id, energy, capacity: 1000 });
  tower.attack = vi.fn(() => OK);
  tower.repair = vi.fn(() => OK);
  tower.pos.getRangeTo = vi.fn(() => 10);
  return tower;
}

function makeThreat(id: string, parts: string[], rangeToAnchor = 3): any {
  const threat: any = {
    id,
    name: id,
    pos: { x: 25, y: 25, roomName: "W7N4", getRangeTo: vi.fn(() => rangeToAnchor) },
    body: parts.map(t => ({ type: t, hits: 100 })),
    hits: 10000,
    hitsMax: 10000,
    owner: { username: "invader" },
  };
  registerObject(id, threat);
  return threat;
}

/** 40 HEAL + 1 ATTACK — 10 格塔伤 450 < 480 奶量，盈亏判定必然停火。 */
function makeOutgunnedThreat(id: string, rangeToAnchor = 3): any {
  return makeThreat(id, ["attack", ...Array(40).fill("heal")], rangeToAnchor);
}

function threatUnhandledEvents(): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === 41);
}

function makeSnapshot(opts: { tower: any; threat: any; controller: any; spawn?: any; ramparts?: any[] }): any {
  return mockSnapshot({
    roomName: "W7N4",
    rcl: 7,
    towers: [opts.tower],
    threatCreeps: [opts.threat],
    hostileCreeps: [opts.threat],
    spawns: [opts.spawn ?? mockStructure("spawn", { id: "spawn_1", hits: 5000, hitsMax: 5000 })],
    controller: opts.controller,
    ramparts: opts.ramparts ?? [],
  });
}

describe("tower-defense — safe mode 保底判据（有塔分支）", () => {
  it("奶量压制 + 近核但核心完好 → 不烧 safe mode，转 ThreatUnhandled 事件", () => {
    const controller = makeController();
    const tower = makeTower("tower_1", 500);
    const threat = makeOutgunnedThreat("threat_1");
    const snap = makeSnapshot({ tower, threat, controller });

    towerDefenseSystem.run(mockContext(snap));

    expect(controller.activateSafeMode).not.toHaveBeenCalled();
    const ev = threatUnhandledEvents()[0];
    expect(ev?.r).toBe("W7N4");
    expect(ev?.d).toEqual([1, 40]);
  });

  it("核心结构正被拆（spawn 受损 + 攻击者贴身）→ 动用 safe mode", () => {
    const controller = makeController();
    const tower = makeTower("tower_1", 500);
    const threat = makeOutgunnedThreat("threat_1");
    const spawn = mockStructure("spawn", { id: "spawn_1", hits: 4000, hitsMax: 5000 });
    const snap = makeSnapshot({ tower, threat, controller, spawn });

    towerDefenseSystem.run(mockContext(snap));

    expect(controller.activateSafeMode).toHaveBeenCalledTimes(1);
  });

  it("塔全空 + 带攻击部件威胁突入核心区 → 动用 safe mode", () => {
    const controller = makeController();
    const tower = makeTower("tower_1", 0);
    const threat = makeOutgunnedThreat("threat_1");
    const snap = makeSnapshot({ tower, threat, controller });

    towerDefenseSystem.run(mockContext(snap));

    expect(controller.activateSafeMode).toHaveBeenCalledTimes(1);
  });

  it("纯 HEAL 威胁（无攻击部件）→ 不构成拆毁威胁，不烧 safe mode", () => {
    const controller = makeController();
    const tower = makeTower("tower_1", 0);
    const threat = makeThreat("scout_heal", Array(41).fill("heal"));
    const snap = makeSnapshot({ tower, threat, controller });

    towerDefenseSystem.run(mockContext(snap));

    expect(controller.activateSafeMode).not.toHaveBeenCalled();
  });

  it("停火期塔转入应急维修（修受啃 rampart，不浪费自动射击）", () => {
    const controller = makeController();
    const tower = makeTower("tower_1", 500);
    const threat = makeOutgunnedThreat("threat_1");
    const rampart = mockStructure("rampart", { id: "ramp_1", hits: 100, hitsMax: 1000 });
    const snap = makeSnapshot({ tower, threat, controller, ramparts: [rampart] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.attack).not.toHaveBeenCalled();
    expect(tower.repair).toHaveBeenCalledWith(rampart);
  });

  it("ThreatUnhandled 心跳限频：200t 内不重复上报", () => {
    const controller = makeController();
    const tower = makeTower("tower_1", 500);
    const threat = makeOutgunnedThreat("threat_1");
    const ctx = mockContext(makeSnapshot({ tower, threat, controller }));
    const Game = (globalThis as any).Game;

    towerDefenseSystem.run(ctx);
    expect(threatUnhandledEvents()).toHaveLength(1);

    Game.time = 1100;
    towerDefenseSystem.run(ctx);
    expect(threatUnhandledEvents()).toHaveLength(1);

    Game.time = 1300;
    towerDefenseSystem.run(ctx);
    expect(threatUnhandledEvents()).toHaveLength(2);
  });
});
