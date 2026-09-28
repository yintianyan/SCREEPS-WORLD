/**
 * 远矿修路「按实测热度落点 + 残骸回收 + 跨主房车道」测试。
 *
 * 立案理由（线上，建路账本 2026-09-28）：W36S58 挂 14 格 road site、进度和 970、建成 0，
 * 而通勤腿到最近 site 的距离落在「6-10 格 / 11+ 格」占 18/22 —— 规划线（home 锚 + 纯地形
 * PathFinder）与 creep 真走的那条线（moveTowardRoom 的粘性出口缓存）不是一条，而施工只能
 * 「脚下」发生 ⇒ 铺在没人走的线上的 site 永远建不成，还永久占着 roadSitesPerOpTotal 车道。
 * 上一版的「紧邻已有结构/已建 site 才算证据」救不了它：site 就下在 container 旁，天然自证。
 * 现在证据只有一个来源 —— 本次进程实测被踩过的格子。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  planRemotePathRoads,
  selectWalkedRoadTiles,
  walkedHeatKeys,
} from "../../../src/systems/remote/road-planner";
import { CONFIG } from "../../../src/config";
import { mockContext, resetGlobals } from "../../support/factories";

const HOME = "W7N4";
const T = "W8N4";
const g = (): any => globalThis as any;

const CONTAINER = { x: 20, y: 20 };
const SOURCE = { x: 20, y: 19 };
/** 与 creeps/movement/traffic.ts 同一套键形：x*50+y。 */
const packed = (x: number, y: number): string => String(x * 50 + y);

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

/** 写入「通勤腿踩过哪些格」（heap 热度，与 recordTraffic 同键形）。 */
function seedHeat(tiles: [number, number][], walks = 5): void {
  const traffic: Record<string, number> = {};
  for (const [x, y] of tiles) traffic[packed(x, y)] = walks;
  g().roomTraffic = { [T]: traffic };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  g().roomTraffic = undefined;
});

describe("walkedHeatKeys / selectWalkedRoadTiles（纯函数）", () => {
  const minWalks = CONFIG.remote.roadMinTileWalks;

  it('热度键换算成 "x,y"，并滤掉踩得不够多的格', () => {
    const keys = walkedHeatKeys({ [packed(20, 22)]: 9, [packed(21, 22)]: 1, bogus: 50 }, minWalks);
    expect(keys.has("20,22")).toBe(true);
    expect(keys.has("21,22")).toBe(false); // 次数不足
    expect([...keys]).toHaveLength(1); // 畸形键被忽略
  });

  it("铺路格只从被走过的格里出：排除结构格、边界行、source 旁 1 格", () => {
    const blocked = new Set(["25,25"]);
    const tiles = selectWalkedRoadTiles(
      {
        [packed(20, 22)]: 9, // 合格
        [packed(25, 25)]: 8, // 已有结构 → 排除
        [packed(20, 19)]: 7, // source 旁 1 格 → 让给 container
        [packed(0, 25)]: 6, // 边界行 → 留给通行
        [packed(22, 22)]: 2, // 次数不足
      },
      blocked,
      [SOURCE],
      minWalks,
    );
    expect(tiles.map(t => t.key)).toEqual(["20,22"]);
  });

  it("按热度降序（最常走的先铺），同分按坐标定序 —— 同一输入必须同一结果", () => {
    const tiles = selectWalkedRoadTiles(
      { [packed(30, 30)]: 4, [packed(10, 10)]: 12, [packed(11, 11)]: 12 },
      new Set(),
      [SOURCE],
      minWalks,
    );
    expect(tiles.map(t => t.key)).toEqual(["10,10", "11,11", "30,30"]);
  });

  it("没有热度数据时返回空（冷启动不猜线）", () => {
    expect(selectWalkedRoadTiles(undefined, new Set(), [SOURCE], minWalks)).toEqual([]);
  });
});

describe("planRemotePathRoads — 只沿被走过的线生长", () => {
  it("零进度且不在热度线上的 site 被 remove；在线上的、或有进度的保留", () => {
    const sites = [roadSite(20, 40), roadSite(20, 21), roadSite(20, 30, 100)];
    const ops = { [T]: activeOp() };
    seed(5001, ops, { [T]: targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]) });
    seedHeat([
      [20, 21],
      [20, 22],
    ]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites[0]!.remove).toHaveBeenCalledTimes(1); // 20,40 — 没人走过
    expect(sites[1]!.remove).not.toHaveBeenCalled(); // 20,21 — 在热度线上
    expect(sites[2]!.remove).not.toHaveBeenCalled(); // 20,30 — 有进度，正在被建
  });

  it("新 site 下在热度格上（而不是预测线或结构旁）", () => {
    const sites: any[] = [];
    const ops = { [T]: activeOp() };
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(5006, ops, { [T]: room });
    seedHeat([
      [20, 22],
      [20, 23],
    ]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 22, STRUCTURE_ROAD);
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 23, STRUCTURE_ROAD);
  });

  it("本次进程没有热度时既不建也不扫 —— 无从判断走过哪条线时，猜线正是那 14 格的成因", () => {
    const sites = [roadSite(20, 40), roadSite(20, 41)];
    const ops = { [T]: activeOp() };
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(5002, ops, { [T]: room });

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites[0]!.remove).not.toHaveBeenCalled();
    expect(sites[1]!.remove).not.toHaveBeenCalled();
    expect(room.createConstructionSite).not.toHaveBeenCalled();
  });

  it("车道被残骸占满时：同一轮先扫后建（不被自己的残骸锁死）", () => {
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
    seedHeat([[20, 22]]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites.filter(s => s.remove.mock.calls.length > 0)).toHaveLength(9);
    // 清扫释放的额度本轮即可用 → 热度线尽头直接建站。
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 22, STRUCTURE_ROAD);
    // 计数记「清扫后」口径：残骸当场让出车道。
    expect(op.roadSiteCount).toBe(11);
  });

  it("帽是跨主房口径：别的 home 挂满 20 时本房不建（但仍清扫）", () => {
    const sites = [roadSite(20, 40), roadSite(20, 21)];
    const ops = { [T]: activeOp({ roadSiteCount: 2 }) };
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(5004, ops, { [T]: room });
    seedHeat([
      [20, 21],
      [20, 22],
    ]);
    g().Memory.rooms["W9N9"] = { remoteOps: { W0N0: activeOp({ roadSiteCount: 20 }) } };

    planRemotePathRoads(HOME, ops, mockContext());

    expect(room.createConstructionSite).not.toHaveBeenCalled();
    expect(sites[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it("abandoned op → 计数归零让出车道，且不碰该房", () => {
    const ops = { [T]: activeOp({ state: "abandoned", roadSiteCount: 7 }) };
    const room = targetRoomMock([roadSite(20, 40)], [container(CONTAINER.x, CONTAINER.y)]);
    seed(5005, ops, { [T]: room });
    seedHeat([[20, 22]]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(ops[T].roadSiteCount).toBe(0);
    expect(room.find).not.toHaveBeenCalled();
  });
});
