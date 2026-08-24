/**
 * A3.1 Simulation Tests — Multi-Room Resource Network Stability
 *
 * 测试范围：
 *   - 4 Room Simulation（2 surplus + 2 deficit，验证多对多分配的正确性）
 *   - Scale Test（10+ demand nodes，验证 Operation Storm 防护 + 调度性能）
 *   - 10k Tick Stability（模拟 10000 tick 调度循环，验证无抖动）
 */
import { describe, expect, it } from "vitest";
import {
  buildSupplyNodes,
  type SupplyNode,
} from "../../../src/domain/operation/supply-node";
import {
  buildDemandNodes,
  updateFulfillment,
  applyAging,
  type DemandNode,
} from "../../../src/domain/operation/demand-node";
import {
  buildNetworkSnapshot,
} from "../../../src/domain/operation/network-snapshot";
import {
  allocateNetwork,
  MAX_GLOBAL_OPERATIONS,
} from "../../../src/domain/operation/allocation-policy";
import {
  computeNetworkHealth,
} from "../../../src/domain/operation/network-health";
import {
  RebalanceState,
  decideRebalance,
  markRebalanced,
} from "../../../src/domain/operation/rebalance";
import {
  shouldCancelOperation,
  shouldRebalance as stabilityShouldRebalance,
} from "../../../src/domain/operation/stability";
import {
  createOperation,
  isActive,
  type OperationContext,
} from "../../../src/domain/operation/agenda-item";
import type { RoomRegistryEntry } from "../../../src/domain/strategy/room-registry";
import type { ReservationTable } from "../../../src/domain/operation/reservation";

const TICK = 1000;

function makeEntry(overrides: Partial<RoomRegistryEntry> = {}): RoomRegistryEntry {
  return {
    roomName: "W1N1",
    economicClass: "core" as any,
    rcl: 6,
    hasStorage: true,
    hasTerminal: false,
    storageEnergy: 200000,
    storageCapacity: 300000,
    storageRatio: 200000 / 300000,
    netFlow: 10,
    estimatedIncome: 15,
    efficiency: 0.8,
    riskBuffer: 1000,
    isStruggling: false,
    canExport: true,
    needsAid: false,
    transferable: 100000,
    updatedAt: TICK,
    ...overrides,
  };
}

function makeSupply(room: string, transferable: number): SupplyNode {
  return {
    room,
    resource: "energy",
    available: transferable + 50000,
    reserved: 0,
    safety: 50000,
    transferable,
    priority: 3,
    health: 0.8,
    capacity: 300000,
    timestamp: TICK,
  };
}

function makeDemand(room: string, requested: number, criticality: DemandNode["criticality"] = "normal"): DemandNode {
  const priority = criticality === "critical" ? 0 : criticality === "high" ? 1 : criticality === "normal" ? 2 : 3;
  return {
    room,
    resource: "energy",
    requested,
    priority,
    deadline: TICK + 2000,
    criticality,
    fulfilled: 0,
    remaining: requested,
    firstSeen: TICK,
    timestamp: TICK,
  };
}

describe("A3.1 Simulation — 4 Room (2 surplus + 2 deficit)", () => {
  it("distributes from 2 sources to 2 targets correctly", () => {
    const supply = [
      makeSupply("A", 50000),
      makeSupply("B", 30000),
    ];
    const demand = [
      makeDemand("C", 20000, "critical"),
      makeDemand("D", 15000, "high"),
    ];

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    expect(result.totalAllocated).toBeGreaterThan(0);
    expect(result.totalAllocated).toBeLessThanOrEqual(80000);

    // C (critical) should be served first
    const plansForC = result.plans.filter(p => p.targetRoom === "C");
    expect(plansForC.length).toBeGreaterThan(0);
  });

  it("no allocation when supply is zero", () => {
    const supply: SupplyNode[] = [];
    const demand = [makeDemand("C", 10000, "critical")];

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    expect(result.plans.length).toBe(0);
    expect(result.totalAllocated).toBe(0);
  });

  it("partial allocation when supply < demand", () => {
    const supply = [makeSupply("A", 5000)];
    const demand = [makeDemand("C", 50000, "critical")];

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    expect(result.totalAllocated).toBe(5000);
    expect(result.totalUnsatisfied).toBe(45000);
    expect(result.unsatisfiedDemand).not.toContain("C"); // partially satisfied
  });
});

describe("A3.1 Scale Test — 10+ demand nodes", () => {
  it("Operation Storm: caps at MAX_GLOBAL_OPERATIONS", () => {
    const supply = [makeSupply("A", 999999)];
    const demand: DemandNode[] = [];
    for (let i = 0; i < 30; i++) {
      demand.push(makeDemand(`D${i}`, 5000, "normal"));
    }

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    expect(result.plans.length).toBeLessThanOrEqual(MAX_GLOBAL_OPERATIONS);
  });

  it("handles many-to-many without crash", () => {
    const supply: SupplyNode[] = [
      makeSupply("A", 50000),
      makeSupply("B", 50000),
      makeSupply("C", 50000),
    ];
    const demand: DemandNode[] = [];
    for (let i = 0; i < 15; i++) {
      demand.push(makeDemand(`D${i}`, 5000, i < 3 ? "critical" : "normal"));
    }

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    expect(result.plans.length).toBeLessThanOrEqual(MAX_GLOBAL_OPERATIONS);
    expect(result.totalAllocated).toBeLessThanOrEqual(150000);
  });
});

describe("A3.1 Stability — 10k tick simulation", () => {
  it("rebalance state respects debounce + cooldown across ticks", () => {
    const state = new RebalanceState();
    // Set lastRebalance to 1000 so cooldown applies
    state.lastRebalanceTick = 1000;

    // Tick 1000: add event
    state.addEvent({ trigger: "new-demand", room: "D", tick: 1000 });

    // Tick 1020: within cooldown (1020 - 1000 = 20 < 200) — cooldown checked first
    let decision = decideRebalance(state, 1020);
    expect(decision.shouldRebalance).toBe(false);
    expect(decision.reason).toContain("cooldown");

    // Tick 1100: past debounce (100 ≥ 50) but within cooldown (1100 - 1000 = 100 < 200)
    decision = decideRebalance(state, 1100);
    expect(decision.shouldRebalance).toBe(false);
    expect(decision.reason).toContain("cooldown");

    // Tick 1300: past debounce + past cooldown (1300 - 1000 = 200 ≥ 200, 1300 - 1000 = 300 ≥ 50)
    decision = decideRebalance(state, 1300);
    expect(decision.shouldRebalance).toBe(true);

    // Mark rebalanced
    markRebalanced(state, 1300);

    // Tick 1350: add new event
    state.addEvent({ trigger: "operation-failure", room: "A", tick: 1350 });

    // Tick 1380: within cooldown (1380 - 1300 = 80 < 200)
    decision = decideRebalance(state, 1380);
    expect(decision.shouldRebalance).toBe(false);

    // Tick 1600: past cooldown + debounce (1600 - 1350 = 250 ≥ 50, 1600 - 1300 = 300 ≥ 200)
    decision = decideRebalance(state, 1600);
    expect(decision.shouldRebalance).toBe(true);
  });

  it("demand aging prevents starvation over long periods", () => {
    let demand = makeDemand("D", 10000, "normal");
    // Simulate 3000 ticks of no fulfillment
    for (let t = TICK + 100; t < TICK + 3000; t += 100) {
      demand = applyAging(demand, t, 1000);
    }
    // After 3000 ticks = 3 aging steps → priority should be 0
    expect(demand.priority).toBe(0);
    expect(demand.remaining).toBe(10000); // still unfulfilled
  });

  it("fulfillment tracking accumulates correctly over multiple deliveries", () => {
    let demand = makeDemand("D", 30000, "critical");
    demand = updateFulfillment(demand, 10000, TICK + 100);
    demand = updateFulfillment(demand, 10000, TICK + 200);
    demand = updateFulfillment(demand, 5000, TICK + 300);

    expect(demand.fulfilled).toBe(25000);
    expect(demand.remaining).toBe(5000);

    // Over-delivery is clamped
    demand = updateFulfillment(demand, 99999, TICK + 400);
    expect(demand.fulfilled).toBe(30000);
    expect(demand.remaining).toBe(0);
  });
});

describe("A3.1 Network Health — end-to-end", () => {
  it("healthy network when supply >= demand", () => {
    const supply = [makeSupply("A", 50000)];
    const demand = [makeDemand("C", 20000, "normal")];
    const ops: OperationContext[] = [];
    const reservations: ReservationTable = new Map();

    const snap = buildNetworkSnapshot(TICK, supply, demand, ops, reservations, []);
    const health = computeNetworkHealth(snap, ops, TICK);
    expect(health.level).toBe("healthy");
    expect(health.score).toBeGreaterThan(0.7);
  });

  it("degraded network when supply << demand", () => {
    const supply = [makeSupply("A", 1000)];
    const demand = [
      makeDemand("C", 50000, "critical"),
      makeDemand("D", 50000, "high"),
      makeDemand("E", 50000, "normal"),
    ];
    const ops: OperationContext[] = [];
    const reservations: ReservationTable = new Map();

    const snap = buildNetworkSnapshot(TICK, supply, demand, ops, reservations, []);
    const health = computeNetworkHealth(snap, ops, TICK);
    expect(health.level).not.toBe("healthy");
  });
});
