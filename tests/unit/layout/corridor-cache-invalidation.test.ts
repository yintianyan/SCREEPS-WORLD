/**
 * 走廊路缓存失效条件测试（走廊/缓存失效判定）。
 *
 * 病灶背景（漏洞 #5/#8）：
 *   走廊路每规划周期调用 PathFinder.search，单次 0.5-2ms CPU。原设计走
 *   segment 缓存 + schemaVersion 22 升级，但 schema 升级风险高于收益
 *   （P0-P1 已确认 heap 存储策略）。改为 globalCache heap 缓存，失效条件
 *   必须完整覆盖，否则旧缓存导致路径错误。
 *
 * 失效维度（signature = pairKey + rcl + anchor）：
 *   1. pairKey 变化：端点 container/storage 消失或新建 → 重新求路径
 *   2. rcl 变化：解锁新结构，路径可能变化 → 重新求路径
 *   3. anchor 变化：spawn 重建在新位置，核心位置已变 → 重新求路径
 *   4. 路径格被新建结构占用 → 由 planCorridorRoads 内部 occupied 过滤，
 *      不触发缓存失效（局部重算无意义，整体重算才能找到更优路径）
 *
 * 验证方式：
 *   - 通过 vi.fn() 跟踪 PathFinder.search 调用次数
 *   - 缓存命中 → search 不被调用；缓存失效 → search 再次被调用
 *   - 验证 global reset 清空 corridorPathCache 后的重新计算路径
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planCorridorRoads, DEFAULT_CORRIDOR_OPTIONS, type CorridorPathCacheStore } from "../../../src/domain/layout/corridor-roads";
import type { RoomSnapshot } from "../../../src/kernel/contracts";
import { globalCache, type CorridorPathCacheEntry } from "../../../src/kernel/global-cache";
import { mockPos, resetGlobals } from "../../role-helpers";

// ─── 房间 mock ──────────────────────────────────────────────
// buildCorridorCostMatrix 需要 room.getTerrain()；
// defaultPathFn 需要 new RoomPosition（已在 tests/setup.ts 全局 mock）。

interface MockTerrain {
  get: (x: number, y: number) => number;
}

function mockTerrain(walls: ReadonlySet<string> = new Set()): MockTerrain {
  return {
    get: (x: number, y: number) => (walls.has(`${x},${y}`) ? 1 : 0),
  };
}

function mockRoom(): Room {
  return { getTerrain: () => mockTerrain() } as unknown as Room;
}

// ─── snapshot 工厂 ───────────────────────────────────────

/** 【D-2 修复】测试用 cacheStore 实现 — 桥接 globalCache.corridorPathCache。 */
function makeTestCacheStore(): CorridorPathCacheStore {
  const cache = globalCache();
  return {
    ensureMap() {
      if (cache.corridorPathCache === undefined) cache.corridorPathCache = new Map();
    },
    get(roomName: string) {
      return cache.corridorPathCache?.get(roomName);
    },
    set(roomName: string, entry: CorridorPathCacheEntry) {
      if (!cache.corridorPathCache) cache.corridorPathCache = new Map();
      cache.corridorPathCache.set(roomName, entry);
    },
  };
}

// 物流端点：spawn @ (25,25) 核心，controller container @ (20,40)，
// source container @ (12,30) 紧邻 source @ (12,31)。

function snapshotFor(rcl: number, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomName: "W3N7",
    rcl,
    controller: { id: "ctrl", pos: mockPos(20, 40), level: rcl, my: true } as any,
    spawns: [{ id: "spawn1", pos: mockPos(25, 25), structureType: "spawn" } as any],
    extensions: [],
    towers: [],
    containers: [{ id: "c1", pos: mockPos(12, 30), structureType: "container" } as any],
    roads: [],
    walls: [],
    ramparts: [],
    storage: undefined,
    controllerContainer: { id: "cc", pos: mockPos(20, 40), structureType: "container" } as any,
    links: [],
    sources: [{ id: "src1", pos: mockPos(12, 31), energy: 3000 } as any],
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

// ─── PathFinder.search mock ─────────────────────────────────
// 默认返回空路径，测试按需覆写返回值并跟踪调用次数。

interface SearchReturnType {
  path: { x: number; y: number }[];
  incomplete: boolean;
  ops: number;
  cost: number;
}

function mockSearch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn((): SearchReturnType => ({
    path: [{ x: 22, y: 32 }, { x: 23, y: 33 }, { x: 24, y: 34 }],
    incomplete: false,
    ops: 100,
    cost: 10,
  }));
  (globalThis as any).PathFinder.search = fn;
  return fn;
}

beforeEach(() => {
  resetGlobals();
  mockSearch();
});

describe("走廊路缓存失效条件 — signature = pairKey + rcl + anchor", () => {
  it("缓存命中：相同 signature 第二次调用不触发 PathFinder.search", () => {
    const room = mockRoom();
    const snapshot = snapshotFor(5);
    const anchor = { x: 25, y: 25 };
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // 第一次调用：缓存未命中 → 计算 + 写入缓存。
    const first = planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(first.length).toBeGreaterThan(0);
    expect(search).toHaveBeenCalledTimes(1);

    // 第二次调用：signature 完全相同 → 命中缓存，不调用 search。
    const second = planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(second).toEqual(first);
    expect(search).toHaveBeenCalledTimes(1); // 仍然只调用 1 次
  });

  it("pairKey 变化（端点消失）→ 缓存失效，重新计算", () => {
    const room = mockRoom();
    const anchor = { x: 25, y: 25 };
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // 第一次：有 controller container → 走廊对 (20,40)→(25,25)。
    const snap1 = snapshotFor(5);
    planCorridorRoads(room, snap1, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(1);

    // 第二次：controller container 消失 → 走廊对变为 (12,30)→(25,25)。
    // pairKey 不同 → 缓存失效 → 重新调用 search。
    const snap2 = snapshotFor(5, { controllerContainer: undefined });
    planCorridorRoads(room, snap2, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("rcl 变化（升级）→ 缓存失效，重新计算", () => {
    const room = mockRoom();
    const anchor = { x: 25, y: 25 };
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // RCL5：缓存写入。
    const snapRcl5 = snapshotFor(5);
    planCorridorRoads(room, snapRcl5, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(1);

    // RCL6：rcl 字段变化 → 缓存失效（即使 pairKey 和 anchor 相同）。
    const snapRcl6 = snapshotFor(6);
    planCorridorRoads(room, snapRcl6, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("anchor 变化（spawn 重建）→ 缓存失效，重新计算", () => {
    const room = mockRoom();
    const snapshot = snapshotFor(5);
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // 锚点 (25,25)：缓存写入。
    planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, { x: 25, y: 25 }, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(1);

    // 锚点变为 (26,25)（spawn 重建在新位置）：anchor 字段变化 → 缓存失效。
    planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, { x: 26, y: 25 }, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("路径格被新建结构占用 → 缓存仍命中（occupied 过滤，不触发重算）", () => {
    const room = mockRoom();
    const snapshot = snapshotFor(5);
    const anchor = { x: 25, y: 25 };
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // 第一次调用：缓存写入。返回路径包含 (22,32)。
    const first = planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(first.some(p => p.x === 22 && p.y === 32)).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);

    // 第二次调用：(22,32) 已被新建结构占用（加入 occupied 集合）。
    // 缓存 signature 未变 → 仍命中缓存（search 不再调用），
    // 但 (22,32) 被 occupied 过滤掉，结果不含该格。
    const snapWithStructure = snapshotFor(5, {
      // 添加一个 structure 占用 (22,32)（用 roads 数组模拟 occupied）。
      roads: [{ id: "road_22_32", pos: mockPos(22, 32), structureType: "road" } as any],
    });
    const second = planCorridorRoads(room, snapWithStructure, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());

    // search 仍只调用 1 次 → 缓存命中。
    expect(search).toHaveBeenCalledTimes(1);
    // (22,32) 被过滤掉，结果不含该格。
    expect(second.some(p => p.x === 22 && p.y === 32)).toBe(false);
    // 其他格仍存在（缓存路径的其余部分）。
    expect(second.length).toBe(first.length - 1);
  });

  it("global reset 清空 corridorPathCache → 重新计算", () => {
    const room = mockRoom();
    const snapshot = snapshotFor(5);
    const anchor = { x: 25, y: 25 };
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // 第一次：缓存写入。
    planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(1);

    // 模拟 global reset：清空 corridorPathCache。
    const cache = globalCache();
    cache.corridorPathCache = undefined;

    // 第二次：缓存丢失 → 重新计算。
    planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, anchor, makeTestCacheStore());
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("无 anchor 时不走缓存（保持 pathFn 注入的确定性）", () => {
    const room = mockRoom();
    const snapshot = snapshotFor(5);
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // 无 anchor + 无 pathFn → 走 defaultPathFn（调用 PathFinder.search）。
    // 但不会写入缓存（anchor=undefined 时 getCachedOrComputePath 不被调用）。
    const first = planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, undefined);
    expect(search).toHaveBeenCalledTimes(1);

    // 第二次：仍无 anchor → 再次走 defaultPathFn（无缓存可命中）。
    const second = planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, undefined, undefined, undefined);
    expect(search).toHaveBeenCalledTimes(2);

    // 两次结果相同（确定性，但来自重复计算而非缓存）。
    expect(second).toEqual(first);

    // corridorPathCache 未被写入。
    const cache = globalCache();
    expect(cache.corridorPathCache).toBeUndefined();
  });

  it("pathFn 注入时不走缓存（单测确定性）", () => {
    const room = mockRoom();
    const snapshot = snapshotFor(5);
    const anchor = { x: 25, y: 25 };
    const search = (globalThis as any).PathFinder.search as ReturnType<typeof vi.fn>;

    // 注入 pathFn → 走 pathFn，不走缓存逻辑（即使有 anchor）。
    const injectedPath = [{ x: 11, y: 22 }, { x: 12, y: 23 }];
    const pathFn = () => injectedPath;
    const result = planCorridorRoads(room, snapshot, Game.time, DEFAULT_CORRIDOR_OPTIONS, pathFn, undefined, anchor);

    // PathFinder.search 不被调用（走注入的 pathFn）。
    expect(search).toHaveBeenCalledTimes(0);
    // 结果为注入路径（未在 occupied 中）。
    expect(result.map(r => `${r.x},${r.y}`)).toEqual(["11,22", "12,23"]);

    // corridorPathCache 未被写入（pathFn 注入时不缓存）。
    const cache = globalCache();
    expect(cache.corridorPathCache).toBeUndefined();
  });
});
