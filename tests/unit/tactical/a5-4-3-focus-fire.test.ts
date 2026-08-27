/** A5.4.3 Tactical Engagement & Focus Fire — Domain 纯函数测试。 */

import { describe, expect, it } from "vitest";
import {
  planFocusFire,
  buildTargetCandidate,
  focusFirePlanHash,
  canTransitionEngagement,
  type FocusFireSnapshot,
  type FocusFireMemberSnapshot,
  type TargetCandidate,
  type FocusFirePlan,
} from "../../../src/domain/tactical/focus-fire";
import type { CombatCapability } from "../../../src/domain/combat/capability";
import type { TacticalState, TargetScope } from "../../../src/domain/tactical/types";

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
  overrides: Partial<FocusFireMemberSnapshot> = {},
): FocusFireMemberSnapshot {
  return {
    name,
    role,
    capability: makeCapability(role === "attacker" ? { attack: 120 } : role === "ranged" ? { rangedAttack: 40 } : { heal: 48 }),
    pos: x * 50 + y,
    room,
    hits: 1000,
    hitsMax: 1000,
    alive: true,
    ...overrides,
  };
}

function makeCandidate(
  id: string,
  x: number,
  y: number,
  room = "W2N1",
  overrides: Partial<TargetCandidate> = {},
): TargetCandidate {
  const base = buildTargetCandidate(
    id,
    x * 50 + y,
    room,
    "",
    1000,
    1000,
    makeCapability({ attack: 60 }),
    60,
    25 * 50 + 25,
    room,
    100,
  );
  return { ...base, ...overrides };
}

function makeSnapshot(
  overrides: Partial<FocusFireSnapshot> = {},
): FocusFireSnapshot {
  return {
    tick: 100,
    squadId: "squad-test",
    objectiveId: "obj-test",
    anchorPos: 25 * 50 + 25,
    anchorRoom: "W2N1",
    tacticalState: "ENGAGING" as TacticalState,
    targetScope: "LOCAL" as TargetScope,
    authorizedTargetRoom: "W2N1",
    warPosture: "war",
    candidates: [],
    members: [],
    prevPlan: null,
    cohesionStatus: "INTACT",
    inEngagementRange: true,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// COMBAT-001: 单目标 → 正确选择
// ═══════════════════════════════════════════════════════════

describe("COMBAT-001: 单目标 → 正确选择", () => {
  it("should select the only valid target", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const snapshot = makeSnapshot({
      candidates: [target],
      members: [makeMember("attacker-1", "attacker", 25, 25)],
    });

    const plan = planFocusFire(snapshot);

    expect(plan.primaryTargetId).toBe("enemy-1");
    expect(plan.attackIntents).toHaveLength(1);
    expect(plan.attackIntents[0]!.targetId).toBe("enemy-1");
    expect(plan.attackIntents[0]!.creepId).toBe("attacker-1");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-002: 多目标 → 最高 Tactical 价值
// ═══════════════════════════════════════════════════════════

describe("COMBAT-002: 多目标 → 最高 Tactical 价值", () => {
  it("should prioritize healer target over attacker target", () => {
    const healer = makeCandidate("enemy-healer", 25, 25, "W2N1", {
      role: "healer",
      healCapability: 48,
      attackCapability: 0,
      tacticalValue: {
        threat: 24,
        accessibility: 100,
        effectiveHP: 10,
        expectedDamage: 0,
        overkill: 0,
        enemyHealSupport: 48,
        distance: 100,
        position: 50,
        tacticalPriority: 100,
      },
    });
    const attacker = makeCandidate("enemy-attacker", 26, 26, "W2N1", {
      role: "attacker",
      attackCapability: 60,
      tacticalValue: {
        threat: 60,
        accessibility: 100,
        effectiveHP: 10,
        expectedDamage: 60,
        overkill: 0,
        enemyHealSupport: 0,
        distance: 100,
        position: 50,
        tacticalPriority: 70,
      },
    });

    const snapshot = makeSnapshot({
      candidates: [attacker, healer],
      members: [makeMember("attacker-1", "attacker", 25, 25)],
    });

    const plan = planFocusFire(snapshot);

    // Healer (priority=100) should be selected over attacker (priority=70)
    expect(plan.primaryTargetId).toBe("enemy-healer");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-003: Overkill → 分配攻击者而不是全部集中
// ═══════════════════════════════════════════════════════════

describe("COMBAT-003: Overkill → 分配攻击者", () => {
  it("should redistribute attackers when total damage greatly exceeds target HP", () => {
    // Target with 300 HP
    const targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 300,
      maxHp: 300,
      effectiveHP: 300,
    });
    const targetB = makeCandidate("enemy-B", 26, 26, "W2N1", {
      hp: 500,
      maxHp: 500,
      effectiveHP: 500,
    });

    // 5 attackers each doing 120 damage = 600 total
    // Target A has 300 HP → overkill threshold = 450
    // 600 > 450 → should redistribute
    const members = [
      makeMember("att-1", "attacker", 25, 25),
      makeMember("att-2", "attacker", 25, 26),
      makeMember("att-3", "attacker", 26, 25),
      makeMember("att-4", "attacker", 26, 26),
      makeMember("att-5", "attacker", 24, 25),
    ];

    const snapshot = makeSnapshot({
      candidates: [targetA, targetB],
      members,
    });

    const plan = planFocusFire(snapshot);

    // Should have secondary target assigned
    expect(plan.secondaryTargetId).toBe("enemy-B");
    // Not all 5 attackers should be on primary
    expect(plan.assignedAttackers.length).toBeLessThan(5);
    // Overkill risk should be > 0
    expect(plan.overkillRisk).toBeGreaterThan(0);
  });

  it("should NOT redistribute when only one target exists", () => {
    const targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 300,
      maxHp: 300,
      effectiveHP: 300,
    });

    const members = [
      makeMember("att-1", "attacker", 25, 25),
      makeMember("att-2", "attacker", 25, 26),
      makeMember("att-3", "attacker", 26, 25),
    ];

    const snapshot = makeSnapshot({
      candidates: [targetA],
      members,
    });

    const plan = planFocusFire(snapshot);

    // Only one target → all assigned to primary
    expect(plan.secondaryTargetId).toBeNull();
    expect(plan.attackIntents).toHaveLength(3);
    expect(plan.attackIntents.every(i => i.priority === "PRIMARY")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-004: 目标死亡 → 重新分配
// ═══════════════════════════════════════════════════════════

describe("COMBAT-004: 目标死亡 → 重新分配", () => {
  it("should detect target death and select new target", () => {
    const targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 0, // Dead
      accessibility: "INVALID",
    });
    const targetB = makeCandidate("enemy-B", 26, 26, "W2N1", {
      hp: 800,
      effectiveHP: 800,
    });

    const prevPlan: FocusFirePlan = {
      squadId: "squad-test",
      objectiveId: "obj-test",
      primaryTargetId: "enemy-A",
      primaryTargetPos: 25 * 50 + 25,
      primaryTargetPriority: "PRIMARY",
      secondaryTargetId: null,
      assignedAttackers: ["att-1"],
      assignedRanged: [],
      assignedHealers: [],
      expectedDamage: 120,
      expectedHeal: 0,
      targetEffectiveHP: 300,
      overkillRisk: 0,
      enemyHealSupport: null,
      healCoverage: null,
      confidence: 0.8,
      reason: "test",
      rejectedTargets: [],
      tick: 99,
      decisionHash: "",
      attackIntents: [],
      engagementState: "ATTACKING",
    };

    const snapshot = makeSnapshot({
      candidates: [targetA, targetB],
      members: [makeMember("att-1", "attacker", 25, 25)],
      prevPlan,
    });

    const plan = planFocusFire(snapshot);

    // Should NOT select dead target
    expect(plan.primaryTargetId).toBe("enemy-B");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-005: 目标逃跑 → 重新评估
// ═══════════════════════════════════════════════════════════

describe("COMBAT-005: 目标逃跑 → 重新评估", () => {
  it("should handle target escape (out of range)", () => {
    const targetFar = makeCandidate("enemy-A", 40, 40, "W2N1", {
      accessibility: "OUT_OF_RANGE",
      distance: 15,
    });

    const snapshot = makeSnapshot({
      candidates: [targetFar],
      members: [makeMember("att-1", "attacker", 25, 25)],
    });

    const plan = planFocusFire(snapshot);

    // Target is out of range but still valid → should be selected but with requiresMovement
    expect(plan.primaryTargetId).toBe("enemy-A");
    expect(plan.attackIntents[0]!.requiresMovement).toBe(true);
    expect(plan.attackIntents[0]!.attackType).toBe("NO_ATTACK");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-006: 目标超出射程 → requiresMovement
// ═══════════════════════════════════════════════════════════

describe("COMBAT-006: 目标超出射程 → MovementIntent", () => {
  it("should set requiresMovement when target is out of attack range", () => {
    // Attacker at 25,25; target at 30,30 (distance=5, out of range)
    const target = makeCandidate("enemy-1", 30, 30, "W2N1", {
      accessibility: "IN_ENGAGEMENT_RANGE",
    });

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    });

    const plan = planFocusFire(snapshot);

    expect(plan.attackIntents).toHaveLength(1);
    expect(plan.attackIntents[0]!.requiresMovement).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-007: 敌方 Healer → 考虑 HealSupport
// ═══════════════════════════════════════════════════════════

describe("COMBAT-007: 敌方 Healer → 考虑 HealSupport", () => {
  it("should evaluate enemy heal support on primary target", () => {
    const target = makeCandidate("enemy-target", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });
    const enemyHealer = makeCandidate("enemy-healer", 26, 25, "W2N1", {
      role: "healer",
      healCapability: 48,
      hp: 500,
      effectiveHP: 500,
    });

    const snapshot = makeSnapshot({
      candidates: [target, enemyHealer],
      members: [makeMember("att-1", "attacker", 25, 25)],
    });

    const plan = planFocusFire(snapshot);

    // Healer has higher tacticalPriority → should be primary target
    expect(plan.primaryTargetId).toBe("enemy-healer");
    // Should have enemyHealSupport assessment (on the primary target)
    // Since healer is the primary target, enemyHealSupport checks other candidates
    // for heal support on the healer — if no other healer, support is 0
    expect(plan.enemyHealSupport).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-008: Boost → CombatCapability 影响正确
// ═══════════════════════════════════════════════════════════

describe("COMBAT-008: Boost → CombatCapability 影响正确", () => {
  it("should factor boost into damage calculation", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    // Boosted attacker: 4x damage = 480 per tick
    const boostedAttacker = makeMember("att-1", "attacker", 25, 25, "W2N1", {
      capability: makeCapability({ attack: 480, boosted: true, maxBoostTier: 3 }),
    });

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [boostedAttacker],
    });

    const plan = planFocusFire(snapshot);

    expect(plan.expectedDamage).toBe(480);
    // 480 < 500*1.5=750 → no overkill redistribution needed
    expect(plan.overkillRisk).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-009: Melee 与 Ranged 攻击方式正确
// ═══════════════════════════════════════════════════════════

describe("COMBAT-009: Melee 与 Ranged 攻击方式正确", () => {
  it("should assign ATTACK for melee attacker in range", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const meleeAttacker = makeMember("att-1", "attacker", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [meleeAttacker],
    });

    const plan = planFocusFire(snapshot);

    expect(plan.attackIntents[0]!.attackType).toBe("ATTACK");
  });

  it("should assign RANGED_ATTACK for ranged attacker in range", () => {
    const target = makeCandidate("enemy-1", 27, 27);
    const rangedAttacker = makeMember("ranged-1", "ranged", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [rangedAttacker],
    });

    const plan = planFocusFire(snapshot);

    expect(plan.attackIntents[0]!.attackType).toBe("RANGED_ATTACK");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-010: Formation 不能被 FocusFire 绕过
// ═══════════════════════════════════════════════════════════

describe("COMBAT-010: Formation 不能被 FocusFire 绕过", () => {
  it("should respect cohesion BROKEN → REGROUP (no attack)", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      cohesionStatus: "BROKEN",
    });

    const plan = planFocusFire(snapshot);

    expect(plan.engagementState).toBe("REGROUP");
    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.primaryTargetId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-011: Retreat 状态 → 禁止 AttackIntent
// ═══════════════════════════════════════════════════════════

describe("COMBAT-011: Retreat 状态 → 禁止 AttackIntent", () => {
  it("should not produce attack intents when RETREATING", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "RETREATING",
    });

    const plan = planFocusFire(snapshot);

    expect(plan.engagementState).toBe("REGROUP");
    expect(plan.attackIntents).toHaveLength(0);
  });

  it("should not produce attack intents when DISENGAGING", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "DISENGAGING",
    });

    const plan = planFocusFire(snapshot);

    expect(plan.attackIntents).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-012: WarPosture 非 WAR → 禁止进攻 Intent
// ═══════════════════════════════════════════════════════════

describe("COMBAT-012: WarPosture 非 WAR → 禁止进攻 Intent", () => {
  it("should not produce attack intents when warPosture is develop", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      warPosture: "develop",
    });

    const plan = planFocusFire(snapshot);

    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.primaryTargetId).toBeNull();
    expect(plan.engagementState).toBe("IDLE");
  });

  it("should not produce attack intents when warPosture is fortify", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      warPosture: "fortify",
    });

    const plan = planFocusFire(snapshot);

    expect(plan.attackIntents).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-013: TargetScope 越界 → 拒绝目标
// ═══════════════════════════════════════════════════════════

describe("COMBAT-013: TargetScope 越界 → 拒绝目标", () => {
  it("should reject targets outside authorized room", () => {
    const targetInRoom = makeCandidate("enemy-1", 25, 25, "W2N1");
    const targetOutside = makeCandidate("enemy-2", 25, 25, "W3N1"); // Different room

    const snapshot = makeSnapshot({
      candidates: [targetInRoom, targetOutside],
      members: [makeMember("att-1", "attacker", 25, 25)],
      authorizedTargetRoom: "W2N1",
    });

    const plan = planFocusFire(snapshot);

    // Should select target in authorized room
    expect(plan.primaryTargetId).toBe("enemy-1");
    // Should reject target outside scope
    expect(plan.rejectedTargets.some(r => r.targetId === "enemy-2")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-014: 同 Snapshot → 1000 次 Hash 一致
// ═══════════════════════════════════════════════════════════

describe("COMBAT-014: 同 Snapshot → 1000 次 Hash 一致", () => {
  it("should produce identical hash across 1000 replays", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });
    const member = makeMember("att-1", "attacker", 25, 25);

    const snapshot = makeSnapshot({
      candidates: [target],
      members: [member],
    });

    // Run planFocusFire 1000 times
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const plan = planFocusFire(snapshot);
      hashes.add(plan.decisionHash);
    }

    // All 1000 runs should produce the same hash
    expect(hashes.size).toBe(1);
  });

  it("focusFirePlanHash should be deterministic", () => {
    const plan = planFocusFire(makeSnapshot({
      candidates: [makeCandidate("enemy-1", 25, 25)],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    const hash1 = focusFirePlanHash(plan);
    const hash2 = focusFirePlanHash(plan);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(8); // FNV-1a 32-bit hex = 8 chars
  });
});

// ─── EngagementState 状态机转换验证 ───

describe("EngagementState 状态机转换", () => {
  it("should allow ATTACKING → TARGET_DYING", () => {
    expect(canTransitionEngagement("ATTACKING", "TARGET_DYING")).toBe(true);
  });

  it("should allow TARGET_DYING → TARGET_DEAD", () => {
    expect(canTransitionEngagement("TARGET_DYING", "TARGET_DEAD")).toBe(true);
  });

  it("should allow TARGET_DEAD → REASSESSING", () => {
    expect(canTransitionEngagement("TARGET_DEAD", "REASSESSING")).toBe(true);
  });

  it("should allow REASSESSING → TARGET_ACQUIRED", () => {
    expect(canTransitionEngagement("REASSESSING", "TARGET_ACQUIRED")).toBe(true);
  });

  it("should NOT allow IDLE → ATTACKING (must go through TARGET_ACQUIRED)", () => {
    expect(canTransitionEngagement("IDLE", "ATTACKING")).toBe(false);
  });

  it("should allow TARGET_OUT_OF_RANGE → REQUEST_MOVEMENT", () => {
    expect(canTransitionEngagement("TARGET_OUT_OF_RANGE", "REQUEST_MOVEMENT")).toBe(true);
  });
});
