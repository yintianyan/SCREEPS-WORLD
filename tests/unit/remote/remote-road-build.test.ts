/**
 * RM-3 回归 — remote-harvester 用「满载且 container 装不下」的那脚溢出能量施工远矿 road site。
 *
 * 立案现场（2026-10-17 线上现读）：`remoteRoadLane`＝pendingTotal 21／cap 20／headroom −1／
 * saturated true，同发自检面 20 枚违例逐字 `type=road prog=10~40/300 noProg=5043 workers=3`。
 * 根因＝build 任务只从自有房 snapshot 生成（assignment/service.ts:163-194 ＋ kernel.ts:465-466），
 * 远矿 site 从不进任务池，而远矿角色链里唯一的建造候选只认 STRUCTURE_CONTAINER。
 *
 * 本文件两头都钉：新候选在最需要的态里可达（1、6、7），且**不抢收入**（2、3、5）与
 * 不改无关行为的射程／房间边界（4）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteHarvesterRole } from "../../../src/creeps/roles/remote-harvester";
import {
  mockContext,
  mockSnapshot,
  mockCreep,
  mockSource,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

const ROAD_SITE = { id: "road1", structureType: "road", pos: { x: 26, y: 25 } };
const CONTAINER_SITE = { id: "csite1", structureType: "container", pos: { x: 25, y: 25 } };

/** container 读数：full=true → 仓位 0（能量必定落地）；false → 还有 1,000 仓位（正常倒能）。 */
function sourceContainer(full: boolean): any {
  return {
    id: "rc1",
    structureType: "container",
    pos: { x: 25, y: 26, getRangeTo: vi.fn(() => 1) },
    hits: 250000,
    hitsMax: 250000,
    store: {
      getFreeCapacity: vi.fn(() => (full ? 0 : 1000)),
      getUsedCapacity: vi.fn(() => 10000),
      getCapacity: vi.fn(() => 10000),
    },
  };
}

/**
 * 站桩位／通勤位上的满载 remote-harvester。
 * `sites` 走 LOOK_CONSTRUCTION_SITES 支、`containers` 走 LOOK_STRUCTURES 支（与 RM-1 同款 mock）。
 */
function harvester(opts: {
  sites?: any[];
  containers?: any[];
  used?: number;
  capacity?: number;
  /** creep 此刻所在房（默认＝remoteTarget，即在 op 房内）。 */
  creepRoom?: string;
  remoteTarget?: string;
}): any {
  const source = mockSource("rs1");
  const creep = mockCreep({
    name: "rh_1",
    role: "remoteHarvester",
    used: opts.used ?? 100,
    capacity: opts.capacity ?? 100,
    mode: "work",
    sourceId: "rs1",
  });
  const remoteTarget = opts.remoteTarget ?? "W8N4";
  creep.memory.remoteTarget = remoteTarget;
  creep.room = {
    name: opts.creepRoom ?? remoteTarget,
    // ERR_NO_PATH：跑错房／丢 remoteTarget 时 role-runner 的 ensureHome 会走 moveTowardRoom，
    // 这里让它求不到出口就直接返回，测试只核"施工腿没被仲裁"这一件事。
    findExitTo: vi.fn(() => -11),
    find: vi.fn(() => [source]),
    lookForAtArea: vi.fn((look: string) => {
      if (look === "structure") return (opts.containers ?? []).map((c: any) => ({ structure: c }));
      return (opts.sites ?? []).map((s: any) => ({ constructionSite: s }));
    }),
    createConstructionSite: vi.fn(() => 0),
    lookForAt: vi.fn(() => []),
  };
  creep.pos.getRangeTo = vi.fn(() => 1);
  return creep;
}

describe("RM-3 — 满载溢出能量施工远矿 road site", () => {
  it("满载 + container 满 + 射程内有 road site → build(site)，不 drop、不白采", () => {
    const creep = harvester({ sites: [ROAD_SITE], containers: [sourceContainer(true)] });
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).toHaveBeenCalledWith(ROAD_SITE);
    // 这一脚能量变成路面进度而不是落到地上衰减。
    expect(creep.drop).not.toHaveBeenCalled();
    // 候选链被 build 消费：不再对已满载的 source 白签一次 harvest（ERR_FULL）。
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("满载但 container 还装得下 → 先倒能，路面施工不抢这条收入腿", () => {
    const creep = harvester({ sites: [ROAD_SITE], containers: [sourceContainer(false)] });
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalled();
  });

  it("半载 → 继续采集，本候选不触发（建造只用必然溢出的能量）", () => {
    const creep = harvester({
      sites: [ROAD_SITE],
      containers: [sourceContainer(true)],
      used: 40,
    });
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalled();
  });

  it("射程内没有 road site（只有 container site）→ 行为与上线前一致（落回原链）", () => {
    const creep = harvester({ sites: [CONTAINER_SITE], containers: [sourceContainer(true)] });
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.drop).not.toHaveBeenCalled();
  });

  it("不在 op 房（通勤途中）→ 不替别的房施工，即便满载且脚下就有 road site", () => {
    const creep = harvester({
      sites: [ROAD_SITE],
      containers: [sourceContainer(true)],
      creepRoom: "W7N4",
    });
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).not.toHaveBeenCalled();
  });

  it("memory.remoteTarget 缺失 → 整条施工腿不参与仲裁", () => {
    const creep = harvester({ sites: [ROAD_SITE], containers: [sourceContainer(true)] });
    delete creep.memory.remoteTarget;
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).not.toHaveBeenCalled();
  });

  it("build 返 ERR_NOT_IN_RANGE → 走向 site（moveRange=3），这一脚不白签", () => {
    const creep = harvester({ sites: [ROAD_SITE], containers: [sourceContainer(true)] });
    creep.build = vi.fn(() => -9);
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).toHaveBeenCalledWith(ROAD_SITE);
    // 引擎直发出口（traffic 在单测里默认关闭）：moveTo／move 至少走一条。
    expect(creep.moveTo.mock.calls.length + creep.move.mock.calls.length).toBeGreaterThan(0);
    expect(creep.drop).not.toHaveBeenCalled();
  });
});
