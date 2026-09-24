/**
 * 远矿铺路「施工证据」闸 —— 落点错配回归。
 *
 * 线上实证（W37S57 tick 83188364）：x=28 列上 28,44/45/46 有进度（通勤 hauler 走过），
 * 紧邻的 28,47/48 progress=0 —— 规划线锚在 home storage + 纯地形代价，而 creep 实际
 * 从 x≈18 一侧入境（moveTowardRoom 的粘性出口缓存）。因为远矿 road 只能由 hauler
 * 「脚下 range≤3」顺路建造，落在无人行走的线上的 site 永远建不成。
 */
import { describe, expect, it } from "vitest";
import { selectRemoteRoadTiles } from "../../../src/systems/remote/road-planner";
import { mockPos } from "../../support/factories";

const ROOM = "W37S57";
/** 路径按「home 锚 → container」顺序给出（与 PathFinder 返回一致）。 */
const col = (...ys: number[]): RoomPosition[] =>
  ys.map(y => mockPos(20, y, ROOM)) as unknown as RoomPosition[];
const keys = (...ys: number[]) => new Set(ys.map(y => `20,${y}`));

describe("selectRemoteRoadTiles — 施工证据闸", () => {
  it("无证据约束（新开局）时整条路径可选", () => {
    const tiles = selectRemoteRoadTiles(col(40, 37, 34, 31), ROOM, [{ x: 20, y: 20 }], new Set());
    expect(tiles.map(t => t.y)).toEqual([31, 34, 37, 40]);
  });

  it("离 container 端先起铺：返回顺序按「距目标端近 → 远」", () => {
    const tiles = selectRemoteRoadTiles(
      col(40, 37, 34, 31),
      ROOM,
      [{ x: 20, y: 20 }],
      new Set(),
      keys(38),
    );
    // 证据在 38：31/34 被闸掉，剩 37/40；先建的是靠证据那一端（37），不是边界那一端（40）。
    expect(tiles.map(t => t.y)).toEqual([37, 40]);
  });

  it("range≤3 通过、range=4 拒绝 —— 与 buildRoadSiteUnderfoot 的射程同口径", () => {
    const tiles = selectRemoteRoadTiles(
      col(42, 41, 40, 38, 35, 34),
      ROOM,
      [{ x: 20, y: 20 }],
      new Set(),
      keys(38),
    );
    // 42/34 距证据 4 格 → 拒；41/40/38/35 在 3 格内 → 收，且靠证据的一端排在前。
    expect(tiles.map(t => t.y)).toEqual([35, 38, 40, 41]);
  });

  it("线上无一走过的格不会因规划器反复运行而累积", () => {
    // 唯一证据贴在 container 旁（12），规划线其余格都够不着 → 只会长出紧邻证据的一格。
    const path = col(48, 45, 42, 39, 36, 33, 30, 27, 24, 21, 18, 15);
    const tiles = selectRemoteRoadTiles(path, ROOM, [{ x: 20, y: 9 }], new Set(), keys(12));
    expect(tiles.map(t => t.y)).toEqual([15]);
  });

  it("证据格本身已在阻挡集时不影响判定（证据≠候选）", () => {
    const tiles = selectRemoteRoadTiles(
      col(40, 37, 34),
      ROOM,
      [{ x: 20, y: 20 }],
      keys(37), // 37 已有路/工地 → 阻挡
      keys(37),
    );
    expect(tiles.map(t => t.y)).toEqual([34, 40]);
  });
});
