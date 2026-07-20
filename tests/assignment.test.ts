import { describe, expect, it, beforeEach } from "vitest";
import {
  initAssignment,
  generateRoomTasks,
  requestAssignment,
  validateAssignment,
  releaseFromTask,
  invalidateAssignments,
} from "../src/domain/assignment/service";
import { globalCache } from "../src/kernel/global-cache";
import type { RoomSnapshot, TickContext, Budget, Priority, ColonyState } from "../src/kernel/contracts";

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

function mockCtx(overrides?: Partial<TickContext>): TickContext {
  const budget: Budget = {
    tier: "healthy",
    softLimit: 17.5,
    hardLimit: 19.2,
    canStart: () => true,
    isExhausted: () => false,
    spent: () => 0,
  };
  return {
    tick: 100,
    budget,
    colonyState: "normal" as ColonyState,
    getSnapshot: () => undefined,
    snapshots: () => [],
    ...overrides,
  };
}

// ── 初始化全局状态 ──
beforeEach(() => {
  // 清空 global cache
  const g = globalCache();
  g.assignment = undefined;
  g.errorLog = undefined;
  g.errorCounts = undefined;
  g.pluginCooldowns = undefined;
  g.telemetry = undefined;

  // 清空 Game 和 Memory
  (globalThis as Record<string, unknown>).Game = {
    time: 100,
    cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
    creeps: {},
    spawns: {},
    rooms: {},
    getObjectById: () => null,
  };
  (globalThis as Record<string, unknown>).Memory = {
    schemaVersion: 3,
    creeps: {},
    rooms: {},
    kernel: {},
  };
});

// ── initAssignment ──
describe("Assignment — initAssignment", () => {
  it("initializes global assignment cache", () => {
    initAssignment(100);
    const g = globalCache();
    expect(g.assignment).toBeDefined();
    expect(g.assignment!.tick).toBe(100);
    expect(g.assignment!.roomTasks).toBeInstanceOf(Map);
  });
});

// ── generateRoomTasks ──
describe("Assignment — generateRoomTasks", () => {
  it("generates harvest tasks for each source", () => {
    const source1 = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const source2 = { id: "src2", pos: { x: 40, y: 40, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source1, source2] });

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
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
      energyAvailable: 200,
    });

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const fillTasks = tasks.filter(t => t.kind === "fill");
    expect(fillTasks).toHaveLength(1);
    // energyAvailable < 300 → priority 0
    expect(fillTasks[0]?.priority).toBe(0);
  });

  it("generates build tasks for construction sites", () => {
    const site = { id: "site1", pos: { x: 20, y: 20 }, structureType: STRUCTURE_EXTENSION } as unknown as ConstructionSite;
    const snapshot = mockSnapshot({ myConstructionSites: [site] });

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const buildTasks = tasks.filter(t => t.kind === "build");
    expect(buildTasks).toHaveLength(1);
    expect(buildTasks[0]?.targetId).toBe("site1");
  });

  it("generates upgrade task in normal state", () => {
    const controller = { id: "ctrl1", my: true, pos: { x: 30, y: 30 } } as unknown as StructureController;
    const snapshot = mockSnapshot({ controller });

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx({ colonyState: "normal" }));

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const upgradeTasks = tasks.filter(t => t.kind === "upgrade");
    expect(upgradeTasks).toHaveLength(1);
  });

  it("does not generate upgrade task in bootstrap", () => {
    const controller = { id: "ctrl1", my: true, pos: { x: 30, y: 30 } } as unknown as StructureController;
    const snapshot = mockSnapshot({ controller });

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx({ colonyState: "bootstrap" }));

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const upgradeTasks = tasks.filter(t => t.kind === "upgrade");
    expect(upgradeTasks).toHaveLength(0);
  });
});

// ── requestAssignment ──
describe("Assignment — requestAssignment", () => {
  it("assigns harvest task to harvester", () => {
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source] });

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const creep = {
      name: "creep1",
      memory: { role: "harvester", home: "W1N1", mode: "acquire" },
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 50 },
    } as unknown as Creep;

    const ctx = mockCtx();
    const assignment = requestAssignment(creep, ctx);

    expect(assignment).toBeDefined();
    expect(assignment!.kind).toBe("harvest");
    expect(assignment!.sourceId).toBe("src1");
    expect(assignment!.leaseUntil).toBe(120); // tick 100 + leaseDuration 20
  });

  it("does not exceed maxWorkers for harvest", () => {
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source] });

    // 预填充已分配的 creep — 使用 assignment 而非遗留 sourceId
    const harvestAssignment = {
      id: "harvest:W1N1:src1",
      kind: "harvest" as const,
      sourceId: "src1",
      revision: 0,
      assignedAt: 90,
      leaseUntil: 120,
    };
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: {
        creep1: { name: "creep1", memory: { role: "harvester", home: "W1N1", assignment: harvestAssignment } },
        creep2: { name: "creep2", memory: { role: "harvester", home: "W1N1", assignment: harvestAssignment } },
        creep3: { name: "creep3", memory: { role: "harvester", home: "W1N1", assignment: harvestAssignment } },
        creep4: { name: "creep4", memory: { role: "harvester", home: "W1N1", assignment: harvestAssignment } },
        creep5: { name: "creep5", memory: { role: "harvester", home: "W1N1", assignment: harvestAssignment } },
      },
      spawns: {},
      rooms: {},
      getObjectById: () => null,
    };

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const newCreep = {
      name: "creep6",
      memory: { role: "harvester", home: "W1N1", mode: "acquire" },
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 50 },
    } as unknown as Creep;

    const ctx = mockCtx();
    const assignment = requestAssignment(newCreep, ctx);

    // sourceTargetWorkParts=5, 已有 5 个 creep → 不应再分配 harvest
    // 但可以分配 fill 等其他任务
    expect(assignment?.kind).not.toBe("harvest");
  });

  it("renews lease when assignment is still valid", () => {
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source] });

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const creep = {
      name: "creep1",
      memory: {
        role: "harvester",
        home: "W1N1",
        mode: "acquire",
        assignment: {
          id: "harvest:W1N1:src1",
          kind: "harvest",
          sourceId: "src1",
          revision: 0,
          assignedAt: 90,
          leaseUntil: 105, // still valid at tick 100
        },
      },
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 50 },
    } as unknown as Creep;

    // mock getObjectById to return the source
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: { creep1: creep },
      spawns: {},
      rooms: {},
      getObjectById: (id: string) => id === "src1" ? source : null,
    };

    const ctx = mockCtx();
    const assignment = requestAssignment(creep, ctx);

    expect(assignment).toBeDefined();
    expect(assignment!.kind).toBe("harvest");
    expect(assignment!.leaseUntil).toBe(120); // renewed to 100 + 20
  });

  it("returns undefined when no matching task", () => {
    const snapshot = mockSnapshot(); // no sources, no fill targets

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const creep = {
      name: "creep1",
      memory: { role: "harvester", home: "W1N1", mode: "acquire" },
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 50 },
    } as unknown as Creep;

    const ctx = mockCtx();
    const assignment = requestAssignment(creep, ctx);
    expect(assignment).toBeUndefined();
  });
});

// ── validateAssignment ──
describe("Assignment — validateAssignment", () => {
  it("returns false when no assignment", () => {
    const creep = { memory: {} } as unknown as Creep;
    expect(validateAssignment(creep, mockCtx())).toBe(false);
  });

  it("returns false when lease expired", () => {
    const creep = {
      memory: {
        assignment: {
          id: "test",
          kind: "harvest",
          revision: 0,
          assignedAt: 50,
          leaseUntil: 90, // expired at tick 100
        },
      },
    } as unknown as Creep;
    expect(validateAssignment(creep, mockCtx({ tick: 100 }))).toBe(false);
  });

  it("returns false when target disappeared", () => {
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      getObjectById: () => null,
    };
    const creep = {
      memory: {
        assignment: {
          id: "test",
          kind: "build",
          targetId: "gone",
          revision: 0,
          assignedAt: 90,
          leaseUntil: 120,
        },
      },
    } as unknown as Creep;
    expect(validateAssignment(creep, mockCtx({ tick: 100 }))).toBe(false);
  });

  it("returns true for valid assignment", () => {
    const source = { id: "src1" } as unknown as Source;
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      getObjectById: () => source,
    };
    const creep = {
      memory: {
        assignment: {
          id: "test",
          kind: "harvest",
          sourceId: "src1",
          revision: 0,
          assignedAt: 90,
          leaseUntil: 120,
        },
      },
    } as unknown as Creep;
    expect(validateAssignment(creep, mockCtx({ tick: 100 }))).toBe(true);
  });
});

// ── invalidateAssignments ──
describe("Assignment — invalidateAssignments", () => {
  it("clears assignedCreeps and creep memory for tasks above minPriority", () => {
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source] });

    // 设置有 assignment 的 creep
    const creep1Mem = { role: "harvester", home: "W1N1", assignment: { id: "harvest:W1N1:src1", kind: "harvest" as const, sourceId: "src1", revision: 0, assignedAt: 90, leaseUntil: 120 } };
    const creep2Mem = { role: "harvester", home: "W1N1", assignment: { id: "harvest:W1N1:src1", kind: "harvest" as const, sourceId: "src1", revision: 0, assignedAt: 90, leaseUntil: 120 } };
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: {
        creep1: { name: "creep1", memory: creep1Mem },
        creep2: { name: "creep2", memory: creep2Mem },
      },
      spawns: {},
      rooms: {},
      getObjectById: () => source,
    };

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const harvestTask = tasks.find(t => t.kind === "harvest")!;
    harvestTask.assignedCreeps = ["creep1", "creep2"];

    // Invalidate tasks with priority >= 1
    invalidateAssignments("W1N1", 1);

    expect(harvestTask.assignedCreeps).toHaveLength(0);
    // creep memory 中的 assignment 也应被清除
    expect(creep1Mem.assignment).toBeUndefined();
    expect(creep2Mem.assignment).toBeUndefined();
  });
});

// ── validateAssignment — revision 检查（plan §5.7.2 规则 4）──
describe("Assignment — validateAssignment revision check", () => {
  beforeEach(() => {
    // 重置 Memory — 每个测试独立。
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
  });

  it("returns false when layout.revision changed after assignment", () => {
    // assignment 携带 revision=0，但当前 layout.revision=1 — 应失效。
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: { layout: { revision: 1 } } },
    };
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      getObjectById: () => null,
    };
    const creep = {
      memory: {
        home: "W1N1",
        assignment: {
          id: "build:W1N1:site1",
          kind: "build",
          targetId: "site1",
          revision: 0, // 旧 revision
          assignedAt: 90,
          leaseUntil: 120,
        },
      },
    } as unknown as Creep;
    expect(validateAssignment(creep, mockCtx({ tick: 100 }))).toBe(false);
  });

  it("returns true when revision matches current layout.revision", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: { layout: { revision: 2 } } },
    };
    const source = { id: "src1" } as unknown as Source;
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      getObjectById: () => source,
    };
    const creep = {
      memory: {
        home: "W1N1",
        assignment: {
          id: "harvest:W1N1:src1",
          kind: "harvest",
          sourceId: "src1",
          revision: 2, // 匹配当前
          assignedAt: 90,
          leaseUntil: 120,
        },
      },
    } as unknown as Creep;
    expect(validateAssignment(creep, mockCtx({ tick: 100 }))).toBe(true);
  });

  it("returns true when no layout exists and assignment.revision is 0", () => {
    // 无 layout 时 getCurrentLayoutRevision 返回 0，revision=0 的 assignment 有效。
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    const source = { id: "src1" } as unknown as Source;
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      getObjectById: () => source,
    };
    const creep = {
      memory: {
        home: "W1N1",
        assignment: {
          id: "harvest:W1N1:src1",
          kind: "harvest",
          sourceId: "src1",
          revision: 0,
          assignedAt: 90,
          leaseUntil: 120,
        },
      },
    } as unknown as Creep;
    expect(validateAssignment(creep, mockCtx({ tick: 100 }))).toBe(true);
  });
});

// ── releaseFromTask ──
describe("Assignment — releaseFromTask", () => {
  it("does nothing when creep has no assignment", () => {
    initAssignment(100);
    const creep = { memory: {}, name: "c1" } as unknown as Creep;
    expect(() => releaseFromTask(creep)).not.toThrow();
  });

  it("does nothing when global.assignment is not initialized", () => {
    // 重置 global
    (globalThis as Record<string, unknown>).global = undefined;
    const creep = {
      memory: { assignment: { id: "x", kind: "harvest" } },
      name: "c1",
    } as unknown as Creep;
    expect(() => releaseFromTask(creep)).not.toThrow();
  });

  it("removes creep from task.assignedCreeps list", () => {
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source] });
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: {},
      spawns: {},
      rooms: {},
      getObjectById: () => source,
    };

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const harvestTask = tasks.find(t => t.kind === "harvest")!;
    harvestTask.assignedCreeps = ["c1", "c2", "c3"];

    const creep = {
      memory: {
        home: "W1N1",
        assignment: { id: harvestTask.id, kind: "harvest" as const, sourceId: "src1", revision: 0, assignedAt: 90, leaseUntil: 120 },
      },
      name: "c2",
    } as unknown as Creep;

    releaseFromTask(creep);
    expect(harvestTask.assignedCreeps).toEqual(["c1", "c3"]);
  });

  it("does nothing when task not found in room tasks", () => {
    initAssignment(100);
    const creep = {
      memory: {
        home: "W1N1",
        assignment: { id: "nonexistent", kind: "harvest" as const, revision: 0, assignedAt: 0, leaseUntil: 0 },
      },
      name: "c1",
    } as unknown as Creep;
    // roomTasks 为空 Map — 不会崩溃。
    expect(() => releaseFromTask(creep)).not.toThrow();
  });
});

// ── haul 任务 sourceId 设置（plan §5.7.2 规则 2）──
describe("Assignment — haul task sourceId", () => {
  it("sets sourceId to richest container when containers have energy", () => {
    const c1 = { id: "c1", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 100 } } as unknown as StructureContainer;
    const c2 = { id: "c2", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 300 } } as unknown as StructureContainer;
    const c3 = { id: "c3", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 50 } } as unknown as StructureContainer;
    const snapshot = mockSnapshot({ containers: [c1, c2, c3] });

    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: {},
      spawns: {},
      rooms: {},
    };

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const haulTask = tasks.find(t => t.kind === "haul");
    expect(haulTask).toBeDefined();
    expect(haulTask!.sourceId).toBe("c2"); // 选能量最多的
  });

  it("sets sourceId to storage when no container has energy", () => {
    const emptyContainer = { id: "c1", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 0 } } as unknown as StructureContainer;
    const storage = { id: "store1", structureType: STRUCTURE_STORAGE, store: { getUsedCapacity: () => 500 } } as unknown as StructureStorage;
    const snapshot = mockSnapshot({ containers: [emptyContainer], storage });

    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: {},
      spawns: {},
      rooms: {},
    };

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const haulTask = tasks.find(t => t.kind === "haul");
    expect(haulTask).toBeDefined();
    expect(haulTask!.sourceId).toBe("store1");
  });

  it("does not create haul task when no pickup point has energy", () => {
    const emptyContainer = { id: "c1", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 0 } } as unknown as StructureContainer;
    const emptyStorage = { id: "store1", structureType: STRUCTURE_STORAGE, store: { getUsedCapacity: () => 0 } } as unknown as StructureStorage;
    const snapshot = mockSnapshot({ containers: [emptyContainer], storage: emptyStorage });

    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: {},
      spawns: {},
      rooms: {},
    };

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const haulTask = tasks.find(t => t.kind === "haul");
    expect(haulTask).toBeUndefined(); // 无可用 pickup 点时不创建任务
  });
});

// ── generateRoomTasks 性能优化 — 单次遍历 ──
describe("Assignment — generateRoomTasks single-pass aggregation", () => {
  it("correctly aggregates assigned creeps across multiple task types", () => {
    // 验证单次遍历分桶逻辑：3 个 creep 分配到不同任务，应被正确计数。
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({
      sources: [source],
      fillTargets: [{ id: "ext1" } as unknown as StructureExtension],
    });

    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { getUsed: () => 0, limit: 20, tickLimit: 20, bucket: 10000 },
      creeps: {
        h1: {
          name: "h1",
          memory: { home: "W1N1", assignment: { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", revision: 0, assignedAt: 0, leaseUntil: 0 } },
        },
        h2: {
          name: "h2",
          memory: { home: "W1N1", assignment: { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", revision: 0, assignedAt: 0, leaseUntil: 0 } },
        },
        f1: {
          name: "f1",
          memory: { home: "W1N1", assignment: { id: "fill:W1N1", kind: "fill", revision: 0, assignedAt: 0, leaseUntil: 0 } },
        },
        // 其他房的 creep 应被过滤掉。
        other: {
          name: "other",
          memory: { home: "W2N2", assignment: { id: "harvest:W1N1:src1", kind: "harvest", sourceId: "src1", revision: 0, assignedAt: 0, leaseUntil: 0 } },
        },
      },
      spawns: {},
      rooms: {},
    };

    initAssignment(100);
    generateRoomTasks(snapshot, mockCtx());

    const g = globalCache();
    const tasks = g.assignment!.roomTasks.get("W1N1")!;
    const harvestTask = tasks.find(t => t.id === "harvest:W1N1:src1")!;
    expect(harvestTask.assignedCreeps).toEqual(expect.arrayContaining(["h1", "h2"]));
    expect(harvestTask.assignedCreeps).toHaveLength(2);
    expect(harvestTask.assignedCreeps).not.toContain("other");

    const fillTask = tasks.find(t => t.id === "fill:W1N1")!;
    expect(fillTask.assignedCreeps).toEqual(["f1"]);
  });
});
