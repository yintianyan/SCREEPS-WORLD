/** War Cost */

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

export interface WarCost {
  /** 孵化能量成本。 */
  spawnEnergyCost: number;
  /** Boost 矿物成本（能量等价）。 */
  boostCost: number;
  /** 替换成本（损失后重建）。 */
  replacementCost: number;
  /** 运输成本（能量等价）。 */
  transportCost: number;
  /** 治疗成本（能量等价）。 */
  healingCost: number;
  /** 机会成本（因战争放弃的经济产出）。 */
  opportunityCost: number;
  /** CPU 成本（tick × CPU 单价）。 */
  cpuCost: number;
  /** 恢复成本（战后重建）。 */
  recoveryCost: number;
  /** 总成本。 */
  total: number;
  /** 证据。 */
  evidence: string[];
}

export interface WarCostInput {
  /** 编队人数。 */
  squadSize: number;
  /** 每单位孵化能量。 */
  energyPerCreep: number;
  /** 是否需要 boost。 */
  needsBoost: boolean;
  /** Boost 矿物成本（能量等价，每单位）。 */
  boostCostPerCreep: number;
  /** 预计损失率（0-1）。 */
  expectedLossRate: number;
  /** 运输距离（房数）。 */
  transportDistance: number;
  /** 预计持续时间（tick）。 */
  expectedDuration: number;
  /** 机会成本（energy/tick 放弃产出）。 */
  opportunityCostPerTick: number;
  /** CPU 预算（CPU/tick）。 */
  cpuPerTick: number;
  /** 恢复成本比例（战后重建占 spawnEnergy 的比例）。 */
  recoveryRatio: number;
}

// ═══════════════════════════════════════════════════════════
// §2. 估算纯函数
// ═══════════════════════════════════════════════════════════

export function estimateWarCost(input: WarCostInput): WarCost {
  const evidence: string[] = [];

  // 1. Spawn Energy Cost
  const spawnEnergyCost = input.squadSize * input.energyPerCreep;
  evidence.push(`spawn=${input.squadSize}×${input.energyPerCreep}=${spawnEnergyCost}`);

  // 2. Boost Cost
  const boostCost = input.needsBoost
    ? input.squadSize * input.boostCostPerCreep
    : 0;
  if (input.needsBoost) {
    evidence.push(`boost=${input.squadSize}×${input.boostCostPerCreep}=${boostCost}`);
  }

  // 3. Replacement Cost — 预计损失的重建
  const replacementCost = Math.round(spawnEnergyCost * input.expectedLossRate);
  evidence.push(`replacement=spawnEnergy×${input.expectedLossRate.toFixed(2)}=${replacementCost}`);

  // 4. Transport Cost — 距离 × 常数（每房 50 energy/tick 等价）
  const transportCost = input.transportDistance * 50 * Math.max(1, input.expectedDuration / 100);
  evidence.push(`transport=${input.transportDistance}×50×${(input.expectedDuration / 100).toFixed(1)}=${Math.round(transportCost)}`);

  // 5. Healing Cost — 治疗损血所需能量（估计每单位 20% spawnEnergy）
  const healingCost = Math.round(spawnEnergyCost * 0.2 * (1 - input.expectedLossRate));
  evidence.push(`healing=${healingCost}`);

  // 6. Opportunity Cost — 战争期间放弃的产出
  const opportunityCost = input.opportunityCostPerTick * input.expectedDuration;
  evidence.push(`opportunity=${input.opportunityCostPerTick}/tick×${input.expectedDuration}=${Math.round(opportunityCost)}`);

  // 7. CPU Cost — CPU 消耗（每 CPU 100 energy 等价）
  const cpuCost = Math.round(input.cpuPerTick * input.expectedDuration * 100);
  evidence.push(`cpu=${input.cpuPerTick}/tick×${input.expectedDuration}×100=${cpuCost}`);

  // 8. Recovery Cost — 战后恢复
  const recoveryCost = Math.round(spawnEnergyCost * input.recoveryRatio);
  evidence.push(`recovery=spawnEnergy×${input.recoveryRatio}=${recoveryCost}`);

  const total = spawnEnergyCost + boostCost + replacementCost + transportCost
    + healingCost + Math.round(opportunityCost) + cpuCost + recoveryCost;

  return {
    spawnEnergyCost,
    boostCost,
    replacementCost,
    transportCost: Math.round(transportCost),
    healingCost,
    opportunityCost: Math.round(opportunityCost),
    cpuCost,
    recoveryCost,
    total,
    evidence,
  };
}
