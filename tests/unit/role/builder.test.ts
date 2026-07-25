/**
 * Builder 角色场景测试。
 *
 * 覆盖：CPU 门禁（recovery 释放 / conserve 只建 critical）、fallback 链
 *（fill → repair → upgrade → idle）、ERR_INVALID_TARGET 处理、acquire 取能策略。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { builderRole } from "../../../src/creeps/roles/builder";
import {
  mockBudget,
  mockConstructionSite,
  mockContext,
  mockController,
  mockCreep,
  mockHostile,
  mockSnapshot,
  mockSource,
  mockStructure,
  resetGlobals,
} from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("builder — work 模式正常建造", () => {
  it("建造 assignment 指定的 site", () => {
    const site = mockConstructionSite("extension", { id: "site_1" });
    const snap = mockSnapshot({ myConstructionSites: [site] });
    const creep = mockCreep({
      name: "builder_1",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
      assignment: { id: "t1", kind: "build", targetId: "site_1", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.build).toHaveBeenCalledWith(site);
  });

  it("无 assignment 时建造最近 site", () => {
    const site = mockConstructionSite("extension", { id: "site_1" });
    const snap = mockSnapshot({ myConstructionSites: [site] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.build).toHaveBeenCalledWith(site);
  });

  it("ERR_INVALID_TARGET 时释放 assignment", () => {
    const site = mockConstructionSite("extension", { id: "site_1" });
    const snap = mockSnapshot({ myConstructionSites: [site] });
    const creep = mockCreep({
      name: "builder_1",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
      assignment: { id: "t1", kind: "build", targetId: "site_1", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    creep.build.mockReturnValue(-7); // ERR_INVALID_TARGET
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.memory.assignment).toBeUndefined();
  });
});

describe("builder — CPU 门禁", () => {
  it("recovery tier：释放 assignment 并走 fallback", () => {
    const site = mockConstructionSite("extension", { id: "site_1" });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ myConstructionSites: [site], fillTargets: [spawn] });
    const creep = mockCreep({
      name: "builder_1",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
      assignment: { id: "t1", kind: "build", targetId: "site_1", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    const budget = mockBudget("recovery");
    const ctx = mockContext(snap, budget);

    builderRole.run(creep, ctx);

    // recovery → 释放 assignment → fallback → fill。
    expect(creep.memory.assignment).toBeUndefined();
    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("conserve tier：assignment 指向非 critical site 时释放并走 fallback", () => {
    const extSite = mockConstructionSite("extension", { id: "ext_site" });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ myConstructionSites: [extSite], fillTargets: [spawn] });
    const creep = mockCreep({
      name: "builder_1",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
      assignment: { id: "t1", kind: "build", targetId: "ext_site", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    const budget = mockBudget("conserve");
    const ctx = mockContext(snap, budget);

    builderRole.run(creep, ctx);

    // conserve + 非 critical → 释放 → fallback → fill。
    expect(creep.memory.assignment).toBeUndefined();
    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("conserve tier：无 assignment 时只建造 critical site（spawn/tower）", () => {
    const spawnSite = mockConstructionSite("spawn", { id: "spawn_site" });
    const extSite = mockConstructionSite("extension", { id: "ext_site" });
    const snap = mockSnapshot({ myConstructionSites: [extSite, spawnSite] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const budget = mockBudget("conserve");
    const ctx = mockContext(snap, budget);

    builderRole.run(creep, ctx);

    // 无 assignment → 过滤 critical → 只建 spawn site。
    expect(creep.build).toHaveBeenCalledWith(spawnSite);
  });

  it("conserve tier：无 critical site 时走 fallback", () => {
    const extSite = mockConstructionSite("extension", { id: "ext_site" });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ myConstructionSites: [extSite], fillTargets: [spawn] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const budget = mockBudget("conserve");
    const ctx = mockContext(snap, budget);

    builderRole.run(creep, ctx);

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });
});

describe("builder — fallback 链", () => {
  it("无 site 时填充 spawn/extension", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ myConstructionSites: [], fillTargets: [spawn] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("无 fillTarget 时修复 critical 结构（血量 < 50%）", () => {
    const damagedSpawn = mockStructure("spawn", { id: "sp1", energy: 300, capacity: 300, hits: 400, hitsMax: 1000 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      spawns: [damagedSpawn],
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).toHaveBeenCalledWith(damagedSpawn);
  });

  it("无 fill/repair 时升级控制器（能量 >= floor）", () => {
    const controller = mockController();
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      spawns: [],
      extensions: [],
      towers: [],
      containers: [],
      controller,
      energyAvailable: 500, // >= upgradeEnergyFloor (300)
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("能量低于 floor 时仍升级（builder 用自身携带的能量，不消耗 extension）", () => {
    const controller = mockController();
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      spawns: [],
      extensions: [],
      towers: [],
      containers: [],
      controller,
      energyAvailable: 100, // < upgradeEnergyFloor (300)，但 builder 已携能，无更好去向
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
    expect(creep.memory.mode).not.toBe("idle");
  });
});

describe("builder — acquire 模式", () => {
  it("优先从最近有能量的 container 取能", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 500, capacity: 2000 });
    const c2 = mockStructure("container", { id: "c2", energy: 800, capacity: 2000 });
    c1.pos.getRangeTo.mockReturnValue(5); // 非 source 相邻
    c2.pos.getRangeTo.mockReturnValue(5);
    const snap = mockSnapshot({ containers: [c1, c2] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 0, capacity: 50, mode: "acquire" });
    // c1 更近（getRangeTo 默认返回 1）。
    creep.pos.getRangeTo.mockImplementation((target: any) => {
      if (target.id === "c1") return 2;
      if (target.id === "c2") return 8;
      return 5;
    });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    // 应选最近的 c1（距离 2）而非最满的 c2。
    expect(creep.withdraw).toHaveBeenCalledWith(c1, "energy");
  });

  it("无 container 时回退到 harvest", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ containers: [], sources: [source], sourceOccupancy: new Map([["s1", 0]]) });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.harvest).toHaveBeenCalledWith(source);
  });
});

describe("builder — flee", () => {
  it("有敌人时 flee 且不建造", () => {
    const hostile = mockHostile();
    const site = mockConstructionSite("extension", { id: "site_1" });
    const snap = mockSnapshot({ hostileCreeps: [hostile], myConstructionSites: [site] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    expect(creep.build).not.toHaveBeenCalled();
  });

  it("入侵期间不修墙（fortifications 被威胁门禁拦截）", () => {
    const hostile = mockHostile();
    const rampart = mockStructure("rampart", { id: "r1", hits: 50000, hitsMax: 300000 });
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const snap = mockSnapshot({
      hostileCreeps: [hostile],
      myConstructionSites: [],
      fillTargets: [],
      ramparts: [rampart],
      storage,
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).not.toHaveBeenCalled();
  });
});

describe("builder — B3 防御工事维修（维修权从塔移交 creep）", () => {
  it("盈余门禁满足时修复血量最低的 rampart", () => {
    const rampart = mockStructure("rampart", { id: "r1", hits: 50000, hitsMax: 300000 });
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      ramparts: [rampart],
      storage,
      rcl: 3, // wallTargetHits rcl3_4 = 100K，rampart 50K 低于目标
      energyAvailable: 100,
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).toHaveBeenCalledWith(rampart);
  });

  it("storage 能量不足（< 10k）不修墙，走升级回退", () => {
    const rampart = mockStructure("rampart", { id: "r1", hits: 50000, hitsMax: 300000 });
    const storage = mockStructure("storage", { id: "st", energy: 5000, capacity: 1000000 });
    const controller = mockController();
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      ramparts: [rampart],
      storage,
      controller,
      energyAvailable: 500, // >= upgradeEnergyFloor → 升级兜底
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("conserve tier 不修墙（低 CPU 冻结发展性维修）", () => {
    const rampart = mockStructure("rampart", { id: "r1", hits: 50000, hitsMax: 300000 });
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [spawn],
      ramparts: [rampart],
      storage,
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap, mockBudget("conserve"));

    builderRole.run(creep, ctx);

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("rampart 已达目标血量不修（无目标 → 走后续回退）", () => {
    const rampart = mockStructure("rampart", { id: "r1", hits: 150000, hitsMax: 300000 });
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const controller = mockController();
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      ramparts: [rampart],
      storage,
      controller,
      rcl: 3, // 目标 100K，rampart 150K 已达标
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });
});
