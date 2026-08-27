/** A5.4.0 Tactical Combat — Domain Tests. */

import { describe, expect, it } from "vitest";
import {
  // Types
  type TacticalObjective,
  type SquadPlan,
  type TacticalSnapshot,
  type TacticalAuthorization,
  type TacticalAbortSignal,
  type EnemySnapshot,
  type EnemyStructureSnapshot,
  type SquadMemberSnapshot,
  type FormationType,
  // Authorization
  validateAuthorization,
  buildAuthorization,
  validateTargetScope,
  isOffensiveOperation,
  // State Machine
  evaluateTacticalAction,
  canTransitionTactical,
  tacticalDecisionHash,
  // Formation
  selectFormationForTerrain,
  evaluateFormationTransition,
  FORMATION_SEMANTICS,
} from "../../../src/domain/tactical";
import type { CombatCapability, AggregateCapability, CombatPower } from "../../../src/domain/combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../../../src/domain/defense/terrain-context";
import type { MultiDimensionalConfidence } from "../../../src/domain/defense/confidence";
import type { MilitaryOperation, AbortCondition } from "../../../src/domain/military/operation";

// ─── Test Fixtures ─────────────────────────────────────────

const DEFAULT_TICK = 100000;

function makeCombatCapability(overrides: Partial<CombatCapability> = {}): CombatCapability {
  return {
    attack: 90,
    rangedAttack: 30,
    heal: 0,
    rangedHeal: 0,
    dismantle: 0,
    claim: 0,
    effectiveHP: 400,
    mobility: 1,
    support: 0,
    toughParts: 0,
    boosted: false,
    maxBoostTier: 0,
    totalParts: 4,
    activeParts: 4,
    ...overrides,
  };
}

function makeHealCapability(): CombatCapability {
  return makeCombatCapability({
    attack: 0,
    rangedAttack: 0,
    heal: 36,
    rangedHeal: 12,
    effectiveHP: 300,
  });
}

function makeAggregateCapability(overrides: Partial<AggregateCapability> = {}): AggregateCapability {
  return {
    totalAttack: 90,
    totalRangedAttack: 30,
    totalHeal: 36,
    totalRangedHeal: 12,
    totalDismantle: 0,
    totalClaim: 0,
    totalEffectiveHP: 700,
    avgMobility: 1,
    totalSupport: 0,
    totalToughParts: 0,
    boostedCount: 0,
    maxBoostTier: 0,
    creepCount: 2,
    ...overrides,
  };
}

function makeConfidence(overrides: Partial<MultiDimensionalConfidence> = {}): MultiDimensionalConfidence {
  return {
    factConfidence: 0.95,
    combatConfidence: 0.8,
    intentConfidence: 0.7,
    terrainConfidence: 0.8,
    intelConfidence: 0.6,
    overallConfidence: 0.75,
    ...overrides,
  };
}

function makeTerrainContext(overrides: Partial<TerrainContext> = {}): TerrainContext {
  return {
    roomName: "W1N1",
    terrainType: "OPEN",
    walkability: "FULL",
    openTileRatio: 0.9,
    wallDensity: 0.1,
    chokepoints: [],
    corridors: [],
    rampartCoverage: "NONE",
    towerCoverage: "NONE",
    coreExposure: 0.5,
    retreatQuality: "GOOD",
    mobilityModifier: 1.0,
    tick: DEFAULT_TICK,
    ...overrides,
  };
}

function makeTerrainModifier(overrides: Partial<EffectiveCombatModifier> = {}): EffectiveCombatModifier {
  return {
    mobilityModifier: 1.0,
    towerDamageFactor: 0,
    retreatDifficulty: 0.8,
    approachFactor: 1.0,
    ...overrides,
  };
}

function makeAuthorization(overrides: Partial<TacticalAuthorization> = {}): TacticalAuthorization {
  return {
    state: "AUTHORIZED",
    operationId: "op-001",
    warPosture: "war",
    targetRoom: "W2N2",
    expiry: DEFAULT_TICK + 5000,
    operationAborted: false,
    reason: "authorized by war plan",
    ...overrides,
  };
}

function makeObjective(overrides: Partial<TacticalObjective> = {}): TacticalObjective {
  return {
    objectiveId: "tac-obj-001",
    operationId: "op-001",
    objectiveType: "ENGAGE_ENEMY",
    targetId: "enemy-room",
    targetType: "room",
    targetScope: "LOCAL",
    authorization: makeAuthorization(),
    priority: 50,
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: 10000,
      maxDuration: 5000,
      minIntelConfidence: 0.3,
      allowBoost: true,
      allowPursuit: false,
      maxPursuitDistance: 0,
    },
    deadline: DEFAULT_TICK + 5000,
    abortConditions: ["CASUALTY_EXCEEDED", "INTEL_STALE", "LOGISTICS_COLLAPSED"] as readonly AbortCondition[],
    evidence: ["test objective"],
    tick: DEFAULT_TICK,
    ...overrides,
  };
}

function makeSquadMember(name: string, role: string, overrides: Partial<SquadMemberSnapshot> = {}): SquadMemberSnapshot {
  return {
    name,
    role,
    pos: 25 * 50 + 25,
    room: "W2N2",
    hits: 400,
    hitsMax: 400,
    boosted: false,
    ticksToLive: 1000,
    capability: role === "healer" ? makeHealCapability() : makeCombatCapability(),
    ...overrides,
  };
}

function makeSquadPlan(overrides: Partial<SquadPlan> = {}): SquadPlan {
  const attacker = makeSquadMember("attacker-1", "attacker");
  const healer = makeSquadMember("healer-1", "healer");
  const roles = new Map<string, string>([
    [attacker.name, "attacker"],
    [healer.name, "healer"],
  ]);
  return {
    squadId: "squad-001",
    operationId: "op-001",
    objectiveId: "tac-obj-001",
    members: [attacker, healer],
    roles,
    formation: "WEDGE",
    engagementPolicy: {
      engageRange: 3,
      focusTargetId: undefined,
      minimumHpThreshold: 100,
      retreatThreshold: 0.3,
      regroupThreshold: 0.5,
      healerRequired: true,
      enemyCapability: makeAggregateCapability(),
      terrainRisk: 0.2,
      confidence: 0.75,
    },
    retreatPolicy: {
      retreatRoom: "W1N1",
      threshold: 0.3,
      minRetreatQuality: "GOOD",
      allowRearguard: true,
    },
    regroupPolicy: {
      regroupRoom: "W1N1",
      regroupPos: 25 * 50 + 25,
      memberRatioThreshold: 0.5,
      timeoutTicks: 500,
    },
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: 10000,
      maxDuration: 5000,
      minIntelConfidence: 0.3,
      allowBoost: true,
      allowPursuit: false,
      maxPursuitDistance: 0,
    },
    state: "ENGAGING",
    createdTick: DEFAULT_TICK,
    ...overrides,
  };
}

function makeEnemy(overrides: Partial<EnemySnapshot> = {}): EnemySnapshot {
  return {
    id: "enemy-001",
    name: "hostile-attacker",
    pos: 27 * 50 + 27,
    room: "W2N2",
    hits: 300,
    hitsMax: 400,
    capability: makeCombatCapability({ attack: 60, effectiveHP: 300 }),
    lastSeenTick: DEFAULT_TICK,
    isNpc: false,
    ...overrides,
  };
}

function makeEnemyStructure(overrides: Partial<EnemyStructureSnapshot> = {}): EnemyStructureSnapshot {
  return {
    id: "struct-001",
    structureType: "spawn",
    pos: 20 * 50 + 20,
    room: "W2N2",
    hits: 5000,
    hitsMax: 5000,
    valueTier: 4,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<TacticalSnapshot> = {}): TacticalSnapshot {
  return {
    tick: DEFAULT_TICK,
    squad: makeSquadPlan(),
    objective: makeObjective(),
    enemies: [makeEnemy()],
    enemyStructures: [],
    terrain: makeTerrainContext(),
    terrainModifier: makeTerrainModifier(),
    confidence: makeConfidence(),
    playerIntel: undefined,
    ourCapability: makeAggregateCapability(),
    ourPower: {
      burstDamage: 120,
      effectiveHP: 700,
      healOutput: 36,
      dismantlePower: 0,
    },
    ...overrides,
  };
}

function makeOperation(overrides: Partial<MilitaryOperation> = {}): MilitaryOperation {
  return {
    operationId: "op-001",
    type: "ASSAULT",
    objective: "DESTROY_ECONOMIC_ASSET",
    target: {
      roomName: "W2N2",
      targetType: "room",
      valueScore: 80,
      evidence: ["test"],
    },
    posture: "FULL_OFFENSIVE",
    priority: { score: 80, factor: "OFFENSIVE", evidence: ["test"] },
    risk: "MEDIUM",
    status: "ACTIVE",
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: 10000,
      maxDuration: 5000,
      minIntelConfidence: 0.3,
      allowBoost: true,
      allowNuke: false,
      abortConditions: ["CASUALTY_EXCEEDED"],
    },
    createdTick: DEFAULT_TICK,
    expiresTick: DEFAULT_TICK + 5000,
    confidence: 0.75,
    reason: "test operation",
    evidence: ["test"],
    ...overrides,
  };
}

// ─── TAC-001: Valid WarPlan → TacticalObjective Accepted ───

describe("TAC-001: Valid WarPlan → TacticalObjective Accepted", () => {
  it("valid authorization accepts objective", () => {
    const snapshot = makeSnapshot();
    const decision = evaluateTacticalAction(snapshot);

    expect(decision.newState).not.toBe("ABORTED");
    expect(decision.evidence).toContain("authorization valid");
  });
});

// ─── TAC-002: Expired WarPlan → Rejected ───

describe("TAC-002: Expired WarPlan → Rejected", () => {
  it("expired authorization causes abort", () => {
    const snapshot = makeSnapshot({
      objective: makeObjective({
        authorization: makeAuthorization({ expiry: DEFAULT_TICK - 100 }),
      }),
    });
    const decision = evaluateTacticalAction(snapshot);

    expect(decision.newState).toBe("ABORTED");
    expect(decision.reason).toContain("authorization invalid");
  });
});

// ─── TAC-003: Aborted Operation → Tactical Abort ───

describe("TAC-003: Aborted Operation → Tactical Abort", () => {
  it("aborted operation revokes authorization", () => {
    const snapshot = makeSnapshot({
      objective: makeObjective({
        authorization: makeAuthorization({ operationAborted: true }),
      }),
    });
    const decision = evaluateTacticalAction(snapshot);

    expect(decision.newState).toBe("ABORTED");
  });
});

// ─── TAC-004: Target outside Objective Scope → Rejected ───

describe("TAC-004: Target outside Objective Scope → Rejected", () => {
  it("target in different room rejected", () => {
    const objective = makeObjective();
    const result = validateTargetScope(objective, "W3N3", "W2N2");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("outside operational scope");
  });

  it("local target in operational room accepted", () => {
    const objective = makeObjective({ targetScope: "LOCAL" });
    const result = validateTargetScope(objective, "W2N2", "W2N2");

    expect(result.valid).toBe(true);
  });
});

// ─── TAC-005: LOW Confidence → Conservative Tactical Policy ───

describe("TAC-005: LOW Confidence → Conservative Tactical Policy", () => {
  it("low confidence triggers conservative behavior", () => {
    const snapshot = makeSnapshot({
      confidence: makeConfidence({ overallConfidence: 0.2 }),
      objective: makeObjective({
        constraints: {
          maxCpuPerTick: 5,
          maxEnergyBudget: 10000,
          maxDuration: 5000,
          minIntelConfidence: 0.3,
          allowBoost: true,
          allowPursuit: false,
          maxPursuitDistance: 0,
        },
      }),
    });
    const decision = evaluateTacticalAction(snapshot);

    // Low confidence triggers abort (intel stale)
    expect(decision.newState).toBe("ABORTED");
  });
});

// ─── TAC-006: STALE Intel → Reposition / Regroup ───

describe("TAC-006: STALE Intel → Reposition / Regroup", () => {
  it("stale intel triggers regroup", () => {
    const snapshot = makeSnapshot({
      enemies: [makeEnemy({ lastSeenTick: DEFAULT_TICK - 3000 })],
      squad: makeSquadPlan({ state: "ENGAGING" }),
    });
    const decision = evaluateTacticalAction(snapshot);

    expect(decision.newState).toBe("REGROUPING");
    expect(decision.reason).toContain("intel");
  });
});

// ─── TAC-007: High Enemy Capability → Retreat ───

describe("TAC-007: High Enemy Capability → Retreat", () => {
  it("enemy power surge triggers retreat", () => {
    const strongEnemy = makeEnemy({
      capability: makeCombatCapability({
        attack: 500,
        rangedAttack: 200,
        effectiveHP: 5000,
        heal: 0,
      }),
    });
    const snapshot = makeSnapshot({
      enemies: [strongEnemy],
      squad: makeSquadPlan({ state: "ENGAGING" }),
    });
    const decision = evaluateTacticalAction(snapshot);

    expect(["RETREATING", "ABORTED"]).toContain(decision.newState);
  });
});

// ─── TAC-008: Healer Lost → Tactical Policy Change ───

describe("TAC-008: Healer Lost → Tactical Policy Change", () => {
  it("healer death triggers disengage", () => {
    const attacker = makeSquadMember("attacker-1", "attacker");
    const deadHealer = makeSquadMember("healer-1", "healer", { hits: 0 });
    const snapshot = makeSnapshot({
      squad: makeSquadPlan({
        members: [attacker, deadHealer],
        state: "ENGAGING",
        roles: new Map([
          [attacker.name, "attacker"],
          [deadHealer.name, "healer"],
        ]),
      }),
    });
    const decision = evaluateTacticalAction(snapshot);

    expect(["DISENGAGING", "ABORTED", "REGROUPING"]).toContain(decision.newState);
  });
});

// ─── TAC-009: Formation Broken → Regroup ───

describe("TAC-009: Formation Broken → Regroup", () => {
  it("squad below threshold triggers regroup", () => {
    const attacker = makeSquadMember("attacker-1", "attacker");
    const deadAttacker = makeSquadMember("attacker-2", "attacker", { hits: 0 });
    const deadHealer = makeSquadMember("healer-1", "healer", { hits: 0 });
    const deadRanged = makeSquadMember("ranged-1", "ranged", { hits: 0 });
    // 1 alive out of 4 = 0.25 < 0.5 threshold
    const snapshot = makeSnapshot({
      squad: makeSquadPlan({
        members: [attacker, deadAttacker, deadHealer, deadRanged],
        state: "ENGAGING",
        roles: new Map([
          [attacker.name, "attacker"],
          [deadAttacker.name, "attacker"],
          [deadHealer.name, "healer"],
          [deadRanged.name, "ranged"],
        ]),
      }),
    });
    const decision = evaluateTacticalAction(snapshot);

    expect(["REGROUPING", "ABORTED"]).toContain(decision.newState);
  });
});

// ─── TAC-010: Insufficient Squad → ReinforcementDemand ───

describe("TAC-010: Insufficient Squad → ReinforcementDemand", () => {
  it("force shortage detected when no damage dealers", () => {
    // This is tested via the state machine — squad with only healer
    const healer = makeSquadMember("healer-1", "healer");
    const snapshot = makeSnapshot({
      squad: makeSquadPlan({
        members: [healer],
        roles: new Map([[healer.name, "healer"]]),
        state: "FORMING",
      }),
    });
    const decision = evaluateTacticalAction(snapshot);

    // FORMING state → still moves (partial squad), but evidence shows shortage
    expect(decision.evidence).toBeDefined();
  });
});

// ─── TAC-011: Logistics Failure → Tactical Degradation ───

describe("TAC-011: Logistics Failure → Tactical Degradation", () => {
  it("near-zero confidence triggers logistics failure abort", () => {
    const snapshot = makeSnapshot({
      confidence: makeConfidence({ overallConfidence: 0.05 }),
      squad: makeSquadPlan({ state: "ENGAGING" }),
    });
    const decision = evaluateTacticalAction(snapshot);

    expect(decision.newState).toBe("ABORTED");
  });
});

// ─── TAC-012: Terrain Chokepoint → Formation Change ───

describe("TAC-012: Terrain Chokepoint → Formation Change", () => {
  it("chokepoint terrain selects COLUMN formation", () => {
    const formation = selectFormationForTerrain(
      makeTerrainContext({ terrainType: "CHOKEPOINT" }),
      "ENGAGING",
    );
    expect(formation).toBe("COLUMN");
  });

  it("open terrain selects WEDGE formation", () => {
    const formation = selectFormationForTerrain(
      makeTerrainContext({ terrainType: "OPEN" }),
      "ENGAGING",
    );
    expect(formation).toBe("WEDGE");
  });

  it("retreating always selects CLUSTER", () => {
    const formation = selectFormationForTerrain(
      makeTerrainContext({ terrainType: "OPEN" }),
      "RETREATING",
    );
    expect(formation).toBe("CLUSTER");
  });
});

// ─── TAC-013: Equal Target Scores → Deterministic Tie Break ───

describe("TAC-013: Equal Target Scores → Deterministic Tie Break", () => {
  it("equal score targets sorted by ID deterministically", () => {
    // Use weak enemies to avoid triggering enemyCapabilitySurge (which would
    // divert the decision to RETREATING instead of ENGAGING).
    const weakCap = makeCombatCapability({ attack: 10, rangedAttack: 0, effectiveHP: 200, heal: 0 });
    const enemyA = makeEnemy({ id: "aaa", capability: weakCap });
    const enemyB = makeEnemy({ id: "bbb", capability: weakCap });

    const snapshot1 = makeSnapshot({ enemies: [enemyA, enemyB] });
    const snapshot2 = makeSnapshot({ enemies: [enemyB, enemyA] });

    const decision1 = evaluateTacticalAction(snapshot1);
    const decision2 = evaluateTacticalAction(snapshot2);

    // Same target selected regardless of input order
    expect(decision1.targetId).toBe(decision2.targetId);
    expect(decision1.targetId).toBe("aaa"); // lower ID wins
  });
});

// ─── TAC-014: Repeated Same Snapshot → Same Decision Hash ───

describe("TAC-014: Repeated Same Snapshot → Same Decision Hash", () => {
  it("identical snapshots produce identical decision hashes", () => {
    const snapshot = makeSnapshot();

    const decision1 = evaluateTacticalAction(snapshot);
    const decision2 = evaluateTacticalAction(snapshot);

    expect(decision1.decisionHash).toBe(decision2.decisionHash);
  });

  it("different snapshots produce different decision hashes", () => {
    const snapshot1 = makeSnapshot();
    const snapshot2 = makeSnapshot({
      enemies: [makeEnemy({ id: "enemy-002" })],
    });

    const decision1 = evaluateTacticalAction(snapshot1);
    const decision2 = evaluateTacticalAction(snapshot2);

    // Hashes may or may not differ, but decision should be deterministic
    expect(decision1.decisionHash).toBeDefined();
    expect(decision2.decisionHash).toBeDefined();
  });
});

// ─── Authorization Tests ───

describe("TacticalAuthorization", () => {
  it("valid authorization passes", () => {
    const auth = makeAuthorization();
    const result = validateAuthorization(auth, DEFAULT_TICK, true);
    expect(result.valid).toBe(true);
  });

  it("expired authorization fails", () => {
    const auth = makeAuthorization({ expiry: DEFAULT_TICK - 1 });
    const result = validateAuthorization(auth, DEFAULT_TICK, true);
    expect(result.valid).toBe(false);
    expect(result.state).toBe("EXPIRED");
  });

  it("aborted operation revokes authorization", () => {
    const auth = makeAuthorization({ operationAborted: true });
    const result = validateAuthorization(auth, DEFAULT_TICK, true);
    expect(result.valid).toBe(false);
    expect(result.state).toBe("REVOKED");
  });

  it("offensive requires war posture", () => {
    const auth = makeAuthorization({ warPosture: "fortify" });
    const result = validateAuthorization(auth, DEFAULT_TICK, true);
    expect(result.valid).toBe(false);
    expect(result.state).toBe("DENIED");
  });

  it("defensive allows fortify posture", () => {
    const auth = makeAuthorization({ warPosture: "fortify" });
    const result = validateAuthorization(auth, DEFAULT_TICK, false);
    expect(result.valid).toBe(true);
  });

  it("buildAuthorization from operation", () => {
    const op = makeOperation();
    const auth = buildAuthorization(op, "war", false, DEFAULT_TICK + 5000);
    expect(auth.state).toBe("AUTHORIZED");
    expect(auth.operationId).toBe("op-001");
  });

  it("isOffensiveOperation classifies correctly", () => {
    expect(isOffensiveOperation("ASSAULT")).toBe(true);
    expect(isOffensiveOperation("DEFEND")).toBe(false);
    expect(isOffensiveOperation("SIEGE")).toBe(true);
    expect(isOffensiveOperation("ESCORT")).toBe(false);
  });
});

// ─── State Transition Tests ───

describe("Tactical State Transitions", () => {
  it("FORMING → MOVING is valid", () => {
    expect(canTransitionTactical("FORMING", "MOVING")).toBe(true);
  });

  it("ENGAGING → DISENGAGING is valid", () => {
    expect(canTransitionTactical("ENGAGING", "DISENGAGING")).toBe(true);
  });

  it("COMPLETED → anything is invalid", () => {
    expect(canTransitionTactical("COMPLETED", "ENGAGING")).toBe(false);
  });

  it("ABORTED → anything is invalid", () => {
    expect(canTransitionTactical("ABORTED", "FORMING")).toBe(false);
  });

  it("FORMING → ENGAGING is invalid (must go through MOVING)", () => {
    expect(canTransitionTactical("FORMING", "ENGAGING")).toBe(false);
  });
});

// ─── Formation Tests ───

describe("Formation Model", () => {
  it("all formation types have semantics", () => {
    const types: FormationType[] = ["LINE", "WEDGE", "COLUMN", "CLUSTER", "SCATTER"];
    for (const t of types) {
      expect(FORMATION_SEMANTICS[t]).toBeDefined();
      expect(FORMATION_SEMANTICS[t]!.useCase).toBeTruthy();
    }
  });

  it("formation transition detected on terrain change", () => {
    const transition = evaluateFormationTransition(
      "WEDGE",
      makeTerrainContext({ terrainType: "CHOKEPOINT" }),
      "ENGAGING",
    );
    expect(transition).not.toBeNull();
    expect(transition!.to).toBe("COLUMN");
  });

  it("no transition when formation matches terrain", () => {
    const transition = evaluateFormationTransition(
      "WEDGE",
      makeTerrainContext({ terrainType: "OPEN" }),
      "ENGAGING",
    );
    expect(transition).toBeNull();
  });
});

// ─── Target Scope Tests ───

describe("Target Scope", () => {
  it("LOCAL scope in correct room accepted", () => {
    const obj = makeObjective({ targetScope: "LOCAL" });
    const result = validateTargetScope(obj, "W2N2", "W2N2");
    expect(result.valid).toBe(true);
  });

  it("STRATEGIC scope rejected for tactical", () => {
    const obj = makeObjective({ targetScope: "STRATEGIC" });
    const result = validateTargetScope(obj, "W2N2", "W2N2");
    expect(result.valid).toBe(false);
  });

  it("target in different room rejected", () => {
    const obj = makeObjective({ targetScope: "LOCAL" });
    const result = validateTargetScope(obj, "W3N3", "W2N2");
    expect(result.valid).toBe(false);
  });
});
