/**
 * RM-1 回归 — remote-harvester 自建 source container（终结 drop-mining 衰减税）。
 *
 * P0-A 收编后：角色层不再调 createConstructionSite，改写 needContainer 申请标记，
 * 由 remote-mining-manager 每 managerInterval tick 消费。
 *
 * 线上实测（W37S57）：无 container 的 active 远矿房地面堆积 3300+ 能量，
 * 衰减 ~40% 产出 — 决策阈值 5%，补建造链。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteHarvesterRole } from "../../../src/creeps/roles/remote-harvester";
import { mockContext, mockSnapshot, mockCreep, mockSource, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

/** 站桩位满载的 remote-harvester（在 remoteTarget 房内）。 */
function stationedHarvester(opts: { sites?: any[]; containers?: any[] } = {}): any {
  const source = mockSource("rs1");
  const creep = mockCreep({
    name: "rh_1", role: "remoteHarvester", used: 100, capacity: 100,
    mode: "work", sourceId: "rs1",
  });
  creep.memory.remoteTarget = "W8N4";
  creep.room = {
    name: "W8N4",
    find: vi.fn(() => [source]),
    lookForAtArea: vi.fn((look: string) => {
      if (look === "structure") {
        return (opts.containers ?? []).map((c: any) => ({ structure: c }));
      }
      return (opts.sites ?? []).map((s: any) => ({ constructionSite: s }));
    }),
    createConstructionSite: vi.fn(() => 0),
    lookForAt: vi.fn(() => []),
  };
  creep.pos.getRangeTo = vi.fn(() => 1); // 站桩位。
  return creep;
}

describe("RM-1 — remote-harvester 自建 source container", () => {
  it("满载 + 无 container + 无 site → 写 needContainer 申请标记（P0-A 收编后不直接创建）", () => {
    const creep = stationedHarvester();
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.memory.needContainer).toBe(true);
    // 角色层禁止调 createConstructionSite — 由 remote-mining-manager 消费标记。
    expect(creep.room.createConstructionSite).not.toHaveBeenCalled();
    // 本 tick buildSourceContainer 候选命中并消费了 tick，不走 dropEnergy。
    expect(creep.drop).not.toHaveBeenCalled();
  });

  it("满载 + 有 container site → build（能量转进度而非衰减）", () => {
    const site = { id: "cs1", structureType: "container", pos: { x: 25, y: 25 } };
    const creep = stationedHarvester({ sites: [site] });
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).toHaveBeenCalledWith(site);
    expect(creep.room.createConstructionSite).not.toHaveBeenCalled();
  });

  it("container 已建成 → 不再触发建造链（倒能路径接管）", () => {
    const container = {
      id: "rc1", structureType: "container",
      pos: { getRangeTo: vi.fn(() => 1), x: 25, y: 26 },
      store: { getFreeCapacity: vi.fn(() => 1000), getUsedCapacity: vi.fn(() => 0) },
    };
    const creep = stationedHarvester({ containers: [container] });
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.room.createConstructionSite).not.toHaveBeenCalled();
    // stationaryMine 同 tick 倒能进 container。
    expect(creep.transfer).toHaveBeenCalledWith(container, "energy");
  });

  it("半载不投入建造 — 继续采集（建造只用必然溢出的能量）", () => {
    const creep = stationedHarvester();
    creep.store = {
      getUsedCapacity: vi.fn(() => 50),
      getFreeCapacity: vi.fn(() => 50),
      getCapacity: vi.fn(() => 100),
      energy: 50,
    };
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.room.createConstructionSite).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalled();
  });

  it("已申请 needContainer → buildSourceContainer 跳过（不创建、不 build、标记保持）", () => {
    const creep = stationedHarvester();
    creep.memory.needContainer = true;
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    // needContainer=true 时 buildSourceContainer resolve 返回 undefined，候选链继续。
    // 下一个候选 remoteStationaryMine 会采能（满载 creep 在 source 旁照常采集）。
    // 关键断言：不调 createConstructionSite、不 build（无 site）、标记保持待 manager 消费。
    expect(creep.room.createConstructionSite).not.toHaveBeenCalled();
    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.memory.needContainer).toBe(true);
    // creep 照常采集（不会因申请标记停摆）。
    expect(creep.harvest).toHaveBeenCalled();
  });

  it("冷却期内有 site → 仍可 build（cooldown 只阻断 create 不阻断 build）", () => {
    const site = { id: "cs1", structureType: "container", pos: { x: 25, y: 25 } };
    const creep = stationedHarvester({ sites: [site] });
    creep.memory.containerSiteCooldown = 1050; // Game.time=1000，冷却到 1050
    remoteHarvesterRole.run(creep, mockContext(mockSnapshot()));

    // site 检查在 cooldown 之前 — 有 site 照常 build。
    expect(creep.build).toHaveBeenCalledWith(site);
    expect(creep.room.createConstructionSite).not.toHaveBeenCalled();
  });
});
