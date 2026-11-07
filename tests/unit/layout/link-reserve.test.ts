/**
 * link 锚位预留（根因修复 B）—— 道路生成器必须为「将来才拿到槽位的 link」留最后一格。
 *
 * 病灶（线上 W8N3）：`CONTROLLER_STRUCTURES.link` = 5:2／6:3／7:4／8:6 按 RCL 门控槽位，
 * 而道路从 RCL2 就按棋盘格占地；等 storage link 有槽位时 storage 的邻域已被铺死，
 * `layoutGaps.linkStorage` 成为不可满足缺口。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { computeLinkReserveCells } from "../../../src/domain/layout/link-reserve";
import { createCoreRoadTasks } from "../../../src/domain/layout/task-factory";
import { packPos } from "../../../src/domain/layout/types";
import { resolveLinkRoleRanges } from "../../../src/domain/economy/links";
import { CONFIG } from "../../../src/config";
import type { RoomSnapshot } from "../../../src/kernel/contracts";
import { mockPos, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

const flat = { get: () => 0 } as unknown as RoomTerrain;
const allWall = { get: () => 1 } as unknown as RoomTerrain;
const roomFlat = { getTerrain: () => flat } as unknown as Room;

// 几何：sources (10,10)／(40,40)，controller (40,10)，storage (26,25) —— 彼此足够远，
// 角色归属不会互相劫持（与 link-allocation.test.ts 同一套布局约定）。
function linkAt(x: number, y: number, id: string): any {
  return {
    id,
    pos: mockPos(x, y),
    structureType: STRUCTURE_LINK,
    store: { getUsedCapacity: () => 0, getFreeCapacity: () => 800, getCapacity: () => 800 } as any,
    cooldown: 0,
    my: true,
  } as any;
}

function snap(rcl: number, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomName: "W7N4",
    rcl,
    controller: { id: "c1", my: true, pos: mockPos(40, 10), structureType: "controller" } as any,
    spawns: [],
    extensions: [],
    towers: [],
    containers: [],
    roads: [],
    walls: [],
    ramparts: [],
    storage: { id: "st1", my: true, pos: mockPos(26, 25), structureType: "storage" } as any,
    controllerContainer: undefined,
    links: [],
    sources: [
      { id: "src1", pos: mockPos(10, 10), energy: 3000 } as any,
      { id: "src2", pos: mockPos(40, 40), energy: 3000 } as any,
    ],
    constructionSites: [],
    myConstructionSites: [],
    hostileCreeps: [],
    threatCreeps: [],
    squadThreat: false,
    energyAvailable: 1800,
    energyCapacityAvailable: 1800,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map(),
    pendingHarvesters: 0,
    minerals: [],
    labs: [],
    terminal: undefined,
    extractor: undefined,
    factory: undefined,
    droppedEnergy: [],
    tombstones: [],
    ruins: [],
    ...overrides,
  } as RoomSnapshot;
}

const ranges = resolveLinkRoleRanges(CONFIG.economy.link);

describe("computeLinkReserveCells — 按放置侧同口径预留", () => {
  it("storage 有需求 ⇒ 只预留 1 枚，且落在 storage 的角色半径内", () => {
    const s = snap(6, {
      links: [linkAt(11, 10, "lSrc"), linkAt(40, 11, "lCtrl")], // source/controller 需求已闭合
    });
    const reserve = computeLinkReserveCells({
      snapshot: s,
      queue: [],
      terrain: flat,
      occupiedSet: new Set<number>(),
      ranges,
    });

    expect(reserve.size).toBe(1);
    const cell = [...reserve][0]!;
    const x = Math.floor(cell / 50);
    const y = cell % 50;
    expect(Math.max(Math.abs(x - 26), Math.abs(y - 25))).toBeLessThanOrEqual(ranges.storage);
    expect(Math.max(Math.abs(x - 26), Math.abs(y - 25))).toBe(1); // 最近优先
  });

  it("需求为三条角色 ⇒ 各留一枚（不是整环，也不是一格全包）", () => {
    const s = snap(6);
    const reserve = computeLinkReserveCells({
      snapshot: s,
      queue: [],
      terrain: flat,
      occupiedSet: new Set<number>(),
      ranges,
    });
    expect(reserve.size).toBe(3);
  });

  it("storage link 已建成（哪怕落在半径外沿）⇒ 该角色不再预留", () => {
    const s = snap(6, {
      links: [linkAt(11, 10, "lSrc"), linkAt(40, 11, "lCtrl"), linkAt(29, 25, "lStor")],
    });
    const reserve = computeLinkReserveCells({
      snapshot: s,
      queue: [],
      terrain: flat,
      occupiedSet: new Set<number>(),
      ranges,
    });
    expect(reserve.size).toBe(0);
  });

  it("storage link 任务已排队 ⇒ 同样视为已满足（需求闭合即释放，不长期饿死道路）", () => {
    const s = snap(6, {
      links: [linkAt(11, 10, "lSrc"), linkAt(40, 11, "lCtrl")],
    });
    const queue: BuildTask[] = [
      {
        key: "logistics.link.storage",
        pos: { x: 27, y: 25, roomName: "W7N4" },
        structureType: STRUCTURE_LINK,
        priority: 1,
        state: "queued",
        attempts: 0,
        retryAt: 0,
      },
    ];
    const reserve = computeLinkReserveCells({
      snapshot: s,
      queue,
      terrain: flat,
      occupiedSet: new Set<number>(),
      ranges,
    });
    expect(reserve.size).toBe(0);
  });

  it("半径内全是墙 ⇒ 不预留也不抛（道路与 link 不互锁）", () => {
    const s = snap(6);
    const reserve = computeLinkReserveCells({
      snapshot: s,
      queue: [],
      terrain: allWall,
      occupiedSet: new Set<number>(),
      ranges,
    });
    expect(reserve.size).toBe(0);
  });

  it("已占格不算预留：环内只剩一枚空闲 ⇒ 留的就是那一枚", () => {
    const s = snap(6, {
      links: [linkAt(11, 10, "lSrc"), linkAt(40, 11, "lCtrl")],
    });
    // 铺掉 storage ≤3 环里除 (24,27) 之外的所有格
    const occupied = new Set<number>();
    for (let dx = -ranges.storage; dx <= ranges.storage; dx++) {
      for (let dy = -ranges.storage; dy <= ranges.storage; dy++) {
        const x = 26 + dx;
        const y = 25 + dy;
        if (x === 24 && y === 27) continue;
        if (x === 26 && y === 25) continue; // storage 本格
        occupied.add(packPos(x, y));
      }
    }
    const reserve = computeLinkReserveCells({
      snapshot: s,
      queue: [],
      terrain: flat,
      occupiedSet: occupied,
      ranges,
    });
    expect([...reserve]).toEqual([packPos(24, 27)]);
  });
});

describe("道路生成器遵守预留", () => {
  // 锚点 (20,20)，预留格 (21,20)（奇校验 ⇒ 是道路候选），
  // 其正交邻域放两枚结构使其满足「≥2 相邻结构」的核心路条件。
  const ANCHOR = { x: 20, y: 20 };
  const RESERVED = packPos(21, 20);

  function roadFixture(): RoomSnapshot {
    return snap(4, {
      extensions: [
        { id: "e1", pos: mockPos(21, 19), structureType: STRUCTURE_EXTENSION, my: true } as any,
        { id: "e2", pos: mockPos(22, 20), structureType: STRUCTURE_EXTENSION, my: true } as any,
      ],
    });
  }

  const blueprint = { cells: [] } as any;

  it("不传预留 ⇒ 该格出现为道路候选（对照组：证明用例测的是同一格）", () => {
    const s = roadFixture();
    const out = createCoreRoadTasks(blueprint, ANCHOR.x, ANCHOR.y, "W7N4", roomFlat, s, new Set());
    expect(out.some(c => c.pos.x === 21 && c.pos.y === 20)).toBe(true);
  });

  it("传预留 ⇒ 道路让开该格", () => {
    const s = roadFixture();
    const out = createCoreRoadTasks(
      blueprint,
      ANCHOR.x,
      ANCHOR.y,
      "W7N4",
      roomFlat,
      s,
      new Set(),
      undefined,
      new Set([RESERVED]),
    );
    expect(out.some(c => c.pos.x === 21 && c.pos.y === 20)).toBe(false);
  });
});
