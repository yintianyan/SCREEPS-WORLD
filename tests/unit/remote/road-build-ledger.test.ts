/**
 * 通勤建路实测账本 —— 「这一拍到底为什么没施工」必须被记下来，而不是被反复猜。
 *
 * 立案理由（线上）：远矿 road site 挂满全帝国车道上限（20）而**建成道路恒为 0**，从
 * 2026-09-23 查到今天定了三次案又被三次推翻（代价参数、落点错配、body 无 WORK）。
 * 三次都栽在同一件事上：现场只给了 `site.progress` 一个数，而「没机会施工 / 有机会但被
 * 摊薄 / 有力气没能量」这三种成因都能解释它。这份账本就是那条缺席的证据链。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRoadSiteUnderfoot } from "../../../src/creeps/roles/remote-hauler";
import { roadBuildCounters } from "../../../src/kernel/global-cache";
import {
  classifyRoadBuildAttempt,
  roadBuildRangeBucket,
} from "../../../src/domain/logistics/road-build";
import { resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;

let tickSeed = 90000;
function site(x: number, y: number, progress = 0): any {
  return { structureType: STRUCTURE_ROAD, pos: { x, y }, progress };
}

/** creep 站在 (0,0)；getRangeTo 返回切比雪夫距离。每用例换 tick 以避开 per-tick site 缓存。 */
function hauler(opts: { sites?: any[]; energy?: number; work?: number; buildCode?: number }): any {
  g().Game.time = ++tickSeed;
  return {
    store: { getUsedCapacity: vi.fn(() => opts.energy ?? 500) },
    getActiveBodyparts: vi.fn(() => opts.work ?? 1),
    pos: { getRangeTo: (s: any) => Math.max(Math.abs(s.pos.x), Math.abs(s.pos.y)) },
    room: { name: "W37S54", find: vi.fn(() => opts.sites ?? []) },
    build: vi.fn(() => opts.buildCode ?? OK),
  };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  g().roadBuildLedger = undefined; // 账本是 heap 的，跨用例必须清，否则计数串味
});

describe("road-build — classifyRoadBuildAttempt（唯一归因，按早退顺序）", () => {
  it("没能量优先于一切（背包空时后面都无从谈起）", () => {
    expect(
      classifyRoadBuildAttempt({ energyInStore: 0, workParts: 0, siteCount: 3, inRangeCount: 2 }),
    ).toBe("noEnergy");
  });

  it("有能但无 WORK → noWork", () => {
    expect(
      classifyRoadBuildAttempt({ energyInStore: 500, workParts: 0, siteCount: 3, inRangeCount: 2 }),
    ).toBe("noWork");
  });

  it("房内一个自己的 site 都没有 → noSiteAtAll（规划器没铺）", () => {
    expect(
      classifyRoadBuildAttempt({ energyInStore: 500, workParts: 1, siteCount: 0, inRangeCount: 0 }),
    ).toBe("noSiteAtAll");
  });

  it("有 site 但都在射程外 → outOfRange（落点与通勤线不相交的直接证据）", () => {
    expect(
      classifyRoadBuildAttempt({
        energyInStore: 500,
        workParts: 1,
        siteCount: 20,
        inRangeCount: 0,
      }),
    ).toBe("outOfRange");
  });

  it("能、人、格三者齐备 → proceed", () => {
    expect(
      classifyRoadBuildAttempt({
        energyInStore: 500,
        workParts: 1,
        siteCount: 20,
        inRangeCount: 3,
      }),
    ).toBe("proceed");
  });

  it("建行处的零值把每个桶都摆出来（体检脚本据此分清「这一路从未执行」与「读到 0」）", () => {
    expect(roadBuildCounters("W37S54")).toEqual({
      calls: 0,
      noEnergy: 0,
      noEnergyInRange: 0,
      noWork: 0,
      noSiteAtAll: 0,
      outOfRange: 0,
      outOfRangeNear: 0,
      outOfRangeMid: 0,
      outOfRangeFar: 0,
      built: 0,
      buildRejected: 0,
      roadProgressSum: 0,
      roadSitesPending: 0,
      roadsBuilt: 0,
    });
  });
});

describe("buildRoadSiteUnderfoot — 账本按房归桶，且不改变执行侧行为", () => {
  it("射程内有格：记 built，并按旧判据建进度最高的那一格", () => {
    const creep = hauler({ sites: [site(2, 0, 5), site(2, 2, 290)] });
    buildRoadSiteUnderfoot(creep);
    expect(creep.build.mock.calls[0]![0].progress).toBe(290);
    const counters = roadBuildCounters("W37S54");
    expect(counters.calls).toBe(1);
    expect(counters.built).toBe(1);
    expect(counters.buildRejected).toBe(0);
  });

  it("背包空：记 noEnergy 且不发 build（满载腿先交能、脚下就没力气 —— 情形③）", () => {
    const creep = hauler({ sites: [site(1, 1)], energy: 0 });
    buildRoadSiteUnderfoot(creep);
    expect(creep.build).not.toHaveBeenCalled();
    expect(roadBuildCounters("W37S54").noEnergy).toBe(1);
  });

  it("背包空但脚下有格且带 WORK → 追加记 noEnergyInRange（(B) 修法的定价入口），仍不发 build", () => {
    const creep = hauler({ sites: [site(1, 1), site(9, 9)], energy: 0 });
    buildRoadSiteUnderfoot(creep);
    expect(creep.build).not.toHaveBeenCalled();
    const counters = roadBuildCounters("W37S54");
    expect(counters.calls).toBe(1);
    expect(counters.noEnergy).toBe(1);
    // 两格里只有 (1,1) 在射程内 ⇒ 子集关系：noEnergyInRange 可与 noEnergy 同为 1，但两者不可相加。
    expect(counters.noEnergyInRange).toBe(1);
  });

  it("背包空且最近 site 在射程外 → noEnergyInRange 不记（留着能量也没处建，动作属落点不属时机）", () => {
    const creep = hauler({ sites: [site(6, 6)], energy: 0 });
    buildRoadSiteUnderfoot(creep);
    const counters = roadBuildCounters("W37S54");
    expect(counters.noEnergy).toBe(1);
    expect(counters.noEnergyInRange).toBe(0);
  });

  it("背包空且 body 无 WORK → noEnergyInRange 不记（那一类的动作是换 body，不是留能量）", () => {
    const creep = hauler({ sites: [site(1, 1)], energy: 0, work: 0 });
    buildRoadSiteUnderfoot(creep);
    const counters = roadBuildCounters("W37S54");
    expect(counters.noEnergy).toBe(1);
    expect(counters.noEnergyInRange).toBe(0);
  });

  it("满载那一拍不落入新桶（控制组）：built 记 1、noEnergyInRange 恒 0", () => {
    const creep = hauler({ sites: [site(1, 1)], energy: 500 });
    buildRoadSiteUnderfoot(creep);
    const counters = roadBuildCounters("W37S54");
    expect(counters.built).toBe(1);
    expect(counters.noEnergy).toBe(0);
    expect(counters.noEnergyInRange).toBe(0);
  });

  it("site 全在射程外：记 outOfRange 而不发 build（情形①的直接读数）", () => {
    const creep = hauler({ sites: [site(9, 9), site(13, 2)] });
    buildRoadSiteUnderfoot(creep);
    expect(creep.build).not.toHaveBeenCalled();
    const counters = roadBuildCounters("W37S54");
    expect(counters.outOfRange).toBe(1);
    expect(counters.calls).toBe(1);
    // 最近的一格是 (9,9) → range 9 → mid 桶（差 6-10 格 = 同一条走廊但铺错了段）。
    expect(counters.outOfRangeMid).toBe(1);
    expect(counters.outOfRangeNear).toBe(0);
    expect(counters.outOfRangeFar).toBe(0);
  });

  it("只差 4 格与差 20 格记进不同桶 —— 这两个形状要的动作完全相反", () => {
    buildRoadSiteUnderfoot(hauler({ sites: [site(4, 0)] }));
    const b = hauler({ sites: [site(20, 1)] });
    b.room.name = "W37S55";
    buildRoadSiteUnderfoot(b);
    expect(roadBuildCounters("W37S54").outOfRangeNear).toBe(1);
    expect(roadBuildCounters("W37S55").outOfRangeFar).toBe(1);
  });

  it("引擎拒绝 build 时记 buildRejected（区别于「压根没发」）", () => {
    const creep = hauler({ sites: [site(1, 0)], buildCode: ERR_NOT_IN_RANGE });
    buildRoadSiteUnderfoot(creep);
    expect(creep.build).toHaveBeenCalled();
    const counters = roadBuildCounters("W37S54");
    expect(counters.built).toBe(0);
    expect(counters.buildRejected).toBe(1);
  });

  it("账本按房分桶 —— 两个远矿房不能记在同一行上", () => {
    const a = hauler({ sites: [site(1, 0)] });
    buildRoadSiteUnderfoot(a);
    const b = hauler({ sites: [] });
    b.room.name = "W36S58";
    buildRoadSiteUnderfoot(b);
    expect(roadBuildCounters("W37S54").built).toBe(1);
    expect(roadBuildCounters("W36S58").noSiteAtAll).toBe(1);
    expect(roadBuildCounters("W36S58").built).toBe(0);
  });
});

describe("road-build — outOfRange 的距离分桶边界", () => {
  it("4-5 格算 near（放宽一点射程就能建）", () => {
    expect(roadBuildRangeBucket(4)).toBe("outOfRangeNear");
    expect(roadBuildRangeBucket(5)).toBe("outOfRangeNear");
  });

  it("6-10 格算 mid（同一条走廊但铺错了段）", () => {
    expect(roadBuildRangeBucket(6)).toBe("outOfRangeMid");
    expect(roadBuildRangeBucket(10)).toBe("outOfRangeMid");
  });

  it("11 格以上算 far（根本在另一条线上），Infinity 也归 far", () => {
    expect(roadBuildRangeBucket(11)).toBe("outOfRangeFar");
    expect(roadBuildRangeBucket(48)).toBe("outOfRangeFar");
    expect(roadBuildRangeBucket(Number.POSITIVE_INFINITY)).toBe("outOfRangeFar");
  });
});
