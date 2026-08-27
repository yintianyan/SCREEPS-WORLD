/** A3.3 Contract Tests — Expansion Execution 全链路合约测试。 */

import { describe, it, expect } from "vitest";
import {
  validateExecutionGate,
  type ExecutionGateInput,
  type ExecutionGateResult,
} from "../../../src/domain/expansion/execution-gate";
import {
  transitionExecutionState,
  isValidTransition,
  getExecutionProgress,
  describeExecutionState,
  type ExecutionState,
  type StateTransitionInput,
} from "../../../src/domain/expansion/execution-state";
import {
  evaluateCheckpoint,
  createCheckpointRecord,
  createAllCheckpointRecords,
  getCheckpointProgress,
  getNextPendingCheckpoint,
  getPassedCount,
  type CheckpointId,
  type CheckpointInput,
} from "../../../src/domain/expansion/checkpoint";
import {
  evaluateEconomicActivation,
  needsExternalSupport,
  calculateRequiredSupport,
  type EconomicActivationInput,
} from "../../../src/domain/expansion/economic-activation";
import {
  evaluateEmpireIntegration,
  canHandover,
  type EmpireIntegrationInput,
} from "../../../src/domain/expansion/empire-integration";
import {
  evaluateThreatEscalation,
  type ThreatEscalationInput,
} from "../../../src/domain/expansion/threat-escalation";
import {
  tryReserve,
  releaseReservation,
  consumeReservation,
  isReservationExpired,
  cleanupExpiredReservations,
  getTotalReserved,
  type ResourceReservation,
} from "../../../src/domain/expansion/resource-reservation";
import {
  createExpansionOperation,
  updateOperation,
  completeStep,
  isOperationComplete,
  completeOperation,
  failOperation,
  activateOperation,
  createColonizeFromClaim,
  type ExpansionOperation,
} from "../../../src/domain/expansion/execution-operation";
import {
  buildExecutionDashboard,
  type ExecutionDashboard,
} from "../../../src/domain/expansion/execution-dashboard";
import type { ExpansionPlan } from "../../../src/domain/expansion/plan";
import type { TieredExpansionBudget } from "../../../src/domain/expansion/budget";

// ─── 测试辅助 ──────────────────────────────────────────

function makePlan(over: Partial<ExpansionPlan> = {}): ExpansionPlan {
  return {
    planId: "W5N5@1000",
    roomName: "W5N5",
    sponsorRoom: "W1N1",
    reason: "resource",
    priority: "P1",
    candidateScore: 0.75,
    cost: {
      roomName: "W5N5",
      totalCost: 5000,
      claimerCost: 650,
      pioneerCost: 1000,
      spawnCost: 5000,
      travelCost: 200,
      infrastructureCost: 500,
      bootstrapEnergy: 3000,
      evidence: "",
    },
    payback: {
      roomName: "W5N5",
      totalCost: 5000,
      expectedIncomePerTick: 10,
      paybackTicks: 500,
      roi: 2.0,
      worthwhile: true,
      evidence: "",
    },
    risk: {
      roomName: "W5N5",
      score: 0.3,
      level: "LOW",
      dimensions: { economic: 0.2, operational: 0.1, distance: 0.3, recovery: 0.2, defense: 0.1 },
      evidence: "",
    },
    candidate: {
      roomName: "W5N5",
      sponsorRoom: "W1N1",
      kind: "normal",
      roomStatus: "normal",
      sourceCount: 2,
      mineral: "H",
      terrain: { exitCount: 3, sealedExitCount: 1, wallCount: 0 },
      controller: { hasOwner: false, isMine: false, isHostileReserved: false },
      pathCost: 100,
      lastSeen: 1000,
      distance: 1,
      neighborRooms: ["W4N5", "W6N5"],
      score: 0.75,
      status: "QUALIFIED",
      discoveredAt: 1000,
    },
    status: "WAITING_EXECUTION",
    createdAt: 1000,
    updatedAt: 1000,
    cancelConditions: [],
    dependencies: [],
    explanation: "test plan",
    ...over,
  };
}

function makeBudget(over: Partial<TieredExpansionBudget> = {}): TieredExpansionBudget {
  return {
    totalEnergy: 50000,
    emergencyReserve: 10000,
    coreReserve: 5000,
    operationalReserve: 12000,
    availableExpansion: 23000,
    tick: 1000,
    coreInvaded: false,
    evidence: "",
    ...over,
  };
}

function makeGateInput(over: Partial<ExecutionGateInput> = {}): ExecutionGateInput {
  return {
    plan: makePlan(),
    budget: makeBudget(),
    isEmpireReady: true,
    alreadyOwned: false,
    hasConcurrentOp: false,
    hasOtherExpansion: false,
    intelStale: false,
    threatEscalated: false,
    targetClaimable: true,
    candidateValid: true,
    ...over,
  };
}

function makeTransitionInput(over: Partial<StateTransitionInput> = {}): StateTransitionInput {
  return {
    currentState: "VALIDATING",
    plan: makePlan(),
    tick: 1000,
    ...over,
  };
}

function makeCheckpointInput(over: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    checkpointId: "CP1_CLAIMED",
    controllerClaimed: true,
    spawnBuilt: true,
    spawnCanSpawn: true,
    harvesterActive: true,
    transporterActive: true,
    extensionsBuilt: true,
    containerBuilt: true,
    roadsBuilt: true,
    netEnergyFlowPositive: true,
    empireIntegrated: true,
    tick: 1000,
    retryCount: 0,
    ...over,
  };
}

function makeEconomicInput(over: Partial<EconomicActivationInput> = {}): EconomicActivationInput {
  return {
    energyProduction: 20,
    energyConsumption: 10,
    externalEnergyInflow: 0,
    consecutivePositiveTicks: 500,
    hasHarvester: true,
    hasTransporter: true,
    hasUpgrader: false,
    spawnActive: true,
    tick: 1000,
    ...over,
  };
}

function makeIntegrationInput(over: Partial<EmpireIntegrationInput> = {}): EmpireIntegrationInput {
  return {
    inOwnedRoomsList: true,
    hasSnapshot: true,
    inEconomyStats: true,
    spawnManaged: true,
    defenseCovered: true,
    hasVersionedLayout: true,
    tick: 1000,
    ...over,
  };
}

function makeThreatInput(over: Partial<ThreatEscalationInput> = {}): ThreatEscalationInput {
  return {
    hasHostileCreep: false,
    hasHostileReservation: false,
    hasPathThreat: false,
    sponsorUnderAttack: false,
    hasHostileTower: false,
    executionState: "VALIDATING",
    tick: 1000,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Execution Gate — 11 项 TOCTOU 验证
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Execution Gate", () => {
  it("passes all 11 gates when everything valid", () => {
    const result = validateExecutionGate(makeGateInput());
    expect(result.allPassed).toBe(true);
    expect(result.failedGates).toHaveLength(0);
    expect(result.gates).toHaveLength(11);
    expect(result.evidence).toContain("all 11 gates passed");
  });

  it("fails GATE_PLAN_VALID when status is not WAITING_EXECUTION", () => {
    const result = validateExecutionGate(makeGateInput({
      plan: makePlan({ status: "CANCELLED" }),
    }));
    expect(result.allPassed).toBe(false);
    expect(result.failedGates).toContain("GATE_PLAN_VALID");
  });

  it("fails GATE_BUDGET_SUFFICIENT when budget < cost", () => {
    const result = validateExecutionGate(makeGateInput({
      budget: makeBudget({ availableExpansion: 1000 }),
    }));
    expect(result.failedGates).toContain("GATE_BUDGET_SUFFICIENT");
    expect(result.allPassed).toBe(false);
  });

  it("fails GATE_CORE_SAFE when core invaded", () => {
    const result = validateExecutionGate(makeGateInput({
      budget: makeBudget({ coreInvaded: true }),
    }));
    expect(result.failedGates).toContain("GATE_CORE_SAFE");
  });

  it("fails GATE_NOT_OWNED when already owned", () => {
    const result = validateExecutionGate(makeGateInput({ alreadyOwned: true }));
    expect(result.failedGates).toContain("GATE_NOT_OWNED");
  });

  it("fails GATE_NO_OTHER_EXPANSION when concurrent expansion exists", () => {
    const result = validateExecutionGate(makeGateInput({ hasOtherExpansion: true }));
    expect(result.failedGates).toContain("GATE_NO_OTHER_EXPANSION");
  });

  it("fails GATE_INTEL_FRESH when intel stale", () => {
    const result = validateExecutionGate(makeGateInput({ intelStale: true }));
    expect(result.failedGates).toContain("GATE_INTEL_FRESH");
  });

  it("fails GATE_THREAT_UNCHANGED when threat escalated", () => {
    const result = validateExecutionGate(makeGateInput({ threatEscalated: true }));
    expect(result.failedGates).toContain("GATE_THREAT_UNCHANGED");
  });

  it("records multiple failures with evidence string", () => {
    const result = validateExecutionGate(makeGateInput({
      alreadyOwned: true,
      intelStale: true,
      threatEscalated: true,
    }));
    expect(result.failedGates).toHaveLength(3);
    expect(result.evidence).toContain("GATE_NOT_OWNED");
    expect(result.evidence).toContain("GATE_INTEL_FRESH");
    expect(result.evidence).toContain("GATE_THREAT_UNCHANGED");
  });

  it("each gate has condition description", () => {
    const result = validateExecutionGate(makeGateInput());
    for (const g of result.gates) {
      expect(g.condition).toBeTruthy();
      expect(g.value).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Execution State Machine — 状态转换
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Execution State Machine", () => {
  it("VALIDATING → PREPARING when gate passed", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "VALIDATING",
      gatePassed: true,
    }));
    expect(r.transitioned).toBe(true);
    expect(r.newState).toBe("PREPARING");
  });

  it("VALIDATING → FAILED when gate failed", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "VALIDATING",
      gatePassed: false,
    }));
    expect(r.newState).toBe("FAILED");
  });

  it("PREPARING → CLAIMING when resources + claimer ready", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "PREPARING",
      resourcesReserved: true,
      claimerCreated: true,
    }));
    expect(r.newState).toBe("CLAIMING");
  });

  it("PREPARING stays PREPARING when not ready", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "PREPARING",
      resourcesReserved: false,
      claimerCreated: false,
    }));
    expect(r.transitioned).toBe(false);
    expect(r.newState).toBe("PREPARING");
  });

  it("CLAIMING → CLAIMED when controller claimed", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "CLAIMING",
      controllerClaimed: true,
    }));
    expect(r.newState).toBe("CLAIMED");
    expect(r.transitioned).toBe(true);
    expect(r.reason).toContain("controller claimed");
  });

  it("BOOTSTRAPPING → ECONOMIC_STARTUP when spawn + pioneer ready", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "BOOTSTRAPPING",
      spawnBuilt: true,
      pioneerArrived: true,
    }));
    expect(r.newState).toBe("ECONOMIC_STARTUP");
  });

  it("ECONOMIC_STARTUP → INTEGRATING when energy loop + infra complete", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "ECONOMIC_STARTUP",
      energyLoopActive: true,
      basicInfraComplete: true,
    }));
    expect(r.newState).toBe("INTEGRATING");
  });

  it("INTEGRATING → COMPLETED when activated + integrated", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "INTEGRATING",
      economicallyActivated: true,
      empireIntegrated: true,
    }));
    expect(r.newState).toBe("COMPLETED");
    expect(r.metadata?.checkpoint).toBe("EconomicActivation");
  });

  it("FAILED → REPLANNING by default", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "FAILED",
    }));
    expect(r.newState).toBe("REPLANNING");
  });

  it("REPLANNING → VALIDATING", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "REPLANNING",
    }));
    expect(r.newState).toBe("VALIDATING");
  });

  it("COMPLETED is terminal", () => {
    const r = transitionExecutionState(makeTransitionInput({
      currentState: "COMPLETED",
    }));
    expect(r.transitioned).toBe(false);
    expect(r.newState).toBe("COMPLETED");
  });

  it("isValidTransition respects transition table", () => {
    expect(isValidTransition("VALIDATING", "PREPARING")).toBe(true);
    expect(isValidTransition("VALIDATING", "COMPLETED")).toBe(false);
    expect(isValidTransition("COMPLETED", "VALIDATING")).toBe(false);
    expect(isValidTransition("FAILED", "REPLANNING")).toBe(true);
  });

  it("getExecutionProgress returns increasing percentages", () => {
    expect(getExecutionProgress("VALIDATING")).toBe(0);
    expect(getExecutionProgress("PREPARING")).toBe(10);
    expect(getExecutionProgress("CLAIMING")).toBe(20);
    expect(getExecutionProgress("CLAIMED")).toBe(30);
    expect(getExecutionProgress("BOOTSTRAPPING")).toBe(45);
    expect(getExecutionProgress("ECONOMIC_STARTUP")).toBe(65);
    expect(getExecutionProgress("INTEGRATING")).toBe(85);
    expect(getExecutionProgress("COMPLETED")).toBe(100);
  });

  it("describeExecutionState returns human-readable description", () => {
    expect(describeExecutionState("VALIDATING")).toContain("Validating");
    expect(describeExecutionState("COMPLETED")).toContain("Autonomous");
    expect(describeExecutionState("FAILED")).toContain("failed");
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Checkpoint System — 5 个检查点
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Checkpoint System", () => {
  it("CP1_CLAIMED passes when controller claimed", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP1_CLAIMED",
      controllerClaimed: true,
    }));
    expect(r.passed).toBe(true);
    expect(r.status).toBe("PASSED");
  });

  it("CP1_CLAIMED fails when controller not claimed", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP1_CLAIMED",
      controllerClaimed: false,
    }));
    expect(r.passed).toBe(false);
    expect(r.failReason).toContain("not claimed");
  });

  it("CP2_SPAWN_ACTIVE passes when spawn built + can spawn", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP2_SPAWN_ACTIVE",
      spawnBuilt: true,
      spawnCanSpawn: true,
    }));
    expect(r.passed).toBe(true);
  });

  it("CP2_SPAWN_ACTIVE fails when spawn has no energy", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP2_SPAWN_ACTIVE",
      spawnBuilt: true,
      spawnCanSpawn: false,
    }));
    expect(r.passed).toBe(false);
    expect(r.failReason).toContain("no energy");
  });

  it("CP3_ENERGY_LOOP requires harvester + transporter + spawn", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP3_ENERGY_LOOP",
      harvesterActive: true,
      transporterActive: true,
      spawnCanSpawn: true,
    }));
    expect(r.passed).toBe(true);

    const r2 = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP3_ENERGY_LOOP",
      harvesterActive: false,
      transporterActive: true,
      spawnCanSpawn: true,
    }));
    expect(r2.passed).toBe(false);
    expect(r2.failReason).toContain("harvester");
  });

  it("CP4_BASIC_INFRA requires extensions + container", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP4_BASIC_INFRA",
      extensionsBuilt: true,
      containerBuilt: true,
    }));
    expect(r.passed).toBe(true);

    const r2 = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP4_BASIC_INFRA",
      extensionsBuilt: false,
      containerBuilt: true,
    }));
    expect(r2.passed).toBe(false);
    expect(r2.failReason).toContain("extensions");
  });

  it("CP5_ECONOMIC_ACTIVATION requires net positive + integrated", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP5_ECONOMIC_ACTIVATION",
      netEnergyFlowPositive: true,
      empireIntegrated: true,
    }));
    expect(r.passed).toBe(true);

    const r2 = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP5_ECONOMIC_ACTIVATION",
      netEnergyFlowPositive: false,
      empireIntegrated: true,
    }));
    expect(r2.passed).toBe(false);
    expect(r2.failReason).toContain("energy flow");
  });

  it("shouldRetry is true when retries < maxRetries", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP2_SPAWN_ACTIVE",
      spawnBuilt: false,
      retryCount: 0,
    }));
    expect(r.shouldRetry).toBe(true);
  });

  it("shouldRetry is false when retries >= maxRetries", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP1_CLAIMED",
      controllerClaimed: false,
      retryCount: 1, // maxRetries=1 for CP1
    }));
    expect(r.shouldRetry).toBe(false);
    expect(r.status).toBe("FAILED");
  });

  it("fallbackTo is set when checkpoint fails permanently", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP3_ENERGY_LOOP",
      harvesterActive: false,
      transporterActive: false,
      spawnCanSpawn: false,
      retryCount: 5, // maxRetries=5
    }));
    expect(r.shouldRetry).toBe(false);
    expect(r.fallbackTo).toBe("CP2_SPAWN_ACTIVE");
  });

  it("createAllCheckpointRecords returns 5 records", () => {
    const records = createAllCheckpointRecords();
    expect(records).toHaveLength(5);
    expect(records.map(r => r.id)).toEqual([
      "CP1_CLAIMED", "CP2_SPAWN_ACTIVE", "CP3_ENERGY_LOOP",
      "CP4_BASIC_INFRA", "CP5_ECONOMIC_ACTIVATION",
    ]);
  });

  it("getCheckpointProgress calculates percentage", () => {
    expect(getCheckpointProgress(0)).toBe(0);
    expect(getCheckpointProgress(3)).toBe(60);
    expect(getCheckpointProgress(5)).toBe(100);
  });

  it("getNextPendingCheckpoint finds first non-PASSED", () => {
    const records = createAllCheckpointRecords();
    records[0]!.status = "PASSED";
    records[1]!.status = "PASSED";
    const next = getNextPendingCheckpoint(records);
    expect(next?.id).toBe("CP3_ENERGY_LOOP");
  });

  it("getPassedCount counts PASSED records", () => {
    const records = createAllCheckpointRecords();
    records[0]!.status = "PASSED";
    records[2]!.status = "PASSED";
    expect(getPassedCount(records)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Economic Activation — 三段判据
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Economic Activation", () => {
  it("activates when all criteria met + 500 consecutive ticks", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      consecutivePositiveTicks: 500,
    }));
    expect(r.activated).toBe(true);
    expect(r.ticksToActivation).toBe(0);
    expect(r.progress).toBe(100);
  });

  it("does not activate when consecutive ticks < 500", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      consecutivePositiveTicks: 499,
    }));
    expect(r.activated).toBe(false);
    expect(r.ticksToActivation).toBe(1);
  });

  it("does not activate when energy loop inactive", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      hasHarvester: false,
    }));
    expect(r.activated).toBe(false);
    expect(r.criteria.energyLoop.passed).toBe(false);
  });

  it("does not activate when net flow negative", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      energyProduction: 5,
      energyConsumption: 10,
    }));
    expect(r.activated).toBe(false);
    expect(r.criteria.netPositive.passed).toBe(false);
    expect(r.netFlow).toBe(-5);
  });

  it("does not activate when still receiving external support", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      externalEnergyInflow: 50,
    }));
    expect(r.activated).toBe(false);
    expect(r.criteria.selfSustaining.passed).toBe(false);
  });

  it("progress increases with consecutive positive ticks", () => {
    const r0 = evaluateEconomicActivation(makeEconomicInput({
      consecutivePositiveTicks: 0,
      externalEnergyInflow: 50, // not self-sustaining
    }));
    const r250 = evaluateEconomicActivation(makeEconomicInput({
      consecutivePositiveTicks: 250,
      externalEnergyInflow: 50,
    }));
    expect(r250.progress).toBeGreaterThan(r0.progress);
  });

  it("needsExternalSupport returns true when net flow negative", () => {
    expect(needsExternalSupport(makeEconomicInput({
      energyProduction: 5,
      energyConsumption: 10,
    }))).toBe(true);
  });

  it("needsExternalSupport returns true when receiving external inflow", () => {
    expect(needsExternalSupport(makeEconomicInput({
      externalEnergyInflow: 50,
    }))).toBe(true);
  });

  it("calculateRequiredSupport returns deficit + buffer", () => {
    const support = calculateRequiredSupport(makeEconomicInput({
      energyProduction: 5,
      energyConsumption: 10,
    }));
    expect(support).toBe(55); // |5-10|=5 + 50 buffer
  });

  it("calculateRequiredSupport returns 0 when net positive", () => {
    const support = calculateRequiredSupport(makeEconomicInput());
    expect(support).toBe(0);
  });

  it("evidence string contains all key metrics", () => {
    const r = evaluateEconomicActivation(makeEconomicInput());
    expect(r.evidence).toContain("netFlow=");
    expect(r.evidence).toContain("energyLoop=");
    expect(r.evidence).toContain("selfSustaining=");
    expect(r.evidence).toContain("consecutivePositive=");
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Empire Integration — 5 系统覆盖
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Empire Integration", () => {
  it("integrates when all 5 systems covered + in owned list", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput());
    expect(r.integrated).toBe(true);
    expect(r.missingSystems).toHaveLength(0);
    expect(r.progress).toBe(100);
  });

  it("not integrated when not in owned rooms list", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput({
      inOwnedRoomsList: false,
    }));
    expect(r.integrated).toBe(false);
  });

  it("not integrated when snapshot missing", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput({
      hasSnapshot: false,
    }));
    expect(r.integrated).toBe(false);
    expect(r.missingSystems).toContain("RoomSnapshot");
  });

  it("not integrated when economy stats missing", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput({
      inEconomyStats: false,
    }));
    expect(r.integrated).toBe(false);
    expect(r.missingSystems).toContain("EconomyStats");
  });

  it("not integrated when spawn not managed", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput({
      spawnManaged: false,
    }));
    expect(r.missingSystems).toContain("SpawnManager");
  });

  it("not integrated when defense not covered", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput({
      defenseCovered: false,
    }));
    expect(r.missingSystems).toContain("DefenseSystem");
  });

  it("not integrated when layout missing", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput({
      hasVersionedLayout: false,
    }));
    expect(r.missingSystems).toContain("LayoutPlanner");
  });

  it("progress reflects partial integration", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput({
      hasSnapshot: false,
      defenseCovered: false,
    }));
    expect(r.progress).toBe(60); // 3/5 = 60%
  });

  it("canHandover requires both integration + economic activation", () => {
    const integration = evaluateEmpireIntegration(makeIntegrationInput());
    expect(canHandover(integration, true)).toBe(true);
    expect(canHandover(integration, false)).toBe(false);
  });

  it("evidence contains system status", () => {
    const r = evaluateEmpireIntegration(makeIntegrationInput());
    expect(r.evidence).toContain("snapshot=true");
    expect(r.evidence).toContain("economy=true");
    expect(r.evidence).toContain("INTEGRATED");
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Threat Escalation — 三级威胁
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Threat Escalation", () => {
  it("GREEN when no threats → CONTINUE", () => {
    const r = evaluateThreatEscalation(makeThreatInput());
    expect(r.level).toBe("GREEN");
    expect(r.action).toBe("CONTINUE");
    expect(r.shouldPause).toBe(false);
    expect(r.shouldAbort).toBe(false);
  });

  it("RED when hostile creep in target → ABORT (pre-claim)", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      hasHostileCreep: true,
      executionState: "PREPARING",
    }));
    expect(r.level).toBe("RED");
    expect(r.action).toBe("ABORT");
    expect(r.shouldAbort).toBe(true);
  });

  it("RED when hostile tower → ABORT (pre-claim)", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      hasHostileTower: true,
      executionState: "CLAIMING",
    }));
    expect(r.level).toBe("RED");
    expect(r.action).toBe("ABORT");
  });

  it("RED when sponsor under attack → ABORT", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      sponsorUnderAttack: true,
    }));
    expect(r.level).toBe("RED");
    expect(r.shouldAbort).toBe(true);
  });

  it("RED + post-claim → EVACUATE (protect investment)", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      hasHostileCreep: true,
      executionState: "BOOTSTRAPPING",
    }));
    expect(r.level).toBe("RED");
    expect(r.action).toBe("EVACUATE");
  });

  it("YELLOW when hostile reservation → PAUSE (pre-claim)", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      hasHostileReservation: true,
      executionState: "PREPARING",
    }));
    expect(r.level).toBe("YELLOW");
    expect(r.action).toBe("PAUSE");
    expect(r.shouldPause).toBe(true);
  });

  it("YELLOW + post-claim → CONTINUE (stay vigilant)", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      hasHostileReservation: true,
      executionState: "CLAIMED",
    }));
    expect(r.level).toBe("YELLOW");
    expect(r.action).toBe("CONTINUE");
    expect(r.shouldPause).toBe(false);
  });

  it("YELLOW when path threat → PAUSE", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      hasPathThreat: true,
      executionState: "VALIDATING",
    }));
    expect(r.level).toBe("YELLOW");
    expect(r.action).toBe("PAUSE");
  });

  it("summary contains threat level + action", () => {
    const r = evaluateThreatEscalation(makeThreatInput({
      hasHostileCreep: true,
      executionState: "CLAIMING",
    }));
    expect(r.summary).toContain("RED");
    expect(r.summary).toContain("ABORT");
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Resource Reservation
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Resource Reservation", () => {
  it("reserves when budget sufficient", () => {
    const r = tryReserve({
      planId: "p1", energyNeeded: 5000,
      availableExpansionBudget: 10000, tick: 1000,
    });
    expect(r.success).toBe(true);
    expect(r.reservation?.reservedEnergy).toBe(5000);
    expect(r.reservation?.status).toBe("RESERVED");
    expect(r.remainingBudget).toBe(5000);
  });

  it("fails when budget insufficient", () => {
    const r = tryReserve({
      planId: "p1", energyNeeded: 15000,
      availableExpansionBudget: 10000, tick: 1000,
    });
    expect(r.success).toBe(false);
    expect(r.failReason).toContain("insufficient");
    expect(r.remainingBudget).toBe(10000);
  });

  it("releaseReservation sets status + reason", () => {
    const reserved = tryReserve({
      planId: "p1", energyNeeded: 5000,
      availableExpansionBudget: 10000, tick: 1000,
    }).reservation!;
    const released = releaseReservation(reserved, 2000, "abort");
    expect(released.status).toBe("RELEASED");
    expect(released.releasedAt).toBe(2000);
    expect(released.releaseReason).toBe("abort");
  });

  it("consumeReservation sets CONSUMED", () => {
    const reserved = tryReserve({
      planId: "p1", energyNeeded: 5000,
      availableExpansionBudget: 10000, tick: 1000,
    }).reservation!;
    const consumed = consumeReservation(reserved, 1500);
    expect(consumed.status).toBe("CONSUMED");
    expect(consumed.consumedAt).toBe(1500);
  });

  it("isReservationExpired detects old reservations", () => {
    const reserved = tryReserve({
      planId: "p1", energyNeeded: 5000,
      availableExpansionBudget: 10000, tick: 1000,
    }).reservation!;
    expect(isReservationExpired(reserved, 3500, 2000)).toBe(true);
    expect(isReservationExpired(reserved, 2500, 2000)).toBe(false);
  });

  it("isReservationExpired ignores non-RESERVED", () => {
    const released = releaseReservation(
      tryReserve({
        planId: "p1", energyNeeded: 5000,
        availableExpansionBudget: 10000, tick: 1000,
      }).reservation!,
      2000, "test",
    );
    expect(isReservationExpired(released, 99999, 1)).toBe(false);
  });

  it("cleanupExpiredReservations partitions active vs expired", () => {
    const r1 = tryReserve({ planId: "p1", energyNeeded: 1000, availableExpansionBudget: 5000, tick: 1000 }).reservation!;
    const r2 = tryReserve({ planId: "p2", energyNeeded: 2000, availableExpansionBudget: 5000, tick: 1000 }).reservation!;
    // tick=1500: 1500-1000=500 < 2000 → not expired
    const { active, expired } = cleanupExpiredReservations([r1, r2], 1500, 2000);
    expect(active).toHaveLength(2);
    expect(expired).toHaveLength(0);

    // tick=5001: 5001-1000=4001 > 2000 → expired
    const { active: a2, expired: e2 } = cleanupExpiredReservations([r1, r2], 5001, 2000);
    expect(a2).toHaveLength(0);
    expect(e2).toHaveLength(2);
  });

  it("getTotalReserved sums only RESERVED", () => {
    const r1 = tryReserve({ planId: "p1", energyNeeded: 1000, availableExpansionBudget: 5000, tick: 1000 }).reservation!;
    const r2 = tryReserve({ planId: "p2", energyNeeded: 2000, availableExpansionBudget: 5000, tick: 1000 }).reservation!;
    const released = releaseReservation(r2, 1001, "test");
    expect(getTotalReserved([r1, released])).toBe(1000);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Execution Operation
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Execution Operation", () => {
  it("creates claim operation with correct criteria", () => {
    const op = createExpansionOperation({
      plan: makePlan(),
      type: "claim",
      tick: 1000,
      reservedEnergy: 5000,
    });
    expect(op.operationId).toBe("op-claim-W5N5@1000");
    expect(op.type).toBe("claim");
    expect(op.status).toBe("PENDING");
    expect(op.executionState).toBe("VALIDATING");
    expect(op.completionCriteria).toContain("claimController() succeeded");
    expect(op.reservedEnergy).toBe(5000);
  });

  it("creates colonize operation with longer criteria", () => {
    const op = createExpansionOperation({
      plan: makePlan(),
      type: "colonize",
      tick: 1000,
      reservedEnergy: 10000,
    });
    expect(op.type).toBe("colonize");
    expect(op.completionCriteria).toContain("economic activation achieved");
    expect(op.completionCriteria).toContain("empire integration complete");
  });

  it("updateOperation applies updates immutably", () => {
    const op = createExpansionOperation({
      plan: makePlan(), type: "claim", tick: 1000, reservedEnergy: 5000,
    });
    const updated = updateOperation(op, { status: "ACTIVE" }, 1001);
    expect(updated.status).toBe("ACTIVE");
    expect(updated.updatedAt).toBe(1001);
    expect(op.status).toBe("PENDING"); // immutable
  });

  it("completeStep adds to completedSteps", () => {
    const op = createExpansionOperation({
      plan: makePlan(), type: "claim", tick: 1000, reservedEnergy: 5000,
    });
    const after = completeStep(op, "claimer reached target room", 1001);
    expect(after.completedSteps).toContain("claimer reached target room");
  });

  it("isOperationComplete requires all criteria", () => {
    const op = createExpansionOperation({
      plan: makePlan(), type: "claim", tick: 1000, reservedEnergy: 5000,
    });
    expect(isOperationComplete(op)).toBe(false);
    const complete = completeOperation(op, 2000);
    expect(isOperationComplete(complete)).toBe(true);
    expect(complete.status).toBe("COMPLETED");
  });

  it("failOperation sets failReason", () => {
    const op = createExpansionOperation({
      plan: makePlan(), type: "claim", tick: 1000, reservedEnergy: 5000,
    });
    const failed = failOperation(op, "claimer died", 1005);
    expect(failed.status).toBe("FAILED");
    expect(failed.failReason).toBe("claimer died");
  });

  it("activateOperation sets ACTIVE", () => {
    const op = createExpansionOperation({
      plan: makePlan(), type: "claim", tick: 1000, reservedEnergy: 5000,
    });
    const active = activateOperation(op, 1001);
    expect(active.status).toBe("ACTIVE");
  });

  it("createColonizeFromClaim derives from claim op", () => {
    const claimOp = createExpansionOperation({
      plan: makePlan(), type: "claim", tick: 1000, reservedEnergy: 5000,
    });
    const colonizeOp = createColonizeFromClaim(claimOp, 1001, 8000);
    expect(colonizeOp.type).toBe("colonize");
    expect(colonizeOp.planId).toBe(claimOp.planId);
    expect(colonizeOp.roomName).toBe(claimOp.roomName);
    expect(colonizeOp.reservedEnergy).toBe(8000);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Execution Dashboard
// ═══════════════════════════════════════════════════════════════

describe("A3.3 Execution Dashboard", () => {
  it("builds idle dashboard when no active execution", () => {
    const d = buildExecutionDashboard({
      tick: 1000,
      executionState: "idle",
      progress: 0,
      checkpointsPassed: 0,
      reservedEnergy: 0,
    });
    expect(d.tick).toBe(1000);
    expect(d.executionState).toBe("idle");
    expect(d.checkpointsPassed).toBe(0);
    expect(d.checkpointsTotal).toBe(5);
    expect(d.economicActivated).toBe(false);
    expect(d.empireIntegrated).toBe(false);
    expect(d.summary).toContain("no active expansion");
  });

  it("builds dashboard with active execution + checkpoints", () => {
    const records = createAllCheckpointRecords();
    records[0]!.status = "PASSED";
    records[1]!.status = "PASSED";
    records[2]!.status = "PASSED";
    const d = buildExecutionDashboard({
      tick: 2000,
      executionState: "ECONOMIC_STARTUP",
      targetRoom: "W5N5",
      sponsorRoom: "W1N1",
      progress: 65,
      checkpointsPassed: 3,
      checkpointRecords: records,
      reservedEnergy: 5000,
    });
    expect(d.targetRoom).toBe("W5N5");
    expect(d.sponsorRoom).toBe("W1N1");
    expect(d.progress).toBe(65);
    expect(d.checkpointsPassed).toBe(3);
    expect(d.checkpointDetails).toHaveLength(5);
    expect(d.reservedEnergy).toBe(5000);
    expect(d.summary).toContain("state=ECONOMIC_STARTUP");
    expect(d.summary).toContain("checkpoints=3/5");
  });

  it("includes economic activation data when provided", () => {
    const econResult = evaluateEconomicActivation(makeEconomicInput({
      consecutivePositiveTicks: 300,
    }));
    const d = buildExecutionDashboard({
      tick: 3000,
      executionState: "INTEGRATING",
      progress: 85,
      checkpointsPassed: 4,
      economicResult: econResult,
      reservedEnergy: 3000,
    });
    expect(d.economicActivated).toBe(false);
    expect(d.netEnergyFlow).toBe(10);
    expect(d.consecutivePositiveTicks).toBe(300);
    expect(d.summary).toContain("netFlow=10.0");
  });

  it("includes empire integration data when provided", () => {
    const integrationResult = evaluateEmpireIntegration(makeIntegrationInput({
      hasSnapshot: false,
    }));
    const d = buildExecutionDashboard({
      tick: 4000,
      executionState: "INTEGRATING",
      progress: 85,
      checkpointsPassed: 4,
      integrationResult,
      reservedEnergy: 0,
    });
    expect(d.empireIntegrated).toBe(false);
    expect(d.missingSystems).toContain("RoomSnapshot");
  });

  it("includes threat data when provided", () => {
    const threatResult = evaluateThreatEscalation(makeThreatInput({
      hasHostileCreep: true,
      executionState: "BOOTSTRAPPING",
    }));
    const d = buildExecutionDashboard({
      tick: 5000,
      executionState: "BOOTSTRAPPING",
      progress: 45,
      checkpointsPassed: 2,
      threatResult,
      reservedEnergy: 2000,
    });
    expect(d.threatLevel).toBe("RED");
    expect(d.threatAction).toBe("EVACUATE");
  });

  it("shows AUTONOMOUS when progress is 100", () => {
    const d = buildExecutionDashboard({
      tick: 6000,
      executionState: "COMPLETED",
      targetRoom: "W5N5",
      progress: 100,
      checkpointsPassed: 5,
      reservedEnergy: 0,
    });
    expect(d.summary).toContain("AUTONOMOUS");
  });
});