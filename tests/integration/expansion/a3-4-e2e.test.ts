/**
 * A3.4 E2E Tests — Colony Autonomy & Stability 端到端测试。
 *
 * 覆盖完整链路场景（5 个测试用例）：
 *   1. Colony Autonomy 验证 — 从 COMPLETED 到自治
 *   2. Colony Failure Recovery — 经济衰退 → Normal Recovery
 *   3. Expansion Cooldown — 完成后冷却窗口内阻止新扩张
 *   4. Expansion ROI — Before/After 对比验证改善
 *   5. Bootstrap 防重门禁 — normal Colony 不重新 Bootstrap
 *
 * 纯函数 E2E 测试 — 不需要 Game/Memory mock，模拟完整状态流。
 */

import { describe, it, expect } from "vitest";
import {
  evaluateAutonomyAge,
  AUTONOMY_MILESTONES,
} from "../../../src/domain/expansion/autonomy";
import {
  evaluateStabilityScore,
} from "../../../src/domain/expansion/stability-score";
import {
  evaluateColonyFailure,
  getRecoveryAction,
} from "../../../src/domain/expansion/colony-failure";
import {
  evaluateExpansionCooldown,
  DEFAULT_COOLDOWN_CONFIG,
} from "../../../src/domain/expansion/expansion-cooldown";
import {
  evaluateExpansionRoi,
  type EmpireSnapshot,
} from "../../../src/domain/expansion/roi-tracker";
import {
  buildColonyStabilityDashboard,
} from "../../../src/domain/expansion/colony-dashboard";
import {
  evaluateEconomicActivation,
  type EconomicActivationInput,
} from "../../../src/domain/expansion/economic-activation";
import {
  evaluateEmpireIntegration,
  canHandover,
  type EmpireIntegrationInput,
} from "../../../src/domain/expansion/empire-integration";

// ── E2E-001: Colony Autonomy 完整链路 ─────────────────────

describe("A3.4-E2E-001: Colony Autonomy 完整链路", () => {
  it("从 Economic Activation → Autonomy Age → Stability Score → Dashboard", () => {
    // 1. Economic Activation 通过
    const econInput: EconomicActivationInput = {
      energyProduction: 15,
      energyConsumption: 10,
      externalEnergyInflow: 0,
      consecutivePositiveTicks: 500,
      hasHarvester: true,
      hasTransporter: true,
      hasUpgrader: true,
      spawnActive: true,
      tick: 1000,
    };
    const econResult = evaluateEconomicActivation(econInput);
    expect(econResult.activated).toBe(true);
    expect(econResult.selfSustaining).toBe(true);

    // 2. Empire Integration 通过
    const integrationInput: EmpireIntegrationInput = {
      inOwnedRoomsList: true,
      hasSnapshot: true,
      inEconomyStats: true,
      spawnManaged: true,
      defenseCovered: true,
      hasVersionedLayout: true,
      tick: 1000,
    };
    const integrationResult = evaluateEmpireIntegration(integrationInput);
    expect(integrationResult.integrated).toBe(true);
    expect(canHandover(integrationResult, econResult.activated)).toBe(true);

    // 3. Autonomy Age 初始
    const autonomyResult = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 1000,
      consecutivePositiveTicks: 500,
      hadInterruption: false,
    });
    expect(autonomyResult.age).toBe(0);
    expect(autonomyResult.level).toBe("new");

    // 4. 1000 tick 后
    const autonomy1k = evaluateAutonomyAge({
      activatedAtTick: 1000,
      currentTick: 2000,
      consecutivePositiveTicks: 1500,
      hadInterruption: false,
    });
    expect(autonomy1k.reached1k).toBe(true);
    expect(autonomy1k.level).toBe("emerging");

    // 5. Stability Score
    const stabilityResult = evaluateStabilityScore({
      netEnergyFlow: 5,
      consecutivePositiveTicks: 1500,
      externalEnergyInflow: 0,
      currentPopulation: 10,
      targetPopulation: 10,
      spawnAvailable: true,
      spawnStarvationCount: 0,
      estimatedProduction: 15,
      estimatedConsumption: 10,
      recentFailureCount: 0,
      tick: 2000,
    });
    expect(stabilityResult.stable).toBe(true);
    expect(stabilityResult.level).toBe("EXCELLENT");

    // 6. Dashboard 组装
    const dashboard = buildColonyStabilityDashboard({
      tick: 2000,
      roomName: "W1N1",
      rcl: 4,
      colonyState: "normal",
      expansionStatus: "completed",
      bootstrapStatus: "none",
      netEnergyFlow: 5,
      externalInflow: 0,
      production: 15,
      consumption: 10,
      population: 10,
      targetPopulation: 10,
      spawnAvailable: true,
      storageEnergy: 30000,
      autonomyResult: autonomy1k,
      stabilityResult,
    });
    expect(dashboard.autonomyAge).toBe(1000);
    expect(dashboard.stabilityLevel).toBe("EXCELLENT");
    expect(dashboard.failureDetected).toBe(false);
  });
});

// ── E2E-002: Colony Failure Recovery ───────────────────────

describe("A3.4-E2E-002: Colony Failure → Normal Recovery", () => {
  it("Energy Deficit 检测 → 不允许 Re-bootstrap → 推荐 Normal Recovery", () => {
    // Colony 进入经济衰退
    const failureResult = evaluateColonyFailure({
      netEnergyFlow: -15,
      consecutiveNegativeTicks: 250,
      storageEnergy: 500,
      storageRatio: 0.02,
      currentPopulation: 3,
      targetPopulation: 10,
      understaffedTicks: 600,
      hasSpawn: true,
      spawnStarvationCount: 12,
      hasLogisticsCreep: false,
      logisticsGapTicks: 350,
      blockedCriticalSites: 0,
      constructionStallTicks: 0,
      tick: 5000,
      colonyCompleted: true,
    });

    // 检测到失败
    expect(failureResult.detected).toBe(true);
    expect(failureResult.failureTypes).toContain("energy_deficit");
    expect(failureResult.failureTypes).toContain("population_collapse");
    expect(failureResult.failureTypes).toContain("spawn_starvation");
    expect(failureResult.failureTypes).toContain("logistics_failure");

    // 不允许 Re-bootstrap
    expect(failureResult.allowRebootstrap).toBe(false);

    // 推荐 Normal Recovery
    expect(failureResult.recommendedAction).toContain("demand_adjustment");
    expect(failureResult.recommendedAction).toContain("logistics_supply");

    // 恢复动作验证
    const action = getRecoveryAction("energy_deficit");
    expect(action).toContain("demand_adjustment");
  });
});

// ── E2E-003: Expansion Cooldown ────────────────────────────

describe("A3.4-E2E-003: Expansion Cooldown 完整链路", () => {
  it("完成后冷却窗口内阻止新扩张，窗口过后允许", () => {
    // 1. 扩张在 tick=5000 完成
    const completedTick = 5000;

    // 2. tick=8000 在冷却窗口内
    const blocked = evaluateExpansionCooldown({
      lastCompletedTick: completedTick,
      activeExpansionCount: 0,
      currentTick: 8000,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedReason).toBe("cooldown");
    expect(blocked.remainingCooldown).toBe(7000);

    // 3. tick=15001 冷却已过
    const allowed = evaluateExpansionCooldown({
      lastCompletedTick: completedTick,
      activeExpansionCount: 0,
      currentTick: 15001,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.blockedReason).toBeNull();

    // 4. 即便冷却已过，如果有活跃扩张也不允许
    const blockedByRate = evaluateExpansionCooldown({
      lastCompletedTick: completedTick,
      activeExpansionCount: 1,
      currentTick: 20000,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(blockedByRate.allowed).toBe(false);
    expect(blockedByRate.blockedReason).toBe("rate_limit");
  });
});

// ── E2E-004: Expansion ROI ────────────────────────────────

describe("A3.4-E2E-004: Expansion ROI Before/After 对比", () => {
  it("扩张后帝国产能和净流显著改善", () => {
    // Before: 1 个房
    const before: EmpireSnapshot = {
      tick: 1000,
      totalEnergy: 50000,
      totalProduction: 10,
      totalNetFlow: 2,
      totalReserve: 50000,
      spawnCapacity: 300,
      totalPopulation: 5,
      roomCount: 1,
      economicHealth: "comfortable",
    };

    // After: 2 个房
    const after: EmpireSnapshot = {
      tick: 15000,
      totalEnergy: 80000,
      totalProduction: 25,
      totalNetFlow: 8,
      totalReserve: 80000,
      spawnCapacity: 650,
      totalPopulation: 12,
      roomCount: 2,
      economicHealth: "abundant",
    };

    const roiResult = evaluateExpansionRoi({
      planId: "W1N2@1000",
      roomName: "W1N2",
      before,
      after,
    });

    expect(roiResult.productionGain).toBe(15);
    expect(roiResult.netFlowChange).toBe(6);
    expect(roiResult.reserveGain).toBe(30000);
    expect(roiResult.populationGain).toBe(7);
    expect(roiResult.improved).toBe(true);
  });

  it("扩张后帝国未改善（新 Colony 拖累）", () => {
    const before: EmpireSnapshot = {
      tick: 1000,
      totalEnergy: 80000,
      totalProduction: 20,
      totalNetFlow: 10,
      totalReserve: 80000,
      spawnCapacity: 650,
      totalPopulation: 10,
      roomCount: 2,
      economicHealth: "abundant",
    };

    const after: EmpireSnapshot = {
      tick: 15000,
      totalEnergy: 40000,
      totalProduction: 15,
      totalNetFlow: -5,
      totalReserve: 40000,
      spawnCapacity: 650,
      totalPopulation: 8,
      roomCount: 3,
      economicHealth: "constrained",
    };

    const roiResult = evaluateExpansionRoi({
      planId: "W1N3@1000",
      roomName: "W1N3",
      before,
      after,
    });

    expect(roiResult.productionGain).toBe(-5);
    expect(roiResult.netFlowChange).toBe(-15);
    expect(roiResult.improved).toBe(false);
  });
});

// ── E2E-005: Bootstrap 防重门禁 ───────────────────────────

describe("A3.4-E2E-005: Bootstrap 防重门禁逻辑验证", () => {
  it("colonyState=normal 的房不进入 Bootstrap 逻辑验证", () => {
    // 模拟 Bootstrap Lane 的防重门禁逻辑：
    // 1. 房间有 spawn → 已建成，跳过 Bootstrap
    // 2. 房间无 spawn + colonyState=normal → 不进入 Bootstrap
    // 3. 房间无 spawn + colonyState≠normal → 进入 Bootstrap

    // 这里验证纯函数级别的逻辑：
    // colonyState="normal" 的房间不应该被 Colony Failure 检测标记为需要 rebootstrap
    const failureResult = evaluateColonyFailure({
      netEnergyFlow: -10,
      consecutiveNegativeTicks: 300,
      storageEnergy: 0,
      storageRatio: 0,
      currentPopulation: 0,
      targetPopulation: 5,
      understaffedTicks: 500,
      hasSpawn: false,
      spawnStarvationCount: 20,
      hasLogisticsCreep: false,
      logisticsGapTicks: 500,
      blockedCriticalSites: 3,
      constructionStallTicks: 1500,
      tick: 10000,
      colonyCompleted: true,
    });

    // 即便是严重的失败，也不允许 rebootstrap
    expect(failureResult.detected).toBe(true);
    expect(failureResult.allowRebootstrap).toBe(false);
    expect(failureResult.severity).toBeGreaterThanOrEqual(0.5);

    // 恢复动作应该是 Normal Recovery 路径（不是 rebootstrap）
    expect(failureResult.recommendedAction).not.toBe("none");
    expect(failureResult.recommendedAction).toContain("demand_adjustment");
  });
});
