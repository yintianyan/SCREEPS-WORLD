/**
 * A5.1 G2 — Combat Capability 纯函数测试。
 *
 * 覆盖：
 * - C01: 基础 body 解析（ATTACK/RANGED_ATTACK/HEAL/TOUGH/MOVE/WORK/CLAIM）
 * - C02: Boost 倍率（T1/T2/T3 for attack/heal/tough/dismantle/move/claim）
 * - C03: effectiveHP 计算（含 TOUGH 减伤）
 * - C04: mobility 估计
 * - C05: damaged 部件排除
 * - C06: 编队聚合 aggregateCombatCapability
 * - C07: computeCombatPower 权重计算
 * - C08: 空输入处理
 * - C09: 全 MOVE scout
 * - C10: T3 boost tough 编队（极限场景）
 *
 * 引擎常量来源：docs/research/03_SCREEPS_GAME_CONSTRAINTS.md §7/§8（CONFIRMED）。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateCombatCapability,
  aggregateCombatCapability,
  computeCombatPower,
  boostTier,
  ATTACK_POWER,
  RANGED_ATTACK_POWER,
  HEAL_POWER,
  DISMANTLE_POWER,
  HITS_PER_PART,
  BOOST_MULTIPLIERS,
  type CreepSnapshot,
  type CombatCapability,
} from "../../../src/domain/combat/capability";

// ─── 测试辅助 ────────────────────────────────────────────────

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

// ─── C01: 基础 body 解析 ────────────────────────────────────

describe("G2 — evaluateCombatCapability 基础 body 解析", () => {
  it("C01a: 纯 ATTACK body → attack = parts × ATTACK_POWER", () => {
    const creep = makeCreep([
      { type: ATTACK }, { type: ATTACK }, { type: ATTACK },
      { type: MOVE }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.attack).toBe(3 * ATTACK_POWER); // 3 × 30 = 90
    expect(cap.rangedAttack).toBe(0);
    expect(cap.heal).toBe(0);
    expect(cap.dismantle).toBe(0);
    expect(cap.totalParts).toBe(5);
    expect(cap.activeParts).toBe(5);
    expect(cap.boosted).toBe(false);
    expect(cap.maxBoostTier).toBe(0);
  });

  it("C01b: 纯 RANGED_ATTACK body → rangedAttack = parts × RANGED_ATTACK_POWER", () => {
    const creep = makeCreep([
      { type: RANGED_ATTACK }, { type: RANGED_ATTACK },
      { type: MOVE }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.rangedAttack).toBe(2 * RANGED_ATTACK_POWER); // 2 × 10 = 20
    expect(cap.attack).toBe(0);
  });

  it("C01c: 纯 HEAL body → heal + rangedHeal", () => {
    const creep = makeCreep([
      { type: HEAL }, { type: HEAL },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.heal).toBe(2 * HEAL_POWER); // 2 × 12 = 24
    expect(cap.rangedHeal).toBe(2 * 4); // 2 × 4 = 8
  });

  it("C01d: 纯 WORK body → dismantle = parts × DISMANTLE_POWER", () => {
    const creep = makeCreep([
      { type: WORK }, { type: WORK },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.dismantle).toBe(2 * DISMANTLE_POWER); // 2 × 50 = 100
    expect(cap.support).toBe(2);
  });

  it("C01e: TOUGH 部件计数", () => {
    const creep = makeCreep([
      { type: TOUGH }, { type: TOUGH },
      { type: ATTACK }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.toughParts).toBe(2);
  });

  it("C01f: CLAIM 部件", () => {
    const creep = makeCreep([
      { type: CLAIM }, { type: MOVE }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.claim).toBe(1);
  });
});

// ─── C02: Boost 倍率 ────────────────────────────────────────

describe("G2 — Boost 倍率计算", () => {
  it("C02a: boostTier 从矿物类型解析", () => {
    expect(boostTier(undefined)).toBe(0);
    expect(boostTier("UH")).toBe(1); // T1
    expect(boostTier("UH2O")).toBe(2); // T2
    expect(boostTier("XUH2O")).toBe(3); // T3
    expect(boostTier("UNKNOWN")).toBe(0); // 未知矿物
  });

  it("C02b: T1 boost ATTACK → attack × 2", () => {
    const creep = makeCreep([
      { type: ATTACK, boost: "UH" },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.attack).toBe(ATTACK_POWER * 2); // 30 × 2 = 60
    expect(cap.maxBoostTier).toBe(1);
    expect(cap.boosted).toBe(true);
  });

  it("C02c: T3 boost ATTACK → attack × 4", () => {
    const creep = makeCreep([
      { type: ATTACK, boost: "XUH2O" },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.attack).toBe(ATTACK_POWER * 4); // 30 × 4 = 120
    expect(cap.maxBoostTier).toBe(3);
  });

  it("C02d: T3 boost HEAL → heal × 4", () => {
    const creep = makeCreep([
      { type: HEAL, boost: "XLHO2" },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.heal).toBe(HEAL_POWER * 4); // 12 × 4 = 48
  });

  it("C02e: T3 boost WORK (dismantle) → dismantle × 2", () => {
    const creep = makeCreep([
      { type: WORK, boost: "XZH2O" },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.dismantle).toBe(DISMANTLE_POWER * 2); // 50 × 2 = 100
  });
});

// ─── C03: effectiveHP 计算 ──────────────────────────────────

describe("G2 — effectiveHP 计算（含 TOUGH 减伤）", () => {
  it("C03a: 无 TOUGH → effectiveHP = activeParts × 100", () => {
    const creep = makeCreep([
      { type: ATTACK }, { type: ATTACK }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.effectiveHP).toBe(3 * HITS_PER_PART); // 300
  });

  it("C03b: 无 boost TOUGH →不减伤，effectiveHP = parts × 100", () => {
    const creep = makeCreep([
      { type: TOUGH }, { type: ATTACK }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    // 3 active parts × 100 = 300（TOUGH 不减伤时 = 100/1 = 100）
    expect(cap.effectiveHP).toBe(300);
  });

  it("C03c: T3 boost TOUGH → tough 部件 effectiveHP = 100/0.3 ≈ 333", () => {
    const creep = makeCreep([
      { type: TOUGH, boost: "XGHO2" },
      { type: ATTACK },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    // nonToughHP = 2 × 100 = 200
    // toughHP = 100 / 0.3 ≈ 333.33 → 取整 333
    // effectiveHP = (200 + 333) × 1.0 (满血) = 533
    expect(cap.effectiveHP).toBe(533);
  });

  it("C03d: 受损 creep effectiveHP 按比例降低", () => {
    const body = [
      { type: ATTACK }, { type: ATTACK }, { type: MOVE },
    ];
    const hitsMax = 3 * HITS_PER_PART; // 300
    const creep = makeCreep(body, { hits: 150 }); // 半血
    const cap = evaluateCombatCapability(creep);
    // hitsRatio = 150/300 = 0.5
    // effectiveHP = 300 × 0.5 = 150
    expect(cap.effectiveHP).toBe(150);
  });
});

// ─── C04: mobility 估计 ────────────────────────────────────

describe("G2 — mobility 估计", () => {
  it("C04a: 1:1 MOVE:body → mobility ≈ 1（平原无 fatigue）", () => {
    const creep = makeCreep([
      { type: ATTACK }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.mobility).toBeCloseTo(1, 1);
  });

  it("C04b: 1:2 MOVE:body → mobility ≈ 0.5（平原 2 tick/步）", () => {
    const creep = makeCreep([
      { type: ATTACK }, { type: ATTACK }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.mobility).toBeCloseTo(0.5, 1);
  });

  it("C04c: 无 MOVE → mobility = 0（不可移动）", () => {
    const creep = makeCreep([
      { type: ATTACK }, { type: ATTACK },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.mobility).toBe(0);
  });

  it("C04d: 全 MOVE → mobility = 1", () => {
    const creep = makeCreep([
      { type: MOVE }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.mobility).toBe(1);
  });
});

// ─── C05: damaged 部件排除 ──────────────────────────────────

describe("G2 — damaged 部件排除", () => {
  it("C05: damaged ATTACK 不贡献 attack 值", () => {
    const creep = makeCreep([
      { type: ATTACK }, { type: ATTACK, damaged: true },
      { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.attack).toBe(ATTACK_POWER); // 仅 1 个活跃 ATTACK
    expect(cap.activeParts).toBe(2); // 排除 damaged
    expect(cap.totalParts).toBe(3); // 包含 damaged
  });
});

// ─── C06: 编队聚合 ──────────────────────────────────────────

describe("G2 — aggregateCombatCapability 编队聚合", () => {
  it("C06a: 空数组 → 全零", () => {
    const agg = aggregateCombatCapability([]);
    expect(agg.creepCount).toBe(0);
    expect(agg.totalAttack).toBe(0);
    expect(agg.totalEffectiveHP).toBe(0);
  });

  it("C06b: 两只 creep 聚合", () => {
    const cap1 = evaluateCombatCapability(makeCreep([
      { type: ATTACK }, { type: MOVE },
    ]));
    const cap2 = evaluateCombatCapability(makeCreep([
      { type: HEAL }, { type: MOVE },
    ]));
    const agg = aggregateCombatCapability([cap1, cap2]);
    expect(agg.creepCount).toBe(2);
    expect(agg.totalAttack).toBe(ATTACK_POWER); // 30
    expect(agg.totalHeal).toBe(HEAL_POWER); // 12
    expect(agg.avgMobility).toBeCloseTo(1, 1);
  });

  it("C06c: boostedCount 统计", () => {
    const cap1 = evaluateCombatCapability(makeCreep([
      { type: ATTACK, boost: "UH" }, { type: MOVE },
    ]));
    const cap2 = evaluateCombatCapability(makeCreep([
      { type: ATTACK }, { type: MOVE },
    ]));
    const agg = aggregateCombatCapability([cap1, cap2]);
    expect(agg.boostedCount).toBe(1);
    expect(agg.maxBoostTier).toBe(1);
  });
});

// ─── C07: computeCombatPower ────────────────────────────────

describe("G2 — computeCombatPower 编队战斗力", () => {
  it("C07a: 空编队 → powerScore = 0", () => {
    const power = computeCombatPower([]);
    expect(power.powerScore).toBe(0);
    expect(power.creepCount).toBe(0);
  });

  it("C07b: 单只 ATTACK creep → burstDamage = 30, powerScore > 0", () => {
    const cap = evaluateCombatCapability(makeCreep([
      { type: ATTACK }, { type: MOVE },
    ]));
    const power = computeCombatPower([cap]);
    expect(power.burstDamage).toBe(ATTACK_POWER);
    expect(power.powerScore).toBeGreaterThan(0);
  });

  it("C07c: boost 乘数 — boosted 编队 powerScore × 1.2", () => {
    const unboosted = evaluateCombatCapability(makeCreep([
      { type: ATTACK }, { type: MOVE },
    ]));
    const boosted = evaluateCombatCapability(makeCreep([
      { type: ATTACK, boost: "XUH2O" }, { type: MOVE },
    ]));
    const powerUnboosted = computeCombatPower([unboosted]);
    const powerBoosted = computeCombatPower([boosted]);
    // boosted 编队的 burstDamage 更高（×4），且 powerScore 额外 ×1.3（T3: 1+3*0.1）
    expect(powerBoosted.burstDamage).toBe(powerUnboosted.burstDamage * 4);
    // powerScore 比率 = burstDamage 倍率 × boost 乘数 = 4 × 1.3 = 5.2
    // 但 effectiveHP 和 heal 也按比例缩放，实际比率 ≈ 4 × 1.3 = 5.2
    // 最低应 > 3.5（boost 乘数至少 1.1+，加上 burstDamage 倍率）
    expect(powerBoosted.powerScore / powerUnboosted.powerScore).toBeGreaterThan(3.5);
  });

  it("C07d: tower 覆盖惩罚 effectiveHP 权重", () => {
    const cap = evaluateCombatCapability(makeCreep([
      { type: TOUGH }, { type: ATTACK }, { type: MOVE },
    ]));
    const noTower = computeCombatPower([cap], { towerCoverage: 0, terrain: "plain", boosted: false });
    const fullTower = computeCombatPower([cap], { towerCoverage: 1, terrain: "plain", boosted: false });
    // tower 覆盖高时 effectiveHP 权重降低 → powerScore 应略低
    expect(fullTower.powerScore).toBeLessThanOrEqual(noTower.powerScore);
  });
});

// ─── C08: 空输入处理 ────────────────────────────────────────

describe("G2 — 空输入处理", () => {
  it("C08: 空 body creep", () => {
    const creep = makeCreep([]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.attack).toBe(0);
    expect(cap.totalParts).toBe(0);
    expect(cap.activeParts).toBe(0);
    expect(cap.effectiveHP).toBe(0);
    expect(cap.mobility).toBe(0);
  });
});

// ─── C09: 全 MOVE scout ────────────────────────────────────

describe("G2 — 全 MOVE scout（无战斗能力）", () => {
  it("C09: 全 MOVE body → 所有战斗维度为 0", () => {
    const creep = makeCreep([
      { type: MOVE }, { type: MOVE }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    expect(cap.attack).toBe(0);
    expect(cap.rangedAttack).toBe(0);
    expect(cap.heal).toBe(0);
    expect(cap.dismantle).toBe(0);
    expect(cap.claim).toBe(0);
    expect(cap.toughParts).toBe(0);
    expect(cap.mobility).toBe(1);
    expect(cap.boosted).toBe(false);
  });
});

// ─── C10: T3 boost tough 编队（极限场景）──────────────────

describe("G2 — T3 boost tough 编队（极限场景）", () => {
  it("C10: 5× T3 TOUGH + 5× T3 ATTACK → 高 effectiveHP + 高 attack", () => {
    const creep = makeCreep([
      { type: TOUGH, boost: "XGHO2" }, { type: TOUGH, boost: "XGHO2" },
      { type: TOUGH, boost: "XGHO2" }, { type: TOUGH, boost: "XGHO2" },
      { type: TOUGH, boost: "XGHO2" },
      { type: ATTACK, boost: "XUH2O" }, { type: ATTACK, boost: "XUH2O" },
      { type: ATTACK, boost: "XUH2O" }, { type: ATTACK, boost: "XUH2O" },
      { type: ATTACK, boost: "XUH2O" },
      { type: MOVE }, { type: MOVE }, { type: MOVE }, { type: MOVE }, { type: MOVE },
    ]);
    const cap = evaluateCombatCapability(creep);
    // 5 × T3 ATTACK = 5 × 30 × 4 = 600
    expect(cap.attack).toBe(600);
    expect(cap.maxBoostTier).toBe(3);
    expect(cap.boosted).toBe(true);
    expect(cap.toughParts).toBe(5);
    // 5 × T3 TOUGH effectiveHP = 5 × (100/0.3) ≈ 1666
    // 5 × non-TOUGH (MOVE) = 5 × 100 = 500
    // total effectiveHP ≈ 2166
    expect(cap.effectiveHP).toBeGreaterThan(2000);
  });
});
