import { describe, expect, it, beforeEach } from "vitest";
import {
  buildRoomTasks,
  validateAssignmentRules,
  chooseTaskForRole,
  getInvalidatedCreepNames,
  type CreepAssignmentRef,
  type RoomTaskFlags,
} from "../../../src/domain/assignment/service";
import { TaskPool } from "../../../src/domain/assignment/task-pool";
import { globalCache } from "../../../src/kernel/global-cache";
import { CONFIG } from "../../../src/config";
import type { RoomSnapshot, ColonyState } from "../../../src/kernel/contracts";

// ── mock 辅助函数 ──
function mockSnapshot(overrides?: Partial<RoomSnapshot>): RoomSnapshot {
  return {
    roomName: "W1N1",
    rcl: 2,
    controller: undefined,
    spawns: [],
    extensions: [],
    towers: [],
    containers: [],
    roads: [],
    walls: [],
    ramparts: [],
    storage: undefined,
    controllerContainer: undefined,
    links: [],
    sources: [],
    constructionSites: [],
    myConstructionSites: [],
    hostileCreeps: [],
    threatCreeps: [],
    squadThreat: false,
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map(),
    pendingHarvesters: 0,
    minerals: [],
    labs: [],
    terminal: undefined,
    extractor: undefined,
    factory: undefined,
    droppedEnergy: [],
    tombstones: [],
    ruins: [],
    ...overrides,
  };
}

function mockFlags(overrides?: Partial<RoomTaskFlags>): RoomTaskFlags {
  return {
    colonyState: "normal" as ColonyState,
    controllerDowngradeRisk: false,
    ...overrides,
  };
}

/** 创建一个带有 assignment 的 creep 摘要。 */
function creepRef(
  name: string,
  home: string,
  assignment?: { id: string; kind: string; sourceId?: string },
): CreepAssignmentRef {
  return { name, home, assignment };
}

// ── 初始化全局状态 ──
beforeEach(() => {
  const g = globalCache();
  g.assignment = undefined;
  g.errorLog = undefined;
  g.errorCounts = undefined;
  g.pluginCooldowns = undefined;
  g.telemetry = undefined;
});

// ── buildRoomTasks ──
describe("Assignment — buildRoomTasks (pure)", () => {
  it("does not generate harvest tasks (source 分配统一归 targeting.getSource, P1-1)", () => {
    const source1 = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const source2 = { id: "src2", pos: { x: 40, y: 40, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source1, source2] });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());

    // harvest 任务已移除 — source 拥挤控制由 targeting.getSource 的公平份额完成，
    // 不再经 assignment 系统（消除双轨制）。
    const harvestTasks = tasks.filter(t => t.kind === "harvest");
    expect(harvestTasks).toHaveLength(0);
  });

  it("generates fill task when fillTargets exist", () => {
    const spawn = { pos: { x: 25, y: 25 }, store: { getFreeCapacity: () => 100 } } as unknown as StructureSpawn;
    const snapshot = mockSnapshot({
      spawns: [spawn],
      fillTargets: [spawn],
      energyAvailable: 100,
    });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());

    const fillTasks = tasks.filter(t => t.kind === "fill");
    expect(fillTasks).toHaveLength(1);
    // energyAvailable(100) < 动态阈值(300*0.4=120) → priority 0
    expect(fillTasks[0]?.priority).toBe(0);
  });

  it("generates build tasks for construction sites", () => {
    const site = { id: "site1", pos: { x: 20, y: 20 }, structureType: STRUCTURE_EXTENSION } as unknown as ConstructionSite;
    const snapshot = mockSnapshot({ myConstructionSites: [site] });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());

    const buildTasks = tasks.filter(t => t.kind === "build");
    expect(buildTasks).toHaveLength(1);
    expect(buildTasks[0]?.targetId).toBe("site1");
  });

  // ── Storage 建造优先级（P0 修复：经济中枢断裂）──
  // 根因：RCL4+ 无 storage 时 lease 机制让 builder 保持旧 extension assignment，
  // storage site 无人建造。修复：buildRoomTasks 将 storage site 标记为 priority=1, maxWorkers=3。
  it("RCL4+ 无 storage 时 storage site 提升为 priority=1, maxWorkers=3", () => {
    const storageSite = { id: "site-storage", pos: { x: 24, y: 23 }, structureType: STRUCTURE_STORAGE } as unknown as ConstructionSite;
    const extSite = { id: "site-ext", pos: { x: 20, y: 20 }, structureType: STRUCTURE_EXTENSION } as unknown as ConstructionSite;
    const snapshot = mockSnapshot({
      rcl: 5,
      storage: undefined,
      myConstructionSites: [storageSite, extSite],
    });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());

    const storageTask = tasks.find(t => t.targetId === "site-storage");
    const extTask = tasks.find(t => t.targetId === "site-ext");

    // storage 是经济中枢，priority=1（与 critical 同级），maxWorkers=2（集中主力但留 1 给 extension）
    expect(storageTask).toBeDefined();
    expect(storageTask!.priority).toBe(1);
    expect(storageTask!.maxWorkers).toBe(2);

    // extension 是普通建造，priority=2, maxWorkers=1
    expect(extTask).toBeDefined();
    expect(extTask!.priority).toBe(2);
    expect(extTask!.maxWorkers).toBe(1);

    // storage 优先级严格高于 extension — builder 会优先选 storage
    expect(storageTask!.priority).toBeLessThan(extTask!.priority);
  });

  it("RCL3 不对 storage site 特殊处理（未解锁 storage）", () => {
    const storageSite = { id: "site-storage", pos: { x: 24, y: 23 }, structureType: STRUCTURE_STORAGE } as unknown as ConstructionSite;
    const snapshot = mockSnapshot({
      rcl: 3,
      storage: undefined,
      myConstructionSites: [storageSite],
    });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());

    const storageTask = tasks.find(t => t.targetId === "site-storage");
    // RCL3 未解锁 storage，needsStorage=false → 不特殊处理
    expect(storageTask).toBeDefined();
    expect(storageTask!.priority).toBe(2);
    expect(storageTask!.maxWorkers).toBe(1);
  });

  it("storage 已建成时 storage site 不特殊处理", () => {
    const storageSite = { id: "site-storage", pos: { x: 24, y: 23 }, structureType: STRUCTURE_STORAGE } as unknown as ConstructionSite;
    const builtStorage = {
      id: "built-storage",
      pos: { x: 25, y: 25 },
      structureType: STRUCTURE_STORAGE,
      store: { getUsedCapacity: () => 0 },
    } as unknown as StructureStorage;
    const snapshot = mockSnapshot({
      rcl: 5,
      storage: builtStorage,
      myConstructionSites: [storageSite],
    });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());

    const storageTask = tasks.find(t => t.targetId === "site-storage");
    // storage 已建成，needsStorage=false → 不特殊处理
    expect(storageTask).toBeDefined();
    expect(storageTask!.priority).toBe(2);
  });

  it("generates upgrade task in normal state", () => {
    const controller = { id: "ctrl1", my: true, pos: { x: 30, y: 30 } } as unknown as StructureController;
    const snapshot = mockSnapshot({ controller });

    const tasks = buildRoomTasks(snapshot, [], mockFlags({ colonyState: "normal" }));

    const upgradeTasks = tasks.filter(t => t.kind === "upgrade");
    expect(upgradeTasks).toHaveLength(1);
  });

  it("does not generate upgrade task in bootstrap", () => {
    const controller = { id: "ctrl1", my: true, pos: { x: 30, y: 30 } } as unknown as StructureController;
    const snapshot = mockSnapshot({ controller });

    const tasks = buildRoomTasks(snapshot, [], mockFlags({ colonyState: "bootstrap" }));

    const upgradeTasks = tasks.filter(t => t.kind === "upgrade");
    expect(upgradeTasks).toHaveLength(0);
  });

  it("aggregates assigned creeps across multiple task types in single pass", () => {
    const site = { id: "site1", pos: { x: 20, y: 20 }, structureType: STRUCTURE_EXTENSION } as unknown as ConstructionSite;
    const snapshot = mockSnapshot({
      myConstructionSites: [site],
      fillTargets: [{ id: "ext1" } as unknown as StructureExtension],
    });

    const creeps: CreepAssignmentRef[] = [
      creepRef("b1", "W1N1", { id: "build:W1N1:site1", kind: "build" }),
      creepRef("b2", "W1N1", { id: "build:W1N1:site1", kind: "build" }),
      creepRef("f1", "W1N1", { id: "fill:W1N1", kind: "fill" }),
      // 其他房的 creep 应被过滤掉。
      creepRef("other", "W2N2", { id: "build:W1N1:site1", kind: "build" }),
    ];

    const tasks = buildRoomTasks(snapshot, creeps, mockFlags());

    const buildTask = tasks.find(t => t.id === "build:W1N1:site1")!;
    expect(buildTask.assignedCreeps).toEqual(expect.arrayContaining(["b1", "b2"]));
    expect(buildTask.assignedCreeps).toHaveLength(2);
    expect(buildTask.assignedCreeps).not.toContain("other");

    const fillTask = tasks.find(t => t.id === "fill:W1N1")!;
    expect(fillTask.assignedCreeps).toEqual(["f1"]);
  });
});

// ── validateAssignmentRules (pure) ──
describe("Assignment — validateAssignmentRules (pure)", () => {
  const validAssignment: CreepAssignment = {
    id: "harvest:W1N1:src1",
    kind: "harvest",
    sourceId: "src1" as Id<Source>,
    revision: 0,
    assignedAt: 90,
    leaseUntil: 120,
  };

  it("returns false when lease expired", () => {
    expect(
      validateAssignmentRules(validAssignment, 130, 0, true, true),
    ).toBe(false);
  });

  it("returns false when target disappeared", () => {
    const assignment: CreepAssignment = {
      id: "build:W1N1:site1",
      kind: "build",
      targetId: "gone" as Id<_HasId>,
      revision: 0,
      assignedAt: 90,
      leaseUntil: 120,
    };
    expect(
      validateAssignmentRules(assignment, 100, 0, false, true),
    ).toBe(false);
  });

  it("returns false when source disappeared", () => {
    expect(
      validateAssignmentRules(validAssignment, 100, 0, true, false),
    ).toBe(false);
  });

  it("returns true for valid assignment", () => {
    expect(
      validateAssignmentRules(validAssignment, 100, 0, true, true),
    ).toBe(true);
  });

  it("returns true when no targetId (targetExists irrelevant)", () => {
    const assignment: CreepAssignment = {
      id: "fill:W1N1",
      kind: "fill",
      revision: 0,
      assignedAt: 90,
      leaseUntil: 120,
    };
    // targetExists=false 不影响 — 无 targetId 时跳过检查。
    expect(
      validateAssignmentRules(assignment, 100, 0, false, true),
    ).toBe(true);
  });

  it("returns false when layout revision changed", () => {
    expect(
      validateAssignmentRules(
        { ...validAssignment, revision: 0 },
        100,
        1, // 当前 revision=1，assignment 携带 revision=0
        true,
        true,
      ),
    ).toBe(false);
  });

  it("returns true when revision matches current layout", () => {
    expect(
      validateAssignmentRules(
        { ...validAssignment, revision: 2 },
        100,
        2,
        true,
        true,
      ),
    ).toBe(true);
  });
});

// ── chooseTaskForRole (pure) ──
describe("Assignment — chooseTaskForRole (pure)", () => {
  it("harvester gets no assignment tasks (source 统一归 getSource, P1-1)", () => {
    // 即使存在 fill 之外的任务，harvester 也只接受 fill；
    // source 分配不经 assignment，故无 harvest 任务可选。
    const tasks = [
      { id: "haul:W1N1", kind: "haul", sourceId: "c1", priority: 1, maxWorkers: 3, assignedCreeps: [], structureType: undefined },
      { id: "upgrade:W1N1", kind: "upgrade", priority: 2, maxWorkers: 3, assignedCreeps: [], structureType: undefined },
    ];
    const chosen = chooseTaskForRole("harvester", tasks);
    expect(chosen).toBeUndefined();
  });

  it("hauler selects haul task and respects maxWorkers", () => {
    const haulTask = { id: "haul:W1N1", kind: "haul", sourceId: "c1", priority: 1, maxWorkers: 3, assignedCreeps: [] as string[], structureType: undefined };
    const chosen = chooseTaskForRole("hauler", [haulTask]);
    expect(chosen).toBeDefined();
    expect(chosen!.kind).toBe("haul");

    // 满载后不再分配。
    haulTask.assignedCreeps = ["c1", "c2", "c3"];
    expect(chooseTaskForRole("hauler", [haulTask])).toBeUndefined();
  });

  it("returns undefined when no matching task", () => {
    const tasks: any[] = [];
    const chosen = chooseTaskForRole("harvester", tasks);
    expect(chosen).toBeUndefined();
  });

  it("skips tasks not in role's allowed kinds", () => {
    const tasks = [
      { id: "upgrade:W1N1", kind: "upgrade", priority: 2, maxWorkers: 3, assignedCreeps: [], structureType: undefined },
    ];
    // harvester 不能做 upgrade。
    const chosen = chooseTaskForRole("harvester", tasks);
    expect(chosen).toBeUndefined();
  });

  it("builder reserves road task only when no critical build gap", () => {
    const roadTask = { id: "build:W1N1:r1", kind: "build", targetId: "r1", structureType: STRUCTURE_ROAD, priority: 2, maxWorkers: 1, assignedCreeps: [] as string[] };
    const criticalTask = { id: "build:W1N1:ext1", kind: "build", targetId: "ext1", structureType: STRUCTURE_EXTENSION, priority: 1, maxWorkers: 2, assignedCreeps: [] as string[] };
    // 有 critical 缺口时 → builder 应选 critical 而非道路。
    const chosen1 = chooseTaskForRole("builder", [criticalTask, roadTask]);
    expect(chosen1!.id).toBe("build:W1N1:ext1");

    // 无 critical 缺口（critical 已满）时 → builder 应选道路。
    criticalTask.assignedCreeps = ["c1", "c2"];
    const chosen2 = chooseTaskForRole("builder", [criticalTask, roadTask]);
    expect(chosen2!.id).toBe("build:W1N1:r1");
  });

  it("builder 优先选 storage site 而非 extension（storage 建造优先）", () => {
    // P0 修复验证：storage 未建成时，storage site priority=1 > extension priority=2。
    // builder 即使离 extension 更近，也应选 priority 更高的 storage。
    const storageTask = {
      id: "build:W1N1:storage1", kind: "build", targetId: "storage1",
      structureType: STRUCTURE_STORAGE, priority: 1, maxWorkers: 3, assignedCreeps: [] as string[],
      pos: { x: 24, y: 23 },
    };
    const extTask = {
      id: "build:W1N1:ext1", kind: "build", targetId: "ext1",
      structureType: STRUCTURE_EXTENSION, priority: 2, maxWorkers: 1, assignedCreeps: [] as string[],
      pos: { x: 20, y: 20 },
    };
    // creep 在 (20,20) — 离 ext 更近，但 storage priority=1 优先
    const chosen = chooseTaskForRole("builder", [storageTask, extTask], { x: 20, y: 20 });
    expect(chosen).toBeDefined();
    expect(chosen!.targetId).toBe("storage1");
  });

  // ── P2-4 距离感知选择 ──
  it("同优先级中选距离 creep 最近的任务", () => {
    const near = { id: "build:W1N1:near", kind: "build", targetId: "near", structureType: STRUCTURE_EXTENSION, priority: 2, maxWorkers: 1, assignedCreeps: [] as string[], pos: { x: 10, y: 10 } };
    const far = { id: "build:W1N1:far", kind: "build", targetId: "far", structureType: STRUCTURE_EXTENSION, priority: 2, maxWorkers: 1, assignedCreeps: [] as string[], pos: { x: 40, y: 40 } };
    // creep 在 (8,8) — 距 near 4，距 far 64。
    const chosen = chooseTaskForRole("builder", [far, near], { x: 8, y: 8 });
    expect(chosen!.id).toBe("build:W1N1:near");
  });

  it("优先级主导：高优先级任务即使更远也优先", () => {
    const criticalFar = { id: "build:W1N1:crit", kind: "build", targetId: "crit", structureType: STRUCTURE_TOWER, priority: 1, maxWorkers: 1, assignedCreeps: [] as string[], pos: { x: 45, y: 45 } };
    const normalNear = { id: "build:W1N1:norm", kind: "build", targetId: "norm", structureType: STRUCTURE_EXTENSION, priority: 2, maxWorkers: 1, assignedCreeps: [] as string[], pos: { x: 10, y: 10 } };
    // creep 在 (10,10) — normal 更近，但 critical 优先级更高。
    const chosen = chooseTaskForRole("builder", [normalNear, criticalFar], { x: 10, y: 10 });
    expect(chosen!.id).toBe("build:W1N1:crit");
  });

  it("不传 creepPos 时退化为首个匹配（向后兼容）", () => {
    const a = { id: "build:W1N1:a", kind: "build", targetId: "a", structureType: STRUCTURE_EXTENSION, priority: 2, maxWorkers: 1, assignedCreeps: [] as string[], pos: { x: 40, y: 40 } };
    const b = { id: "build:W1N1:b", kind: "build", targetId: "b", structureType: STRUCTURE_EXTENSION, priority: 2, maxWorkers: 1, assignedCreeps: [] as string[], pos: { x: 10, y: 10 } };
    // 无 creepPos → 返回数组首个。
    const chosen = chooseTaskForRole("builder", [a, b]);
    expect(chosen!.id).toBe("build:W1N1:a");
  });

  it("同优先级下无 pos 任务排后有 pos 任务", () => {
    const noPos = { id: "fill:W1N1", kind: "fill", priority: 1, maxWorkers: 3, assignedCreeps: [] as string[] };
    const withPos = { id: "haul:W1N1", kind: "haul", sourceId: "c1", priority: 1, maxWorkers: 3, assignedCreeps: [] as string[], pos: { x: 20, y: 20 } };
    // hauler 在 (20,20)：haul 有位置（距离 0），fill 无位置（Infinity）→ 选 haul。
    const chosen = chooseTaskForRole("hauler", [noPos, withPos], { x: 20, y: 20 });
    expect(chosen!.id).toBe("haul:W1N1");
  });
});

// ── getInvalidatedCreepNames (pure) ──
describe("Assignment — getInvalidatedCreepNames (pure)", () => {
  it("collects creep names from tasks with priority >= minPriority", () => {
    const tasks = [
      { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", priority: 1, maxWorkers: 5, assignedCreeps: ["c1", "c2"], structureType: undefined },
      { id: "fill:W1N1", kind: "fill", priority: 0, maxWorkers: 3, assignedCreeps: ["c3"], structureType: undefined },
      { id: "upgrade:W1N1", kind: "upgrade", priority: 2, maxWorkers: 3, assignedCreeps: ["c4", "c5"], structureType: undefined },
    ];
    // priority >= 1 → harvest (c1,c2) + upgrade (c4,c5)，不含 fill (priority=0)。
    const names = getInvalidatedCreepNames(tasks, 1);
    expect(names).toEqual(expect.arrayContaining(["c1", "c2", "c4", "c5"]));
    expect(names).toHaveLength(4);
    expect(names).not.toContain("c3");
  });

  it("returns empty array when no tasks match", () => {
    const tasks = [
      { id: "fill:W1N1", kind: "fill", priority: 0, maxWorkers: 3, assignedCreeps: ["c1"], structureType: undefined },
    ];
    const names = getInvalidatedCreepNames(tasks, 1);
    expect(names).toEqual([]);
  });
});

// ── removeCreepFromTask → TaskPool.releaseCreep ──
describe("Assignment — TaskPool.releaseCreep", () => {
  it("removes creep from task.assignedCreeps list", () => {
    const pool = new TaskPool();
    pool.init(100);
    const tasks = [
      { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", priority: 1, maxWorkers: 5, assignedCreeps: ["c1", "c2", "c3"], structureType: undefined },
    ];
    pool.setRoomTasks("W1N1", tasks);
    pool.releaseCreep("harvest:W1N1:src1", "c2");
    expect(tasks[0]!.assignedCreeps).toEqual(["c1", "c3"]);
  });

  it("does nothing when creep not in assignedCreeps", () => {
    const pool = new TaskPool();
    pool.init(100);
    const tasks = [
      { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", priority: 1, maxWorkers: 5, assignedCreeps: ["c1", "c3"], structureType: undefined },
    ];
    pool.setRoomTasks("W1N1", tasks);
    pool.releaseCreep("harvest:W1N1:src1", "c99");
    expect(tasks[0]!.assignedCreeps).toEqual(["c1", "c3"]);
  });

  it("does nothing when task not found", () => {
    const pool = new TaskPool();
    pool.init(100);
    expect(() => pool.releaseCreep("nonexistent", "c1")).not.toThrow();
  });

  it("uses O(1) index lookup instead of linear scan", () => {
    const pool = new TaskPool();
    pool.init(100);
    // 创建大量任务以验证索引查找
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `task:${i}`,
      kind: "harvest",
      priority: 1,
      maxWorkers: 5,
      assignedCreeps: [`creep:${i}`],
      structureType: undefined,
    }));
    pool.setRoomTasks("W1N1", tasks);
    // 最后一个任务应能 O(1) 查到
    const result = pool.releaseCreep("task:99", "creep:99");
    expect(result).toBe(true);
    expect(tasks[99]!.assignedCreeps).toEqual([]);
  });
});

// ── TaskPool.invalidate (single pass) ──
describe("Assignment — TaskPool.invalidate", () => {
  it("collects creep names and clears assignedCreeps in single pass", () => {
    const pool = new TaskPool();
    pool.init(100);
    const tasks = [
      { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", priority: 1, maxWorkers: 5, assignedCreeps: ["c1", "c2"], structureType: undefined },
      { id: "fill:W1N1", kind: "fill", priority: 0, maxWorkers: 3, assignedCreeps: ["c3"], structureType: undefined },
      { id: "upgrade:W1N1", kind: "upgrade", priority: 2, maxWorkers: 3, assignedCreeps: ["c4", "c5"], structureType: undefined },
    ];
    pool.setRoomTasks("W1N1", tasks);
    const names = pool.invalidate("W1N1", 1);
    // priority >= 1 → harvest (c1,c2) + upgrade (c4,c5)，不含 fill (priority=0)。
    expect(names).toEqual(expect.arrayContaining(["c1", "c2", "c4", "c5"]));
    expect(names).toHaveLength(4);
    expect(names).not.toContain("c3");
    // assignedCreeps 已清空
    expect(tasks[0]!.assignedCreeps).toEqual([]);
    expect(tasks[2]!.assignedCreeps).toEqual([]);
    // fill 任务不受影响
    expect(tasks[1]!.assignedCreeps).toEqual(["c3"]);
  });
});

// ── TaskPool.assignCreep (dedup) ──
describe("Assignment — TaskPool.assignCreep", () => {
  it("assigns creep to task", () => {
    const pool = new TaskPool();
    pool.init(100);
    pool.setRoomTasks("W1N1", [
      { id: "fill:W1N1", kind: "fill", priority: 0, maxWorkers: 3, assignedCreeps: [], structureType: undefined },
    ]);
    expect(pool.assignCreep("fill:W1N1", "c1")).toBe(true);
    const task = pool.findTask("fill:W1N1")!;
    expect(task.assignedCreeps).toEqual(["c1"]);
  });

  it("prevents duplicate assignment", () => {
    const pool = new TaskPool();
    pool.init(100);
    pool.setRoomTasks("W1N1", [
      { id: "fill:W1N1", kind: "fill", priority: 0, maxWorkers: 3, assignedCreeps: ["c1"], structureType: undefined },
    ]);
    expect(pool.assignCreep("fill:W1N1", "c1")).toBe(false);
    const task = pool.findTask("fill:W1N1")!;
    expect(task.assignedCreeps).toEqual(["c1"]); // 未重复添加
  });
});

// ── haul 任务拆分 (P2-5) ──
describe("Assignment — haul task split (P2-5)", () => {
  function container(id: string, energy: number, x: number, y: number): StructureContainer {
    return {
      id,
      structureType: STRUCTURE_CONTAINER,
      pos: { x, y, roomName: "W1N1" },
      store: { getUsedCapacity: () => energy },
    } as unknown as StructureContainer;
  }

  it("为每个含能量的 container 生成独立 haul 任务", () => {
    const c1 = container("c1", 100, 10, 10);
    const c2 = container("c2", 300, 40, 40);
    const snapshot = mockSnapshot({ containers: [c1, c2] });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());
    const haulTasks = tasks.filter(t => t.kind === "haul");

    expect(haulTasks).toHaveLength(2);
    expect(haulTasks.map(t => t.sourceId).sort()).toEqual(["c1", "c2"]);
    // 每个任务 maxWorkers=1（促分散），且有独立 id 和 pos。
    for (const t of haulTasks) {
      expect(t.maxWorkers).toBe(1);
      expect(t.id).toMatch(/^haul:W1N1:c\d$/);
      expect(t.pos).toBeDefined();
    }
  });

  it("空 container 不生成 haul 任务", () => {
    const empty = container("c1", 0, 10, 10);
    const full = container("c2", 200, 40, 40);
    const snapshot = mockSnapshot({ containers: [empty, full] });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());
    const haulTasks = tasks.filter(t => t.kind === "haul");

    expect(haulTasks).toHaveLength(1);
    expect(haulTasks[0]?.sourceId).toBe("c2");
  });

  // TD-013 修复：container 全空 + storage 有能量时，不生成指向 storage 的 haul 任务。
  // hauler 永不从 storage 取能 — storage → sink 的分发由 distributor 负责。
  it("无 container 有能量时不生成指向 storage 的 haul 任务（TD-013）", () => {
    const empty = container("c1", 0, 10, 10);
    const storage = {
      id: "store1",
      structureType: STRUCTURE_STORAGE,
      pos: { x: 25, y: 25, roomName: "W1N1" },
      store: { getUsedCapacity: () => 500 },
    } as unknown as StructureStorage;
    const snapshot = mockSnapshot({ containers: [empty], storage });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());
    const haulTasks = tasks.filter(t => t.kind === "haul");

    // hauler 架构约束：永不从 storage 取能。container 全空时应等待 harvester 产出。
    expect(haulTasks).toHaveLength(0);
  });

  it("无 container 且无 storage 时不生成 haul 任务", () => {
    const snapshot = mockSnapshot({ containers: [], storage: undefined });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());
    expect(tasks.filter(t => t.kind === "haul")).toHaveLength(0);
  });

  it("container 和 storage 都无能量时不生成 haul 任务", () => {
    const empty = container("c1", 0, 10, 10);
    const emptyStorage = {
      id: "store1",
      structureType: STRUCTURE_STORAGE,
      pos: { x: 25, y: 25, roomName: "W1N1" },
      store: { getUsedCapacity: () => 0 },
    } as unknown as StructureStorage;
    const snapshot = mockSnapshot({ containers: [empty], storage: emptyStorage });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());
    expect(tasks.filter(t => t.kind === "haul")).toHaveLength(0);
  });
});
