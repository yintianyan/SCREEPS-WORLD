/**
 * A3.3 E2E Tests — Expansion Execution 全链路端到端测试。
 *
 * 验证完整链路：
 *   Success: VALIDATING → PREPARING → CLAIMING → CLAIMED →
 *            BOOTSTRAPPING → ECONOMIC_STARTUP → INTEGRATING → COMPLETED
 *
 *   Failure: VALIDATING → FAILED → REPLANNING → (revalidate)
 *            PREPARING → FAILED (timeout)
 *            CLAIMING → FAILED (stolen)
 *            BOOTSTRAPPING → FAILED (squad wiped)
 *
 * 使用纯函数状态机驱动，不需要完整 Screeps 引擎 mock。
 */

import { describe, it, expect } from "vitest";
import {
  transitionExecutionState,
  getExecutionProgress,
  type ExecutionState,
  type StateTransitionInput,
} from "../../../src/domain/expansion/execution-state";
import { validateExecutionGate, type ExecutionGateInput } from "../../../src/domain/expansion/execution-gate";
import {
  evaluateCheckpoint,
  createAllCheckpointRecords,
  type CheckpointId,
  type CheckpointInput,
} from "../../../src/domain/expansion/checkpoint";
import {
  evaluateEconomicActivation,
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
  type ResourceReservation,
} from "../../../src/domain/expansion/resource-reservation";
import {
  createExpansionOperation,
  completeStep,
  completeOperation,
  failOperation,
  type ExpansionOperation,
} from "../../../src/domain/expansion/execution-operation";
import {
  buildExecutionDashboard,
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
    cost: { roomName: "W5N5", totalCost: 5000, claimerCost: 650, pioneerCost: 1000, spawnCost: 5000, travelCost: 200, infrastructureCost: 500, bootstrapEnergy: 3000, evidence: "" },
    payback: { roomName: "W5N5", totalCost: 5000, expectedIncomePerTick: 10, paybackTicks: 500, roi: 2.0, worthwhile: true, evidence: "" },
    risk: { roomName: "W5N5", score: 0.3, level: "LOW", dimensions: { economic: 0.2, operational: 0.1, distance: 0.3, recovery: 0.2, defense: 0.1 }, evidence: "" },
    candidate: {
      roomName: "W5N5", sponsorRoom: "W1N1", kind: "normal", roomStatus: "normal",
      sourceCount: 2, mineral: "H",
      terrain: { exitCount: 3, sealedExitCount: 1, wallCount: 0 },
      controller: { hasOwner: false, isMine: false, isHostileReserved: false },
      pathCost: 100, lastSeen: 1000, distance: 1,
      neighborRooms: ["W4N5", "W6N5"], score: 0.75,
      status: "QUALIFIED", discoveredAt: 1000,
    },
    status: "WAITING_EXECUTION",
    createdAt: 1000, updatedAt: 1000,
    cancelConditions: [], dependencies: [],
    explanation: "test plan",
    ...over,
  };
}

function makeBudget(over: Partial<TieredExpansionBudget> = {}): TieredExpansionBudget {
  return {
    totalEnergy: 50000, emergencyReserve: 10000, coreReserve: 5000,
    operationalReserve: 12000, availableExpansion: 23000,
    tick: 1000, coreInvaded: false, evidence: "", ...over,
  };
}

function makeGateInput(over: Partial<ExecutionGateInput> = {}): ExecutionGateInput {
  return {
    plan: makePlan(), budget: makeBudget(),
    isEmpireReady: true, alreadyOwned: false,
    hasConcurrentOp: false, hasOtherExpansion: false,
    intelStale: false, threatEscalated: false,
    targetClaimable: true, candidateValid: true,
    ...over,
  };
}

function makeCheckpointInput(over: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    checkpointId: "CP1_CLAIMED",
    controllerClaimed: true, spawnBuilt: true, spawnCanSpawn: true,
    harvesterActive: true, transporterActive: true,
    extensionsBuilt: true, containerBuilt: true, roadsBuilt: true,
    netEnergyFlowPositive: true, empireIntegrated: true,
    tick: 1000, retryCount: 0,
    ...over,
  };
}

function makeEconomicInput(over: Partial<EconomicActivationInput> = {}): EconomicActivationInput {
  return {
    energyProduction: 20, energyConsumption: 10, externalEnergyInflow: 0,
    consecutivePositiveTicks: 500, hasHarvester: true, hasTransporter: true,
    hasUpgrader: false, spawnActive: true, tick: 1000, ...over,
  };
}

function makeIntegrationInput(over: Partial<EmpireIntegrationInput> = {}): EmpireIntegrationInput {
  return {
    inOwnedRoomsList: true, hasSnapshot: true, inEconomyStats: true,
    spawnManaged: true, defenseCovered: true, hasVersionedLayout: true,
    tick: 1000, ...over,
  };
}

/**
 * 模拟一个完整的状态机推进链路。
 * 从指定状态出发，按 tick 逐步推进，直到终态或超时。
 */
function simulateExecutionPath(
  startState: ExecutionState,
  tick: number,
  steps: Array<Partial<StateTransitionInput>>,
): { finalState: ExecutionState; path: ExecutionState[]; tick: number } {
  let currentState = startState;
  const path: ExecutionState[] = [currentState];
  let currentTick = tick;

  for (const step of steps) {
    const result = transitionExecutionState({
      currentState,
      plan: makePlan(),
      tick: currentTick,
      ...step,
    });
    if (result.transitioned) {
      currentState = result.newState;
      path.push(currentState);
    }
    currentTick++;
  }

  return { finalState: currentState, path, tick: currentTick };
}

// ═══════════════════════════════════════════════════════════════
// E2E Success Path: Full Chain VALIDATING → COMPLETED
// ═══════════════════════════════════════════════════════════════

describe("A3.3 E2E — Success Path", () => {
  it("full chain: VALIDATING → PREPARING → CLAIMING → CLAIMED → BOOTSTRAPPING → ECONOMIC_STARTUP → INTEGRATING → COMPLETED", () => {
    const { finalState, path } = simulateExecutionPath("VALIDATING", 1000, [
      { gatePassed: true },                                    // → PREPARING
      { resourcesReserved: true, claimerCreated: true },       // → CLAIMING
      { controllerClaimed: true },                             // → CLAIMED
      { spawnBuilt: true, pioneerArrived: true },               // → BOOTSTRAPPING (wait, CLAIMED auto-transitions)
    ]);

    // 实际上 CLAIMED → BOOTSTRAPPING is automatic, then BOOTSTRAPPING → ECONOMIC_STARTUP
    // Let's trace it properly:
    let state: ExecutionState = "VALIDATING";
    const fullPath: ExecutionState[] = [state];
    let tick = 1000;

    // VALIDATING → PREPARING
    let r = transitionExecutionState({ currentState: state, plan: makePlan(), tick, gatePassed: true });
    expect(r.transitioned).toBe(true);
    state = r.newState;
    fullPath.push(state);
    tick++;

    // PREPARING → CLAIMING
    r = transitionExecutionState({ currentState: state, plan: makePlan(), tick, resourcesReserved: true, claimerCreated: true });
    expect(r.newState).toBe("CLAIMING");
    state = r.newState;
    fullPath.push(state);
    tick++;

    // CLAIMING → CLAIMED
    r = transitionExecutionState({ currentState: state, plan: makePlan(), tick, controllerClaimed: true });
    expect(r.newState).toBe("CLAIMED");
    state = r.newState;
    fullPath.push(state);
    tick++;

    // CLAIMED → BOOTSTRAPPING (automatic)
    r = transitionExecutionState({ currentState: state, plan: makePlan(), tick });
    // CLAIMED auto-transitions to BOOTSTRAPPING
    // Actually, looking at the code, CLAIMED case always returns BOOTSTRAPPING
    state = r.newState;
    fullPath.push(state);
    tick++;

    // BOOTSTRAPPING → ECONOMIC_STARTUP
    r = transitionExecutionState({ currentState: state, plan: makePlan(), tick, spawnBuilt: true, pioneerArrived: true });
    expect(r.newState).toBe("ECONOMIC_STARTUP");
    state = r.newState;
    fullPath.push(state);
    tick++;

    // ECONOMIC_STARTUP → INTEGRATING
    r = transitionExecutionState({ currentState: state, plan: makePlan(), tick, energyLoopActive: true, basicInfraComplete: true });
    expect(r.newState).toBe("INTEGRATING");
    state = r.newState;
    fullPath.push(state);
    tick++;

    // INTEGRATING → COMPLETED
    r = transitionExecutionState({ currentState: state, plan: makePlan(), tick, economicallyActivated: true, empireIntegrated: true });
    expect(r.newState).toBe("COMPLETED");
    state = r.newState;
    fullPath.push(state);

    expect(fullPath).toEqual([
      "VALIDATING", "PREPARING", "CLAIMING", "CLAIMED",
      "BOOTSTRAPPING", "ECONOMIC_STARTUP", "INTEGRATING", "COMPLETED",
    ]);
    expect(getExecutionProgress(state)).toBe(100);
  });

  it("all 5 checkpoints pass in order", () => {
    const records = createAllCheckpointRecords();
    const ids: CheckpointId[] = ["CP1_CLAIMED", "CP2_SPAWN_ACTIVE", "CP3_ENERGY_LOOP", "CP4_BASIC_INFRA", "CP5_ECONOMIC_ACTIVATION"];

    let allPassed = true;
    for (let i = 0; i < ids.length; i++) {
      const cp = evaluateCheckpoint(makeCheckpointInput({
        checkpointId: ids[i]!,
      }));
      if (cp.passed) {
        records[i]!.status = "PASSED";
        records[i]!.passedAtTick = 1000 + i * 100;
      } else {
        allPassed = false;
      }
    }

    expect(allPassed).toBe(true);
    expect(records.every(r => r.status === "PASSED")).toBe(true);
  });

  it("economic activation achieved after 500 consecutive positive ticks", () => {
    // Simulate 500 ticks of positive net flow
    let consecutivePositive = 0;
    let activated = false;

    for (let tick = 0; tick < 500; tick++) {
      const econInput = makeEconomicInput({
        consecutivePositiveTicks: consecutivePositive,
        tick: 1000 + tick,
      });
      const result = evaluateEconomicActivation(econInput);
      if (result.netFlow > 0) {
        consecutivePositive++;
      } else {
        consecutivePositive = 0;
      }

      // Check activation on the last tick
      if (tick === 499) {
        const finalResult = evaluateEconomicActivation(makeEconomicInput({
          consecutivePositiveTicks: consecutivePositive,
          tick: 1000 + tick,
        }));
        activated = finalResult.activated;
      }
    }

    expect(consecutivePositive).toBe(500);
    expect(activated).toBe(true);
  });

  it("empire integration achieved when all 5 systems covered", () => {
    const integration = evaluateEmpireIntegration(makeIntegrationInput());
    const econResult = evaluateEconomicActivation(makeEconomicInput());
    expect(integration.integrated).toBe(true);
    expect(canHandover(integration, econResult.activated)).toBe(true);
  });

  it("operation completed with all steps", () => {
    const op = createExpansionOperation({
      plan: makePlan(), type: "colonize", tick: 1000, reservedEnergy: 10000,
    });
    let current = op;
    for (const step of op.completionCriteria) {
      current = completeStep(current, step, 1000);
    }
    expect(isOperationCompleteExpanded(current)).toBe(true);
    const completed = completeOperation(current, 2000);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.executionState).toBe("COMPLETED");
  });

  it("execution dashboard shows AUTONOMOUS at completion", () => {
    const dashboard = buildExecutionDashboard({
      tick: 2000,
      executionState: "COMPLETED",
      targetRoom: "W5N5",
      progress: 100,
      checkpointsPassed: 5,
      economicResult: evaluateEconomicActivation(makeEconomicInput()),
      integrationResult: evaluateEmpireIntegration(makeIntegrationInput()),
      reservedEnergy: 0,
    });
    expect(dashboard.summary).toContain("AUTONOMOUS");
    expect(dashboard.economicActivated).toBe(true);
    expect(dashboard.empireIntegrated).toBe(true);
  });

  it("resource reservation lifecycle: reserve → consume → release", () => {
    // Reserve
    const reserveResult = tryReserve({
      planId: "W5N5@1000",
      energyNeeded: 5000,
      availableExpansionBudget: 20000,
      tick: 1000,
    });
    expect(reserveResult.success).toBe(true);
    expect(reserveResult.reservation!.reservedEnergy).toBe(5000);

    // Consume (after claim success)
    const consumed = { ...reserveResult.reservation!, status: "CONSUMED" as const, consumedAt: 1500 };
    expect(consumed.status).toBe("CONSUMED");

    // Release remaining (after completion)
    const released = releaseReservation(consumed, 2000, "expansion complete");
    expect(released.status).toBe("RELEASED");
  });
});

// ═══════════════════════════════════════════════════════════════
// E2E Failure Paths
// ═══════════════════════════════════════════════════════════════

describe("A3.3 E2E — Failure Paths", () => {
  it("Gate failure: VALIDATING → FAILED → REPLANNING", () => {
    const r = transitionExecutionState({
      currentState: "VALIDATING",
      plan: makePlan(),
      tick: 1000,
      gatePassed: false,
    });
    expect(r.newState).toBe("FAILED");
    expect(r.transitioned).toBe(true);

    // FAILED → REPLANNING
    const r2 = transitionExecutionState({
      currentState: "FAILED",
      plan: makePlan(),
      tick: 1001,
    });
    expect(r2.newState).toBe("REPLANNING");

    // REPLANNING → VALIDATING (retry)
    const r3 = transitionExecutionState({
      currentState: "REPLANNING",
      plan: makePlan(),
      tick: 1002,
    });
    expect(r3.newState).toBe("VALIDATING");
  });

  it("Gate rejection: budget insufficient blocks execution", () => {
    const gateResult = validateExecutionGate(makeGateInput({
      budget: makeBudget({ availableExpansion: 1000 }), // < 5000 cost
    }));
    expect(gateResult.allPassed).toBe(false);
    expect(gateResult.failedGates).toContain("GATE_BUDGET_SUFFICIENT");
  });

  it("Gate rejection: target already owned", () => {
    const gateResult = validateExecutionGate(makeGateInput({
      alreadyOwned: true,
    }));
    expect(gateResult.allPassed).toBe(false);
    expect(gateResult.failedGates).toContain("GATE_NOT_OWNED");
  });

  it("Gate rejection: threat escalated", () => {
    const gateResult = validateExecutionGate(makeGateInput({
      threatEscalated: true,
    }));
    expect(gateResult.allPassed).toBe(false);
    expect(gateResult.failedGates).toContain("GATE_THREAT_UNCHANGED");
  });

  it("Claim stolen: CLAIMING → FAILED (stolen by enemy)", () => {
    // In claiming state, if controller is owned by enemy
    const r = transitionExecutionState({
      currentState: "CLAIMING",
      plan: makePlan(),
      tick: 1000,
      failureReason: "controller stolen by enemy",
    });
    expect(r.newState).toBe("FAILED");
    expect(r.transitioned).toBe(true);
    expect(r.reason).toContain("stolen");
  });

  it("Bootstrapping failure: squad wiped → FAILED", () => {
    const r = transitionExecutionState({
      currentState: "BOOTSTRAPPING",
      plan: makePlan(),
      tick: 1000,
      failureReason: "squad wiped by hostiles",
    });
    expect(r.newState).toBe("FAILED");
  });

  it("Economic startup failure: energy loop never activates", () => {
    // After many ticks, still no harvester/transporter
    const r = transitionExecutionState({
      currentState: "ECONOMIC_STARTUP",
      plan: makePlan(),
      tick: 5000,
      failureReason: "energy loop timeout - no harvesters",
    });
    expect(r.newState).toBe("FAILED");
  });

  it("Integration failure: economy not activating", () => {
    const r = transitionExecutionState({
      currentState: "INTEGRATING",
      plan: makePlan(),
      tick: 10000,
      failureReason: "economic activation timeout",
    });
    expect(r.newState).toBe("FAILED");
  });

  it("Threat escalation: RED → ABORT (pre-claim)", () => {
    const threat = evaluateThreatEscalation({
      hasHostileCreep: true,
      hasHostileReservation: false,
      hasPathThreat: false,
      sponsorUnderAttack: false,
      hasHostileTower: false,
      executionState: "PREPARING",
      tick: 1000,
    });
    expect(threat.level).toBe("RED");
    expect(threat.action).toBe("ABORT");
    expect(threat.shouldAbort).toBe(true);
  });

  it("Threat escalation: RED → EVACUATE (post-claim, protect investment)", () => {
    const threat = evaluateThreatEscalation({
      hasHostileCreep: true,
      hasHostileReservation: false,
      hasPathThreat: false,
      sponsorUnderAttack: false,
      hasHostileTower: false,
      executionState: "BOOTSTRAPPING",
      tick: 1000,
    });
    expect(threat.level).toBe("RED");
    expect(threat.action).toBe("EVACUATE");
  });

  it("Checkpoint failure: CP2 fails and falls back to CP1", () => {
    const cp2 = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP2_SPAWN_ACTIVE",
      spawnBuilt: false,
      retryCount: 3, // maxRetries for CP2
    }));
    expect(cp2.passed).toBe(false);
    expect(cp2.shouldRetry).toBe(false);
    expect(cp2.fallbackTo).toBe("CP1_CLAIMED");
  });

  it("Checkpoint failure: CP5 fails without economic activation", () => {
    const cp5 = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP5_ECONOMIC_ACTIVATION",
      netEnergyFlowPositive: false,
      empireIntegrated: false,
      retryCount: 3,
    }));
    expect(cp5.passed).toBe(false);
    expect(cp5.failReason).toContain("energy flow");
  });

  it("Operation failure: claim operation fails", () => {
    const op = createExpansionOperation({
      plan: makePlan(), type: "claim", tick: 1000, reservedEnergy: 5000,
    });
    const failed = failOperation(op, "claimer killed en route", 1005);
    expect(failed.status).toBe("FAILED");
    expect(failed.failReason).toBe("claimer killed en route");
  });

  it("Resource reservation failure: insufficient budget", () => {
    const r = tryReserve({
      planId: "p1",
      energyNeeded: 30000,
      availableExpansionBudget: 10000,
      tick: 1000,
    });
    expect(r.success).toBe(false);
    expect(r.failReason).toContain("insufficient");
  });

  it("Economic activation not achieved: external support still needed", () => {
    const result = evaluateEconomicActivation(makeEconomicInput({
      externalEnergyInflow: 100,
      consecutivePositiveTicks: 500,
    }));
    expect(result.activated).toBe(false);
    expect(result.criteria.selfSustaining.passed).toBe(false);
  });

  it("Empire integration not achieved: missing systems", () => {
    const result = evaluateEmpireIntegration(makeIntegrationInput({
      hasSnapshot: false,
      spawnManaged: false,
      hasVersionedLayout: false,
    }));
    expect(result.integrated).toBe(false);
    expect(result.missingSystems).toHaveLength(3);
    expect(result.progress).toBe(40);
  });

  it("Multiple gate failures accumulate evidence", () => {
    const result = validateExecutionGate(makeGateInput({
      alreadyOwned: true,
      hasConcurrentOp: true,
      intelStale: true,
      threatEscalated: true,
    }));
    expect(result.failedGates).toHaveLength(4);
    expect(result.evidence).toContain("GATE_NOT_OWNED");
    expect(result.evidence).toContain("GATE_NO_CONCURRENT_OP");
    expect(result.evidence).toContain("GATE_INTEL_FRESH");
    expect(result.evidence).toContain("GATE_THREAT_UNCHANGED");
  });
});

// ═══════════════════════════════════════════════════════════════
// E2E Dashboard Integration
// ═══════════════════════════════════════════════════════════════

describe("A3.3 E2E — Dashboard Integration", () => {
  it("dashboard tracks progress through execution states", () => {
    const states: ExecutionState[] = [
      "VALIDATING", "PREPARING", "CLAIMING", "CLAIMED",
      "BOOTSTRAPPING", "ECONOMIC_STARTUP", "INTEGRATING", "COMPLETED",
    ];
    const progresses = states.map(s => getExecutionProgress(s));
    // Verify monotonically non-decreasing
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]!);
    }
    expect(progresses[0]).toBe(0);
    expect(progresses[progresses.length - 1]).toBe(100);
  });

  it("dashboard at failure shows 0 progress", () => {
    const dashboard = buildExecutionDashboard({
      tick: 1000,
      executionState: "FAILED",
      progress: 0,
      checkpointsPassed: 2,
      reservedEnergy: 3000,
    });
    expect(dashboard.progress).toBe(0);
    expect(dashboard.executionState).toBe("FAILED");
  });

  it("dashboard at bootstrapping shows partial progress", () => {
    const records = createAllCheckpointRecords();
    records[0]!.status = "PASSED";
    const dashboard = buildExecutionDashboard({
      tick: 1500,
      executionState: "BOOTSTRAPPING",
      targetRoom: "W5N5",
      sponsorRoom: "W1N1",
      progress: 45,
      checkpointsPassed: 1,
      checkpointRecords: records,
      reservedEnergy: 4000,
    });
    expect(dashboard.progress).toBe(45);
    expect(dashboard.checkpointsPassed).toBe(1);
    expect(dashboard.checkpointDetails[0]?.status).toBe("PASSED");
  });

  it("dashboard with threat shows threat level", () => {
    const threat = evaluateThreatEscalation({
      hasHostileCreep: false,
      hasHostileReservation: true,
      hasPathThreat: false,
      sponsorUnderAttack: false,
      hasHostileTower: false,
      executionState: "PREPARING",
      tick: 1000,
    });
    const dashboard = buildExecutionDashboard({
      tick: 1000,
      executionState: "PREPARING",
      progress: 10,
      checkpointsPassed: 0,
      threatResult: threat,
      reservedEnergy: 5000,
    });
    expect(dashboard.threatLevel).toBe("YELLOW");
    expect(dashboard.threatAction).toBe("PAUSE");
  });
});

// ═══════════════════════════════════════════════════════════════
// E2E Multi-tick Simulation
// ═══════════════════════════════════════════════════════════════

describe("A3.3 E2E — Multi-tick Simulation", () => {
  it("simulates 500-tick economic activation journey", () => {
    // Start with no self-sustaining, external support needed
    let consecutivePositive = 0;
    let externalInflow = 100; // initially receiving support

    for (let tick = 0; tick < 500; tick++) {
      // Gradually reduce external support as room becomes self-sufficient
      if (tick > 200) externalInflow = Math.max(0, externalInflow - 1);

      const input = makeEconomicInput({
        energyProduction: 20,
        energyConsumption: 10,
        externalEnergyInflow: externalInflow,
        consecutivePositiveTicks: consecutivePositive,
        tick: 1000 + tick,
      });

      const result = evaluateEconomicActivation(input);

      if (result.netFlow > 0) {
        consecutivePositive++;
      } else {
        consecutivePositive = 0;
      }

      // Check final state
      if (tick === 499) {
        // After 500 ticks, with external inflow reaching 0 at tick ~300
        expect(result.netFlow).toBe(10); // 20 - 10
        // consecutivePositive should be ~299 (since external inflow reached 0 around tick 300)
        expect(consecutivePositive).toBeGreaterThan(200);
      }
    }
  });

  it("simulates threat escalation timeline", () => {
    // Timeline: GREEN → YELLOW → RED → (post-claim) EVACUATE
    let state: ExecutionState = "VALIDATING";

    // Tick 0: GREEN - no threats
    const t0 = evaluateThreatEscalation({
      hasHostileCreep: false, hasHostileReservation: false, hasPathThreat: false,
      sponsorUnderAttack: false, hasHostileTower: false,
      executionState: state, tick: 1000,
    });
    expect(t0.level).toBe("GREEN");
    expect(t0.action).toBe("CONTINUE");

    // Tick 100: YELLOW - hostile reservation detected
    const t100 = evaluateThreatEscalation({
      hasHostileCreep: false, hasHostileReservation: true, hasPathThreat: false,
      sponsorUnderAttack: false, hasHostileTower: false,
      executionState: state, tick: 1100,
    });
    expect(t100.level).toBe("YELLOW");
    expect(t100.action).toBe("PAUSE");

    // State advances to CLAIMED
    state = "CLAIMED";

    // Tick 200: YELLOW + post-claim → CONTINUE
    const t200 = evaluateThreatEscalation({
      hasHostileCreep: false, hasHostileReservation: true, hasPathThreat: false,
      sponsorUnderAttack: false, hasHostileTower: false,
      executionState: state, tick: 1200,
    });
    expect(t200.level).toBe("YELLOW");
    expect(t200.action).toBe("CONTINUE");

    // Tick 300: RED - hostile creep appears, post-claim → EVACUATE
    const t300 = evaluateThreatEscalation({
      hasHostileCreep: true, hasHostileReservation: false, hasPathThreat: false,
      sponsorUnderAttack: false, hasHostileTower: false,
      executionState: "BOOTSTRAPPING", tick: 1300,
    });
    expect(t300.level).toBe("RED");
    expect(t300.action).toBe("EVACUATE");
  });

  it("simulates checkpoint progression with retries", () => {
    const records = createAllCheckpointRecords();
    let tick = 1000;

    // CP1: passes immediately
    const cp1 = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP1_CLAIMED",
      controllerClaimed: true,
      tick,
    }));
    expect(cp1.passed).toBe(true);
    records[0]!.status = "PASSED";
    records[0]!.passedAtTick = tick;
    tick++;

    // CP2: fails twice, then passes (spawn construction)
    for (let retry = 0; retry < 2; retry++) {
      const cp2 = evaluateCheckpoint(makeCheckpointInput({
        checkpointId: "CP2_SPAWN_ACTIVE",
        spawnBuilt: false,
        retryCount: retry,
        tick: tick + retry,
      }));
      expect(cp2.passed).toBe(false);
      expect(cp2.shouldRetry).toBe(true);
    }
    // Third attempt: spawn built
    const cp2Final = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP2_SPAWN_ACTIVE",
      spawnBuilt: true,
      spawnCanSpawn: true,
      retryCount: 2,
      tick: tick + 2,
    }));
    expect(cp2Final.passed).toBe(true);
    records[1]!.status = "PASSED";
    records[1]!.passedAtTick = tick + 2;
    tick += 3;

    // CP3: passes (energy loop active)
    const cp3 = evaluateCheckpoint(makeCheckpointInput({
      checkpointId: "CP3_ENERGY_LOOP",
      harvesterActive: true,
      transporterActive: true,
      spawnCanSpawn: true,
      tick,
    }));
    expect(cp3.passed).toBe(true);
    records[2]!.status = "PASSED";
    records[2]!.passedAtTick = tick;

    // Verify progression
    expect(records.filter(r => r.status === "PASSED").length).toBe(3);
  });
});

// ─── 辅助函数 ──────────────────────────────────────────

/** isOperationComplete 的本地包装（避免 import 冲突）。 */
function isOperationCompleteExpanded(op: ExpansionOperation): boolean {
  return op.completionCriteria.every(c => op.completedSteps.includes(c));
}
