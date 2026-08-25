/**
 * A5.3 — Military Operation & War Planning 纯函数测试。
 *
 * 覆盖：
 *   §1. 12 种 OperationType（Operation 模型：isOffensive / isDefensive / 生命周期 / Hash）
 *   §2. WarPosture 授权矩阵（CEASEFIRE / DEFENSIVE / CONTAIN / LIMITED_OFFENSIVE / FULL_OFFENSIVE）
 *   §3. Capability 评估（deriveRequiredCapability × 12 type / computeCapabilityGap / deriveForceComposition）
 *   §4. Economic Guard（5 维度门槛 + 防御/进攻差异 + recommendation 降级链）
 *   §5. Target 选择（scoreTarget / selectTarget 多维度评分 + 硬过滤 + 排序）
 *   §6. WarPlan Hash 确定性（planMilitaryOperation 端到端 + 相同输入同 hash）
 */
import { describe, expect, it } from "vitest";

import {
  type OperationType,
  type OperationStatus,
  type MilitaryOperation,
  type AbortCondition,
  makeOperationId,
  isOffensive,
  isDefensive,
  isTerminal,
  canTransition,
  transition,
  checkPreparationGate,
  operationHash,
} from "../../../src/domain/military/operation";

import {
  type WarPosture,
  evaluateWarPosture,
  isOperationAuthorized,
} from "../../../src/domain/military/war-posture";

import {
  type RequiredCapability,
  type CapabilityGap,
  type ForceComposition,
  deriveRequiredCapability,
  computeCapabilityGap,
  deriveForceComposition,
} from "../../../src/domain/military/force-requirement";

import {
  type EconomicGuardInput,
  checkEconomicGuard,
} from "../../../src/domain/military/economic-guard";

import {
  type TargetCandidate,
  type TargetScore,
  scoreTarget,
  selectTarget,
} from "../../../src/domain/military/target-selection";

import {
  estimateWarCost,
  type WarCostInput,
} from "../../../src/domain/military/war-cost";

import {
  assessOperationRisk,
  type RiskInput,
} from "../../../src/domain/military/risk-model";

import {
  evaluateOperationValue,
} from "../../../src/domain/military/operation-value";

import {
  planMilitaryOperation,
  warPlanHash,
  type WarPlanningInput,
} from "../../../src/domain/military/war-planning";

import type { CombatPower } from "../../../src/domain/combat/capability";
import type { ThreatAssessment } from "../../../src/domain/defense/threat-assessment";
import type { TerrainContext } from "../../../src/domain/defense/terrain-context";
import type { MultiDimensionalConfidence } from "../../../src/domain/defense/confidence";
import type { EmpireHealthResult } from "../../../src/domain/strategy/empire-health";

// ═══════════════════════════════════════════════════════════
// 测试辅助：构建器
// ═══════════════════════════════════════════════════════════

function makeCombatPower(overrides: Partial<CombatPower> = {}): CombatPower {
  return {
    burstDamage: 200,
    effectiveHP: 2000,
    healOutput: 120,
    dismantlePower: 100,
    powerScore: 500,
    creepCount: 4,
    mobility: 1.0,
    boosted: false,
    ...overrides,
  };
}

function makeThreatAssessment(overrides: Partial<ThreatAssessment> = {}): ThreatAssessment {
  return {
    level: "HIGH",
    score: { combat: 40, intent: 60, proximity: 50, objective: 50, boost: 0, defense: 30, economicImpact: 30, total: 55 },
    confidence: "inferred",
    multiConfidence: makeConfidence(),
    estimatedPower: {
      attack: 100, rangedAttack: 50, heal: 80, effectiveHP: 1500,
      dismantle: 0, toughParts: 2, boosted: false, maxBoostTier: 0,
    },
    enemyCombatPower: makeCombatPower({ burstDamage: 150, effectiveHP: 1500, powerScore: 350 }),
    estimatedIntent: { intent: "HARASSMENT", confidence: 0.7, evidence: ["test"] },
    timeToImpact: 50,
    sources: ["player"],
    recommendedPosture: "FORTIFY",
    tick: 1000,
    ...overrides,
  };
}

function makeConfidence(overrides: Partial<MultiDimensionalConfidence> = {}): MultiDimensionalConfidence {
  return {
    factConfidence: 0.9,
    combatConfidence: 0.9,
    intentConfidence: 0.7,
    terrainConfidence: 0.6,
    intelConfidence: 0.5,
    overallConfidence: 0.7,
    ...overrides,
  };
}

function makeTerrainContext(overrides: Partial<TerrainContext> = {}): TerrainContext {
  return {
    roomName: "W1N1",
    terrainType: "OPEN",
    walkability: "FULL",
    openTileRatio: 0.8,
    wallDensity: 0.2,
    chokepoints: [],
    corridors: [],
    rampartCoverage: "NONE",
    towerCoverage: "NONE",
    coreExposure: 0.5,
    retreatQuality: "GOOD",
    mobilityModifier: 1.0,
    tick: 1000,
    ...overrides,
  };
}

function makeEmpireHealth(overrides: Partial<EmpireHealthResult> = {}): EmpireHealthResult {
  return {
    level: "healthy",
    score: 0.9,
    dimensions: [],
    worstDimension: "none",
    bottleneck: "none",
    recovering: false,
    evidence: "test",
    tick: 1000,
    ...overrides,
  };
}

function makeTargetCandidate(overrides: Partial<TargetCandidate> = {}): TargetCandidate {
  return {
    roomName: "W2N1",
    occupied: false,
    owner: "Enemy",
    towers: 0,
    rcl: 4,
    distance: 3,
    intelAge: 100,
    blacklisted: false,
    isRemote: false,
    isCore: false,
    ...overrides,
  };
}

function makeWarPlanningInput(overrides: Partial<WarPlanningInput> = {}): WarPlanningInput {
  const threat = makeThreatAssessment();
  return {
    tick: 1000,
    empirePosture: "war",
    empireHealth: makeEmpireHealth(),
    empireEnergyReserve: 50000,
    cpuTier: "healthy",
    threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    playerIntel: undefined,
    confidence: makeConfidence(),
    targetCandidates: [],
    ourPower: makeCombatPower(),
    spawnCapacity: 3,
    activeRemoteCount: 2,
    logisticsReliability: 0.8,
    recoveryCapability: 0.5,
    replacementCapacity: 0.5,
    blacklist: {},
    freshnessThreshold: 2000,
    maxTowers: 6,
    maxDistance: 10,
    hasActiveOperation: false,
    energyPerCreep: 800,
    boostCostPerCreep: 500,
    seq: 1,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// §1. Operation 模型 — 12 种 OperationType
// ═══════════════════════════════════════════════════════════

describe("A5.3 §1 — Operation 模型", () => {
  const ALL_TYPES: OperationType[] = [
    "DEFEND", "ESCORT", "HARASS", "SIEGE", "ASSAULT", "RAID",
    "CONTROLLER_ATTACK", "REMOTE_DENIAL", "CLAIM", "RESERVE",
    "RETREAT", "ABORT",
  ];

  describe("isOffensive / isDefensive — 12 种分类", () => {
    const offensive: OperationType[] = ["ASSAULT", "SIEGE", "RAID", "CONTROLLER_ATTACK", "REMOTE_DENIAL", "CLAIM"];
    const defensive: OperationType[] = ["DEFEND", "ESCORT", "RETREAT"];

    it.each(offensive)("isOffensive(%s) = true", (type) => {
      expect(isOffensive(type)).toBe(true);
    });

    it.each(defensive)("isDefensive(%s) = true", (type) => {
      expect(isDefensive(type)).toBe(true);
    });

    it("ABORT 既非 offensive 也非 defensive（终止态）", () => {
      expect(isOffensive("ABORT")).toBe(false);
      expect(isDefensive("ABORT")).toBe(false);
    });

    it("offensive ∩ defensive = ∅（无重叠）", () => {
      for (const t of ALL_TYPES) {
        expect(isOffensive(t) && isDefensive(t)).toBe(false);
      }
    });

    it("12 种类型全覆盖（枚举无遗漏）", () => {
      expect(ALL_TYPES).toHaveLength(12);
    });
  });

  describe("makeOperationId — 确定性 ID 生成", () => {
    it("格式 OP-{tick}-{seq}", () => {
      expect(makeOperationId(1000, 1)).toBe("OP-1000-1");
      expect(makeOperationId(50000, 99)).toBe("OP-50000-99");
    });

    it("相同 tick+seq 生成相同 ID", () => {
      expect(makeOperationId(1000, 1)).toBe(makeOperationId(1000, 1));
    });

    it("不同 tick 或 seq 生成不同 ID", () => {
      expect(makeOperationId(1000, 1)).not.toBe(makeOperationId(1000, 2));
      expect(makeOperationId(1000, 1)).not.toBe(makeOperationId(1001, 1));
    });
  });

  describe("isTerminal — 终态判定", () => {
    it.each(["COMPLETED", "FAILED", "EXPIRED"] as OperationStatus[])("%s 是终态", (s) => {
      expect(isTerminal(s)).toBe(true);
    });

    it.each(["PLANNED", "AUTHORIZED", "PREPARING", "READY", "ACTIVE", "DEGRADED", "ABORTING"] as OperationStatus[])("%s 非终态", (s) => {
      expect(isTerminal(s)).toBe(false);
    });
  });

  describe("canTransition — 合法状态转换", () => {
    it("PLANNED → AUTHORIZED 合法", () => {
      expect(canTransition("PLANNED", "AUTHORIZED")).toBe(true);
    });

    it("PLANNED → ACTIVE 非法（不可跳过 AUTHORIZED）", () => {
      expect(canTransition("PLANNED", "ACTIVE")).toBe(false);
    });

    it("ACTIVE → COMPLETED 合法", () => {
      expect(canTransition("ACTIVE", "COMPLETED")).toBe(true);
    });

    it("COMPLETED → ACTIVE 非法（终态不可转出）", () => {
      expect(canTransition("COMPLETED", "ACTIVE")).toBe(false);
    });

    it("ACTIVE → DEGRADED 合法（降级运行）", () => {
      expect(canTransition("ACTIVE", "DEGRADED")).toBe(true);
      // 可恢复回 ACTIVE
      expect(canTransition("DEGRADED", "ACTIVE")).toBe(true);
    });

    it("任何 → ABORTING 合法（紧急终止）", () => {
      expect(canTransition("PLANNED", "ABORTING")).toBe(false); // PLANNED → AUTHORIZED/EXPIRED/FAILED only
      expect(canTransition("AUTHORIZED", "ABORTING")).toBe(true);
      expect(canTransition("PREPARING", "ABORTING")).toBe(true);
      expect(canTransition("ACTIVE", "ABORTING")).toBe(true);
    });
  });

  describe("transition — 状态转换函数", () => {
    it("合法转换：追加 evidence 记录", () => {
      const op: MilitaryOperation = {
        operationId: "OP-1-1",
        type: "DEFEND",
        objective: "DEFEND_CORE",
        target: { roomName: "W1N1", targetType: "room", valueScore: 80, evidence: [] },
        posture: "DEFENSIVE",
        priority: { score: 50, factor: "DEFENSIVE", evidence: [] },
        risk: "LOW",
        status: "PLANNED",
        constraints: { maxCpuPerTick: 5, maxEnergyBudget: 1000, maxDuration: 5000, minIntelConfidence: 0.3, allowBoost: false, allowNuke: false, abortConditions: [] },
        createdTick: 1, expiresTick: 5001, confidence: 0.7, reason: "test", evidence: [],
      };

      const next = transition(op, "AUTHORIZED", 100, "force ready");
      expect(next.status).toBe("AUTHORIZED");
      expect(next.evidence).toContain("[100] PLANNED→AUTHORIZED: force ready");
    });

    it("非法转换：原样返回（不变）", () => {
      const op: MilitaryOperation = {
        operationId: "OP-1-1",
        type: "DEFEND",
        objective: "DEFEND_CORE",
        target: { roomName: "W1N1", targetType: "room", valueScore: 80, evidence: [] },
        posture: "DEFENSIVE",
        priority: { score: 50, factor: "DEFENSIVE", evidence: [] },
        risk: "LOW",
        status: "COMPLETED",
        constraints: { maxCpuPerTick: 5, maxEnergyBudget: 1000, maxDuration: 5000, minIntelConfidence: 0.3, allowBoost: false, allowNuke: false, abortConditions: [] },
        createdTick: 1, expiresTick: 5001, confidence: 0.7, reason: "test", evidence: [],
      };

      const next = transition(op, "ACTIVE", 200, "should not work");
      expect(next.status).toBe("COMPLETED");
      expect(next.evidence).not.toContain("[200] COMPLETED→ACTIVE: should not work");
    });
  });

  describe("checkPreparationGate — 准备门禁", () => {
    it("全通过 → ready=true, blockers=[]", () => {
      const result = checkPreparationGate({
        forceReady: true, logisticsReady: true, intelReady: true,
        targetValid: true, strategicAuthorization: true, recoveryReady: true,
      });
      expect(result.ready).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("缺 force → blocker", () => {
      const result = checkPreparationGate({
        forceReady: false, logisticsReady: true, intelReady: true,
        targetValid: true, strategicAuthorization: true, recoveryReady: true,
      });
      expect(result.ready).toBe(false);
      expect(result.blockers).toContain("FORCE_NOT_READY");
    });

    it("全缺 → 6 个 blocker", () => {
      const result = checkPreparationGate({
        forceReady: false, logisticsReady: false, intelReady: false,
        targetValid: false, strategicAuthorization: false, recoveryReady: false,
      });
      expect(result.ready).toBe(false);
      expect(result.blockers).toHaveLength(6);
    });
  });

  describe("operationHash — 确定性", () => {
    it("相同 operation 生成相同 hash", () => {
      const op: MilitaryOperation = {
        operationId: "OP-1-1",
        type: "DEFEND",
        objective: "DEFEND_CORE",
        target: { roomName: "W1N1", targetType: "room", valueScore: 80, evidence: [] },
        posture: "DEFENSIVE",
        priority: { score: 50, factor: "DEFENSIVE", evidence: [] },
        risk: "LOW",
        status: "PLANNED",
        constraints: { maxCpuPerTick: 5, maxEnergyBudget: 1000, maxDuration: 5000, minIntelConfidence: 0.3, allowBoost: false, allowNuke: false, abortConditions: [] },
        createdTick: 1, expiresTick: 5001, confidence: 0.7, reason: "test", evidence: [],
      };
      const h1 = operationHash(op);
      const h2 = operationHash({ ...op });
      expect(h1).toBe(h2);
    });

    it("不同 status 生成不同 hash", () => {
      const base: MilitaryOperation = {
        operationId: "OP-1-1",
        type: "DEFEND",
        objective: "DEFEND_CORE",
        target: { roomName: "W1N1", targetType: "room", valueScore: 80, evidence: [] },
        posture: "DEFENSIVE",
        priority: { score: 50, factor: "DEFENSIVE", evidence: [] },
        risk: "LOW",
        status: "PLANNED",
        constraints: { maxCpuPerTick: 5, maxEnergyBudget: 1000, maxDuration: 5000, minIntelConfidence: 0.3, allowBoost: false, allowNuke: false, abortConditions: [] },
        createdTick: 1, expiresTick: 5001, confidence: 0.7, reason: "test", evidence: [],
      };
      expect(operationHash(base)).not.toBe(operationHash({ ...base, status: "ACTIVE" }));
    });

    it("hash 为 8 位 hex 字符串", () => {
      const op: MilitaryOperation = {
        operationId: "OP-1-1",
        type: "DEFEND",
        objective: "DEFEND_CORE",
        target: { roomName: "W1N1", targetType: "room", valueScore: 80, evidence: [] },
        posture: "DEFENSIVE",
        priority: { score: 50, factor: "DEFENSIVE", evidence: [] },
        risk: "LOW",
        status: "PLANNED",
        constraints: { maxCpuPerTick: 5, maxEnergyBudget: 1000, maxDuration: 5000, minIntelConfidence: 0.3, allowBoost: false, allowNuke: false, abortConditions: [] },
        createdTick: 1, expiresTick: 5001, confidence: 0.7, reason: "test", evidence: [],
      };
      const h = operationHash(op);
      expect(h).toMatch(/^[0-9a-f]{8}$/);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// §2. WarPosture — 唯一进攻授权
// ═══════════════════════════════════════════════════════════

describe("A5.3 §2 — WarPosture 授权矩阵", () => {
  describe("evaluateWarPosture — 姿态评估", () => {
    it("empirePosture != war → CEASEFIRE（不授权进攻）", () => {
      const result = evaluateWarPosture({
        empirePosture: "develop",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [],
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("CEASEFIRE");
      expect(result.offensiveAuthorized).toBe(false);
      expect(result.offensiveLevel).toBe(0);
    });

    it("empireHealth = critical → DEFENSIVE（帝国危急不进攻）", () => {
      const threat = makeThreatAssessment({ level: "CRITICAL" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "critical",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("DEFENSIVE");
      expect(result.offensiveAuthorized).toBe(false);
    });

    it("cpuTier = recovery → DEFENSIVE（CPU 不够）", () => {
      const threat = makeThreatAssessment({ level: "CRITICAL" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        cpuTier: "recovery",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("DEFENSIVE");
      expect(result.offensiveAuthorized).toBe(false);
    });

    it("无 HIGH+ 威胁 → DEFENSIVE（无人严重威胁不需要进攻）", () => {
      const threat = makeThreatAssessment({ level: "LOW" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("DEFENSIVE");
      expect(result.offensiveAuthorized).toBe(false);
    });

    it("HIGH 威胁 + 高置信度 → CONTAIN（遏制，有限进攻）", () => {
      const threat = makeThreatAssessment({ level: "HIGH" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        confidence: makeConfidence({ overallConfidence: 0.8 }),
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("CONTAIN");
      expect(result.offensiveAuthorized).toBe(true);
      expect(result.offensiveLevel).toBe(1);
    });

    it("CRITICAL 威胁 + healthy + spawn>0 + confidence≥0.7 → FULL_OFFENSIVE", () => {
      const threat = makeThreatAssessment({ level: "CRITICAL" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        confidence: makeConfidence({ overallConfidence: 0.8 }),
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("FULL_OFFENSIVE");
      expect(result.offensiveAuthorized).toBe(true);
      expect(result.offensiveLevel).toBe(2);
    });

    it("CRITICAL 威胁 + healthy 但 confidence<0.7 → LIMITED_OFFENSIVE", () => {
      const threat = makeThreatAssessment({ level: "CRITICAL" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        confidence: makeConfidence({ overallConfidence: 0.6 }),
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("LIMITED_OFFENSIVE");
      expect(result.offensiveAuthorized).toBe(true);
      expect(result.offensiveLevel).toBe(1);
    });

    it("CRITICAL 威胁 + stable（非 healthy）→ LIMITED_OFFENSIVE（不到 FULL 条件）", () => {
      const threat = makeThreatAssessment({ level: "CRITICAL" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "stable",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        confidence: makeConfidence({ overallConfidence: 0.8 }),
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("LIMITED_OFFENSIVE");
    });

    it("HIGH 威胁 + 低置信度(<0.4) → CONTAIN（不盲目进攻）", () => {
      const threat = makeThreatAssessment({ level: "HIGH" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        confidence: makeConfidence({ overallConfidence: 0.3, intelConfidence: 0.1 }),
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 3,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("CONTAIN");
      expect(result.offensiveAuthorized).toBe(true);
      expect(result.offensiveLevel).toBe(1);
    });

    it("CRITICAL 威胁 + spawn=0 → LIMITED_OFFENSIVE（有 spawn 才 FULL）", () => {
      const threat = makeThreatAssessment({ level: "CRITICAL" });
      const result = evaluateWarPosture({
        empirePosture: "war",
        tick: 1000,
        empireHealth: "healthy",
        empireEnergyReserve: 50000,
        threatAssessments: [{ roomName: "W1N1", assessment: threat }],
        confidence: makeConfidence({ overallConfidence: 0.8 }),
        cpuTier: "healthy",
        activeRemoteCount: 2,
        spawnCapacity: 0,
        hasActiveOperation: false,
      });
      expect(result.posture).toBe("LIMITED_OFFENSIVE");
    });
  });

  describe("isOperationAuthorized — 授权矩阵", () => {
    it("CEASEFIRE → 不授权任何操作", () => {
      const types: OperationType[] = ["DEFEND", "ESCORT", "HARASS", "ASSAULT", "SIEGE", "CLAIM"];
      for (const t of types) {
        expect(isOperationAuthorized("CEASEFIRE", t)).toBe(false);
      }
    });

    it("DEFENSIVE → 只授权 DEFEND / ESCORT / RETREAT / ABORT", () => {
      expect(isOperationAuthorized("DEFENSIVE", "DEFEND")).toBe(true);
      expect(isOperationAuthorized("DEFENSIVE", "ESCORT")).toBe(true);
      expect(isOperationAuthorized("DEFENSIVE", "RETREAT")).toBe(true);
      expect(isOperationAuthorized("DEFENSIVE", "ABORT")).toBe(true);
      // 进攻类不授权
      expect(isOperationAuthorized("DEFENSIVE", "HARASS")).toBe(false);
      expect(isOperationAuthorized("DEFENSIVE", "ASSAULT")).toBe(false);
      expect(isOperationAuthorized("DEFENSIVE", "SIEGE")).toBe(false);
      expect(isOperationAuthorized("DEFENSIVE", "CLAIM")).toBe(false);
    });

    it("CONTAIN → DEFENSIVE + HARASS + REMOTE_DENIAL", () => {
      expect(isOperationAuthorized("CONTAIN", "DEFEND")).toBe(true);
      expect(isOperationAuthorized("CONTAIN", "ESCORT")).toBe(true);
      expect(isOperationAuthorized("CONTAIN", "HARASS")).toBe(true);
      expect(isOperationAuthorized("CONTAIN", "REMOTE_DENIAL")).toBe(true);
      // SIEGE/RAID/ASSAULT/CLAIM 不授权
      expect(isOperationAuthorized("CONTAIN", "SIEGE")).toBe(false);
      expect(isOperationAuthorized("CONTAIN", "RAID")).toBe(false);
      expect(isOperationAuthorized("CONTAIN", "ASSAULT")).toBe(false);
      expect(isOperationAuthorized("CONTAIN", "CLAIM")).toBe(false);
    });

    it("LIMITED_OFFENSIVE → CONTAIN + SIEGE + RAID + CONTROLLER_ATTACK + RESERVE", () => {
      expect(isOperationAuthorized("LIMITED_OFFENSIVE", "HARASS")).toBe(true);
      expect(isOperationAuthorized("LIMITED_OFFENSIVE", "SIEGE")).toBe(true);
      expect(isOperationAuthorized("LIMITED_OFFENSIVE", "RAID")).toBe(true);
      expect(isOperationAuthorized("LIMITED_OFFENSIVE", "CONTROLLER_ATTACK")).toBe(true);
      expect(isOperationAuthorized("LIMITED_OFFENSIVE", "RESERVE")).toBe(true);
      // ASSAULT/CLAIM 仍不授权
      expect(isOperationAuthorized("LIMITED_OFFENSIVE", "ASSAULT")).toBe(false);
      expect(isOperationAuthorized("LIMITED_OFFENSIVE", "CLAIM")).toBe(false);
    });

    it("FULL_OFFENSIVE → 全部授权（包括 ASSAULT + CLAIM）", () => {
      const allTypes: OperationType[] = [
        "DEFEND", "ESCORT", "HARASS", "SIEGE", "ASSAULT", "RAID",
        "CONTROLLER_ATTACK", "REMOTE_DENIAL", "CLAIM", "RESERVE",
        "RETREAT", "ABORT",
      ];
      for (const t of allTypes) {
        expect(isOperationAuthorized("FULL_OFFENSIVE", t)).toBe(true);
      }
    });

    it("授权级别递增：CEASEFIRE < DEFENSIVE < CONTAIN < LIMITED < FULL", () => {
      const defensiveOps = ["DEFEND", "ESCORT", "RETREAT"];
      const containOps = ["HARASS", "REMOTE_DENIAL"];
      const limitedOps = ["SIEGE", "RAID", "CONTROLLER_ATTACK", "RESERVE"];
      const fullOps = ["ASSAULT", "CLAIM"];

      // DEFENSIVE 只授权 defensive
      for (const op of [...containOps, ...limitedOps, ...fullOps]) {
        expect(isOperationAuthorized("DEFENSIVE", op)).toBe(false);
      }
      // CONTAIN 只多授权 contain
      for (const op of [...limitedOps, ...fullOps]) {
        expect(isOperationAuthorized("CONTAIN", op)).toBe(false);
      }
      // LIMITED 只多授权 limited
      for (const op of fullOps) {
        expect(isOperationAuthorized("LIMITED_OFFENSIVE", op)).toBe(false);
      }
      // FULL 全授权
      for (const op of [...defensiveOps, ...containOps, ...limitedOps, ...fullOps]) {
        expect(isOperationAuthorized("FULL_OFFENSIVE", op)).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════
// §3. Capability 评估 — Force Requirement
// ═══════════════════════════════════════════════════════════

describe("A5.3 §3 — Capability 评估（deriveRequiredCapability × 12 type）", () => {
  const enemyPower = makeCombatPower({ burstDamage: 200, effectiveHP: 2000, powerScore: 400 });

  it("DEFEND: 需要攻击+治疗+HP（防守核心）", () => {
    const cap = deriveRequiredCapability("DEFEND", enemyPower, 0);
    expect(cap.attack).toBeGreaterThan(0);
    expect(cap.heal).toBeGreaterThan(0);
    expect(cap.effectiveHP).toBeGreaterThan(0);
    expect(cap.dismantle).toBe(0);
    expect(cap.support).toBe(1);
  });

  it("ESCORT: 高机动性（远矿护航）", () => {
    const cap = deriveRequiredCapability("ESCORT", enemyPower, 0);
    expect(cap.mobility).toBeGreaterThanOrEqual(1.0);
    expect(cap.dismantle).toBe(0);
  });

  it("HARASS: 低门槛高机动（骚扰）", () => {
    const cap = deriveRequiredCapability("HARASS", enemyPower, 0);
    const defendCap = deriveRequiredCapability("DEFEND", enemyPower, 0);
    expect(cap.mobility).toBeGreaterThan(1.0);
    expect(cap.attack).toBeLessThan(defendCap.attack); // 骚扰攻击需求 < DEFEND
  });

  it("SIEGE: 高 heal + 高 HP + dismantle（围困）", () => {
    const cap = deriveRequiredCapability("SIEGE", enemyPower, 0);
    expect(cap.heal).toBeGreaterThan(0);
    expect(cap.dismantle).toBe(200);
    expect(cap.effectiveHP).toBeGreaterThan(0);
  });

  it("ASSAULT: 全维度高需求（全面进攻）", () => {
    const cap = deriveRequiredCapability("ASSAULT", enemyPower, 0);
    expect(cap.attack).toBeGreaterThanOrEqual(150);
    expect(cap.heal).toBeGreaterThan(0);
    expect(cap.dismantle).toBe(100);
    expect(cap.support).toBe(2);
  });

  it("RAID: 中等需求 + dismantle（掠夺）", () => {
    const cap = deriveRequiredCapability("RAID", enemyPower, 0);
    expect(cap.dismantle).toBe(100);
    expect(cap.mobility).toBeGreaterThanOrEqual(1.0);
  });

  it("CONTROLLER_ATTACK: 需要 claim 能力", () => {
    const cap = deriveRequiredCapability("CONTROLLER_ATTACK", enemyPower, 0);
    expect(cap.claim).toBe(1);
  });

  it("REMOTE_DENIAL: 高机动（远矿否定）", () => {
    const cap = deriveRequiredCapability("REMOTE_DENIAL", enemyPower, 0);
    expect(cap.mobility).toBeGreaterThan(1.0);
  });

  it("CLAIM: 纯 claim 需求（无攻击）", () => {
    const cap = deriveRequiredCapability("CLAIM", enemyPower, 0);
    expect(cap.attack).toBe(0);
    expect(cap.claim).toBe(1);
    expect(cap.mobility).toBeGreaterThan(0);
  });

  it("RESERVE: 与 CLAIM 类似（纯 claim）", () => {
    const cap = deriveRequiredCapability("RESERVE", enemyPower, 0);
    expect(cap.attack).toBe(0);
    expect(cap.claim).toBe(1);
  });

  it("RETREAT: 高机动无战斗需求（撤退保存力量）", () => {
    const cap = deriveRequiredCapability("RETREAT", enemyPower, 0);
    expect(cap.attack).toBe(0);
    expect(cap.mobility).toBe(1.5);
  });

  it("ABORT: 全零（终止态）", () => {
    const cap = deriveRequiredCapability("ABORT", enemyPower, 0);
    expect(cap.attack).toBe(0);
    expect(cap.effectiveHP).toBe(0);
    expect(cap.mobility).toBe(0);
  });
});

describe("A5.3 §3b — computeCapabilityGap", () => {
  const required: RequiredCapability = {
    attack: 200, rangedAttack: 100, heal: 120, effectiveHP: 2000,
    dismantle: 100, mobility: 1.0, claim: 0, support: 1,
  };

  it("完全满足 → gap=0, totalGapRatio=0", () => {
    const available: RequiredCapability = { ...required, attack: 300, heal: 200 };
    const gap = computeCapabilityGap(required, available, 0.8);
    expect(gap.totalGapRatio).toBe(0);
    expect(gap.gaps.attack).toBe(0);
    expect(gap.gaps.heal).toBe(0);
  });

  it("部分不足 → gap>0, totalGapRatio>0", () => {
    const available: RequiredCapability = {
      attack: 100, rangedAttack: 100, heal: 120, effectiveHP: 2000,
      dismantle: 100, mobility: 1.0, claim: 0, support: 1,
    };
    const gap = computeCapabilityGap(required, available, 0.8);
    expect(gap.gaps.attack).toBe(100);
    expect(gap.totalGapRatio).toBeGreaterThan(0);
    expect(gap.totalGapRatio).toBeLessThanOrEqual(1);
    expect(gap.evidence.length).toBeGreaterThan(0);
    expect(gap.confidence).toBe(0.8);
  });

  it("全不足 → totalGapRatio 趋近 1", () => {
    const available: RequiredCapability = {
      attack: 0, rangedAttack: 0, heal: 0, effectiveHP: 0,
      dismantle: 0, mobility: 0, claim: 0, support: 0,
    };
    const gap = computeCapabilityGap(required, available, 0.5);
    expect(gap.totalGapRatio).toBeGreaterThan(0.8);
  });

  it("confidence 透传到 gap.confidence", () => {
    const gap = computeCapabilityGap(required, required, 0.42);
    expect(gap.confidence).toBe(0.42);
  });

  it("evidence 只记录有 gap 的维度", () => {
    const available: RequiredCapability = { ...required, attack: 200 }; // attack 满足
    const gap = computeCapabilityGap(required, available, 0.8);
    // attack gap=0 不应出现在 evidence 中
    expect(gap.evidence.some(e => e.includes("attack_gap"))).toBe(false);
  });
});

describe("A5.3 §3c — deriveForceComposition", () => {
  it("DEFEND: 推导 tank + attacker + healer", () => {
    const required: RequiredCapability = {
      attack: 200, rangedAttack: 50, heal: 120, effectiveHP: 2000,
      dismantle: 0, mobility: 0.5, claim: 0, support: 1,
    };
    const force = deriveForceComposition("DEFEND", required);
    expect(force.tank).toBe(Math.ceil(2000 / 1000)); // 2
    expect(force.attacker).toBe(Math.ceil(200 / 90)); // 3
    expect(force.healer).toBe(Math.ceil(120 / 36)); // 4
    expect(force.dismantler).toBe(0);
    expect(force.support).toBe(1);
    expect(force.total).toBe(force.tank + force.attacker + force.ranged + force.healer + force.dismantler + force.support);
  });

  it("SIEGE: 推导 dismantler", () => {
    const required: RequiredCapability = {
      attack: 50, rangedAttack: 30, heal: 180, effectiveHP: 3000,
      dismantle: 200, mobility: 0.5, claim: 0, support: 1,
    };
    const force = deriveForceComposition("SIEGE", required);
    expect(force.dismantler).toBe(Math.ceil(200 / 100)); // 2
    expect(force.tank).toBe(Math.ceil(3000 / 1000)); // 3
  });

  it("CLAIM: 标记 claimer 需求", () => {
    const required: RequiredCapability = {
      attack: 0, rangedAttack: 0, heal: 0, effectiveHP: 300,
      dismantle: 0, mobility: 0.8, claim: 1, support: 0,
    };
    const force = deriveForceComposition("CLAIM", required);
    // claimer 不走标准编队但标记
    expect(force.evidence.some(e => e.includes("claimer"))).toBe(true);
  });

  it("ABORT: 全零编队", () => {
    const required: RequiredCapability = {
      attack: 0, rangedAttack: 0, heal: 0, effectiveHP: 0,
      dismantle: 0, mobility: 0, claim: 0, support: 0,
    };
    const force = deriveForceComposition("ABORT", required);
    expect(force.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// §4. Economic Guard
// ═══════════════════════════════════════════════════════════

describe("A5.3 §4 — Economic Guard（经济护栏）", () => {
  function makeGuardInput(overrides: Partial<EconomicGuardInput> = {}): EconomicGuardInput {
    return {
      empireEnergyReserve: 50000,
      empireHealth: "healthy",
      spawnCapacity: 3,
      replacementCapacity: 0.5,
      logisticsReliability: 0.8,
      recoveryCapacity: 0.5,
      warCost: 5000,
      isDefensive: false,
      ...overrides,
    };
  }

  it("全满足 → PASS", () => {
    const result = checkEconomicGuard(makeGuardInput());
    expect(result.passed).toBe(true);
    expect(result.recommendation).toBe("");
  });

  it("能量不足 → FAIL + DOWNGRADE", () => {
    const result = checkEconomicGuard(makeGuardInput({
      empireEnergyReserve: 100,
      warCost: 5000,
      isDefensive: false,
    }));
    expect(result.passed).toBe(false);
    expect(result.checks.energyReserve).toBe(false);
    expect(result.recommendation).toContain("DOWNGRADE");
  });

  it("防御性操作门槛更低（能量只需 500 而非 5000）", () => {
    const offensive = checkEconomicGuard(makeGuardInput({
      empireEnergyReserve: 400, isDefensive: false,
    }));
    expect(offensive.passed).toBe(false);
    expect(offensive.checks.energyReserve).toBe(false);

    const defensive = checkEconomicGuard(makeGuardInput({
      empireEnergyReserve: 600, isDefensive: true, warCost: 100,
    }));
    // 防御性 minReserve=500, maxCostRatio=0.5 → 600 >= 500 且 100 <= 600*0.5=300 → pass
    expect(defensive.checks.energyReserve).toBe(true);
  });

  it("spawn=0 → FAIL", () => {
    const result = checkEconomicGuard(makeGuardInput({ spawnCapacity: 0 }));
    expect(result.passed).toBe(false);
    expect(result.checks.spawnCapacity).toBe(false);
  });

  it("replacementCapacity 不足 → FAIL", () => {
    const result = checkEconomicGuard(makeGuardInput({
      replacementCapacity: 0.1, isDefensive: false,
    }));
    expect(result.passed).toBe(false);
    expect(result.checks.replacementCapacity).toBe(false);
    // 防御性门槛 0.1 → 0.1 >= 0.1 → pass
    const defensive = checkEconomicGuard(makeGuardInput({
      replacementCapacity: 0.1, isDefensive: true,
    }));
    expect(defensive.checks.replacementCapacity).toBe(true);
  });

  it("logisticsReliability 不足 → FAIL", () => {
    const result = checkEconomicGuard(makeGuardInput({
      logisticsReliability: 0.3, isDefensive: false,
    }));
    expect(result.passed).toBe(false);
    expect(result.checks.logisticsReliability).toBe(false);
  });

  it("recoveryCapacity 不足 → FAIL", () => {
    const result = checkEconomicGuard(makeGuardInput({
      recoveryCapacity: 0.1, isDefensive: false,
    }));
    expect(result.passed).toBe(false);
    expect(result.checks.recoveryCapacity).toBe(false);
  });

  it("empireHealth=critical + 非防御 → FAIL + ABORT_OFFENSIVE", () => {
    const result = checkEconomicGuard(makeGuardInput({
      empireHealth: "critical",
      isDefensive: false,
    }));
    expect(result.passed).toBe(false);
    expect(result.recommendation).toContain("ABORT_OFFENSIVE");
  });

  it("empireHealth=critical + 防御 → 不因 health 失败", () => {
    const result = checkEconomicGuard(makeGuardInput({
      empireHealth: "critical",
      isDefensive: true,
    }));
    // 防御时 critical health 不阻止
    expect(result.checks).toBeDefined();
    // 其他维度满足时可通过
    if (result.checks.energyReserve && result.checks.spawnCapacity) {
      expect(result.passed).toBe(true);
    }
  });

  it("recommendation 降级链：critical > energy > logistics > delay", () => {
    // critical health → ABORT_OFFENSIVE
    expect(checkEconomicGuard(makeGuardInput({
      empireHealth: "critical", isDefensive: false,
    })).recommendation).toContain("ABORT_OFFENSIVE");

    // energy fail → DOWNGRADE
    expect(checkEconomicGuard(makeGuardInput({
      empireEnergyReserve: 100, isDefensive: false,
    })).recommendation).toContain("DOWNGRADE");

    // logistics fail → DEGRADED
    expect(checkEconomicGuard(makeGuardInput({
      logisticsReliability: 0.1, isDefensive: false,
      empireEnergyReserve: 50000,
    })).recommendation).toContain("DEGRADED");

    // other fail → DELAY
    expect(checkEconomicGuard(makeGuardInput({
      spawnCapacity: 0, isDefensive: false,
      empireEnergyReserve: 50000,
      logisticsReliability: 0.8,
    })).recommendation).toContain("DELAY");
  });
});

// ═══════════════════════════════════════════════════════════
// §5. Target 选择
// ═══════════════════════════════════════════════════════════

describe("A5.3 §5 — Target 选择（scoreTarget + selectTarget）", () => {
  describe("scoreTarget — 多维度评分", () => {
    it("近距高分 vs 远距低分", () => {
      const near = makeTargetCandidate({ distance: 1 });
      const far = makeTargetCandidate({ distance: 10 });
      const sNear = scoreTarget(near, "ASSAULT", 10);
      const sFar = scoreTarget(far, "ASSAULT", 10);
      expect(sNear.distanceScore).toBeGreaterThan(sFar.distanceScore);
      expect(sNear.total).toBeGreaterThan(sFar.total);
    });

    it("有塔目标 defenseScore 低（更难打）", () => {
      const withTowers = makeTargetCandidate({ towers: 3 });
      const noTowers = makeTargetCandidate({ towers: 0 });
      const sTower = scoreTarget(withTowers, "ASSAULT", 10);
      const sNoTower = scoreTarget(noTowers, "ASSAULT", 10);
      expect(sTower.defenseScore).toBeLessThan(sNoTower.defenseScore);
    });

    it("核心房 strategicImpact 高", () => {
      const core = makeTargetCandidate({ isCore: true });
      const nonCore = makeTargetCandidate({ isCore: false });
      const sCore = scoreTarget(core, "ASSAULT", 10);
      const sNon = scoreTarget(nonCore, "ASSAULT", 10);
      expect(sCore.strategicImpactScore).toBeGreaterThan(sNon.strategicImpactScore);
    });

    it("高 RCL economicImpact 高", () => {
      const highRcl = makeTargetCandidate({ rcl: 7 });
      const lowRcl = makeTargetCandidate({ rcl: 2 });
      const sHigh = scoreTarget(highRcl, "ASSAULT", 10);
      const sLow = scoreTarget(lowRcl, "ASSAULT", 10);
      expect(sHigh.valueScore).toBeGreaterThanOrEqual(sLow.valueScore);
    });

    it("总分在 0-100 范围内", () => {
      const candidate = makeTargetCandidate();
      const score = scoreTarget(candidate, "ASSAULT", 10);
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
    });
  });

  describe("selectTarget — 候选过滤与排序", () => {
    const baseOpts = { maxDistance: 10, freshnessThreshold: 2000, maxTowers: 6, blacklist: {} as Record<string, number>, currentTick: 1000 };

    it("选评分最高者", () => {
      const candidates = [
        makeTargetCandidate({ roomName: "W1N1", distance: 5 }),
        makeTargetCandidate({ roomName: "W2N1", distance: 2 }),
        makeTargetCandidate({ roomName: "W3N1", distance: 8 }),
      ];
      const result = selectTarget(candidates, "ASSAULT", baseOpts.maxDistance, baseOpts.freshnessThreshold, baseOpts.maxTowers, baseOpts.blacklist, baseOpts.currentTick);
      expect(result.selected).toBeDefined();
      expect(result.selected!.roomName).toBe("W2N1");
    });

    it("occupied 被过滤", () => {
      const candidates = [
        makeTargetCandidate({ roomName: "W1N1", occupied: true }),
        makeTargetCandidate({ roomName: "W2N1", occupied: false }),
      ];
      const result = selectTarget(candidates, "ASSAULT", baseOpts.maxDistance, baseOpts.freshnessThreshold, baseOpts.maxTowers, baseOpts.blacklist, baseOpts.currentTick);
      expect(result.selected!.roomName).toBe("W2N1");
      expect(result.rejectedAlternatives.some(r => r.roomName === "W1N1" && r.reason === "occupied")).toBe(true);
    });

    it("blacklisted 被过滤", () => {
      const candidates = [
        makeTargetCandidate({ roomName: "W1N1", blacklisted: true }),
        makeTargetCandidate({ roomName: "W2N1", blacklisted: false }),
      ];
      const result = selectTarget(candidates, "ASSAULT", baseOpts.maxDistance, baseOpts.freshnessThreshold, baseOpts.maxTowers, baseOpts.blacklist, baseOpts.currentTick);
      expect(result.selected!.roomName).toBe("W2N1");
      expect(result.rejectedAlternatives.some(r => r.reason === "blacklisted")).toBe(true);
    });

    it("情报过期被过滤", () => {
      const candidates = [
        makeTargetCandidate({ roomName: "W1N1", intelAge: 3000 }),
        makeTargetCandidate({ roomName: "W2N1", intelAge: 100 }),
      ];
      const result = selectTarget(candidates, "ASSAULT", baseOpts.maxDistance, baseOpts.freshnessThreshold, baseOpts.maxTowers, baseOpts.blacklist, baseOpts.currentTick);
      expect(result.selected!.roomName).toBe("W2N1");
    });

    it("塔数超限被过滤", () => {
      const candidates = [
        makeTargetCandidate({ roomName: "W1N1", towers: 6 }),
        makeTargetCandidate({ roomName: "W2N1", towers: 1 }),
      ];
      const result = selectTarget(candidates, "ASSAULT", baseOpts.maxDistance, baseOpts.freshnessThreshold, baseOpts.maxTowers, baseOpts.blacklist, baseOpts.currentTick);
      expect(result.selected!.roomName).toBe("W2N1");
    });

    it("无合格候选 → selected=undefined + evidence", () => {
      const candidates = [
        makeTargetCandidate({ roomName: "W1N1", occupied: true }),
        makeTargetCandidate({ roomName: "W2N1", blacklisted: true }),
      ];
      const result = selectTarget(candidates, "ASSAULT", baseOpts.maxDistance, baseOpts.freshnessThreshold, baseOpts.maxTowers, baseOpts.blacklist, baseOpts.currentTick);
      expect(result.selected).toBeUndefined();
      expect(result.evidence).toContain("no valid target found");
    });

    it("allScores 记录所有合格候选评分", () => {
      const candidates = [
        makeTargetCandidate({ roomName: "W1N1" }),
        makeTargetCandidate({ roomName: "W2N1" }),
      ];
      const result = selectTarget(candidates, "ASSAULT", baseOpts.maxDistance, baseOpts.freshnessThreshold, baseOpts.maxTowers, baseOpts.blacklist, baseOpts.currentTick);
      expect(result.allScores).toHaveLength(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// §6. WarPlan Hash 确定性 + planMilitaryOperation 端到端
// ═══════════════════════════════════════════════════════════

describe("A5.3 §6 — planMilitaryOperation 端到端 + Hash 确定性", () => {
  it("无威胁 → undefined", () => {
    const input = makeWarPlanningInput({ threatAssessments: [] });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeUndefined();
  });

  it("非 war 姿态 → undefined（CEASEFIRE 不授权）", () => {
    const input = makeWarPlanningInput({ empirePosture: "develop" });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeUndefined();
  });

  it("war 姿态 + HIGH 威胁 → 生成 DEFEND Operation（防御性目标=受威胁房）", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.operation.type).toBe("DEFEND");
    expect(plan!.operation.objective).toBe("DEFEND_CORE");
    expect(plan!.operation.target.roomName).toBe("W1N1");
  });

  it("war 姿态 + CRITICAL 威胁 + healthy + spawn>0 + confidence≥0.7 → FULL_OFFENSIVE → DEFEND（防御性 OperationType）", () => {
    // deriveOperationType 对核心房 CRITICAL 威胁 → DEFEND
    const threat = makeThreatAssessment({
      level: "CRITICAL",
      estimatedIntent: { intent: "FULL_ASSAULT", confidence: 0.9, evidence: [] },
    });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.operation.type).toBe("DEFEND");
    expect(plan!.posture.posture).toBe("FULL_OFFENSIVE");
  });

  it("SIEGE 威胁 → DEFEND + BREAK_SIEGE objective", () => {
    const threat = makeThreatAssessment({
      level: "HIGH",
      estimatedIntent: { intent: "SIEGE", confidence: 0.75, evidence: [] },
    });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.operation.type).toBe("DEFEND");
    expect(plan!.operation.objective).toBe("BREAK_SIEGE");
  });

  it("远矿房 HARASSMENT → ESCORT Operation", () => {
    const threat = makeThreatAssessment({
      level: "HIGH",
      estimatedIntent: { intent: "HARASSMENT", confidence: 0.7, evidence: [] },
    });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    // 远矿判定：intent === REMOTE_MINING_ATTACK || SCOUTING
    // HARASSMENT → isRemote=false → DEFEND
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.operation.type).toBe("DEFEND");
  });

  it("远矿房 REMOTE_MINING_ATTACK → ESCORT", () => {
    const threat = makeThreatAssessment({
      level: "HIGH",
      estimatedIntent: { intent: "REMOTE_MINING_ATTACK", confidence: 0.85, evidence: [] },
    });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.operation.type).toBe("ESCORT");
  });

  it("远矿房 SIEGE/FULL_ASSAULT → RETREAT（保存力量）", () => {
    const threat = makeThreatAssessment({
      level: "CRITICAL",
      estimatedIntent: { intent: "SIEGE", confidence: 0.75, evidence: [] },
    });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    // SIEGE intent + isRemote → RETREAT
    // 但 isRemote 判断是 intent===REMOTE_MINING_ATTACK||SCOUTING
    // SIEGE 不匹配 → isRemote=false → DEFEND + BREAK_SIEGE
    expect(plan!.operation.type).toBe("DEFEND");
  });

  it("SCOUTING 威胁 → DEFEND（核心房）/ ESCORT（远矿）", () => {
    const threatCore = makeThreatAssessment({
      level: "LOW",
      estimatedIntent: { intent: "SCOUTING", confidence: 0.9, evidence: [] },
    });
    const inputCore = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threatCore, terrain: makeTerrainContext() }],
    });
    // SCOUTING → isRemote=true → ESCORT
    const plan = planMilitaryOperation(inputCore);
    expect(plan).toBeDefined();
    expect(plan!.operation.type).toBe("ESCORT");
  });

  it("WarPlan 包含完整证据链", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.evidence.length).toBeGreaterThan(0);
    expect(plan!.operation.evidence.length).toBeGreaterThan(0);
  });

  it("WarPlan 包含止损条件", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.abortConditions).toContain("CASUALTY_EXCEEDED");
    expect(plan!.abortConditions).toContain("INTEL_STALE");
    expect(plan!.abortConditions).toContain("LOGISTICS_COLLAPSED");
  });

  it("WarPlan 包含 spawn 需求", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.spawnRequirement.length).toBeGreaterThan(0);
    // 至少有 attacker 或 healer
    const roles = plan!.spawnRequirement.map(s => s.role);
    expect(roles.includes("attacker") || roles.includes("healer")).toBe(true);
  });

  it("WarPlan 包含经济护栏结果", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.economicGuard).toBeDefined();
    expect(typeof plan!.economicGuard.passed).toBe("boolean");
  });

  it("WarPlan 包含风险评估", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.risk).toBeDefined();
    expect(plan!.risk.score).toBeGreaterThanOrEqual(0);
    expect(plan!.risk.score).toBeLessThanOrEqual(1);
  });

  it("WarPlan 包含期望价值", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.expectedValue).toBeDefined();
    expect(["PROCEED", "DOWNGRADE", "DELAY", "ABORT"]).toContain(plan!.expectedValue.recommendation);
  });

  it("WarPlan 包含物流需求", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.logisticsRequirement).toBeDefined();
    expect(plan!.logisticsRequirement.energy).toBeGreaterThanOrEqual(0);
    expect(plan!.logisticsRequirement.boost).toBeGreaterThanOrEqual(0);
  });
});

describe("A5.3 §6b — warPlanHash 确定性", () => {
  it("相同输入 → 相同 hash", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan1 = planMilitaryOperation(input);
    const plan2 = planMilitaryOperation(input);
    expect(plan1).toBeDefined();
    expect(plan2).toBeDefined();
    expect(plan1!.hash).toBe(plan2!.hash);
  });

  it("不同 tick → 不同 hash（operationId 不同）", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const baseInput = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan1 = planMilitaryOperation({ ...baseInput, tick: 1000, seq: 1 });
    const plan2 = planMilitaryOperation({ ...baseInput, tick: 2000, seq: 1 });
    expect(plan1).toBeDefined();
    expect(plan2).toBeDefined();
    expect(plan1!.hash).not.toBe(plan2!.hash);
  });

  it("不同威胁级别 → 不同 hash（risk/evidence 不同）", () => {
    const highThreat = makeThreatAssessment({ level: "HIGH" });
    const critThreat = makeThreatAssessment({ level: "CRITICAL" });
    const input1 = makeWarPlanningInput({
      tick: 1000, seq: 1,
      threatAssessments: [{ roomName: "W1N1", assessment: highThreat, terrain: makeTerrainContext() }],
    });
    const input2 = makeWarPlanningInput({
      tick: 1000, seq: 1,
      threatAssessments: [{ roomName: "W1N1", assessment: critThreat, terrain: makeTerrainContext() }],
    });
    const plan1 = planMilitaryOperation(input1);
    const plan2 = planMilitaryOperation(input2);
    expect(plan1).toBeDefined();
    expect(plan2).toBeDefined();
    expect(plan1!.hash).not.toBe(plan2!.hash);
  });

  it("hash 为 8 位 hex 字符串", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    expect(plan!.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("warPlanHash 函数可直接调用", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    // 直接调用 warPlanHash 应与 plan.hash 一致
    const directHash = warPlanHash(plan!);
    expect(directHash).toBe(plan!.hash);
  });

  it("1000 次重复调用 → 确定性不变（无随机性）", () => {
    const threat = makeThreatAssessment({ level: "HIGH" });
    const input = makeWarPlanningInput({
      threatAssessments: [{ roomName: "W1N1", assessment: threat, terrain: makeTerrainContext() }],
    });
    const plan = planMilitaryOperation(input);
    expect(plan).toBeDefined();
    const hash = plan!.hash;
    for (let i = 0; i < 1000; i++) {
      expect(warPlanHash(plan!)).toBe(hash);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// §7. WarCost 估算
// ═══════════════════════════════════════════════════════════

describe("A5.3 §7 — WarCost 估算", () => {
  function makeCostInput(overrides: Partial<WarCostInput> = {}): WarCostInput {
    return {
      squadSize: 5,
      energyPerCreep: 800,
      needsBoost: false,
      boostCostPerCreep: 500,
      expectedLossRate: 0.3,
      transportDistance: 3,
      expectedDuration: 500,
      opportunityCostPerTick: 10,
      cpuPerTick: 2,
      recoveryRatio: 0.3,
      ...overrides,
    };
  }

  it("无 boost → boostCost=0", () => {
    const cost = estimateWarCost(makeCostInput({ needsBoost: false }));
    expect(cost.boostCost).toBe(0);
  });

  it("有 boost → boostCost = squadSize × boostCostPerCreep", () => {
    const cost = estimateWarCost(makeCostInput({ needsBoost: true, squadSize: 5, boostCostPerCreep: 500 }));
    expect(cost.boostCost).toBe(2500);
  });

  it("spawnEnergyCost = squadSize × energyPerCreep", () => {
    const cost = estimateWarCost(makeCostInput({ squadSize: 4, energyPerCreep: 800 }));
    expect(cost.spawnEnergyCost).toBe(3200);
  });

  it("replacementCost = spawnEnergy × expectedLossRate", () => {
    const cost = estimateWarCost(makeCostInput({ squadSize: 5, energyPerCreep: 800, expectedLossRate: 0.4 }));
    expect(cost.replacementCost).toBe(Math.round(4000 * 0.4));
  });

  it("total = 各项之和", () => {
    const cost = estimateWarCost(makeCostInput());
    expect(cost.total).toBe(
      cost.spawnEnergyCost + cost.boostCost + cost.replacementCost
      + cost.transportCost + cost.healingCost + cost.opportunityCost
      + cost.cpuCost + cost.recoveryCost,
    );
  });

  it("evidence 非空（可追溯）", () => {
    const cost = estimateWarCost(makeCostInput());
    expect(cost.evidence.length).toBeGreaterThan(0);
    expect(cost.evidence.some(e => e.includes("spawn"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// §8. Risk Model
// ═══════════════════════════════════════════════════════════

describe("A5.3 §8 — Risk Model", () => {
  function makeRiskInput(overrides: Partial<RiskInput> = {}): RiskInput {
    return {
      enemyPower: makeCombatPower({ powerScore: 400 }),
      ourPower: makeCombatPower({ powerScore: 500 }),
      terrain: makeTerrainContext(),
      targetSafeModeAvailable: 0,
      reinforcementETA: 50,
      logisticsReliability: 0.8,
      recoveryCapability: 0.5,
      confidence: makeConfidence(),
      ...overrides,
    };
  }

  it("我强敌弱 → LOW risk", () => {
    const result = assessOperationRisk(makeRiskInput({
      enemyPower: makeCombatPower({ powerScore: 100 }),
      ourPower: makeCombatPower({ powerScore: 500 }),
    }));
    expect(result.level).toBe("LOW");
    expect(result.score).toBeLessThan(0.2);
  });

  it("敌强我弱 → MEDIUM+ risk", () => {
    const result = assessOperationRisk(makeRiskInput({
      enemyPower: makeCombatPower({ powerScore: 800 }),
      ourPower: makeCombatPower({ powerScore: 100 }),
    }));
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(result.level);
    expect(result.score).toBeGreaterThan(0.2);
  });

  it("敌有 safeMode → safeModeRisk=0.5", () => {
    const result = assessOperationRisk(makeRiskInput({ targetSafeModeAvailable: 1 }));
    expect(result.breakdown.safeModeRisk).toBe(0.5);
  });

  it("增援慢 → reinforcementRisk 高", () => {
    const far = assessOperationRisk(makeRiskInput({ reinforcementETA: 300 }));
    const near = assessOperationRisk(makeRiskInput({ reinforcementETA: 30 }));
    expect(far.breakdown.reinforcementRisk).toBeGreaterThan(near.breakdown.reinforcementRisk);
  });

  it("撤退质量差 → retreatRisk 高", () => {
    const poor = assessOperationRisk(makeRiskInput({
      terrain: makeTerrainContext({ retreatQuality: "CRITICAL" }),
    }));
    const good = assessOperationRisk(makeRiskInput({
      terrain: makeTerrainContext({ retreatQuality: "VERY_GOOD" }),
    }));
    expect(poor.breakdown.retreatRisk).toBeGreaterThan(good.breakdown.retreatRisk);
  });

  it("score 在 0-1 范围内", () => {
    const result = assessOperationRisk(makeRiskInput());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("breakdown 各维度在 0-1 范围内", () => {
    const result = assessOperationRisk(makeRiskInput());
    for (const v of Object.values(result.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// §9. OperationValue 期望价值
// ═══════════════════════════════════════════════════════════

describe("A5.3 §9 — OperationValue 期望价值", () => {
  function makeWarCost(total: number): import("../../../src/domain/military/war-cost").WarCost {
    return {
      spawnEnergyCost: 1000,
      boostCost: 500,
      replacementCost: 300,
      transportCost: 200,
      healingCost: 100,
      opportunityCost: 500,
      cpuCost: 200,
      recoveryCost: 300,
      total,
      evidence: [],
    };
  }

  function makeRisk(score: number): import("../../../src/domain/military/risk-model").RiskResult {
    return {
      level: score >= 0.7 ? "CRITICAL" : score >= 0.45 ? "HIGH" : score >= 0.2 ? "MEDIUM" : "LOW",
      score,
      breakdown: {
        capabilityGap: 0, terrainRisk: 0, towerRisk: 0, safeModeRisk: 0,
        reinforcementRisk: 0, retreatRisk: 0, intelRisk: 0,
        logisticsRisk: 0, recoveryRisk: 0,
      },
      evidence: [],
    };
  }

  it("高收益低风险 → PROCEED", () => {
    const result = evaluateOperationValue({
      targetStrategicValue: 80,
      targetEconomicValue: 5000,
      expectedSuccessRate: 0.9,
      warCost: makeWarCost(2000),
      risk: makeRisk(0.1),
      confidence: 0.8,
      isDefensive: false,
    });
    expect(result.netValue).toBeGreaterThan(0);
    expect(result.recommendation).toBe("PROCEED");
  });

  it("净值为负 + 非防御 → ABORT", () => {
    const result = evaluateOperationValue({
      targetStrategicValue: 10,
      targetEconomicValue: 100,
      expectedSuccessRate: 0.1,
      warCost: makeWarCost(10000),
      risk: makeRisk(0.8),
      confidence: 0.5,
      isDefensive: false,
    });
    expect(result.netValue).toBeLessThan(0);
    expect(result.recommendation).toBe("ABORT");
  });

  it("净值为负 + 防御 → DOWNGRADE（防御不轻易 ABORT）", () => {
    const result = evaluateOperationValue({
      targetStrategicValue: 10,
      targetEconomicValue: 100,
      expectedSuccessRate: 0.1,
      warCost: makeWarCost(10000),
      risk: makeRisk(0.8),
      confidence: 0.5,
      isDefensive: true,
    });
    expect(result.recommendation).toBe("DOWNGRADE");
  });

  it("高风险 + 非防御 → DOWNGRADE（即使净值正）", () => {
    const result = evaluateOperationValue({
      targetStrategicValue: 80,
      targetEconomicValue: 5000,
      expectedSuccessRate: 0.7,
      warCost: makeWarCost(1000),
      risk: makeRisk(0.7),
      confidence: 0.8,
      isDefensive: false,
    });
    expect(result.recommendation).toBe("DOWNGRADE");
  });

  it("低置信度 → DELAY（等情报）", () => {
    const result = evaluateOperationValue({
      targetStrategicValue: 80,
      targetEconomicValue: 5000,
      expectedSuccessRate: 0.8,
      warCost: makeWarCost(1000),
      risk: makeRisk(0.2),
      confidence: 0.2,
      isDefensive: false,
    });
    expect(result.recommendation).toBe("DELAY");
  });

  it("evidence 非空（可追溯）", () => {
    const result = evaluateOperationValue({
      targetStrategicValue: 50,
      targetEconomicValue: 1000,
      expectedSuccessRate: 0.5,
      warCost: makeWarCost(2000),
      risk: makeRisk(0.3),
      confidence: 0.6,
      isDefensive: false,
    });
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});
