/** A3.4 E2E Tests — Colony Autonomy & Stability 端到端测试。 */

import { describe, it, expect } from "vitest";
import {
  evaluateColonyFailure,
  getRecoveryAction,
} from "../../../src/domain/expansion/colony-failure";
import {
  evaluateExpansionCooldown,
  DEFAULT_COOLDOWN_CONFIG,
} from "../../../src/domain/expansion/expansion-cooldown";

// ── E2E-001: Colony Autonomy 完整链路 ─────────────────────

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
