/** A5.3 确定性验证 — warPlanHash 可重现性测试。 */
import { describe, expect, it } from "vitest";
import { planMilitaryOperation, warPlanHash, type WarPlanningInput } from "../../../src/domain/military/war-planning";
import type { CombatPower } from "../../../src/domain/combat/capability";
import type { ThreatAssessment } from "../../../src/domain/defense/threat-assessment";
import type { EmpireHealthResult } from "../../../src/domain/strategy/empire-health";

// ─── 工厂函数 ─────────────────────────────────────────────

function makeBasePower(): CombatPower {
  return {
    burstDamage: 200,
    effectiveHP: 2000,
    healOutput: 100,
    dismantlePower: 0,
    powerScore: 300,
    creepCount: 3,
    mobility: 1.5,
    boosted: false,
  };
}

function makeThreat(level: ThreatAssessment["level"], score: number): ThreatAssessment {
  return {
    level,
    score: { combat: score, intent: 0, proximity: 0, objective: 0, boost: 0, defense: 0, economicImpact: 0, total: score },
    confidence: "inferred",
    multiConfidence: {
      factConfidence: 0.9,
      combatConfidence: 0.8,
      intentConfidence: 0.5,
      terrainConfidence: 0.5,
      intelConfidence: 0.3,
      overallConfidence: 0.6,
    },
    estimatedPower: {
      attack: 150,
      rangedAttack: 0,
      heal: 50,
      effectiveHP: 1000,
      dismantle: 0,
      toughParts: 0,
      boosted: false,
      maxBoostTier: 0,
    },
    enemyCombatPower: {
      burstDamage: 150,
      effectiveHP: 1000,
      healOutput: 50,
      dismantlePower: 0,
      powerScore: 200,
      creepCount: 2,
      mobility: 1,
      boosted: false,
    },
    estimatedIntent: {
      intent: "HARASSMENT",
      confidence: 0.7,
      evidence: [],
    },
    timeToImpact: 50,
    sources: ["player"],
    recommendedPosture: "ALERT",
    tick: 1000,
  };
}

function makeEmpireHealth(level: string): EmpireHealthResult {
  return {
    level: level as EmpireHealthResult["level"],
    score: 0.7,
    dimensions: [],
    worstDimension: "",
    bottleneck: "",
    recovering: false,
    evidence: "test mock",
    tick: 1000,
  };
}

function makeInput(
  tick: number,
  threatLevel: ThreatAssessment["level"],
  threatScore: number,
  empirePosture: "war" | "develop",
  energyReserve: number,
): WarPlanningInput {
  return {
    tick,
    empirePosture,
    empireHealth: makeEmpireHealth("stable"),
    empireEnergyReserve: energyReserve,
    cpuTier: "healthy",
    threatAssessments: [
      { roomName: "W5N5", assessment: makeThreat(threatLevel, threatScore) },
    ],
    targetCandidates: [
      { roomName: "W6N6", occupied: false, owner: "Enemy", towers: 1, distance: 3, intelAge: 100, blacklisted: false, isRemote: false, isCore: false },
    ],
    ourPower: makeBasePower(),
    spawnCapacity: 2,
    activeRemoteCount: 1,
    logisticsReliability: 0.7,
    recoveryCapability: 0.6,
    replacementCapacity: 0.5,
    blacklist: {},
    freshnessThreshold: 5000,
    maxTowers: 3,
    maxDistance: 10,
    hasActiveOperation: false,
    energyPerCreep: 300,
    boostCostPerCreep: 200,
    seq: 0,
  };
}

// ─── 确定性验证测试 ───────────────────────────────────────

describe("A5.3 确定性验证 — 50 snapshot × 20 次重放", () => {
  it("相同输入产出相同 warPlanHash（50 组 × 20 次重放 = 1000 次）", () => {
    const snapshots: WarPlanningInput[] = [];
    const threatLevels: ThreatAssessment["level"][] = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const energyLevels = [500, 1000, 5000, 10000, 50000];

    // 构建 50 组不同的输入快照
    let idx = 0;
    for (const level of threatLevels) {
      for (const energy of energyLevels) {
        for (const posture of ["war", "develop"] as const) {
          if (idx >= 50) break;
          snapshots.push(makeInput(1000 + idx * 10, level, 50 + idx * 10, posture, energy));
          idx++;
        }
      }
      if (idx >= 50) break;
    }

    expect(snapshots.length).toBe(50);

    // 每组快照重放 20 次，验证 hash 一致
    let totalReplays = 0;
    for (let i = 0; i < snapshots.length; i++) {
      const input = snapshots[i]!;
      const hashes: string[] = [];

      for (let r = 0; r < 20; r++) {
        const plan = planMilitaryOperation(input);
        const hash = plan ? plan.hash : "undefined";
        hashes.push(hash);
        totalReplays++;
      }

      // 20 次重放的 hash 必须完全一致
      const firstHash = hashes[0]!;
      for (let r = 1; r < hashes.length; r++) {
        expect(hashes[r]).toBe(firstHash);
      }
    }

    // 总重放次数 = 50 × 20 = 1000
    expect(totalReplays).toBe(1000);
  });

  it("不同 tick 产出不同 operationId（计划唯一标识）", () => {
    const input1 = makeInput(1000, "HIGH", 80, "war", 10000);
    const input2 = makeInput(2000, "HIGH", 80, "war", 10000);

    const plan1 = planMilitaryOperation(input1);
    const plan2 = planMilitaryOperation(input2);

    if (plan1 && plan2) {
      // operationId 包含 tick，不同 tick 必然不同
      expect(plan1.operation.operationId).not.toBe(plan2.operation.operationId);
    }
  });

  it("warPlanHash 是纯函数（相同 plan 产出相同 hash）", () => {
    const input = makeInput(2000, "HIGH", 70, "war", 10000);
    const plan = planMilitaryOperation(input);
    if (!plan) return;

    const hash1 = warPlanHash(plan);
    const hash2 = warPlanHash(plan);
    const hash3 = warPlanHash(plan);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });
});
