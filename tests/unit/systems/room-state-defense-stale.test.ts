import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { roomStateSystem } from "../../../src/systems/room-state";
import type { TickContext, RoomSnapshot } from "../../../src/kernel/contracts";

/**
 * P1-3 defense 误触发修复 — lastHostileAt 过期失效机制单元测试。
 *
 * 覆盖 room-state 层的威胁过期逻辑：
 *   - lastHostileAt 只在威胁新增（count 增加）时刷新（防旧威胁停留永久维持 defense）
 *   - threatCreeps>0 但 lastHostileAt 超 threatStaleTicks 未刷新 → hasHostiles=false
 *   - prevThreatCount 跨 tick 跟踪威胁数变化
 *
 * 根因：旧逻辑每 tick 刷新 lastHostileAt（当 hasHostiles 时），导致旧威胁停留时
 * lastHostileAt 永远是"当前"，消费方（tower-defense siegeMemory 等）永不过期。
 */

function makeStore(energy: number): { getUsedCapacity: (r: string) => number; getCapacity: (r: string) => number } {
  return {
    getUsedCapacity: (r: string) => (r === "energy" ? energy : 0),
    getCapacity: () => 1000000,
  };
}

function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomName: "W1N1",
    spawns: [],
    extensions: [],
    containers: [],
    storage: undefined,
    terminal: undefined,
    towers: [],
    labs: [],
    extractor: undefined,
    factory: undefined,
    sources: [{ id: "src1" } as Source],
    controller: { my: true, level: 6, ticksToDowngrade: 10000 } as unknown as StructureController,
    mineral: undefined,
    minerals: [],
    constructionSites: [],
    myConstructionSites: [],
    hostileCreeps: [],
    threatCreeps: [],
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map([["src1", 1]]),
    pendingHarvesters: 0,
    creepEnergy: 0,
    droppedEnergy: [],
    rcl: 6,
    ...overrides,
  } as unknown as RoomSnapshot;
}

function makeCtx(snapshots: RoomSnapshot[], tick = 100): TickContext {
  return {
    tick,
    budget: {
      tier: "healthy",
      softLimit: 17.5,
      hardLimit: 19.2,
      canStart: () => true,
      isExhausted: () => false,
      spent: () => 0,
    },
    getSnapshot: (name: string) => snapshots.find(s => s.roomName === name),
    snapshots: () => snapshots,
    globalSiteCount: 0,
  } as unknown as TickContext;
}

/** 构造 n 个威胁 creep（只需 id 区分数量即可）。 */
function makeThreat(n: number): Creep[] {
  return Array.from({ length: n }, (_, i) => ({ id: `h${i}` }) as Creep);
}

describe("room-state — P1-3 lastHostileAt 过期失效机制", () => {
  let savedMemory: typeof Memory | undefined;

  beforeEach(() => {
    savedMemory = (globalThis as Record<string, unknown>).Memory as typeof Memory | undefined;
    (globalThis as Record<string, unknown>).Memory = {
      rooms: {
        W1N1: {
          phase: { phase: "growth", reserve: 1000, drainScore: 0, liquidityScore: 0, bandTicks: 0 },
        },
      },
    };
  });

  afterEach(() => {
    if (savedMemory !== undefined) {
      (globalThis as Record<string, unknown>).Memory = savedMemory;
    } else {
      delete (globalThis as Record<string, unknown>).Memory;
    }
  });

  function getRoomMem() {
    return ((globalThis as Record<string, unknown>).Memory as typeof Memory).rooms["W1N1"]!;
  }

  // ── 正常路径 ──

  it("威胁首次到达（0→1）时 lastHostileAt 刷新且 colonyState=defense", () => {
    // prevThreatCount undefined → 0，threatCount=1 > 0 → threatIncreased → 刷新
    const snap = makeSnapshot({ threatCreeps: makeThreat(1) });
    roomStateSystem.run(makeCtx([snap], 100));

    const rm = getRoomMem();
    expect(rm.lastHostileAt).toBe(100);
    expect(rm.prevThreatCount).toBe(1);
    expect(rm.colonyState).toBe("defense");
  });

  it("威胁停留不增（1→1）时 lastHostileAt 不刷新", () => {
    // 上一 tick 状态：1 威胁，lastHostileAt=100
    const rm = getRoomMem();
    rm.prevThreatCount = 1;
    rm.lastHostileAt = 100;
    // 本 tick：仍 1 威胁（未增加），tick=150
    const snap = makeSnapshot({ threatCreeps: makeThreat(1) });
    roomStateSystem.run(makeCtx([snap], 150));

    // lastHostileAt 应保持 100（威胁未增加，不刷新）
    const after = getRoomMem();
    expect(after.lastHostileAt).toBe(100);
    expect(after.prevThreatCount).toBe(1);
  });

  it("威胁增加（1→2）时 lastHostileAt 刷新", () => {
    // 上一 tick 状态：1 威胁，lastHostileAt=100
    const rm = getRoomMem();
    rm.prevThreatCount = 1;
    rm.lastHostileAt = 100;
    // 本 tick：2 威胁（增援到达），tick=150
    const snap = makeSnapshot({ threatCreeps: makeThreat(2) });
    roomStateSystem.run(makeCtx([snap], 150));

    // lastHostileAt 应刷新为 150（威胁新增）
    const after = getRoomMem();
    expect(after.lastHostileAt).toBe(150);
    expect(after.prevThreatCount).toBe(2);
  });

  it("威胁清除（1→0）时 prevThreatCount=0 且 colonyState 非 defense", () => {
    // 上一 tick 状态：1 威胁，lastHostileAt=100
    const rm = getRoomMem();
    rm.prevThreatCount = 1;
    rm.lastHostileAt = 100;
    // 本 tick：威胁全部消失
    const snap = makeSnapshot({ threatCreeps: [] });
    roomStateSystem.run(makeCtx([snap], 150));

    const after = getRoomMem();
    expect(after.prevThreatCount).toBe(0);
    expect(after.colonyState).not.toBe("defense");
  });

  // ── 边界场景 ──

  it("威胁停留超 threatStaleTicks 未刷新时视为 stale（hasHostiles=false）", () => {
    // 上一 tick 状态：1 威胁，lastHostileAt=100
    const rm = getRoomMem();
    rm.prevThreatCount = 1;
    rm.lastHostileAt = 100;
    // 本 tick：仍 1 威胁（未增加），tick=250（距上次刷新 150 tick > 100）
    const snap = makeSnapshot({ threatCreeps: makeThreat(1) });
    roomStateSystem.run(makeCtx([snap], 250));

    // stale → hasHostiles=false → colonyState 非 defense
    const after = getRoomMem();
    expect(after.colonyState).not.toBe("defense");
    // lastHostileAt 未刷新（威胁未增加）
    expect(after.lastHostileAt).toBe(100);
  });

  it("威胁停留 threatStaleTicks 内（未 stale）时 hasHostiles=true", () => {
    // 上一 tick 状态：1 威胁，lastHostileAt=100
    const rm = getRoomMem();
    rm.prevThreatCount = 1;
    rm.lastHostileAt = 100;
    // 本 tick：仍 1 威胁（未增加），tick=150（距上次刷新 50 tick ≤ 100）
    const snap = makeSnapshot({ threatCreeps: makeThreat(1) });
    roomStateSystem.run(makeCtx([snap], 150));

    // 未 stale → hasHostiles=true → colonyState=defense
    const after = getRoomMem();
    expect(after.colonyState).toBe("defense");
    // lastHostileAt 未刷新（威胁未增加）但仍生效
    expect(after.lastHostileAt).toBe(100);
  });

  it("lastHostileAt undefined 但有威胁时不判 stale（首次无基线跳过 stale 判定）", () => {
    // 边界：prevThreatCount=1 但 lastHostileAt 缺失（异常/迁移后状态）
    // threatCount=1 = prevThreatCount=1 → threatIncreased=false → lastHostileAt 不刷新
    // 但 lastHostileAt undefined → threatStale=false（无基线不判 stale）→ hasHostiles=true
    const rm = getRoomMem();
    rm.prevThreatCount = 1;
    rm.lastHostileAt = undefined;
    const snap = makeSnapshot({ threatCreeps: makeThreat(1) });
    roomStateSystem.run(makeCtx([snap], 1000));

    expect(getRoomMem().colonyState).toBe("defense");
  });

  it("prevThreatCount undefined 时按 0 处理（首威胁即新增）", () => {
    // prevThreatCount undefined → 视为 0
    // threatCount=1 > 0 → threatIncreased=true → 刷新 lastHostileAt
    const snap = makeSnapshot({ threatCreeps: makeThreat(1) });
    roomStateSystem.run(makeCtx([snap], 100));

    const after = getRoomMem();
    expect(after.lastHostileAt).toBe(100);
    expect(after.prevThreatCount).toBe(1);
    expect(after.colonyState).toBe("defense");
  });
});
