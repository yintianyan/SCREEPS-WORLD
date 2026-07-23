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
import { tuningEngineSystem } from "../src/systems/tuning-engine";
import {
  resetGlobals,
  mockSnapshot,
  mockStructure,
  mockBudget,
  mockCreep,
  mockController,
} from "./role-helpers";
import { createRingBuffer, ringPush } from "../src/kernel/ring-buffer";
import type { RingBuffer } from "../src/kernel/ring-buffer";
import type { EconomySample, CpuSample } from "../src/kernel/timeseries";
import type { RoomSnapshot, TickContext, Budget } from "../src/kernel/contracts";

beforeEach(() => {
  resetGlobals();
  delete (globalThis as any).__segStore;
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
    timeseries: { cpu, economy: econ },
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
    getSnapshot: vi.fn((room: string) =>
      snapshots.find(s => s.roomName === room),
    ),
    snapshots: vi.fn(function* () {
      for (const s of snapshots) yield s;
    }),
  };
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
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(5000);

    const roomTuning = tuning.rooms[roomName];
    expect(roomTuning).toBeDefined();
    expect(roomTuning.roleBounds.hauler).toBeDefined();
    expect(roomTuning.roleBounds.hauler.maxCount).toBe(7);
    expect(roomTuning.lastAdjusted["hauler.maxCount"]).toBe(5000);

    const evalSnapshot = tuning.lastEval[roomName];
    expect(evalSnapshot).toBeDefined();
    expect(evalSnapshot.tick).toBe(5000);
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
    const ctx = buildContext([snap], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

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
    const ctx = buildContext([snapA, snapB], mockBudget("healthy"), 5000);

    tuningEngineSystem.run(ctx);

    const tuning = (globalThis as any).Memory.kernel.tuning;

    // 两房各自有独立的 lastEval 诊断快照
    expect(tuning.lastEval[roomA]).toBeDefined();
    expect(tuning.lastEval[roomB]).toBeDefined();
    expect(tuning.lastEval[roomA].tick).toBe(5000);
    expect(tuning.lastEval[roomB].tick).toBe(5000);

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

    // 第一次运行：hauler.maxCount 6 → 7
    const ctx1 = buildContext([snap], mockBudget("healthy"), 5000);
    tuningEngineSystem.run(ctx1);

    const tuning1 = (globalThis as any).Memory.kernel.tuning;
    expect(tuning1.rooms[roomName].roleBounds.hauler.maxCount).toBe(7);
    expect(tuning1.lastEval[roomName].adjustments).toContain("hauler.maxCount=6→7");

    // 第二次运行（500 tick 后，冷却期 1000 tick 未过）：不应再次调整 hauler.maxCount
    const ctx2 = buildContext([snap], mockBudget("healthy"), 5500);
    tuningEngineSystem.run(ctx2);

    const tuning2 = (globalThis as any).Memory.kernel.tuning;
    // maxCount 仍为 7（未被再次调整）
    expect(tuning2.rooms[roomName].roleBounds.hauler.maxCount).toBe(7);
    // 本次评估的 adjustments 不包含 hauler.maxCount
    expect(tuning2.lastEval[roomName].adjustments).not.toContain("hauler.maxCount=7→8");
  });
});
