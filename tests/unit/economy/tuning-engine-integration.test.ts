/** Tuning Engine 集成测试 — 测试 run() 完整链路。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tuningEngineSystem } from "../../../src/systems/tuning-engine";
import { CONFIG } from "../../../src/config";
import {
  resetGlobals,
  mockSnapshot,
  mockStructure,
  mockBudget,
  mockCreep,
  mockController,
} from "../../role-helpers";
import { createRingBuffer, ringPush } from "../../../src/kernel/ring-buffer";
import type { RingBuffer } from "../../../src/kernel/ring-buffer";
import type { EconomySample, CpuSample } from "../../../src/kernel/timeseries";
import type { RoomSnapshot, TickContext, Budget } from "../../../src/kernel/contracts";

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
    migrated: true, // 跳过迁移检查
  };
}

/** 向 Game.creeps 追加指定角色的 creep（多次调用可累积多房 creep）。 */
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

/** 创建带 container 的快照，fillRatio 控制填充率。 */
function snapshotWithContainers(
  roomName: string,
  fillRatio: number,
  rcl = 4,
): RoomSnapshot {
  const capacity = 2000;
  const energy = Math.round(capacity * fillRatio);
  const container = mockStructure("container", {
    id: `container_${roomName}`,
    energy,
    capacity,
  });
  return mockSnapshot({
    roomName,
    rcl,
    containers: [container],
    controller: mockController({ level: rcl }),
  });
}

/** 构建多快照 TickContext。 */
function buildContext(
  snapshots: RoomSnapshot[],
  budget: Budget,
  tick = 5000,
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

/**
 * 连续运行两次调优引擎（间隔 500 tick），模拟趋势确认机制。
 * 第一次记录方向，第二次触发实际调整。
 */
function runTwice(snap: any, budget: any, startTick: number): void {
  const ctx1 = buildContext([snap], budget, startTick);
  tuningEngineSystem.run(ctx1);
  const ctx2 = buildContext([snap], budget, startTick + 500);
  tuningEngineSystem.run(ctx2);
}

// ─── Tests ──────────────────────────────────────────────────

describe("tuning-engine integration — run() 完整链路", () => {
  it("conserve tier 跳过调优，不创建 tuning 状态", () => {
    const snap = snapshotWithContainers("W7N4", 0.3);
    const ctx = buildContext([snap], mockBudget("conserve"));

    tuningEngineSystem.run(ctx);

    expect((globalThis as any).Memory.kernel?.tuning).toBeUndefined();
  });

  it("recovery tier 跳过调优", () => {
    const snap = snapshotWithContainers("W7N4", 0.3);
    const ctx = buildContext([snap], mockBudget("recovery"));

    tuningEngineSystem.run(ctx);

    expect((globalThis as any).Memory.kernel?.tuning).toBeUndefined();
  });

  it("经济采样点不足（< 10）时跳过评估，但 lastTuned 仍更新", () => {
    const econ = buildEconomyRing("W7N4", 5);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    (globalThis as any).Memory.rooms = { W7N4: {} };
    const snap = snapshotWithContainers("W7N4", 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"));

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(5000);
    expect(tuning.rooms.W7N4).toBeUndefined();
    expect(tuning.lastEval?.W7N4).toBeUndefined();
  });

  it("container 持续满 + hauler 达上限 → hauler.maxCount 增加", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, {
      hauler: 6,
      harvester: 2,
      upgrader: 1,
      builder: 1,
    });

    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.75);
    // 趋势确认机制：需连续两次评估才触发调整，第二次 run 在 tick=5500
    runTwice(snap, mockBudget("healthy"), 5000);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(5500);

    const roomTuning = tuning.rooms[roomName];
    expect(roomTuning).toBeDefined();
    expect(roomTuning.roleBounds.hauler).toBeDefined();
    expect(roomTuning.roleBounds.hauler.maxCount).toBe(7);
    expect(roomTuning.lastAdjusted["hauler.maxCount"]).toBe(5500);

    const evalSnapshot = tuning.lastEval[roomName];
    expect(evalSnapshot).toBeDefined();
    expect(evalSnapshot.tick).toBe(5500);
    expect(evalSnapshot.adjustments).toContain("hauler.maxCount=6→7");
    expect(evalSnapshot.signals.containerFillRatio).toBe(0.75);
    expect(evalSnapshot.signals.haulerCount).toBe(6);
  });

  it("buildQueue 空 + 经济健康 → builder.maxCount 减少", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, {
      hauler: 2,
      harvester: 2,
      upgrader: 1,
      builder: 1,
    });

    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.3);
    // 趋势确认机制：需连续两次评估才触发 builder.maxCount 减少
    runTwice(snap, mockBudget("healthy"), 5000);

    const roomTuning = (globalThis as any).Memory.kernel.tuning.rooms[roomName];
    expect(roomTuning.roleBounds.builder).toBeDefined();
    expect(roomTuning.roleBounds.builder.maxCount).toBe(3);
  });

  it("多房间评估时 lastEval 按房间独立保存，调整互不干扰", () => {
    const roomA = "W7N4";
    const roomB = "W8N4";

    // 混合两房的经济采样到一个 ring buffer（模拟真实时序存储）
    const econ = createRingBuffer<EconomySample>(300);
    for (let i = 0; i < 15; i++) {
      ringPush(econ, {
        t: 1000 + i * 50,
        r: roomA,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 5000, ec: 8000, se: 20000,
        hc: 2, sc: 2, ph: 4,
      });
      ringPush(econ, {
        t: 1000 + i * 50,
        r: roomB,
        rs: 40000, d: 50, ds: 5, p: 10,
        ea: 4000, ec: 8000, se: 15000,
        hc: 2, sc: 2, ph: 4,
      });
    }
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomA, { hauler: 6, harvester: 2, upgrader: 1, builder: 1 });
    setupCreeps(roomB, { hauler: 2, harvester: 2, upgrader: 1, builder: 1 });

    (globalThis as any).Memory.rooms = {
      [roomA]: { buildQueue: [] },
      [roomB]: { buildQueue: [] },
    };

    const snapA = snapshotWithContainers(roomA, 0.75);
    const snapB = snapshotWithContainers(roomB, 0.3);
    // 趋势确认机制：需连续两次评估才触发调整，第二次 run 在 tick=5500
    const ctx1 = buildContext([snapA, snapB], mockBudget("healthy"), 5000);
    tuningEngineSystem.run(ctx1);
    const ctx2 = buildContext([snapA, snapB], mockBudget("healthy"), 5500);
    tuningEngineSystem.run(ctx2);

    const tuning = (globalThis as any).Memory.kernel.tuning;

    // 两房各自有独立的 lastEval 诊断快照
    expect(tuning.lastEval[roomA]).toBeDefined();
    expect(tuning.lastEval[roomB]).toBeDefined();
    expect(tuning.lastEval[roomA].tick).toBe(5500);
    expect(tuning.lastEval[roomB].tick).toBe(5500);

    // Room A（container 满 + hauler 达上限）有 hauler.maxCount 调整
    expect(tuning.lastEval[roomA].adjustments).toContain("hauler.maxCount=6→7");
    // Room B（hauler 未达上限）不应有 hauler.maxCount 调整
    expect(tuning.lastEval[roomB].adjustments).not.toContain("hauler.maxCount=6→7");
  });

  it("危机比例过高时跳过评估并记录原因", () => {
    const roomName = "W7N4";
    // 15 个采样点，前 6 个为 crisis（ph=2），后 9 个 steady → crisisRatio = 0.4 > 0.3
    const econ = createRingBuffer<EconomySample>(300);
    for (let i = 0; i < 15; i++) {
      ringPush(econ, {
        t: 1000 + i * 50,
        r: roomName,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 5000, ec: 8000, se: 20000,
        hc: 2, sc: 2,
        ph: i < 6 ? 2 : 4,
      });
    }
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 2, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastEval[roomName].skipped).toBe("economy_unstable");
    expect(tuning.lastEval[roomName].adjustments).toHaveLength(0);
  });

  it("运行后 lastTuned 更新为当前 tick", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 2, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"), 7500);

    tuningEngineSystem.run(ctx);

    expect((globalThis as any).Memory.kernel.tuning.lastTuned).toBe(7500);
  });

  it("冷却期阻止同参数重复调整", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, {
      hauler: 6,
      harvester: 2,
      upgrader: 1,
      builder: 1,
    });

    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.75);

    // 第 1 次运行 (tick=5000)：趋势确认机制下只记录 "up" 方向，不产生调整
    const ctx1 = buildContext([snap], mockBudget("healthy"), 5000);
    tuningEngineSystem.run(ctx1);
    const tuning1 = (globalThis as any).Memory.kernel.tuning;
    // 首次只记录方向，hauler.maxCount 未触发调整
    expect(tuning1.rooms[roomName].roleBounds.hauler).toBeUndefined();

    // 第 2 次运行 (tick=5500)：趋势确认触发调整 6→7
    const ctx2 = buildContext([snap], mockBudget("healthy"), 5500);
    tuningEngineSystem.run(ctx2);
    const tuning2 = (globalThis as any).Memory.kernel.tuning;
    expect(tuning2.rooms[roomName].roleBounds.hauler.maxCount).toBe(7);
    expect(tuning2.lastEval[roomName].adjustments).toContain("hauler.maxCount=6→7");

    // 第 3 次运行 (tick=6000)：冷却期内（500 < 1000）+ 趋势已重置为 "none" → 不调整
    const ctx3 = buildContext([snap], mockBudget("healthy"), 6000);
    tuningEngineSystem.run(ctx3);
    const tuning3 = (globalThis as any).Memory.kernel.tuning;
    // maxCount 仍为 7（未被再次调整）
    expect(tuning3.rooms[roomName].roleBounds.hauler.maxCount).toBe(7);
    // 本次评估的 adjustments 不包含 hauler.maxCount
    expect(tuning3.lastEval[roomName].adjustments).not.toContain("hauler.maxCount=7→8");
  });
});

// ─── 边界场景测试（CTO 全面审查后补充）─────────────────────────

describe("tuning-engine 边界场景 — 消费端饱和度", () => {
  it("container满 + 消费端真饱和（storage 盈余+储备在涨）→ 不加 hauler（改进 B 验证）", () => {
    const roomName = "W7N4";
    // 改进 B：consumerSaturated = container 满 + storage > surplus + 储备在涨
    // RCL4 early surplus=20000，se=30000 > 20000 → 消费端真饱和
    const econ = buildEconomyRing(roomName, 15, { ea: 7000, ec: 8000, se: 30000 });
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 6, harvester: 2, upgrader: 1, builder: 1 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.75); // container 满
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // 消费端真饱和时不应增加 hauler.maxCount
    expect(tuning.rooms[roomName].roleBounds.hauler?.maxCount).toBeUndefined();
  });

  it("container满 + 消费端未饱和（storage 低于 surplus）→ 加 hauler（改进 B 正向验证）", () => {
    const roomName = "W7N4";
    // RCL4 early surplus=20000，se=10000 < 20000 → consumerSaturated=false
    const econ = buildEconomyRing(roomName, 15, { ea: 4000, ec: 8000, se: 10000 });
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 6, harvester: 2, upgrader: 1, builder: 1 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.75); // container 满
    // 趋势确认机制：需连续两次评估才触发 hauler.maxCount 增加
    runTwice(snap, mockBudget("healthy"), 5000);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // 消费端未饱和时应增加 hauler
    expect(tuning.rooms[roomName].roleBounds.hauler.maxCount).toBe(7);
  });
});

describe("tuning-engine 边界场景 — 多房间独立评估", () => {
  it("A 房调整不影响 B 房评估（per-room 隔离）", () => {
    const roomA = "W7N4";
    const roomB = "W8N4";

    // 两房都有 container满 + hauler达上限 的条件
    const econ = createRingBuffer<EconomySample>(300);
    for (let i = 0; i < 15; i++) {
      ringPush(econ, {
        t: 1000 + i * 50, r: roomA,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 4000, ec: 8000, se: 20000, hc: 2, sc: 2, ph: 4,
      });
      ringPush(econ, {
        t: 1000 + i * 50, r: roomB,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 4000, ec: 8000, se: 20000, hc: 2, sc: 2, ph: 4,
      });
    }
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomA, { hauler: 6, harvester: 2, upgrader: 1, builder: 1 });
    setupCreeps(roomB, { hauler: 6, harvester: 2, upgrader: 1, builder: 1 });

    (globalThis as any).Memory.rooms = {
      [roomA]: { buildQueue: [] },
      [roomB]: { buildQueue: [] },
    };

    const snapA = snapshotWithContainers(roomA, 0.75);
    const snapB = snapshotWithContainers(roomB, 0.75);
    // 趋势确认机制：需连续两次评估才触发调整
    const ctx1 = buildContext([snapA, snapB], mockBudget("healthy"), 5000);
    tuningEngineSystem.run(ctx1);
    const ctx2 = buildContext([snapA, snapB], mockBudget("healthy"), 5500);
    tuningEngineSystem.run(ctx2);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // 两房各自独立从 6→7，A 房不应影响 B 房的起始值
    expect(tuning.rooms[roomA].roleBounds.hauler.maxCount).toBe(7);
    expect(tuning.rooms[roomB].roleBounds.hauler.maxCount).toBe(7);
    // 两房的调整记录都是 6→7（而非 A=6→7, B=7→8）
    expect(tuning.lastEval[roomA].adjustments).toContain("hauler.maxCount=6→7");
    expect(tuning.lastEval[roomB].adjustments).toContain("hauler.maxCount=6→7");
  });
});

describe("tuning-engine 边界场景 — Global Reset 恢复", () => {
  it("__segStore 丢失后跳过评估（降级到静态 CONFIG）", () => {
    // 不设置 __segStore，模拟 Global Reset 后 heap 丢失
    delete (globalThis as any).__segStore;

    const roomName = "W7N4";
    setupCreeps(roomName, { hauler: 6, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.75);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    // 不应抛错，应静默跳过
    expect(() => tuningEngineSystem.run(ctx)).not.toThrow();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // lastTuned 仍更新
    expect(tuning.lastTuned).toBe(5000);
    // 但无房间级评估结果（数据不足）
    expect(tuning.rooms[roomName]).toBeUndefined();
  });
});

describe("tuning-engine 边界场景 — 空房间与信号缺失", () => {
  it("无 container 时 containerFillRatio=0，不触发 hauler 增加", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 3, harvester: 2 }); // haulerCount=3 > minCount=2 才能触发减少
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    // 无 container 的快照
    const snap = mockSnapshot({
      roomName,
      rcl: 4,
      containers: [],
      controller: mockController({ level: 4 }),
    });
    // 趋势确认机制：需连续两次评估才触发 hauler.maxCount 减少
    runTwice(snap, mockBudget("healthy"), 5000);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastEval[roomName].signals.containerFillRatio).toBe(0);
    // containerFillRatio=0 < CONTAINER_LOW(0.2) + haulerCount(3) > minCount(2) → 触发 hauler.maxCount 减少
    const haulerAdj = tuning.lastEval[roomName].adjustments.find(
      (a: string) => a.includes("hauler.maxCount"),
    );
    expect(haulerAdj).toBeDefined();
  });

  it("无 creep 时所有角色计数为 0", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    // 不调用 setupCreeps — 无 creep
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastEval[roomName].signals.haulerCount).toBe(0);
    expect(tuning.lastEval[roomName].signals.harvesterCount).toBe(0);
  });
});

describe("tuning-engine 边界场景 — 钳制边界", () => {
  it("hauler.maxCount 达 ceiling(8) 后不再增加", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15, { ea: 4000, ec: 8000 });
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 8, harvester: 2, upgrader: 1, builder: 1 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    // 预设 hauler.maxCount 已达 ceiling
    // P1-I：预置 baselineVersion 与 CONFIG 对齐，否则会触发清零。
    (globalThis as any).Memory.kernel.tuning = {
      lastTuned: 0,
      baselineVersion: CONFIG.tuning.baselineVersion,
      rooms: {
        [roomName]: {
          roleBounds: { hauler: { maxCount: 8 } },
          lastAdjusted: {},
        },
      },
    };

    const snap = snapshotWithContainers(roomName, 0.75);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // 仍为 8，不超 ceiling
    expect(tuning.rooms[roomName].roleBounds.hauler.maxCount).toBe(8);
    // 不应有 hauler.maxCount 调整
    const haulerAdj = tuning.lastEval[roomName].adjustments.find(
      (a: string) => a.includes("hauler.maxCount=8→"),
    );
    expect(haulerAdj).toBeUndefined();
  });
});

describe("tuning-engine 边界场景 — 经济相位震荡", () => {
  it("crisisRatio 恰好 0.3 时不跳过（边界值）", () => {
    const roomName = "W7N4";
    // 10 个采样点，3 个 crisis → crisisRatio = 0.3，不 > 0.3
    const econ = createRingBuffer<EconomySample>(300);
    for (let i = 0; i < 10; i++) {
      ringPush(econ, {
        t: 1000 + i * 50, r: roomName,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 4000, ec: 8000, se: 20000, hc: 2, sc: 2,
        ph: i < 3 ? 2 : 4, // 前 3 个 crisis
      });
    }
    const cpu = buildCpuRing(10);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 2, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // crisisRatio = 0.3 不 > 0.3，不跳过
    expect(tuning.lastEval[roomName].skipped).toBeUndefined();
  });

  it("crisisRatio > 0.3 时跳过评估", () => {
    const roomName = "W7N4";
    // 10 个采样点，4 个 crisis → crisisRatio = 0.4 > 0.3
    const econ = createRingBuffer<EconomySample>(300);
    for (let i = 0; i < 10; i++) {
      ringPush(econ, {
        t: 1000 + i * 50, r: roomName,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 4000, ec: 8000, se: 20000, hc: 2, sc: 2,
        ph: i < 4 ? 2 : 4,
      });
    }
    const cpu = buildCpuRing(10);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 2, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastEval[roomName].skipped).toBe("economy_unstable");
  });
});

describe("tuning-engine 边界场景 — 多参数联动", () => {
  it("container满 + storage高位 + buildQueue积压 + 储备下降 → 多参数同时调整", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15, {
      d: -80,    // 储备下降 → harvester.maxCount ↑
      se: 60000, // storage 高位 → upgrader.maxCount ↑
      ea: 4000,  // spawn 未饱和
      ec: 8000,
    });
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, {
      hauler: 6,   // 达 maxCount → hauler.maxCount ↑ (container满 + spawn未饱和)
      harvester: 4, // 达 maxCount → harvester.maxCount ↑ (储备下降)
      upgrader: 3,  // 达 maxCount → upgrader.maxCount ↑ (storage高位)
      builder: 1,
    });

    // buildQueue 积压 → builder.maxCount ↑
    (globalThis as any).Memory.rooms = {
      [roomName]: {
        buildQueue: Array.from({ length: 5 }, (_, i) => ({
          id: `site_${i}`, state: "queued", structureType: "extension",
        })),
      },
    };

    const snap = snapshotWithContainers(roomName, 0.75); // container 满
    // 趋势确认机制：需连续两次评估才触发多参数同时调整
    runTwice(snap, mockBudget("healthy"), 5000);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    const adj = tuning.lastEval[roomName].adjustments;

    // 至少 3 个参数同时调整
    expect(adj.length).toBeGreaterThanOrEqual(3);
    expect(adj).toContain("hauler.maxCount=6→7");
    expect(adj).toContain("harvester.maxCount=4→5");
    expect(adj).toContain("upgrader.maxCount=3→4");
  });
});

describe("tuning-engine 边界场景 — 慢振荡验证", () => {
  it("连续 3 次评估周期（1500 tick）不产生振荡调整", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15, { ea: 4000, ec: 8000 });
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 6, harvester: 2, upgrader: 1, builder: 1 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.75);

    // 第 1 次评估 (tick=5000)：趋势确认机制下只记录 "up" 方向，不产生调整
    const ctx1 = buildContext([snap], mockBudget("healthy"), 5000);
    tuningEngineSystem.run(ctx1);
    const tuning1 = (globalThis as any).Memory.kernel.tuning;
    // 首次只记录方向，hauler.maxCount 未触发调整
    expect(tuning1.rooms[roomName].roleBounds.hauler).toBeUndefined();

    // 第 2 次评估 (tick=5500)：趋势确认触发调整 6→7
    const ctx2 = buildContext([snap], mockBudget("healthy"), 5500);
    tuningEngineSystem.run(ctx2);
    const tuning2 = (globalThis as any).Memory.kernel.tuning;
    expect(tuning2.rooms[roomName].roleBounds.hauler.maxCount).toBe(7);

    // 第 3 次评估 (tick=6500)：冷却期已过（1000 tick），但趋势已重置为 "none"，
    // 需重新积累 2 次同方向确认才可能再次调整 → 不调整
    const ctx3 = buildContext([snap], mockBudget("healthy"), 6500);
    tuningEngineSystem.run(ctx3);
    const tuning3 = (globalThis as any).Memory.kernel.tuning;
    expect(tuning3.rooms[roomName].roleBounds.hauler.maxCount).toBe(7); // 仍为 7

    // 无振荡：maxCount 从 6→7 后稳定在 7
    const haulerAdjs = tuning3.lastEval[roomName].adjustments.filter(
      (a: string) => a.includes("hauler.maxCount"),
    );
    expect(haulerAdjs).toHaveLength(0);
  });
});

// ─── P1-I：baselineVersion 版本戳清零 ───────────────────────

describe("tuning-engine — P1-I baselineVersion 版本戳", () => {
  it("首次运行（无 baselineVersion）→ 清空 rooms 并写入当前版本", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 2, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };
    // 预置「旧覆盖」：迁移后 baselineVersion 为 undefined，rooms 含旧覆盖值。
    (globalThis as any).Memory.kernel = {
      tuning: {
        lastTuned: 1000,
        rooms: {
          W7N4: {
            roleBounds: { hauler: { maxCount: 8 } }, // 旧基线下的离谱覆盖
            lastAdjusted: { "hauler.maxCount": 1000 },
          },
          W8N5: {
            roleBounds: { harvester: { maxCount: 5 } },
            lastAdjusted: {},
          },
        },
      },
    };

    const snap = snapshotWithContainers(roomName, 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // baselineVersion 被定版为 CONFIG 当前值。
    expect(tuning.baselineVersion).toBe(CONFIG.tuning.baselineVersion);
    // 旧 rooms 覆盖被清空（清零重来语义）—— 实际行为是清空 rooms 后
    // tuning-engine 立即评估重建空 RoomTuningState（roleBounds 为空），
    // 故断言「W8N5（无快照不评估）应消失」「W7N4 旧覆盖被清」。
    expect(tuning.rooms.W8N5).toBeUndefined();
    expect(tuning.rooms.W7N4.roleBounds).toEqual({});
    expect(tuning.rooms.W7N4.lastAdjusted).toEqual({});
    // lastEval 也清掉避免错位（评估时按当前快照重建）。
    // 评估后 lastEval.W7N4 会重建，但不会有 W8N5 的旧 lastEval。
  });

  it("版本匹配时不清空 rooms（保留现有覆盖值）", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 2, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };
    // 版本已对齐：保留覆盖，不触发清零。
    (globalThis as any).Memory.kernel = {
      tuning: {
        lastTuned: 4500,
        baselineVersion: CONFIG.tuning.baselineVersion, // 与 CONFIG.tuning.baselineVersion 一致
        rooms: {
          W7N4: {
            roleBounds: { hauler: { maxCount: 7 } },
            lastAdjusted: { "hauler.maxCount": 4500 },
          },
        },
      },
    };

    const snap = snapshotWithContainers(roomName, 0.3);
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.baselineVersion).toBe(CONFIG.tuning.baselineVersion);
    // 版本匹配 → rooms 保留。
    expect(tuning.rooms.W7N4.roleBounds.hauler.maxCount).toBe(7);
  });

  it("CONFIG 升版后 → 旧版本下的覆盖被清空", () => {
    // 模拟 CONFIG 升版后的场景：Memory 中 baselineVersion 为当前版本（旧版），
    // CONFIG.tuning.baselineVersion 已经升到下一版（mock 模拟）。
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15);
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 2, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };
    const original = CONFIG.tuning.baselineVersion;
    (globalThis as any).Memory.kernel = {
      tuning: {
        lastTuned: 4500,
        baselineVersion: original, // 旧版（当前 CONFIG 版本）
        rooms: {
          W7N4: {
            roleBounds: { hauler: { maxCount: 8 } }, // 旧基线下产生的覆盖
            lastAdjusted: {},
          },
        },
      },
    };

    // mock CONFIG.tuning.baselineVersion 升到下一版（模拟基线升级后的世界）。
    const nextBaseline = original + 1;
    Object.defineProperty(CONFIG.tuning, "baselineVersion", {
      value: nextBaseline,
      configurable: true,
      writable: true,
    });

    try {
      const snap = snapshotWithContainers(roomName, 0.3);
      const ctx = buildContext([snap], mockBudget("healthy"), 5000);

      tuningEngineSystem.run(ctx);

      const tuning = (globalThis as any).Memory.kernel.tuning;
      // 版本被更新为新基线。
      expect(tuning.baselineVersion).toBe(nextBaseline);
      // 旧覆盖被清零——清零后立即评估会重建空 RoomTuningState，
      // 故断言「roleBounds 为空（旧 hauler.maxCount=8 已清除）」。
      expect(tuning.rooms.W7N4.roleBounds).toEqual({});
      expect(tuning.rooms.W7N4.lastAdjusted).toEqual({});
    } finally {
      Object.defineProperty(CONFIG.tuning, "baselineVersion", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});

// ─── P3：verify pass 继承全局门禁（附录 E.2 修复）──────────────

describe("tuning-engine — P3 verify 全局门禁", () => {
  it("危机期（crisisRatio > 0.3）verify 跳过，pending 保留，参数仍被 pending-lock 排除", () => {
    const roomName = "W7N4";
    // 构造危机信号：15 个采样点，前 6 个 crisis（ph=2）→ crisisRatio = 0.4 > 0.3
    const econ = createRingBuffer<EconomySample>(300);
    for (let i = 0; i < 15; i++) {
      ringPush(econ, {
        t: 1000 + i * 50, r: roomName,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 4000, ec: 8000, se: 20000, hc: 2, sc: 2,
        ph: i < 6 ? 2 : 4, // 前 6 个 crisis
      });
    }
    const cpu = buildCpuRing(15); // ti=0 (healthy)
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 7, harvester: 2 }); // hauler=7（人口合同满足）
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    // 预置 pending：hauler.maxCount 6→7 上调，adjustTick=3000（verifyDelay 1500 已过）
    // 但危机期 verify 应跳过，pending 保留
    (globalThis as any).Memory.kernel = {
      tuning: {
        lastTuned: 3000,
        baselineVersion: CONFIG.tuning.baselineVersion,
        rooms: {
          [roomName]: {
            roleBounds: { hauler: { maxCount: 7 } },
            lastAdjusted: { "hauler.maxCount": 3000 },
            pendingValidation: {
              "hauler.maxCount": {
                preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, avgReserveDelta: 50, roleCount: 6 },
                expectedDirection: "improve",
                adjustDirection: "up",
                adjustTick: 3000,
                preAdjustValue: 6,
              },
            },
          },
        },
      },
    };

    const snap = snapshotWithContainers(roomName, 0.95); // container 满（信号恶化）
    const ctx = buildContext([snap], mockBudget("healthy"), 5000); // T=5000，verifyDelay(1500) 已过

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // P3：危机期 verify 跳过 → pending 保留
    expect(tuning.rooms[roomName].pendingValidation).toBeDefined();
    expect(tuning.rooms[roomName].pendingValidation["hauler.maxCount"]).toBeDefined();
    // verifySkipped 诊断记录原因
    expect(tuning.lastEval[roomName].verifySkipped).toBe("verify_skipped_crisis");
    // 危机期 evaluateTuning 也跳过（skipped=economy_unstable）
    expect(tuning.lastEval[roomName].skipped).toBe("economy_unstable");
    // 无回滚事件、无调整
    expect(tuning.lastEval[roomName].adjustments).toHaveLength(0);
  });

  it("危机解除后 verify 恢复执行，pending 被消费", () => {
    const roomName = "W7N4";
    // 第一阶段：危机期（同上一测试），verify 跳过
    const econCrisis = createRingBuffer<EconomySample>(300);
    for (let i = 0; i < 15; i++) {
      ringPush(econCrisis, {
        t: 1000 + i * 50, r: roomName,
        rs: 50000, d: 50, ds: 5, p: 10,
        ea: 4000, ec: 8000, se: 20000, hc: 2, sc: 2,
        ph: i < 6 ? 2 : 4,
      });
    }
    const cpu = buildCpuRing(15);
    setupTimeseries(econCrisis, cpu);

    setupCreeps(roomName, { hauler: 7, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };
    // preAdjustSignals.spawnFillRatio=0.7：高于健康期的 0.625，
    // 使次要证据（spawnFill↑）也不改善 → verify 恢复后触发回滚
    (globalThis as any).Memory.kernel = {
      tuning: {
        lastTuned: 3000,
        baselineVersion: CONFIG.tuning.baselineVersion,
        rooms: {
          [roomName]: {
            roleBounds: { hauler: { maxCount: 7 } },
            lastAdjusted: { "hauler.maxCount": 3000 },
            pendingValidation: {
              "hauler.maxCount": {
                preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.7, avgReserveDelta: 50, roleCount: 6 },
                expectedDirection: "improve",
                adjustDirection: "up",
                adjustTick: 3000,
                preAdjustValue: 6,
              },
            },
          },
        },
      },
    };

    const snap = snapshotWithContainers(roomName, 0.95);
    // T=5000：危机期，verify 跳过
    tuningEngineSystem.run(buildContext([snap], mockBudget("healthy"), 5000));
    const tuningAfterCrisis = (globalThis as any).Memory.kernel.tuning;
    expect(tuningAfterCrisis.rooms[roomName].pendingValidation["hauler.maxCount"]).toBeDefined();
    expect(tuningAfterCrisis.lastEval[roomName].verifySkipped).toBe("verify_skipped_crisis");

    // 第二阶段：危机解除（crisisRatio=0），verify 恢复执行
    const econHealthy = buildEconomyRing(roomName, 15); // 全部 ph=4（steady），ea=5000/ec=8000 → spawnFill=0.625
    setupTimeseries(econHealthy, cpu);

    // T=5500：危机解除，verifyDelay 早已过（5500-3000=2500 > 1500）
    // containerFill 0.8→0.95（恶化）+ spawnFill 0.7→0.625（未改善）→ 回滚
    tuningEngineSystem.run(buildContext([snap], mockBudget("healthy"), 5500));
    const tuningAfterRecover = (globalThis as any).Memory.kernel.tuning;

    // verify 恢复执行：pending 被消费（cleared）
    expect(tuningAfterRecover.rooms[roomName].pendingValidation?.["hauler.maxCount"]).toBeUndefined();
    expect(tuningAfterRecover.lastEval[roomName].verifySkipped).toBeUndefined();
    // 信号未改善 → 回滚到 preAdjustValue(6)
    expect(tuningAfterRecover.rooms[roomName].roleBounds.hauler.maxCount).toBe(6);
  });

  it("低 bucket（tierRank=2 conserve）verify 跳过，记录 verify_skipped_cpu_tier", () => {
    const roomName = "W7N4";
    const econ = buildEconomyRing(roomName, 15); // 健康经济
    // CPU tier=2 (conserve)
    const cpu = buildCpuRing(15, { ti: 2 });
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 7, harvester: 2 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };
    (globalThis as any).Memory.kernel = {
      tuning: {
        lastTuned: 3000,
        baselineVersion: CONFIG.tuning.baselineVersion,
        rooms: {
          [roomName]: {
            roleBounds: { hauler: { maxCount: 7 } },
            lastAdjusted: { "hauler.maxCount": 3000 },
            pendingValidation: {
              "hauler.maxCount": {
                preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, avgReserveDelta: 50, roleCount: 6 },
                expectedDirection: "improve",
                adjustDirection: "up",
                adjustTick: 3000,
                preAdjustValue: 6,
              },
            },
          },
        },
      },
    };

    const snap = snapshotWithContainers(roomName, 0.95);
    // 注意：tierRank=2 但 budget 仍为 healthy（tuningEngineSystem.run 只检查 budget tier，
    // 不检查 signals.tierRank；signals.tierRank 由 aggregateSignals 从 CPU ring 算出）
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // tierRank=2 → verify 跳过 + evaluate 跳过
    expect(tuning.rooms[roomName].pendingValidation["hauler.maxCount"]).toBeDefined();
    expect(tuning.lastEval[roomName].verifySkipped).toBe("verify_skipped_cpu_tier");
    expect(tuning.lastEval[roomName].skipped).toBe("cpu_tier_conserve_or_worse");
  });
});
