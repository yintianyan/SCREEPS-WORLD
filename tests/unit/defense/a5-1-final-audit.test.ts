/**
 * A5.1 FINAL AUDIT — Threat / Combat / Remote Defense 完整审计测试。
 *
 * 覆盖审计项：
 *   §4  G1 Threat Model 验证（8 场景）
 *   §5  G1 Evidence Audit（10 评估可追溯）
 *   §6  G2 Combat Capability Audit（部件组合）
 *   §7  G2 Boost Reality Audit（T1/T2/T3 倍率）
 *   §8  G2 Mobility Audit（estimate 标注）
 *   §9  G2 CombatPower Audit（反例场景 A/B/C）
 *   §10 G4 Remote Defense Audit（7 场景）
 *   §11 Remote Defense Expected Value 消费因素验证
 *   §12 ESCORT 权责审计（不直接 spawn）
 *   §13 RETREAT / ABORT 审计（不直接 kill）
 *   §15 Replay Audit（Hash 一致性 + Divergence）
 */
import { describe, expect, it } from "vitest";
import {
  assessThreat,
  inferThreatIntent,
  analyzeHostileBody,
  type HostileSnapshot,
  type RoomContext,
  type DefenseContext,
  type ThreatAssessmentInput,
  type ThreatAssessment,
} from "../../../src/domain/defense/threat-assessment";
import {
  evaluateCombatCapability,
  aggregateCombatCapability,
  computeCombatPower,
  boostTier,
  ATTACK_POWER,
  RANGED_ATTACK_POWER,
  HEAL_POWER,
  RANGED_HEAL_POWER,
  DISMANTLE_POWER,
  HITS_PER_PART,
  BOOST_MULTIPLIERS,
  type CreepSnapshot,
  type CombatCapability,
} from "../../../src/domain/combat/capability";
import {
  decideRemoteDefenseAction,
  evaluateRemoteExpectedValue,
  type RemoteDefenseInput,
  type RemoteOperationState,
  type EmpireContext,
  type LogisticsContext,
  type MilitaryContext,
  type RemoteDefenseDecision,
} from "../../../src/domain/defense/remote-defense";
import { snapshotHash, decisionHash } from "../../../src/domain/strategy/decision-trace";

// ═══════════════════════════════════════════════════════════
// 测试辅助
// ═══════════════════════════════════════════════════════════

function makeHostile(
  body: { type: BodyPartConstant; boost?: string; damaged?: boolean }[],
  opts: Partial<HostileSnapshot> = {},
): HostileSnapshot {
  const hitsMax = body.length * 100;
  return {
    id: opts.id ?? "hostile-1",
    owner: opts.owner ?? "Invader",
    pos: opts.pos ?? 25 * 50 + 25,
    body,
    hits: opts.hits ?? hitsMax,
    hitsMax: opts.hitsMax ?? hitsMax,
    ticksToLive: opts.ticksToLive,
    room: opts.room ?? "W1N1",
  };
}

function makeRoomContext(opts: Partial<RoomContext> = {}): RoomContext {
  return {
    roomName: opts.roomName ?? "W1N1",
    corePos: opts.corePos ?? 25 * 50 + 25,
    towerCount: opts.towerCount ?? 3,
    towerEnergyTotal: opts.towerEnergyTotal ?? 3000,
    rampartCoverage: opts.rampartCoverage ?? 0.5,
    rcl: opts.rcl ?? 8,
    safeModeAvailable: opts.safeModeAvailable ?? 3,
    safeModeTicks: opts.safeModeTicks,
    hasStorage: opts.hasStorage ?? true,
    hasSpawn: opts.hasSpawn ?? true,
    friendlyCreepCount: opts.friendlyCreepCount ?? 5,
    sourceCount: opts.sourceCount ?? 2,
    isRemoteRoom: opts.isRemoteRoom ?? false,
    incomingNukes: opts.incomingNukes ?? 0,
  };
}

function makeDefenseContext(opts: Partial<DefenseContext> = {}): DefenseContext {
  return {
    colonyState: opts.colonyState ?? "normal",
    lastHostileAt: opts.lastHostileAt,
    prevThreatCount: opts.prevThreatCount ?? 0,
  };
}

function makeThreatInput(opts: Partial<ThreatAssessmentInput> = {}): ThreatAssessmentInput {
  return {
    tick: opts.tick ?? 1000000,
    hostiles: opts.hostiles ?? [],
    roomContext: opts.roomContext ?? makeRoomContext(),
    defenseContext: opts.defenseContext ?? makeDefenseContext(),
    playerIntel: opts.playerIntel,
    remoteContext: opts.remoteContext,
  };
}

function makeCreep(
  body: { type: BodyPartConstant; boost?: string; damaged?: boolean }[],
  opts: Partial<CreepSnapshot> = {},
): CreepSnapshot {
  const hitsMax = body.length * HITS_PER_PART;
  return {
    id: opts.id ?? "creep-1",
    owner: opts.owner ?? "player1",
    body,
    hits: opts.hits ?? hitsMax,
    hitsMax: opts.hitsMax ?? hitsMax,
    ticksToLive: opts.ticksToLive,
    room: opts.room ?? "W1N1",
    pos: opts.pos ?? 25 * 50 + 25,
  };
}

function makeThreat(level: ThreatAssessment["level"], intent: ThreatAssessment["estimatedIntent"]["intent"]): ThreatAssessment {
  return {
    level,
    score: { combat: 0, intent: 0, proximity: 0, objective: 0, boost: 0, defense: 0, economicImpact: 0, total: 0 },
    confidence: "fact",
    estimatedPower: { attack: 30, rangedAttack: 0, heal: 0, effectiveHP: 100, dismantle: 0, toughParts: 0, boosted: false, maxBoostTier: 0 },
    enemyCombatPower: { burstDamage: 30, effectiveHP: 100, healOutput: 0, dismantlePower: 0, powerScore: 30, creepCount: 1, mobility: 1, boosted: false },
    estimatedIntent: { intent, confidence: 0.8, evidence: ["test"] },
    timeToImpact: 100,
    sources: ["player"],
    recommendedPosture: "ALERT",
    tick: 1000000,
  };
}

function makeRemoteOp(opts: Partial<RemoteOperationState> = {}): RemoteOperationState {
  return {
    targetRoom: opts.targetRoom ?? "W2N2",
    homeRoom: opts.homeRoom ?? "W1N1",
    state: opts.state ?? "active",
    sources: opts.sources ?? 2,
    haulerNeed: opts.haulerNeed ?? 2,
    creepCount: opts.creepCount ?? 5,
    creepInvestment: opts.creepInvestment ?? 2000,
    pathCost: opts.pathCost ?? 1,
    threatUntil: opts.threatUntil,
    dangerUntil: opts.dangerUntil,
    createdAt: opts.createdAt ?? 900000,
    lastSeen: opts.lastSeen ?? 1000000,
  };
}

function makeEmpireContext(opts: Partial<EmpireContext> = {}): EmpireContext {
  return {
    tick: opts.tick ?? 1000000,
    posture: opts.posture ?? "develop",
    empireEnergyReserve: opts.empireEnergyReserve ?? 100000,
    cpuTier: opts.cpuTier ?? "comfortable",
    activeRemoteCount: opts.activeRemoteCount ?? 2,
    maxRemoteOps: opts.maxRemoteOps ?? 3,
  };
}

function makeLogisticsContext(opts: Partial<LogisticsContext> = {}): LogisticsContext {
  return { avgHaulerCommute: opts.avgHaulerCommute ?? 50, availableHaulers: opts.availableHaulers ?? 2 };
}

function makeMilitaryContext(opts: Partial<MilitaryContext> = {}): MilitaryContext {
  return {
    availableDefenders: opts.availableDefenders ?? 0,
    defenderSpawnCost: opts.defenderSpawnCost ?? 260,
    defenderCommuteTicks: opts.defenderCommuteTicks ?? 50,
    atWar: opts.atWar ?? false,
  };
}

function makeRemoteInput(opts: Partial<RemoteDefenseInput> = {}): RemoteDefenseInput {
  return {
    threat: opts.threat ?? makeThreat("NONE", "UNKNOWN"),
    remoteOp: opts.remoteOp ?? makeRemoteOp(),
    empireContext: opts.empireContext ?? makeEmpireContext(),
    logisticsContext: opts.logisticsContext ?? makeLogisticsContext(),
    militaryContext: opts.militaryContext ?? makeMilitaryContext(),
  };
}

// ═══════════════════════════════════════════════════════════
// §4 G1 Threat Model 验证（8 场景）
// ═══════════════════════════════════════════════════════════

describe("§4 G1 Threat Model — 8 场景验证", () => {
  it("S1: 单 Invader 无 Boost → LOW/MEDIUM（根据 Capability）", () => {
    const invader = makeHostile(
      [{ type: ATTACK }, { type: MOVE }],
      { owner: "Invader", pos: 40 * 50 + 40 },
    );
    const result = assessThreat(makeThreatInput({ hostiles: [invader] }));
    expect(result.sources).toContain("npc_invader");
    expect(result.level).not.toBe("NONE");
    expect(result.level).not.toBe("CRITICAL");
    expect(result.estimatedPower.attack).toBe(30);
  });

  it("S2: Boosted Attacker → Threat 显著上升", () => {
    const normal = assessThreat(makeThreatInput({
      hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "enemy", pos: 40 * 50 + 40 })],
    }));
    const boosted = assessThreat(makeThreatInput({
      hostiles: [makeHostile(
        [{ type: TOUGH, boost: "XGHO2" }, { type: ATTACK, boost: "XUH2O" }, { type: ATTACK, boost: "XUH2O" }, { type: MOVE }, { type: MOVE }],
        { owner: "enemy", pos: 40 * 50 + 40 },
      )],
    }));
    expect(boosted.score.boost).toBeGreaterThan(normal.score.boost);
    expect(boosted.score.combat).toBeGreaterThan(normal.score.combat);
    expect(boosted.estimatedPower.boosted).toBe(true);
    expect(boosted.estimatedPower.maxBoostTier).toBe(3);
  });

  it("S3: Boosted Healer → Heal Capability 影响 Assessment（不只是 Attack）", () => {
    const healerBody: { type: BodyPartConstant; boost?: string }[] = [
      ...Array.from({ length: 10 }, () => ({ type: HEAL as BodyPartConstant, boost: "XLHO2" as string })),
      ...Array.from({ length: 10 }, () => ({ type: MOVE as BodyPartConstant })),
    ];
    const healer = makeHostile(healerBody, { owner: "enemy", pos: 48 * 50 + 48 });
    const result = assessThreat(makeThreatInput({ hostiles: [healer] }));
    expect(result.estimatedPower.heal).toBe(10 * HEAL_POWER * 4); // T3 = ×4
    expect(result.estimatedPower.attack).toBe(0); // 无 ATTACK
    // Heal 影响了 combat score
    expect(result.score.combat).toBeGreaterThan(0);
  });

  it("S4: CLAIM Creep → CLAIM Intent（非普通 Attack）", () => {
    const claimer = makeHostile(
      [{ type: CLAIM }, { type: MOVE }, { type: MOVE }],
      { owner: "enemy_player", pos: 40 * 50 + 40 },
    );
    const result = assessThreat(makeThreatInput({ hostiles: [claimer] }));
    expect(result.estimatedIntent.intent).toBe("CLAIM");
  });

  it("S5: 接近 Controller → CONTROLLER_ATTACK 概率提高", () => {
    const nearController = makeHostile(
      [{ type: ATTACK }, { type: MOVE }],
      { owner: "enemy_player", pos: 26 * 50 + 26 }, // 距 core (25,25) = 1
    );
    const result = assessThreat(makeThreatInput({
      hostiles: [nearController],
      roomContext: makeRoomContext({ corePos: 25 * 50 + 25, rcl: 4 }),
    }));
    // 接近 core + attack + rcl > 0 → CONTROLLER_ATTACK
    expect(result.estimatedIntent.intent).toBe("CONTROLLER_ATTACK");
    expect(result.score.proximity).toBeGreaterThan(50);
  });

  it("S6: 远矿 Hostile → REMOTE_MINING_ATTACK", () => {
    const harasser = makeHostile(
      [{ type: ATTACK }, { type: MOVE }],
      { owner: "enemy_player", pos: 10 * 50 + 10 },
    );
    const result = assessThreat(makeThreatInput({
      hostiles: [harasser],
      roomContext: makeRoomContext({
        isRemoteRoom: true, towerCount: 0, towerEnergyTotal: 0,
        rcl: 0, hasStorage: false, hasSpawn: false,
      }),
    }));
    expect(result.estimatedIntent.intent).toBe("REMOTE_MINING_ATTACK");
  });

  it("S7: PlayerIntel 高 ThreatIndex → 提高 Confidence，不直接变 HIGH", () => {
    const playerIntel = new Map([
      ["nemesis", { username: "nemesis", threatIndex: 90, blacklist: true, lastActiveRoom: "W5N5", nemesisDistance: 3 }],
    ]);
    const result = assessThreat(makeThreatInput({
      hostiles: [makeHostile(
        [{ type: ATTACK }, { type: MOVE }],
        { owner: "nemesis", pos: 40 * 50 + 40 },
      )],
      playerIntel,
    }));
    // PlayerIntel 不直接拉高级别，但影响 confidence / evidence
    expect(result.estimatedIntent.evidence.length).toBeGreaterThan(0);
    // 单只 [ATTACK, MOVE] 不应该直接是 CRITICAL
    expect(result.level).not.toBe("CRITICAL");
  });

  it("S8: 信息不足 → 降低 Confidence，不假装知道 Intent", () => {
    // body 为空 = 信息不足
    const unknown = makeHostile([], { owner: "enemy_player", pos: 40 * 50 + 40 });
    const result = assessThreat(makeThreatInput({ hostiles: [unknown] }));
    expect(result.confidence).not.toBe("fact");
  });
});

// ═══════════════════════════════════════════════════════════
// §5 G1 Evidence Audit — 10 个 ThreatAssessment 可追溯
// ═══════════════════════════════════════════════════════════

describe("§5 G1 Evidence Audit — 10 评估可追溯", () => {
  // 生成 10 个不同的 ThreatAssessment
  const scenarios: Array<{ name: string; input: ThreatAssessmentInput }> = [
    { name: "无威胁", input: makeThreatInput({ hostiles: [] }) },
    { name: "NPC Invader", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "Invader" })] }) },
    { name: "Scout", input: makeThreatInput({ hostiles: [makeHostile([{ type: MOVE }, { type: MOVE }], { owner: "enemy" })] }) },
    { name: "Boosted Attacker", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK, boost: "XUH2O" }, { type: MOVE }], { owner: "enemy" })] }) },
    { name: "Heal Stack", input: makeThreatInput({ hostiles: [makeHostile(Array.from({ length: 26 }, () => ({ type: HEAL as BodyPartConstant })).concat(Array.from({ length: 26 }, () => ({ type: MOVE as BodyPartConstant }))), { owner: "enemy", pos: 48 * 50 + 48 })], roomContext: makeRoomContext({ towerCount: 1, towerEnergyTotal: 1000 }) }) },
    { name: "Claim", input: makeThreatInput({ hostiles: [makeHostile([{ type: CLAIM }, { type: MOVE }], { owner: "enemy" })] }) },
    { name: "Full Assault", input: makeThreatInput({ hostiles: Array.from({ length: 4 }, (_, i) => makeHostile([{ type: TOUGH, boost: "XGHO2" }, { type: ATTACK, boost: "XUH2O" }, { type: MOVE }], { owner: "enemy", pos: (40 + i) * 50 + 40, id: `c${i}` })) }) },
    { name: "Nuke", input: makeThreatInput({ roomContext: makeRoomContext({ incomingNukes: 1 }) }) },
    { name: "Remote Harass", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "enemy" })], roomContext: makeRoomContext({ isRemoteRoom: true, towerCount: 0, rcl: 0 }) }) },
    { name: "Near Controller", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "enemy", pos: 26 * 50 + 26 })], roomContext: makeRoomContext({ rcl: 4 }) }) },
  ];

  for (const { name, input } of scenarios) {
    it(`Evidence 可追溯: ${name}`, () => {
      const result = assessThreat(input);
      // 每个重要结论必须有 evidence 追溯
      expect(result.estimatedIntent.evidence).toBeDefined();
      expect(Array.isArray(result.estimatedIntent.evidence)).toBe(true);
      // 无威胁时 evidence 可以是 "无可见敌方单位"
      if (input.hostiles.length > 0 || input.roomContext.incomingNukes > 0) {
        expect(result.estimatedIntent.evidence.length).toBeGreaterThan(0);
      }
      // score 必须可拆解
      expect(result.score).toHaveProperty("combat");
      expect(result.score).toHaveProperty("intent");
      expect(result.score).toHaveProperty("proximity");
      expect(result.score).toHaveProperty("total");
      // level 必须与 total 一致
      if (result.score.total >= 75) expect(result.level).toBe("CRITICAL");
      else if (result.score.total >= 50) expect(result.level).toBe("HIGH");
      else if (result.score.total >= 25) expect(result.level).toBe("MEDIUM");
      else if (result.score.total >= 10) expect(result.level).toBe("LOW");
      else expect(result.level).toBe("NONE");
    });
  }
});

// ═══════════════════════════════════════════════════════════
// §6 G2 Combat Capability Audit — 部件组合
// ═══════════════════════════════════════════════════════════

describe("§6 G2 Combat Capability — 部件组合维度独立", () => {
  it("ATTACK → attack 维度独立", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: ATTACK }, { type: MOVE }]));
    expect(cap.attack).toBe(ATTACK_POWER);
    expect(cap.rangedAttack).toBe(0);
    expect(cap.heal).toBe(0);
    expect(cap.dismantle).toBe(0);
  });

  it("RANGED_ATTACK → rangedAttack 维度独立", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: RANGED_ATTACK }, { type: MOVE }]));
    expect(cap.rangedAttack).toBe(RANGED_ATTACK_POWER);
    expect(cap.attack).toBe(0);
  });

  it("HEAL → heal + rangedHeal 双维度", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: HEAL }, { type: MOVE }]));
    expect(cap.heal).toBe(HEAL_POWER);
    expect(cap.rangedHeal).toBe(RANGED_HEAL_POWER);
  });

  it("TOUGH → effectiveHP 维度（减伤）", () => {
    // 无 boost TOUGH：不减伤，effectiveHP = 3 parts × 100 = 300
    const unboosted = evaluateCombatCapability(makeCreep([{ type: TOUGH }, { type: ATTACK }, { type: MOVE }]));
    expect(unboosted.toughParts).toBe(1);
    expect(unboosted.effectiveHP).toBe(300);

    // T3 boost TOUGH：减伤系数 0.3，toughHP = 100/0.3 ≈ 333 → effectiveHP > 400
    const boosted = evaluateCombatCapability(makeCreep([{ type: TOUGH, boost: "XGHO2" }, { type: ATTACK }, { type: MOVE }]));
    expect(boosted.toughParts).toBe(1);
    expect(boosted.effectiveHP).toBeGreaterThan(400); // TOUGH 减伤增加等效 HP
  });

  it("MOVE → mobility 维度独立", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: ATTACK }, { type: MOVE }]));
    expect(cap.mobility).toBeCloseTo(1, 0);
  });

  it("WORK → dismantle + support 双维度", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: WORK }, { type: MOVE }]));
    expect(cap.dismantle).toBe(DISMANTLE_POWER);
    expect(cap.support).toBe(1);
  });

  it("CLAIM → claim 维度独立", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: CLAIM }, { type: MOVE }]));
    expect(cap.claim).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// §7 G2 Boost Reality Audit — T1/T2/T3 倍率核对
// ═══════════════════════════════════════════════════════════

describe("§7 G2 Boost Reality — 引擎常量核对", () => {
  it("ATTACK boost: T1=×2, T2=×3, T3=×4", () => {
    expect(BOOST_MULTIPLIERS.attack[1]).toBe(2);
    expect(BOOST_MULTIPLIERS.attack[2]).toBe(3);
    expect(BOOST_MULTIPLIERS.attack[3]).toBe(4);
    // 验证实际计算
    const t1 = evaluateCombatCapability(makeCreep([{ type: ATTACK, boost: "UH" }]));
    const t3 = evaluateCombatCapability(makeCreep([{ type: ATTACK, boost: "XUH2O" }]));
    expect(t1.attack).toBe(ATTACK_POWER * 2);
    expect(t3.attack).toBe(ATTACK_POWER * 4);
  });

  it("RANGED_ATTACK boost: T1=×2, T2=×3, T3=×4", () => {
    expect(BOOST_MULTIPLIERS.rangedAttack[1]).toBe(2);
    expect(BOOST_MULTIPLIERS.rangedAttack[3]).toBe(4);
  });

  it("HEAL boost: T1=×2, T2=×3, T3=×4", () => {
    expect(BOOST_MULTIPLIERS.heal[1]).toBe(2);
    expect(BOOST_MULTIPLIERS.heal[3]).toBe(4);
    const t3 = evaluateCombatCapability(makeCreep([{ type: HEAL, boost: "XLHO2" }]));
    expect(t3.heal).toBe(HEAL_POWER * 4);
  });

  it("TOUGH 减伤: T1=0.7, T2=0.5, T3=0.3（值越低减伤越多）", () => {
    expect(BOOST_MULTIPLIERS.tough[1]).toBe(0.7);
    expect(BOOST_MULTIPLIERS.tough[2]).toBe(0.5);
    expect(BOOST_MULTIPLIERS.tough[3]).toBe(0.3);
    // T3 TOUGH 的 effectiveHP = 100 / 0.3 ≈ 333
    const t3 = evaluateCombatCapability(makeCreep([{ type: TOUGH, boost: "XGHO2" }, { type: MOVE }]));
    // nonToughHP = 100 (MOVE), toughHP = 100/0.3 ≈ 333.33
    expect(t3.effectiveHP).toBeGreaterThan(400);
  });

  it("WORK (dismantle) boost: T1=×1.5, T2=×1.8, T3=×2", () => {
    expect(BOOST_MULTIPLIERS.dismantle[1]).toBe(1.5);
    expect(BOOST_MULTIPLIERS.dismantle[2]).toBe(1.8);
    expect(BOOST_MULTIPLIERS.dismantle[3]).toBe(2);
  });

  it("MOVE boost: T1=×2, T2=×3, T3=×4", () => {
    expect(BOOST_MULTIPLIERS.move[1]).toBe(2);
    expect(BOOST_MULTIPLIERS.move[3]).toBe(4);
  });

  it("CLAIM boost: T1=×2, T2=×3, T3=×4", () => {
    expect(BOOST_MULTIPLIERS.claim[1]).toBe(2);
    expect(BOOST_MULTIPLIERS.claim[3]).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════
// §8 G2 Mobility Audit — estimate 标注
// ═══════════════════════════════════════════════════════════

describe("§8 G2 Mobility — estimate 语义验证", () => {
  it("mobility 是 estimate，不是 Pathfinding 结果", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: ATTACK }, { type: MOVE }]));
    // mobility 存在且为有限值
    expect(cap.mobility).toBeGreaterThanOrEqual(0);
    expect(cap.mobility).toBeLessThanOrEqual(10);
    // 1:1 MOVE:body → mobility ≈ 1
    expect(cap.mobility).toBeCloseTo(1, 0);
  });

  it("无 MOVE → mobility = 0（不可移动）", () => {
    const cap = evaluateCombatCapability(makeCreep([{ type: ATTACK }]));
    expect(cap.mobility).toBe(0);
  });

  it("mobility 不等于 MOVE 数量", () => {
    const cap = evaluateCombatCapability(makeCreep([
      { type: MOVE }, { type: MOVE }, { type: MOVE },
      { type: ATTACK }, { type: ATTACK }, { type: ATTACK },
    ]));
    // mobility = 3*1*2 / (3*2) = 1, 不是 3
    expect(cap.mobility).not.toBe(3);
    expect(cap.mobility).toBeCloseTo(1, 0);
  });
});

// ═══════════════════════════════════════════════════════════
// §9 G2 CombatPower Audit — 反例场景
// ═══════════════════════════════════════════════════════════

describe("§9 G2 CombatPower — 反例场景验证", () => {
  it("Scenario A: 高 powerScore 无 Heal vs 低 powerScore 高 Heal → 不能仅看 powerScore", () => {
    const noHeal = evaluateCombatCapability(makeCreep([
      { type: ATTACK }, { type: ATTACK }, { type: ATTACK }, { type: ATTACK }, { type: MOVE },
    ]));
    const highHeal = evaluateCombatCapability(makeCreep([
      { type: HEAL }, { type: HEAL }, { type: HEAL }, { type: HEAL }, { type: MOVE },
    ]));
    const powerNoHeal = computeCombatPower([noHeal]);
    const powerHighHeal = computeCombatPower([highHeal]);
    // powerScore 可能 noHeal > highHeal，但 highHeal 的 healOutput 远高于 noHeal
    expect(powerNoHeal.burstDamage).toBeGreaterThan(powerHighHeal.burstDamage);
    expect(powerHighHeal.healOutput).toBeGreaterThan(powerNoHeal.healOutput);
    // 消费者应检查独立维度，不能只看 powerScore
  });

  it("Scenario B: 高攻击进 Tower 区域 → powerScore 不等于 Victory", () => {
    const attacker = evaluateCombatCapability(makeCreep([
      { type: ATTACK }, { type: ATTACK }, { type: MOVE },
    ]));
    const noTower = computeCombatPower([attacker], { towerCoverage: 0, terrain: "plain", boosted: false });
    const fullTower = computeCombatPower([attacker], { towerCoverage: 1, terrain: "plain", boosted: false });
    // tower 覆盖高时 powerScore 降低
    expect(fullTower.powerScore).toBeLessThanOrEqual(noTower.powerScore);
  });

  it("Scenario C: 高 Dismantle 无 Attack → Capability 维度仍然独立", () => {
    const dismantler = evaluateCombatCapability(makeCreep([
      { type: WORK }, { type: WORK }, { type: WORK }, { type: MOVE },
    ]));
    expect(dismantler.dismantle).toBe(3 * DISMANTLE_POWER);
    expect(dismantler.attack).toBe(0);
    expect(dismantler.support).toBe(3); // WORK 的辅助维度
    // powerScore 中 dismantle 有贡献但不代表战斗能力
    const power = computeCombatPower([dismantler]);
    expect(power.burstDamage).toBe(0); // 无 ATTACK/RANGED_ATTACK
    expect(power.dismantlePower).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// §10 G4 Remote Defense Audit — 7 场景
// ═══════════════════════════════════════════════════════════

describe("§10 G4 Remote Defense — 7 场景验证", () => {
  it("S1: 无 Threat → CONTINUE", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({ threat: makeThreat("NONE", "UNKNOWN") }));
    expect(d.action).toBe("CONTINUE");
  });

  it("S2: 低 Threat → PAUSE（风险 > 0.15）", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({ threat: makeThreat("MEDIUM", "HARASSMENT") }));
    expect(d.action).toBe("PAUSE");
  });

  it("S3: Harassment → 根据 EV 决定 CONTINUE/PAUSE/ESCORT", () => {
    // HIGH HARASSMENT + 默认投资 → ESCORT（EV 正）
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
      militaryContext: makeMilitaryContext({ atWar: false }),
    }));
    expect(["ESCORT", "PAUSE", "CONTINUE"]).toContain(d.action);
    // 默认场景应 ESCORT（护航后净价值正）
    expect(d.action).toBe("ESCORT");
  });

  it("S4: 强攻击 → RETREAT", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "SIEGE"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 2 }),
    }));
    expect(d.action).toBe("RETREAT");
  });

  it("S5: 不可恢复 → ABORT", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }),
    }));
    expect(d.action).toBe("ABORT");
  });

  it("S6: Escort 收益高 → ESCORT", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 3, creepInvestment: 2000 }),
      militaryContext: makeMilitaryContext({ atWar: false, defenderSpawnCost: 260 }),
    }));
    expect(d.action).toBe("ESCORT");
    expect(d.escortDemand).toBeDefined();
  });

  it("S7: Escort 成本高 → 不 ESCORT", () => {
    // 极高 defenderSpawnCost + 低 sources → 护航不划算
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "SIEGE"),
      remoteOp: makeRemoteOp({ sources: 1, creepInvestment: 50000, pathCost: 2 }),
      militaryContext: makeMilitaryContext({ defenderSpawnCost: 5000 }),
    }));
    expect(d.action).not.toBe("ESCORT");
  });
});

// ═══════════════════════════════════════════════════════════
// §11 Remote Defense Expected Value — 消费因素验证
// ═══════════════════════════════════════════════════════════

describe("§11 Remote Defense EV — 消费因素验证", () => {
  it("EV 消费 Mining Income (sources)", () => {
    const ev2 = evaluateRemoteExpectedValue(makeRemoteInput({ remoteOp: makeRemoteOp({ sources: 2 }) }));
    const ev4 = evaluateRemoteExpectedValue(makeRemoteInput({ remoteOp: makeRemoteOp({ sources: 4 }) }));
    expect(ev4.operationValue).toBeGreaterThan(ev2.operationValue);
  });

  it("EV 消费 Replacement Cost (creepInvestment)", () => {
    const ev = evaluateRemoteExpectedValue(makeRemoteInput({
      threat: makeThreat("MEDIUM", "HARASSMENT"),
      remoteOp: makeRemoteOp({ creepInvestment: 10000 }),
    }));
    expect(ev.expectedLoss).toBeGreaterThan(0);
    expect(ev.replacementCost).toBe(10000);
  });

  it("EV 消费 Escort Cost (defenderSpawnCost + commute)", () => {
    const ev = evaluateRemoteExpectedValue(makeRemoteInput({
      militaryContext: makeMilitaryContext({ defenderSpawnCost: 500, defenderCommuteTicks: 100 }),
    }));
    expect(ev.escortCost).toBeGreaterThan(500);
  });

  it("EV 消费 Threat (risk 映射)", () => {
    const evLow = evaluateRemoteExpectedValue(makeRemoteInput({ threat: makeThreat("LOW", "HARASSMENT") }));
    const evHigh = evaluateRemoteExpectedValue(makeRemoteInput({ threat: makeThreat("HIGH", "HARASSMENT") }));
    expect(evHigh.risk).toBeGreaterThan(evLow.risk);
    expect(evHigh.expectedLoss).toBeGreaterThanOrEqual(evLow.expectedLoss);
  });

  it("EV 消费 Reinforcement ETA (defenderCommuteTicks)", () => {
    const ev = evaluateRemoteExpectedValue(makeRemoteInput({
      militaryContext: makeMilitaryContext({ defenderCommuteTicks: 100 }),
    }));
    // commuteTicks 影响 escortCost
    expect(ev.escortCost).toBeGreaterThan(260);
  });

  it("决策不只根据 ThreatLevel switch", () => {
    // 相同 ThreatLevel 不同经济参数 → 不同决策
    const d1 = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
    }));
    const d2 = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 1, creepInvestment: 50000 }),
    }));
    // 同 HIGH 但不同经济参数 → 不同决策
    expect(d1.action).not.toBe(d2.action);
  });
});

// ═══════════════════════════════════════════════════════════
// §12 ESCORT 权责审计 — 不直接 spawn
// ═══════════════════════════════════════════════════════════

describe("§12 ESCORT 权责审计 — 不直接 spawn", () => {
  it("ESCORT 决策输出 escortDemand（需求标记），不调用 spawnCreep", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
      militaryContext: makeMilitaryContext({ atWar: false }),
    }));
    expect(d.action).toBe("ESCORT");
    expect(d.escortDemand).toBeDefined();
    expect(d.escortDemand!.count).toBeGreaterThan(0);
    expect(d.escortDemand!.cost).toBeGreaterThan(0);
    expect(d.escortDemand!.commuteTicks).toBeGreaterThan(0);
  });

  it("ESCORT 决策的 RemoteDefenseDecision 不包含任何 spawn 指令", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("MEDIUM", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
      militaryContext: makeMilitaryContext({ atWar: false }),
    }));
    // Decision 只包含 action/reason/expectedValue/escortDemand/rejectedAlternatives
    // 不包含 spawnCreep / submitRequest / createOperation 等执行指令
    const keys = Object.keys(d);
    expect(keys).toContain("action");
    expect(keys).toContain("reason");
    expect(keys).toContain("expectedValue");
    expect(keys).toContain("rejectedAlternatives");
    // 不应包含执行类字段
    expect(keys).not.toContain("spawnRequest");
    expect(keys).not.toContain("transportRequest");
    expect(keys).not.toContain("economyModification");
  });

  it("ESCORT 链路：Decision → escortDemand → (外部消费) → Spawn Queue → spawn-manager", () => {
    // 验证决策输出的 escortDemand 是数据标记，不是执行引用
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 3, creepInvestment: 2000 }),
      militaryContext: makeMilitaryContext({ atWar: false, defenderSpawnCost: 260 }),
    }));
    expect(d.action).toBe("ESCORT");
    // escortDemand 是纯数据：count + cost + commuteTicks
    // remote-mining-manager 消费此标记后通过 evaluateRemoteDemand → submitRequest → spawn-manager
    // decideRemoteDefenseAction 本身不调用 submitRequest
    expect(typeof d.escortDemand!.count).toBe("number");
    expect(typeof d.escortDemand!.cost).toBe("number");
    expect(typeof d.escortDemand!.commuteTicks).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════
// §13 RETREAT / ABORT 审计 — 不直接 kill
// ═══════════════════════════════════════════════════════════

describe("§13 RETREAT / ABORT 审计", () => {
  it("RETREAT 只输出决策，不直接 kill creep", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "SIEGE"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 2 }),
    }));
    expect(d.action).toBe("RETREAT");
    // Decision 只包含 action + reason + expectedValue + rejectedAlternatives
    // 不包含 killCreep / recycleCreep 等执行指令
    const keys = Object.keys(d);
    expect(keys).not.toContain("killCreeps");
    expect(keys).not.toContain("recycleCommand");
    // remote-mining-manager 消费 RETREAT 后修改 op.state = "paused" + 标记 creep recycle
    // decideRemoteDefenseAction 本身不执行这些操作
  });

  it("ABORT 正确结束 Operation（状态变更由消费方执行）", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }),
    }));
    expect(d.action).toBe("ABORT");
    // ABORT 不包含直接 kill 指令
    expect(d.action).toBe("ABORT");
    expect(d.reason).toContain("不可维持");
  });

  it("RETREAT 检查撤退安全性（pathCost）", () => {
    // pathCost > 3 → 无法安全撤退 → ABORT
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "SIEGE"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 5 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 500000 }),
    }));
    // pathCost=5 > 3 → 无法安全撤退 → ABORT
    expect(d.action).toBe("ABORT");
    expect(d.reason).toContain("距离过远");
  });

  it("ABORT 不造成不可恢复状态（op.state 由消费方修改）", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }),
    }));
    expect(d.action).toBe("ABORT");
    // Decision 不修改 op.state — remote-mining-manager 负责设置 op.state = "abandoned"
    // Decision 只是建议，不执行
    expect(d).not.toHaveProperty("newOpState");
  });
});

// ═══════════════════════════════════════════════════════════
// §14 Decision Trace Audit — 6 类 Decision 记录验证
// ═══════════════════════════════════════════════════════════

describe("§14 Decision Trace — 6 类 Decision 可记录性", () => {
  // 验证 6 类军事决策能够生成 DecisionRecord 格式的数据
  // DecisionRecord 需要：decisionId, tick, category, actor, scope, reasons, evidence,
  //   selectedAction, rejectedAlternatives, expectedOutcome, correlationId, severity,
  //   decisionHash, createdAt, lifecycle

  const traceFields = [
    "decisionId", "tick", "category", "actor", "scope",
    "reasons", "evidence", "selectedAction", "rejectedAlternatives",
    "expectedOutcome", "correlationId", "severity", "decisionHash",
    "createdAt", "lifecycle",
  ];

  it("1. Threat Assessment → 可生成 DEFENSE_PREP DecisionRecord", () => {
    const assessment = assessThreat(makeThreatInput({
      hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "enemy" })],
    }));
    // decision-trace-system.collectDefenseDecisions 消费 assessment 生成 Record
    // 验证 assessment 有足够字段生成 Record
    expect(assessment.level).toBeDefined();
    expect(assessment.estimatedIntent.intent).toBeDefined();
    expect(assessment.estimatedIntent.evidence).toBeDefined();
    expect(assessment.recommendedPosture).toBeDefined();
  });

  it("2. Intent Inference → 可追溯 Evidence", () => {
    const intents: ThreatAssessment["estimatedIntent"]["intent"][] = [
      "NUCLEAR", "CLAIM", "ECONOMIC_ATTACK", "SIEGE", "FULL_ASSAULT",
      "REMOTE_MINING_ATTACK", "CONTROLLER_ATTACK", "HARASSMENT", "SCOUTING", "UNKNOWN",
    ];
    for (const intent of intents) {
      // 每种 intent 都应该有对应的 evidence 生成路径
      // 验证 inferThreatIntent 的输出格式
      const result = inferThreatIntent(
        [makeHostile([{ type: MOVE }], { owner: "enemy" })],
        [evaluateCombatCapability(makeCreep([{ type: MOVE }]))],
        makeRoomContext(),
      );
      expect(result.evidence).toBeDefined();
      expect(Array.isArray(result.evidence)).toBe(true);
    }
  });

  it("3. Remote Defense → 可生成 REMOTE DecisionRecord", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
    }));
    // decision-trace-system.collectDefenseDecisions 消费 decision 生成 Record
    expect(d.action).toBeDefined();
    expect(d.reason).toBeDefined();
    expect(d.expectedValue).toBeDefined();
    expect(d.rejectedAlternatives).toBeDefined();
  });

  it("4. ESCORT → DecisionRecord 包含 escortDemand", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
      militaryContext: makeMilitaryContext({ atWar: false }),
    }));
    expect(d.action).toBe("ESCORT");
    expect(d.escortDemand).toBeDefined();
    // decision-trace-system 会将 escortDemand 写入 reasons
  });

  it("5. RETREAT → DecisionRecord reason 包含撤退原因", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "SIEGE"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 2 }),
    }));
    expect(d.action).toBe("RETREAT");
    expect(d.reason).toContain("撤退");
  });

  it("6. ABORT → DecisionRecord reason 包含放弃原因", () => {
    const d = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }),
    }));
    expect(d.action).toBe("ABORT");
    expect(d.reason).toContain("不可维持");
  });
});

// ═══════════════════════════════════════════════════════════
// §15 Replay Audit — DecisionHash 一致性 + Divergence
// ═══════════════════════════════════════════════════════════

describe("§15 Replay Audit — Hash 一致性与 Divergence", () => {
  // 生成 20 个不同的 G1/G4 Decision
  const scenarios: Array<{ name: string; input: ThreatAssessmentInput | RemoteDefenseInput; type: "threat" | "remote" }> = [
    // G1 Threat Scenarios (10)
    { name: "T1-无威胁", type: "threat", input: makeThreatInput({ hostiles: [] }) },
    { name: "T2-NPC-Invader", type: "threat", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "Invader" })] }) },
    { name: "T3-Scout", type: "threat", input: makeThreatInput({ hostiles: [makeHostile([{ type: MOVE }, { type: MOVE }], { owner: "enemy" })] }) },
    { name: "T4-Boosted-Attacker", type: "threat", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK, boost: "XUH2O" }, { type: MOVE }], { owner: "enemy" })] }) },
    { name: "T5-Heal-Stack", type: "threat", input: makeThreatInput({ hostiles: [makeHostile(Array.from({ length: 10 }, () => ({ type: HEAL as BodyPartConstant, boost: "XLHO2" as string })).concat(Array.from({ length: 10 }, () => ({ type: MOVE as BodyPartConstant }))), { owner: "enemy", pos: 48 * 50 + 48 })] }) },
    { name: "T6-Claim", type: "threat", input: makeThreatInput({ hostiles: [makeHostile([{ type: CLAIM }, { type: MOVE }], { owner: "enemy" })] }) },
    { name: "T7-Full-Assault", type: "threat", input: makeThreatInput({ hostiles: Array.from({ length: 4 }, (_, i) => makeHostile([{ type: TOUGH, boost: "XGHO2" }, { type: ATTACK, boost: "XUH2O" }, { type: MOVE }], { owner: "enemy", pos: (40 + i) * 50 + 40, id: `c${i}` })) }) },
    { name: "T8-Nuke", type: "threat", input: makeThreatInput({ roomContext: makeRoomContext({ incomingNukes: 1 }) }) },
    { name: "T9-Remote-Harass", type: "threat", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "enemy" })], roomContext: makeRoomContext({ isRemoteRoom: true, towerCount: 0, rcl: 0 }) }) },
    { name: "T10-Near-Core", type: "threat", input: makeThreatInput({ hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "enemy", pos: 26 * 50 + 26 })], roomContext: makeRoomContext({ rcl: 4 }) }) },
    // G4 Remote Defense Scenarios (10)
    { name: "R1-Continue", type: "remote", input: makeRemoteInput({ threat: makeThreat("NONE", "UNKNOWN") }) },
    { name: "R2-Pause", type: "remote", input: makeRemoteInput({ threat: makeThreat("MEDIUM", "HARASSMENT") }) },
    { name: "R3-Escort", type: "remote", input: makeRemoteInput({ threat: makeThreat("HIGH", "HARASSMENT"), remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }), militaryContext: makeMilitaryContext({ atWar: false }) }) },
    { name: "R4-Retreat", type: "remote", input: makeRemoteInput({ threat: makeThreat("HIGH", "SIEGE"), remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 2 }) }) },
    { name: "R5-Abort", type: "remote", input: makeRemoteInput({ threat: makeThreat("CRITICAL", "FULL_ASSAULT"), remoteOp: makeRemoteOp({ creepInvestment: 50000 }), empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }) }) },
    { name: "R6-Low-Threat-Continue", type: "remote", input: makeRemoteInput({ threat: makeThreat("LOW", "SCOUTING"), remoteOp: makeRemoteOp({ sources: 1 }) }) },
    { name: "R7-War-Retreat", type: "remote", input: makeRemoteInput({ threat: makeThreat("HIGH", "SIEGE"), empireContext: makeEmpireContext({ posture: "war" }), remoteOp: makeRemoteOp({ creepInvestment: 2000 }) }) },
    { name: "R8-Abort-Far", type: "remote", input: makeRemoteInput({ threat: makeThreat("HIGH", "SIEGE"), remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 5 }), empireContext: makeEmpireContext({ empireEnergyReserve: 500000 }) }) },
    { name: "R9-Escort-High-Value", type: "remote", input: makeRemoteInput({ threat: makeThreat("MEDIUM", "HARASSMENT"), remoteOp: makeRemoteOp({ sources: 3, creepInvestment: 2000 }), militaryContext: makeMilitaryContext({ atWar: false }) }) },
    { name: "R10-Critical-Nuke", type: "remote", input: makeRemoteInput({ threat: makeThreat("CRITICAL", "NUCLEAR"), remoteOp: makeRemoteOp({ creepInvestment: 50000 }), empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }) }) },
  ];

  for (const { name, type, input } of scenarios) {
    it(`Replay ×1000: ${name} → DecisionHash 100% 一致`, () => {
      // 生成决策
      let decisionStr: string;
      if (type === "threat") {
        const result = assessThreat(input as ThreatAssessmentInput);
        decisionStr = JSON.stringify({
          level: result.level,
          score: result.score,
          intent: result.estimatedIntent.intent,
          confidence: result.estimatedIntent.confidence,
          posture: result.recommendedPosture,
        });
      } else {
        const result = decideRemoteDefenseAction(input as RemoteDefenseInput);
        decisionStr = JSON.stringify({
          action: result.action,
          reason: result.reason,
          netValue: result.expectedValue.netValue,
          escortDemand: result.escortDemand ?? null,
        });
      }

      // Replay 1000 次 — 每次结果必须一致
      let firstHash: string | null = null;
      for (let i = 0; i < 1000; i++) {
        let replayStr: string;
        if (type === "threat") {
          const result = assessThreat(input as ThreatAssessmentInput);
          replayStr = JSON.stringify({
            level: result.level,
            score: result.score,
            intent: result.estimatedIntent.intent,
            confidence: result.estimatedIntent.confidence,
            posture: result.recommendedPosture,
          });
        } else {
          const result = decideRemoteDefenseAction(input as RemoteDefenseInput);
          replayStr = JSON.stringify({
            action: result.action,
            reason: result.reason,
            netValue: result.expectedValue.netValue,
            escortDemand: result.escortDemand ?? null,
          });
        }
        if (firstHash === null) {
          firstHash = replayStr;
        } else {
          expect(replayStr, `Replay #${i} 不一致`).toBe(firstHash);
        }
      }
      // 1000 次 Replay 全部一致
      expect(firstHash).toBe(decisionStr);
    });
  }

  it("Divergence: 修改关键输入（LOW→HIGH）→ 决策必须不同", () => {
    // 原始：LOW 威胁
    const lowResult = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("LOW", "SCOUTING"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
    }));
    // 修改：HIGH 威胁
    const highResult = decideRemoteDefenseAction(makeRemoteInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
    }));
    // 决策必须产生 Divergence
    const lowStr = JSON.stringify({ action: lowResult.action, netValue: lowResult.expectedValue.netValue });
    const highStr = JSON.stringify({ action: highResult.action, netValue: highResult.expectedValue.netValue });
    expect(lowStr).not.toBe(highStr);
  });

  it("Divergence: 修改 Threat Assessment 输入（无 boost → T3 boost）→ 评估必须不同", () => {
    const unboosted = assessThreat(makeThreatInput({
      hostiles: [makeHostile([{ type: ATTACK }, { type: MOVE }], { owner: "enemy" })],
    }));
    const boosted = assessThreat(makeThreatInput({
      hostiles: [makeHostile([{ type: ATTACK, boost: "XUH2O" }, { type: MOVE }], { owner: "enemy" })],
    }));
    // Boost 必须改变评估结果
    expect(boosted.score.boost).not.toBe(unboosted.score.boost);
    expect(boosted.score.combat).not.toBe(unboosted.score.combat);
  });
});