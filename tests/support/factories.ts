/**
 * unit 工具层 — 共享 mock 工厂（FREEZE R20① / T4）。
 *
 * 自 tests/role-helpers.ts 升格入驻：unit 层 fixture 工厂的唯一实现。
 * 审计确认的重复工厂（makeSnapshot×16 / makeContext×10 / makeCreep×6 /
 * makeStore×4 雷同等）按 T4 分批归并到本文件的 defaults+overrides 模式。
 */
import { vi } from "vitest";
import type { Budget, CpuTier, RoomSnapshot, TickContext } from "../../src/kernel/contracts";

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
  // per-tick 事件缓冲（recordEvent 写入）— 漏清会让事件断言跨用例污染。
  delete g.eventBuffer;
  // 观察交接缓冲（room-observer → intelligence）— 漏清会让情报观测跨用例泄漏。
  delete g.intelHandoff;
  delete g.__observePending;
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
  delete g.__remoteThreats;
  delete g.__remoteDropped;
  delete g.__remoteContainers;
  delete g.__remoteInvaderCore;
  delete g.__remoteRuins;
  delete g.__hostilesCache;
  delete g.__myCreepsCache;
  delete g.__remoteSources;
  delete g.__warStructures;
  delete g.__powerBanks;
  delete g.__pbRoomCache;
  delete g.boostAssignments;
  // action profiling 缓存
  delete g.actionCpu;
  delete g.actionCpuTick;
  // P0-A：site 配额共享账本（construction-manager × remote-mining-manager）
  delete g.sitesCreatedThisTick;
  delete g.remoteSiteTotal;
  // P1-E：每房每 tick 寻路预算计数器
  delete g.__pathSearchBudget;
  // P1-F：layout 4-stage 分片跨 tick 中间产物
  delete g.__planStageData;
  // P1-1：死资产 link 计时器（link-system 维护）
  delete g.deadAssetSince;
  // P1-3：link 几何受限标记 + P1-4 拆改计划与冷却账本
  delete g.linkConstrained;
  delete g.dismantlePlans;
  delete g.lastDismantleTick;
  // P1-4：拆改累计计数 + 走廊路路径缓存（同 heap 生命周期；漏清会让
  // corridor-cache-invalidation / layout-restart-stability 跨用例污染，见体检报告 §3.1）
  delete g.dismantleCount;
  delete g.corridorPathCache;
  // R3：war-planner / attacker 的敌结构共享缓存（同 heap 生命周期 — 漏清会让
  // attacker 测试跨用例复用上一用例缓存的敌结构，Game.time 固定 1000 无法自然过期）。
  delete g.__warStructures;
  // P0-1：全局编队索引（kernel.buildSnapshots 预构建，测试中需手动同步）。
  delete g.squadIndex;
  // kernel.buildSnapshots 预构建的远矿目标集合（economy sampleRoomFlows 消费）。
  delete g.remoteTargetRooms;
  // tower-defense 的威胁未决心跳限频（reportThreatUnhandled 写入）。
  delete g.threatUnhandledAt;
}

/**
 * P0-1：从当前 Game.creeps 构建 squadIndex（测试 helper）。
 * 生产环境由 kernel.buildSnapshots 预构建；测试 mock 直接设 Game.creeps 时
 * 需调用此函数同步索引，否则 querySquad 返回空。
 */
export function syncSquadIndex(): void {
  const entries: Array<{
    name: string; role: string; home: string;
    remoteTarget?: string; mission?: string; boosted: boolean; spawning: boolean;
  }> = [];
  const creeps = (globalThis as any).Game?.creeps ?? {};
  for (const [name, creep] of Object.entries(creeps) as [string, any][]) {
    const mem = creep.memory ?? {};
    if (!mem.remoteTarget && !mem.mission && !mem.home) continue;
    entries.push({
      name,
      role: mem.role ?? "unknown",
      home: mem.home ?? "W7N4",
      remoteTarget: mem.remoteTarget,
      mission: mem.mission,
      boosted: (creep.body ?? []).some((p: any) => p.boost !== undefined),
      spawning: creep.spawning === true,
    });
  }
  (globalThis as any).squadIndex = entries;
}

/** 注册一个可被 Game.getObjectById 找到的对象。 */
export function registerObject(id: string, obj: unknown): void {
  objectRegistry.set(id, obj);
}

// ─── RoomPosition Mock ──────────────────────────────────────

interface MockPos {
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

/**
 * 容量型纯对象 store mock（room-state 系测试归并，R20①/T4 批①）。
 * 与 mockStore（vi.fn 版）的区别：纯对象零开销、仅 energy 资源语义。
 */
export function mockCapacityStore(
  energy: number,
  capacity: number,
): { getUsedCapacity: (r: string) => number; getCapacity: (r: string) => number } {
  return {
    getUsedCapacity: (r: string) => (r === "energy" ? energy : 0),
    getCapacity: () => capacity,
  };
}

// ─── Creep Mock ─────────────────────────────────────────────

interface MockCreepOpts {
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
    attack: vi.fn(() => 0),
    hits: 1000,
    hitsMax: 1000,
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
    // 小队威胁默认关闭 — 集结避险行为仅在显式开启的用例中断言。
    squadThreat: overrides.squadThreat ?? false,
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
    observer: undefined,
    powerSpawn: undefined,
    nuker: undefined,
    droppedEnergy: [],
    tombstones: [],
    ruins: [],
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

/**
 * room-state 系测试的共享 TickContext 工厂（T4 批②归并）。
 *
 * 与 mockContext 的区别：接受 snapshots 数组 + 可选 tick（默认 100），
 * getSnapshot 按 roomName 查找而非返回固定快照，snapshots 返回数组迭代器。
 * 4 个 room-state 单元测试的 makeCtx 统一到此处。
 */
export function mockRoomStateCtx(
  snapshots: RoomSnapshot[],
  tick = 100,
): TickContext {
  return {
    tick,
    budget: {
      tier: "healthy" as CpuTier,
      softLimit: 17.5,
      hardLimit: 19.2,
      canStart: () => true,
      isExhausted: () => false,
      spent: () => 0,
    } as unknown as Budget,
    getSnapshot: (name: string) => snapshots.find(s => s.roomName === name),
    snapshots: () => snapshots,
    globalSiteCount: 0,
  } as unknown as TickContext;
}
