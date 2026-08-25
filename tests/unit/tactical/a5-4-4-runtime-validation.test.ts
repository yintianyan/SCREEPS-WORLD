/**
 * A5.4.4 Tactical Combat Runtime Validation — Domain 纯函数验证测试。
 *
 * 测试覆盖：
 *   COMBAT-RUNTIME-001: Target Death Race — Tick N 击杀目标 → Tick N+1 不继续攻击死目标
 *   COMBAT-RUNTIME-002: Target Escape — 目标离开攻击范围 → requiresMovement + NO_ATTACK
 *   COMBAT-RUNTIME-003: Formation Conflict — Cohesion BROKEN → REGROUP（不攻击）
 *   COMBAT-RUNTIME-004: Retreat Safety — RETREATING → 0 AttackIntent
 *   COMBAT-RUNTIME-005: Authorization Denied — 非 war → 0 AttackIntent
 *   COMBAT-RUNTIME-006: Focus Fire Overkill — 多 attacker 不全部集中一个目标
 *   COMBAT-RUNTIME-007: Enemy Healer → 优先选择 healer 目标
 *   COMBAT-RUNTIME-008: Boosted Enemy → tacticalPriority 提升
 *   COMBAT-RUNTIME-009: Deterministic Replay — 50 组 × 1000 次 Hash 一致
 *   COMBAT-RUNTIME-010: Mixed Melee + Ranged — 攻击类型正确分配
 *   COMBAT-RUNTIME-011: Low HP Target — 残血优先
 *   COMBAT-RUNTIME-012: TargetScope LOCAL → 同房目标不拒绝
 *   COMBAT-RUNTIME-013: TargetScope OPERATIONAL → 跨房目标拒绝
 *   COMBAT-RUNTIME-014: Authorization Expired → 0 AttackIntent
 *   COMBAT-RUNTIME-015: DISENGAGING → 0 AttackIntent
 *   COMBAT-RUNTIME-016: 多 tick 状态连续性（ATTACKING → TARGET_DYING → TARGET_DEAD → REASSESSING）
 *   COMBAT-RUNTIME-017: Overkill 分流后主目标 HP 下降 → 更多 attacker 分到次目标
 *   COMBAT-RUNTIME-018: 全部 attacker 超出射程 → 全部 requiresMovement
 *   COMBAT-RUNTIME-019: HealCoverage retreatRecommended — 无 healer + 受伤 → 推荐
 *   COMBAT-RUNTIME-020: decisionHash 非空且确定性
 */

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
  type EngagementState,
} from "../../../src/domain/tactical/focus-fire";
import {
  validateAuthorization,
  validateTargetScope,
} from "../../../src/domain/tactical/authorization";
import type { CombatCapability } from "../../../src/domain/combat/capability";
import type { TacticalState, TargetScope, TacticalObjective } from "../../../src/domain/tactical/types";

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
      role === "healer" ? { heal: 48 } :
      { attack: 60 },
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

function makeObjective(
  overrides: Partial<TacticalObjective> = {},
): TacticalObjective {
  return {
    objectiveId: "obj-test",
    operationId: "war-W2N1",
    objectiveType: "ENGAGE_ENEMY",
    targetId: "W2N1",
    targetType: "room",
    targetScope: "LOCAL" as TargetScope,
    authorization: {
      state: "AUTHORIZED",
      operationId: "war-W2N1",
      warPosture: "war",
      targetRoom: "W2N1",
      expiry: 10000,
      operationAborted: false,
      reason: "authorized by war plan",
    },
    priority: 50,
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: 10000,
      maxDuration: 5000,
      minIntelConfidence: 0.2,
      allowBoost: true,
      allowPursuit: false,
      maxPursuitDistance: 0,
    },
    deadline: 10000,
    abortConditions: [],
    evidence: [],
    tick: 100,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-001: Target Death Race
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-001: Target Death Race", () => {
  it("Tick N: A/B/C 攻击 Target X → Tick N+1: B/C 发现 X 死亡 → 重新选择", () => {
    // Tick N: 3 attackers 攻击 targetX
    let targetX = makeCandidate("target-X", 25, 25, "W2N1", {
      hp: 240,
      maxHp: 1000,
      effectiveHP: 240,
    });
    const targetY = makeCandidate("target-Y", 26, 26, "W2N1", {
      hp: 800,
      effectiveHP: 800,
    });

    const attackers = [
      makeMember("att-A", "attacker", 25, 25),
      makeMember("att-B", "attacker", 25, 26),
      makeMember("att-C", "attacker", 26, 25),
    ];

    // Tick N: plan1 selects targetX (lower effectiveHP → higher score)
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      candidates: [targetX, targetY],
      members: attackers,
      prevPlan: null,
    }));

    expect(plan1.primaryTargetId).toBe("target-X");
    expect(plan1.attackIntents).toHaveLength(3);
    expect(plan1.attackIntents.every(i => i.targetId === "target-X")).toBe(true);

    // Tick N+1: targetX is dead (hp=0, INVALID)
    targetX = { ...targetX, hp: 0, accessibility: "INVALID" };
    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [targetX, targetY],
      members: attackers,
      prevPlan: plan1,
    }));

    // B/C must NOT continue attacking dead targetX
    expect(plan2.primaryTargetId).toBe("target-Y");
    expect(plan2.attackIntents.every(i => i.targetId !== "target-X")).toBe(true);
    expect(plan2.engagementState).toBe("TARGET_DEAD");
  });

  it("Tick N: A 击杀 X → B/C 下一 tick 不得继续用旧 intent 攻击 X", () => {
    // prevPlan shows targetX as primary
    const prevPlan: FocusFirePlan = {
      squadId: "squad-test",
      objectiveId: "obj-test",
      primaryTargetId: "target-X",
      primaryTargetPos: 25 * 50 + 25,
      primaryTargetPriority: "PRIMARY",
      secondaryTargetId: null,
      assignedAttackers: ["att-A", "att-B", "att-C"],
      assignedRanged: [],
      assignedHealers: [],
      expectedDamage: 360,
      expectedHeal: 0,
      targetEffectiveHP: 240,
      overkillRisk: 0,
      enemyHealSupport: null,
      healCoverage: null,
      confidence: 0.8,
      reason: "test",
      rejectedTargets: [],
      tick: 100,
      decisionHash: "",
      attackIntents: [],
      engagementState: "ATTACKING",
    };

    // targetX no longer in candidates (dead/disappeared)
    const targetY = makeCandidate("target-Y", 26, 26, "W2N1", {
      hp: 800,
      effectiveHP: 800,
    });

    const plan = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [targetY],
      members: [
        makeMember("att-B", "attacker", 25, 26),
        makeMember("att-C", "attacker", 26, 25),
      ],
      prevPlan,
    }));

    // Must select new target, not stale targetX
    expect(plan.primaryTargetId).toBe("target-Y");
    expect(plan.attackIntents.every(i => i.targetId === "target-Y")).toBe(true);
    expect(plan.engagementState).toBe("TARGET_LOST");
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-002: Target Escape
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-002: Target Escape", () => {
  it("目标离开攻击范围 → requiresMovement + NO_ATTACK", () => {
    // Target moves from in-range to out-of-range
    const targetFar = makeCandidate("enemy-1", 40, 40, "W2N1", {
      accessibility: "OUT_OF_RANGE",
      distance: 15,
    });

    const plan = planFocusFire(makeSnapshot({
      candidates: [targetFar],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.primaryTargetId).toBe("enemy-1");
    expect(plan.attackIntents[0]!.requiresMovement).toBe(true);
    expect(plan.attackIntents[0]!.attackType).toBe("NO_ATTACK");
  });

  it("目标从范围内移到范围外 → 状态转换", () => {
    let target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      accessibility: "IN_MELEE_RANGE",
    });

    const attacker = makeMember("att-1", "attacker", 25, 25);
    let prevPlan: FocusFirePlan | null = null;

    // Tick 100: in range
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      candidates: [target],
      members: [attacker],
      prevPlan: null,
    }));
    prevPlan = plan1;

    expect(plan1.attackIntents[0]!.requiresMovement).toBe(false);

    // Tick 103: target escaped
    target = makeCandidate("enemy-1", 40, 40, "W2N1", {
      accessibility: "OUT_OF_RANGE",
      distance: 15,
    });

    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [target],
      members: [attacker],
      prevPlan,
    }));

    expect(plan2.attackIntents[0]!.requiresMovement).toBe(true);
    expect(plan2.attackIntents[0]!.attackType).toBe("NO_ATTACK");
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-003: Formation Conflict
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-003: Formation Conflict", () => {
  it("Cohesion BROKEN → REGROUP（不产出攻击）", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      cohesionStatus: "BROKEN",
    }));

    expect(plan.engagementState).toBe("REGROUP");
    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.primaryTargetId).toBeNull();
  });

  it("Cohesion CRITICAL → REGROUP", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      cohesionStatus: "CRITICAL",
    }));

    expect(plan.engagementState).toBe("REGROUP");
    expect(plan.attackIntents).toHaveLength(0);
  });

  it("Cohesion DEGRADED → 仍可攻击（不阻断）", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      cohesionStatus: "DEGRADED",
    }));

    // DEGRADED is not BROKEN — can still attack
    expect(plan.attackIntents.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-004: Retreat Safety
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-004: Retreat Safety", () => {
  it("RETREATING → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "RETREATING",
    }));

    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.engagementState).toBe("REGROUP");
  });

  it("DISENGAGING → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "DISENGAGING",
    }));

    expect(plan.attackIntents).toHaveLength(0);
  });

  it("ABORTED → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "ABORTED",
    }));

    expect(plan.attackIntents).toHaveLength(0);
  });

  it("RETREATING 即使敌人在攻击范围内也不攻击", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      accessibility: "IN_MELEE_RANGE",
    });

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "RETREATING",
      inEngagementRange: true,
    }));

    // Even though target is in range, RETREATING suppresses attack
    expect(plan.attackIntents).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-005: Authorization Denied
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-005: Authorization Denied", () => {
  it("warPosture=develop → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      warPosture: "develop",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.primaryTargetId).toBeNull();
    expect(plan.engagementState).toBe("IDLE");
  });

  it("warPosture=fortify → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      warPosture: "fortify",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.attackIntents).toHaveLength(0);
  });

  it("warPosture=alert → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      warPosture: "alert",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.attackIntents).toHaveLength(0);
  });

  it("warPosture=contain → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      warPosture: "contain",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.attackIntents).toHaveLength(0);
  });

  it("warPosture=peace → 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);

    const plan = planFocusFire(makeSnapshot({
      warPosture: "peace",
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.attackIntents).toHaveLength(0);
  });

  it("validateAuthorization: operationAborted → REVOKED", () => {
    const result = validateAuthorization(
      {
        state: "AUTHORIZED",
        operationId: "war-test",
        warPosture: "war",
        targetRoom: "W2N1",
        expiry: 10000,
        operationAborted: true,
        reason: "test",
      },
      100,
      true,
    );
    expect(result.valid).toBe(false);
    expect(result.state).toBe("REVOKED");
  });

  it("validateAuthorization: expired → EXPIRED", () => {
    const result = validateAuthorization(
      {
        state: "AUTHORIZED",
        operationId: "war-test",
        warPosture: "war",
        targetRoom: "W2N1",
        expiry: 50,
        operationAborted: false,
        reason: "test",
      },
      100,
      true,
    );
    expect(result.valid).toBe(false);
    expect(result.state).toBe("EXPIRED");
  });

  it("validateAuthorization: offensive with non-war posture → DENIED", () => {
    const result = validateAuthorization(
      {
        state: "AUTHORIZED",
        operationId: "war-test",
        warPosture: "fortify",
        targetRoom: "W2N1",
        expiry: 10000,
        operationAborted: false,
        reason: "test",
      },
      100,
      true, // isOffensive
    );
    expect(result.valid).toBe(false);
    expect(result.state).toBe("DENIED");
  });

  it("validateAuthorization: defensive with fortify → valid", () => {
    const result = validateAuthorization(
      {
        state: "AUTHORIZED",
        operationId: "war-test",
        warPosture: "fortify",
        targetRoom: "W2N1",
        expiry: 10000,
        operationAborted: false,
        reason: "test",
      },
      100,
      false, // isDefensive
    );
    expect(result.valid).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-006: Focus Fire Overkill
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-006: Focus Fire Overkill", () => {
  it("Target A=300HP, Target B=2000HP → 不全部集中 A", () => {
    const targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 300,
      maxHp: 300,
      effectiveHP: 300,
    });
    const targetB = makeCandidate("enemy-B", 26, 26, "W2N1", {
      hp: 2000,
      maxHp: 2000,
      effectiveHP: 2000,
    });

    // 4 attackers × 120 = 480 total
    // Target A: 300HP, threshold = 450 → 480 > 450 → redistribute
    const members = [
      makeMember("att-A", "attacker", 25, 25),
      makeMember("att-B", "attacker", 25, 26),
      makeMember("att-C", "attacker", 26, 25),
      makeMember("att-D", "attacker", 26, 26),
    ];

    const plan = planFocusFire(makeSnapshot({
      candidates: [targetA, targetB],
      members,
    }));

    expect(plan.secondaryTargetId).toBe("enemy-B");
    // Not all 4 on primary
    expect(plan.assignedAttackers.length).toBeLessThan(4);
  });

  it("只有 1 个目标 → 全部集中（无法分流）", () => {
    const targetA = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 300,
      effectiveHP: 300,
    });

    const members = [
      makeMember("att-1", "attacker", 25, 25),
      makeMember("att-2", "attacker", 25, 26),
      makeMember("att-3", "attacker", 26, 25),
    ];

    const plan = planFocusFire(makeSnapshot({
      candidates: [targetA],
      members,
    }));

    expect(plan.secondaryTargetId).toBeNull();
    expect(plan.attackIntents).toHaveLength(3);
    expect(plan.attackIntents.every(i => i.priority === "PRIMARY")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-007: Enemy Healer Priority
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-007: Enemy Healer Priority", () => {
  it("敌方 healer 优先于 attacker 目标", () => {
    const healer = makeCandidate("enemy-healer", 25, 25, "W2N1", {
      role: "healer",
      healCapability: 48,
      attackCapability: 0,
      hp: 500,
      effectiveHP: 500,
    });
    const attacker = makeCandidate("enemy-attacker", 26, 26, "W2N1", {
      role: "attacker",
      attackCapability: 60,
      hp: 500,
      effectiveHP: 500,
    });

    const plan = planFocusFire(makeSnapshot({
      candidates: [attacker, healer],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    expect(plan.primaryTargetId).toBe("enemy-healer");
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-008: Boosted Enemy
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-008: Boosted Enemy", () => {
  it("Boosted enemy 的 tacticalPriority 应提升", () => {
    const boostedTarget = makeCandidate("enemy-boosted", 25, 25, "W2N1", {
      boosted: true,
      boostTier: 2,
      hp: 500,
      effectiveHP: 500,
    });

    const plan = planFocusFire(makeSnapshot({
      candidates: [boostedTarget],
      members: [makeMember("att-1", "attacker", 25, 25)],
    }));

    // Boosted target should have higher tacticalPriority than base
    expect(plan.primaryTargetId).toBe("enemy-boosted");
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-009: Deterministic Replay — 50 组 × 1000 次
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-009: Deterministic Replay (50 scenarios × 1000 replays)", () => {
  // 50 组 Combat Snapshot 构造函数
  function buildScenario(idx: number): FocusFireSnapshot {
    const targetCount = [1, 3, 5][idx % 3]!;
    const targets: TargetCandidate[] = [];
    for (let i = 0; i < targetCount; i++) {
      const x = 20 + (i * 3) % 20;
      const y = 20 + (i * 5) % 20;
      const hp = 200 + i * 200;
      targets.push(
        makeCandidate(`enemy-${idx}-${i}`, x, y, "W2N1", {
          hp,
          maxHp: 1000,
          effectiveHP: hp,
          role: i === 0 ? "healer" : i === 1 ? "attacker" : "unknown",
          healCapability: i === 0 ? 48 : 0,
          attackCapability: i === 1 ? 60 : 0,
          accessibility: i === 0 ? "IN_MELEE_RANGE" : "IN_RANGED_RANGE",
          boosted: idx % 7 === 0,
          boostTier: idx % 3 as 0 | 1 | 2 | 3,
        }),
      );
    }

    const memberCount = [1, 3, 5, 10][idx % 4]!;
    const members: FocusFireMemberSnapshot[] = [];
    for (let i = 0; i < memberCount; i++) {
      const role = i % 3 === 0 ? "attacker" : i % 3 === 1 ? "ranged" : "healer";
      members.push(makeMember(`att-${idx}-${i}`, role, 20 + i, 20 + i));
    }

    const tacticalStates: TacticalState[] = ["ENGAGING", "POSITIONING", "RETREATING", "DISENGAGING"];
    const warPostures = ["war", "develop", "fortify", "alert", "contain"];
    const cohesionStatuses = ["INTACT", "DEGRADED", "BROKEN", "CRITICAL"];

    return makeSnapshot({
      tick: 100 + idx,
      candidates: targets,
      members,
      tacticalState: tacticalStates[idx % 4]!,
      warPosture: warPostures[idx % 5]!,
      cohesionStatus: cohesionStatuses[idx % 4]!,
    });
  }

  it("50 组 × 1000 次 Replay → decisionHash 100% 一致", () => {
    const failures: string[] = [];

    for (let s = 0; s < 50; s++) {
      const snapshot = buildScenario(s);
      const hashes = new Set<string>();
      for (let r = 0; r < 1000; r++) {
        const plan = planFocusFire(snapshot);
        hashes.add(plan.decisionHash);
      }
      if (hashes.size !== 1) {
        failures.push(`scenario ${s}: ${hashes.size} unique hashes`);
      }
    }

    expect(failures, `Non-deterministic scenarios: ${failures.join(", ")}`).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-010: Mixed Melee + Ranged
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-010: Mixed Melee + Ranged", () => {
  it("Melee attacker → ATTACK, Ranged attacker → RANGED_ATTACK", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 500,
      effectiveHP: 500,
    });

    const melee = makeMember("att-melee", "attacker", 25, 25);
    const ranged = makeMember("att-ranged", "ranged", 27, 27);

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [melee, ranged],
    }));

    const meleeIntent = plan.attackIntents.find(i => i.creepId === "att-melee");
    const rangedIntent = plan.attackIntents.find(i => i.creepId === "att-ranged");

    expect(meleeIntent!.attackType).toBe("ATTACK");
    expect(rangedIntent!.attackType).toBe("RANGED_ATTACK");
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-011: Low HP Target Priority
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-011: Low HP Target", () => {
  it("残血目标 (hp < 30% maxHp) → TARGET_DYING 状态", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 250,
      maxHp: 1000,
      effectiveHP: 250,
    });

    const attacker = makeMember("att-1", "attacker", 25, 25);
    let prevPlan: FocusFirePlan | null = null;

    // First tick
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100,
      candidates: [target],
      members: [attacker],
      prevPlan: null,
    }));
    prevPlan = plan1;

    // Second tick: same target, now low HP
    const plan2 = planFocusFire(makeSnapshot({
      tick: 103,
      candidates: [target],
      members: [attacker],
      prevPlan,
    }));

    expect(plan2.engagementState).toBe("TARGET_DYING");
  });
});

// ═════════════════════════════════════════════════════════════
// COMBAT-RUNTIME-012/013: TargetScope
// ═════════════════════════════════════════════════════════════

describe("COMBAT-RUNTIME-012: TargetScope LOCAL", () => {
  it("LOCAL scope 同房目标不拒绝", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1");

    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      targetScope: "LOCAL",
      authorizedTargetRoom: "W2N1",
    }));

    expect(plan.primaryTargetId).toBe("enemy-1");
    expect(plan.rejectedTargets).toHaveLength(0);
  });
});

describe("COMBAT-RUNTIME-013: TargetScope — 越界拒绝", () => {
  it("候选目标在非授权房 → 拒绝", () => {
    const inRoom = makeCandidate("enemy-1", 25, 25, "W2N1");
    const outRoom = makeCandidate("enemy-2", 25, 25, "W3N1");

    const plan = planFocusFire(makeSnapshot({
      candidates: [inRoom, outRoom],
      members: [makeMember("att-1", "attacker", 25, 25)],
      authorizedTargetRoom: "W2N1",
    }));

    expect(plan.primaryTargetId).toBe("enemy-1");
    expect(plan.rejectedTargets.some(r => r.targetId === "enemy-2")).toBe(true);
  });

  it("validateTargetScope: candidate 在 operational room → valid", () => {
    const objective = makeObjective({ targetScope: "LOCAL" });
    const result = validateTargetScope(objective, "W2N1", "W2N1");
    expect(result.valid).toBe(true);
  });

  it("validateTargetScope: candidate 不在 operational room → invalid", () => {
    const objective = makeObjective({ targetScope: "LOCAL" });
    const result = validateTargetScope(objective, "W3N1", "W2N1");
    expect(result.valid).toBe(false);
  });

  it("validateTargetScope: STRATEGIC scope → tactical cannot select", () => {
    const objective = makeObjective({ targetScope: "STRATEGIC" });
    const result = validateTargetScope(objective, "W2N1", "W2N1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("strategic");
  });
});


describe("COMBAT-RUNTIME-014: Authorization Expired", () => {
  it("expired -> EXPIRED", () => {
    const result = validateAuthorization(
      { state: "AUTHORIZED", operationId: "war-test", warPosture: "war", targetRoom: "W2N1", expiry: 50, operationAborted: false, reason: "test" },
      100, true,
    );
    expect(result.valid).toBe(false);
    expect(result.state).toBe("EXPIRED");
  });

  it("operationAborted -> REVOKED", () => {
    const result = validateAuthorization(
      { state: "AUTHORIZED", operationId: "war-test", warPosture: "war", targetRoom: "W2N1", expiry: 10000, operationAborted: true, reason: "test" },
      100, true,
    );
    expect(result.valid).toBe(false);
    expect(result.state).toBe("REVOKED");
  });

  it("PENDING -> false", () => {
    const result = validateAuthorization(
      { state: "PENDING", operationId: "war-test", warPosture: "war", targetRoom: "W2N1", expiry: 10000, operationAborted: false, reason: "test" },
      100, true,
    );
    expect(result.valid).toBe(false);
  });

  it("DENIED -> false", () => {
    const result = validateAuthorization(
      { state: "DENIED", operationId: "war-test", warPosture: "war", targetRoom: "W2N1", expiry: 10000, operationAborted: false, reason: "test" },
      100, true,
    );
    expect(result.valid).toBe(false);
  });
});


describe("COMBAT-RUNTIME-015: DISENGAGING", () => {
  it("DISENGAGING -> 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "DISENGAGING",
    }));
    expect(plan.attackIntents).toHaveLength(0);
    expect(plan.engagementState).toBe("REGROUP");
  });

  it("REGROUPING -> 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "REGROUPING",
    }));
    expect(plan.attackIntents).toHaveLength(0);
  });

  it("COMPLETED -> 0 AttackIntent", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target],
      members: [makeMember("att-1", "attacker", 25, 25)],
      tacticalState: "COMPLETED",
    }));
    expect(plan.attackIntents).toHaveLength(0);
  });
});

describe("COMBAT-RUNTIME-016: multi-tick state continuity", () => {
  it("ATTACKING -> TARGET_DYING -> TARGET_DEAD chain", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 800, maxHp: 1000, effectiveHP: 800,
    });
    const attacker = makeMember("att-1", "attacker", 25, 25);
    let prevPlan: FocusFirePlan | null = null;

    const plan1 = planFocusFire(makeSnapshot({
      tick: 100, candidates: [target], members: [attacker], prevPlan: null,
    }));
    prevPlan = plan1;
    expect(plan1.engagementState).toBe("IDLE");

    const plan2 = planFocusFire(makeSnapshot({
      tick: 103, candidates: [target], members: [attacker], prevPlan,
    }));
    prevPlan = plan2;
    expect(plan2.engagementState).toBe("ATTACKING");

    const dyingTarget = { ...target, hp: 200, effectiveHP: 200 };
    const plan3 = planFocusFire(makeSnapshot({
      tick: 106, candidates: [dyingTarget], members: [attacker], prevPlan,
    }));
    prevPlan = plan3;
    expect(plan3.engagementState).toBe("TARGET_DYING");

    const deadTarget = { ...target, hp: 0, effectiveHP: 0, accessibility: "INVALID" as const };
    const plan4 = planFocusFire(makeSnapshot({
      tick: 109, candidates: [deadTarget], members: [attacker], prevPlan,
    }));
    expect(plan4.engagementState).toBe("TARGET_DEAD");
  });

  it("target disappears -> TARGET_LOST", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      hp: 800, effectiveHP: 800,
    });
    const attacker = makeMember("att-1", "attacker", 25, 25);
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100, candidates: [target], members: [attacker], prevPlan: null,
    }));
    const plan2 = planFocusFire(makeSnapshot({
      tick: 103, candidates: [], members: [attacker], prevPlan: plan1,
    }));
    expect(plan2.engagementState).toBe("TARGET_LOST");
    expect(plan2.primaryTargetId).toBeNull();
  });
});

describe("COMBAT-RUNTIME-017: Overkill redistribution after HP drop", () => {
  it("primary HP drops -> more attackers to secondary", () => {
    const targetA_high = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 300, maxHp: 300, effectiveHP: 300,
    });
    const targetB = makeCandidate("enemy-B", 26, 26, "W2N1", {
      hp: 2000, maxHp: 2000, effectiveHP: 2000,
    });
    const members = [
      makeMember("att-A", "attacker", 25, 25),
      makeMember("att-B", "attacker", 25, 26),
      makeMember("att-C", "attacker", 26, 25),
      makeMember("att-D", "attacker", 26, 26),
    ];
    const plan1 = planFocusFire(makeSnapshot({
      tick: 100, candidates: [targetA_high, targetB], members,
    }));
    const primaryCount1 = plan1.attackIntents.filter(i => i.priority === "PRIMARY").length;
    const secondaryCount1 = plan1.attackIntents.filter(i => i.priority === "SECONDARY").length;
    expect(primaryCount1).toBeLessThan(4);
    expect(secondaryCount1).toBeGreaterThan(0);

    const targetA_low = makeCandidate("enemy-A", 25, 25, "W2N1", {
      hp: 100, maxHp: 300, effectiveHP: 100,
    });
    const plan2 = planFocusFire(makeSnapshot({
      tick: 103, candidates: [targetA_low, targetB], members,
    }));
    const primaryCount2 = plan2.attackIntents.filter(i => i.priority === "PRIMARY").length;
    const secondaryCount2 = plan2.attackIntents.filter(i => i.priority === "SECONDARY").length;
    expect(primaryCount2).toBeLessThanOrEqual(primaryCount1);
    expect(secondaryCount2).toBeGreaterThanOrEqual(secondaryCount1);
  });
});

describe("COMBAT-RUNTIME-018: all attackers out of range", () => {
  it("all out of range -> all requiresMovement + NO_ATTACK", () => {
    const target = makeCandidate("enemy-1", 45, 45, "W2N1", {
      accessibility: "OUT_OF_RANGE", distance: 20,
    });
    const members = [
      makeMember("att-1", "attacker", 10, 10),
      makeMember("att-2", "attacker", 11, 11),
      makeMember("att-3", "attacker", 12, 12),
    ];
    const plan = planFocusFire(makeSnapshot({
      candidates: [target], members,
    }));
    expect(plan.attackIntents.length).toBe(3);
    expect(plan.attackIntents.every(i => i.requiresMovement)).toBe(true);
    expect(plan.attackIntents.every(i => i.attackType === "NO_ATTACK")).toBe(true);
  });

  it("mixed range -> mixed intents", () => {
    const target = makeCandidate("enemy-1", 25, 25, "W2N1", {
      accessibility: "IN_MELEE_RANGE",
    });
    const inRangeMember = makeMember("att-in", "attacker", 25, 25);
    const outOfRangeMember = makeMember("att-out", "attacker", 45, 45);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target], members: [inRangeMember, outOfRangeMember],
    }));
    const inIntent = plan.attackIntents.find(i => i.creepId === "att-in");
    const outIntent = plan.attackIntents.find(i => i.creepId === "att-out");
    expect(inIntent!.requiresMovement).toBe(false);
    expect(outIntent!.requiresMovement).toBe(true);
  });
});

describe("COMBAT-RUNTIME-019: HealCoverage retreatRecommended", () => {
  it("no healer + wounded -> retreatRecommended = true", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const woundedAttacker = makeMember("att-1", "attacker", 25, 25, "W2N1", {
      hits: 200, hitsMax: 1000,
    });
    const plan = planFocusFire(makeSnapshot({
      candidates: [target], members: [woundedAttacker],
    }));
    expect(plan.healCoverage).not.toBeNull();
    expect(plan.healCoverage!.healerCount).toBe(0);
    expect(plan.healCoverage!.woundedCount).toBe(1);
    expect(plan.healCoverage!.retreatRecommended).toBe(true);
  });

  it("has healer + wounded -> retreatRecommended = false", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    // heal=48/tick, 缺口=50 → coverageRatio=0.96 ≥ 0.3 → 不推荐撤退
    const woundedAttacker = makeMember("att-1", "attacker", 25, 25, "W2N1", {
      hits: 950, hitsMax: 1000,
    });
    const healer = makeMember("heal-1", "healer", 25, 26);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target], members: [woundedAttacker, healer],
    }));
    expect(plan.healCoverage).not.toBeNull();
    expect(plan.healCoverage!.healerCount).toBe(1);
    expect(plan.healCoverage!.retreatRecommended).toBe(false);
  });

  it("no wounded -> retreatRecommended = false", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const attacker = makeMember("att-1", "attacker", 25, 25);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target], members: [attacker],
    }));
    expect(plan.healCoverage).not.toBeNull();
    expect(plan.healCoverage!.woundedCount).toBe(0);
    expect(plan.healCoverage!.retreatRecommended).toBe(false);
  });
});

describe("COMBAT-RUNTIME-020: decisionHash non-empty and deterministic", () => {
  it("normal scenario -> decisionHash non-empty", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target], members: [makeMember("att-1", "attacker", 25, 25)],
    }));
    expect(plan.decisionHash).not.toBe("");
    expect(plan.decisionHash.length).toBeGreaterThanOrEqual(1);
  });

  it("empty scenario -> decisionHash still non-empty", () => {
    const plan = planFocusFire(makeSnapshot({
      candidates: [], members: [makeMember("att-1", "attacker", 25, 25)],
    }));
    expect(plan.decisionHash).not.toBe("");
  });

  it("same input -> same decisionHash", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const member = makeMember("att-1", "attacker", 25, 25);
    const snapshot = makeSnapshot({ candidates: [target], members: [member] });
    const plan1 = planFocusFire(snapshot);
    const plan2 = planFocusFire(snapshot);
    expect(plan1.decisionHash).toBe(plan2.decisionHash);
  });

  it("different input -> different decisionHash", () => {
    const target1 = makeCandidate("enemy-1", 25, 25);
    const target2 = makeCandidate("enemy-2", 25, 25);
    const plan1 = planFocusFire(makeSnapshot({
      candidates: [target1], members: [makeMember("att-1", "attacker", 25, 25)],
    }));
    const plan2 = planFocusFire(makeSnapshot({
      candidates: [target2], members: [makeMember("att-1", "attacker", 25, 25)],
    }));
    expect(plan1.decisionHash).not.toBe(plan2.decisionHash);
  });

  it("focusFirePlanHash is deterministic", () => {
    const target = makeCandidate("enemy-1", 25, 25);
    const plan = planFocusFire(makeSnapshot({
      candidates: [target], members: [makeMember("att-1", "attacker", 25, 25)],
    }));
    const rehashed = focusFirePlanHash(plan);
    expect(rehashed).toBe(plan.decisionHash);
  });
});

describe("EngagementState transition legality", () => {
  it("IDLE -> TARGET_ACQUIRED valid", () => {
    expect(canTransitionEngagement("IDLE", "TARGET_ACQUIRED")).toBe(true);
  });

  it("IDLE -> ATTACKING invalid", () => {
    expect(canTransitionEngagement("IDLE", "ATTACKING")).toBe(false);
  });

  it("ATTACKING -> TARGET_DYING valid", () => {
    expect(canTransitionEngagement("ATTACKING", "TARGET_DYING")).toBe(true);
  });

  it("ATTACKING -> TARGET_DEAD valid", () => {
    expect(canTransitionEngagement("ATTACKING", "TARGET_DEAD")).toBe(true);
  });

  it("TARGET_DEAD -> REASSESSING valid", () => {
    expect(canTransitionEngagement("TARGET_DEAD", "REASSESSING")).toBe(true);
  });

  it("REASSESSING -> TARGET_ACQUIRED valid", () => {
    expect(canTransitionEngagement("REASSESSING", "TARGET_ACQUIRED")).toBe(true);
  });

  it("REGROUP -> IDLE valid", () => {
    expect(canTransitionEngagement("REGROUP", "IDLE")).toBe(true);
  });

  it("TARGET_DYING -> ATTACKING valid (HP recover)", () => {
    expect(canTransitionEngagement("TARGET_DYING", "ATTACKING")).toBe(true);
  });

  it("IDLE -> REGROUP valid", () => {
    expect(canTransitionEngagement("IDLE", "REGROUP")).toBe(true);
  });

  it("TARGET_LOST -> REASSESSING valid", () => {
    expect(canTransitionEngagement("TARGET_LOST", "REASSESSING")).toBe(true);
  });

  it("TARGET_LOST -> REGROUP valid", () => {
    expect(canTransitionEngagement("TARGET_LOST", "REGROUP")).toBe(true);
  });
});
