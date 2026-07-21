import { describe, expect, it } from "vitest";
import {
  collectCorridorEndpoints,
  planCorridorRoads,
  DEFAULT_CORRIDOR_OPTIONS,
  type PathFn,
} from "../src/domain/layout/corridor-roads";
import type { RoomSnapshot } from "../src/kernel/contracts";

// ── mock 辅助 ──
function pos(x: number, y: number, roomName = "W1N1") {
  return { x, y, roomName };
}
function src(x: number, y: number, id: string): Source {
  return { id, pos: pos(x, y) } as unknown as Source;
}
function cont(x: number, y: number, id: string): StructureContainer {
  return { id, pos: pos(x, y), structureType: "container" } as unknown as StructureContainer;
}
function spawnAt(x: number, y: number): StructureSpawn {
  return { id: "spawn1", pos: pos(x, y) } as unknown as StructureSpawn;
}
function roadAt(x: number, y: number): StructureRoad {
  return { id: `road${x}_${y}`, pos: pos(x, y), structureType: "road" } as unknown as StructureRoad;
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
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map(),
    minerals: [],
    ...overrides,
  };
}

const fakeRoom = {} as Room;

// ── collectCorridorEndpoints ──
describe("Corridor — collectCorridorEndpoints", () => {
  it("returns empty when no spawn (no core anchor)", () => {
    const snapshot = mockSnapshot({ spawns: [], sources: [src(12, 31, "s1")] });
    expect(collectCorridorEndpoints(snapshot)).toEqual([]);
  });

  it("connects controller container and source containers to the core, controller first", () => {
    const snapshot = mockSnapshot({
      spawns: [spawnAt(25, 25)],
      sources: [src(12, 31, "s1")],
      // 12,30 紧邻 source 12,31 → source container。
      containers: [cont(12, 30, "c1")],
      controllerContainer: cont(38, 11, "ctrl-c"),
    });
    const pairs = collectCorridorEndpoints(snapshot);
    expect(pairs).toHaveLength(2);
    // controller container 走廊优先。
    expect(pairs[0]!.from).toEqual({ x: 38, y: 11, roomName: "W1N1" });
    expect(pairs[0]!.to).toEqual({ x: 25, y: 25, roomName: "W1N1" });
    // 其次 source container。
    expect(pairs[1]!.from).toEqual({ x: 12, y: 30, roomName: "W1N1" });
    expect(pairs[1]!.to).toEqual({ x: 25, y: 25, roomName: "W1N1" });
  });

  it("excludes containers not adjacent to any source", () => {
    const snapshot = mockSnapshot({
      spawns: [spawnAt(25, 25)],
      sources: [src(12, 31, "s1")],
      // 40,45 不紧邻任何 source → 非 source container，不应入对。
      containers: [cont(40, 45, "c2")],
    });
    expect(collectCorridorEndpoints(snapshot)).toEqual([]);
  });
});

// ── planCorridorRoads ──
describe("Corridor — planCorridorRoads", () => {
  const corridorSnapshot = () =>
    mockSnapshot({
      spawns: [spawnAt(25, 25)],
      sources: [src(12, 31, "s1")],
      containers: [cont(12, 30, "c1")],
      controllerContainer: cont(38, 11, "ctrl-c"),
    });

  it("collects path tiles from the injected pathfinder", () => {
    const pathFn: PathFn = () => [
      { x: 20, y: 20 },
      { x: 21, y: 21 },
      { x: 22, y: 22 },
    ];
    const roads = planCorridorRoads(fakeRoom, corridorSnapshot(), DEFAULT_CORRIDOR_OPTIONS, pathFn);
    expect(roads).toEqual([
      { x: 20, y: 20, roomName: "W1N1" },
      { x: 21, y: 21, roomName: "W1N1" },
      { x: 22, y: 22, roomName: "W1N1" },
    ]);
  });

  it("skips tiles already occupied by roads/structures", () => {
    const snapshot = mockSnapshot({
      spawns: [spawnAt(25, 25)],
      sources: [src(12, 31, "s1")],
      containers: [cont(12, 30, "c1")],
      controllerContainer: cont(38, 11, "ctrl-c"),
      roads: [roadAt(21, 21)],
    });
    const pathFn: PathFn = () => [
      { x: 20, y: 20 },
      { x: 21, y: 21 }, // 已有 road — 跳过
      { x: 22, y: 22 },
    ];
    const roads = planCorridorRoads(fakeRoom, snapshot, DEFAULT_CORRIDOR_OPTIONS, pathFn);
    expect(roads.map(r => `${r.x},${r.y}`)).toEqual(["20,20", "22,22"]);
  });

  it("dedupes tiles shared across multiple corridor pairs", () => {
    // 两条走廊都经过 20,20 — 只收录一次。
    const pathFn: PathFn = from =>
      from.x === 38
        ? [{ x: 20, y: 20 }, { x: 30, y: 30 }]
        : [{ x: 20, y: 20 }, { x: 15, y: 15 }];
    const roads = planCorridorRoads(fakeRoom, corridorSnapshot(), DEFAULT_CORRIDOR_OPTIONS, pathFn);
    const keys = roads.map(r => `${r.x},${r.y}`);
    expect(keys.filter(k => k === "20,20")).toHaveLength(1);
    expect(keys).toContain("30,30");
    expect(keys).toContain("15,15");
  });

  it("respects maxRoadsPerCycle for segmented building", () => {
    const pathFn: PathFn = () => [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ];
    const roads = planCorridorRoads(fakeRoom, corridorSnapshot(), { maxRoadsPerCycle: 2 }, pathFn);
    expect(roads).toHaveLength(2);
  });

  it("skips out-of-bounds tiles", () => {
    const pathFn: PathFn = () => [
      { x: 0, y: 0 }, // 越界
      { x: 49, y: 49 }, // 越界
      { x: 20, y: 20 },
    ];
    const roads = planCorridorRoads(fakeRoom, corridorSnapshot(), DEFAULT_CORRIDOR_OPTIONS, pathFn);
    expect(roads).toEqual([{ x: 20, y: 20, roomName: "W1N1" }]);
  });

  it("returns empty when there are no corridor endpoints", () => {
    const pathFn: PathFn = () => [{ x: 20, y: 20 }];
    const roads = planCorridorRoads(fakeRoom, mockSnapshot({ spawns: [] }), DEFAULT_CORRIDOR_OPTIONS, pathFn);
    expect(roads).toEqual([]);
  });
});
