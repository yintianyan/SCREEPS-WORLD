/**
 * Economic Guard — A5.3 经济护栏纯函数。
 *
 * 军事行动必须经过 Economic Guard。
 *
 * 至少检查：
 * - energyReserve
 * - spawnCapacity
 * - replacementCapacity
 * - logisticsCapacity
 * - recoveryCapacity
 *
 * 禁止为了一次战争导致帝国经济死亡螺旋。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

export interface EconomicGuardInput {
  /** 帝国能量储备。 */
  empireEnergyReserve: number;
  /** 帝国健康度。 */
  empireHealth: "healthy" | "stable" | "degraded" | "critical";
  /** 可用 spawn 数量。 */
  spawnCapacity: number;
  /** 替换能力（0-1，能多快重建损失的 creep）。 */
  replacementCapacity: number;
  /** 物流可靠性（0-1）。 */
  logisticsReliability: number;
  /** 恢复能力（0-1）。 */
  recoveryCapacity: number;
  /** 战争成本。 */
  warCost: number;
  /** 是否是防御性 Operation（防御成本更低门槛）。 */
  isDefensive: boolean;
}

export interface EconomicGuardResult {
  /** 是否通过经济护栏。 */
  passed: boolean;
  /** 原因。 */
  reasons: string[];
  /** 各维度检查结果。 */
  checks: {
    energyReserve: boolean;
    spawnCapacity: boolean;
    replacementCapacity: boolean;
    logisticsReliability: boolean;
    recoveryCapacity: boolean;
  };
  /** 建议降级（如果不通过）。 */
  recommendation: string;
}

// ═══════════════════════════════════════════════════════════
// §2. 检查纯函数
// ═══════════════════════════════════════════════════════════

/**
 * 经济护栏检查。
 *
 * 防御性 Operation 门槛更低（保命优先于经济）。
 * 进攻性 Operation 门槛更高（不能为进攻拖垮经济）。
 */
export function checkEconomicGuard(input: EconomicGuardInput): EconomicGuardResult {
  const reasons: string[] = [];

  // 防御性 Operation 的成本比例门槛更高（允许花更多保命）
  const maxCostRatio = input.isDefensive ? 0.5 : 0.2;
  const minReserve = input.isDefensive ? 500 : 5000;

  // 1. Energy Reserve — 能量储备是否足够
  const energyOk = input.empireEnergyReserve >= minReserve
    && input.warCost <= input.empireEnergyReserve * maxCostRatio;
  if (!energyOk) {
    reasons.push(`energy: reserve=${input.empireEnergyReserve} < ${minReserve} or cost=${input.warCost} > ${input.empireEnergyReserve * maxCostRatio}`);
  }

  // 2. Spawn Capacity — 有空闲 spawn
  const spawnOk = input.spawnCapacity > 0;
  if (!spawnOk) reasons.push("spawn: no available spawn");

  // 3. Replacement Capacity — 能重建损失
  const replacementThreshold = input.isDefensive ? 0.1 : 0.3;
  const replacementOk = input.replacementCapacity >= replacementThreshold;
  if (!replacementOk) reasons.push(`replacement: ${input.replacementCapacity} < ${replacementThreshold}`);

  // 4. Logistics Reliability — 物流能支撑
  const logisticsThreshold = input.isDefensive ? 0.2 : 0.5;
  const logisticsOk = input.logisticsReliability >= logisticsThreshold;
  if (!logisticsOk) reasons.push(`logistics: ${input.logisticsReliability} < ${logisticsThreshold}`);

  // 5. Recovery Capacity — 能恢复
  const recoveryThreshold = input.isDefensive ? 0.05 : 0.2;
  const recoveryOk = input.recoveryCapacity >= recoveryThreshold;
  if (!recoveryOk) reasons.push(`recovery: ${input.recoveryCapacity} < ${recoveryThreshold}`);

  // Empire Health CRITICAL 时只允许防御
  if (input.empireHealth === "critical" && !input.isDefensive) {
    reasons.push("empireHealth=critical → 禁止非防御性军事行动");
  }

  const allPassed = energyOk && spawnOk && replacementOk && logisticsOk && recoveryOk
    && (input.empireHealth !== "critical" || input.isDefensive);

  let recommendation = "";
  if (!allPassed) {
    if (input.empireHealth === "critical") {
      recommendation = "ABORT_OFFENSIVE — 帝国危急，只允许防御";
    } else if (!energyOk) {
      recommendation = "DOWNGRADE — 降低规模或等待能量恢复";
    } else if (!logisticsOk) {
      recommendation = "DEGRADED — 物流不稳定，降级执行";
    } else {
      recommendation = "DELAY — 等待条件改善";
    }
  }

  return {
    passed: allPassed,
    reasons,
    checks: {
      energyReserve: energyOk,
      spawnCapacity: spawnOk,
      replacementCapacity: replacementOk,
      logisticsReliability: logisticsOk,
      recoveryCapacity: recoveryOk,
    },
    recommendation,
  };
}
