import { describe, expect, it, beforeEach } from "vitest";
import {
  buildRoomTasks,
  validateAssignmentRules,
  chooseTaskForRole,
  getInvalidatedCreepNames,
  selectHaulPickupId,
  type CreepAssignmentRef,
  type RoomTaskFlags,
} from "../src/domain/assignment/service";
import { TaskPool } from "../src/domain/assignment/task-pool";
import { globalCache } from "../src/kernel/global-cache";
import type { RoomSnapshot, ColonyState } from "../src/kernel/contracts";

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
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map(),
    minerals: [],
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
  it("generates harvest tasks for each source", () => {
    const source1 = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const source2 = { id: "src2", pos: { x: 40, y: 40, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source1, source2] });

    const tasks = buildRoomTasks(snapshot, [], mockFlags());

    const harvestTasks = tasks.filter(t => t.kind === "harvest");
    expect(harvestTasks).toHaveLength(2);
    expect(harvestTasks[0]?.sourceId).toBe("src1");
    expect(harvestTasks[1]?.sourceId).toBe("src2");
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
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({
      sources: [source],
      fillTargets: [{ id: "ext1" } as unknown as StructureExtension],
    });

    const creeps: CreepAssignmentRef[] = [
      creepRef("h1", "W1N1", { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1" }),
      creepRef("h2", "W1N1", { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1" }),
      creepRef("f1", "W1N1", { id: "fill:W1N1", kind: "fill" }),
      // 其他房的 creep 应被过滤掉。
      creepRef("other", "W2N2", { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1" }),
    ];

    const tasks = buildRoomTasks(snapshot, creeps, mockFlags());

    const harvestTask = tasks.find(t => t.id === "harvest:W1N1:src1")!;
    expect(harvestTask.assignedCreeps).toEqual(expect.arrayContaining(["h1", "h2"]));
    expect(harvestTask.assignedCreeps).toHaveLength(2);
    expect(harvestTask.assignedCreeps).not.toContain("other");

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
  it("assigns harvest task to harvester", () => {
    const tasks = [
      { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", priority: 1, maxWorkers: 5, assignedCreeps: [], structureType: undefined },
    ];
    const chosen = chooseTaskForRole("harvester", tasks);
    expect(chosen).toBeDefined();
    expect(chosen!.kind).toBe("harvest");
    expect(chosen!.sourceId).toBe("src1");
  });

  it("does not exceed maxWorkers for harvest", () => {
    const tasks = [
      { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", priority: 1, maxWorkers: 5, assignedCreeps: ["c1", "c2", "c3", "c4", "c5"], structureType: undefined },
    ];
    const chosen = chooseTaskForRole("harvester", tasks);
    // harvest 满了 → 不返回 harvest（若无其他任务则返回 undefined）。
    expect(chosen).toBeUndefined();
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

// ── selectHaulPickupId (pure) ──
describe("Assignment — selectHaulPickupId (pure)", () => {
  it("sets sourceId to richest container when containers have energy", () => {
    const c1 = { id: "c1", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 100 } } as unknown as StructureContainer;
    const c2 = { id: "c2", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 300 } } as unknown as StructureContainer;
    const c3 = { id: "c3", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 50 } } as unknown as StructureContainer;
    const snapshot = mockSnapshot({ containers: [c1, c2, c3] });

    const pickupId = selectHaulPickupId(snapshot);
    expect(pickupId).toBe("c2"); // 选能量最多的
  });

  it("sets sourceId to storage when no container has energy", () => {
    const emptyContainer = { id: "c1", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 0 } } as unknown as StructureContainer;
    const storage = { id: "store1", structureType: STRUCTURE_STORAGE, store: { getUsedCapacity: () => 500 } } as unknown as StructureStorage;
    const snapshot = mockSnapshot({ containers: [emptyContainer], storage });

    const pickupId = selectHaulPickupId(snapshot);
    expect(pickupId).toBe("store1");
  });

  it("returns undefined when no pickup point has energy", () => {
    const emptyContainer = { id: "c1", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 0 } } as unknown as StructureContainer;
    const emptyStorage = { id: "store1", structureType: STRUCTURE_STORAGE, store: { getUsedCapacity: () => 0 } } as unknown as StructureStorage;
    const snapshot = mockSnapshot({ containers: [emptyContainer], storage: emptyStorage });

    const pickupId = selectHaulPickupId(snapshot);
    expect(pickupId).toBeUndefined();
  });
});
