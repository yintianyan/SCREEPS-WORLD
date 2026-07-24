/**
 * Tuning Evaluator — 从聚合遥测信号推导参数调整的纯函数。
 *
 * 设计原则（模型7：韧性优先于完美）：
 *   - 保守调整：每次只步进 1，有冷却期防振荡。
 *   - 信号驱动：只在有充分证据时才调整。
 *   - 危机锁定：经济不稳定时完全跳过调优，让静态 CONFIG 应对。
 *   - 纯函数：不访问 Game/Memory，接收所有数据作为参数，可 Vitest 测试。
 *
 * 调优逻辑概览：
 *   hauler.maxCount  ↑ container 持续满 + hauler 已达上限 + 经济健康
 *                    ↓ container 持续空 + hauler > minCount + 经济健康
 *   hauler.minCount  ↑ container 持续半满 + 经济健康
 *                    ↓ container 持续极空 + hauler ≤ minCount
 *   harvester.maxCount ↑ 储备持续下降 + harvester 已达上限 + 经济非危机
 *                      ↓ 储备持续增长 + harvester > minCount + 经济健康
 *   upgrader.maxCount ↑ storage 持续高位 + 经济健康 + upgrader 已达上限
 *                     ↓ storage 低位 OR 经济压力高
 *   builder.maxCount  ↑ buildQueue 持续积压 + 经济健康 + builder 已达上限
 *                     ↓ buildQueue 空 OR 经济压力高
 */

import type {
  TuningSignals,
  TuningAdjustment,
  TuningEvaluation,
} from "./types";
import { TUNING_BOUNDS, clampParam, isInCooldown } from "./bounds";

// ─── 信号阈值常量 ─────────────────────────────────────────────

/** 储备趋势阈值（每采样周期 50 tick 的 delta）。 */
const RESERVE_DRAINING = -50;
const RESERVE_SURPLUS = 100;

/** 经济健康阈值。 */
const PRESSURE_HEALTHY = 0.3;
const PRESSURE_STRESSED = 0.5;

/** 危机比例阈值 — 超过此值跳过所有调优。 */
const CRISIS_RATIO_LOCK = 0.3;

/** Container 填充率阈值。 */
const CONTAINER_HIGH = 0.7;
const CONTAINER_MODERATE = 0.5;
const CONTAINER_LOW = 0.2;
const CONTAINER_VERY_LOW = 0.15;

/** Storage 能量阈值。 */
const STORAGE_SURPLUS = 50000;
const STORAGE_LOW = 10000;

/** Build queue 积压阈值。 */
const BUILD_BACKLOG = 3;

// ─── 主评估函数 ───────────────────────────────────────────────

/**
 * 评估所有可调参数，返回需要执行的调整列表。
 *
 * @param signals        从遥测聚合的信号
 * @param currentBounds  当前生效的角色边界（CONFIG + override 合并后的值）
 * @param lastAdjusted   每个参数上次调整的 tick
 * @param currentTick    当前 tick
 * @returns 评估结果（调整列表 + 诊断信号）
 */
export function evaluateTuning(
  signals: TuningSignals,
  currentBounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  currentTick: number,
): TuningEvaluation {
  const adjustments: TuningAdjustment[] = [];
  const signalRecord = toSignalRecord(signals);

  // ── 全局门禁 ──

  if (signals.tierRank >= 2) {
    return { adjustments, signals: signalRecord, skipped: "cpu_tier_conserve_or_worse" };
  }

  if (signals.crisisRatio > CRISIS_RATIO_LOCK) {
    return { adjustments, signals: signalRecord, skipped: "economy_unstable" };
  }

  if (signals.rcl < 2) {
    return { adjustments, signals: signalRecord, skipped: "rcl_too_low" };
  }

  // ── 逐参数评估 ──

  evaluateHaulerMaxCount(signals, currentBounds, lastAdjusted, currentTick, adjustments);
  evaluateHaulerMinCount(signals, currentBounds, lastAdjusted, currentTick, adjustments);
  evaluateHarvesterMaxCount(signals, currentBounds, lastAdjusted, currentTick, adjustments);
  evaluateUpgraderMaxCount(signals, currentBounds, lastAdjusted, currentTick, adjustments);
  evaluateBuilderMaxCount(signals, currentBounds, lastAdjusted, currentTick, adjustments);

  return { adjustments, signals: signalRecord };
}

// ─── hauler.maxCount ─────────────────────────────────────────

function evaluateHaulerMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  out: TuningAdjustment[],
): void {
  const param = "hauler.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) return;

  const current = bounds.hauler?.maxCount ?? 6;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;

  // ↑ 增加：container 持续满 + hauler 已达上限 + 经济健康
  if (
    s.containerFillRatio > CONTAINER_HIGH &&
    s.haulerCount >= current &&
    economyHealthy &&
    current < boundsDef.ceiling
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current + boundsDef.step),
      reason: `Containers ${(s.containerFillRatio * 100).toFixed(0)}% full, haulers at max ${current}, economy healthy`,
    });
    return;
  }

  // ↓ 减少：container 持续空 + hauler > minCount + 经济健康
  if (
    s.containerFillRatio < CONTAINER_LOW &&
    s.haulerCount > (bounds.hauler?.minCount ?? 2) &&
    economyHealthy &&
    current > boundsDef.floor
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current - boundsDef.step),
      reason: `Containers only ${(s.containerFillRatio * 100).toFixed(0)}% full, haulers likely oversupplied at max ${current}`,
    });
  }
}

// ─── hauler.minCount ─────────────────────────────────────────

function evaluateHaulerMinCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  out: TuningAdjustment[],
): void {
  const param = "hauler.minCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) return;

  const current = bounds.hauler?.minCount ?? 2;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;

  // ↑ 增加：container 持续半满 + 经济健康
  if (
    s.containerFillRatio > CONTAINER_MODERATE &&
    economyHealthy &&
    current < boundsDef.ceiling
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current + boundsDef.step),
      reason: `Containers ${(s.containerFillRatio * 100).toFixed(0)}% full, raising floor to ensure throughput`,
    });
    return;
  }

  // ↓ 减少：container 持续极空 + hauler ≤ minCount
  if (
    s.containerFillRatio < CONTAINER_VERY_LOW &&
    s.haulerCount <= current &&
    current > boundsDef.floor
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current - boundsDef.step),
      reason: `Containers only ${(s.containerFillRatio * 100).toFixed(0)}% full, lowering floor to avoid idle haulers`,
    });
  }
}

// ─── harvester.maxCount ──────────────────────────────────────

function evaluateHarvesterMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  out: TuningAdjustment[],
): void {
  const param = "harvester.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) return;

  const current = bounds.harvester?.maxCount ?? 4;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
  const economyNotCrisis = s.avgPressure < PRESSURE_STRESSED;

  // ↑ 增加：储备持续下降 + harvester 已达上限 + 经济非危机
  if (
    s.avgReserveDelta < RESERVE_DRAINING &&
    s.harvesterCount >= current &&
    economyNotCrisis &&
    current < boundsDef.ceiling
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current + boundsDef.step),
      reason: `Reserve draining (${s.avgReserveDelta.toFixed(0)}/cycle) with harvesters at max ${current}`,
    });
    return;
  }

  // ↓ 减少：储备持续增长 + harvester > minCount + 经济健康
  if (
    s.avgReserveDelta > RESERVE_SURPLUS &&
    s.harvesterCount > (bounds.harvester?.minCount ?? 2) &&
    economyHealthy &&
    current > boundsDef.floor
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current - boundsDef.step),
      reason: `Reserve surplus (+${s.avgReserveDelta.toFixed(0)}/cycle), harvesters oversupplied at max ${current}`,
    });
  }
}

// ─── upgrader.maxCount ───────────────────────────────────────

function evaluateUpgraderMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  out: TuningAdjustment[],
): void {
  const param = "upgrader.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) return;

  const current = bounds.upgrader?.maxCount ?? 3;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
  const economyStressed = s.avgPressure > PRESSURE_STRESSED;

  // ↑ 增加：storage 持续高位 + 经济健康 + upgrader 已达上限
  if (
    s.avgStorageEnergy > STORAGE_SURPLUS &&
    economyHealthy &&
    s.upgraderCount >= current &&
    current < boundsDef.ceiling
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current + boundsDef.step),
      reason: `Storage ${s.avgStorageEnergy.toFixed(0)} energy with upgraders at max ${current}, burning surplus`,
    });
    return;
  }

  // ↓ 减少：storage 低位 OR 经济压力高
  if (
    (s.avgStorageEnergy < STORAGE_LOW || economyStressed) &&
    current > boundsDef.floor
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current - boundsDef.step),
      reason: s.avgStorageEnergy < STORAGE_LOW
        ? `Storage low (${s.avgStorageEnergy.toFixed(0)}), conserving upgrade capacity`
        : `Economy pressure high (${(s.avgPressure * 100).toFixed(0)}%), reducing upgrade capacity`,
    });
  }
}

// ─── builder.maxCount ────────────────────────────────────────

function evaluateBuilderMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  out: TuningAdjustment[],
): void {
  const param = "builder.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) return;

  const current = bounds.builder?.maxCount ?? 4;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
  const economyStressed = s.avgPressure > 0.4;

  // ↑ 增加：buildQueue 持续积压 + 经济健康 + builder 已达上限
  if (
    s.buildQueueBacklog > BUILD_BACKLOG &&
    economyHealthy &&
    s.builderCount >= current &&
    current < boundsDef.ceiling
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current + boundsDef.step),
      reason: `Build backlog ${s.buildQueueBacklog} items with builders at max ${current}`,
    });
    return;
  }

  // ↓ 减少：buildQueue 空 OR 经济压力高
  if (
    (s.buildQueueBacklog === 0 || economyStressed) &&
    current > boundsDef.floor
  ) {
    out.push({
      param,
      oldValue: current,
      newValue: clampParam(param, current - boundsDef.step),
      reason: s.buildQueueBacklog === 0
        ? `No build backlog, reducing builder capacity from ${current}`
        : `Economy pressure high (${(s.avgPressure * 100).toFixed(0)}%), reducing builder capacity`,
    });
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────

/** 将 TuningSignals 转为扁平 Record 供诊断记录。 */
function toSignalRecord(s: TuningSignals): Record<string, number> {
  return {
    avgReserveDelta: Math.round(s.avgReserveDelta),
    avgPressure: Math.round(s.avgPressure * 100) / 100,
    avgDrainScore: Math.round(s.avgDrainScore),
    crisisRatio: Math.round(s.crisisRatio * 100) / 100,
    avgStorageEnergy: Math.round(s.avgStorageEnergy),
    containerFillRatio: Math.round(s.containerFillRatio * 100) / 100,
    haulerCount: s.haulerCount,
    harvesterCount: s.harvesterCount,
    upgraderCount: s.upgraderCount,
    builderCount: s.builderCount,
    buildQueueBacklog: s.buildQueueBacklog,
    tierRank: s.tierRank,
    rcl: s.rcl,
  };
}
