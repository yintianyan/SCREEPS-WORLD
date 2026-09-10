/** 能量边际价值（价格信号）— 供需平衡的价格机制。 */

/**
 * energyPrice（0..1）衡量能量的边际价值：
 * - 趋近 1：净流为正（供 > 需），能量充裕 → 鼓励消费、不鼓励扩编采集
 * - 趋近 0：净流为负（需 > 供），能量紧缺 → 抑制消费、鼓励扩编采集
 * - 0.5 = 收支平衡
 *
 * 核心公式：
 *   price = clamp(0.5 + netFlowNorm × 0.5, 0, 1)
 *   netFlowNorm = clamp(netFlow / (estimatedIncome × sensitivity), -1, 1)
 *
 * 其中 sensitivity=0.3 意味着净流偏离收入 30% 即饱和（价格触 0 或 1）。
 * 使用 EMA 平滑的 netFlow（已有 economy 系统），避免单 tick 脉冲。
 * estimatedIncome=0（无经济核算）时返回中性 0.5。
 */
export function computeEnergyPrice(
  netFlow: number,
  estimatedIncome: number,
  sensitivity = 0.3,
): number {
  if (estimatedIncome <= 0) return 0.5;
  const denom = estimatedIncome * sensitivity;
  const netFlowNorm = Math.max(-1, Math.min(1, netFlow / denom));
  return Math.max(0, Math.min(1, 0.5 + netFlowNorm * 0.5));
}

/**
 * 供给端弹性系数（harvester）：无弹性（恒 1.0）。
 * 供给端是生产基础——不通过价格信号缩放编制。
 * 供需平衡通过压缩消费端（demandElasticity）和保留物流端（logisticsElasticity）
 * 来实现：消费少了、物流保住了，自然有更多能量给采集端。
 * 直接扩编 harvester 会与替换机制叠加导致超编振荡（live-anomaly-reproduction 实证）。
 */
export function supplyElasticity(_price: number): number {
  return 1.0;
}

/**
 * 消费端弹性系数（upgrader/builder）：高弹性。
 * 价格低时大幅收缩（最小 0），价格高时满编（1.0）。
 * 消费端是可自由调节的支出——能量紧缺时优先压缩。
 */
export function demandElasticity(price: number): number {
  if (price <= 0.1) return 0;
  if (price >= 0.5) return 1.0;
  return (price - 0.1) / 0.4;
}

/**
 * 物流端弹性系数（hauler/distributor）：中等弹性。
 * 两端都需要物流——价格极低时仍保留 50% 编制（搬能量回 spawn 是保命路径）。
 */
export function logisticsElasticity(price: number): number {
  if (price <= 0.1) return 0.5;
  if (price >= 0.5) return 1.0;
  return 0.5 + (0.5 * (price - 0.1)) / 0.4;
}
