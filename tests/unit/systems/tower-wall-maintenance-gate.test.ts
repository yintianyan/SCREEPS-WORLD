/**
 * Phase D：塔的和平期墙体维护必须跟随 fortifyActive（停 50K / 复 300K）。
 *
 * 根因：`repairFortifications` 被闸住后，塔维修是另一条完全独立的执行器 ——
 * 旧实现只检查 colonyState 与塔能量比例，导致 `fortify=false` 期间仍有
 * 13–22 e/t 灌进 118 个 rampart（W8N3 实测 `towerSpendWalls`）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../../src/config";
import { towerDefenseSystem } from "../../../src/systems/military/tower-defense";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockContext,
  mockPos,
  mockSnapshot,
  mockStore,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Memory = { rooms: {} };
});

function towerMock(energy = 800, capacity = 1000): any {
  return {
    id: "tower_1",
    structureType: "tower",
    store: mockStore(energy, capacity),
    repair: vi.fn(() => OK),
    attack: vi.fn(() => OK),
    heal: vi.fn(() => OK),
    pos: mockPos(25, 25, "W8N3"),
  };
}

/** 远低于 RCL8 目标（10M hits）的 rampart —— 任何放行都会被抓为维修目标。 */
function rampartMock(): any {
  return {
    id: "ramp_1",
    structureType: "rampart",
    pos: mockPos(25, 26, "W8N3"),
    hits: 100000,
    hitsMax: 300000000,
  };
}

function storageMock(energy: number): any {
  return {
    id: "storage_1",
    pos: mockPos(21, 15, "W8N3"),
    store: mockStore(energy, 1000000),
  };
}

function makeSnap(opts: {
  storageEnergy?: number;
  ramparts?: any[];
  walls?: any[];
  towers?: any[];
}) {
  return mockSnapshot({
    roomName: "W8N3",
    rcl: 8,
    towers: opts.towers ?? [towerMock()],
    storage: opts.storageEnergy === undefined ? undefined : storageMock(opts.storageEnergy),
    ramparts: opts.ramparts ?? [rampartMock()],
    walls: opts.walls ?? [],
    hostileCreeps: [],
    threatCreeps: [],
    criticalRepairTarget: undefined,
  });
}

function setRoomMem(extra: Record<string, unknown> = {}): void {
  (globalThis as any).Memory.rooms.W8N3 = {
    spawnQueue: [],
    buildQueue: [],
    colonyState: "normal",
    ...extra,
  };
}

describe("tower-defense — Phase D 修墙闸", () => {
  it("fortify=false + storage 100K ⇒ 塔不修墙（旧实现在此会灌 10 e/t）", () => {
    setRoomMem({ fortifyActive: false });
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 100000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("fortify=true + storage 100K ⇒ 塔修墙", () => {
    setRoomMem({ fortifyActive: true });
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 100000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).toHaveBeenCalled();
  });

  it("fortifyActive 优先于 storageRichActive —— rich=true + fortify=false 仍不修", () => {
    setRoomMem({ storageRichActive: true, fortifyActive: false });
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 200000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("无闩锁字段（旧路径）+ storage 100K ⇒ 按 50K 门槛放行", () => {
    setRoomMem();
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 100000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).toHaveBeenCalled();
  });

  it("无闩锁字段 + storage 40K（低于 50K 停线）⇒ 不修", () => {
    setRoomMem();
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 40000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("受袭记忆窗口不放开闸：fortify=false + storage 20K ⇒ 仍不补墙", () => {
    setRoomMem({
      fortifyActive: false,
      lastHostileAt: (globalThis as any).Game.time,
    });
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 20000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("受袭记忆 + fortify=true ⇒ 修（目标血量按受袭升档，开闸仍看闸）", () => {
    setRoomMem({
      fortifyActive: true,
      lastHostileAt: (globalThis as any).Game.time,
    });
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 20000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).toHaveBeenCalled();
  });

  it("无 storage 的早期房（RCL1-4）⇒ 保持放行，塔是唯一防线维护者", () => {
    setRoomMem();
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: undefined, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).toHaveBeenCalled();
  });

  it("存在维修 creep 时塔让出维修（既有 A3 门禁不回退）", () => {
    setRoomMem({ fortifyActive: true });
    globalCache().repairRooms = new Set(["W8N3"]);
    const tower = towerMock();
    const snap = makeSnap({ storageEnergy: 400000, towers: [tower] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
  });
});

describe("Phase D：塔闸与 creep 闸共用同一组阈值", () => {
  it("停线 = sprintStorage，恢复线 = fortifyResumeStorage，受袭线 = sustainedStorage", () => {
    expect(CONFIG.defense.fortifyResumeStorage).toBe(300000);
    expect(CONFIG.economy.upgrade.sprintStorage).toBe(50000);
    expect(CONFIG.economy.upgrade.sustainedStorage).toBe(10000);
  });
});
