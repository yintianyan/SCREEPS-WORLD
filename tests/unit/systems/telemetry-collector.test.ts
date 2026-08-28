import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { TickContext, CpuTier } from "../../../src/kernel/contracts";
import { setLogSink } from "../../../src/kernel/log";

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

// RawMemory mock（P0-1 Memory 体积监控测试需要）
let mockRawMemory: string = "{}";
(globalThis as Record<string, unknown>).RawMemory = {
  get: () => mockRawMemory,
  segments: {},
  setActiveSegments: () => undefined,
  set: (v: string) => { mockRawMemory = v; },
};

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

describe("telemetry-collector — @TELEMETRY 输出门禁（stats 恒真回归）", () => {
  let logLines: string[] = [];

  beforeEach(() => {
    capturedEvents.length = 0;
    delete mockGlobalCache.__telemetryPrevState;
    delete mockGlobalCache.telemetry;
    delete mockGlobalCache.__alertThrottle;
    (globalThis as Record<string, unknown>).Memory = {
      rooms: {},
      kernel: { stats: { memorySize: 1234, cpuAvg10: 5, cpuMax10: 8, bucketMin10: 9000, crisisCount: 0, errorHotspot: "", skipHotspot: "" } },
    };
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    logLines = [];
    setLogSink((line: string) => { logLines.push(line); });
  });

  afterEach(() => {
    setLogSink(undefined);
  });

  function telemetryLines(): string[] {
    return logLines
      .filter((s) => s.includes("@TELEMETRY"));
  }

  it("健康 tick（低 CPU / 无错误 / 无 skip，stats 存在）不输出 —— 门禁不得被 stats 击穿", () => {
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    telemetryCollectorSystem.run(makeCtx("healthy", 100, []));
    expect(telemetryLines()).toHaveLength(0);
  });

  it("有错误的 tick 输出且携带摘要指标", () => {
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 2 };
    telemetryCollectorSystem.run(makeCtx("healthy", 100, []));
    const lines = telemetryLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"er":2');
    expect(lines[0]).toContain('"mem":1234');
  });

  it("高 CPU tick 输出（getUsed > softLimit*0.7 = 12.25）", () => {
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { bucket: 10000, getUsed: () => 15 },
      creeps: {},
      spawns: {},
    };
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    telemetryCollectorSystem.run(makeCtx("healthy", 100, []));
    expect(telemetryLines()).toHaveLength(1);
  });

  it("有 skip 的 tick 输出", () => {
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 7, errors: 0 };
    telemetryCollectorSystem.run(makeCtx("healthy", 100, []));
    expect(telemetryLines()).toHaveLength(1);
  });
});

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

// ── P0-1: Memory 体积监控 ──────────────────────────────────

describe("telemetry-collector — Memory 体积监控 (P0-1)", () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    delete mockGlobalCache.__telemetryPrevState;
    delete mockGlobalCache.telemetry;
    mockRawMemory = "{}";
    (globalThis as Record<string, unknown>).Memory = { rooms: { W1N1: {} }, kernel: {} };
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
  });

  it("人口普查节拍采样 memorySize 写入 stats", () => {
    // systemPhase("telemetry-collector", 10) = 5 → 系统在 tick≡5(mod 10) 运行。
    // 人口普查门: (tick - 5) % 100 === 0 → tick=105
    mockRawMemory = "x".repeat(500_000);
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    (globalThis as Record<string, unknown>).Game = {
      time: 105,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    expect(Memory.kernel!.stats!.memorySize).toBe(500_000);
  });

  it("Memory 超过 1.5MB 告警线时输出 console.log 警告", () => {
    mockRawMemory = "x".repeat(1_600_000);
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    (globalThis as Record<string, unknown>).Game = {
      time: 105,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };

    const logLines: string[] = [];
    setLogSink((line: string) => { logLines.push(line); });
    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));
    setLogSink(undefined);

    expect(Memory.kernel!.stats!.memorySize).toBe(1_600_000);
    const warningLine = logLines.find(s => s.includes("WARNING: Memory size"));
    expect(warningLine).toBeDefined();
    expect(warningLine).toContain("1.53");
  });

  it("Memory 未超告警线时不输出警告", () => {
    mockRawMemory = "x".repeat(100_000);
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    (globalThis as Record<string, unknown>).Game = {
      time: 105,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };

    const logLines: string[] = [];
    setLogSink((line: string) => { logLines.push(line); });
    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));
    setLogSink(undefined);

    const warningLine = logLines.find(s => s.includes("WARNING: Memory size"));
    expect(warningLine).toBeUndefined();
  });

  it("非人口普查节拍不采样 memorySize", () => {
    // tick=115 是 CPU 采样节拍 (115-5)%10===0 但 (115-5)%100===10≠0 → 不采样
    mockRawMemory = "x".repeat(500_000);
    mockGlobalCache.telemetry = { tick: 115, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    (globalThis as Record<string, unknown>).Game = {
      time: 115,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };

    telemetryCollectorSystem.run(makeCtx("healthy", 115, [makeSnapshot()]));

    // memorySize 不应被写入（或保持上次的值）
    expect(Memory.kernel!.stats?.memorySize).toBeUndefined();
  });
});

// ── P2-1: 健康度告警 ──────────────────────────────────────

describe("telemetry-collector — 健康度告警 (P2-1)", () => {
  let logLines: string[] = [];

  beforeEach(() => {
    capturedEvents.length = 0;
    delete mockGlobalCache.__telemetryPrevState;
    delete mockGlobalCache.telemetry;
    delete mockGlobalCache.__alertThrottle;
    mockRawMemory = "{}";
    (globalThis as Record<string, unknown>).Memory = { rooms: { W1N1: {} }, kernel: {} };
    (globalThis as Record<string, unknown>).Game = {
      time: 105,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    logLines = [];
    setLogSink((line: string) => { logLines.push(line); });
  });

  afterEach(() => {
    setLogSink(undefined);
  });

  it("cpuAvg10 >= softLimit*0.9 时输出 cpu-high 告警", () => {
    // healthy tier: softLimit = 17.5, 0.9*17.5 = 15.75
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105, cpuAvg10: 16, cpuMax10: 18,
          bucketMin10: 9000, crisisCount: 0, tierTransitions: 0,
          errorHotspot: "", skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLine = logLines.find(s => s.includes("@ALERT cpu-high"));
    expect(alertLine).toBeDefined();
  });

  it("bucketMin10 < 2000 时输出 bucket-critical 告警", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105, cpuAvg10: 5, cpuMax10: 8,
          bucketMin10: 1500, crisisCount: 0, tierTransitions: 0,
          errorHotspot: "", skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLine = logLines.find(s => s.includes("@ALERT bucket-critical"));
    expect(alertLine).toBeDefined();
  });

  it("errors > 0 且有 errorHotspot 时输出 error-hotspot 告警", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105, cpuAvg10: 5, cpuMax10: 8,
          bucketMin10: 9000, crisisCount: 0, tierTransitions: 0,
          errorHotspot: "harvester.run", skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 3 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLine = logLines.find(s => s.includes("@ALERT error-hotspot"));
    expect(alertLine).toBeDefined();
    expect(alertLine).toContain("harvester.run");
  });

  it("健康状态下不输出任何告警", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105, cpuAvg10: 5, cpuMax10: 8,
          bucketMin10: 9000, crisisCount: 0, tierTransitions: 0,
          errorHotspot: "", skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLines = logLines.filter(s => s.includes("@ALERT"));
    expect(alertLines).toHaveLength(0);
  });

  it("同类告警限频——100 tick 内不重复输出", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105, cpuAvg10: 16, cpuMax10: 18,
          bucketMin10: 9000, crisisCount: 0, tierTransitions: 0,
          errorHotspot: "", skipHotspot: "",
        },
      },
    };

    // 第一次 tick=105
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));
    const firstAlerts = logLines.filter(s => s.includes("@ALERT cpu-high"));
    expect(firstAlerts).toHaveLength(1);

    // 第二次 tick=115（10 tick 后，< 100 tick 限频间隔）
    mockGlobalCache.telemetry = { tick: 115, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    (globalThis as Record<string, unknown>).Game = {
      time: 115,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    telemetryCollectorSystem.run(makeCtx("healthy", 115, [makeSnapshot()]));
    const allAlerts = logLines.filter(s => s.includes("@ALERT cpu-high"));
    // 仍然只有 1 条——限频生效
    expect(allAlerts).toHaveLength(1);
  });
});
