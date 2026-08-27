/** A5.5 Deterministic Replay Validation. */

import { describe, expect, it } from "vitest";
import {
  planCombatMicro,
  deriveBodyAwareState,
  microPlanHash,
  type MicroSnapshot,
  type MicroMemberSnapshot,
  type MicroEnemySnapshot,
} from "../../../src/domain/tactical/combat-micro";
import type { CombatCapability } from "../../../src/domain/combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../../../src/domain/defense/terrain-context";
import type { AttackIntent } from "../../../src/domain/tactical/focus-fire";
import type { CohesionMetric, FormationSlot } from "../../../src/domain/tactical/squad-formation";

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

function makeMember(name: string, role: string, x: number, y: number, room = "W2N1"): MicroMemberSnapshot {
  const cap = role === "healer" ? makeCap({ attack: 0, heal: 48 }) : role === "ranged" ? makeCap({ attack: 0, rangedAttack: 40 }) : makeCap();
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

function makeAttackIntent(creepId: string, targetId: string): AttackIntent {
  return {
    squadId: "squad-test", creepId, targetId,
    targetPos: 12 * 50 + 10, targetRoom: "W2N1",
    attackType: "ATTACK", priority: "PRIMARY",
    expectedDamage: 120, targetExpectedHP: 880,
    reason: "test", confidence: 0.85, tick: 100, requiresMovement: false,
  };
}

// ─── 生成 100 组不同的 snapshot ───

function generateSnapshots(count: number): MicroSnapshot[] {
  const snapshots: MicroSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    // 变化参数：成员数 2-10, 敌人数 1-5, tick, 地形, tower coverage
    const memberCount = 2 + (i % 9); // 2-10
    const enemyCount = 1 + (i % 5);  // 1-5
    const tick = 100 + i * 10;
    const towerCoverage = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"][i % 5] as TerrainContext["towerCoverage"];
    const terrain: TerrainContext = {
      ...makeTerrain(),
      towerCoverage,
      tick,
    };
    const modifier: EffectiveCombatModifier = {
      ...makeModifier(),
      towerDamageFactor: [0, 0.2, 0.5, 0.8, 1.0][i % 5]!,
    };

    const members: MicroMemberSnapshot[] = [];
    for (let m = 0; m < memberCount; m++) {
      const role = m === 0 ? "attacker" : m === 1 ? "ranged" : (m % 3 === 0 ? "healer" : "attacker");
      members.push(makeMember(`s${i}-m${m}`, role, 10 + m, 10 + (m % 3)));
    }

    const enemies: MicroEnemySnapshot[] = [];
    for (let e = 0; e < enemyCount; e++) {
      enemies.push(makeEnemy(`s${i}-e${e}`, 12 + e, 10 + (e % 3)));
    }

    const attackIntents: AttackIntent[] = members.map((m, idx) =>
      makeAttackIntent(m.name, enemies[idx % enemies.length]!.id),
    );

    // 部分 snapshot 有 cohesion
    let cohesion: CohesionMetric | null = null;
    if (i % 3 === 0) {
      cohesion = {
        maxAnchorDistance: 5 + (i % 10),
        avgAnchorDistance: 3 + (i % 5),
        maxMemberDistance: 8 + (i % 10),
        maxHealerDistance: 2 + (i % 5),
        slotDeviation: i % 10,
        aliveCount: memberCount,
        totalCount: memberCount,
        status: ["INTACT", "DEGRADED", "BROKEN", "CRITICAL"][i % 4] as CohesionMetric["status"],
        reason: `test cohesion ${i}`,
      };
    }

    // 部分 snapshot 有 slots
    let slots: FormationSlot[] = [];
    if (i % 2 === 0) {
      slots = members.map((m, idx) => ({
        creepName: m.name,
        role: m.role,
        desiredPosition: (15 + idx) * 50 + (10 + idx),
        desiredRoom: "W2N1",
        slotIndex: idx,
        priority: m.role === "healer" ? 0 : 1,
        tolerance: 2,
      }));
    }

    snapshots.push({
      tick, squadId: `squad-${i}`, objectiveId: `tac-${i}`,
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members, enemies, terrain, terrainModifier: modifier,
      cohesion, slots, anchor: null, prevPlan: null,
      attackIntents, prevMicroDecisions: [],
      targetLocks: new Map(),
    });
  }
  return snapshots;
}

// ═══════════════════════════════════════════════════════════

describe("A5.5 Deterministic Replay (100 Snapshots × 1000 Replays)", () => {
  const snapshots = generateSnapshots(100);

  it("100 组 snapshot 全部生成成功", () => {
    expect(snapshots.length).toBe(100);
    for (const s of snapshots) {
      expect(s.members.length).toBeGreaterThan(0);
    }
  });

  it("每组 snapshot 的 planHash 在 1000 次 replay 中完全一致", () => {
    const hashes: string[] = [];
    for (const snapshot of snapshots) {
      const firstPlan = planCombatMicro(snapshot);
      const firstHash = firstPlan.decisionHash;

      for (let rep = 0; rep < 1000; rep++) {
        const replayPlan = planCombatMicro(snapshot);
        if (replayPlan.decisionHash !== firstHash) {
          throw new Error(
            `Snapshot ${snapshot.squadId} replay ${rep}: hash mismatch ${replayPlan.decisionHash} ≠ ${firstHash}`,
          );
        }
      }
      hashes.push(firstHash);
    }
  });

  it("所有 100 个 snapshot 产生的 hash 应有足够多样性（≥ 50 个不同 hash）", () => {
    const hashSet = new Set<string>();
    for (const snapshot of snapshots) {
      const plan = planCombatMicro(snapshot);
      hashSet.add(plan.decisionHash);
    }
    // 100 个不同 snapshot 应产生至少 50 个不同 hash
    // （部分可能因 empty plan 而 hash 相同）
    expect(hashSet.size).toBeGreaterThanOrEqual(50);
  });

  it("每个 decision 的 decisionHash 在 replay 中完全一致", () => {
    for (const snapshot of snapshots.slice(0, 10)) { // 取前 10 个以控制运行时间
      const firstPlan = planCombatMicro(snapshot);

      for (let rep = 0; rep < 100; rep++) {
        const replayPlan = planCombatMicro(snapshot);
        expect(replayPlan.decisions.length).toBe(firstPlan.decisions.length);
        for (let j = 0; j < replayPlan.decisions.length; j++) {
          expect(replayPlan.decisions[j]!.decisionHash).toBe(
            firstPlan.decisions[j]!.decisionHash,
          );
        }
      }
    }
  });

  it("tie-break 稳定：相同 priority/urgency/distance 时按 id 排序", () => {
    // 构造两个完全相同 priority 的 member
    const member1 = makeMember("aaa", "attacker", 10, 10);
    const member2 = makeMember("bbb", "attacker", 10, 10);
    const enemy = makeEnemy("e1", 11, 10);
    const attackIntent1 = makeAttackIntent("aaa", "e1");
    const attackIntent2 = makeAttackIntent("bbb", "e1");
    const snapshot: MicroSnapshot = {
      tick: 100, squadId: "squad-test", objectiveId: "tac-test",
      tacticalState: "ENGAGING", warPosture: "war", authorizedTargetRoom: "W2N1",
      members: [member1, member2], enemies: [enemy],
      terrain: makeTerrain(), terrainModifier: makeModifier(),
      cohesion: null, slots: [], anchor: null, prevPlan: null,
      attackIntents: [attackIntent1, attackIntent2],
      prevMicroDecisions: [], targetLocks: new Map(),
    };

    // 多次 replay
    const hashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      const plan = planCombatMicro(snapshot);
      hashes.push(plan.decisionHash);
    }

    // 所有 hash 应相同
    const unique = new Set(hashes);
    expect(unique.size).toBe(1);
  });
});
