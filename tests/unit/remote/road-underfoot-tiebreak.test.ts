/**
 * 通勤 hauler 脚下建路的选格判据 —— 反摊薄。
 *
 * 立案理由（线上实证 W37S54 tick 83188662→83200502）：一条 20 格 road 链在 11.8k tick 里
 * 每格只拿到 ~5 点进度、roads=0 —— 旧判据「射程内取最近、平手取 find 顺序的第一个」会把
 * 每趟唯一一次 build 摊到不同格子上，300 点永远凑不满，车道被一串建不成的 site 永久占住。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRoadSiteUnderfoot } from "../../../src/creeps/roles/remote-hauler";
import { resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;

/** 单调 tick 源（模块级，跨 resetGlobals 存活）— 见 hauler() 注释。 */
let tickSeed = 5000;

function site(x: number, y: number, progress: number): any {
  return { structureType: STRUCTURE_ROAD, pos: { x, y }, progress };
}

/** creep 站在 (0,0)，getRangeTo 按切比雪夫距离返回 site 到原点的距离。 */
function hauler(sites: any[]): any {
  // findMySitesCached 是 per-tick per-room 缓存 — 用例必须换 tick，否则第二个用例读到
  // 第一个用例的 site 列表（假绿）。
  g().Game.time = ++tickSeed;
  return {
    store: { getUsedCapacity: vi.fn(() => 500) },
    getActiveBodyparts: vi.fn(() => 1),
    pos: { getRangeTo: (s: any) => Math.max(Math.abs(s.pos.x), Math.abs(s.pos.y)) },
    room: { name: "W37S54", find: vi.fn(() => sites) },
    build: vi.fn(),
  };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("buildRoadSiteUnderfoot — 射程内先建最接近完工的", () => {
  it("同射程两格：建进度高的那个（旧判据会平手取顺序，导致整链摊薄）", () => {
    const creep = hauler([site(2, 0, 5), site(2, 2, 290)]);
    buildRoadSiteUnderfoot(creep);
    expect(creep.build.mock.calls[0]![0].progress).toBe(290);
  });

  it("更近的一格仍优先（脚下先建，不为远处高进度多花一趟）", () => {
    const creep = hauler([site(1, 0, 0), site(3, 0, 290)]);
    buildRoadSiteUnderfoot(creep);
    expect(creep.build.mock.calls[0]![0].pos.x).toBe(1);
  });

  it("射程外（range ≥ 4）不参与选择", () => {
    const creep = hauler([site(4, 0, 290), site(3, 0, 5)]);
    buildRoadSiteUnderfoot(creep);
    expect(creep.build.mock.calls[0]![0].pos.x).toBe(3);
  });

  it("无 WORK 部件时不浪费 find/射程计算（前置守卫）", () => {
    const creep = hauler([site(1, 0, 5)]);
    creep.getActiveBodyparts = vi.fn(() => 0);
    buildRoadSiteUnderfoot(creep);
    expect(creep.build).not.toHaveBeenCalled();
  });
});
