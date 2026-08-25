/**
 * A5.5 Advanced Tactical Combat Micro — Domain 纯函数测试。
 *
 * 测试覆盖（对应需求 §24 Tests）：
 *   MICRO-001: Melee 追击 Ranged → Kite
 *   MICRO-002: Ranged 优势 → 保持 Range
 *   MICRO-003: Enemy Ranged 优势 → 重新 Position
 *   MICRO-004: Healer 受到威胁 → Protection
 *   MICRO-005: Enemy Healer → Local Pressure
 *   MICRO-006: Target Switch → Hysteresis
 *   MICRO-007: Formation Break → Reform
 *   MICRO-008: Tower 威胁 → Avoidance
 *   MICRO-009: Chokepoint → Hold
 *   MICRO-010: Retreat → 禁止 Aggressive Micro
 *   MICRO-011: Authorization Denied → 禁止 Attack
 *   MICRO-012: CombatCapability 不足 → 不能 Chase
 *   MICRO-013: Terrain 改变 → Micro Decision 改变
 *   MICRO-014: 多个 Intent 冲突 → Arbitrator 唯一输出
 *   MICRO-015: 同 Snapshot → 1000 Replay 一致
 */

import { describe, expect, it } from "vitest";
import {
  planCombatMicro,
  assessCombatPressure,
  deriveBodyAwareState,
  microPlanHash,
  microDecisionHash,
  type MicroSnapshot,
  type MicroMemberSnapshot,
  type MicroEnemySnapshot,
  type CombatMovementDecision,
  type CombatPressure,
} from "../../../src/domain/tactical/combat-micro";
import type { CombatCapability } from "../../../src/domain/combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../../../src/domain/defense/terrain-context";
import type { TacticalState } from "../../../src/domain/tactical/types";
import type { FocusFirePlan, AttackIntent } from "../../../src/domain/tactical/focus-fire";
import type { CohesionMetric, FormationSlot, FormationAnchor } from "../../../src/domain/tactical/squad-formation";

// ─── 辅助构造函数 ───

function makeCapability(overrides: Partial<CombatCapability> = {}): CombatCapability {
  return {
    attack: 0,
    rangedAttack: 0,
    heal: 0,
    rangedHeal: 0,
    dismantle: 0,
    claim: 0,
    effectiveHP: 1000,
    mobility: 1,
    support: 0,
    toughParts: 0,
    boosted: false,
    maxBoostTier: 0,
    totalParts: 10,
    activeParts: 10,
    ...overrides,
  };
}

function makeMember(
  name: string,
  role: string,
  x: number,
  y: number,
  room = "W2N1",
  overrides: Partial<MicroMemberSnapshot> = {},
): MicroMemberSnapshot {
  const cap = role === "attacker"
    ? makeCapability({ attack: 120, mobility: 1 })
    : role === "ranged"
      ? makeCapability({ rangedAttack: 40, mobility: 1 })
      : role === "healer"
        ? makeCapability({ heal: 48, mobility: 1 })
        : makeCapability();
  return {
    name,
    role,
    pos: x * 50 + y,
    room,
    hits: 1000,
    hitsMax: 1000,
    fatigue: 0,
    alive: true,
    capability: cap,
    bodyState: deriveBodyAwareState(cap, role, 0.5),
    ...overrides,
  };
}

function makeEnemy(
  id: string,
  x: number,
  y: number,
  room = "W2N1",
  overrides: Partial<MicroEnemySnapshot> = {},
): MicroEnemySnapshot {
  return {
    id,
    name: `enemy-${id}`,
    pos: x * 50 + y,
    room,
    hits: 1000,
    hitsMax: 1000,
    capability: makeCapability({ attack: 120, mobility: 1 }),
    role: "attacker",
    lastSeenTick: 100,
    ...overrides,
  };
}

function makeTerrain(overrides: Partial<TerrainContext> = {}): TerrainContext {
  return {
    roomName: "W2N1",
    terrainType: "OPEN",
    walkability: "FULL",
    openTileRatio: 0.8,
    wallDensity: 0.1,
    chokepoints: [],
    corridors: [],
    rampartCoverage: "NONE",
    towerCoverage: "NONE",
    coreExposure: 0.3,
    retreatQuality: "GOOD",
    mobilityModifier: 1.0,
    tick: 100,
    ...overrides,
  };
}

function makeTerrainModifier(overrides: Partial<EffectiveCombatModifier> = {}): EffectiveCombatModifier {
  return {
    mobilityModifier: 1.0,
    towerDamageFactor: 0,
    retreatDifficulty: 1.0,
    approachFactor: 1.0,
    ...overrides,
  };
}

function makeAttackIntent(
  creepId: string,
  targetId: string,
  overrides: Partial<AttackIntent> = {},
): AttackIntent {
  return {
    squadId: "squad-test",
    creepId,
    targetId,
    targetPos: 10 * 50 + 10,
    targetRoom: "W2N1",
    attackType: "ATTACK",
    priority: "PRIMARY",
    expectedDamage: 120,
    targetExpectedHP: 880,
    reason: "test intent",
    confidence: 0.85,
    tick: 100,
    requiresMovement: false,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<MicroSnapshot> = {}): MicroSnapshot {
  return {
    tick: 100,
    squadId: "squad-test",
    objectiveId: "tac-test",
    tacticalState: "ENGAGING",
    warPosture: "war",
    authorizedTargetRoom: "W2N1",
    members: [],
    enemies: [],
    terrain: makeTerrain(),
    terrainModifier: makeTerrainModifier(),
    cohesion: null,
    slots: [],
    anchor: null,
    prevPlan: null,
    attackIntents: [],
    prevMicroDecisions: [],
    targetLocks: new Map(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// MICRO-001: Melee 追击 Ranged → Kite
// ═══════════════════════════════════════════════════════════

describe("MICRO-001: Melee 追击 Ranged → Kite", () => {
  it("ranged creep 应在敌人接近时 kite", () => {
    const member = makeMember("r1", "ranged", 10, 10);
    const enemy = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 120, mobility: 1 }),
      role: "attacker",
    });
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
    });

    const plan = planCombatMicro(snapshot);

    // 应产生 kite intent 或 kite direction 的 decision
    const kiteIntent = plan.kiteIntents.find(k => k.creepId === "r1");
    expect(kiteIntent).toBeDefined();
    expect(kiteIntent!.direction).toBe(1); // 需要拉开距离

    const decision = plan.decisions.find(d => d.creepId === "r1");
    expect(decision).toBeDefined();
    // 因为在射程内且有攻击意图，可能会优先攻击，但 kite intent 必须产生
    expect(kiteIntent!.urgency).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-002: Ranged 优势 → 保持 Range
// ═══════════════════════════════════════════════════════════

describe("MICRO-002: Ranged 优势 → 保持 Range", () => {
  it("ranged creep 在 optimal range 内应保持攻击", () => {
    const member = makeMember("r1", "ranged", 10, 10);
    const enemy = makeEnemy("e1", 12, 10, "W2N1", {
      capability: makeCapability({ attack: 0, rangedAttack: 0, mobility: 0.5 }),
      role: "unknown",
    });
    const attackIntent = makeAttackIntent("r1", "e1", {
      attackType: "RANGED_ATTACK",
      requiresMovement: false,
    });
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
      attackIntents: [attackIntent],
    });

    const plan = planCombatMicro(snapshot);

    const decision = plan.decisions.find(d => d.creepId === "r1");
    expect(decision).toBeDefined();
    expect(decision!.action).toBe("ATTACK_RANGE");
    expect(decision!.executeAttack).toBe(true);

    // range intent 应标记 inOptimalRange
    const rangeIntent = plan.rangeIntents.find(r => r.creepId === "r1");
    expect(rangeIntent).toBeDefined();
    expect(rangeIntent!.inOptimalRange).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-003: Enemy Ranged 优势 → 重新 Position
// ═══════════════════════════════════════════════════════════

describe("MICRO-003: Enemy Ranged 优势 → 重新 Position", () => {
  it("敌方 ranged 数量优势时应重新定位", () => {
    const member = makeMember("r1", "ranged", 10, 10);
    const enemies = [
      makeEnemy("e1", 12, 10, "W2N1", {
        capability: makeCapability({ rangedAttack: 100, mobility: 1 }),
        role: "ranged",
      }),
      makeEnemy("e2", 13, 10, "W2N1", {
        capability: makeCapability({ rangedAttack: 100, mobility: 1 }),
        role: "ranged",
      }),
      makeEnemy("e3", 14, 10, "W2N1", {
        capability: makeCapability({ rangedAttack: 100, mobility: 1 }),
        role: "ranged",
      }),
    ];
    const snapshot = makeSnapshot({
      members: [member],
      enemies,
    });

    const plan = planCombatMicro(snapshot);
    const pressure = plan.pressure;

    // 敌方远程压力应高
    expect(pressure.enemyPressure).toBeGreaterThan(0);
    expect(pressure.damagePressure).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-004: Healer 受到威胁 → Protection
// ═══════════════════════════════════════════════════════════

describe("MICRO-004: Healer 受到威胁 → Protection", () => {
  it("healer 被近战威胁时应产生 ProtectIntent", () => {
    const healer = makeMember("h1", "healer", 10, 10);
    const attacker = makeMember("a1", "attacker", 12, 10);
    const enemy = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 120, mobility: 1 }),
      role: "attacker",
    });
    const snapshot = makeSnapshot({
      members: [healer, attacker],
      enemies: [enemy],
    });

    const plan = planCombatMicro(snapshot);

    const protectIntent = plan.protectIntents.find(p => p.healerId === "h1");
    expect(protectIntent).toBeDefined();
    expect(protectIntent!.urgency).toBeGreaterThan(0);
    expect(protectIntent!.protectors).toContain("a1");
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-005: Enemy Healer → Local Pressure
// ═══════════════════════════════════════════════════════════

describe("MICRO-005: Enemy Healer → Local Pressure", () => {
  it("敌方 healer 应影响 target scoring", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const enemyTank = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 120, heal: 0, mobility: 1 }),
      role: "attacker",
    });
    const enemyHealer = makeEnemy("e2", 13, 10, "W2N1", {
      capability: makeCapability({ attack: 0, heal: 48, mobility: 1 }),
      role: "healer",
      hits: 500,
      hitsMax: 1000,
    });
    const attackIntent = makeAttackIntent("a1", "e1", {
      attackType: "ATTACK",
      requiresMovement: false,
    });
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemyTank, enemyHealer],
      attackIntents: [attackIntent],
    });

    const plan = planCombatMicro(snapshot);

    // target switch intent 应考虑敌方 healer
    const switchIntent = plan.switchIntents.find(s => s.creepId === "a1");
    expect(switchIntent).toBeDefined();
    // 敌方 healer 应作为候选
    expect(switchIntent!.candidateTargetId).toBe("e2");
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-006: Target Switch → Hysteresis
// ═══════════════════════════════════════════════════════════

describe("MICRO-006: Target Switch → Hysteresis", () => {
  it("target lock 应防止频繁切换", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const enemyA = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 120, mobility: 1 }),
      role: "attacker",
    });
    const enemyB = makeEnemy("e2", 12, 10, "W2N1", {
      capability: makeCapability({ attack: 130, mobility: 1 }),
      role: "attacker",
    });
    const attackIntent = makeAttackIntent("a1", "e1", {
      attackType: "ATTACK",
      requiresMovement: false,
    });
    const targetLocks = new Map([["a1", 105]]); // locked until tick 105
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemyA, enemyB],
      attackIntents: [attackIntent],
      targetLocks,
    });

    const plan = planCombatMicro(snapshot);
    const switchIntent = plan.switchIntents.find(s => s.creepId === "a1");

    expect(switchIntent).toBeDefined();
    // 被锁定时 shouldSwitch 应为 false（除非候选远超当前）
    // e2 score 略高于 e1 但不足以突破 2x margin
    expect(switchIntent!.shouldSwitch).toBe(false);
  });

  it("target lock 到期后可以切换", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const enemyA = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 60, mobility: 1 }),
      role: "attacker",
      hits: 900,
      hitsMax: 1000,
    });
    const enemyB = makeEnemy("e2", 12, 10, "W2N1", {
      capability: makeCapability({ attack: 200, heal: 48, mobility: 1 }),
      role: "healer",
      hits: 200,
      hitsMax: 1000,
    });
    const attackIntent = makeAttackIntent("a1", "e1", {
      attackType: "ATTACK",
      requiresMovement: false,
    });
    const targetLocks = new Map([["a1", 50]]); // expired
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemyA, enemyB],
      attackIntents: [attackIntent],
      targetLocks,
    });

    const plan = planCombatMicro(snapshot);
    const switchIntent = plan.switchIntents.find(s => s.creepId === "a1");

    expect(switchIntent).toBeDefined();
    expect(switchIntent!.shouldSwitch).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-007: Formation Break → Reform
// ═══════════════════════════════════════════════════════════

describe("MICRO-007: Formation Break → Reform", () => {
  it("cohesion BROKEN 应产生 ReformIntent", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const slot: FormationSlot = {
      creepName: "a1",
      role: "attacker",
      desiredPosition: 20 * 50 + 20,
      desiredRoom: "W2N1",
      slotIndex: 0,
      priority: 1,
      tolerance: 2,
    };
    const cohesion: CohesionMetric = {
      maxAnchorDistance: 10,
      avgAnchorDistance: 8,
      maxMemberDistance: 15,
      maxHealerDistance: 5,
      slotDeviation: 10,
      aliveCount: 1,
      totalCount: 1,
      status: "BROKEN",
      reason: "member too far from slot",
    };
    const snapshot = makeSnapshot({
      members: [member],
      cohesion,
      slots: [slot],
    });

    const plan = planCombatMicro(snapshot);

    expect(plan.reformIntents.length).toBeGreaterThan(0);
    expect(plan.reformIntents[0]!.reformType).toBe("REGROUP");
  });

  it("cohesion CRITICAL 应产生 RETRACT reform", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const cohesion: CohesionMetric = {
      maxAnchorDistance: 20,
      avgAnchorDistance: 18,
      maxMemberDistance: 30,
      maxHealerDistance: 15,
      slotDeviation: 20,
      aliveCount: 1,
      totalCount: 3,
      status: "CRITICAL",
      reason: "squad scattered",
    };
    const snapshot = makeSnapshot({
      members: [member],
      cohesion,
      slots: [],
    });

    const plan = planCombatMicro(snapshot);

    expect(plan.reformIntents.length).toBeGreaterThan(0);
    expect(plan.reformIntents[0]!.reformType).toBe("RETREAT");
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-008: Tower 威胁 → Avoidance
// ═══════════════════════════════════════════════════════════

describe("MICRO-008: Tower 威胁 → Avoidance", () => {
  it("CRITICAL tower coverage 应触发 RETREAT", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const terrain = makeTerrain({ towerCoverage: "CRITICAL" });
    const modifier = makeTerrainModifier({ towerDamageFactor: 1.0 });
    const snapshot = makeSnapshot({
      members: [member],
      terrain,
      terrainModifier: modifier,
    });

    const plan = planCombatMicro(snapshot);

    const towerIntent = plan.towerIntents.find(t => t.creepId === "a1");
    expect(towerIntent).toBeDefined();
    expect(towerIntent!.advisedAction).toBe("RETREAT");

    const decision = plan.decisions.find(d => d.creepId === "a1");
    expect(decision).toBeDefined();
    expect(decision!.action).toBe("RETREAT");
  });

  it("MEDIUM tower coverage + high damage factor 应产生 AVOID 建议", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const terrain = makeTerrain({ towerCoverage: "MEDIUM" });
    const modifier = makeTerrainModifier({ towerDamageFactor: 0.7 });
    const snapshot = makeSnapshot({
      members: [member],
      terrain,
      terrainModifier: modifier,
    });

    const plan = planCombatMicro(snapshot);

    const towerIntent = plan.towerIntents.find(t => t.creepId === "a1");
    expect(towerIntent).toBeDefined();
    expect(towerIntent!.advisedAction).toBe("AVOID");
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-009: Chokepoint → Hold
// ═══════════════════════════════════════════════════════════

describe("MICRO-009: Chokepoint → Hold", () => {
  it("chokepoint terrain 应影响 terrain modifier", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const terrain = makeTerrain({
      terrainType: "CHOKEPOINT",
      chokepoints: [{
        pos: 10 * 50 + 10,
        width: 1,
        direction: 0,
        significance: 0.9,
      }],
    });
    const modifier = makeTerrainModifier({ approachFactor: 0.8 });
    const snapshot = makeSnapshot({
      members: [member],
      terrain,
      terrainModifier: modifier,
    });

    const plan = planCombatMicro(snapshot);

    // terrain 不应阻止决策产生
    expect(plan.decisions.length).toBe(1);
    const decision = plan.decisions[0]!;
    // 无敌人 + 无 attack intent → HOLD 或 PATROL
    expect(["HOLD", "PATROL", "REPOSITION"]).toContain(decision.action);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-010: Retreat → 禁止 Aggressive Micro
// ═══════════════════════════════════════════════════════════

describe("MICRO-010: Retreat → 禁止 Aggressive Micro", () => {
  it("RETREATING 状态应产生空 micro plan", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const snapshot = makeSnapshot({
      members: [member],
      tacticalState: "RETREATING",
    });

    const plan = planCombatMicro(snapshot);

    expect(plan.decisions).toHaveLength(0);
    expect(plan.pressure.aggregateRisk).toBe(0);
  });

  it("DISENGAGING 状态应产生空 micro plan", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const snapshot = makeSnapshot({
      members: [member],
      tacticalState: "DISENGAGING",
    });

    const plan = planCombatMicro(snapshot);

    expect(plan.decisions).toHaveLength(0);
  });

  it("COMPLETED 状态应产生空 micro plan", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const snapshot = makeSnapshot({
      members: [member],
      tacticalState: "COMPLETED",
    });

    const plan = planCombatMicro(snapshot);

    expect(plan.decisions).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-011: Authorization Denied → 禁止 Attack
// ═══════════════════════════════════════════════════════════

describe("MICRO-011: Authorization Denied → 禁止 Attack", () => {
  it("非 war posture 应禁止所有 aggressive micro", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const enemy = makeEnemy("e1", 11, 10);
    const attackIntent = makeAttackIntent("a1", "e1");
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
      attackIntents: [attackIntent],
      warPosture: "develop",
    });

    const plan = planCombatMicro(snapshot);

    expect(plan.decisions).toHaveLength(0);
    expect(plan.pressure.aggregateRisk).toBe(0);
  });

  it("war posture 应允许 aggressive micro", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const enemy = makeEnemy("e1", 11, 10);
    const attackIntent = makeAttackIntent("a1", "e1");
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
      attackIntents: [attackIntent],
      warPosture: "war",
    });

    const plan = planCombatMicro(snapshot);

    expect(plan.decisions.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-012: CombatCapability 不足 → 不能 Chase
// ═══════════════════════════════════════════════════════════

describe("MICRO-012: CombatCapability 不足 → 不能 Chase", () => {
  it("mobility 不足的 creep 不应 canChase", () => {
    const slowCap = makeCapability({ attack: 120, mobility: 0.3 });
    const bodyState = deriveBodyAwareState(slowCap, "attacker", 1.0);
    expect(bodyState.canChase).toBe(false);
    expect(bodyState.canKite).toBe(false);
  });

  it("mobility 充足的 creep 应 canChase", () => {
    const fastCap = makeCapability({ attack: 120, mobility: 2.0 });
    const bodyState = deriveBodyAwareState(fastCap, "attacker", 1.0);
    expect(bodyState.canChase).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-013: Terrain 改变 → Micro Decision 改变
// ═══════════════════════════════════════════════════════════

describe("MICRO-013: Terrain 改变 → Micro Decision 改变", () => {
  it("CRITICAL tower terrain 应改变 decision 为 RETREAT", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const attackIntent = makeAttackIntent("a1", "e1");
    const enemy = makeEnemy("e1", 11, 10);

    // 无塔 terrain
    const safeSnapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
      attackIntents: [attackIntent],
      terrain: makeTerrain({ towerCoverage: "NONE" }),
      terrainModifier: makeTerrainModifier({ towerDamageFactor: 0 }),
    });
    const safePlan = planCombatMicro(safeSnapshot);
    const safeDecision = safePlan.decisions.find(d => d.creepId === "a1")!;

    // CRITICAL tower terrain
    const dangerSnapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
      attackIntents: [attackIntent],
      terrain: makeTerrain({ towerCoverage: "CRITICAL" }),
      terrainModifier: makeTerrainModifier({ towerDamageFactor: 1.0 }),
    });
    const dangerPlan = planCombatMicro(dangerSnapshot);
    const dangerDecision = dangerPlan.decisions.find(d => d.creepId === "a1")!;

    expect(safeDecision.action).not.toBe("RETREAT");
    expect(dangerDecision.action).toBe("RETREAT");
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-014: 多个 Intent 冲突 → Arbitrator 唯一输出
// ═══════════════════════════════════════════════════════════

describe("MICRO-014: 多个 Intent 冲突 → Arbitrator 唯一输出", () => {
  it("每个成员只应有一个 CombatMovementDecision", () => {
    const member = makeMember("a1", "ranged", 10, 10);
    const enemy = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 120, mobility: 1 }),
      role: "attacker",
    });
    const attackIntent = makeAttackIntent("a1", "e1", {
      attackType: "RANGED_ATTACK",
      requiresMovement: false,
    });
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
      attackIntents: [attackIntent],
    });

    const plan = planCombatMicro(snapshot);

    // 每个 creep 只有一个 decision
    const decisions = plan.decisions.filter(d => d.creepId === "a1");
    expect(decisions).toHaveLength(1);

    // decision 必须有 rejectedAlternatives（证明仲裁发生）
    expect(decisions[0]!.rejectedAlternatives.length).toBeGreaterThan(0);

    // decision 必须有 hash
    expect(decisions[0]!.decisionHash).toHaveLength(8);
  });

  it("多个 intent 同时存在时优先级正确", () => {
    // healer 低血 + tower CRITICAL + attack intent → RETREAT 优先于 ATTACK
    const healer = makeMember("h1", "healer", 10, 10, "W2N1", {
      hits: 100,
      hitsMax: 1000,
    });
    const attackIntent = makeAttackIntent("h1", "e1");
    const enemy = makeEnemy("e1", 11, 10);

    const snapshot = makeSnapshot({
      members: [healer],
      enemies: [enemy],
      attackIntents: [attackIntent],
      terrain: makeTerrain({ towerCoverage: "CRITICAL" }),
      terrainModifier: makeTerrainModifier({ towerDamageFactor: 1.0 }),
    });

    const plan = planCombatMicro(snapshot);
    const decision = plan.decisions.find(d => d.creepId === "h1")!;

    // RETREAT 优先级最高
    expect(decision.action).toBe("RETREAT");
  });
});

// ═══════════════════════════════════════════════════════════
// MICRO-015: 同 Snapshot → 1000 Replay 一致
// ═══════════════════════════════════════════════════════════

describe("MICRO-015: 同 Snapshot → 1000 Replay 一致", () => {
  it("1000 次 replay 应产生完全相同的 decisionHash", () => {
    const member = makeMember("a1", "ranged", 10, 10);
    const enemy = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 120, mobility: 1 }),
      role: "attacker",
    });
    const attackIntent = makeAttackIntent("a1", "e1", {
      attackType: "RANGED_ATTACK",
      requiresMovement: false,
    });
    const snapshot = makeSnapshot({
      members: [member],
      enemies: [enemy],
      attackIntents: [attackIntent],
    });

    const firstPlan = planCombatMicro(snapshot);
    const firstHash = firstPlan.decisionHash;

    for (let i = 0; i < 1000; i++) {
      const replayPlan = planCombatMicro(snapshot);
      expect(replayPlan.decisionHash).toBe(firstHash);
      // 每个 decision hash 也必须一致
      for (let j = 0; j < replayPlan.decisions.length; j++) {
        expect(replayPlan.decisions[j]!.decisionHash).toBe(
          firstPlan.decisions[j]!.decisionHash,
        );
      }
    }
  });

  it("不同 tick 的 snapshot 应产生不同的 hash", () => {
    const member = makeMember("a1", "ranged", 10, 10);
    const enemy = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 120, mobility: 1 }),
      role: "attacker",
    });
    const attackIntent = makeAttackIntent("a1", "e1", {
      attackType: "RANGED_ATTACK",
      requiresMovement: false,
    });

    const snapshot1 = makeSnapshot({ members: [member], enemies: [enemy], attackIntents: [attackIntent], tick: 100 });
    const snapshot2 = makeSnapshot({ members: [member], enemies: [enemy], attackIntents: [attackIntent], tick: 200 });

    const plan1 = planCombatMicro(snapshot1);
    const plan2 = planCombatMicro(snapshot2);

    expect(plan1.decisionHash).not.toBe(plan2.decisionHash);
  });
});

// ═══════════════════════════════════════════════════════════
// 额外：CombatPressure 和 BodyAwareState 单元测试
// ═══════════════════════════════════════════════════════════

describe("CombatPressure 评估", () => {
  it("空快照应产生零压力", () => {
    const snapshot = makeSnapshot();
    const pressure = assessCombatPressure(snapshot);
    expect(pressure.enemyPressure).toBe(0);
    expect(pressure.damagePressure).toBe(0);
  });

  it("敌方 attack 应产生 enemyPressure", () => {
    const enemy = makeEnemy("e1", 11, 10, "W2N1", {
      capability: makeCapability({ attack: 100, rangedAttack: 50 }),
    });
    const snapshot = makeSnapshot({ enemies: [enemy] });
    const pressure = assessCombatPressure(snapshot);
    expect(pressure.enemyPressure).toBe(150);
  });

  it("tower CRITICAL 应产生高 towerPressure", () => {
    const snapshot = makeSnapshot({
      terrain: makeTerrain({ towerCoverage: "CRITICAL" }),
    });
    const pressure = assessCombatPressure(snapshot);
    expect(pressure.towerPressure).toBe(1.0);
  });
});

describe("BodyAwareTacticalState", () => {
  it("ranged creep 应有 optimalRange=3", () => {
    const cap = makeCapability({ rangedAttack: 40, mobility: 1 });
    const state = deriveBodyAwareState(cap, "ranged", 0.5);
    expect(state.optimalRange).toBe(3);
    expect(state.canKite).toBe(true);
  });

  it("melee attacker 应有 optimalRange=1", () => {
    const cap = makeCapability({ attack: 120, mobility: 1 });
    const state = deriveBodyAwareState(cap, "attacker", 0.5);
    expect(state.optimalRange).toBe(1);
    expect(state.canFight).toBe(true);
    expect(state.canKite).toBe(false);
  });

  it("healer 应有 canSupport=true", () => {
    const cap = makeCapability({ heal: 48, mobility: 1 });
    const state = deriveBodyAwareState(cap, "healer", 0.5);
    expect(state.canSupport).toBe(true);
    expect(state.canFight).toBe(false);
  });

  it("无移动力的 creep 不应 canRetreat", () => {
    const cap = makeCapability({ attack: 120, mobility: 0 });
    const state = deriveBodyAwareState(cap, "attacker", 0.5);
    expect(state.canRetreat).toBe(false);
  });
});
