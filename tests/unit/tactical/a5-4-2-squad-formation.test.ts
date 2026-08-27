/** A5.4.2 Squad Formation & Tactical Movement — Domain 纯函数测试。 */

import { describe, expect, it } from "vitest";
import {
  computeSquadAnchor,
  computeFormationSlots,
  computeCohesion,
  produceSquadMovementIntent,
  detectSquadStuck,
  checkHealerCohesion,
  computeRetreatFormation,
  assessFormationDegradation,
  computeRegroupPoint,
  squadMovementIntentHash,
  buildSquadSnapshot,
  type SquadMemberRuntimeSnapshot,
  type SquadSnapshot,
} from "../../../src/domain/tactical";
import type { TerrainContext } from "../../../src/domain/defense/terrain-context";

// ─── 辅助构造函数 ───

function makeMember(
  name: string,
  role: string,
  x: number,
  y: number,
  room = "W1N1",
  overrides: Partial<SquadMemberRuntimeSnapshot> = {},
): SquadMemberRuntimeSnapshot {
  return {
    name,
    role,
    pos: x * 50 + y,
    room,
    hits: 1000,
    hitsMax: 1000,
    fatigue: 0,
    alive: true,
    boosted: false,
    ...overrides,
  };
}

function makeSquad(
  members: SquadMemberRuntimeSnapshot[],
  overrides: Partial<SquadSnapshot> = {},
): SquadSnapshot {
  return {
    squadId: "squad-test",
    operationId: "op-test",
    objectiveId: "obj-test",
    members,
    formation: "CLUSTER",
    state: "MOVING",
    tick: 100,
    targetRoom: "W2N1",
    targetPos: undefined,
    retreatRoom: "W1N1",
    regroupPos: 25 * 50 + 25,
    regroupRoom: "W1N1",
    ...overrides,
  };
}

function makeTerrain(): TerrainContext {
  return {
    roomName: "W1N1",
    terrainType: "UNKNOWN",
    walkability: "UNKNOWN",
    openTileRatio: 0.5,
    wallDensity: 0.5,
    chokepoints: [],
    corridors: [],
    rampartCoverage: "UNKNOWN",
    towerCoverage: "UNKNOWN",
    coreExposure: 0.5,
    retreatQuality: "UNKNOWN",
    mobilityModifier: 1.0,
    tick: 100,
  };
}

// ═══════════════════════════════════════════════════════════
// FORM-001~006: computeSquadAnchor
// ═══════════════════════════════════════════════════════════

describe("FORM-001: computeSquadAnchor — 基本 Centroid 计算", () => {
  it("单成员时 Anchor = 成员位置，Path Leader = 该成员", () => {
    const m = makeMember("a1", "attacker", 25, 25);
    const squad = makeSquad([m]);
    const anchor = computeSquadAnchor(squad);
    expect(anchor.pos).toBe(25 * 50 + 25);
    expect(anchor.pathLeader).toBe("a1");
    expect(anchor.room).toBe("W1N1");
  });

  it("两成员时 Anchor = 几何中心", () => {
    const m1 = makeMember("a1", "attacker", 20, 20);
    const m2 = makeMember("h1", "healer", 30, 30);
    const squad = makeSquad([m1, m2]);
    const anchor = computeSquadAnchor(squad);
    // Centroid = (25, 25)
    expect(anchor.pos).toBe(25 * 50 + 25);
  });

  it("三成员时 Anchor = 几何中心（取整）", () => {
    const m1 = makeMember("a1", "attacker", 10, 10);
    const m2 = makeMember("a2", "attacker", 20, 20);
    const m3 = makeMember("h1", "healer", 30, 30);
    const squad = makeSquad([m1, m2, m3]);
    const anchor = computeSquadAnchor(squad);
    // Centroid = (20, 20)
    expect(anchor.pos).toBe(20 * 50 + 20);
  });
});

describe("FORM-002: computeSquadAnchor — Path Leader 选择（最接近 Centroid）", () => {
  it("选择最接近 Centroid 的成员作为 Path Leader", () => {
    const m1 = makeMember("a1", "attacker", 10, 10);
    const m2 = makeMember("h1", "healer", 25, 25); // 最接近 Centroid
    const m3 = makeMember("a2", "attacker", 40, 40);
    const squad = makeSquad([m1, m2, m3]);
    const anchor = computeSquadAnchor(squad);
    // Centroid = (25, 25) → m2 最接近
    expect(anchor.pathLeader).toBe("h1");
  });

  it("距离相同时确定性 tie-break：名称字典序", () => {
    const m1 = makeMember("bbb", "attacker", 20, 20);
    const m2 = makeMember("aaa", "attacker", 30, 30);
    const squad = makeSquad([m1, m2]);
    const anchor = computeSquadAnchor(squad);
    // Centroid = (25, 25) → 两者等距 → 名称字典序 "aaa" < "bbb"
    expect(anchor.pathLeader).toBe("aaa");
  });
});

describe("FORM-003: computeSquadAnchor — 无存活成员 fallback", () => {
  it("全部死亡时返回集结点作为 fallback", () => {
    const m1 = makeMember("a1", "attacker", 10, 10, "W1N1", { alive: false, hits: 0 });
    const m2 = makeMember("h1", "healer", 20, 20, "W1N1", { alive: false, hits: 0 });
    const squad = makeSquad([m1, m2]);
    const anchor = computeSquadAnchor(squad);
    expect(anchor.pos).toBe(squad.regroupPos);
    expect(anchor.room).toBe(squad.regroupRoom);
    expect(anchor.pathLeader).toBe("");
  });
});

describe("FORM-004: computeSquadAnchor — 跨房成员", () => {
  it("跨房时取人数最多的房间作为 Anchor 房间", () => {
    const m1 = makeMember("a1", "attacker", 10, 10, "W1N1");
    const m2 = makeMember("a2", "attacker", 20, 20, "W1N1");
    const m3 = makeMember("h1", "healer", 30, 30, "W2N1");
    const squad = makeSquad([m1, m2, m3]);
    const anchor = computeSquadAnchor(squad);
    expect(anchor.room).toBe("W1N1"); // 2/3 在 W1N1
  });
});

describe("FORM-005: computeSquadAnchor — 确定性", () => {
  it("相同输入必产生相同输出", () => {
    const members = [
      makeMember("a1", "attacker", 15, 15),
      makeMember("a2", "attacker", 25, 25),
      makeMember("h1", "healer", 35, 35),
    ];
    const squad = makeSquad(members);
    const a1 = computeSquadAnchor(squad);
    const a2 = computeSquadAnchor(squad);
    expect(a1).toEqual(a2);
  });
});

describe("FORM-006: computeSquadAnchor — 成员顺序无关性", () => {
  it("成员顺序不影响 Centroid 结果", () => {
    const m1 = makeMember("a1", "attacker", 10, 10);
    const m2 = makeMember("a2", "attacker", 30, 30);
    const m3 = makeMember("h1", "healer", 20, 20);
    const anchor1 = computeSquadAnchor(makeSquad([m1, m2, m3]));
    const anchor2 = computeSquadAnchor(makeSquad([m3, m1, m2]));
    expect(anchor1.pos).toBe(anchor2.pos);
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-007~010: computeFormationSlots
// ═══════════════════════════════════════════════════════════

describe("FORM-007: computeFormationSlots — 基本分配", () => {
  it("为每个存活成员分配一个 slot", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 25),
    ];
    const anchor = computeSquadAnchor(makeSquad(members));
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    expect(slots).toHaveLength(2);
    expect(slots[0]!.creepName).toBeDefined();
    expect(slots[1]!.creepName).toBeDefined();
  });

  it("死亡成员不分配 slot", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 25, "W1N1", { alive: false, hits: 0 }),
    ];
    const anchor = computeSquadAnchor(makeSquad(members));
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.creepName).toBe("a1");
  });
});

describe("FORM-008: computeFormationSlots — 角色优先级排序", () => {
  it("healer 优先于 attacker", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 25),
    ];
    const anchor = computeSquadAnchor(makeSquad(members));
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    // healer 应该 slotIndex=0
    expect(slots[0]!.role).toBe("healer");
    expect(slots[1]!.role).toBe("attacker");
  });
});

describe("FORM-009: computeFormationSlots — 阵型类型偏移", () => {
  it("CLUSTER 阵型第一个成员在中心", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const anchor = { pos: 25 * 50 + 25, room: "W1N1", pathLeader: "a1", reason: "test" };
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    expect(slots[0]!.desiredPosition).toBe(25 * 50 + 25);
  });

  it("LINE 阵型有前排和后排", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 25),
    ];
    const anchor = { pos: 25 * 50 + 25, room: "W1N1", pathLeader: "h1", reason: "test" };
    const slots = computeFormationSlots(anchor, "LINE", members);
    // healer slotIndex=0 → 前排 (y-1)
    const healerSlot = slots.find(s => s.role === "healer")!;
    const healerY = healerSlot.desiredPosition % 50;
    expect(healerY).toBe(24); // y-1
  });

  it("COLUMN 阵型沿 y 轴排列", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const anchor = { pos: 25 * 50 + 25, room: "W1N1", pathLeader: "a1", reason: "test" };
    const slots = computeFormationSlots(anchor, "COLUMN", members);
    // 第一个成员 dy = 0
    expect(slots[0]!.desiredPosition).toBe(25 * 50 + 25);
  });
});

describe("FORM-010: computeFormationSlots — 确定性", () => {
  it("相同输入必产生相同输出", () => {
    const members = [
      makeMember("a1", "attacker", 20, 20),
      makeMember("h1", "healer", 30, 30),
    ];
    const anchor = { pos: 25 * 50 + 25, room: "W1N1", pathLeader: "h1", reason: "test" };
    const s1 = computeFormationSlots(anchor, "WEDGE", members);
    const s2 = computeFormationSlots(anchor, "WEDGE", members);
    expect(s1).toEqual(s2);
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-011~013: computeCohesion
// ═══════════════════════════════════════════════════════════

describe("FORM-011: computeCohesion — INTACT", () => {
  it("成员紧密排列时 INTACT", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 26),
    ];
    const squad = makeSquad(members);
    const anchor = computeSquadAnchor(squad);
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    const cohesion = computeCohesion(squad, anchor, slots);
    expect(cohesion.status).toBe("INTACT");
    expect(cohesion.aliveCount).toBe(2);
  });
});

describe("FORM-012: computeCohesion — DEGRADED/BROKEN", () => {
  it("成员偏离较远时 DEGRADED", () => {
    const members = [
      makeMember("a1", "attacker", 10, 10),
      makeMember("h1", "healer", 15, 15),
    ];
    const squad = makeSquad(members);
    const anchor = computeSquadAnchor(squad);
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    const cohesion = computeCohesion(squad, anchor, slots);
    // Centroid (12,12)，成员偏离较远 → DEGRADED
    expect(["DEGRADED", "BROKEN"]).toContain(cohesion.status);
  });

  it("成员极度分散时 BROKEN", () => {
    const members = [
      makeMember("a1", "attacker", 0, 0),
      makeMember("h1", "healer", 49, 49),
    ];
    const squad = makeSquad(members, { formation: "CLUSTER" });
    const anchor = computeSquadAnchor(squad);
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    const cohesion = computeCohesion(squad, anchor, slots);
    expect(cohesion.status).toBe("BROKEN");
  });
});

describe("FORM-013: computeCohesion — CRITICAL（全灭）", () => {
  it("全部死亡时 CRITICAL", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25, "W1N1", { alive: false, hits: 0 }),
      makeMember("h1", "healer", 25, 26, "W1N1", { alive: false, hits: 0 }),
    ];
    const squad = makeSquad(members);
    const anchor = computeSquadAnchor(squad);
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    const cohesion = computeCohesion(squad, anchor, slots);
    expect(cohesion.status).toBe("CRITICAL");
    expect(cohesion.aliveCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-014~016: produceSquadMovementIntent
// ═══════════════════════════════════════════════════════════

describe("FORM-014: produceSquadMovementIntent — FORMING 状态", () => {
  it("FORMING 状态产出移动到集结点的 Intent", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members, { state: "FORMING" });
    const intent = produceSquadMovementIntent(squad, "FORMING", makeTerrain());
    expect(intent.destination).toBe(squad.regroupPos);
    expect(intent.destinationRoom).toBe(squad.regroupRoom);
    expect(intent.mode).toBe("ABSOLUTE");
  });
});

describe("FORM-015: produceSquadMovementIntent — MOVING 状态", () => {
  it("MOVING 状态产出移动到目标房的 Intent", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members, { state: "MOVING" });
    const intent = produceSquadMovementIntent(squad, "MOVING", makeTerrain());
    expect(intent.destinationRoom).toBe(squad.targetRoom);
    expect(intent.mode).toBe("OBJECTIVE_RELATIVE");
  });
});

describe("FORM-016: produceSquadMovementIntent — Cohesion BROKEN 产出 REGROUP", () => {
  it("Cohesion BROKEN 时产出 REGROUP Intent", () => {
    const members = [
      makeMember("a1", "attacker", 0, 0),
      makeMember("h1", "healer", 49, 49),
    ];
    const squad = makeSquad(members, { state: "ENGAGING", formation: "CLUSTER" });
    const intent = produceSquadMovementIntent(squad, "ENGAGING", makeTerrain());
    // Cohesion BROKEN → REGROUP
    expect(intent.destination).toBe(squad.regroupPos);
    expect(intent.destinationRoom).toBe(squad.regroupRoom);
    expect(intent.formation).toBe("CLUSTER");
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-017~018: detectSquadStuck
// ═══════════════════════════════════════════════════════════

describe("FORM-017: detectSquadStuck — Anchor 前进", () => {
  it("Anchor 前进时 stuckTicks=0，level=NONE", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members);
    const anchor = { pos: 25 * 50 + 25, room: "W1N1", pathLeader: "a1", reason: "test" };
    const stuck = detectSquadStuck(squad, anchor, 20 * 50 + 20, 5);
    expect(stuck.anchorStuckTicks).toBe(0);
    expect(stuck.level).toBe("NONE");
  });
});

describe("FORM-018: detectSquadStuck — Anchor 未前进累积", () => {
  it("Anchor 连续 3 tick 未前进 → SQUAD_LIGHT", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members);
    const anchor = { pos: 25 * 50 + 25, room: "W1N1", pathLeader: "a1", reason: "test" };
    const stuck = detectSquadStuck(squad, anchor, 25 * 50 + 25, 2);
    expect(stuck.anchorStuckTicks).toBe(3);
    expect(stuck.level).toBe("SQUAD_LIGHT");
  });

  it("Anchor 连续 8 tick 未前进 → SQUAD_HEAVY", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members);
    const anchor = { pos: 25 * 50 + 25, room: "W1N1", pathLeader: "a1", reason: "test" };
    const stuck = detectSquadStuck(squad, anchor, 25 * 50 + 25, 7);
    expect(stuck.anchorStuckTicks).toBe(8);
    expect(stuck.level).toBe("SQUAD_HEAVY");
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-019~020: checkHealerCohesion
// ═══════════════════════════════════════════════════════════

describe("FORM-019: checkHealerCohesion — 正常", () => {
  it("Healer 在 3 格内时 ok=true", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 27), // 距离 2
    ];
    const squad = makeSquad(members);
    const check = checkHealerCohesion(squad);
    expect(check.ok).toBe(true);
    expect(check.laggingHealers).toHaveLength(0);
  });
});

describe("FORM-020: checkHealerCohesion — Healer 掉队", () => {
  it("Healer 超过 3 格时 ok=false", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 30), // 距离 5
    ];
    const squad = makeSquad(members);
    const check = checkHealerCohesion(squad);
    expect(check.ok).toBe(false);
    expect(check.laggingHealers).toContain("h1");
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-021~022: computeRetreatFormation
// ═══════════════════════════════════════════════════════════

describe("FORM-021: computeRetreatFormation — 撤退优先级", () => {
  it("Healer 最先撤", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25, "W1N1", { hits: 500 }),
      makeMember("h1", "healer", 25, 26, "W1N1", { hits: 1000 }),
    ];
    const squad = makeSquad(members);
    const retreat = computeRetreatFormation(squad);
    expect(retreat.retreatOrder[0]).toBe("h1");
  });

  it("低 HP 成员优先于高 HP", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25, "W1N1", { hits: 200, hitsMax: 1000 }),
      makeMember("a2", "attacker", 25, 26, "W1N1", { hits: 800, hitsMax: 1000 }),
    ];
    const squad = makeSquad(members);
    const retreat = computeRetreatFormation(squad);
    expect(retreat.retreatOrder[0]).toBe("a1");
  });
});

describe("FORM-022: computeRetreatFormation — 阵型为 CLUSTER", () => {
  it("撤退时固定 CLUSTER 阵型", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members);
    const retreat = computeRetreatFormation(squad);
    expect(retreat.formation).toBe("CLUSTER");
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-023~024: squadMovementIntentHash — 确定性
// ═══════════════════════════════════════════════════════════

describe("FORM-023: squadMovementIntentHash — 确定性", () => {
  it("相同 Intent 产生相同 Hash", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members);
    const terrain = makeTerrain();
    const i1 = produceSquadMovementIntent(squad, "MOVING", terrain);
    const i2 = produceSquadMovementIntent(squad, "MOVING", terrain);
    expect(squadMovementIntentHash(i1)).toBe(squadMovementIntentHash(i2));
  });
});

describe("FORM-024: squadMovementIntentHash — 不同输入产生不同 Hash", () => {
  it("不同 Tick 产生不同 Hash", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const terrain = makeTerrain();
    const i1 = produceSquadMovementIntent(makeSquad(members, { tick: 100 }), "MOVING", terrain);
    const i2 = produceSquadMovementIntent(makeSquad(members, { tick: 200 }), "MOVING", terrain);
    expect(squadMovementIntentHash(i1)).not.toBe(squadMovementIntentHash(i2));
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-025: buildSquadSnapshot
// ═══════════════════════════════════════════════════════════

describe("FORM-025: buildSquadSnapshot — 快照构建", () => {
  it("从 SquadPlan + runtimeMembers 正确构建快照", () => {
    const plan = {
      squadId: "squad-1",
      operationId: "op-1",
      objectiveId: "obj-1",
      members: [],
      roles: new Map(),
      formation: "CLUSTER" as const,
      engagementPolicy: {
        engageRange: 3,
        focusTargetId: undefined,
        minimumHpThreshold: 50,
        retreatThreshold: 0.3,
        regroupThreshold: 0.5,
        healerRequired: true,
        enemyCapability: {
          totalAttack: 0, totalRangedAttack: 0, totalHeal: 0,
          totalRangedHeal: 0, totalDismantle: 0, totalClaim: 0,
          totalEffectiveHP: 0, avgMobility: 0, totalSupport: 0,
          totalToughParts: 0, boostedCount: 0, maxBoostTier: 0 as 0 | 1 | 2 | 3,
          creepCount: 0,
        },
        terrainRisk: 0.5,
        confidence: 0.5,
      },
      retreatPolicy: {
        retreatRoom: "W1N1",
        threshold: 0.3,
        minRetreatQuality: "POOR" as const,
        allowRearguard: false,
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
        minIntelConfidence: 0.2,
        allowBoost: true,
        allowPursuit: false,
        maxPursuitDistance: 0,
      },
      state: "FORMING" as const,
      createdTick: 100,
    };
    const runtimeMembers = [
      makeMember("a1", "attacker", 25, 25),
    ];
    const snapshot = buildSquadSnapshot(plan, runtimeMembers, 150, "W2N1");
    expect(snapshot.squadId).toBe("squad-1");
    expect(snapshot.tick).toBe(150);
    expect(snapshot.targetRoom).toBe("W2N1");
    expect(snapshot.members).toBe(runtimeMembers);
    expect(snapshot.formation).toBe("CLUSTER");
    expect(snapshot.state).toBe("FORMING");
    expect(snapshot.retreatRoom).toBe("W1N1");
    expect(snapshot.regroupPos).toBe(25 * 50 + 25);
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-026: assessFormationDegradation
// ═══════════════════════════════════════════════════════════

describe("FORM-026: assessFormationDegradation — 退化级别评估", () => {
  it("INTACT cohesion → INTACT degradation", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25),
      makeMember("h1", "healer", 25, 26),
    ];
    const squad = makeSquad(members);
    const anchor = computeSquadAnchor(squad);
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    const cohesion = computeCohesion(squad, anchor, slots);
    const degradation = assessFormationDegradation(cohesion, squad);
    expect(degradation).toBe("INTACT");
  });

  it("CRITICAL cohesion → FORMATION_BROKEN", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25, "W1N1", { alive: false, hits: 0 }),
    ];
    const squad = makeSquad(members);
    const anchor = computeSquadAnchor(squad);
    const slots = computeFormationSlots(anchor, "CLUSTER", members);
    const cohesion = computeCohesion(squad, anchor, slots);
    const degradation = assessFormationDegradation(cohesion, squad);
    expect(degradation).toBe("FORMATION_BROKEN");
  });
});

// ═══════════════════════════════════════════════════════════
// FORM-027: computeRegroupPoint
// ═══════════════════════════════════════════════════════════

describe("FORM-027: computeRegroupPoint — 集结点计算", () => {
  it("有存活成员时以 Centroid 为集结点", () => {
    const members = [makeMember("a1", "attacker", 25, 25)];
    const squad = makeSquad(members);
    const anchor = computeSquadAnchor(squad);
    const regroup = computeRegroupPoint(squad, anchor);
    expect(regroup.pos).toBe(anchor.pos);
    expect(regroup.room).toBe(anchor.room);
  });

  it("全灭时使用预设集结点", () => {
    const members = [
      makeMember("a1", "attacker", 25, 25, "W1N1", { alive: false, hits: 0 }),
    ];
    const squad = makeSquad(members);
    const anchor = computeSquadAnchor(squad);
    const regroup = computeRegroupPoint(squad, anchor);
    expect(regroup.pos).toBe(squad.regroupPos);
    expect(regroup.room).toBe(squad.regroupRoom);
  });
});
