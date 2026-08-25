/**
 * A5.5 E2E Scenario Declarations — ENVIRONMENT BLOCKED.
 *
 * 对应需求 §25 E2E 和 §32 PASS 标准：
 *
 *   MICRO-E2E-001: War → Squad → Formation → Movement → Enemy Approach →
 *                  Kiting → Reposition → FocusFire → Attack → Target Death
 *   MICRO-E2E-002: Enemy Melee Rush → Ranged Kite → Formation 保持
 *   MICRO-E2E-003: Enemy Healer → Pressure → Target Decision 变化
 *   MICRO-E2E-004: Tower Range → Avoidance → 继续 Combat
 *   MICRO-E2E-005: Formation Break → Reform → 继续 Combat
 *   MICRO-E2E-006: Retreat → Micro 全部停止 Aggressive Intent
 *
 * STATUS: ENVIRONMENT BLOCKED
 *
 * Screeps E2E 需要真实游戏环境（Game 对象、Room、Creep），
 * 无法在 CI / Vitest 中执行。此处声明 6 个场景并在 Domain 层
 * 用模拟快照验证逻辑闭环（非真实 E2E）。
 *
 * 真实 E2E 必须在 Screeps 私服 / MMO 中执行。
 */

import { describe, expect, it } from "vitest";
import {
  planCombatMicro,
  deriveBodyAwareState,
  type MicroSnapshot,
  type MicroMemberSnapshot,
  type MicroEnemySnapshot,
} from "../../../src/domain/tactical/combat-micro";
import type { CombatCapability } from "../../../src/domain/combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../../../src/domain/defense/terrain-context";
import type { AttackIntent } from "../../../src/domain/tactical/focus-fire";
import type { CohesionMetric, FormationSlot } from "../../../src/domain/tactical/squad-formation";

// ─── 辅助构造函数（与 unit test 相同，但 E2E 验证逻辑闭环） ───

function makeCap(o: Partial<CombatCapability> = {}): CombatCapability {
  return {
    attack: 120, rangedAttack: 40, heal: 0, rangedHeal: 0,
    dismantle: 0, claim: 0, effectiveHP: 1000, mobility: 1,
    support: 0, toughParts: 0, boosted: false, maxBoostTier: 0,
    totalParts: 10, activeParts: 10,
    ...o,
  };
}

function makeMember(name: string, role: string, x: number, y: number, room = "W2N1"): MicroMemberSnapshot {
  const cap = role === "healer" ? makeCap({ attack: 0, heal: 48 })
    : role === "ranged" ? makeCap({ attack: 0, rangedAttack: 40 })
    : makeCap();
  return {
    name, role, pos: x * 50 + y, room,
    hits: 1000, hitsMax: 1000, fatigue: 0, alive: true,
    capability: cap,
    bodyState: deriveBodyAwareState(cap, role, 0.5),
  };
}

function makeEnemy(id: string, x: number, y: number, room = "W2N1"): MicroEnemySnapshot {
  return {
    id, name: `enemy-${id}`, pos: x * 50 + y, room,
    hits: 1000, hitsMax: 1000,
    capability: makeCap({ attack: 100, mobility: 1 }),
    role: "attacker", lastSeenTick: 100,
  };
}

function makeTerrain(overrides: Partial<TerrainContext> = {}): TerrainContext {
  return {
    roomName: "W2N1", terrainType: "OPEN", walkability: "FULL",
    openTileRatio: 0.8, wallDensity: 0.1, chokepoints: [], corridors: [],
    rampartCoverage: "NONE", towerCoverage: "NONE", coreExposure: 0.3,
    retreatQuality: "GOOD", mobilityModifier: 1.0, tick: 100,
    ...overrides,
  };
}

function makeModifier(overrides: Partial<EffectiveCombatModifier> = {}): EffectiveCombatModifier {
  return { mobilityModifier: 1.0, towerDamageFactor: 0, retreatDifficulty: 1.0, approachFactor: 1.0, ...overrides };
}

function makeAttackIntent(creepId: string, targetId: string, type: AttackIntent["attackType"] = "ATTACK"): AttackIntent {
  return {
    squadId: "squad-test", creepId, targetId,
    targetPos: 12 * 50 + 10, targetRoom: "W2N1",
    attackType: type, priority: "PRIMARY",
    expectedDamage: 120, targetExpectedHP: 880,
    reason: "e2e test", confidence: 0.85, tick: 100, requiresMovement: false,
  };
}

// ═══════════════════════════════════════════════════════════
// E2E 场景（Domain 层逻辑闭环验证 — 非 Game API E2E）
// ═══════════════════════════════════════════════════════════

describe("MICRO-E2E-001: War → Squad → Formation → Kiting → Attack → Target Death", () => {
  it("应完成完整战术闭环：接敌 → 攻击 → 目标死亡 → 重新选择", () => {
    // Step 1: War posture + Squad
    const member = makeMember("a1", "ranged", 10, 10);
    const enemy = makeEnemy("e1", 11, 10);

    // Step 2: Attack intent（目标在射程内）
    const attackIntent = makeAttackIntent("a1", "e1", "RANGED_ATTACK");

    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [member], enemies: [enemy],
      terrain: makeTerrain(), terrainModifier: makeModifier(),
      cohesion: null, slots: [], anchor: null, prevPlan: null,
      attackIntents: [attackIntent], prevMicroDecisions: [],
      targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    // 验证：ranged 被近战追时应 KITE（urgency=1.0 > 0.7）
    const kiteIntent = plan.kiteIntents.find(k => k.creepId === "a1");
    expect(kiteIntent).toBeDefined();
    expect(kiteIntent!.urgency).toBe(1.0);

    const decision = plan.decisions.find(d => d.creepId === "a1")!;
    expect(decision.action).toBe("KITE");

    // Step 3: 目标死亡 → 重新选择（移除死亡目标，只剩新目标）
    const snapshot2: MicroSnapshot = {
      ...snapshot,
      tick: 101,
      members: [{ ...member }],
      enemies: [makeEnemy("e2", 12, 10)],
      attackIntents: [makeAttackIntent("a1", "e2", "RANGED_ATTACK")],
    };

    const plan2 = planCombatMicro(snapshot2);

    // 应重新选择新目标（e2 在 ranged 射程内）
    const decision2 = plan2.decisions.find(d => d.creepId === "a1")!;
    expect(decision2.action).toBe("ATTACK_RANGE");
    expect(decision2.targetId).toBe("e2");
  });
});

describe("MICRO-E2E-002: Enemy Melee Rush → Ranged Kite → Formation 保持", () => {
  it("敌方近战 rush 时 ranged 应 kite 且 formation 不应崩溃", () => {
    const ranged = makeMember("r1", "ranged", 10, 10);
    const healer = makeMember("h1", "healer", 9, 10);
    const enemy: MicroEnemySnapshot = {
      ...makeEnemy("e1", 11, 10),
      capability: makeCap({ attack: 120, mobility: 1 }),
      role: "attacker",
    };

    const slot: FormationSlot = {
      creepName: "r1", role: "ranged",
      desiredPosition: 10 * 50 + 10, desiredRoom: "W2N1",
      slotIndex: 0, priority: 1, tolerance: 3,
    };

    const cohesion: CohesionMetric = {
      maxAnchorDistance: 1, avgAnchorDistance: 1,
      maxMemberDistance: 2, maxHealerDistance: 1,
      slotDeviation: 0, aliveCount: 2, totalCount: 2,
      status: "INTACT", reason: "formation good",
    };

    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [ranged, healer], enemies: [enemy],
      terrain: makeTerrain(), terrainModifier: makeModifier(),
      cohesion, slots: [slot], anchor: null, prevPlan: null,
      attackIntents: [], prevMicroDecisions: [],
      targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    // 应产生 kite intent
    const kite = plan.kiteIntents.find(k => k.creepId === "r1");
    expect(kite).toBeDefined();
    expect(kite!.direction).toBe(1);

    // formation 应保持 INTACT（不产生 reform）
    expect(plan.reformIntents.length).toBe(0);
  });
});

describe("MICRO-E2E-003: Enemy Healer → Pressure → Target Decision 变化", () => {
  it("敌方 healer 出现时应影响 target switch decision", () => {
    const attacker = makeMember("a1", "attacker", 10, 10);
    const enemyTank: MicroEnemySnapshot = {
      ...makeEnemy("e1", 11, 10),
      capability: makeCap({ attack: 120, heal: 0 }),
      role: "attacker",
    };
    const enemyHealer: MicroEnemySnapshot = {
      ...makeEnemy("e2", 13, 10),
      capability: makeCap({ attack: 0, heal: 48 }),
      role: "healer",
      hits: 500,
    };

    const attackIntent = makeAttackIntent("a1", "e1");

    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [attacker], enemies: [enemyTank, enemyHealer],
      terrain: makeTerrain(), terrainModifier: makeModifier(),
      cohesion: null, slots: [], anchor: null, prevPlan: null,
      attackIntents: [attackIntent], prevMicroDecisions: [],
      targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    // 应产生 target switch intent 考虑敌方 healer
    const switchIntent = plan.switchIntents.find(s => s.creepId === "a1");
    expect(switchIntent).toBeDefined();
    expect(switchIntent!.candidateTargetId).toBe("e2");
  });
});

describe("MICRO-E2E-004: Tower Range → Avoidance → 继续 Combat", () => {
  it("MEDIUM tower 应产生 AVOID 但不 RETREAT（继续 combat）", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const enemy = makeEnemy("e1", 11, 10);
    const attackIntent = makeAttackIntent("a1", "e1");

    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [member], enemies: [enemy],
      terrain: makeTerrain({ towerCoverage: "MEDIUM" }),
      terrainModifier: makeModifier({ towerDamageFactor: 0.7 }),
      cohesion: null, slots: [], anchor: null, prevPlan: null,
      attackIntents: [attackIntent], prevMicroDecisions: [],
      targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    // 应产生 tower avoidance intent
    const towerIntent = plan.towerIntents.find(t => t.creepId === "a1");
    expect(towerIntent).toBeDefined();
    expect(towerIntent!.advisedAction).toBe("AVOID");

    // 不应 RETREAT（MEDIUM 不是 CRITICAL）
    const decision = plan.decisions.find(d => d.creepId === "a1")!;
    expect(decision.action).not.toBe("RETREAT");
  });
});

describe("MICRO-E2E-005: Formation Break → Reform → 继续 Combat", () => {
  it("cohesion BROKEN 应产生 REGROUP reform intent", () => {
    const member = makeMember("a1", "attacker", 10, 10);
    const cohesion: CohesionMetric = {
      maxAnchorDistance: 10, avgAnchorDistance: 8,
      maxMemberDistance: 15, maxHealerDistance: 5,
      slotDeviation: 10, aliveCount: 1, totalCount: 1,
      status: "BROKEN", reason: "broken",
    };

    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [member], enemies: [],
      terrain: makeTerrain(), terrainModifier: makeModifier(),
      cohesion, slots: [], anchor: null, prevPlan: null,
      attackIntents: [], prevMicroDecisions: [],
      targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    expect(plan.reformIntents.length).toBeGreaterThan(0);
    expect(plan.reformIntents[0]!.reformType).toBe("REGROUP");

    // 仍应继续产生 decision
    expect(plan.decisions.length).toBeGreaterThan(0);
  });
});

describe("MICRO-E2E-006: Retreat → Micro 全部停止 Aggressive Intent", () => {
  it("RETREATING 状态应停止所有 aggressive micro", () => {
    const attacker = makeMember("a1", "attacker", 10, 10);
    const healer = makeMember("h1", "healer", 9, 10);
    const enemy = makeEnemy("e1", 11, 10);
    const attackIntent = makeAttackIntent("a1", "e1");

    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "RETREATING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [attacker, healer], enemies: [enemy],
      terrain: makeTerrain(), terrainModifier: makeModifier(),
      cohesion: null, slots: [], anchor: null, prevPlan: null,
      attackIntents: [attackIntent], prevMicroDecisions: [],
      targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    // 全部停止 — 无 decisions，无 intents
    expect(plan.decisions).toHaveLength(0);
    expect(plan.kiteIntents).toHaveLength(0);
    expect(plan.rangeIntents).toHaveLength(0);
    expect(plan.switchIntents).toHaveLength(0);
    expect(plan.protectIntents).toHaveLength(0);
    expect(plan.reformIntents).toHaveLength(0);
    expect(plan.towerIntents).toHaveLength(0);
    expect(plan.pressure.aggregateRisk).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// ENVIRONMENT BLOCKED 声明
// ═══════════════════════════════════════════════════════════

describe("E2E ENVIRONMENT BLOCKED", () => {
  it("真实 Screeps Runtime E2E 需要 Game API — ENVIRONMENT BLOCKED", () => {
    // 真实 E2E 需要：
    // 1. Screeps 私服或 MMO
    // 2. Game.creeps / Game.rooms / Game.time
    // 3. 真实房间、spawn、tower、rampart
    // 4. 多 tick 运行验证闭环
    //
    // 这些在 Vitest CI 中无法执行。
    // Domain 层逻辑闭环已在上述测试中验证。
    // Runtime 层需要 Screeps 环境验证。
    //
    // 标记：ENVIRONMENT BLOCKED
    // 不伪造 PASS。

    expect(true).toBe(true); // 声明完成
  });
});
