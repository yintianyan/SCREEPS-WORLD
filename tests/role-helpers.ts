/**
 * Role 级场景测试共享 mock 工厂。
 *
 * 设计原则：
 *   - 每个工厂函数返回最小可用 mock，测试按需覆盖字段。
 *   - Game/Memory/globalThis 在每个测试前通过 resetGlobals() 重置。
 *   - Creep mock 的 action 方法（harvest/transfer/...）默认返回 OK，
 *     测试可通过 vi.fn() 替换以模拟 ERR_NOT_IN_RANGE 等。
 */
import { vi } from "vitest";
import type { Budget, CpuTier, RoomSnapshot, TickContext } from "../src/kernel/contracts";

// ─── 全局重置 ───────────────────────────────────────────────

const objectRegistry = new Map<string, unknown>();

export function resetGlobals(): void {
  objectRegistry.clear();

  (globalThis as any).Game = {
    time: 1000,
    getObjectById: (id: string) => objectRegistry.get(id) ?? null,
    map: { describeExits: () => ({ "1": "W7N3", "3": "W6N4", "5": "W7N5", "7": "W8N4" }) },
    cpu: { getUsed: () => 0, limit: 20, tickLimit: 500 },
    rooms: {},
    creeps: {},
    spawns: {},
  };

  // PathFinder.CostMatrix mock（移动系统使用）。
  if (!(globalThis as any).PathFinder) {
    (globalThis as any).PathFinder = {
      CostMatrix: class {
        private _data = new Uint8Array(2500);
        set(x: number, y: number, cost: number) { this._data[x * 50 + y] = cost; }
        get(x: number, y: number) { return this._data[x * 50 + y] ?? 0; }
      },
      search: vi.fn(() => ({ path: [], incomplete: true, ops: 0, cost: 0 })),
    };
  }

  (globalThis as any).Memory = {
    creeps: {},
    rooms: { W7N4: { layout: { revision: 1 } } },
    kernel: {},
  };

  // 清除 globalCache 字段。
  const g = globalThis as any;
  delete g.assignment;
  delete g.fillReservations;
  delete g.fillReservationTick;
  delete g.roomTraffic;
  delete g.errorLog;
  delete g.errorCounts;
  delete g.pluginCooldowns;
  delete g.telemetry;
  delete g.skipBuffer;
  // per-tick 缓存（movement 重构 + P2-6 对象缓存）— Game.time 固定为 1000，
  // 不清理会导致上一测试缓存的对象/路径污染下一测试。
  delete g.__objCache;
  delete g.__objCacheTick;
  delete g.__pathShare;
  delete g.__pathShareTick;
  delete g.__structCache;
  delete g.__coreCenter;
  delete g.__creepPathCache;
  delete g.__yieldRequests;
}

/** 注册一个可被 Game.getObjectById 找到的对象。 */
export function registerObject(id: string, obj: unknown): void {
  objectRegistry.set(id, obj);
}

// ─── RoomPosition Mock ──────────────────────────────────────

export interface MockPos {
  x: number;
  y: number;
  roomName: string;
  getRangeTo: ReturnType<typeof vi.fn>;
  getDirectionTo: ReturnType<typeof vi.fn>;
  findClosestByRange: ReturnType<typeof vi.fn>;
  findPathTo: ReturnType<typeof vi.fn>;
}

export function mockPos(x = 25, y = 25, roomName = "W7N4"): MockPos {
  return {
    x,
    y,
    roomName,
    getRangeTo: vi.fn(() => 1),
    getDirectionTo: vi.fn(() => 3), // RIGHT
    findClosestByRange: vi.fn((targets: any[]) => {
      if (!Array.isArray(targets) || targets.length === 0) return null;
      return targets[0];
    }),
    findPathTo: vi.fn(() => []),
  };
}

// ─── Store Mock ─────────────────────────────────────────────

export function mockStore(used: number, capacity: number) {
  return {
    getUsedCapacity: vi.fn((_r?: string) => used),
    getFreeCapacity: vi.fn((_r?: string) => capacity - used),
    getCapacity: vi.fn((_r?: string) => capacity),
    energy: used,
  };
}

// ─── Creep Mock ─────────────────────────────────────────────

export interface MockCreepOpts {
  name?: string;
  role?: string;
  mode?: string;
  home?: string;
  used?: number;
  capacity?: number;
  pos?: MockPos;
  sourceId?: string;
  assignment?: any;
  ticksToLive?: number;
}

export function mockCreep(opts: MockCreepOpts = {}): any {
  const {
    name = "harvester_1",
    role = "harvester",
    mode = "acquire",
    home = "W7N4",
    used = 0,
    capacity = 50,
    pos = mockPos(),
    sourceId,
    assignment,
    ticksToLive = 1000,
  } = opts;

  const memory: any = {
    role,
    mode,
    home,
    sourceId,
    assignment,
    stuckTicks: 0,
    lastPos: undefined,
    targetId: undefined,
  };

  return {
    name,
    memory,
    store: mockStore(used, capacity),
    pos,
    room: { name: home, findExitTo: vi.fn(() => 3), lookForAt: vi.fn(() => []) },
    ticksToLive,
    // 默认平衡 body（MOVE 容量 >= 总重量，非慢速 creep）。
    body: [
      { type: "work", hits: 100 },
      { type: "carry", hits: 100 },
      { type: "move", hits: 100 },
      { type: "move", hits: 100 },
    ],
    // Actions — 默认 OK，测试可覆盖。
    harvest: vi.fn(() => 0),
    transfer: vi.fn(() => 0),
    withdraw: vi.fn(() => 0),
    pickup: vi.fn(() => 0),
    drop: vi.fn(() => 0),
    build: vi.fn(() => 0),
    upgradeController: vi.fn(() => 0),
    repair: vi.fn(() => 0),
    moveTo: vi.fn(() => 0),
    move: vi.fn(() => 0),
    moveByPath: vi.fn(() => -11), // ERR_NOT_FOUND — 默认不命中共享路径
  };
}

// ─── Structure Mocks ────────────────────────────────────────

export function mockStructure(type: string, opts: { id?: string; energy?: number; capacity?: number; hits?: number; hitsMax?: number } = {}) {
  const { id = `${type}_${Math.random().toString(36).slice(2, 8)}`, energy = 0, capacity = 1000, hits = 1000, hitsMax = 1000 } = opts;
  const obj: any = {
    id,
    structureType: type,
    store: mockStore(energy, capacity),
    hits,
    hitsMax,
    pos: mockPos(),
    my: true,
  };
  registerObject(id, obj);
  return obj;
}

export function mockSource(id = "source_1", energy = 3000) {
  const obj: any = { id, energy, pos: mockPos() };
  registerObject(id, obj);
  return obj;
}

export function mockController(opts: { my?: boolean; ticksToDowngrade?: number; level?: number } = {}): any {
  const { my = true, ticksToDowngrade = 20000, level = 3 } = opts;
  return { id: "controller_1", my, ticksToDowngrade, level, pos: mockPos(), structureType: "controller" };
}

export function mockConstructionSite(type = "extension", opts: { id?: string } = {}) {
  const { id = `site_${Math.random().toString(36).slice(2, 8)}` } = opts;
  const obj: any = { id, structureType: type, pos: mockPos(), my: true };
  registerObject(id, obj);
  return obj;
}

export function mockHostile(name = "hostile_1"): any {
  return { id: name, name, pos: mockPos(10, 10), owner: { username: "enemy" } };
}

// ─── RoomSnapshot Mock ──────────────────────────────────────

export function mockSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomName: "W7N4",
    rcl: 3,
    controller: mockController(),
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
    sources: [mockSource()],
    constructionSites: [],
    myConstructionSites: [],
    hostileCreeps: [],
    // 默认 threatCreeps 镜像 hostileCreeps（除非显式覆盖），保持旧 flee 测试行为不变。
    threatCreeps: overrides.threatCreeps ?? overrides.hostileCreeps ?? [],
    energyAvailable: 500,
    energyCapacityAvailable: 800,
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
    ...overrides,
  };
}

// ─── Budget Mock ────────────────────────────────────────────

export function mockBudget(tier: CpuTier = "healthy"): Budget {
  return {
    tier,
    softLimit: 17.5,
    hardLimit: 19.2,
    canStart: vi.fn(() => true),
    isExhausted: vi.fn(() => false),
    spent: vi.fn(() => 5),
  };
}

// ─── TickContext Mock ───────────────────────────────────────

export function mockContext(snapshot?: RoomSnapshot, budget?: Budget): TickContext {
  const snap = snapshot ?? mockSnapshot();
  const b = budget ?? mockBudget();
  return {
    tick: (globalThis as any).Game.time,
    budget: b,
    globalSiteCount: snap.myConstructionSites.length,
    getSnapshot: vi.fn((_room: string) => snap),
    snapshots: vi.fn(function* () { yield snap; }),
  };
}
