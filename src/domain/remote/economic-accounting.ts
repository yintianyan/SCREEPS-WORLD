/**
 * Remote Economic Accounting — A4.1 Phase 2：远矿经济核算。
 *
 * 合同锚点：A4.1 Architecture Audit §9.2（Net Value 计算缺失）。
 *
 * 设计意图：
 *   计算远矿运营的完整经济明细，包含：
 *   - Gross Production: 产出总值
 *   - Transport Cost: 运输成本（hauler 燃料 + 路径损耗）
 *   - Infrastructure Cost: 基建成本（container 摊销 + 维修）
 *   - Spawn Cost: 孵化成本（creep body 成本摊销）
 *   - Risk Cost: 风险成本（威胁/损失/防御）
 *   - Net Economic Value: 净经济价值 = Gross - 所有成本
 *
 *   与 remote-value.ts 的区别：
 *   - remote-value 是**评估期**（Opportunity 创建时）的预期净价值
 *   - economic-accounting 是**运营期**（Operation 运行中）的实际净价值
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { ResourceFlowSnapshot } from "./flow-accounting";
import { flowDuration } from "./flow-accounting";

// ─── 经济核算结果 ─────────────────────────────────────────

/**
 * Economic Accounting Result — 远矿经济核算明细。
 */
export interface EconomicAccountingResult {
  /** 关联的 Operation ID。 */
  operationId: string;
  /** 统计周期。 */
  periodStart: number;
  periodEnd: number;

  // ── 收入 ──
  /** 毛产出价值（e/tick）。 */
  grossProduction: number;
  /** 产出总量（能量）。 */
  totalProduced: number;

  // ── 成本 ──
  /** 运输成本（e/tick）。 */
  transportCost: number;
  /** 基建成本（e/tick）。 */
  infrastructureCost: number;
  /** 孵化成本摊销（e/tick）。 */
  spawnCost: number;
  /** 风险成本（e/tick）。 */
  riskCost: number;
  /** 总成本（e/tick）。 */
  totalCost: number;

  // ── 净价值 ──
  /** 净经济价值（e/tick）= grossProduction - totalCost。 */
  netValue: number;
  /** 是否盈利（netValue > 0）。 */
  profitable: boolean;
}

// ─── 成本计算 ──────────────────────────────────────────

/**
 * 经济核算参数。
 */
export interface EconomicAccountingConfig {
  // ── 运输成本 ──
  /** hauler body 的 CARRY 部件数（影响运力）。 */
  haulerCarryParts: number;
  /** hauler body 的 MOVE 部件数（影响速度和燃料）。 */
  haulerMoveParts: number;
  /** 路径成本（plain=1, road=0.5, swamp=5）。 */
  pathCost: number;

  // ── 基建成本 ──
  /** container 摊销（e/tick，container 建造成本 / 预期寿命）。 */
  containerAmortization: number;
  /** container 维修频率系数（hits 损失速率 × 维修成本）。 */
  containerRepairRate: number;

  // ── 孵化成本 ──
  /** harvester body 总成本（能量）。 */
  harvesterBodyCost: number;
  /** hauler body 总成本（能量）。 */
  haulerBodyCost: number;
  /** reserver body 总成本（能量）。 */
  reserverBodyCost: number;
  /** harvester 预期寿命（tick）。 */
  harvesterLifespan: number;
  /** hauler 预期寿命（tick）。 */
  haulerLifespan: number;
  /** reserver 预期寿命（tick）。 */
  reserverLifespan: number;
  /** 当前 harvester 数量。 */
  harvesterCount: number;
  /** 当前 hauler 数量。 */
  haulerCount: number;
  /** 当前 reserver 数量。 */
  reserverCount: number;

  // ── 风险成本 ──
  /** 威胁等级（0=安全..3=高危）。 */
  threatLevel: number;
  /** 损失量（能量）。 */
  lostAmount: number;
  /** defender 成本（如果有，e/tick，0 表示无）。 */
  defenderCost: number;
}

/**
 * 计算运输成本（e/tick）。
 *
 * hauler 单趟燃料 = pathCost × (body 距离成本因子)。
 * 每趟运力 = haulerCarryParts × 50。
 * 往返时间 ≈ pathCost × 2 / speed。
 * 所需 hauler 数 = 产出 / (运力 / 往返时间)。
 *
 * 简化：transportCost = (pathCost × haulerFuelPerTile × 2) × haulerCount / duration
 *
 * 纯函数。
 */
export function computeTransportCost(
  flow: ResourceFlowSnapshot,
  config: EconomicAccountingConfig,
): number {
  const duration = flowDuration(flow);
  if (duration <= 0) return 0;

  // hauler 每趟燃料成本 = body fatigues per tile × pathCost × 2（往返）
  // MOVE 部件足够时 fatigue = 1/tile（有路），2/tile（plain），10/tile（swamp）
  // 简化：每趟燃料 ≈ pathCost × 2（往返）× 0.1 (每 tile 消耗 0.1 能量上限)
  const fuelPerTrip = config.pathCost * 2 * 0.1;
  const totalFuel = fuelPerTrip * config.haulerCount;
  return totalFuel / duration;
}

/**
 * 计算基建成本（e/tick）。
 * = container 摊销 + 维修成本
 * 纯函数。
 */
export function computeInfrastructureCost(
  config: EconomicAccountingConfig,
): number {
  return config.containerAmortization + config.containerRepairRate;
}

/**
 * 计算孵化成本摊销（e/tick）。
 * = Σ(creep body cost / lifespan × count)
 * 纯函数。
 */
export function computeSpawnCost(
  config: EconomicAccountingConfig,
): number {
  const harvesterAmort = config.harvesterCount > 0
    ? (config.harvesterBodyCost / config.harvesterLifespan) * config.harvesterCount
    : 0;
  const haulerAmort = config.haulerCount > 0
    ? (config.haulerBodyCost / config.haulerLifespan) * config.haulerCount
    : 0;
  const reserverAmort = config.reserverCount > 0
    ? (config.reserverBodyCost / config.reserverLifespan) * config.reserverCount
    : 0;
  return harvesterAmort + haulerAmort + reserverAmort;
}

/**
 * 计算风险成本（e/tick）。
 * = 威胁等级系数 + 损失量 + defender 成本
 * 纯函数。
 */
export function computeRiskCost(
  flow: ResourceFlowSnapshot,
  config: EconomicAccountingConfig,
): number {
  const duration = flowDuration(flow);
  if (duration <= 0) return 0;

  // 威胁等级系数：0=0, 1=0.5, 2=1.5, 3=3.0
  const threatCost = config.threatLevel * 0.5 + (config.threatLevel > 0 ? 0.5 : 0);
  // 损失摊销
  const lossRate = flow.lost / duration;
  // defender 持续成本
  const defenderCost = config.defenderCost;

  return threatCost + lossRate + defenderCost;
}

// ─── 综合核算 ──────────────────────────────────────────

/**
 * 执行完整经济核算。
 *
 * netValue = grossProduction - transportCost - infrastructureCost - spawnCost - riskCost
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function calculateEconomicAccounting(
  flow: ResourceFlowSnapshot,
  config: EconomicAccountingConfig,
): EconomicAccountingResult {
  const duration = flowDuration(flow);

  const grossProduction = duration > 0 ? flow.produced / duration : 0;
  const transportCost = computeTransportCost(flow, config);
  const infrastructureCost = computeInfrastructureCost(config);
  const spawnCost = computeSpawnCost(config);
  const riskCost = computeRiskCost(flow, config);

  const totalCost = transportCost + infrastructureCost + spawnCost + riskCost;
  const netValue = grossProduction - totalCost;

  return {
    operationId: flow.operationId,
    periodStart: flow.periodStart,
    periodEnd: flow.periodEnd,
    grossProduction,
    totalProduced: flow.produced,
    transportCost,
    infrastructureCost,
    spawnCost,
    riskCost,
    totalCost,
    netValue,
    profitable: netValue > 0,
  };
}

// ─── 查询 ──────────────────────────────────────────────

/**
 * 判定经济核算结果是否盈利。
 * 纯函数。
 */
export function isProfitable(result: EconomicAccountingResult): boolean {
  return result.profitable;
}

/**
 * 判定经济核算结果是否净价值低于阈值。
 * 纯函数。
 */
export function isBelowThreshold(
  result: EconomicAccountingResult,
  threshold: number,
): boolean {
  return result.netValue < threshold;
}

/**
 * 获取成本占比明细（各成本项 / 总成本）。
 * 纯函数。
 */
export function costBreakdown(result: EconomicAccountingResult): {
  transport: number;
  infrastructure: number;
  spawn: number;
  risk: number;
} {
  if (result.totalCost <= 0) {
    return { transport: 0, infrastructure: 0, spawn: 0, risk: 0 };
  }
  return {
    transport: result.transportCost / result.totalCost,
    infrastructure: result.infrastructureCost / result.totalCost,
    spawn: result.spawnCost / result.totalCost,
    risk: result.riskCost / result.totalCost,
  };
}
