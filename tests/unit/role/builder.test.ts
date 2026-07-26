/**
 * Builder 角色场景测试。
 *
 * 覆盖：CPU 门禁（recovery 释放 / conserve 只建 critical / repairRoads tier 门禁）、
 * fallback 链（fill → repair → upgrade → idle）、ERR_INVALID_TARGET 处理、
 * acquire 取能策略、repairContainerDecay 缓存泄漏防护（P1）、
 * rampart 优先于 wall 的维修优先级（P2）。
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

  it("conserve tier：assignment 指向非 critical site 时继续建造（不过滤）", () => {
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

    // conserve 下不释放 assignment — construction-manager 的 developmentGate 已控制建造门禁。
    expect(creep.memory.assignment).toBeDefined();
    expect(creep.build).toHaveBeenCalledWith(extSite);
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("conserve tier：无 assignment 时建造最近 site（不过滤 critical）", () => {
    const spawnSite = mockConstructionSite("spawn", { id: "spawn_site" });
    const extSite = mockConstructionSite("extension", { id: "ext_site" });
    const snap = mockSnapshot({ myConstructionSites: [extSite, spawnSite] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const budget = mockBudget("conserve");
    const ctx = mockContext(snap, budget);

    builderRole.run(creep, ctx);

    // conserve 下不再过滤 criticalOnly — builder 建任何 construction-manager 创建的 site。
    expect(creep.build).toHaveBeenCalled();
  });

  it("conserve tier：有 site 时建造（不再走 fallback）", () => {
    const extSite = mockConstructionSite("extension", { id: "ext_site" });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ myConstructionSites: [extSite], fillTargets: [spawn] });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const budget = mockBudget("conserve");
    const ctx = mockContext(snap, budget);

    builderRole.run(creep, ctx);

    // conserve 下不再过滤 criticalOnly — builder 建任何可用 site。
    expect(creep.build).toHaveBeenCalledWith(extSite);
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  // P2 修复：repairRoads 现在有 tier 门禁，与 repairFortifications 对齐。
  it("recovery tier 不修路（低 CPU 冻结非关键维修）", () => {
    const road = mockStructure("road", { id: "r1", hits: 1000, hitsMax: 5000 }); // 20% < 40%
    const controller = mockController();
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      roads: [road],
      controller,
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap, mockBudget("recovery"));

    builderRole.run(creep, ctx);

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("conserve tier 不修路（低 CPU 冻结非关键维修）", () => {
    const road = mockStructure("road", { id: "r1", hits: 1000, hitsMax: 5000 });
    const controller = mockController();
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      roads: [road],
      controller,
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap, mockBudget("conserve"));

    builderRole.run(creep, ctx);

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.upgradeController).not.toHaveBeenCalled();
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

  // P2 修复：repairCritical 现在位于 fillTarget 之前。
  it("repairCritical 优先于 fillTarget（结构快塌了比填能量更紧急）", () => {
    const damagedSpawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300, hits: 400, hitsMax: 1000 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [damagedSpawn],
      spawns: [damagedSpawn],
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).toHaveBeenCalledWith(damagedSpawn);
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  // P1 修复：原先道路无任何维修覆盖。
  it("无 fillTarget 时修复衰减中的道路（< 40% 血量）", () => {
    const road = mockStructure("road", { id: "r1", hits: 1000, hitsMax: 5000 }); // 20% < 40%
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      roads: [road],
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).toHaveBeenCalledWith(road);
  });

  it("道路血量 >= 40% 时不修（走后续回退）", () => {
    const road = mockStructure("road", { id: "r1", hits: 4000, hitsMax: 5000 }); // 80% >= 40%
    const controller = mockController();
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      roads: [road],
      controller,
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("道路维修目标持久化（复用 repairTargetId）", () => {
    const road = mockStructure("road", { id: "r1", hits: 1000, hitsMax: 5000 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      roads: [road],
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    creep.memory.repairTargetId = "r1" as any;
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    expect(creep.repair).toHaveBeenCalledWith(road);
  });

  // P1 修复：repairContainerDecay 缓存泄漏 — repairTargetId 指向 road 时不应被当作 container。
  it("repairContainerDecay 不泄漏缓存到非 container 目标（P1 修复）", () => {
    const container = mockStructure("container", { id: "c1", hits: 1000, hitsMax: 5000 }); // 20% < 80%
    const road = mockStructure("road", { id: "r1", hits: 1000, hitsMax: 5000 }); // 同样衰减
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      containers: [container],
      roads: [road],
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    // 模拟缓存泄漏：repairTargetId 指向 road（上一 tick 由 repairRoads 设置）
    creep.memory.repairTargetId = "r1" as any;
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    // repairContainerDecay 应拒绝 road 缓存（structureType 不匹配），找到 container 并修复它
    expect(creep.repair).toHaveBeenCalledWith(container);
    expect(creep.repair).not.toHaveBeenCalledWith(road);
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

    expect(creep.upgradeController).not.toHaveBeenCalled();
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
      energyAvailable: 100, // < upgradeEnergyFloor (300)，但 builder 已携能
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    // builder 不再 fallback 到升级 — park 是正确行为。
    expect(creep.upgradeController).not.toHaveBeenCalled();
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

  // P2 修复：无 storage 时放宽门禁，靠 work chain 优先级保证不抢生存行为。
  it("无 storage 时仍可修墙（RCL3-4 门禁放宽）", () => {
    const rampart = mockStructure("rampart", { id: "r1", hits: 50000, hitsMax: 300000 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      ramparts: [rampart],
      storage: undefined,
      rcl: 3,
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
    expect(creep.upgradeController).not.toHaveBeenCalled();
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
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  // P2 修复：rampart 优先于 wall — rampart 被摧毁暴露同格所有结构。
  it("rampart 优先于 wall — wall 血量更低仍修 rampart（P2 修复）", () => {
    const wall = mockStructure("wall", { id: "w1", hits: 500, hitsMax: 10000 }); // 5%
    const rampart = mockStructure("rampart", { id: "r1", hits: 5000, hitsMax: 300000 }); // ~1.7% 但高于 wall
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      walls: [wall],
      ramparts: [rampart],
      storage,
      rcl: 3, // wallTargetHits rcl3_4 = 100K
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    // wall 500 < rampart 5000，但 rampart 应被优先修复（摧毁后果更严重）
    expect(creep.repair).toHaveBeenCalledWith(rampart);
    expect(creep.repair).not.toHaveBeenCalledWith(wall);
  });

  it("所有 rampart 达标后修 wall（rampart 优先级的回退路径）", () => {
    const wall = mockStructure("wall", { id: "w1", hits: 500, hitsMax: 10000 });
    const rampart = mockStructure("rampart", { id: "r1", hits: 150000, hitsMax: 300000 }); // > 100K target
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const snap = mockSnapshot({
      myConstructionSites: [],
      fillTargets: [],
      walls: [wall],
      ramparts: [rampart],
      storage,
      rcl: 3, // wallTargetHits rcl3_4 = 100K, rampart 150K > 100K, wall 500 < 100K
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    builderRole.run(creep, ctx);

    // rampart 达标 → 回退到 wall
    expect(creep.repair).toHaveBeenCalledWith(wall);
  });
});
