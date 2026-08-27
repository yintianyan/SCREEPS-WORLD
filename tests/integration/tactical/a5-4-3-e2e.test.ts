/** A5.4.3 E2E Tests — Tactical Engagement & Focus Fire 全链路端到端测试。 */

import { describe, expect, it } from "vitest";
import {
  planFocusFire,
  buildTargetCandidate,
  canTransitionEngagement,
  type FocusFireSnapshot,
  type FocusFireMemberSnapshot,
  type TargetCandidate,
  type FocusFirePlan,
  type EngagementState,
  type AttackIntent,
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
    capability: makeCapability(
      role === "attacker" ? { attack: 120 } :
      role === "ranged" ? { rangedAttack: 40 } :
      { heal: 48 },
    ),
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
    squadId: "squad-e2e",
    objectiveId: "obj-e2e",
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
// COMBAT-E2E-001: 完整交战周期 — 从接敌到击杀到重新选择目标
// ═══════════════════════════════════════════════════════════

describe("COMBAT-E2E-001: 完整交战周期", () => {
  it("should complete full engagement cycle: acquire → attack → kill → reassess → new target", () => {
    // 初始状态：2 个敌方目标，1 个 attacker
    let targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 240,
      maxHp: 1000,
      effectiveHP: 240,
    });
    let targetB = makeCandidate("enemy-B", 26, 26, "W2N1", {
      hp: 800,
      maxHp: 1000,
      effectiveHP: 800,
    });

    const attacker = makeMember("att-1", "attacker", 25, 25);
    let prevPlan: FocusFirePlan | null = null;

    // ── Tick 100: 首次接敌 — 应选择更脆的 targetA (240 HP) ──
    const tick1Snapshot = makeSnapshot({
      tick: 100,
      candidates: [targetA, targetB],
      members: [attacker],
      prevPlan,
    });

    const plan1 = planFocusFire(tick1Snapshot);
    prevPlan = plan1;

    expect(plan1.primaryTargetId).toBe("enemy-A");
    expect(plan1.engagementState).toBe("IDLE"); // 首次无 prevPlan
    expect(plan1.attackIntents).toHaveLength(1);
    expect(plan1.attackIntents[0]!.targetId).toBe("enemy-A");
    expect(plan1.attackIntents[0]!.attackType).toBe("ATTACK");

    // ── Tick 103: 继续攻击 targetA (attacker 伤害 120/tick, 3 ticks = 360)
    // targetA HP after 3 ticks: 240 - 360 = -120 → 已死
    // 但在 planFocusFire 中我们看到的 targetA hp 是外部传入的快照
    // 模拟 targetA 被打死后 HP=0
    targetA = { ...targetA, hp: 0, accessibility: "INVALID" };

    const tick2Snapshot = makeSnapshot({
      tick: 103,
      candidates: [targetA, targetB],
      members: [attacker],
      prevPlan,
    });

    const plan2 = planFocusFire(tick2Snapshot);
    prevPlan = plan2;

    // targetA 已死 → 应重新选择 targetB
    expect(plan2.primaryTargetId).toBe("enemy-B");
    expect(plan2.attackIntents).toHaveLength(1);
    expect(plan2.attackIntents[0]!.targetId).toBe("enemy-B");

    // ── 状态机验证 ──
    // plan1 是 IDLE（无 prevPlan），plan2 应该是从 prevPlan 推导的状态
    // targetA 在候选中 hp=0 → TARGET_DEAD
    expect(plan2.engagementState).toBe("TARGET_DEAD");
  });

  it("should track engagement state through ATTACKING → TARGET_DYING transition", () => {
    // 目标初始 500 HP，attacker 120 damage/tick
    let target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      maxHp: 1000,
      effectiveHP: 500,
    });

    const attacker = makeMember("att-1", "attacker", 25, 25);
    let prevPlan: FocusFirePlan | null = null;

    // Tick 100: 首次选择目标
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      candidates: [target],
      members: [attacker],
      prevPlan: null,
    }));
    prevPlan = plan1;

    expect(plan1.engagementState).toBe("IDLE");

    // Tick 103: 目标仍在，HP > 30% → ATTACKING
    target = { ...target, hp: 500, effectiveHP: 500 };
    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [target],
      members: [attacker],
      prevPlan,
    }));
    prevPlan = plan2;

    expect(plan2.primaryTargetId).toBe("enemy-1");
    expect(plan2.engagementState).toBe("ATTACKING");

    // Tick 106: 目标 HP 降到 25% (< 30%) → TARGET_DYING
    target = { ...target, hp: 250, maxHp: 1000, effectiveHP: 250 };
    const plan3 = planFocusFire(makeSnapshot({
      tick: 106,
      candidates: [target],
      members: [attacker],
      prevPlan,
    }));

    expect(plan3.primaryTargetId).toBe("enemy-1");
    expect(plan3.engagementState).toBe("TARGET_DYING");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-E2E-002: 多目标优先级链 — healer 优先 > attacker > 残血
// ═══════════════════════════════════════════════════════════

describe("COMBAT-E2E-002: 多目标优先级链", () => {
  it("should prioritize healer > attacker > low-hp target", () => {
    const healer = makeCandidate("enemy-healer", 25, 25, "W2N1", {
      role: "healer",
      healCapability: 48,
      attackCapability: 0,
      hp: 500,
      effectiveHP: 500,
    });
    const attackerEnemy = makeCandidate("enemy-attacker", 26, 26, "W2N1", {
      role: "attacker",
      attackCapability: 60,
      hp: 500,
      effectiveHP: 500,
    });
    const lowHpTarget = makeCandidate("enemy-lowhp", 27, 27, "W2N1", {
      role: "unknown",
      hp: 100,
      maxHp: 1000,
      effectiveHP: 100,
    });

    // 三个目标同时存在 → healer 优先 (tacticalPriority=100)
    const plan = planFocusFire(makeSnapshot({
      candidates: [lowHpTarget, attackerEnemy, healer],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.primaryTargetId).toBe("enemy-healer");
  });

  it("should select attacker over low-hp unknown when no healer present", () => {
    const attackerEnemy = makeCandidate("enemy-attacker", 26, 26, "W2N1", {
      role: "attacker",
      attackCapability: 60,
      hp: 500,
      effectiveHP: 500,
    });
    const lowHpTarget = makeCandidate("enemy-lowhp", 27, 27, "W2N1", {
      role: "unknown",
      attackCapability: 0,
      rangedCapability: 0,
      hp: 100,
      maxHp: 1000,
      effectiveHP: 100,
      tacticalValue: {
        threat: 0,
        accessibility: 80,
        effectiveHP: 100,
        expectedDamage: 0,
        overkill: 0,
        enemyHealSupport: 0,
        distance: 80,
        position: 50,
        tacticalPriority: 30,
      },
    });

    const plan = planFocusFire(makeSnapshot({
      candidates: [lowHpTarget, attackerEnemy],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    // attacker (priority=70) > unknown low-hp (priority=30)
    expect(plan.primaryTargetId).toBe("enemy-attacker");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-E2E-003: Overkill 分流 → 多目标同时压制
// ═══════════════════════════════════════════════════════════

describe("COMBAT-E2E-003: Overkill 分流 → 多目标同时压制", () => {
  it("should split attackers across primary and secondary when overkill detected", () => {
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

    // 5 attackers × 120 damage = 600 total
    // targetA HP=300, threshold=450 → 600 > 450 → redistribute
    const members = [
      makeMember("att-1", "attacker", 25, 25),
      makeMember("att-2", "attacker", 25, 26),
      makeMember("att-3", "attacker", 26, 25),
      makeMember("att-4", "attacker", 26, 26),
      makeMember("att-5", "attacker", 24, 25),
    ];

    const plan = planFocusFire(makeSnapshot({
      candidates: [targetA, targetB],
      members,
    }));

    // 验证分流
    expect(plan.primaryTargetId).toBe("enemy-A");
    expect(plan.secondaryTargetId).toBe("enemy-B");
    expect(plan.overkillRisk).toBeGreaterThan(0);

    // 验证 AttackIntent 分配
    const primaryIntents = plan.attackIntents.filter(i => i.priority === "PRIMARY");
    const secondaryIntents = plan.attackIntents.filter(i => i.priority === "SECONDARY");

    expect(primaryIntents.length).toBeLessThan(5);
    expect(secondaryIntents.length).toBeGreaterThan(0);
    expect(primaryIntents.length + secondaryIntents.length).toBe(5);

    // 验证所有 PRIMARY intent 指向 targetA
    expect(primaryIntents.every(i => i.targetId === "enemy-A")).toBe(true);
    // 验证所有 SECONDARY intent 指向 targetB
    expect(secondaryIntents.every(i => i.targetId === "enemy-B")).toBe(true);
  });

  it("should maintain overkill redistribution across consecutive ticks", () => {
    let targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 300,
      maxHp: 300,
      effectiveHP: 300,
    });
    const targetB = makeCandidate("enemy-B", 26, 26, "W2N1", {
      hp: 500,
      maxHp: 500,
      effectiveHP: 500,
    });

    const members = [
      makeMember("att-1", "attacker", 25, 25),
      makeMember("att-2", "attacker", 25, 26),
      makeMember("att-3", "attacker", 26, 25),
      makeMember("att-4", "attacker", 26, 26),
      makeMember("att-5", "attacker", 24, 25),
    ];

    // Tick 1: 初始分流
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      candidates: [targetA, targetB],
      members,
    }));

    expect(plan1.secondaryTargetId).toBe("enemy-B");
    const primaryCount1 = plan1.attackIntents.filter(i => i.priority === "PRIMARY").length;

    // Tick 2: targetA HP 降低但仍在 → 继续分流
    targetA = { ...targetA, hp: 180, effectiveHP: 180 };
    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [targetA, targetB],
      members,
      prevPlan: plan1,
    }));

    // 仍然分流（180*1.5=270 < 600）
    expect(plan2.secondaryTargetId).toBe("enemy-B");
    const primaryCount2 = plan2.attackIntents.filter(i => i.priority === "PRIMARY").length;

    // 主目标 HP 降低 → requiredForPrimary 可能减少 → 更多 attacker 分到 secondary
    expect(primaryCount2).toBeLessThanOrEqual(primaryCount1);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-E2E-004: 目标逃跑 → 状态机转换 → 重新接敌
// ═══════════════════════════════════════════════════════════

describe("COMBAT-E2E-004: 目标逃跑 → 重新接敌", () => {
  it("should detect target escape and request movement", () => {
    // 初始目标在射程内
    let target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
      accessibility: "IN_MELEE_RANGE",
    });

    const attacker = makeMember("att-1", "attacker", 25, 25);
    let prevPlan: FocusFirePlan | null = null;

    // Tick 100: 接敌
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      candidates: [target],
      members: [attacker],
      prevPlan: null,
    }));
    prevPlan = plan1;

    expect(plan1.primaryTargetId).toBe("enemy-1");
    expect(plan1.attackIntents[0]!.requiresMovement).toBe(false);

    // Tick 103: 目标逃跑到射程外
    target = makeCandidate("enemy-1", 40, 40, "W2N1", {
      hp: 500,
      effectiveHP: 500,
      accessibility: "OUT_OF_RANGE",
      distance: 15,
    });

    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [target],
      members: [attacker],
      prevPlan,
    }));

    // 目标仍在候选中但超出射程
    expect(plan2.primaryTargetId).toBe("enemy-1");
    // AttackIntent 应标记 requiresMovement
    const intent = plan2.attackIntents[0]!;
    expect(intent.requiresMovement).toBe(true);
    expect(intent.attackType).toBe("NO_ATTACK");
  });

  it("should handle target disappearing from candidates entirely", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });
    const newTarget = makeCandidate("enemy-2", 27, 27, "W2N1", {
      hp: 300,
      effectiveHP: 300,
    });

    const attacker = makeMember("att-1", "attacker", 25, 25);

    // Tick 100: 攻击 enemy-1
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      candidates: [target],
      members: [attacker],
      prevPlan: null,
    }));

    expect(plan1.primaryTargetId).toBe("enemy-1");

    // Tick 103: enemy-1 消失（不在候选中），enemy-2 出现
    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [newTarget],
      members: [attacker],
      prevPlan: plan1,
    }));

    // 应选择新目标
    expect(plan2.primaryTargetId).toBe("enemy-2");
    // 状态应为 TARGET_LOST（前序目标不在候选中）
    expect(plan2.engagementState).toBe("TARGET_LOST");
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-E2E-005: 治疗覆盖不足 → retreatRecommended
// ═══════════════════════════════════════════════════════════

describe("COMBAT-E2E-005: 治疗覆盖评估", () => {
  it("should recommend retreat when healers are dead and members wounded", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    // 无 healer + 受伤的 attacker
    const woundedAttacker = makeMember("att-1", "attacker", 25, 25, "W2N1", {
      hits: 200,
      hitsMax: 1000,
    });

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [woundedAttacker],
    }));

    expect(plan.healCoverage).not.toBeNull();
    expect(plan.healCoverage!.healerCount).toBe(0);
    expect(plan.healCoverage!.woundedCount).toBe(1);
    expect(plan.healCoverage!.retreatRecommended).toBe(true);
  });

  it("should report full coverage when healers can cover all damage", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    const members = [
      makeMember("att-1", "attacker", 25, 25, "W2N1", { hits: 800, hitsMax: 1000 }),
      makeMember("healer-1", "healer", 25, 26, "W2N1", {
         capability: makeCapability({ heal: 240 }),
      }),
    ];

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members,
    }));

    expect(plan.healCoverage).not.toBeNull();
    expect(plan.healCoverage!.healerCount).toBe(1);
    expect(plan.healCoverage!.coverageRatio).toBeGreaterThanOrEqual(1);
    expect(plan.healCoverage!.retreatRecommended).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// COMBAT-E2E-006: 非 war 姿态 → 禁止 AttackIntent → 安全降级
// ═══════════════════════════════════════════════════════════

describe("COMBAT-E2E-006: 非 war 姿态 → 安全降级", () => {
  it("should produce zero attack intents in develop posture and fall back gracefully", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    const plan = planFocusFire(makeSnapshot({
      warPosture: "develop",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.primaryTargetId).toBeNull();
    expect(plan.engagementState).toBe("IDLE");
    expect(plan.expectedDamage).toBe(0);
    // Plan 仍然有 decisionHash（确定性可追踪）
    expect(plan.decisionHash).toHaveLength(8);
  });

  it("should produce zero attack intents in fortify posture", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    const plan = planFocusFire(makeSnapshot({
      warPosture: "fortify",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.engagementState).toBe("IDLE");
  });

  it("should maintain safe state across consecutive ticks in non-war posture", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      warPosture: "develop",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      warPosture: "develop",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      prevPlan: plan1,
    }));

    // 两 tick 都无 AttackIntent
    expect(plan1.attackIntents).toHaveLength(0);
    expect(plan2.attackIntents).toHaveLength(0);
    // 两 tick 都是安全降级状态（无 AttackIntent）
    expect(plan1.attackIntents).toHaveLength(0);
    expect(plan2.attackIntents).toHaveLength(0);
    expect(plan1.engagementState).toBe("IDLE");
    expect(plan2.engagementState).toBe("IDLE");
  });
});

// ═══════════════════════════════════════════════════════════
// 补充：AttackIntent 消费验证
// ═══════════════════════════════════════════════════════════

describe("AttackIntent 消费验证", () => {
  it("every AttackIntent should have valid targetId matching a candidate", () => {
    const targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 300,
      effectiveHP: 300,
    });
    const targetB = makeCandidate("enemy-B", 26, 26, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    const plan = planFocusFire(makeSnapshot({
      candidates: [targetA, targetB],
      members: [
        makeMember("att-1", "attacker", 25, 25),
        makeMember("att-2", "attacker", 25, 26),
      ],
    }));

    const validIds = new Set(["enemy-A", "enemy-B"]);
    for (const intent of plan.attackIntents) {
      expect(validIds.has(intent.targetId)).toBe(true);
      expect(intent.squadId).toBe("squad-e2e");
      expect(intent.tick).toBe(100);
      expect(intent.confidence).toBeGreaterThan(0);
      expect(intent.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("every AttackIntent should have correct attackType based on role and range", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    // melee attacker at distance 0
    const meleeAttacker = makeMember("att-melee", "attacker", 25, 25);
    // ranged attacker at distance 2
    const rangedAttacker = makeMember("att-ranged", "ranged", 27, 27);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [meleeAttacker, rangedAttacker],
    }));

    const meleeIntent = plan.attackIntents.find(i => i.creepId === "att-melee");
    const rangedIntent = plan.attackIntents.find(i => i.creepId === "att-ranged");

    expect(meleeIntent).toBeDefined();
    expect(meleeIntent!.attackType).toBe("ATTACK");
    expect(meleeIntent!.requiresMovement).toBe(false);

    expect(rangedIntent).toBeDefined();
    expect(rangedIntent!.attackType).toBe("RANGED_ATTACK");
    expect(rangedIntent!.requiresMovement).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// 补充：状态机转换合法性验证
// ═══════════════════════════════════════════════════════════

describe("EngagementState 状态机转换合法性", () => {
  it("should only allow valid state transitions across full engagement cycle", () => {
    const cycle: EngagementState[] = [
      "IDLE",
      "TARGET_ACQUIRED",
      "ATTACKING",
      "TARGET_DYING",
      "TARGET_DEAD",
      "REASSESSING",
      "TARGET_ACQUIRED",
    ];

    for (let i = 0; i < cycle.length - 1; i++) {
      const from = cycle[i]!;
      const to = cycle[i + 1]!;
      expect(
        canTransitionEngagement(from, to),
        `transition ${from} → ${to} should be valid`,
      ).toBe(true);
    }
  });

  it("should reject invalid transitions", () => {
    expect(canTransitionEngagement("IDLE", "ATTACKING")).toBe(false);
    expect(canTransitionEngagement("TARGET_DEAD", "ATTACKING")).toBe(false);
    expect(canTransitionEngagement("REGROUP", "ATTACKING")).toBe(false);
  });
});
