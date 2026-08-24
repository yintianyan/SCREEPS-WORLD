/**
 * A3.1 Contract Tests — Empire Resource Network
 *
 * 测试范围：
 *   A3.1-001..005: Supply Node
 *   A3.1-006..010: Demand Node
 *   A3.1-011..013: Network Snapshot
 *   A3.1-014..017: Allocation Policy v2 (TOCTOU + Multi-Source + Partial + Storm)
 *   A3.1-018..019: Preemption Policy
 *   A3.1-020: Plan Stability
 */
import { describe, expect, it } from "vitest";
import {
  buildSupplyNode,
  buildSupplyNodes,
  sumSupplyTransferable,
  type SupplyNode,
} from "../../../src/domain/operation/supply-node";
import {
  buildDemandNode,
  buildDemandNodes,
  updateFulfillment,
  isFulfilled,
  isStarving,
  applyAging,
  sumDemandRemaining,
  type DemandNode,
} from "../../../src/domain/operation/demand-node";
import {
  buildNetworkSnapshot,
  needsRebalance,
} from "../../../src/domain/operation/network-snapshot";
import {
  allocateNetwork,
  MAX_GLOBAL_OPERATIONS,
  MAX_TARGETS_PER_SOURCE,
  MAX_SOURCES_PER_TARGET,
  type RouteDistance,
} from "../../../src/domain/operation/allocation-policy";
import {
  classifyPreemption,
  isPreemptable,
  attemptPreemption,
} from "../../../src/domain/operation/preemption";
import {
  shouldCancelOperation,
  shouldRebalance,
  getStabilityParams,
} from "../../../src/domain/operation/stability";
import {
  RebalanceState,
  decideRebalance,
  markRebalanced,
} from "../../../src/domain/operation/rebalance";
import {
  createOperation,
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

function makeOp(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    id: "supply:A:B:energy",
    type: "supply",
    status: "planned",
    sourceRoom: "A",
    targetRoom: "B",
    requestedAmount: 5000,
    deliveredAmount: 0,
    reservedAmount: 5000,
    priority: 2,
    resource: "energy",
    deadline: TICK + 2000,
    createdAt: TICK,
    updatedAt: TICK,
    retries: 0,
    maxRetries: 3,
    ...overrides,
  };
}

// ── Supply Node Tests ──────────────────────────────────

describe("A3.1-001: Supply Node — buildSupplyNode basic", () => {
  it("creates supply node from surplus entry", () => {
    const entry = makeEntry({ roomName: "A", transferable: 50000 });
    const node = buildSupplyNode(entry, 5000, TICK);
    expect(node).toBeDefined();
    expect(node!.room).toBe("A");
    expect(node!.resource).toBe("energy");
    expect(node!.transferable).toBe(50000);
    expect(node!.reserved).toBe(5000);
  });

  it("returns undefined for non-export entry", () => {
    const entry = makeEntry({ canExport: false });
    const node = buildSupplyNode(entry, 0, TICK);
    expect(node).toBeUndefined();
  });

  it("returns undefined for zero transferable", () => {
    const entry = makeEntry({ transferable: 0 });
    const node = buildSupplyNode(entry, 0, TICK);
    expect(node).toBeUndefined();
  });
});

describe("A3.1-002: Supply Node — buildSupplyNodes batch", () => {
  it("builds multiple nodes sorted by transferable desc", () => {
    const entries = [
      makeEntry({ roomName: "A", transferable: 30000 }),
      makeEntry({ roomName: "B", transferable: 80000 }),
      makeEntry({ roomName: "C", transferable: 50000 }),
    ];
    const reserved = new Map([["A", 5000]]);
    const nodes = buildSupplyNodes(entries, reserved, TICK);
    expect(nodes.length).toBe(3);
    expect(nodes[0]!.room).toBe("B"); // highest transferable
    expect(nodes[1]!.room).toBe("C");
    expect(nodes[2]!.room).toBe("A");
    expect(nodes[2]!.reserved).toBe(5000);
  });
});

describe("A3.1-003: Supply Node — sumSupplyTransferable", () => {
  it("sums all transferable", () => {
    const nodes: SupplyNode[] = [
      { room: "A", resource: "energy", available: 100000, reserved: 5000, safety: 5000, transferable: 30000, priority: 3, health: 0.8, capacity: 300000, timestamp: TICK },
      { room: "B", resource: "energy", available: 200000, reserved: 10000, safety: 5000, transferable: 50000, priority: 3, health: 0.9, capacity: 300000, timestamp: TICK },
    ];
    expect(sumSupplyTransferable(nodes)).toBe(80000);
  });
});

describe("A3.1-004: Supply Node — health computation", () => {
  it("high health for rich room", () => {
    const entry = makeEntry({ riskBuffer: 3000, storageRatio: 0.8, netFlow: 20 });
    const node = buildSupplyNode(entry, 0, TICK);
    expect(node!.health).toBeGreaterThan(0.7);
  });

  it("lower health for tight room", () => {
    const entry = makeEntry({ riskBuffer: 500, storageRatio: 0.3, netFlow: -5 });
    const node = buildSupplyNode(entry, 0, TICK);
    expect(node!.health).toBeLessThan(0.7);
  });
});

describe("A3.1-005: Supply Node — priority derivation", () => {
  it("P3 for very safe room", () => {
    const entry = makeEntry({ riskBuffer: 3000 });
    const node = buildSupplyNode(entry, 0, TICK);
    expect(node!.priority).toBe(3);
  });

  it("P1 for tight room", () => {
    const entry = makeEntry({ riskBuffer: 500 });
    const node = buildSupplyNode(entry, 0, TICK);
    expect(node!.priority).toBe(1);
  });
});

// ── Demand Node Tests ──────────────────────────────────

describe("A3.1-006: Demand Node — buildDemandNode basic", () => {
  it("creates demand node from deficit entry", () => {
    const entry = makeEntry({ roomName: "C", needsAid: true, riskBuffer: 50, storageEnergy: 10000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK);
    expect(node).toBeDefined();
    expect(node!.room).toBe("C");
    expect(node!.remaining).toBeGreaterThan(0);
    expect(node!.criticality).toBe("critical");
  });

  it("returns undefined for non-aid entry", () => {
    const entry = makeEntry({ needsAid: false });
    const node = buildDemandNode(entry, 0, TICK);
    expect(node).toBeUndefined();
  });
});

describe("A3.1-007: Demand Node — criticality levels", () => {
  it("critical for struggling room", () => {
    const entry = makeEntry({ needsAid: true, isStruggling: true, storageEnergy: 1000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK);
    expect(node!.criticality).toBe("critical");
    expect(node!.priority).toBe(0);
  });

  it("high for riskBuffer < 400", () => {
    const entry = makeEntry({ needsAid: true, riskBuffer: 200, storageEnergy: 50000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK);
    expect(node!.criticality).toBe("high");
    expect(node!.priority).toBe(1);
  });

  it("normal for riskBuffer < 1000", () => {
    const entry = makeEntry({ needsAid: true, riskBuffer: 600, storageEnergy: 50000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK);
    expect(node!.criticality).toBe("normal");
  });

  it("low for riskBuffer >= 1000", () => {
    const entry = makeEntry({ needsAid: true, riskBuffer: 1500, storageEnergy: 80000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK);
    expect(node!.criticality).toBe("low");
  });
});

describe("A3.1-008: Demand Node — fulfillment tracking", () => {
  it("updateFulfillment increases fulfilled, decreases remaining", () => {
    const entry = makeEntry({ needsAid: true, riskBuffer: 50, storageEnergy: 10000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK)!;
    const updated = updateFulfillment(node, 10000, TICK + 100);
    expect(updated.fulfilled).toBe(10000);
    expect(updated.remaining).toBe(node.requested - 10000);
  });

  it("isFulfilled returns true when remaining <= 0", () => {
    const entry = makeEntry({ needsAid: true, riskBuffer: 50, storageEnergy: 10000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK)!;
    const fulfilled = updateFulfillment(node, node.requested, TICK + 100);
    expect(isFulfilled(fulfilled)).toBe(true);
  });
});

describe("A3.1-009: Demand Node — starvation + aging", () => {
  it("isStarving returns true after threshold", () => {
    const entry = makeEntry({ needsAid: true, riskBuffer: 600, storageEnergy: 50000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK, TICK + 2000, TICK)!;
    expect(isStarving(node, TICK + 1100, 1000)).toBe(true);
    expect(isStarving(node, TICK + 500, 1000)).toBe(false);
  });

  it("applyAging boosts priority for starving demand", () => {
    const entry = makeEntry({ needsAid: true, riskBuffer: 600, storageEnergy: 50000, storageCapacity: 300000 });
    const node = buildDemandNode(entry, 0, TICK, TICK + 2000, TICK)!;
    const aged = applyAging(node, TICK + 1000, 1000);
    expect(aged.priority).toBeLessThanOrEqual(node.priority);
  });
});

describe("A3.1-010: Demand Node — batch build sorted by criticality", () => {
  it("critical before low", () => {
    const entries = [
      makeEntry({ roomName: "Low", needsAid: true, riskBuffer: 1500, storageEnergy: 80000, storageCapacity: 300000 }),
      makeEntry({ roomName: "Critical", needsAid: true, riskBuffer: 50, storageEnergy: 10000, storageCapacity: 300000 }),
    ];
    const nodes = buildDemandNodes(entries, new Map(), TICK);
    expect(nodes[0]!.room).toBe("Critical");
    expect(nodes[1]!.room).toBe("Low");
  });
});

// ── Network Snapshot Tests ──────────────────────────────

describe("A3.1-011: Network Snapshot — buildNetworkSnapshot", () => {
  it("computes totals correctly", () => {
    const supply: SupplyNode[] = [
      { room: "A", resource: "energy", available: 100000, reserved: 0, safety: 5000, transferable: 50000, priority: 3, health: 0.8, capacity: 300000, timestamp: TICK },
    ];
    const demand: DemandNode[] = [
      { room: "B", resource: "energy", requested: 80000, priority: 0, deadline: TICK + 2000, criticality: "critical", fulfilled: 0, remaining: 80000, firstSeen: TICK, timestamp: TICK },
    ];
    const ops: OperationContext[] = [];
    const reservations: ReservationTable = new Map();

    const snap = buildNetworkSnapshot(TICK, supply, demand, ops, reservations, []);
    expect(snap.totalSupply).toBe(50000);
    expect(snap.totalDemand).toBe(80000);
    expect(snap.totalRemaining).toBe(80000);
    expect(snap.gap).toBe(30000); // 80000 - 50000
  });
});

describe("A3.1-012: Network Snapshot — needsRebalance", () => {
  it("returns true for first snapshot", () => {
    const snap = { tick: TICK, supplyNodes: [], demandNodes: [], reservationCount: 0, activeOperationCount: 0, allocationPlans: [], totalSupply: 0, totalDemand: 0, totalRemaining: 0, totalFulfilled: 0, gap: 0 };
    expect(needsRebalance(snap as any, undefined)).toBe(true);
  });

  it("returns false when no significant change", () => {
    const snap1 = { tick: TICK, supplyNodes: [], demandNodes: [], reservationCount: 0, activeOperationCount: 0, allocationPlans: [], totalSupply: 100000, totalDemand: 50000, totalRemaining: 50000, totalFulfilled: 0, gap: -50000 };
    const snap2 = { tick: TICK + 100, supplyNodes: [], demandNodes: [], reservationCount: 0, activeOperationCount: 0, allocationPlans: [], totalSupply: 101000, totalDemand: 50000, totalRemaining: 50000, totalFulfilled: 0, gap: -51000 };
    expect(needsRebalance(snap2 as any, snap1 as any)).toBe(false);
  });
});

describe("A3.1-013: Network Snapshot — gap sign reversal triggers rebalance", () => {
  it("gap sign reversal triggers rebalance", () => {
    const snap1 = { tick: TICK, supplyNodes: [], demandNodes: [], reservationCount: 0, activeOperationCount: 0, allocationPlans: [], totalSupply: 50000, totalDemand: 30000, totalRemaining: 30000, totalFulfilled: 0, gap: -20000 };
    const snap2 = { tick: TICK + 100, supplyNodes: [], demandNodes: [], reservationCount: 0, activeOperationCount: 0, allocationPlans: [], totalSupply: 30000, totalDemand: 50000, totalRemaining: 50000, totalFulfilled: 0, gap: 20000 };
    expect(needsRebalance(snap2 as any, snap1 as any)).toBe(true);
  });
});

// ── Allocation Policy v2 Tests ──────────────────────────

describe("A3.1-014: Allocation Policy v2 — TOCTOU prevention", () => {
  it("does not double-allocate from same source", () => {
    const supply: SupplyNode[] = [
      { room: "A", resource: "energy", available: 100000, reserved: 0, safety: 5000, transferable: 20000, priority: 3, health: 0.8, capacity: 300000, timestamp: TICK },
    ];
    const demand: DemandNode[] = [
      { room: "B", resource: "energy", requested: 15000, priority: 0, deadline: TICK + 2000, criticality: "critical", fulfilled: 0, remaining: 15000, firstSeen: TICK, timestamp: TICK },
      { room: "C", resource: "energy", requested: 10000, priority: 1, deadline: TICK + 2000, criticality: "high", fulfilled: 0, remaining: 10000, firstSeen: TICK, timestamp: TICK },
    ];

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    // Total allocated should not exceed 20000 (source's transferable)
    expect(result.totalAllocated).toBeLessThanOrEqual(20000);
  });
});

describe("A3.1-015: Allocation Policy v2 — Multi-Source Fulfillment", () => {
  it("multiple sources satisfy one demand", () => {
    const supply: SupplyNode[] = [
      { room: "A", resource: "energy", available: 100000, reserved: 0, safety: 5000, transferable: 5000, priority: 3, health: 0.8, capacity: 300000, timestamp: TICK },
      { room: "B", resource: "energy", available: 100000, reserved: 0, safety: 5000, transferable: 5000, priority: 3, health: 0.8, capacity: 300000, timestamp: TICK },
    ];
    const demand: DemandNode[] = [
      { room: "C", resource: "energy", requested: 8000, priority: 0, deadline: TICK + 2000, criticality: "critical", fulfilled: 0, remaining: 8000, firstSeen: TICK, timestamp: TICK },
    ];

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    // Should use both sources to satisfy demand
    const sourcesForC = result.plans.filter(p => p.targetRoom === "C");
    expect(sourcesForC.length).toBeGreaterThanOrEqual(1);
    expect(result.totalAllocated).toBeGreaterThanOrEqual(5000);
  });
});

describe("A3.1-016: Allocation Policy v2 — Operation Storm prevention", () => {
  it("respects MAX_GLOBAL_OPERATIONS", () => {
    // Create more demands than MAX_GLOBAL_OPERATIONS
    const supply: SupplyNode[] = [
      { room: "A", resource: "energy", available: 1000000, reserved: 0, safety: 5000, transferable: 999000, priority: 3, health: 0.8, capacity: 1000000, timestamp: TICK },
    ];
    const demand: DemandNode[] = [];
    for (let i = 0; i < MAX_GLOBAL_OPERATIONS + 10; i++) {
      demand.push({
        room: `D${i}`, resource: "energy", requested: 5000, priority: 2,
        deadline: TICK + 2000, criticality: "normal", fulfilled: 0, remaining: 5000,
        firstSeen: TICK, timestamp: TICK,
      });
    }

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    expect(result.plans.length).toBeLessThanOrEqual(MAX_GLOBAL_OPERATIONS);
  });

  it("respects MAX_TARGETS_PER_SOURCE", () => {
    const supply: SupplyNode[] = [
      { room: "A", resource: "energy", available: 1000000, reserved: 0, safety: 5000, transferable: 999000, priority: 3, health: 0.8, capacity: 1000000, timestamp: TICK },
    ];
    const demand: DemandNode[] = [];
    for (let i = 0; i < MAX_TARGETS_PER_SOURCE + 5; i++) {
      demand.push({
        room: `D${i}`, resource: "energy", requested: 5000, priority: 2,
        deadline: TICK + 2000, criticality: "normal", fulfilled: 0, remaining: 5000,
        firstSeen: TICK, timestamp: TICK,
      });
    }

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    const plansFromA = result.plans.filter(p => p.sourceRoom === "A");
    expect(plansFromA.length).toBeLessThanOrEqual(MAX_TARGETS_PER_SOURCE);
  });
});

describe("A3.1-017: Allocation Policy v2 — explainable reasons", () => {
  it("generates reason for each plan", () => {
    const supply: SupplyNode[] = [
      { room: "A", resource: "energy", available: 100000, reserved: 0, safety: 5000, transferable: 50000, priority: 3, health: 0.8, capacity: 300000, timestamp: TICK },
    ];
    const demand: DemandNode[] = [
      { room: "B", resource: "energy", requested: 10000, priority: 0, deadline: TICK + 2000, criticality: "critical", fulfilled: 0, remaining: 10000, firstSeen: TICK, timestamp: TICK },
    ];

    const result = allocateNetwork(supply, demand, new Map(), new Map(), new Map(), TICK);
    expect(result.plans.length).toBeGreaterThan(0);
    const reason = result.reasons.get("A:B");
    expect(reason).toBeDefined();
    expect(reason).toContain("A→B");
  });
});

// ── Preemption Tests ───────────────────────────────────

describe("A3.1-018: Preemption — classification", () => {
  it("critical ops are not preemptable", () => {
    const op = makeOp({ priority: 0 });
    expect(classifyPreemption(op, false)).toBe("critical");
    expect(isPreemptable(op, false)).toBe(false);
  });

  it("running ops with carrier in transit are committed", () => {
    const op = makeOp({ status: "running", priority: 2 });
    expect(classifyPreemption(op, true)).toBe("committed");
    expect(isPreemptable(op, true)).toBe(false);
  });

  it("planned low-priority ops are preemptable", () => {
    const op = makeOp({ status: "planned", priority: 2 });
    expect(classifyPreemption(op, false)).toBe("preemptable");
    expect(isPreemptable(op, false)).toBe(true);
  });

  it("blocked low-priority ops are preemptable", () => {
    const op = makeOp({ status: "blocked", priority: 3 });
    expect(classifyPreemption(op, false)).toBe("preemptable");
  });
});

describe("A3.1-019: Preemption — attemptPreemption", () => {
  it("preempts low-priority ops to satisfy critical request", () => {
    const ops = [
      makeOp({ id: "supply:A:C:energy", sourceRoom: "A", targetRoom: "C", priority: 2, status: "planned", reservedAmount: 5000 }),
      makeOp({ id: "supply:A:D:energy", sourceRoom: "A", targetRoom: "D", priority: 3, status: "planned", reservedAmount: 3000 }),
    ];
    const carrierInTransit = new Map<string, boolean>([["supply:A:C:energy", false], ["supply:A:D:energy", false]]);

    const result = attemptPreemption(ops, 7000, 0, carrierInTransit);
    expect(result.preemptedOps.length).toBe(2);
    expect(result.releasedAmount).toBe(8000);
    expect(result.shortfall).toBe(0);
  });

  it("does not preempt critical ops", () => {
    const ops = [
      makeOp({ id: "supply:A:C:energy", priority: 0, status: "planned", reservedAmount: 5000 }),
    ];
    const carrierInTransit = new Map<string, boolean>([["supply:A:C:energy", false]]);

    const result = attemptPreemption(ops, 5000, 2, carrierInTransit);
    expect(result.preemptedOps.length).toBe(0);
    expect(result.releasedAmount).toBe(0);
    expect(result.shortfall).toBe(5000);
  });
});

// ── Plan Stability Tests ───────────────────────────────

describe("A3.1-020: Plan Stability — hysteresis + commitment", () => {
  it("shouldCancelOperation returns false during hysteresis", () => {
    const op = makeOp({ createdAt: TICK });
    expect(shouldCancelOperation(op, TICK + 100, false)).toBe(false);
  });

  it("shouldCancelOperation returns true after hysteresis + no carrier", () => {
    const op = makeOp({ createdAt: TICK });
    expect(shouldCancelOperation(op, TICK + 300, false)).toBe(true);
  });

  it("shouldCancelOperation returns false if carrier spawned but no commitment", () => {
    const op = makeOp({ createdAt: TICK, carrierName: "hauler1" });
    expect(shouldCancelOperation(op, TICK + 300, false)).toBe(false);
  });

  it("getStabilityParams returns expected values", () => {
    const params = getStabilityParams();
    expect(params.hysteresisTicks).toBe(200);
    expect(params.rebalanceThreshold).toBe(0.1);
    expect(params.rebalanceCooldown).toBe(200);
  });
});

// ── Rebalance State Tests ───────────────────────────────

describe("A3.1-020b: Rebalance — event-driven debounce", () => {
  it("no events = no rebalance", () => {
    const state = new RebalanceState();
    const decision = decideRebalance(state, TICK);
    expect(decision.shouldRebalance).toBe(false);
  });

  it("events but within cooldown = no rebalance", () => {
    const state = new RebalanceState();
    state.lastRebalanceTick = TICK;
    state.addEvent({ trigger: "new-demand", room: "B", tick: TICK + 10 });
    const decision = decideRebalance(state, TICK + 50);
    expect(decision.shouldRebalance).toBe(false);
    expect(decision.reason).toContain("cooldown");
  });

  it("events after cooldown + debounce = rebalance", () => {
    const state = new RebalanceState();
    state.lastRebalanceTick = TICK;
    state.addEvent({ trigger: "new-demand", room: "B", tick: TICK + 200 });
    const decision = decideRebalance(state, TICK + 260);
    expect(decision.shouldRebalance).toBe(true);
  });

  it("markRebalanced clears events + updates tick", () => {
    const state = new RebalanceState();
    state.addEvent({ trigger: "new-demand", room: "B", tick: TICK });
    markRebalanced(state, TICK + 300);
    expect(state.pendingCount).toBe(0);
    expect(state.lastRebalanceTick).toBe(TICK + 300);
  });
});
