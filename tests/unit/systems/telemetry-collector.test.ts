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

// summarizeRoles 走真实实现（纯算术、无引擎依赖）；只 stub 两个采样器。
vi.mock("../../../src/kernel/timeseries", async importOriginal => {
  const real = await importOriginal<typeof import("../../../src/kernel/timeseries")>();
  return { ...real, sampleCpu: vi.fn(), sampleEconomy: vi.fn() };
});

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
  set: (v: string) => {
    mockRawMemory = v;
  },
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

describe("telemetry-collector — @TELEMETRY 输出已移除（由 TelemetryFlush 统一处理）", () => {
  let logLines: string[] = [];

  beforeEach(() => {
    capturedEvents.length = 0;
    delete mockGlobalCache.__telemetryPrevState;
    delete mockGlobalCache.telemetry;
    delete mockGlobalCache.__alertThrottle;
    (globalThis as Record<string, unknown>).Memory = {
      rooms: {},
      kernel: {
        stats: {
          memorySize: 1234,
          cpuAvg10: 5,
          cpuMax10: 8,
          bucketMin10: 9000,
          crisisCount: 0,
          errorHotspot: "",
          skipHotspot: "",
        },
      },
    };
    (globalThis as Record<string, unknown>).Game = {
      time: 100,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    logLines = [];
    setLogSink((line: string) => {
      logLines.push(line);
    });
  });

  afterEach(() => {
    setLogSink(undefined);
  });

  it("telemetry-collector 不再输出 @TELEMETRY 行（已由 TelemetryFlush 统一处理）", () => {
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 2 };
    telemetryCollectorSystem.run(makeCtx("healthy", 100, []));
    const telemetryLines = logLines.filter(s => s.includes("@TELEMETRY"));
    expect(telemetryLines).toHaveLength(0);
  });

  it("telemetry-collector 不再输出 @ALERT 行（已由 TelemetryFlush 统一处理）", () => {
    mockGlobalCache.telemetry = { tick: 100, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 2 };
    telemetryCollectorSystem.run(makeCtx("healthy", 100, []));
    const alertLines = logLines.filter(s => s.includes("@ALERT"));
    expect(alertLines).toHaveLength(0);
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
    setLogSink((line: string) => {
      logLines.push(line);
    });
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
    setLogSink((line: string) => {
      logLines.push(line);
    });
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

// ── P2-1: 健康度告警已移除（由 TelemetryFlush 统一处理）─────────

describe("telemetry-collector — 健康度告警已移除", () => {
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
    setLogSink((line: string) => {
      logLines.push(line);
    });
  });

  afterEach(() => {
    setLogSink(undefined);
  });

  it("telemetry-collector 不再输出 @ALERT 行（告警已移至 TelemetryFlush）", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105,
          cpuAvg10: 16,
          cpuMax10: 18,
          bucketMin10: 9000,
          crisisCount: 0,
          tierTransitions: 0,
          errorHotspot: "",
          skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLines = logLines.filter(s => s.includes("@ALERT"));
    expect(alertLines).toHaveLength(0);
  });

  it("bucket 危急时也不输出 @ALERT", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105,
          cpuAvg10: 5,
          cpuMax10: 8,
          bucketMin10: 1500,
          crisisCount: 0,
          tierTransitions: 0,
          errorHotspot: "",
          skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLines = logLines.filter(s => s.includes("@ALERT"));
    expect(alertLines).toHaveLength(0);
  });

  it("错误频发时也不输出 @ALERT", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105,
          cpuAvg10: 5,
          cpuMax10: 8,
          bucketMin10: 9000,
          crisisCount: 0,
          tierTransitions: 0,
          errorHotspot: "harvester.run",
          skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 3 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLines = logLines.filter(s => s.includes("@ALERT"));
    expect(alertLines).toHaveLength(0);
  });

  it("健康状态下不输出任何告警", () => {
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: {} },
      kernel: {
        stats: {
          lastSample: 105,
          cpuAvg10: 5,
          cpuMax10: 8,
          bucketMin10: 9000,
          crisisCount: 0,
          tierTransitions: 0,
          errorHotspot: "",
          skipHotspot: "",
        },
      },
    };
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };

    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));

    const alertLines = logLines.filter(s => s.includes("@ALERT"));
    expect(alertLines).toHaveLength(0);
  });
});

// ── #174 家族：房榜截断必须留痕（cpuPerTickByRoomCount）──────────────
const { ROOM_CPU_BOARD_CAP } = await import("../../../src/systems/telemetry-collector");

describe("#174 家族 — 房榜截断留痕（cpuPerTickByRoomCount）", () => {
  const seed = (roomCount: number) => {
    capturedEvents.length = 0;
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    const rooms: Record<string, number> = {};
    for (let i = 0; i < roomCount; i++) rooms[`R${String(i).padStart(2, "0")}`] = (i + 1) * 100;
    mockGlobalCache.cpuCumulative = { total: 0, systems: {}, roles: {}, rooms, ticks: 100 };
    (globalThis as Record<string, unknown>).Memory = { rooms: { W1N1: {} }, kernel: { stats: {} } };
    (globalThis as Record<string, unknown>).Game = {
      time: 105,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));
    return (globalThis as any).Memory.kernel.stats as {
      cpuPerTickByRoom?: Record<string, number>;
      cpuPerTickByRoomCount?: number;
    };
  };

  it("9 间房（少于上限）⇒ 榜给全 9 条且 count=9 ⇒ Σ 就是全量", () => {
    const stats = seed(9);
    expect(Object.keys(stats.cpuPerTickByRoom ?? {})).toHaveLength(9);
    expect(stats.cpuPerTickByRoomCount).toBe(9);
  });

  it("20 间房 ⇒ 榜只给 ROOM_CPU_BOARD_CAP 条而 count 报 20 ⇒ 读数人看得出 Σ 是部分和", () => {
    const stats = seed(20);
    expect(Object.keys(stats.cpuPerTickByRoom ?? {})).toHaveLength(ROOM_CPU_BOARD_CAP);
    expect(stats.cpuPerTickByRoomCount).toBe(20);
  });

  it("没有 rooms 时不伪造 count 键（缺席不是 0）", () => {
    capturedEvents.length = 0;
    mockGlobalCache.telemetry = { tick: 105, systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 };
    delete mockGlobalCache.cpuCumulative;
    (globalThis as Record<string, unknown>).Memory = { rooms: { W1N1: {} }, kernel: { stats: {} } };
    (globalThis as Record<string, unknown>).Game = {
      time: 105,
      cpu: { bucket: 10000, getUsed: () => 5 },
      creeps: {},
      spawns: {},
    };
    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));
    expect((globalThis as any).Memory.kernel.stats.cpuPerTickByRoomCount).toBeUndefined();
  });
});

// ── #137：三张姊妹榜的截断留痕列（#142 同族）────────────────────────
// 钉的是「榜是不是全集」：`cpuBySystem`／`cpuPerTickBySystem`／`cpuPerTickByRole` 都只给前 10，
// 而线上实测系统标签全集 38、角色 22 ⇒「某标签不在榜上」推不出「它没有写者」。
// 这三张榜在 src 内**零读者**（唯一引用是 e2e 里一行 JSON.stringify 日志）⇒ 新增兄弟键不改既有形状。
// 尾巴量级另有 `cpuSystemTotal`／`cpuRoleTotal`（不截断的总和），本用例只钉"面积"，不发明第二把量级尺。
//
// 两道门都要按写者补种子（`telemetry-collector.ts:199` 的早退 + `:212` 的相位门）：
//   · `run()` 在 `globalCache().telemetry.tick !== ctx.tick` 时**整段早退**；
//   · 人口普查（`sampleMemorySize` 所在段）只在 `(tick − systemPhase(name, 10)) % 100 === 0` 时跑。
// 所以 tick 由 `systemPhase` 现算，而不是手写一个"看起来像 100"的数。
import { systemPhase } from "../../../src/kernel/phase";

describe("三张姊妹榜的 *Count 留痕列", () => {
  const CENSUS_TICK = systemPhase("telemetry-collector", 10) + 100;

  function seed(n: number): void {
    const ema = new Map<string, number>();
    const perTick: Record<string, number> = {};
    const roleCpu: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      ema.set(`sys${i}`, (n - i) * 2);
      perTick[`sys${i}`] = (n - i) * 2;
      roleCpu[`role${i}`] = (n - i) * 2;
    }
    mockGlobalCache.systemBudgetEma = ema;
    mockGlobalCache.systemCpuPerTick = perTick;
    // 角色榜是 EMA 累积表：不清就会被上一个用例的键撑住（12 枚用例先跑 ⇒ 本用例"8 枚"变"12 枚"），
    // 那是**测试态泄漏**不是产品行为，所以每次种子都从空 EMA 起（线上首见同理：boot 起 EMA 为空）。
    delete mockGlobalCache.roleCpuEma;
    mockGlobalCache.telemetry = { tick: CENSUS_TICK, roleCpu };
  }

  function stats(): any {
    seedBoards();
    telemetryCollectorSystem.run(makeCtx("healthy", CENSUS_TICK, [makeSnapshot()]));
    return (Memory as any).kernel.stats;
  }
  function seedBoards(): void {
    /* 占位：种子已在各用例里给 */
  }

  it("12 枚标签 ⇒ 三张榜各给 10 条，而 *Count 报 12", () => {
    seed(12);
    const s = stats();
    expect(Object.keys(s.cpuBySystem)).toHaveLength(10);
    expect(s.cpuBySystemCount).toBe(12);
    expect(Object.keys(s.cpuPerTickBySystem)).toHaveLength(10);
    expect(s.cpuPerTickBySystemCount).toBe(12);
    expect(Object.keys(s.cpuPerTickByRole)).toHaveLength(10);
    expect(s.cpuPerTickByRoleCount).toBe(12);
  });

  it("8 枚标签 ⇒ 榜即全集：*Count 与榜内条数逐张相等", () => {
    seed(8);
    const s = stats();
    for (const [board, count] of [
      ["cpuBySystem", "cpuBySystemCount"],
      ["cpuPerTickBySystem", "cpuPerTickBySystemCount"],
      ["cpuPerTickByRole", "cpuPerTickByRoleCount"],
    ] as const) {
      expect(Object.keys(s[board]).length).toBe(8);
      expect(s[count]).toBe(Object.keys(s[board]).length);
    }
  });

  it("count 是截断**前**的数，不是榜内条数（写成后者时本例会红）", () => {
    seed(12);
    const s = stats();
    expect(s.cpuPerTickBySystemCount).not.toBe(Object.keys(s.cpuPerTickBySystem).length);
    expect(typeof s.cpuSystemTotal).toBe("number");
    expect(s.cpuSystemTotal).toBeGreaterThan(0);
  });
});

describe("telemetry-collector — #189 物流健康度整列镜像", () => {
  it("heap 有 logisticsHealth ⇒ 镜像带齐可归因的数值列，而不只 level", () => {
    (globalThis as any).Memory.kernel = { stats: {} };
    mockGlobalCache.logisticsHealth = {
      level: "critical",
      score: 0.31,
      deliveryRate: 0.62,
      lossRate: 0.08,
      avgLatency: 120,
      backlogCount: 7,
      bottleneckRoom: "W37S58",
      message: "delivery below threshold",
    };
    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));
    const m = (globalThis as any).Memory.kernel.stats.logisticsHealth;
    expect(m).toBeDefined();
    expect(m.level).toBe("critical");
    // 这三列是别人的决策输入（恢复生命周期读 deliveryRate、战争规划读 backlogCount）：
    // 只留 level 就等于「判了 critical 却没人能说出为什么」。
    expect(m.deliveryRate).toBe(0.62);
    expect(m.backlogCount).toBe(7);
    expect(m.lossRate).toBe(0.08);
    expect(m.score).toBe(0.31);
    expect(m.avgLatency).toBe(120);
    expect(m.bottleneckRoom).toBe("W37S58");
    expect(m.message).toBeUndefined(); // 自由文本不进 Memory
    delete mockGlobalCache.logisticsHealth;
  });

  it("heap 没有 logisticsHealth ⇒ 不凭空造列（缺席仍等于「这条码没跑过」）", () => {
    (globalThis as any).Memory.kernel = { stats: {} };
    delete mockGlobalCache.logisticsHealth;
    telemetryCollectorSystem.run(makeCtx("healthy", 105, [makeSnapshot()]));
    expect((globalThis as any).Memory.kernel.stats.logisticsHealth).toBeUndefined();
  });
});
