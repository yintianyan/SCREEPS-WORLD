/** 无害侦察观测测试（R7c）— room-state 记录「有人盯防」信号。 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { roomStateSystem } from "../../../src/systems/room-state";
import type { TickContext, RoomSnapshot } from "../../../src/kernel/contracts";
import { mockPos } from "../../role-helpers";

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

function scout(): any {
  return { id: "scout_1", name: "scout_1", owner: { username: "Enemy" }, body: [], hits: 100, hitsMax: 100, pos: mockPos(10, 10, "W1N1") };
}

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

describe("room-state — 无害侦察观测（R7c）", () => {
  it("敌对无威胁部件 → 写入 lastObserverAt + observerSightings", () => {
    const snapshot = makeSnapshot({ hostileCreeps: [scout()], threatCreeps: [] });

    roomStateSystem.run(makeCtx([snapshot], 100));

    const roomMem = ((globalThis as Record<string, unknown>).Memory as typeof Memory).rooms["W1N1"]!;
    expect(roomMem.lastObserverAt).toBe(100);
    expect(roomMem.observerSightings).toBe(1);
  });

  it("重复目击计数累计（持续盯防信号）", () => {
    const snapshot = makeSnapshot({ hostileCreeps: [scout()], threatCreeps: [] });

    roomStateSystem.run(makeCtx([snapshot], 100));
    roomStateSystem.run(makeCtx([snapshot], 101));

    const roomMem = ((globalThis as Record<string, unknown>).Memory as typeof Memory).rooms["W1N1"]!;
    expect(roomMem.lastObserverAt).toBe(101);
    expect(roomMem.observerSightings).toBe(2);
  });

  it("威胁在场 → 观测字段不写（与威胁记忆分离）", () => {
    const attacker = { ...scout(), body: [{ type: "attack", hits: 100 }] };
    const snapshot = makeSnapshot({ hostileCreeps: [attacker], threatCreeps: [attacker] });

    roomStateSystem.run(makeCtx([snapshot], 100));

    const roomMem = ((globalThis as Record<string, unknown>).Memory as typeof Memory).rooms["W1N1"]!;
    expect(roomMem.lastObserverAt).toBeUndefined();
    expect(roomMem.observerSightings).toBeUndefined();
    expect(roomMem.lastHostileAt).toBe(100); // 威胁记忆照常写入
  });
});
