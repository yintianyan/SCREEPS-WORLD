/**
 * 远矿修路「按实测热度落点 + 残骸回收 + 跨主房车道」测试。
 *
 * 立案理由（线上，建路账本 2026-09-28）：W36S58 挂 14 格 road site、进度和 970、建成 0，
 * 而通勤腿到最近 site 的距离落在「6-10 格 / 11+ 格」占 18/22 —— 规划线（home 锚 + 纯地形
 * PathFinder）与 creep 真走的那条线（moveTowardRoom 的粘性出口缓存）不是一条，而施工只能
 * 「脚下」发生 ⇒ 铺在没人走的线上的 site 永远建不成，还永久占着 roadSitesPerOpTotal 车道。
 * 上一版的「紧邻已有结构/已建 site 才算证据」救不了它：site 就下在 container 旁，天然自证。
 * 现在证据只有一个来源 —— 通勤实测被踩过的格子，而且这本账要跨得过 global reset（部署比
 * 攒够门槛更快时，直读 heap 等于永远冷启动）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  planRemotePathRoads,
  selectWalkedRoadTiles,
  walkedHeatKeys,
} from "../../../src/systems/remote/road-planner";
import { mergeWalkHeat } from "../../../src/domain/logistics/walk-heat";
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
  // 默认假设「本进程已跑满一个热度合并窗口」——合并另有 uptime 闸，见下面那组用例。
  g().processBootTick = tick - CONFIG.remote.roadHeatMergeTicks - 1;
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

/**
 * 把「线外格已经冻了多久」预置成已超窗 —— 回收判据是时间，不是第一次见到就删。
 * 未预置的用例走的是「本轮起表、下轮才可能收」那条路。
 */
function frozen(sum: number, tick: number): Record<string, number> {
  return {
    roadStaleProgressSum: sum,
    roadStaleSince: tick - CONFIG.remote.roadStaleReapTicks,
  };
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
  it("首轮只起表：线外格没冻满窗口前不动手", () => {
    const sites = [roadSite(20, 40), roadSite(20, 21), roadSite(20, 30, 100)];
    const op = activeOp();
    const ops = { [T]: op };
    seed(5001, ops, { [T]: targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]) });
    seedHeat([
      [20, 21],
      [20, 22],
    ]);

    planRemotePathRoads(HOME, ops, mockContext());

    for (const s of sites) expect(s.remove).not.toHaveBeenCalled();
    expect(op.roadStaleProgressSum).toBe(100); // 线外 = 20,40(0) + 20,30(100)
    expect(op.roadStaleSince).toBe(5001);
  });

  it("冻满窗口后线外格全收（有进度的也收），线上的保留", () => {
    const sites = [roadSite(20, 40), roadSite(20, 21), roadSite(20, 30, 100)];
    const op = activeOp(frozen(100, 5001));
    const ops = { [T]: op };
    seed(5001, ops, { [T]: targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]) });
    seedHeat([
      [20, 21],
      [20, 22],
    ]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites[0]!.remove).toHaveBeenCalledTimes(1); // 20,40 — 没人走过
    expect(sites[2]!.remove).toHaveBeenCalledTimes(1); // 20,30 — 有进度但冻住了：正是 970 那个形状
    expect(sites[1]!.remove).not.toHaveBeenCalled(); // 20,21 — 在热度线上
    expect(op.roadReaped).toBe(2);
  });

  it("线外格的进度还在变 → 施工仍在发生，不回收且重新起表", () => {
    const sites = [roadSite(20, 40, 100)];
    const op = activeOp(frozen(50, 9000)); // 上轮记的是 50，这一轮长成 100 了
    const ops = { [T]: op };
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(9000, ops, { [T]: room });
    seedHeat([[20, 22]]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites[0]!.remove).not.toHaveBeenCalled();
    expect(op.roadStaleProgressSum).toBe(100);
    expect(op.roadStaleSince).toBe(9000);
    expect(op.roadReaped).toBe(0);
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 22, STRUCTURE_ROAD);
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

  it("还没有任何热度账时既不建也不扫 —— 无从判断走过哪条线时，猜线正是那 14 格的成因", () => {
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
    // 9 格零进度块 + 11 格 x=21 列在建；热度线 20,22 的 range≤3 只罩住 21,22..21,25。
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
    // 线外 = 9 格零进度 + 21,26..32 那 7 格（7×50=350）—— 后者正是"有进度却不再长"的那批。
    const op = activeOp({ roadSiteCount: sites.length, ...frozen(350, 5003) });
    const ops = { [T]: op };
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(5003, ops, { [T]: room });
    seedHeat([[20, 22]]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(sites.filter(s => s.remove.mock.calls.length > 0)).toHaveLength(16);
    // 清扫释放的额度本轮即可用 → 热度线尽头直接建站。
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 22, STRUCTURE_ROAD);
    // 计数记「清扫后」口径：残骸当场让出车道。
    expect(op.roadSiteCount).toBe(4);
    expect(op.roadLaid).toBe(1);
  });

  it("帽是跨主房口径：别的 home 挂满 20 时本房不建（但仍清扫）", () => {
    const sites = [roadSite(20, 40), roadSite(20, 21)];
    const ops = { [T]: activeOp({ roadSiteCount: 2, ...frozen(0, 5004) }) };
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
    const ops = {
      [T]: activeOp({ state: "abandoned", roadSiteCount: 7, roadHeat: { "20,22": 9 } }),
    };
    const room = targetRoomMock([roadSite(20, 40)], [container(CONTAINER.x, CONTAINER.y)]);
    seed(5005, ops, { [T]: room });
    seedHeat([[20, 22]]);

    planRemotePathRoads(HOME, ops, mockContext());

    expect(ops[T].roadSiteCount).toBe(0);
    expect(ops[T].roadHeat).toBeUndefined(); // 热度账随线一起摘，不留 Memory 体积
    expect(room.find).not.toHaveBeenCalled();
  });
});

describe("planRemotePathRoads — 热度账跨进程续账", () => {
  it("heap 被 reset 清空后，上一进程攒下的热度仍然有效（停摆由此解开）", () => {
    const op = activeOp({
      // 上一个进程留下的账：键形与 heap 一致（x*50+y 的字符串）。
      roadHeat: { [packed(20, 40)]: 30, [packed(20, 21)]: 40 },
      roadHeatAt: 5600, // 窗口未满 → 本轮不合并，而 heap 已经空了（刚 reset）
      ...frozen(0, 5700),
    });
    const sites = [roadSite(35, 35)]; // 与热度线相距十几格的残骸
    const room = targetRoomMock(sites, [container(CONTAINER.x, CONTAINER.y)]);
    seed(5700, { [T]: op }, { [T]: room });
    g().roomTraffic = undefined; // global reset 后的 heap

    planRemotePathRoads(HOME, { [T]: op }, mockContext());

    expect(op.roadHeatTiles).toBe(2);
    expect(sites[0]!.remove).toHaveBeenCalledTimes(1); // 残骸照收 —— 证据不依赖本次进程
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 21, STRUCTURE_ROAD);
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 40, STRUCTURE_ROAD);
  });

  it("窗口未满时不合并、不清 heap（增量留着下次一起入账）", () => {
    const op = activeOp({ roadHeat: { [packed(20, 22)]: 5 }, roadHeatAt: 5900 });
    const room = targetRoomMock([], [container(CONTAINER.x, CONTAINER.y)]);
    seed(5901, { [T]: op }, { [T]: room });
    seedHeat([[21, 22]]);

    planRemotePathRoads(HOME, { [T]: op }, mockContext());

    expect(op.roadHeat[packed(21, 22)]).toBeUndefined();
    expect(Object.keys(g().roomTraffic[T])).toEqual([packed(21, 22)]); // heap 未被吃掉
    expect(room.createConstructionSite).toHaveBeenCalledWith(20, 22, STRUCTURE_ROAD);
  });

  it("部署打断积累时不合并 —— 半份增量不得把旧账衰减掉（那是自伤）", () => {
    const op = activeOp({
      roadHeat: { [packed(20, 22)]: 20 },
      roadHeatAt: 7000 - CONFIG.remote.roadHeatMergeTicks, // 窗口闸：早已满足
    });
    const room = targetRoomMock([], [container(CONTAINER.x, CONTAINER.y)]);
    seed(7000, { [T]: op }, { [T]: room });
    seedHeat([[21, 22]]);
    g().processBootTick = 6980; // 但本进程只活了 20 tick（刚被部署重启）

    planRemotePathRoads(HOME, { [T]: op }, mockContext());

    expect(op.roadHeat[packed(20, 22)]).toBe(20); // 旧账原样保留，没被 ×0.7
    expect(op.roadHeat[packed(21, 22)]).toBeUndefined(); // 增量留着，等攒满一个窗口再入
    expect(Object.keys(g().roomTraffic[T])).toHaveLength(1); // heap 也没被吃掉
  });

  it("合并即清空该房 heap —— 上一窗口的走动不会被重复计入", () => {
    const op = activeOp();
    const room = targetRoomMock([], [container(CONTAINER.x, CONTAINER.y)]);
    seed(6001, { [T]: op }, { [T]: room });
    seedHeat([[20, 22]]); // 本进程已攒 5 次

    planRemotePathRoads(HOME, { [T]: op }, mockContext());
    expect(op.roadHeat[packed(20, 22)]).toBe(5);
    expect(Object.keys(g().roomTraffic[T])).toHaveLength(0);
    expect(op.roadLaid).toBe(1);

    g().roomTraffic[T][packed(20, 22)] = 1; // 新窗口里只又踩了 1 次
    seed(6600, { [T]: op }, { [T]: room });
    planRemotePathRoads(HOME, { [T]: op }, mockContext());

    // floor(5×0.7)+1 = 4：旧账衰减后叠加增量，而不是把 5 再记一遍。
    expect(op.roadHeat[packed(20, 22)]).toBe(Math.floor(5 * CONFIG.remote.roadHeatDecay) + 1);
  });
});

describe("mergeWalkHeat（纯函数）", () => {
  const opts = { decay: 0.7, minWalks: 3, cap: 4 };

  it("旧账衰减 + 新增量叠加；不过门槛的格不入账", () => {
    const merged = mergeWalkHeat({ a: 10, b: 4 }, { a: 1, c: 2 }, opts);
    expect(merged).toEqual({ a: 8 }); // b: floor(4×0.7)=2 < 3 被淘汰；c 只踩了 2 次
  });

  it("超上限只留最热的 cap 格，同分按键定序（同一输入同一份账）", () => {
    const merged = mergeWalkHeat(undefined, { 1: 5, 2: 9, 3: 9, 4: 3, 5: 3, 6: 3 }, opts);
    // cap=4 → 淘汰 5/6（同分里键序靠后的那两个）；9/9 与 3/3 之间靠键序定胜负。
    expect(merged).toEqual({ 1: 5, 2: 9, 3: 9, 4: 3 });
    expect(mergeWalkHeat(undefined, { 1: 5, 2: 9, 3: 9, 4: 3, 5: 3, 6: 3 }, opts)).toEqual(merged);
  });

  it("不改写传入的旧账（调用方还拿着它做别的事）", () => {
    const prev = { a: 10 };
    mergeWalkHeat(prev, { a: 5 }, opts);
    expect(prev.a).toBe(10);
  });
});
