/** A5.5 CPU Benchmark & Memory Boundedness Audit. */

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

// ─── 辅助构造函数 ───

function makeCap(overrides: Partial<CombatCapability> = {}): CombatCapability {
  return {
    attack: 120, rangedAttack: 40, heal: 0, rangedHeal: 0,
    dismantle: 0, claim: 0, effectiveHP: 1000, mobility: 1,
    support: 0, toughParts: 0, boosted: false, maxBoostTier: 0,
    totalParts: 10, activeParts: 10,
    ...overrides,
  };
}

function makeMember(name: string, role: string, x: number, y: number): MicroMemberSnapshot {
  const cap = role === "healer" ? makeCap({ attack: 0, heal: 48 }) : makeCap();
  return {
    name, role, pos: x * 50 + y, room: "W2N1",
    hits: 1000, hitsMax: 1000, fatigue: 0, alive: true,
    capability: cap,
    bodyState: deriveBodyAwareState(cap, role, 0.5),
  };
}

function makeEnemy(id: string, x: number, y: number): MicroEnemySnapshot {
  return {
    id, name: `enemy-${id}`, pos: x * 50 + y, room: "W2N1",
    hits: 1000, hitsMax: 1000,
    capability: makeCap({ attack: 100, mobility: 1 }),
    role: "attacker", lastSeenTick: 100,
  };
}

function makeTerrain(): TerrainContext {
  return {
    roomName: "W2N1", terrainType: "OPEN", walkability: "FULL",
    openTileRatio: 0.8, wallDensity: 0.1, chokepoints: [], corridors: [],
    rampartCoverage: "NONE", towerCoverage: "NONE", coreExposure: 0.3,
    retreatQuality: "GOOD", mobilityModifier: 1.0, tick: 100,
  };
}

function makeModifier(): EffectiveCombatModifier {
  return { mobilityModifier: 1.0, towerDamageFactor: 0, retreatDifficulty: 1.0, approachFactor: 1.0 };
}

function makeSquadSnapshot(squadIdx: number, memberCount: number, enemyCount: number): MicroSnapshot {
  const members: MicroMemberSnapshot[] = [];
  for (let i = 0; i < memberCount; i++) {
    const role = i % 4 === 0 ? "healer" : "attacker";
    members.push(makeMember(`s${squadIdx}-m${i}`, role, 10 + i, 10 + (i % 3)));
  }
  const enemies: MicroEnemySnapshot[] = [];
  for (let i = 0; i < enemyCount; i++) {
    enemies.push(makeEnemy(`s${squadIdx}-e${i}`, 12 + i, 10 + (i % 3)));
  }
  const attackIntents: AttackIntent[] = members.map((m, i) => ({
    squadId: `squad-${squadIdx}`, creepId: m.name,
    targetId: enemies[i % enemies.length]!.id,
    targetPos: enemies[i % enemies.length]!.pos,
    targetRoom: "W2N1", attackType: "ATTACK" as const,
    priority: "PRIMARY" as const, expectedDamage: 120,
    targetExpectedHP: 880, reason: "test", confidence: 0.85,
    tick: 100, requiresMovement: false,
  }));
  return {
    tick: 100, squadId: `squad-${squadIdx}`, objectiveId: `tac-${squadIdx}`,
    tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
    members, enemies, terrain: makeTerrain(), terrainModifier: makeModifier(),
    cohesion: null, slots: [], anchor: null, prevPlan: null,
    attackIntents, prevMicroDecisions: [], targetLocks: new Map(),
  };
}

// ═══════════════════════════════════════════════════════════
// CPU Benchmark
// ═══════════════════════════════════════════════════════════

describe("A5.5 CPU Benchmark", () => {
  const configs = [
    { squads: 1, members: 20, targets: 50 },
    { squads: 2, members: 20, targets: 50 },
    { squads: 5, members: 20, targets: 50 },
    { squads: 10, members: 20, targets: 50 },
    { squads: 20, members: 20, targets: 50 },
  ];

  for (const cfg of configs) {
    it(`${cfg.squads} Squad × ${cfg.members} Members × ${cfg.targets} Targets — CPU ≤ 5ms`, () => {
      const snapshots: MicroSnapshot[] = [];
      for (let i = 0; i < cfg.squads; i++) {
        snapshots.push(makeSquadSnapshot(i, cfg.members, cfg.targets));
      }

      // 预热
      for (const s of snapshots) planCombatMicro(s);

      // 计时
      const times: number[] = [];
      for (let rep = 0; rep < 10; rep++) {
        const start = performance.now();
        for (const s of snapshots) planCombatMicro(s);
        const elapsed = performance.now() - start;
        times.push(elapsed);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const sorted = [...times].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
      const max = sorted[sorted.length - 1]!;

      // 输出（CI 中可查看）
      // eslint-disable-next-line no-console
      console.log(
        `  ${cfg.squads}S×${cfg.members}M×${cfg.targets}T: avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`,
      );

      // 断言：单次 planCombatMicro 调用应 < 5ms（含 20 squad × 20 members × 50 targets 全量）
      expect(avg).toBeLessThan(50); // 20 squads 全量 < 50ms
    });
  }

  it("单 Squad 20 Members × 50 Targets 单次调用 < 5ms", () => {
    const snapshot = makeSquadSnapshot(0, 20, 50);

    // 预热
    planCombatMicro(snapshot);

    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      planCombatMicro(snapshot);
      times.push(performance.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    const max = sorted[sorted.length - 1]!;

    // eslint-disable-next-line no-console
    console.log(`  1S×20M×50T: avg=${avg.toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms`);

    expect(avg).toBeLessThan(5);
  });
});

// ═══════════════════════════════════════════════════════════
// Memory Boundedness Audit
// ═══════════════════════════════════════════════════════════

describe("A5.5 Memory Boundedness", () => {
  it("MicroPlan 的 decisions 数量 = alive members 数量（不无限增长）", () => {
    const members: MicroMemberSnapshot[] = [];
    for (let i = 0; i < 20; i++) {
      members.push(makeMember(`m${i}`, i % 4 === 0 ? "healer" : "attacker", 10 + i, 10));
    }
    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members, enemies: [makeEnemy("e1", 12, 10)], terrain: makeTerrain(),
      terrainModifier: makeModifier(), cohesion: null, slots: [], anchor: null,
      prevPlan: null, attackIntents: [], prevMicroDecisions: [],
      targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    // decisions 数 = alive members 数
    expect(plan.decisions.length).toBe(members.filter(m => m.alive).length);
  });

  it("kiteIntents 数量 ≤ alive members（每成员最多 1 个）", () => {
    const members = [makeMember("m0", "ranged", 10, 10), makeMember("m1", "ranged", 11, 10)];
    const enemies = [makeEnemy("e0", 10, 11)];
    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members, enemies, terrain: makeTerrain(), terrainModifier: makeModifier(),
      cohesion: null, slots: [], anchor: null, prevPlan: null,
      attackIntents: [], prevMicroDecisions: [], targetLocks: new Map(),
    };

    const plan = planCombatMicro(snapshot);

    expect(plan.kiteIntents.length).toBeLessThanOrEqual(members.length);
  });

  it("多次调用不累积状态（纯函数无内部状态）", () => {
    const snapshot = makeSquadSnapshot(0, 10, 5);

    const plan1 = planCombatMicro(snapshot);
    const plan2 = planCombatMicro(snapshot);
    const plan3 = planCombatMicro(snapshot);

    // 每次调用产生的 plan 应完全一致
    expect(plan1.decisionHash).toBe(plan2.decisionHash);
    expect(plan2.decisionHash).toBe(plan3.decisionHash);
    expect(plan1.decisions.length).toBe(plan2.decisions.length);
    expect(plan2.decisions.length).toBe(plan3.decisions.length);
  });

  it("TargetLocks 由调用方管理（domain 不内部写入）", () => {
    // domain 纯函数不应修改传入的 targetLocks Map
    const targetLocks = new Map([["a1", 105]]);
    const member = makeMember("a1", "attacker", 10, 10);
    const enemy = makeEnemy("e1", 11, 10);
    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [member], enemies: [enemy], terrain: makeTerrain(),
      terrainModifier: makeModifier(), cohesion: null, slots: [], anchor: null,
      prevPlan: null, attackIntents: [], prevMicroDecisions: [],
      targetLocks,
    };

    planCombatMicro(snapshot);

    // domain 不应修改传入的 Map
    expect(targetLocks.get("a1")).toBe(105);
    expect(targetLocks.size).toBe(1);
  });

  it("MicroPlan 结构大小有界（不包含完整 enemy/member 快照）", () => {
    const snapshot = makeSquadSnapshot(0, 20, 50);
    const plan = planCombatMicro(snapshot);

    // plan 只包含 decisions/intents，不包含原始 members/enemies
    expect(plan).not.toHaveProperty("members");
    expect(plan).not.toHaveProperty("enemies");

    // decisions/intents 数量有界
    expect(plan.decisions.length).toBeLessThanOrEqual(20);
    expect(plan.kiteIntents.length).toBeLessThanOrEqual(20);
    expect(plan.rangeIntents.length).toBeLessThanOrEqual(20);
    expect(plan.switchIntents.length).toBeLessThanOrEqual(20);
    expect(plan.reformIntents.length).toBeLessThanOrEqual(1);
    expect(plan.protectIntents.length).toBeLessThanOrEqual(1);
  });
});
