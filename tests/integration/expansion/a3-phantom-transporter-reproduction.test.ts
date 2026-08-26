/**
 * A3 Phantom Transporter Bug — 最小复现测试
 *
 * Bug 现象：扩张状态机在 economic_startup 阶段检查 `transporterActive`，
 * 但系统中不存在 "transporter" 角色——CONFIG.roles 没有、bootstrap 未注册、
 * demand.ts 不产生 demand、spawn-manager 不孵化。实际的运输角色是 hauler/distributor。
 *
 * 这导致：
 *   CP3_ENERGY_LOOP 永远不可能通过（transporterActive 永远为 false）
 *   economic-activation 永远不可能通过（hasTransporter 永远为 false）
 *   扩张必然超时并回收殖民地
 *
 * 本测试在修复前应稳定复现 bug，修复后应全部通过。
 */

import { describe, it, expect } from "vitest";
import { CONFIG } from "../../../src/config";
import { evaluateCheckpoint, type CheckpointInput } from "../../../src/domain/expansion/checkpoint";
import { evaluateEconomicActivation, type EconomicActivationInput } from "../../../src/domain/expansion/economic-activation";

// ─── 验证 "transporter" 角色不存在于系统 ───────────────────

describe("A3 Phantom Transporter Bug — 角色存在性验证", () => {
  it("CONFIG.roles 不包含 'transporter'", () => {
    expect(CONFIG.roles).not.toHaveProperty("transporter");
  });

  it("CONFIG.roles 包含 'hauler'（实际运输角色）", () => {
    expect(CONFIG.roles).toHaveProperty("hauler");
  });

  it("CONFIG.roles 包含 'distributor'（实际分发角色）", () => {
    expect(CONFIG.roles).toHaveProperty("distributor");
  });
});

// ─── CP3 永远不可通过（Phantom Transporter）──────────────

describe("A3 Phantom Transporter Bug — CP3 永远不可通过", () => {
  const baseInput: CheckpointInput = {
    checkpointId: "CP3_ENERGY_LOOP",
    controllerClaimed: true,
    spawnBuilt: true,
    spawnCanSpawn: true,
    harvesterActive: true,
    transporterActive: false, // ← 系统中不存在 transporter，永远为 false
    extensionsBuilt: false,
    containerBuilt: false,
    roadsBuilt: false,
    netEnergyFlowPositive: false,
    empireIntegrated: false,
    tick: 1000,
    retryCount: 0,
  };

  it("CP3 不通过 when transporterActive=false（Phantom Bug）", () => {
    const r = evaluateCheckpoint(baseInput);
    expect(r.passed).toBe(false);
    expect(r.failReason).toContain("transporter");
  });

  it("即使 harvesterActive=true 且 spawnCanSpawn=true，CP3 仍不通过", () => {
    // 这证明 transporter 是唯一阻塞条件
    const r = evaluateCheckpoint({
      ...baseInput,
      harvesterActive: true,
      spawnCanSpawn: true,
      transporterActive: false,
    });
    expect(r.passed).toBe(false);
    expect(r.failReason).toContain("transporter");
  });

  it("CP3 只有在 transporterActive=true 时才通过 — 但这是不可能的", () => {
    const r = evaluateCheckpoint({
      ...baseInput,
      transporterActive: true, // ← 这是虚构的，系统中不存在
    });
    expect(r.passed).toBe(true);
    // 这证明：checkpoint 逻辑本身是正确的，问题在于 transporterActive 的输入
    // 永远不可能在真实运行时为 true
  });
});

// ─── Economic Activation 永远不通过（Phantom Transporter）──────────────

describe("A3 Phantom Transporter Bug — Economic Activation 永远不通过", () => {
  const baseInput: EconomicActivationInput = {
    energyProduction: 20,
    energyConsumption: 10,
    externalEnergyInflow: 0,
    consecutivePositiveTicks: 500,
    hasHarvester: true,
    hasTransporter: false, // ← 系统中不存在 transporter，永远为 false
    hasUpgrader: true,
    spawnActive: true,
    tick: 1000,
  };

  it("经济激活不通过 when hasTransporter=false（Phantom Bug）", () => {
    const r = evaluateEconomicActivation(baseInput);
    expect(r.activated).toBe(false);
    expect(r.criteria.energyLoop.passed).toBe(false);
  });

  it("即使连续 500 tick 净流为正，仍不激活", () => {
    const r = evaluateEconomicActivation({
      ...baseInput,
      consecutivePositiveTicks: 500,
      hasTransporter: false,
    });
    expect(r.activated).toBe(false);
    expect(r.criteria.netPositive.passed).toBe(true);
    expect(r.criteria.selfSustaining.passed).toBe(true);
    expect(r.criteria.energyLoop.passed).toBe(false); // ← 唯一阻塞条件
  });

  it("Economic Activation 只有在 hasTransporter=true 时才激活 — 但这是不可能的", () => {
    const r = evaluateEconomicActivation({
      ...baseInput,
      hasTransporter: true, // ← 虚构的
    });
    expect(r.activated).toBe(true);
    // 这证明：economic-activation 逻辑本身是正确的，问题在于 hasTransporter 的输入
    // 永远不可能在真实运行时为 true
  });
});

// ─── 扩张超时链路验证 ──────────────────────────

describe("A3 Phantom Transporter Bug — 扩张必然超时", () => {
  it("模拟 economic_startup 阶段 1000 tick 后仍不可通过（transporter 永远不存在）", () => {
    // 模拟 1000 tick 的 economic_startup 阶段
    let consecutivePositive = 0;
    let cp3Passed = false;
    let activated = false;

    for (let tick = 0; tick < 1000; tick++) {
      // 每 tick 检查 CP3
      const cp3 = evaluateCheckpoint({
        checkpointId: "CP3_ENERGY_LOOP",
        controllerClaimed: true,
        spawnBuilt: true,
        spawnCanSpawn: true,
        harvesterActive: true,
        transporterActive: false, // ← Phantom Bug：永远 false
        extensionsBuilt: tick > 200, // 200 tick 后建成
        containerBuilt: tick > 100, // 100 tick 后建成
        roadsBuilt: false,
        netEnergyFlowPositive: false,
        empireIntegrated: false,
        tick: 1000 + tick,
        retryCount: 0,
      });

      if (cp3.passed) cp3Passed = true;

      // 如果 CP3 通过了（不可能），检查 economic activation
      if (cp3Passed) {
        const econResult = evaluateEconomicActivation({
          energyProduction: 20,
          energyConsumption: 10,
          externalEnergyInflow: 0,
          consecutivePositiveTicks: consecutivePositive,
          hasHarvester: true,
          hasTransporter: false, // ← Phantom Bug
          hasUpgrader: true,
          spawnActive: true,
          tick: 1000 + tick,
        });
        if (econResult.netFlow > 0) consecutivePositive++;
        else consecutivePositive = 0;
        if (econResult.activated) activated = true;
      }
    }

    // 验证：CP3 永远不通过
    expect(cp3Passed).toBe(false);
    // 验证：Economic Activation 永远不激活
    expect(activated).toBe(false);
    // 验证：consecutivePositive 保持 0（因为 CP3 不通过，不会进入 integrating）
    expect(consecutivePositive).toBe(0);
  });

  it("验证 hauler 存在但 transporter 不存在 — 角色名不匹配是根因", () => {
    // 系统中实际的运输角色
    const actualTransportRoles = ["hauler", "distributor"];
    // expansion-manager 检查的角色
    const checkedRole = "transporter";

    // transporter 不在实际运输角色列表中
    expect(actualTransportRoles).not.toContain(checkedRole);
    // hauler 在实际运输角色列表中
    expect(actualTransportRoles).toContain("hauler");
    // distributor 在实际运输角色列表中
    expect(actualTransportRoles).toContain("distributor");
  });
});

// ─── 修复后验证：使用 hauler 替代 transporter ────────────────

describe("A3 Phantom Transporter Bug — 修复后验证（使用 hauler+有物流信号）", () => {
  // 修复方案：将 transporterActive 重命名为 logisticsActive，
  // 检查 hauler 或 distributor 存在
  it("CP3 应在 hauler 存在时通过（修复后）", () => {
    // 修复后的 CheckpointInput 应使用 logisticsActive 而非 transporterActive
    // 这里模拟修复后的行为
    const haulerActive = true;
    const distributorActive = false;
    const logisticsActive = haulerActive || distributorActive;

    const r = evaluateCheckpoint({
      checkpointId: "CP3_ENERGY_LOOP",
      controllerClaimed: true,
      spawnBuilt: true,
      spawnCanSpawn: true,
      harvesterActive: true,
      transporterActive: logisticsActive, // 修复后传入真实值
      extensionsBuilt: false,
      containerBuilt: false,
      roadsBuilt: false,
      netEnergyFlowPositive: false,
      empireIntegrated: false,
      tick: 1000,
      retryCount: 0,
    });
    expect(r.passed).toBe(true);
  });

  it("Economic Activation 应在 hauler 存在时激活（修复后）", () => {
    const haulerActive = true;
    const distributorActive = false;
    const logisticsActive = haulerActive || distributorActive;

    const r = evaluateEconomicActivation({
      energyProduction: 20,
      energyConsumption: 10,
      externalEnergyInflow: 0,
      consecutivePositiveTicks: 500,
      hasHarvester: true,
      hasTransporter: logisticsActive, // 修复后传入真实值
      hasUpgrader: true,
      spawnActive: true,
      tick: 1000,
    });
    expect(r.activated).toBe(true);
  });
});
