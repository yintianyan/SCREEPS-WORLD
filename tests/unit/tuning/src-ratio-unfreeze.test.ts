/**
 * P1-2 srcRatio 信号 + 危机解锁冻结 — 单元测试。
 *
 * 背景（病灶 6）：frozen=3/pending=1 锁住关键参数，采集塌方时无法上调。
 * P0-1 已计算 srcStallTicks（srcRatio>0.9 AND storageDrainAccum>1000 持续 50+ tick
 * → forceCrisis）。P1-2 在 forceCrisis 触发前（srcStallTicks>50）解冻
 * harvester/hauler maxCount，让 tuning 有机会上调采集/搬运能力。
 *
 * 测试通过公共入口 tuningEngineSystem.run() 验证 force-unfreeze 行为：
 * safeRunTuning 是私有函数，通过观察 Memory 副作用（frozenParams 删除、
 * lastEval.trend 不再为 "none"）和控制台诊断日志间接验证。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tuningEngineSystem } from "../../../src/systems/tuning-engine";
import { CONFIG } from "../../../src/config";
import {
  resetGlobals,
  mockSnapshot,
  mockStructure,
  mockSource,
  mockBudget,
  mockCreep,
  mockController,
} from "../../role-helpers";
import { createRingBuffer, ringPush } from "../../../src/kernel/ring-buffer";
import type { RingBuffer } from "../../../src/kernel/ring-buffer";
import type { EconomySample, CpuSample } from "../../../src/kernel/timeseries";
import type { RoomSnapshot, TickContext, Budget } from "../../../src/kernel/contracts";
import type { FrozenParamState, PendingValidation } from "../../../src/domain/tuning/types";

const ROOM = "W7N4";
const TICK = 5000;

beforeEach(() => {
  resetGlobals();
  delete (globalThis as any).__segStore;
  // Mock RawMemory for segment-store migration checks.
  (globalThis as any).RawMemory = { segments: {}, setActiveSegments: () => {} };
});

// ─── Ring buffer builders ───────────────────────────────────

function buildEconomyRing(
  roomName: string,
  count: number,
  overrides: Partial<EconomySample> = {},
): RingBuffer<EconomySample> {
  const buf = createRingBuffer<EconomySample>(300);
  for (let i = 0; i < count; i++) {
    ringPush(buf, {
      t: 1000 + i * 50,
      r: roomName,
      rs: 50000,
      d: 50,
      ds: 5,
      p: 10,
      ea: 5000,
      ec: 8000,
      se: 20000,
      hc: 2,
      sc: 2,
      ph: 4,
      ...overrides,
    });
  }
  return buf;
}

function buildCpuRing(
  count: number,
  overrides: Partial<CpuSample> = {},
): RingBuffer<CpuSample> {
  const buf = createRingBuffer<CpuSample>(500);
  for (let i = 0; i < count; i++) {
    ringPush(buf, {
      t: 1000 + i * 10,
      cpu: 5,
      bk: 8000,
      ti: 0,
      sl: 17.5,
      hl: 19.2,
      sk: 0,
      er: 0,
      s1: "", v1: 0, s2: "", v2: 0, s3: "", v3: 0,
      ...overrides,
    });
  }
  return buf;
}

function setupTimeseries(
  econ: RingBuffer<EconomySample>,
  cpu: RingBuffer<CpuSample>,
): void {
  (globalThis as any).__segStore = {
    cpuSeg: { cpu },
    economySeg: { economy: econ },
    migrated: true,
  };
}

/** 向 Game.creeps 追加指定角色的 creep。 */
function setupCreeps(
  roomName: string,
  roles: Record<string, number>,
): void {
  const existing = (globalThis as any).Game.creeps ?? {};
  let idx = Object.keys(existing).length;
  for (const [role, count] of Object.entries(roles)) {
    for (let i = 0; i < count; i++) {
      const name = `${role}-${roomName}-${idx++}`;
      existing[name] = mockCreep({ name, role, home: roomName, ticksToLive: 1000 });
    }
  }
  (globalThis as any).Game.creeps = existing;
}

// ─── Snapshot / Context builders ────────────────────────────

/**
 * 创建带 container + 指定 source 能量的快照。
 * sourceEnergy 默认 3000：mockSource 不设 energyCapacity，
 * srcRatio 计算用 ?? 3000 兜底 → 3000/3000 = 1.0（采集塌方信号）。
 */
function snapshotWithSources(
  roomName: string,
  sourceEnergy = 3000,
  fillRatio = 0.3,
  rcl = 4,
): RoomSnapshot {
  const capacity = 2000;
  const energy = Math.round(capacity * fillRatio);
  const container = mockStructure("container", {
    id: `container_${roomName}`,
    energy,
    capacity,
  });
  const source = mockSource(`source_${roomName}`, sourceEnergy);
  return mockSnapshot({
    roomName,
    rcl,
    containers: [container],
    sources: [source],
    controller: mockController({ level: rcl }),
  });
}

function buildContext(
  snapshots: RoomSnapshot[],
  budget: Budget,
  tick = TICK,
): TickContext {
  return {
    tick,
    budget,
    globalSiteCount: snapshots.reduce((sum, s) => sum + s.myConstructionSites.length, 0),
    getSnapshot: vi.fn((room: string) =>
      snapshots.find(s => s.roomName === room),
    ),
    snapshots: vi.fn(function* () {
      for (const s of snapshots) yield s;
    }),
  };
}

// ─── Tuning state factories ─────────────────────────────────

/** 创建冻结状态（frozenUntil 远大于 tick，确保冻结中）。 */
function frozenParam(tick: number, reason = "test freeze"): FrozenParamState {
  return {
    frozenAt: tick - 500,
    frozenUntil: tick + 99999,
    reason,
    rollbackCount: 3,
  };
}

/**
 * 预置 roomTuning 状态（含 baselineVersion 对齐避免清零）。
 * frozenParams / pendingValidation 按需传入。
 */
function setupRoomTuning(
  roomName: string,
  frozenParams?: Record<string, FrozenParamState>,
  pendingValidation?: Record<string, PendingValidation>,
): void {
  const room: any = {
    roleBounds: {},
    lastAdjusted: {},
  };
  if (frozenParams && Object.keys(frozenParams).length > 0) {
    room.frozenParams = frozenParams;
  }
  if (pendingValidation && Object.keys(pendingValidation).length > 0) {
    room.pendingValidation = pendingValidation;
  }
  (globalThis as any).Memory.kernel = {
    tuning: {
      lastTuned: 0,
      baselineVersion: CONFIG.tuning.baselineVersion,
      rooms: { [roomName]: room },
    },
  };
}

/** 设置 Memory.rooms[roomName] 的 phase.srcStallTicks。 */
function setupRoomPhase(roomName: string, srcStallTicks: number): void {
  (globalThis as any).Memory.rooms = {
    [roomName]: {
      buildQueue: [],
      phase: { srcStallTicks, phase: "crisis" },
    },
  };
}

/** 便捷：完整初始化一个测试场景并运行 tuning-engine。 */
function runScenario(opts: {
  sourceEnergy?: number;
  srcStallTicks?: number;
  econOverrides?: Partial<EconomySample>;
  creeps?: Record<string, number>;
  frozenParams?: Record<string, FrozenParamState>;
  pendingValidation?: Record<string, PendingValidation>;
  fillRatio?: number;
}): void {
  const {
    sourceEnergy = 3000,
    srcStallTicks = 51,
    econOverrides = {},
    creeps = { hauler: 2, harvester: 2 },
    frozenParams,
    pendingValidation,
    fillRatio = 0.3,
  } = opts;

  const econ = buildEconomyRing(ROOM, 15, econOverrides);
  const cpu = buildCpuRing(15);
  setupTimeseries(econ, cpu);
  setupCreeps(ROOM, creeps);
  setupRoomPhase(ROOM, srcStallTicks);
  setupRoomTuning(ROOM, frozenParams, pendingValidation);

  const snap = snapshotWithSources(ROOM, sourceEnergy, fillRatio);
  const ctx = buildContext([snap], mockBudget("healthy"), TICK);
  tuningEngineSystem.run(ctx);
}

function roomTuning(): any {
  return (globalThis as any).Memory.kernel.tuning.rooms[ROOM];
}

function lastEval(): any {
  return (globalThis as any).Memory.kernel.tuning.lastEval[ROOM];
}

// ─── Tests ──────────────────────────────────────────────────

describe("P1-2 srcRatio 信号 + 危机解锁冻结", () => {
  // 1. 正常路径：解冻 + excludedParams 删除
  it("srcRatio>0.9 + srcStallTicks>50 + 冻结 → 解冻 harvester/hauler maxCount + excludedParams 删除", () => {
    // 设置 harvester 4（达 maxCount=4）+ avgReserveDelta=-80（储备下降）
    // 解冻后 harvester.maxCount 不再被排除 → evaluator 记录 trend="up"
    runScenario({
      sourceEnergy: 3000, // srcRatio = 1.0 > 0.9
      srcStallTicks: 51, // > 50
      econOverrides: { d: -80 },
      creeps: { hauler: 6, harvester: 4 },
      frozenParams: {
        "harvester.maxCount": frozenParam(TICK),
        "hauler.maxCount": frozenParam(TICK),
      },
    });

    // 解冻：frozenParams 中 harvester/hauler maxCount 被删除
    expect(roomTuning().frozenParams?.["harvester.maxCount"]).toBeUndefined();
    expect(roomTuning().frozenParams?.["hauler.maxCount"]).toBeUndefined();

    // excludedParams 删除：参数被评估，trend 不再被强制为 "none"
    // harvester: avgReserveDelta=-80 < RESERVE_DRAINING + harvesterCount=4 >= maxCount(4) → trend="up"
    expect(lastEval().trend["harvester.maxCount"]).toBe("up");
  });

  // 2. 边界：srcRatio≤0.9 不解冻
  it("srcRatio≤0.9 时不解冻（source 未满载，非采集塌方）", () => {
    runScenario({
      sourceEnergy: 1500, // srcRatio = 1500/3000 = 0.5 ≤ 0.9
      srcStallTicks: 51,
      creeps: { hauler: 6, harvester: 4 },
      econOverrides: { d: -80 },
      frozenParams: {
        "harvester.maxCount": frozenParam(TICK),
        "hauler.maxCount": frozenParam(TICK),
      },
    });

    // 未解冻：frozenParams 仍存在
    expect(roomTuning().frozenParams?.["harvester.maxCount"]).toBeDefined();
    expect(roomTuning().frozenParams?.["hauler.maxCount"]).toBeDefined();
    // 仍被排除 → trend 强制为 "none"（即使 harvester 信号满足 up 条件）
    expect(lastEval().trend["harvester.maxCount"]).toBe("none");
  });

  // 3. 边界：srcStallTicks≤50 不解冻
  it("srcStallTicks≤50 时不解冻（塌方持续时间不足）", () => {
    runScenario({
      sourceEnergy: 3000, // srcRatio = 1.0 > 0.9
      srcStallTicks: 50, // ≤ 50，不满足 > 50
      creeps: { hauler: 6, harvester: 4 },
      econOverrides: { d: -80 },
      frozenParams: {
        "harvester.maxCount": frozenParam(TICK),
        "hauler.maxCount": frozenParam(TICK),
      },
    });

    expect(roomTuning().frozenParams?.["harvester.maxCount"]).toBeDefined();
    expect(roomTuning().frozenParams?.["hauler.maxCount"]).toBeDefined();
    expect(lastEval().trend["harvester.maxCount"]).toBe("none");
  });

  // 4. 边界：只解冻 critical，不影响其他角色
  it("只解冻 harvester.maxCount 和 hauler.maxCount，不影响 upgrader.maxCount", () => {
    runScenario({
      sourceEnergy: 3000,
      srcStallTicks: 51,
      frozenParams: {
        "harvester.maxCount": frozenParam(TICK),
        "hauler.maxCount": frozenParam(TICK),
        "upgrader.maxCount": frozenParam(TICK),
      },
    });

    // harvester/hauler 解冻（frozen 删除）
    expect(roomTuning().frozenParams?.["harvester.maxCount"]).toBeUndefined();
    expect(roomTuning().frozenParams?.["hauler.maxCount"]).toBeUndefined();
    // upgrader 仍冻结（不在 criticalParams 列表）
    expect(roomTuning().frozenParams?.["upgrader.maxCount"]).toBeDefined();
    expect(roomTuning().frozenParams?.["upgrader.maxCount"].frozenUntil).toBeGreaterThan(TICK);
  });

  // 5. 边界：pendingValidation 不受影响
  it("pendingValidation 中的参数不受 force-unfreeze 影响（只解冻 frozen 不解冻 pending）", () => {
    // upgrader.maxCount 在 pendingValidation 中（adjustTick 近期，verifyDelay 未到期）
    const pending: Record<string, PendingValidation> = {
      "upgrader.maxCount": {
        preAdjustSignals: { avgStorageEnergy: 20000, avgPressure: 0.1, roleCount: 3 },
        expectedDirection: "worsen",
        adjustDirection: "up",
        adjustTick: TICK - 100, // verifyDelay(1500) 未到期 → pending 保留
        preAdjustValue: 3,
      },
    };
    runScenario({
      sourceEnergy: 3000,
      srcStallTicks: 51,
      frozenParams: {
        "harvester.maxCount": frozenParam(TICK),
      },
      pendingValidation: pending,
    });

    // harvester.maxCount 解冻（frozen 删除）
    expect(roomTuning().frozenParams?.["harvester.maxCount"]).toBeUndefined();
    // pendingValidation 中的 upgrader.maxCount 不受影响（记录保留）
    expect(roomTuning().pendingValidation?.["upgrader.maxCount"]).toBeDefined();
    expect(roomTuning().pendingValidation?.["upgrader.maxCount"].preAdjustValue).toBe(3);
  });

  // 6. 边界：frozenParams 不存在时不抛错
  it("frozenParams 不存在时不抛错", () => {
    expect(() => {
      runScenario({
        sourceEnergy: 3000,
        srcStallTicks: 51,
        // 不传 frozenParams → roomTuning 无 frozenParams 字段
      });
    }).not.toThrow();

    // 运行完成，lastEval 正常生成
    expect(lastEval()).toBeDefined();
  });

  // 7. 正常路径：解冻后 console.log 输出诊断
  it("解冻时输出 FORCE_UNFREEZE 诊断日志", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runScenario({
        sourceEnergy: 3000, // srcRatio = 1.00
        srcStallTicks: 51,
        frozenParams: {
          "harvester.maxCount": frozenParam(TICK),
          "hauler.maxCount": frozenParam(TICK),
        },
      });

      const calls = logSpy.mock.calls.map(c => c[0] as string);
      const harvesterLog = calls.find(s => s.includes("FORCE_UNFREEZE") && s.includes("harvester.maxCount"));
      const haulerLog = calls.find(s => s.includes("FORCE_UNFREEZE") && s.includes("hauler.maxCount"));

      // 两个 critical 参数都输出诊断
      expect(harvesterLog).toBeDefined();
      expect(haulerLog).toBeDefined();
      // 诊断含 srcRatio 与 stallTicks 上下文
      expect(harvesterLog).toContain("srcRatio=1.00");
      expect(harvesterLog).toContain("stallTicks=51");
    } finally {
      logSpy.mockRestore();
    }
  });
});
