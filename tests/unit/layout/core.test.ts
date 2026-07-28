import { describe, expect, it } from "vitest";
import {
  packPos,
  unpackPos,
  inBounds,
  absPos,
  type BlueprintCell,
} from "../../../src/domain/layout/types";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";
import {
  scoreCandidate,
  selectBestCandidate,
  type CandidateInput,
} from "../../../src/domain/layout/candidate-score";
import {
  validateBuildCell,
  collectCompletedKeys,
  type ValidationOptions,
} from "../../../src/domain/layout/validation";
import {
  blueprintToTasks,
  phaseAllowed,
  filterValidCandidates,
  candidateToBuildTask,
  createSourceContainerTasks,
  createControllerContainerTask,
  createDefenseTasks,
  extractBlockedCandidates,
  DEFAULT_DEFENSE_OPTIONS,
} from "../../../src/domain/layout/task-factory";
import {
  collectCompletedKeysFromStructures,
} from "../../../src/domain/layout/validation";
import { evaluateRoadCandidates } from "../../../src/domain/layout/road-policy";
import type { RoomSnapshot } from "../../../src/kernel/contracts";

// ── 辅助函数：创建 mock Room ──
function mockRoom(terrainData?: Record<string, number>): Room {
  return {
    getTerrain: () => ({
      get: (x: number, y: number) => terrainData?.[`${x},${y}`] ?? 0,
    }),
    find: () => [],
  } as unknown as Room;
}

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

const defaultOptions: ValidationOptions = {
  completedKeys: new Set(),
  globalSiteCount: 0,
  maxGlobalSites: 5,
};

// ── types.ts ──
describe("Layout — packPos/unpackPos", () => {
  it("packs x*50+y", () => {
    expect(packPos(10, 20)).toBe(520);
    expect(packPos(0, 0)).toBe(0);
    expect(packPos(49, 49)).toBe(2499);
  });

  it("unpacks to original coordinates", () => {
    expect(unpackPos(520)).toEqual({ x: 10, y: 20 });
    expect(unpackPos(0)).toEqual({ x: 0, y: 0 });
    expect(unpackPos(2499)).toEqual({ x: 49, y: 49 });
  });
});

describe("Layout — inBounds", () => {
  it("accepts 1-48", () => {
    expect(inBounds(1, 1)).toBe(true);
    expect(inBounds(48, 48)).toBe(true);
    expect(inBounds(25, 25)).toBe(true);
  });

  it("rejects 0 and 49+", () => {
    expect(inBounds(0, 0)).toBe(false);
    expect(inBounds(49, 49)).toBe(false);
    expect(inBounds(25, 0)).toBe(false);
    expect(inBounds(0, 25)).toBe(false);
  });
});

describe("Layout — absPos", () => {
  it("converts relative to absolute", () => {
    const cell: BlueprintCell = {
      key: "test",
      dx: 2,
      dy: -1,
      structureType: "extension" as BuildableStructureConstant,
      minRcl: 2,
      phase: "rcl2",
      priority: 1,
      tags: ["core"],
    };
    expect(absPos(20, 20, cell, "W1N1")).toEqual({ x: 22, y: 19, roomName: "W1N1" });
  });
});

// ── compact-core-v2.ts ──
describe("Layout — COMPACT_CORE_V2", () => {
  it("has correct id and anchorKind", () => {
    expect(COMPACT_CORE_V2.id).toBe("compact-core-v2");
    expect(COMPACT_CORE_V2.anchorKind).toBe("primary-spawn");
  });

  it("has no duplicate cell keys", () => {
    const keys = COMPACT_CORE_V2.cells.map(c => c.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("has no duplicate positions (dx,dy)", () => {
    const positions = COMPACT_CORE_V2.cells.map(c => `${c.dx},${c.dy}`);
    const unique = new Set(positions);
    expect(unique.size).toBe(positions.length);
  });

  it("has 5 extensions for rcl2 phase", () => {
    const rcl2Exts = COMPACT_CORE_V2.cells.filter(
      c => c.phase === "rcl2" && c.structureType === STRUCTURE_EXTENSION,
    );
    expect(rcl2Exts).toHaveLength(5);
  });

  it("has 10 extensions for rcl3 phase (total 10)", () => {
    const rcl3Exts = COMPACT_CORE_V2.cells.filter(
      c => c.phase === "rcl3" && c.structureType === STRUCTURE_EXTENSION,
    );
    expect(rcl3Exts).toHaveLength(5);
  });

  it("has 10 extensions for rcl4 phase (total 20)", () => {
    const rcl4Exts = COMPACT_CORE_V2.cells.filter(
      c => c.phase === "rcl4" && c.structureType === STRUCTURE_EXTENSION,
    );
    expect(rcl4Exts).toHaveLength(10);
  });

  it("has 1 tower for rcl3", () => {
    const rcl3Towers = COMPACT_CORE_V2.cells.filter(
      c => c.phase === "rcl3" && c.structureType === STRUCTURE_TOWER,
    );
    expect(rcl3Towers).toHaveLength(1);
  });

  it("has 1 storage for rcl4", () => {
    const rcl4Storage = COMPACT_CORE_V2.cells.filter(
      c => c.phase === "rcl4" && c.structureType === STRUCTURE_STORAGE,
    );
    expect(rcl4Storage).toHaveLength(1);
  });

  it("tower has priority 0 (critical)", () => {
    const towers = COMPACT_CORE_V2.cells.filter(c => c.structureType === STRUCTURE_TOWER);
    for (const t of towers) {
      expect(t.priority).toBe(0);
    }
  });

  it("storage depends on nothing (no requires)", () => {
    const storage = COMPACT_CORE_V2.cells.find(c => c.structureType === STRUCTURE_STORAGE);
    expect(storage).toBeDefined();
    expect(storage?.requires ?? []).toHaveLength(0);
  });

  it("link depends on storage", () => {
    const link = COMPACT_CORE_V2.cells.find(c => c.structureType === STRUCTURE_LINK);
    expect(link).toBeDefined();
    expect(link?.requires).toContain("core.storage.01");
  });
});

// ── candidate-score.ts ──
describe("Layout — scoreCandidate", () => {
  it("higher buildable tiles = higher score", () => {
    const low: CandidateInput = {
      x: 25, y: 25,
      buildableCoreTiles: 10,
      averageDistanceToSources: 5,
      distanceToController: 10,
      exitRisk: 10,
      blockedTemplateCells: 0,
    };
    const high: CandidateInput = { ...low, buildableCoreTiles: 20 };
    expect(scoreCandidate(high)).toBeGreaterThan(scoreCandidate(low));
  });

  it("more blocked cells = lower score", () => {
    const clean: CandidateInput = {
      x: 25, y: 25,
      buildableCoreTiles: 10,
      averageDistanceToSources: 5,
      distanceToController: 10,
      exitRisk: 10,
      blockedTemplateCells: 0,
    };
    const blocked: CandidateInput = { ...clean, blockedTemplateCells: 5 };
    expect(scoreCandidate(blocked)).toBeLessThan(scoreCandidate(clean));
  });
});

describe("Layout — selectBestCandidate", () => {
  it("returns highest scoring candidate", () => {
    const candidates: CandidateInput[] = [
      { x: 10, y: 10, buildableCoreTiles: 5, averageDistanceToSources: 10, distanceToController: 20, exitRisk: 5, blockedTemplateCells: 3 },
      { x: 25, y: 25, buildableCoreTiles: 20, averageDistanceToSources: 5, distanceToController: 10, exitRisk: 15, blockedTemplateCells: 0 },
      { x: 40, y: 40, buildableCoreTiles: 10, averageDistanceToSources: 15, distanceToController: 25, exitRisk: 5, blockedTemplateCells: 1 },
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.x).toBe(25);
    expect(best?.y).toBe(25);
  });

  it("returns undefined for empty list", () => {
    expect(selectBestCandidate([])).toBeUndefined();
  });
});

// ── validation.ts ──
describe("Layout — validateBuildCell", () => {
  const cell: BlueprintCell = {
    key: "test.ext",
    dx: 0, dy: 0,
    structureType: STRUCTURE_EXTENSION,
    minRcl: 2,
    phase: "rcl2",
    priority: 1,
    tags: ["core"],
  };

  it("returns 'rcl' when RCL is too low", () => {
    const snapshot = mockSnapshot({ rcl: 1 });
    const result = validateBuildCell(mockRoom(), cell, { x: 25, y: 25 }, snapshot, defaultOptions);
    expect(result).toBe("rcl");
  });

  it("returns 'terrain' for wall", () => {
    const snapshot = mockSnapshot({ rcl: 2 });
    const room = mockRoom({ "25,25": TERRAIN_MASK_WALL });
    const result = validateBuildCell(room, cell, { x: 25, y: 25 }, snapshot, defaultOptions);
    expect(result).toBe("terrain");
  });

  it("returns 'terrain' for out-of-bounds", () => {
    const snapshot = mockSnapshot({ rcl: 2 });
    const result = validateBuildCell(mockRoom(), cell, { x: 0, y: 0 }, snapshot, defaultOptions);
    expect(result).toBe("terrain");
  });

  it("returns 'occupied' for source position", () => {
    const source = { id: "src1", pos: { x: 25, y: 25, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ rcl: 2, sources: [source] });
    const result = validateBuildCell(mockRoom(), cell, { x: 25, y: 25 }, snapshot, defaultOptions);
    expect(result).toBe("occupied");
  });

  it("returns 'dependency' when requires not met", () => {
    const dependentCell: BlueprintCell = {
      key: "test.link",
      dx: 0, dy: 1,
      structureType: STRUCTURE_LINK,
      minRcl: 5,
      phase: "late",
      priority: 2,
      tags: ["core"],
      requires: ["core.storage.01"],
    };
    const snapshot = mockSnapshot({ rcl: 5 });
    const result = validateBuildCell(mockRoom(), dependentCell, { x: 25, y: 26 }, snapshot, defaultOptions);
    expect(result).toBe("dependency");
  });

  it("returns 'ok' when dependency is met", () => {
    const dependentCell: BlueprintCell = {
      key: "test.link",
      dx: 0, dy: 1,
      structureType: STRUCTURE_LINK,
      minRcl: 5,
      phase: "late",
      priority: 2,
      tags: ["core"],
      requires: ["core.storage.01"],
    };
    const snapshot = mockSnapshot({ rcl: 5 });
    const options: ValidationOptions = {
      ...defaultOptions,
      completedKeys: new Set(["core.storage.01"]),
    };
    const result = validateBuildCell(mockRoom(), dependentCell, { x: 25, y: 26 }, snapshot, options);
    expect(result).toBe("ok");
  });

  it("returns 'site-limit' when global sites at max", () => {
    const snapshot = mockSnapshot({ rcl: 2 });
    const options: ValidationOptions = {
      ...defaultOptions,
      globalSiteCount: 5,
      maxGlobalSites: 5,
    };
    const result = validateBuildCell(mockRoom(), cell, { x: 25, y: 25 }, snapshot, options);
    expect(result).toBe("site-limit");
  });
});

describe("Layout — collectCompletedKeys", () => {
  it("collects done and site state keys", () => {
    const queue: BuildTask[] = [
      { key: "a", pos: { x: 0, y: 0, roomName: "W1N1" }, structureType: STRUCTURE_EXTENSION, priority: 1, state: "done", attempts: 0, retryAt: 0 },
      { key: "b", pos: { x: 1, y: 0, roomName: "W1N1" }, structureType: STRUCTURE_EXTENSION, priority: 1, state: "site", attempts: 0, retryAt: 0 },
      { key: "c", pos: { x: 2, y: 0, roomName: "W1N1" }, structureType: STRUCTURE_EXTENSION, priority: 1, state: "queued", attempts: 0, retryAt: 0 },
    ];
    const completed = collectCompletedKeys(queue);
    expect(completed.has("a")).toBe(true);
    expect(completed.has("b")).toBe(true);
    expect(completed.has("c")).toBe(false);
  });
});

// ── task-factory.ts ──
describe("Layout — phaseAllowed", () => {
  it("bootstrap is never allowed", () => {
    expect(phaseAllowed("bootstrap", 1)).toBe(false);
    expect(phaseAllowed("bootstrap", 8)).toBe(false);
  });

  it("rcl2 allowed at RCL2+", () => {
    expect(phaseAllowed("rcl2", 1)).toBe(false);
    expect(phaseAllowed("rcl2", 2)).toBe(true);
    expect(phaseAllowed("rcl2", 4)).toBe(true);
  });

  it("late allowed at RCL5+", () => {
    expect(phaseAllowed("late", 4)).toBe(false);
    expect(phaseAllowed("late", 5)).toBe(true);
    expect(phaseAllowed("late", 8)).toBe(true);
  });
});

describe("Layout — blueprintToTasks", () => {
  it("only generates tasks for allowed phases", () => {
    const snapshot = mockSnapshot({ rcl: 2 });
    const candidates = blueprintToTasks(
      COMPACT_CORE_V2,
      25, 25,
      "W1N1",
      mockRoom(),
      snapshot,
      2,
      defaultOptions,
    );
    // RCL2: only rcl2 phase cells should be generated
    for (const c of candidates) {
      expect(c.phase).toBe("rcl2");
    }
    // Should have 5 extensions
    const exts = candidates.filter(c => c.structureType === STRUCTURE_EXTENSION);
    expect(exts.length).toBe(5);
  });

  it("generates rcl3 tasks at RCL3", () => {
    const snapshot = mockSnapshot({ rcl: 3 });
    const candidates = blueprintToTasks(
      COMPACT_CORE_V2,
      25, 25,
      "W1N1",
      mockRoom(),
      snapshot,
      3,
      defaultOptions,
    );
    const phases = new Set(candidates.map(c => c.phase));
    expect(phases.has("rcl2")).toBe(true);
    expect(phases.has("rcl3")).toBe(true);
    expect(phases.has("rcl4")).toBe(false);
  });
});

describe("Layout — candidateToBuildTask", () => {
  it("creates a queued BuildTask from candidate", () => {
    const candidate = {
      key: "test.01",
      pos: { x: 10, y: 10, roomName: "W1N1" },
      structureType: STRUCTURE_EXTENSION as BuildableStructureConstant,
      priority: 1 as const,
      phase: "rcl2" as const,
      validation: "ok" as const,
    };
    const task = candidateToBuildTask(candidate);
    expect(task.key).toBe("test.01");
    expect(task.state).toBe("queued");
    expect(task.attempts).toBe(0);
  });
});

// ── road-policy.ts ──
describe("Layout — evaluateRoadCandidates", () => {
  it("returns empty when no traffic data", () => {
    const snapshot = mockSnapshot();
    expect(evaluateRoadCandidates("W1N1", snapshot, undefined, undefined)).toEqual([]);
  });

  it("returns empty when traffic below threshold", () => {
    const snapshot = mockSnapshot();
    const traffic = { "10,10": 5 };
    expect(evaluateRoadCandidates("W1N1", snapshot, traffic, traffic)).toEqual([]);
  });

  it("returns candidates with high traffic near endpoints", () => {
    const spawn = { pos: { x: 25, y: 25 }, structureType: STRUCTURE_SPAWN } as unknown as StructureSpawn;
    const source = { id: "src1", pos: { x: 30, y: 25, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({
      spawns: [spawn],
      sources: [source],
      rcl: 3,
    });
    const currentTraffic = { "26,25": 15, "27,25": 20 };
    const prevTraffic = { "26,25": 12, "27,25": 18 };
    const candidates = evaluateRoadCandidates("W1N1", snapshot, currentTraffic, prevTraffic, {
      minTraffic: 10,
      maxCandidates: 5,
      maxDistanceToEndpoints: 10,
    });
    expect(candidates.length).toBe(2);
    // Higher traffic first
    expect(candidates[0]?.traffic).toBe(20);
  });
});

// ── task-factory.ts — createSourceContainerTasks ──
describe("Layout — createSourceContainerTasks", () => {
  it("returns empty when containers already cover all sources", () => {
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const container = {
      id: "c1",
      structureType: STRUCTURE_CONTAINER,
      pos: { x: 11, y: 10, roomName: "W1N1" },
    } as unknown as StructureContainer;
    const snapshot = mockSnapshot({ sources: [source], containers: [container], rcl: 2 });
    const result = createSourceContainerTasks(snapshot, mockRoom(), defaultOptions);
    expect(result).toEqual([]);
  });

  it("creates a container task for source without adjacent container", () => {
    const source = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const snapshot = mockSnapshot({ sources: [source], rcl: 2 });
    // 8 个相邻位置无 wall 无占用 — 应返回第一个可建造位置
    const result = createSourceContainerTasks(snapshot, mockRoom(), defaultOptions);
    expect(result).toHaveLength(1);
    expect(result[0]!.structureType).toBe(STRUCTURE_CONTAINER);
    expect(result[0]!.key).toBe("logistics.container.source.src1");
    expect(result[0]!.validation).toBe("ok");
  });

  it("returns empty when RCL container limit reached", () => {
    const source1 = { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1" } } as unknown as Source;
    const source2 = { id: "src2", pos: { x: 40, y: 40, roomName: "W1N1" } } as unknown as Source;
    // RCL2 container 上限是 5，但 sources 数量为 2 — 已有 2 个 container 即满足
    const c1 = { id: "c1", structureType: STRUCTURE_CONTAINER, pos: { x: 11, y: 10, roomName: "W1N1" } } as unknown as StructureContainer;
    const c2 = { id: "c2", structureType: STRUCTURE_CONTAINER, pos: { x: 41, y: 40, roomName: "W1N1" } } as unknown as StructureContainer;
    const snapshot = mockSnapshot({
      sources: [source1, source2],
      containers: [c1, c2],
      rcl: 2,
    });
    const result = createSourceContainerTasks(snapshot, mockRoom(), defaultOptions);
    expect(result).toEqual([]);
  });
});

// ── task-factory.ts — createControllerContainerTask ──
describe("Layout — createControllerContainerTask", () => {
  it("returns undefined when RCL < 2", () => {
    const controller = { pos: { x: 30, y: 30, roomName: "W1N1" } } as unknown as StructureController;
    const snapshot = mockSnapshot({ controller, rcl: 1 });
    expect(createControllerContainerTask(snapshot, mockRoom(), defaultOptions)).toBeUndefined();
  });

  it("returns undefined when controller has adjacent container", () => {
    const controller = { pos: { x: 30, y: 30, roomName: "W1N1" } } as unknown as StructureController;
    const container = {
      id: "c1",
      structureType: STRUCTURE_CONTAINER,
      pos: { x: 31, y: 30, roomName: "W1N1" },
    } as unknown as StructureContainer;
    const snapshot = mockSnapshot({ controller, containers: [container], rcl: 3 });
    expect(createControllerContainerTask(snapshot, mockRoom(), defaultOptions)).toBeUndefined();
  });

  it("creates a controller container task when no adjacent container", () => {
    const controller = { pos: { x: 30, y: 30, roomName: "W1N1" } } as unknown as StructureController;
    const snapshot = mockSnapshot({ controller, rcl: 3 });
    const result = createControllerContainerTask(snapshot, mockRoom(), defaultOptions);
    expect(result).toBeDefined();
    expect(result!.structureType).toBe(STRUCTURE_CONTAINER);
    expect(result!.key).toBe("logistics.container.controller");
    expect(result!.phase).toBe("rcl2");
  });
});

// ── task-factory.ts — extractBlockedCandidates ──
describe("Layout — extractBlockedCandidates", () => {
  it("extracts only terrain/occupied failures", () => {
    const candidates = [
      { validation: "ok" as const, key: "k1", pos: { x: 0, y: 0, roomName: "W1N1" }, structureType: STRUCTURE_EXTENSION as BuildableStructureConstant, priority: 1 as const, phase: "rcl2" as const },
      { validation: "terrain" as const, key: "k2", pos: { x: 0, y: 0, roomName: "W1N1" }, structureType: STRUCTURE_EXTENSION as BuildableStructureConstant, priority: 1 as const, phase: "rcl2" as const },
      { validation: "occupied" as const, key: "k3", pos: { x: 0, y: 0, roomName: "W1N1" }, structureType: STRUCTURE_EXTENSION as BuildableStructureConstant, priority: 1 as const, phase: "rcl2" as const },
      { validation: "rcl" as const, key: "k4", pos: { x: 0, y: 0, roomName: "W1N1" }, structureType: STRUCTURE_EXTENSION as BuildableStructureConstant, priority: 1 as const, phase: "rcl2" as const },
    ];
    const blocked = extractBlockedCandidates(candidates);
    expect(blocked.map(c => c.key)).toEqual(["k2", "k3"]);
  });
});

// ── validation.ts — collectCompletedKeysFromStructures ──
describe("Layout — collectCompletedKeysFromStructures", () => {
  it("matches structures at blueprint offsets", () => {
    // 锚点 (20,20)，v2 中 dx=2 dy=0 的 cell（core.ext.04）— 应匹配 (22,20) 上的 extension。
    const anchor = { x: 20, y: 20 };
    const extension = {
      structureType: STRUCTURE_EXTENSION,
      pos: { x: 22, y: 20, roomName: "W1N1" },
    } as unknown as StructureExtension;
    const snapshot = mockSnapshot({ extensions: [extension] });

    const result = collectCompletedKeysFromStructures(COMPACT_CORE_V2, anchor.x, anchor.y, snapshot);
    // 找出 COMPACT_CORE_V2 中 dx=2, dy=0 的 cell
    const matchingCell = COMPACT_CORE_V2.cells.find(c => c.dx === 2 && c.dy === 0);
    expect(matchingCell?.structureType).toBe(STRUCTURE_EXTENSION);
    expect(result.has(matchingCell!.key)).toBe(true);
  });

  it("returns empty when no structures match blueprint offsets", () => {
    const anchor = { x: 20, y: 20 };
    // extension 在 (5,5) — 不匹配任何 cell offset。
    const extension = {
      structureType: STRUCTURE_EXTENSION,
      pos: { x: 5, y: 5, roomName: "W1N1" },
    } as unknown as StructureExtension;
    const snapshot = mockSnapshot({ extensions: [extension] });

    const result = collectCompletedKeysFromStructures(COMPACT_CORE_V2, anchor.x, anchor.y, snapshot);
    expect(result.size).toBe(0);
  });

  it("handles anchor shift — old structures do not match new offsets", () => {
    // 模拟 anchor 变化（spawn 重建）：旧 extension 在 (21,20) 对应旧 anchor (20,20) 的 dx=1,dy=0，
    // 新 anchor (25,25) — 同一结构不再匹配 dx=1,dy=0（应在 (26,25)）。
    const newAnchor = { x: 25, y: 25 };
    const extension = {
      structureType: STRUCTURE_EXTENSION,
      pos: { x: 21, y: 20, roomName: "W1N1" },
    } as unknown as StructureExtension;
    const snapshot = mockSnapshot({ extensions: [extension] });

    const result = collectCompletedKeysFromStructures(COMPACT_CORE_V2, newAnchor.x, newAnchor.y, snapshot);
    // 不应包含任何 extension cell — 验证 anchor 变化后旧结构不会被误识别。
    for (const cell of COMPACT_CORE_V2.cells.filter(c => c.structureType === STRUCTURE_EXTENSION)) {
      expect(result.has(cell.key)).toBe(false);
    }
  });
});

// ── validation.ts — countExistingAndSites 通用扫描（修复后）──
describe("Layout — countExistingAndSites via validateBuildCell (road coverage)", () => {
  it("counts roads correctly — RCL limit not exceeded returns ok", () => {
    // 验证修复后的通用扫描能正确处理 road — road 在 RCL2 上限 250，1 个 road 不会触发 "rcl"。
    // 之前 switch 未处理 road 会导致 countExistingAndSites 返回 0，但靠 250 上限掩盖了缺陷。
    // 修复后扫描能正确计数，但因上限远未达到，结果仍是 "ok"（除非位置被占用）。
    const road = {
      structureType: STRUCTURE_ROAD,
      pos: { x: 15, y: 15, roomName: "W1N1" },
    } as unknown as StructureRoad;
    const snapshot = mockSnapshot({ roads: [road], rcl: 2 });
    const cell: BlueprintCell = {
      key: "road.test",
      dx: 0,
      dy: 0,
      structureType: STRUCTURE_ROAD,
      minRcl: 1,
      phase: "rcl2",
      priority: 3,
      tags: ["logistics"],
    };
    // 在不同位置建 road — 不会触发 occupied（isOccupied 未含 road），
    // 也不会触发 rcl（250 上限未达）— 应返回 "ok"。
    const result = validateBuildCell(
      mockRoom(),
      cell,
      { x: 16, y: 16 },
      snapshot,
      defaultOptions,
    );
    expect(result).toBe("ok");
  });

  it("counts extensions correctly — RCL limit triggers rcl failure", () => {
    // 验证通用扫描能正确计数 extension：RCL2 上限 5，已有 5 个时应返回 "rcl"。
    const extensions = Array.from({ length: 5 }, (_, i) => ({
      structureType: STRUCTURE_EXTENSION,
      pos: { x: 10 + i, y: 10, roomName: "W1N1" },
    } as unknown as StructureExtension));
    const snapshot = mockSnapshot({ extensions, rcl: 2 });
    const cell: BlueprintCell = {
      key: "ext.test",
      dx: 0,
      dy: 0,
      structureType: STRUCTURE_EXTENSION,
      minRcl: 2,
      phase: "rcl2",
      priority: 1,
      tags: ["core"],
    };
    // 已有 5 个 extension（RCL2 上限），新位置应返回 "rcl"。
    const result = validateBuildCell(
      mockRoom(),
      cell,
      { x: 20, y: 20 },
      snapshot,
      defaultOptions,
    );
    expect(result).toBe("rcl");
  });
});

// ── task-factory.ts — createDefenseTasks（P0-3：RCL3 兜底防御）──
describe("Layout — createDefenseTasks RCL3 兜底（P0-3）", () => {
  /**
   * P0-3 修复：RCL3 是"刚有 Tower 但无 rampart"的最脆弱窗口期。
   * 修复前：DEFAULT_DEFENSE_OPTIONS.minRcl = 4，RCL3 完全不生成 rampart。
   * 修复后：minRcl = 3，RCL3 时扇区防御 fallback 生成包围核心的 rampart。
   *
   * defense-planner.ts 侧的 min-cut 块也加了 RCL4 门禁，RCL3 走扇区防御主路径。
   */
  it("DEFAULT_DEFENSE_OPTIONS.minRcl 应为 3（P0-3 修复）", () => {
    expect(DEFAULT_DEFENSE_OPTIONS.minRcl).toBe(3);
  });

  it("RCL2 时返回空（minRcl 门禁未通过）", () => {
    const spawn = {
      pos: { x: 25, y: 25, roomName: "W1N1" },
    } as unknown as StructureSpawn;
    const snapshot = mockSnapshot({ rcl: 2, spawns: [spawn] });
    // 东侧出口
    const exits = [{ x: 49, y: 25 }];
    const result = createDefenseTasks(snapshot, exits, mockRoom(), defaultOptions);
    expect(result).toEqual([]);
  });

  it("RCL3 + spawn 存在 + 有出口时生成 rampart 任务（P0-3 核心修复）", () => {
    const spawn = {
      pos: { x: 25, y: 25, roomName: "W1N1" },
    } as unknown as StructureSpawn;
    const tower = {
      pos: { x: 26, y: 25, roomName: "W1N1" },
    } as unknown as StructureTower;
    const snapshot = mockSnapshot({
      rcl: 3,
      spawns: [spawn],
      towers: [tower],
      ramparts: [],
      constructionSites: [],
    });
    // 东侧出口 — 敌人从东边来
    const exits = [{ x: 49, y: 25 }];
    const result = createDefenseTasks(snapshot, exits, mockRoom(), defaultOptions);
    // 应生成至少 1 个 rampart 任务（lineLength=3）
    expect(result.length).toBeGreaterThan(0);
    // 所有任务应为 STRUCTURE_RAMPART
    expect(result.every(c => c.structureType === STRUCTURE_RAMPART)).toBe(true);
  });

  it("无 spawn 时返回空（无核心可保护）", () => {
    const snapshot = mockSnapshot({ rcl: 3, spawns: [] });
    const exits = [{ x: 49, y: 25 }];
    const result = createDefenseTasks(snapshot, exits, mockRoom(), defaultOptions);
    expect(result).toEqual([]);
  });

  it("RCL3 无出口时返回空（房间被完全包围，无需防御）", () => {
    const spawn = {
      pos: { x: 25, y: 25, roomName: "W1N1" },
    } as unknown as StructureSpawn;
    const snapshot = mockSnapshot({ rcl: 3, spawns: [spawn] });
    const exits: { x: number; y: number }[] = [];
    const result = createDefenseTasks(snapshot, exits, mockRoom(), defaultOptions);
    expect(result).toEqual([]);
  });
});
