/**
 * 远矿修路「残骸回收 + 跨主房车道」测试。
 *
 * 立案理由（线上实证 shard3 time 83188662）：W37S54 挂 20 个 road site / roads=0，其中
 * 边界端 9 个 progress=0；W37S57 的 28,47/28,48 同样零进度 —— 规划线锚在 home storage
 * 的纯地形最短路，而 creep 出境点由 moveTowardRoom 的粘性出口缓存决定，两条线在边界处
 * 差十几格。远矿 road 只能由 hauler 脚下 range≤3 顺路建，落在没人走的线上就永远建不成，
 * 而 roadSitesPerOpTotal 旧实现是 per-home 累加（名义全局、实为每房）→ 自己的残骸把自己
 * 的修路车道锁死。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planRemotePathRoads } from "../../../src/systems/remote/road-planner";
import { mockContext, resetGlobals } from "../../support/factories";

const HOME = "W7N4";
const T = "W8N4";
const g = (): any => globalThis as any;

const CONTAINER = { x: 20, y: 20 };
const SOURCE = { x: 20, y: 19 };

function pos(x: number, y: number, roomName = T): any {
  return {
    x,
    y,
    roomName,
    getRangeTo: (o: any) =>
      Math.max(Math.abs((o.x ?? o.pos?.x) - x), Math.abs((o.y ?? o.pos?.y) - y)),
  };
}

function roadSite(x: number, y: number, progress = 0): any {
  return { structureType: STRUCTURE_ROAD, pos: pos(x, y), progress, remove: vi.fn() };
}

function container(x: number, y: number): any {
  return { structureType: STRUCTURE_CONTAINER, pos: pos(x, y) };
}

/** 目标房 mock：按 find flag 分发，createConstructionSite 记录并恒成功。 */
function targetRoomMock(sites: any[], structures: any[]): any {
  return {
    name: T,
    find: vi.fn((flag: number) => {
      if (flag === FIND_MY_CONSTRUCTION_SITES) return sites;
      if (flag === FIND_STRUCTURES) return structures;
      if (flag === FIND_SOURCES)
        return [
          {
            id: "src_W8N4_a",
            pos: {
              ...pos(SOURCE.x, SOURCE.y),
              findInRange: vi.fn(() =>
                structures.filter(s => s.structureType === STRUCTURE_CONTAINER),
              ),
            },
          },
        ];
      return [];
    }),
    createConstructionSite: vi.fn(() => OK),
  };
}

/** home 房 mock：只被读 storage 作为锚。 */
function homeRoomMock(): any {
  return { name: HOME, storage: { pos: pos(25, 25, HOME) }, find: vi.fn(() => []) };
}

/** 统一前置：Game.time 唯一（避开 getRemoteRoadSiteTotal 的 per-tick 缓存串味）。 */
function seed(tick: number, ops: Record<string, any>, extraRooms: Record<string, any> = {}): void {
  const game = g().Game;
  game.time = tick;
  game.rooms[HOME] = homeRoomMock();
  Object.assign(game.rooms, extraRooms);
  g().Memory.rooms[HOME] = { remoteOps: ops, colonyState: "normal" };
}

function activeOp(overrides: Record<string, unknown> = {}): any {
  return { state: "active", createdAt: 0, lastSeen: 0, ...overrides };
}

/** 让 PathFinder 返回给定的目标房格序列（规划线）。 */
function planPath(tiles: { x: number; y: number }[]): void {
  (globalThis as any).PathFinder.search = vi.fn(() => ({
    path: tiles.map(t => pos(t.x, t.y)),
    incomplete: false,
    ops: 0,
    cost: tiles.length,
  }));
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("planRemotePathRoads — 零进度残骸回收", () => {
  it("零进度且拿不到施工证据的 site 被 remove；紧邻证据或有进度的保留", () => {
    const sites = [roadSite(20, 40), roadSite(20, 21), roadSite(20, 30, 100)];
    const ops = { [T]: activeOp() };
    seed(5001, ops, { [T]: targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]) });
    planPath([{ x: 20, y: 22 }]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites[0]!.remove).toHaveBeenCalledTimes(1); // 20,40 — 没人走的边界端
    expect(sites[1]!.remove).not.toHaveBeenCalled(); // 20,21 — 距 container 1 格
    expect(sites[2]!.remove).not.toHaveBeenCalled(); // 20,30 — p100，正在被建
  });

  it("这房连 container/路都没有时不清扫（保护开局第一段路）", () => {
    const sites = [roadSite(20, 40), roadSite(20, 41)];
    const ops = { [T]: activeOp() };
    seed(5002, ops, { [T]: targetRoomMock(sites, []) }); // 无结构 → 无证据
    planPath([{ x: 20, y: 22 }]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites[0]!.remove).not.toHaveBeenCalled();
    expect(sites[1]!.remove).not.toHaveBeenCalled();
  });

  it("车道被残骸占满时：同一轮先扫后建（不被自己的残骸锁死）", () => {
    // 20 个挂起 = 帽：9 个边界端零进度（应扫掉）+ 11 个在建（x=21 列，距零进度端 >3）。
    const sites: any[] = [];
    for (const [x, y] of [
      [20, 40],
      [19, 40],
      [21, 40],
      [20, 41],
      [19, 41],
      [21, 41],
      [20, 42],
      [19, 42],
      [21, 42],
    ] as const) {
      sites.push(roadSite(x, y));
    }
    for (let y = 22; y <= 32; y++) sites.push(roadSite(21, y, 50));
    const op = activeOp({ roadSiteCount: sites.length });
    const ops = { [T]: op };
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(5003, ops, { [T]: room });
    planPath([{ x: 20, y: 22 }]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites.filter(s => s.remove.mock.calls.length > 0)).toHaveLength(9);
    // 清扫释放的额度本轮即可用 → 紧邻证据的 20,22 建站成功。
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 22, STRUCTURE_ROAD);
    // 计数记「清扫后」口径：残骸当场让出车道。
    expect(op.roadSiteCount).toBe(11);
  });

  it("帽是跨主房口径：别的 home 挂满 20 时本房不建（但仍清扫）", () => {
    const sites = [roadSite(20, 40), roadSite(20, 21)];
    // 一致的世界：本房 2 个挂起（含 1 个待扫残骸）+ 另一主房 20 个 = 22 > 帽。
    const ops = { [T]: activeOp({ roadSiteCount: 2 }) };
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(5004, ops, { [T]: room });
    // 另一主房 W9N9 的远矿房挂 20 个 road site（本房看不到，只有账在 Memory）。
    g().Memory.rooms["W9N9"] = { remoteOps: { W0N0: activeOp({ roadSiteCount: 20 }) } };
    planPath([{ x: 20, y: 22 }]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(room.createConstructionSite).not.toHaveBeenCalled();
    expect(sites[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it("abandoned op → 计数归零让出车道，且不碰该房", () => {
    const ops = { [T]: activeOp({ state: "abandoned", roadSiteCount: 7 }) };
    const room = targetRoomMock([roadSite(20, 40)], [container(CONTAINER.x, CONTAINER.y)]);
    seed(5005, ops, { [T]: room });
    planPath([{ x: 20, y: 22 }]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(ops[T].roadSiteCount).toBe(0);
    expect(room.find).not.toHaveBeenCalled();
  });
});
