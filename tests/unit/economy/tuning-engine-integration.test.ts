/**
 * Tuning Engine 集成测试 — 测试 run() 完整链路。
 *
 * 覆盖系统层集成（domain 纯函数已在 tuning.test.ts 中覆盖）：
 *   - conserve/recovery tier 跳过
 *   - 数据不足跳过
 *   - 健康经济 + container 满 → hauler.maxCount 增加
 *   - 健康经济 + buildQueue 空 → builder.maxCount 减少
 *   - 多房间 lastEval 按房间独立保存
 *   - 经济不稳定（crisisRatio 过高）跳过并记录原因
 *   - lastTuned 更新为当前 tick
 *   - 冷却期阻止重复调整
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tuningEngineSystem } from "../../../src/systems/tuning-engine";
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
  it("container满 + spawn饱和 → 不加 hauler（消费端瓶颈，P0-1 验证）", () => {
    const roomName = "W7N4";
    // ea=7000, ec=8000 → spawnFillRatio = 0.875 > SPAWN_SATURATED(0.8)
    const econ = buildEconomyRing(roomName, 15, { ea: 7000, ec: 8000 });
    const cpu = buildCpuRing(15);
    setupTimeseries(econ, cpu);

    setupCreeps(roomName, { hauler: 6, harvester: 2, upgrader: 1, builder: 1 });
    (globalThis as any).Memory.rooms = { [roomName]: { buildQueue: [] } };

    const snap = snapshotWithContainers(roomName, 0.75); // container 满
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // 消费端饱和时不应增加 hauler.maxCount（minCount 可能因 container 半满而调整，属正常）
    expect(tuning.rooms[roomName].roleBounds.hauler?.maxCount).toBeUndefined();
    // 诊断信号应记录 spawnFillRatio
    expect(tuning.lastEval[roomName].signals.spawnFillRatio).toBeGreaterThanOrEqual(0.8);
  });

  it("container满 + spawn未饱和 → 加 hauler（P0-1 正向验证）", () => {
    const roomName = "W7N4";
    // ea=4000, ec=8000 → spawnFillRatio = 0.5 < 0.8（未饱和）
    const econ = buildEconomyRing(roomName, 15, { ea: 4000, ec: 8000 });
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
    expect(tuning.lastEval[roomName].signals.spawnFillRatio).toBeLessThan(0.8);
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
    (globalThis as any).Memory.kernel.tuning = {
      lastTuned: 0,
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
