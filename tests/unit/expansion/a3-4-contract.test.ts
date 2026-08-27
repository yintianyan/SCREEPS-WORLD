/** A3.4 Contract Tests — Colony Autonomy & Stability 合约测试。 */

import { describe, it, expect } from "vitest";
import {
  evaluateAutonomyAge,
  AUTONOMY_MILESTONES,
  type AutonomyAgeInput,
} from "../../../src/domain/expansion/autonomy";
import {
  evaluateStabilityScore,
  type StabilityScoreInput,
} from "../../../src/domain/expansion/stability-score";
import {
  evaluateColonyFailure,
  getRecoveryAction,
  type ColonyFailureInput,
} from "../../../src/domain/expansion/colony-failure";
import {
  evaluateExpansionCooldown,
  DEFAULT_COOLDOWN_CONFIG,
  type CooldownInput,
} from "../../../src/domain/expansion/expansion-cooldown";
import {
  evaluateExpansionRoi,
  type EmpireSnapshot,
} from "../../../src/domain/expansion/roi-tracker";
import {
  buildColonyStabilityDashboard,
} from "../../../src/domain/expansion/colony-dashboard";

// ── 1. Autonomy Age ──────────────────────────────────────────

describe("A3.4-001: Autonomy Age — 基本计算", () => {
  it("刚激活的 Colony 年龄为 0，等级为 new", () => {
    const result = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 1000,
      consecutivePositiveTicks: 0,
      hadInterruption: false,
    });
    expect(result.age).toBe(0);
    expect(result.level).toBe("new");
    expect(result.reached1k).toBe(false);
    expect(result.nextMilestone).toBe(AUTONOMY_MILESTONES.STABLE_1K);
  });

  it("500 tick 后仍是 new，距 1k 里程碑还有 500 tick", () => {
    const result = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 1500,
      consecutivePositiveTicks: 500,
      hadInterruption: false,
    });
    expect(result.age).toBe(500);
    expect(result.level).toBe("new");
    expect(result.ticksToNextMilestone).toBe(500);
  });
});

describe("A3.4-002: Autonomy Age — 里程碑", () => {
  it("1000 tick 后达到 emerging", () => {
    const result = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 2000,
      consecutivePositiveTicks: 1000,
      hadInterruption: false,
    });
    expect(result.reached1k).toBe(true);
    expect(result.level).toBe("emerging");
    expect(result.nextMilestone).toBe(AUTONOMY_MILESTONES.STABLE_5K);
  });

  it("5000 tick 后达到 stable", () => {
    const result = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 6000,
      consecutivePositiveTicks: 5000,
      hadInterruption: false,
    });
    expect(result.reached5k).toBe(true);
    expect(result.level).toBe("stable");
  });

  it("10000 tick 后达到 mature", () => {
    const result = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 11000,
      consecutivePositiveTicks: 10000,
      hadInterruption: false,
    });
    expect(result.reached10k).toBe(true);
    expect(result.level).toBe("mature");
    expect(result.nextMilestone).toBeNull();
  });
});

describe("A3.4-003: Autonomy Age — 中断检测", () => {
  it("有中断时 interrupted=true", () => {
    const result = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 2000,
      consecutivePositiveTicks: 500,
      hadInterruption: true,
    });
    expect(result.interrupted).toBe(true);
  });

  it("无中断时 interrupted=false", () => {
    const result = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 2000,
      consecutivePositiveTicks: 1000,
      hadInterruption: false,
    });
    expect(result.interrupted).toBe(false);
  });
});

// ── 2. Stability Score ───────────────────────────────────────

describe("A3.4-004: Stability Score — Energy 维度", () => {
  it("净流为正 + 连续 500+ + 无外部流入 → Energy 高分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      netEnergyFlow: 10,
      consecutivePositiveTicks: 500,
      externalEnergyInflow: 0,
    });
    const result = evaluateStabilityScore(input);
    const energyDim = result.dimensions.find(d => d.name === "energy")!;
    expect(energyDim.score).toBeGreaterThanOrEqual(80);
    expect(energyDim.passed).toBe(true);
  });

  it("净流为负 → Energy 低分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      netEnergyFlow: -5,
      consecutivePositiveTicks: 0,
      externalEnergyInflow: 100,
    });
    const result = evaluateStabilityScore(input);
    const energyDim = result.dimensions.find(d => d.name === "energy")!;
    expect(energyDim.score).toBeLessThan(40);
    expect(energyDim.passed).toBe(false);
  });
});

describe("A3.4-005: Stability Score — Population 维度", () => {
  it("人口达标 → 高分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      currentPopulation: 10,
      targetPopulation: 10,
    });
    const result = evaluateStabilityScore(input);
    const popDim = result.dimensions.find(d => d.name === "population")!;
    expect(popDim.score).toBe(100);
    expect(popDim.passed).toBe(true);
  });

  it("人口严重不足 → 低分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      currentPopulation: 2,
      targetPopulation: 10,
    });
    const result = evaluateStabilityScore(input);
    const popDim = result.dimensions.find(d => d.name === "population")!;
    expect(popDim.score).toBeLessThanOrEqual(20);
    expect(popDim.passed).toBe(false);
  });
});

describe("A3.4-006: Stability Score — Spawn 维度", () => {
  it("spawn 可用 + 无饥饿 → 满分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      spawnAvailable: true,
      spawnStarvationCount: 0,
    });
    const result = evaluateStabilityScore(input);
    const spawnDim = result.dimensions.find(d => d.name === "spawn")!;
    expect(spawnDim.score).toBe(100);
    expect(spawnDim.passed).toBe(true);
  });

  it("spawn 不可用 → 不通过", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      spawnAvailable: false,
      spawnStarvationCount: 15,
    });
    const result = evaluateStabilityScore(input);
    const spawnDim = result.dimensions.find(d => d.name === "spawn")!;
    expect(spawnDim.passed).toBe(false);
  });
});

describe("A3.4-007: Stability Score — Production 维度", () => {
  it("产能远超消耗 → 满分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      estimatedProduction: 30,
      estimatedConsumption: 15,
    });
    const result = evaluateStabilityScore(input);
    const prodDim = result.dimensions.find(d => d.name === "production")!;
    expect(prodDim.score).toBe(100);
    expect(prodDim.passed).toBe(true);
  });

  it("产能低于消耗 → 不通过", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      estimatedProduction: 5,
      estimatedConsumption: 10,
    });
    const result = evaluateStabilityScore(input);
    const prodDim = result.dimensions.find(d => d.name === "production")!;
    expect(prodDim.passed).toBe(false);
  });
});

describe("A3.4-008: Stability Score — Failure 维度", () => {
  it("无失败 → 满分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      recentFailureCount: 0,
    });
    const result = evaluateStabilityScore(input);
    const failDim = result.dimensions.find(d => d.name === "failures")!;
    expect(failDim.score).toBe(100);
    expect(failDim.passed).toBe(true);
  });

  it("多次失败 → 低分", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      recentFailureCount: 10,
    });
    const result = evaluateStabilityScore(input);
    const failDim = result.dimensions.find(d => d.name === "failures")!;
    expect(failDim.score).toBe(10);
    expect(failDim.passed).toBe(false);
  });
});

describe("A3.4-009: Stability Score — 等级映射", () => {
  it("所有维度满分 → EXCELLENT", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      netEnergyFlow: 20,
      consecutivePositiveTicks: 1000,
      externalEnergyInflow: 0,
      currentPopulation: 10,
      targetPopulation: 10,
      spawnAvailable: true,
      spawnStarvationCount: 0,
      estimatedProduction: 30,
      estimatedConsumption: 10,
      recentFailureCount: 0,
    });
    const result = evaluateStabilityScore(input);
    expect(result.totalScore).toBeGreaterThanOrEqual(85);
    expect(result.level).toBe("EXCELLENT");
    expect(result.stable).toBe(true);
  });

  it("关键维度低分 → CRITICAL", () => {
    const input: StabilityScoreInput = makeStabilityInput({
      netEnergyFlow: -10,
      consecutivePositiveTicks: 0,
      externalEnergyInflow: 200,
      currentPopulation: 1,
      targetPopulation: 10,
      spawnAvailable: false,
      spawnStarvationCount: 20,
      estimatedProduction: 2,
      estimatedConsumption: 10,
      recentFailureCount: 10,
    });
    const result = evaluateStabilityScore(input);
    expect(result.totalScore).toBeLessThan(40);
    expect(result.level).toBe("CRITICAL");
    expect(result.stable).toBe(false);
  });
});

// ── 3. Colony Failure Detection ─────────────────────────────

describe("A3.4-010: Colony Failure — Energy Deficit", () => {
  it("连续负流 + storage 低 → energy_deficit", () => {
    const input: ColonyFailureInput = makeFailureInput({
      netEnergyFlow: -10,
      consecutiveNegativeTicks: 300,
      storageEnergy: 1000,
      storageRatio: 0.05,
    });
    const result = evaluateColonyFailure(input);
    expect(result.detected).toBe(true);
    expect(result.failureTypes).toContain("energy_deficit");
    expect(result.severity).toBeGreaterThanOrEqual(0.8);
  });

  it("短暂负流 + storage 充足 → 不检测", () => {
    const input: ColonyFailureInput = makeFailureInput({
      netEnergyFlow: -5,
      consecutiveNegativeTicks: 10,
      storageEnergy: 50000,
      storageRatio: 0.8,
    });
    const result = evaluateColonyFailure(input);
    expect(result.detected).toBe(false);
  });
});

describe("A3.4-011: Colony Failure — Population Collapse", () => {
  it("人口严重不足 + 持续 → population_collapse", () => {
    const input: ColonyFailureInput = makeFailureInput({
      currentPopulation: 1,
      targetPopulation: 10,
      understaffedTicks: 600,
    });
    const result = evaluateColonyFailure(input);
    expect(result.detected).toBe(true);
    expect(result.failureTypes).toContain("population_collapse");
  });

  it("人口暂时不足 → 不检测", () => {
    const input: ColonyFailureInput = makeFailureInput({
      currentPopulation: 6,
      targetPopulation: 10,
      understaffedTicks: 50,
    });
    const result = evaluateColonyFailure(input);
    expect(result.failureTypes).not.toContain("population_collapse");
  });
});

describe("A3.4-012: Colony Failure — Spawn Starvation", () => {
  it("spawn 饥饿超阈值 → spawn_starvation", () => {
    const input: ColonyFailureInput = makeFailureInput({
      hasSpawn: true,
      spawnStarvationCount: 15,
    });
    const result = evaluateColonyFailure(input);
    expect(result.failureTypes).toContain("spawn_starvation");
  });

  it("无 spawn 时不检测 spawn_starvation", () => {
    const input: ColonyFailureInput = makeFailureInput({
      hasSpawn: false,
      spawnStarvationCount: 100,
    });
    const result = evaluateColonyFailure(input);
    expect(result.failureTypes).not.toContain("spawn_starvation");
  });
});

describe("A3.4-013: Colony Failure — Logistics Failure", () => {
  it("无物流 creep + 持续 → logistics_failure", () => {
    const input: ColonyFailureInput = makeFailureInput({
      hasLogisticsCreep: false,
      logisticsGapTicks: 400,
    });
    const result = evaluateColonyFailure(input);
    expect(result.failureTypes).toContain("logistics_failure");
  });

  it("有物流 creep → 不检测", () => {
    const input: ColonyFailureInput = makeFailureInput({
      hasLogisticsCreep: true,
      logisticsGapTicks: 0,
    });
    const result = evaluateColonyFailure(input);
    expect(result.failureTypes).not.toContain("logistics_failure");
  });
});

describe("A3.4-014: Colony Failure — Re-bootstrap 禁止", () => {
  it("所有失败类型都不允许 rebootstrap", () => {
    const input: ColonyFailureInput = makeFailureInput({
      netEnergyFlow: -10,
      consecutiveNegativeTicks: 300,
      storageEnergy: 0,
      storageRatio: 0,
      currentPopulation: 0,
      targetPopulation: 10,
      understaffedTicks: 600,
      hasSpawn: true,
      spawnStarvationCount: 15,
      hasLogisticsCreep: false,
      logisticsGapTicks: 400,
      blockedCriticalSites: 5,
      constructionStallTicks: 1200,
    });
    const result = evaluateColonyFailure(input);
    expect(result.detected).toBe(true);
    expect(result.failureTypes.length).toBeGreaterThanOrEqual(3);
    expect(result.allowRebootstrap).toBe(false);
  });
});

describe("A3.4-015: Colony Failure — Recovery Action", () => {
  it("energy_deficit 推荐 demand_adjustment", () => {
    const action = getRecoveryAction("energy_deficit");
    expect(action).toContain("demand_adjustment");
  });

  it("population_collapse 推荐 spawn_adjustment", () => {
    const action = getRecoveryAction("population_collapse");
    expect(action).toContain("spawn_adjustment");
  });

  it("logistics_failure 推荐 logistics_creep_replacement", () => {
    const action = getRecoveryAction("logistics_failure");
    expect(action).toContain("logistics_creep_replacement");
  });
});

// ── 4. Expansion Cooldown & Rate Limit ──────────────────────

describe("A3.4-016: Cooldown — 冷却窗口内阻止", () => {
  it("刚完成不允新扩张", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: 5000,
      activeExpansionCount: 0,
      currentTick: 8000,
      config: { cooldownTicks: 10000, maxConcurrentExpansions: 1 },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("cooldown");
    expect(result.remainingCooldown).toBe(7000);
  });

  it("冷却窗口过后允许", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: 5000,
      activeExpansionCount: 0,
      currentTick: 16000,
      config: { cooldownTicks: 10000, maxConcurrentExpansions: 1 },
    });
    expect(result.allowed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });
});

describe("A3.4-017: Cooldown — Rate Limit", () => {
  it("活跃扩张达上限不允新扩张", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: undefined,
      activeExpansionCount: 1,
      currentTick: 1000,
      config: { cooldownTicks: 10000, maxConcurrentExpansions: 1 },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("rate_limit");
  });

  it("无活跃扩张 + 无完成记录 → 允许", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: undefined,
      activeExpansionCount: 0,
      currentTick: 1000,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("A3.4-018: Cooldown — 默认配置", () => {
  it("默认冷却 10000 tick", () => {
    expect(DEFAULT_COOLDOWN_CONFIG.cooldownTicks).toBe(10000);
  });

  it("默认并发上限 1", () => {
    expect(DEFAULT_COOLDOWN_CONFIG.maxConcurrentExpansions).toBe(1);
  });
});

// ── 5. Expansion ROI Tracker ────────────────────────────────

describe("A3.4-019: ROI — 改善判定", () => {
  it("产能增加 → improved=true", () => {
    const before: EmpireSnapshot = makeSnapshot({ totalProduction: 100, roomCount: 1 });
    const after: EmpireSnapshot = makeSnapshot({ totalProduction: 150, roomCount: 2 });
    const result = evaluateExpansionRoi({
      planId: "test@1",
      roomName: "W1N1",
      before,
      after,
    });
    expect(result.productionGain).toBe(50);
    expect(result.improved).toBe(true);
  });

  it("净流改善 → improved=true", () => {
    const before: EmpireSnapshot = makeSnapshot({ totalNetFlow: -5, roomCount: 1 });
    const after: EmpireSnapshot = makeSnapshot({ totalNetFlow: 10, roomCount: 2 });
    const result = evaluateExpansionRoi({
      planId: "test@1",
      roomName: "W1N1",
      before,
      after,
    });
    expect(result.netFlowChange).toBe(15);
    expect(result.improved).toBe(true);
  });
});

describe("A3.4-020: ROI — 无改善判定", () => {
  it("所有指标下降 → improved=false", () => {
    const before: EmpireSnapshot = makeSnapshot({
      totalProduction: 200, totalNetFlow: 20, totalReserve: 50000, roomCount: 1,
    });
    const after: EmpireSnapshot = makeSnapshot({
      totalProduction: 150, totalNetFlow: -10, totalReserve: 10000, roomCount: 2,
    });
    const result = evaluateExpansionRoi({
      planId: "test@1",
      roomName: "W1N1",
      before,
      after,
    });
    expect(result.productionGain).toBe(-50);
    expect(result.netFlowChange).toBe(-30);
    expect(result.reserveGain).toBe(-40000);
    expect(result.improved).toBe(false);
  });
});

describe("A3.4-021: ROI — 增量计算", () => {
  it("正确计算所有增量", () => {
    const before: EmpireSnapshot = makeSnapshot({
      totalEnergy: 10000, totalProduction: 100, totalNetFlow: 5,
      totalReserve: 5000, spawnCapacity: 300, totalPopulation: 5, roomCount: 1,
    });
    const after: EmpireSnapshot = makeSnapshot({
      totalEnergy: 20000, totalProduction: 200, totalNetFlow: 15,
      totalReserve: 10000, spawnCapacity: 650, totalPopulation: 10, roomCount: 2,
    });
    const result = evaluateExpansionRoi({
      planId: "test@1",
      roomName: "W1N1",
      before,
      after,
    });
    expect(result.energyGain).toBe(10000);
    expect(result.productionGain).toBe(100);
    expect(result.netFlowChange).toBe(10);
    expect(result.reserveGain).toBe(5000);
    expect(result.spawnCapacityGain).toBe(350);
    expect(result.populationGain).toBe(5);
  });
});

// ── 6. Colony Stability Dashboard ────────────────────────────

describe("A3.4-022: Colony Dashboard — 基本组装", () => {
  it("正确组装所有字段", () => {
    const dashboard = buildColonyStabilityDashboard({
      tick: 5000,
      roomName: "W1N1",
      rcl: 4,
      colonyState: "normal",
      expansionStatus: "completed",
      bootstrapStatus: "none",
      netEnergyFlow: 10,
      externalInflow: 0,
      production: 30,
      consumption: 15,
      population: 8,
      targetPopulation: 10,
      spawnAvailable: true,
      storageEnergy: 20000,
    });
    expect(dashboard.tick).toBe(5000);
    expect(dashboard.roomName).toBe("W1N1");
    expect(dashboard.rcl).toBe(4);
    expect(dashboard.colonyState).toBe("normal");
    expect(dashboard.expansionStatus).toBe("completed");
    expect(dashboard.netEnergyFlow).toBe(10);
    expect(dashboard.population).toBe(8);
    expect(dashboard.storageEnergy).toBe(20000);
    expect(dashboard.summary).toContain("W1N1");
  });
});

describe("A3.4-023: Colony Dashboard — 包含 Autonomy + Stability", () => {
  it("传入 autonomy 和 stability 结果正确反映", () => {
    const autonomyResult = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 5000,
      consecutivePositiveTicks: 4000,
      hadInterruption: false,
    });
    const stabilityResult = evaluateStabilityScore(makeStabilityInput({
      netEnergyFlow: 10,
      consecutivePositiveTicks: 4000,
      externalEnergyInflow: 0,
      currentPopulation: 10,
      targetPopulation: 10,
      spawnAvailable: true,
      spawnStarvationCount: 0,
      estimatedProduction: 30,
      estimatedConsumption: 15,
      recentFailureCount: 0,
    }));
    const dashboard = buildColonyStabilityDashboard({
      tick: 5000,
      roomName: "W1N1",
      rcl: 6,
      colonyState: "normal",
      expansionStatus: "completed",
      bootstrapStatus: "none",
      netEnergyFlow: 10,
      externalInflow: 0,
      production: 30,
      consumption: 15,
      population: 10,
      targetPopulation: 10,
      spawnAvailable: true,
      storageEnergy: 50000,
      autonomyResult,
      stabilityResult,
    });
    expect(dashboard.autonomyAge).toBe(4000);
    expect(dashboard.autonomyLevel).toBe("emerging");
    expect(dashboard.stabilityScore).toBeGreaterThanOrEqual(85);
    expect(dashboard.stabilityLevel).toBe("EXCELLENT");
  });
});

describe("A3.4-024: Colony Dashboard — 失败检测反映", () => {
  it("failureResult.detected=true 时 dashboard 正确反映", () => {
    const failureResult = evaluateColonyFailure(makeFailureInput({
      netEnergyFlow: -10,
      consecutiveNegativeTicks: 300,
      storageEnergy: 0,
      storageRatio: 0,
    }));
    const dashboard = buildColonyStabilityDashboard({
      tick: 5000,
      roomName: "W1N1",
      rcl: 3,
      colonyState: "bootstrap",
      expansionStatus: "completed",
      bootstrapStatus: "active",
      netEnergyFlow: -10,
      externalInflow: 0,
      production: 5,
      consumption: 15,
      population: 2,
      targetPopulation: 10,
      spawnAvailable: false,
      storageEnergy: 0,
      failureResult,
    });
    expect(dashboard.failureDetected).toBe(true);
    expect(dashboard.failureTypes).toContain("energy_deficit");
  });
});

describe("A3.4-025: Colony Dashboard — 无结果时安全降级", () => {
  it("不传 autonomy/stability/failure 时使用默认值", () => {
    const dashboard = buildColonyStabilityDashboard({
      tick: 100,
      roomName: "W1N1",
      rcl: 1,
      colonyState: "bootstrap",
      expansionStatus: "bootstrapping",
      bootstrapStatus: "active",
      netEnergyFlow: 0,
      externalInflow: 50,
      production: 0,
      consumption: 0,
      population: 0,
      targetPopulation: 0,
      spawnAvailable: false,
      storageEnergy: 0,
    });
    expect(dashboard.autonomyAge).toBe(0);
    expect(dashboard.autonomyLevel).toBe("new");
    expect(dashboard.stabilityScore).toBe(0);
    expect(dashboard.stabilityLevel).toBe("CRITICAL");
    expect(dashboard.failureDetected).toBe(false);
    expect(dashboard.failureTypes).toEqual([]);
  });
});

// ── 辅助函数 ─────────────────────────────────────────────────

function makeStabilityInput(overrides: Partial<StabilityScoreInput>): StabilityScoreInput {
  return {
    netEnergyFlow: 0,
    consecutivePositiveTicks: 0,
    externalEnergyInflow: 0,
    currentPopulation: 5,
    targetPopulation: 5,
    spawnAvailable: true,
    spawnStarvationCount: 0,
    estimatedProduction: 10,
    estimatedConsumption: 10,
    recentFailureCount: 0,
    tick: 1000,
    ...overrides,
  };
}

function makeFailureInput(overrides: Partial<ColonyFailureInput>): ColonyFailureInput {
  return {
    netEnergyFlow: 0,
    consecutiveNegativeTicks: 0,
    storageEnergy: 50000,
    storageRatio: 0.8,
    currentPopulation: 5,
    targetPopulation: 5,
    understaffedTicks: 0,
    spawnStarvationCount: 0,
    hasSpawn: true,
    blockedCriticalSites: 0,
    constructionStallTicks: 0,
    hasLogisticsCreep: true,
    logisticsGapTicks: 0,
    tick: 1000,
    colonyCompleted: true,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<EmpireSnapshot>): EmpireSnapshot {
  return {
    tick: 1000,
    totalEnergy: 10000,
    totalProduction: 100,
    totalNetFlow: 5,
    totalReserve: 5000,
    spawnCapacity: 300,
    totalPopulation: 5,
    roomCount: 1,
    economicHealth: "healthy",
    ...overrides,
  };
}
