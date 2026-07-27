import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";

// ── 模块 mock ──────────────────────────────────────────────

const capturedEvents: { t: number; k: number; r: string; d: number[] }[] = [];

const mockGlobalCache: Record<string, unknown> = {};

vi.mock("../../../src/kernel/global-cache", () => ({
  globalCache: () => mockGlobalCache,
}));

vi.mock("../../../src/kernel/segment-store", () => ({
  readCpuSegment: () => ({ cpu: { d: [], h: 0, c: 0 }, population: null }),
  readEconomySegment: () => ({ economy: { d: [], h: 0, c: 0 } }),
  readEventLogSegment: () => ({
    events: {
      d: new Array(50),
      h: 0,
      c: 0,
      // 自定义 push 拦截 — 每次 ringPush 会写 d[h] 并推进 h
    },
  }),
  markCpuDirty: vi.fn(),
  markEconomyDirty: vi.fn(),
  markEventLogDirty: vi.fn(),
}));

vi.mock("../../../src/kernel/timeseries", () => ({
  sampleCpu: vi.fn(),
  sampleEconomy: vi.fn(),
}));

vi.mock("../../../src/kernel/event-log", () => ({
  EventKind: {
    PhaseTransition: 0,
    TierDowngrade: 1,
    TierUpgrade: 2,
    ColonyStateChange: 3,
    ControllerLevelUp: 4,
    ControllerDowngradeRisk: 5,
    P0SpawnRequest: 6,
    EnemyInvasion: 7,
    EnemyCleared: 8,
    SafeModeActivated: 9,
    PluginCooldown: 10,
    CreepStuck: 11,
    BuildComplete: 12,
    StructureDestroyed: 13,
  },
  drainEventBuffer: () => [],
}));

vi.mock("../../../src/kernel/ring-buffer", () => ({
  ringPush: (_buf: unknown, entry: unknown) => {
    // 只捕获事件对象（有 k 和 d 属性的）
    if (entry && typeof entry === "object" && "k" in entry && "d" in entry) {
      capturedEvents.push(entry as { t: number; k: number; r: string; d: number[] });
    }
  },
  ringToArray: () => [],
}));

vi.mock("../../../src/kernel/safe-run", () => ({
  getActionCpuSnapshot: () => new Map(),
}));

vi.mock("../../../src/config", () => ({
  CONFIG: {
    telemetry: {
      cpuSampleInterval: 10,
      economySampleInterval: 50,
      populationInterval: 100,
    },
    debug: { actionProfiling: false },
  },
}));

// 导入被测模块（必须在 vi.mock 之后）
const { telemetryCollectorSystem } = await import("../../../src/systems/telemetry-collector");

// ── 辅助工具 ──────────────────────────────────────────────

function makeCtx(tier: CpuTier, tick: number, snapshots: unknown[] = []): TickContext {
  return {
    tick,
    budget: {
      tier,
      softLimit: 17.5,
      hardLimit: 19.2,
      canStart: () => true,
      isExhausted: () => false,
      spent: () => 0,
    },
    getSnapshot: () => undefined,
    snapshots: () => snapshots as ReturnType<TickContext["snapshots"]>,
    globalSiteCount: 0,
  } as unknown as TickContext;
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    roomName: "W1N1",
    rcl: 4,
    controller: undefined,
    spawns: [],
    extensions: [],
    towers: [],
    containers: [],
    roads: [],
    walls: [],
    ramparts: [],
    storage: { store: { getUsedCapacity: () => 50000 } },
    controllerContainer: undefined,
    links: [],
    sources: [],
    constructionSites: [],
    myConstructionSites: [],
    hostileCreeps: [],
    threatCreeps: [],
    energyAvailable: 300,
    energyCapacityAvailable: 550,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map(),
    pendingHarvesters: 0,
    creepEnergy: 0,
    minerals: [],
    labs: [],
    terminal: undefined,
    extractor: undefined,
    factory: undefined,
    observer: undefined,
    powerSpawn: undefined,
    droppedEnergy: [],
    criticalRepairTarget: undefined,
    ...overrides,
  };
}

// ── 测试 ──────────────────────────────────────────────

describe("telemetry-collector — Storage 被毁事件检测 (TD-004)", () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    // 清空 globalCache 中的前态
    delete mockGlobalCache.__telemetryPrevState;
    delete mockGlobalCache.telemetry;
    // 设置 Memory 最小结构
    (globalThis as Record<string, unknown>).Memory = { rooms: { W1N1: {} }, kernel: {} };
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
  });

  it("storage 从有到无时生成 StructureDestroyed 事件（structureTypeCode=3）", () => {
    // 第 1 次运行：建立前态（storage 存在，st=1）
    const snap1 = makeSnapshot({ storage: { store: { getUsedCapacity: () => 50000 } } });
    // 需要 telemetry 初始化以通过守卫
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    telemetryCollectorSystem.run(makeCtx("healthy", 100, [snap1]));

    // 第 2 次运行：storage 被毁（st=0），应触发事件
    capturedEvents.length = 0; // 清除第一次运行的事件
    mockGlobalCache.telemetry = { tick: 110, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    const snap2 = makeSnapshot({ storage: undefined });
    (globalThis as Record<string, unknown>).Game = {
      time: 110,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    telemetryCollectorSystem.run(makeCtx("healthy", 110, [snap2]));

    const storageEvents = capturedEvents.filter(e => e.k === 13 && e.d[0] === 3);
    expect(storageEvents.length).toBe(1);
    expect(storageEvents[0]!.d).toEqual([3, 1, 0]);
    expect(storageEvents[0]!.r).toBe("W1N1");
  });

  it("storage 持续存在时不生成 StructureDestroyed 事件", () => {
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    const snap1 = makeSnapshot({ storage: { store: { getUsedCapacity: () => 50000 } } });
    telemetryCollectorSystem.run(makeCtx("healthy", 100, [snap1]));

    capturedEvents.length = 0;
    mockGlobalCache.telemetry = { tick: 110, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    const snap2 = makeSnapshot({ storage: { store: { getUsedCapacity: () => 40000 } } });
    (globalThis as Record<string, unknown>).Game = {
      time: 110,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    telemetryCollectorSystem.run(makeCtx("healthy", 110, [snap2]));

    const storageEvents = capturedEvents.filter(e => e.k === 13 && e.d[0] === 3);
    expect(storageEvents.length).toBe(0);
  });

  it("storage 从无到有（新建）不生成 StructureDestroyed 事件", () => {
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    const snap1 = makeSnapshot({ storage: undefined });
    telemetryCollectorSystem.run(makeCtx("healthy", 100, [snap1]));

    capturedEvents.length = 0;
    mockGlobalCache.telemetry = { tick: 110, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    const snap2 = makeSnapshot({ storage: { store: { getUsedCapacity: () => 0 } } });
    (globalThis as Record<string, unknown>).Game = {
      time: 110,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    telemetryCollectorSystem.run(makeCtx("healthy", 110, [snap2]));

    const storageEvents = capturedEvents.filter(e => e.k === 13 && e.d[0] === 3);
    expect(storageEvents.length).toBe(0);
  });
});
