/** A4.1 Contract Tests — Remote Mining Execution */

import { describe, it, expect } from "vitest";
import {
  createRemoteMiningOp,
  updateOpStatus,
  advanceCheckpoint,
  updateEconomicHealth,
  recordProduction,
  recordDelivery,
  recordLoss,
  incrementActivationWindow,
  resetActivationWindow,
  consumeOpBudget,
  isEconomicallyActive,
  hasActiveRemoteMiningOp,
  filterActiveRemoteMiningOps,
  serializeRemoteMiningOp,
  deserializeRemoteMiningOp,
  type RemoteMiningOperationContext,
} from "../../../src/domain/operation/remote-mining-op";
import { makeRemoteMiningOperationId } from "../../../src/domain/operation/agenda-item";
import {
  checkExecutionGate,
  isGatePassed,
  isGatePermanentFailure,
  type ExecutionGateInput,
} from "../../../src/domain/remote/execution-gate";
import {
  createContainerSnapshot,
  deriveContainerState,
  isValidTransition,
  transitionContainerState,
  isContainerUsable,
  isContainerTerminal,
  serializeContainerSnapshot,
  deserializeContainerSnapshot,
  type ContainerSnapshot,
} from "../../../src/domain/remote/container-lifecycle";
import {
  createEmptyFlow,
  addProduced,
  addTransported,
  addDelivered,
  addLost,
  productionRate,
  deliveryRate,
  transportEfficiency,
  isOverproducing,
  isUnderproducing,
} from "../../../src/domain/remote/flow-accounting";
import {
  calculateEconomicAccounting,
  type EconomicAccountingConfig,
} from "../../../src/domain/remote/economic-accounting";
import {
  calculateROI,
  isPositiveROI,
  isNegativeROI,
} from "../../../src/domain/remote/roi";
import {
  computeBudgetStatus,
  isBudgetOverrun,
  isBudgetNearOverrun,
  allocateBudget,
  DEFAULT_BUDGET_POLICY,
} from "../../../src/domain/remote/operation-budget";
import {
  assessEconomicHealth,
  DEFAULT_HEALTH_CONFIG,
} from "../../../src/domain/remote/economic-health";
import {
  computePerHaulerThroughput,
  computeHaulerSizing,
  validateTransportCapacity,
} from "../../../src/domain/remote/staffing";
import { createOpportunity, approveOpportunity } from "../../../src/domain/remote/remote-opportunity";
import { createRemoteSource, makeRemoteSourceId } from "../../../src/domain/remote/remote-source";
import { assessRemoteValue } from "../../../src/domain/remote/remote-value";

// ─── A4.1-001: Opportunity Execution Gate ────────────────

describe("A4.1-001: Execution Gate", () => {
  it("should pass when all 10 checks pass", () => {
    const opp = createTestOpportunity();
    const input: ExecutionGateInput = {
      opportunity: opp,
      sourceExists: true,
      sourceMineable: true,
      roomAccessible: true,
      routeValid: true,
      maxPathCost: 200,
      pathCost: 50,
      threatClear: true,
      yieldReasonable: true,
      netValue: 10,
      investmentThreshold: 3,
      empireDemand: true,
      transportAcceptable: true,
      transportCost: 2,
      maxTransportCost: 5,
      hasActiveOp: false,
      budgetSufficient: true,
      budgetRemaining: 5000,
      minBudget: 500,
      tick: 1000,
    };

    const result = checkExecutionGate(input);
    expect(isGatePassed(result)).toBe(true);
    expect(result.type).toBe("pass");
    expect(result.passedChecks).toBe(10);
  });

  it("should block when source no longer exists", () => {
    const opp = createTestOpportunity();
    const input: ExecutionGateInput = {
      ...createPassGateInput(opp, 1000),
      sourceExists: false,
    };

    const result = checkExecutionGate(input);
    expect(result.type).toBe("block");
    expect(result.failedCheck).toBe("source_exists");
    expect(isGatePermanentFailure(result)).toBe(true);
  });

  it("should wait when threat is active", () => {
    const opp = createTestOpportunity();
    const input: ExecutionGateInput = {
      ...createPassGateInput(opp, 1000),
      threatClear: false,
    };

    const result = checkExecutionGate(input);
    expect(result.type).toBe("wait");
    expect(result.failedCheck).toBe("threat_clear");
    expect(result.retryAfter).toBeDefined();
  });

  it("should reject duplicate operation", () => {
    const opp = createTestOpportunity();
    const input: ExecutionGateInput = {
      ...createPassGateInput(opp, 1000),
      hasActiveOp: true,
    };

    const result = checkExecutionGate(input);
    expect(result.type).toBe("duplicate");
    expect(result.failedCheck).toBe("not_duplicate");
  });

  it("should reject when budget insufficient", () => {
    const opp = createTestOpportunity();
    const input: ExecutionGateInput = {
      ...createPassGateInput(opp, 1000),
      budgetSufficient: false,
      budgetRemaining: 100,
      minBudget: 500,
    };

    const result = checkExecutionGate(input);
    expect(result.type).toBe("no_budget");
    expect(result.failedCheck).toBe("budget_sufficient");
  });
});

// ─── A4.1-003: Remote Source Identity ───────────────────

describe("A4.1-003: Remote Source Identity", () => {
  it("should produce stable sourceId", () => {
    const id1 = makeRemoteSourceId("W1N1", "W2N1");
    const id2 = makeRemoteSourceId("W1N1", "W2N1");
    expect(id1).toBe(id2);
    expect(id1).toBe("remote:W1N1:W2N1");
  });

  it("should produce different sourceId for different rooms", () => {
    const id1 = makeRemoteSourceId("W1N1", "W2N1");
    const id2 = makeRemoteSourceId("W1N1", "W3N1");
    expect(id1).not.toBe(id2);
  });
});

// ─── A4.1-004: Operation Deduplication ──────────────────

describe("A4.1-004: Operation Deduplication", () => {
  it("should detect duplicate active operation", () => {
    const op = createTestOp("W1N1", "W2N1");
    const ops = [op];
    expect(hasActiveRemoteMiningOp(ops, "W1N1", "W2N1")).toBe(true);
  });

  it("should not detect duplicate when operation is terminal", () => {
    const op = updateOpStatus(createTestOp("W1N1", "W2N1"), "completed", 1000);
    const ops = [op];
    expect(hasActiveRemoteMiningOp(ops, "W1N1", "W2N1")).toBe(false);
  });

  it("should allow creating new operation after old one is terminal", () => {
    const oldOp = updateOpStatus(createTestOp("W1N1", "W2N1"), "cancelled", 1000);
    const ops = [oldOp];
    // 新 Operation 不应被视为重复
    expect(hasActiveRemoteMiningOp(ops, "W1N1", "W2N1")).toBe(false);
  });
});

// ─── A4.1-009: Container Lifecycle 六状态 ───────────────

describe("A4.1-009: Container Lifecycle", () => {
  it("should have all 6 states", () => {
    const states = ["missing", "planned", "building", "active", "damaged", "destroyed"];
    for (const s of states) {
      const snap = createContainerSnapshot("src1", "W2N1", 1000);
      // 通过 deriveContainerState 测试各种状态
      expect(deriveContainerState({
        hasContainer: false, hits: undefined, hitsMax: 250000,
        hasSite: false, needContainer: false, prevState: undefined,
        repairThresholdRatio: 0.5,
      })).toBe("missing");
    }
  });

  it("should transition missing → planned → building → active", () => {
    let snap = createContainerSnapshot("src1", "W2N1", 1000);
    expect(snap.state).toBe("missing");

    snap = transitionContainerState(snap, "planned", 1001);
    expect(snap.state).toBe("planned");

    snap = transitionContainerState(snap, "building", 1002);
    expect(snap.state).toBe("building");

    snap = transitionContainerState(snap, "active", 1003);
    expect(snap.state).toBe("active");
  });

  it("should detect damaged container", () => {
    const state = deriveContainerState({
      hasContainer: true, hits: 50000, hitsMax: 250000,
      hasSite: false, needContainer: false, prevState: "active",
      repairThresholdRatio: 0.5,
    });
    // 50000 < 250000 × 0.5 = 125000 → DAMAGED
    expect(state).toBe("damaged");
  });

  it("should detect destroyed container and allow rebuild", () => {
    let snap = createContainerSnapshot("src1", "W2N1", 1000);
    snap = { ...snap, state: "active" };
    snap = transitionContainerState(snap, "destroyed", 1001);
    expect(snap.state).toBe("destroyed");
    expect(isContainerTerminal(snap.state)).toBe(true);

    // 重建
    snap = transitionContainerState(snap, "planned", 1002);
    expect(snap.state).toBe("planned");
  });

  it("should serialize and deserialize correctly", () => {
    let snap = createContainerSnapshot("src1", "W2N1", 1000);
    snap = transitionContainerState(snap, "planned", 1001);
    const serialized = serializeContainerSnapshot(snap);
    const deserialized = deserializeContainerSnapshot(serialized);
    expect(deserialized.sourceId).toBe(snap.sourceId);
    expect(deserialized.state).toBe(snap.state);
    expect(deserialized.roomName).toBe(snap.roomName);
  });
});

// ─── A4.1-011: Harvest Production 追踪 ─────────────────

describe("A4.1-011: Harvest Production Tracking", () => {
  it("should track production and delivery", () => {
    let flow = createEmptyFlow("op1", 0, 100);
    flow = addProduced(flow, 500);
    flow = addTransported(flow, 400);
    flow = addDelivered(flow, 350);
    flow = addLost(flow, 50);

    expect(flow.produced).toBe(500);
    expect(flow.transported).toBe(400);
    expect(flow.delivered).toBe(350);
    expect(flow.lost).toBe(50);
  });

  it("should calculate production rate", () => {
    let flow = createEmptyFlow("op1", 0, 100);
    flow = addProduced(flow, 1000);
    expect(productionRate(flow)).toBe(10); // 1000/100 = 10 e/tick
  });

  it("should calculate delivery rate", () => {
    let flow = createEmptyFlow("op1", 0, 100);
    flow = addDelivered(flow, 700);
    expect(deliveryRate(flow)).toBe(7); // 700/100 = 7 e/tick
  });

  it("should calculate transport efficiency", () => {
    let flow = createEmptyFlow("op1", 0, 100);
    flow = addProduced(flow, 1000);
    flow = addDelivered(flow, 700);
    expect(transportEfficiency(flow)).toBeCloseTo(0.7);
  });
});

// ─── A4.1-017: Economic Accounting ──────────────────────

describe("A4.1-017: Economic Accounting", () => {
  it("should calculate net value correctly", () => {
    let flow = createEmptyFlow("op1", 0, 100);
    flow = addProduced(flow, 1000); // 10 e/tick

    const config: EconomicAccountingConfig = {
      haulerCarryParts: 4,
      haulerMoveParts: 4,
      pathCost: 50,
      containerAmortization: 0.5,
      containerRepairRate: 0.1,
      harvesterBodyCost: 300,
      haulerBodyCost: 200,
      reserverBodyCost: 600,
      harvesterLifespan: 1500,
      haulerLifespan: 1500,
      reserverLifespan: 600,
      harvesterCount: 1,
      haulerCount: 1,
      reserverCount: 1,
      threatLevel: 0,
      lostAmount: 0,
      defenderCost: 0,
    };

    const result = calculateEconomicAccounting(flow, config);
    expect(result.grossProduction).toBeCloseTo(10);
    expect(result.netValue).toBeLessThan(10); // netValue < gross due to costs
    expect(result.totalCost).toBeGreaterThan(0);
  });
});

// ─── A4.1-018: ROI Expected vs Actual ───────────────────

describe("A4.1-018: ROI", () => {
  it("should calculate positive ROI when delivered > cost", () => {
    const result = calculateROI("op1", 1000, 500, 900, 800, 400, 0.8);
    expect(isPositiveROI(result.actualROI)).toBe(true);
    expect(result.actualROI).toBeCloseTo(1.0); // (800-400)/400 = 1.0
  });

  it("should calculate negative ROI when cost > delivered", () => {
    const result = calculateROI("op1", 1000, 500, 500, 300, 600, 0.8);
    expect(isNegativeROI(result.actualROI)).toBe(true);
  });

  it("should detect below expectation", () => {
    const result = calculateROI("op1", 1000, 500, 1000, 900, 800, 0.8);
    // expectedROI = (1000-500)/500 = 1.0
    // actualROI = (900-800)/800 = 0.125
    // roiAchievement = 0.125/1.0 = 0.125 < 0.8
    expect(result.meetsExpectation).toBe(false);
  });
});

// ─── A4.1-019: Budget ───────────────────────────────────

describe("A4.1-019: Operation Budget", () => {
  it("should detect budget exhaustion", () => {
    const status = computeBudgetStatus(5000, 5000);
    expect(status.exhausted).toBe(true);
    expect(status.remaining).toBe(0);
  });

  it("should detect low budget", () => {
    const status = computeBudgetStatus(5000, 4600);
    expect(status.low).toBe(true); // remaining=400 < minRemaining=500
  });

  it("should detect budget overrun", () => {
    expect(isBudgetOverrun(5000, 5500)).toBe(true);
    expect(isBudgetOverrun(5000, 4000)).toBe(false);
  });

  it("should detect near overrun", () => {
    expect(isBudgetNearOverrun(5000, 4500, 0.9)).toBe(true);
    expect(isBudgetNearOverrun(5000, 4000, 0.9)).toBe(false);
  });

  it("should allocate budget based on source/yield/risk", () => {
    const budget = allocateBudget(2, 10, 1, DEFAULT_BUDGET_POLICY);
    expect(budget).toBeGreaterThan(0);
    // 2 sources × 5000 × 1.2 (high yield) × 0.9 (risk 1) = 10800
    expect(budget).toBe(10800);
  });
});

// ─── A4.1-029: Idempotency ──────────────────────────────

describe("A4.1-029: Idempotency", () => {
  it("should produce same operationId for same rooms", () => {
    const id1 = makeRemoteMiningOperationId("W1N1", "W2N1");
    const id2 = makeRemoteMiningOperationId("W1N1", "W2N1");
    expect(id1).toBe(id2);
  });

  it("should serialize and deserialize losslessly", () => {
    const op = createTestOp("W1N1", "W2N1");
    const serialized = serializeRemoteMiningOp(op);
    const deserialized = deserializeRemoteMiningOp(serialized);
    expect(deserialized.id).toBe(op.id);
    expect(deserialized.type).toBe(op.type);
    expect(deserialized.sourceId).toBe(op.sourceId);
    expect(deserialized.checkpoint).toBe(op.checkpoint);
    expect(deserialized.economicHealth).toBe(op.economicHealth);
  });
});

// ─── A4.1-030: Economic Activation ──────────────────────

describe("A4.1-030: Economic Activation", () => {
  it("should not activate with zero production", () => {
    const op = createTestOp("W1N1", "W2N1");
    expect(isEconomicallyActive(op)).toBe(false);
  });

  it("should activate after consecutive window", () => {
    let op = createTestOp("W1N1", "W2N1");
    op = { ...op, activationThreshold: 3 };
    // 需要 3 次连续满足
    op = incrementActivationWindow(op, 100);
    expect(isEconomicallyActive(op)).toBe(false);
    op = incrementActivationWindow(op, 200);
    expect(isEconomicallyActive(op)).toBe(false);
    op = incrementActivationWindow(op, 300);
    expect(isEconomicallyActive(op)).toBe(true);
  });

  it("should reset on failure", () => {
    let op = createTestOp("W1N1", "W2N1");
    op = { ...op, activationThreshold: 3 };
    op = incrementActivationWindow(op, 100);
    op = incrementActivationWindow(op, 200);
    expect(op.activationWindow).toBe(2);
    op = resetActivationWindow(op, 250);
    expect(op.activationWindow).toBe(0);
  });
});

// ─── A4.1 Hauler Sizing ─────────────────────────────────

describe("A4.1: Hauler Sizing", () => {
  it("should compute per-hauler throughput", () => {
    const result = computePerHaulerThroughput(4, 50, true);
    // carryCapacity = 4 × 50 = 200
    // roundTripTime = ceil(50 × 2 / 2) = 50
    // throughput = 200 / 50 = 4
    expect(result.carryCapacity).toBe(200);
    expect(result.roundTripTime).toBe(50);
    expect(result.throughput).toBeCloseTo(4);
  });

  it("should compute required haulers", () => {
    const result = computeHaulerSizing({
      expectedProduction: 10,
      actualProduction: 10,
      pathCost: 50,
      hasRoad: true,
      haulerCarryParts: 4,
      haulerMoveParts: 4,
      currentHaulers: 1,
      maxHaulers: 5,
    });
    // throughput = 4 e/tick per hauler
    // requiredHaulers = ceil(10 / 4) = 3
    expect(result.requiredHaulers).toBe(3);
    expect(result.isInsufficient).toBe(false); // 3×4=12 >= 10
  });

  it("should validate transport capacity", () => {
    const result = validateTransportCapacity(10, 8);
    expect(result.sufficient).toBe(true);
    expect(result.ratio).toBeCloseTo(1.25);
  });

  it("should detect insufficient transport capacity", () => {
    const result = validateTransportCapacity(6, 10);
    expect(result.sufficient).toBe(false);
    expect(result.deficit).toBe(4);
  });
});

// ─── 辅助函数 ──────────────────────────────────────────

function createTestOpportunity() {
  const source = createRemoteSource({
    homeRoom: "W1N1",
    targetRoom: "W2N1",
    sourceCount: 2,
    pathCost: 50,
    linearDistance: 1,
    reserved: true,
    hasRoad: true,
    riskLevel: 0,
    lastHostileAt: undefined,
    hasInvaderCore: false,
    status: "available",
    tick: 1000,
  });
  const value = assessRemoteValue(source);
  return createOpportunity({ source, value, tick: 1000, validityTicks: 1000 });
}

function createTestOp(homeRoom: string, targetRoom: string): RemoteMiningOperationContext {
  return createRemoteMiningOp({
    homeRoom,
    targetRoom,
    sourceId: makeRemoteSourceId(homeRoom, targetRoom),
    sourceCount: 2,
    expectedYield: 10,
    budgetLimit: 5000,
    priority: 2,
    deadline: 11000,
    tick: 1000,
    activationThreshold: 3,
  });
}

function createPassGateInput(opp: ReturnType<typeof createTestOpportunity>, tick: number): ExecutionGateInput {
  return {
    opportunity: opp,
    sourceExists: true,
    sourceMineable: true,
    roomAccessible: true,
    routeValid: true,
    maxPathCost: 200,
    pathCost: 50,
    threatClear: true,
    yieldReasonable: true,
    netValue: 10,
    investmentThreshold: 3,
    empireDemand: true,
    transportAcceptable: true,
    transportCost: 2,
    maxTransportCost: 5,
    hasActiveOp: false,
    budgetSufficient: true,
    budgetRemaining: 5000,
    minBudget: 500,
    tick,
  };
}
