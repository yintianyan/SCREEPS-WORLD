/**
 * Tuning Evaluator — 从聚合遥测信号推导参数调整的纯函数。
 *
 * 设计原则（模型7：韧性优先于完美）：
 *   - 保守调整：每次只步进 1，有冷却期防振荡。
 *   - 趋势确认（P1-1）：连续 2 次评估窗口显示同方向信号才调整，防止单次噪声驱动决策。
 *   - 信号驱动：只在有充分证据时才调整。
 *   - 危机锁定：经济不稳定时完全跳过调优，让静态 CONFIG 应对。
 *   - 纯函数：不访问 Game/Memory，接收所有数据作为参数，可 Vitest 测试。
 *
 * 调优逻辑概览：
 *   hauler.maxCount  ↑ container 持续满 + hauler 已达上限 + 经济健康 + 消费端未饱和
 *                      （改进 B：consumerSaturated = container 满 + storage 盈余 + 储备在涨
 *                       替代旧 spawnFillRatio < 0.8 门禁 — distributor 正常工作时该门禁永久不满足）
 *                    ↓ container 持续空 + hauler > minCount + 经济健康
 *   hauler.minCount  ↑ container 持续半满 + 经济健康 + 消费端未饱和（与 max 共享约束）
 *                    ↓ container 持续极空 + hauler ≤ minCount
 *   harvester.maxCount ↑ 储备持续下降 + harvester 已达上限 + 经济非危机
 *                      ↓ 储备持续增长 + harvester > minCount + 经济健康
 *   upgrader.maxCount ↑ storage 持续高位 + 经济健康 + upgrader 已达上限
 *                     ↓ storage 低位 OR 经济压力高
 *   builder.maxCount  ↑ buildQueue 持续积压 + 经济健康 + builder 已达上限
 *                     ↓ buildQueue 空 OR 经济压力高
 *
 * 趋势确认机制：
 *   每个参数维护一个 lastTrend 方向（up/down/none）。
 *   - 当前评估计算"期望方向" desired。
 *   - 若 desired != "none" 且 prevDirection == desired → 触发调整，newDirection 重置为 "none"。
 *   - 若 desired != "none" 且 prevDirection != desired → 记录 newDirection = desired（首次观察）。
 *   - 若 desired == "none" → newDirection = "none"（清除趋势）。
 *   效果：单次噪声不会触发调整，必须连续 2 次评估窗口都显示同方向。
 */

import type {
  TuningSignals,
  TuningAdjustment,
  TuningEvaluation,
  TrendDirection,
} from "./types";
import { TUNING_BOUNDS, clampParam, isInCooldown, getStorageThresholds } from "./bounds";

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

/** Build queue 积压阈值。 */
const BUILD_BACKLOG = 3;

// ─── 单参数评估结果 ───────────────────────────────────────────

/** 单个参数的评估结果。 */
interface ParamEvaluation {
  /** 若触发调整则非空。 */
  adjustment?: TuningAdjustment;
  /** 本次评估为该参数记录的最新方向（写回 RoomTuningState.lastTrend）。 */
  newDirection: TrendDirection;
}

// ─── 主评估函数 ───────────────────────────────────────────────

/**
 * 评估所有可调参数，返回需要执行的调整列表。
 *
 * @param signals        从遥测聚合的信号
 * @param currentBounds  当前生效的角色边界（CONFIG + override 合并后的值）
 * @param lastAdjusted   每个参数上次调整的 tick
 * @param currentTick    当前 tick
 * @param prevTrend      上次评估的趋势记录（每个参数的方向）—— P1-1 趋势确认
 * @returns 评估结果（调整列表 + 诊断信号 + 新趋势记录）
 */
export function evaluateTuning(
  signals: TuningSignals,
  currentBounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  currentTick: number,
  prevTrend: Record<string, TrendDirection> = {},
): TuningEvaluation {
  const adjustments: TuningAdjustment[] = [];
  const newTrend: Record<string, TrendDirection> = {};
  const signalRecord = toSignalRecord(signals);

  // ── 全局门禁 ──

  if (signals.tierRank >= 2) {
    return { adjustments, signals: signalRecord, skipped: "cpu_tier_conserve_or_worse", newTrend };
  }

  if (signals.crisisRatio > CRISIS_RATIO_LOCK) {
    return { adjustments, signals: signalRecord, skipped: "economy_unstable", newTrend };
  }

  if (signals.rcl < 2) {
    return { adjustments, signals: signalRecord, skipped: "rcl_too_low", newTrend };
  }

  // ── 逐参数评估 ──

  const evals: Array<[string, ParamEvaluation]> = [
    ["hauler.maxCount", evaluateHaulerMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["hauler.maxCount"] ?? "none")],
    ["hauler.minCount", evaluateHaulerMinCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["hauler.minCount"] ?? "none")],
    ["harvester.maxCount", evaluateHarvesterMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["harvester.maxCount"] ?? "none")],
    ["upgrader.maxCount", evaluateUpgraderMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["upgrader.maxCount"] ?? "none")],
    ["builder.maxCount", evaluateBuilderMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["builder.maxCount"] ?? "none")],
  ];

  for (const [param, evalResult] of evals) {
    newTrend[param] = evalResult.newDirection;
    if (evalResult.adjustment) {
      adjustments.push(evalResult.adjustment);
    }
  }

  return { adjustments, signals: signalRecord, newTrend };
}

// ─── hauler.maxCount ─────────────────────────────────────────

function evaluateHaulerMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  prevDirection: TrendDirection,
): ParamEvaluation {
  const param = "hauler.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) {
    return { newDirection: "none" };
  }

  const current = bounds.hauler?.maxCount ?? 6;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;

  // 改进 B：用「container 满 + storage 盈余 + 储备在涨」识别消费端真实无去处，
  // 替代旧 spawnFillRatio < 0.8 门禁（distributor 正常工作时该门禁永久不满足）。
  // 协同点：storage 阈值用改进 C 的 getStorageThresholds(s.rcl).surplus（按 RCL 分级）。
  const storageSurplus = getStorageThresholds(s.rcl).surplus;
  const consumerSaturated =
    s.containerFillRatio > CONTAINER_HIGH &&
    s.avgStorageEnergy > storageSurplus &&
    s.avgReserveDelta > 0;

  // 计算期望方向
  let desired: TrendDirection = "none";
  let reason = "";

  // ↑ 增加：container 持续满 + hauler 已达上限 + 经济健康 + 消费端未饱和
  if (
    s.containerFillRatio > CONTAINER_HIGH &&
    s.haulerCount >= current &&
    economyHealthy &&
    !consumerSaturated &&
    current < boundsDef.ceiling
  ) {
    desired = "up";
    reason = `Containers ${(s.containerFillRatio * 100).toFixed(0)}% full, storage ${s.avgStorageEnergy.toFixed(0)}/${storageSurplus} (consumer unsaturated), haulers at max ${current}`;
  }
  // ↓ 减少：container 持续空 + hauler > minCount + 经济健康
  else if (
    s.containerFillRatio < CONTAINER_LOW &&
    s.haulerCount > (bounds.hauler?.minCount ?? 2) &&
    economyHealthy &&
    current > boundsDef.floor
  ) {
    desired = "down";
    reason = `Containers only ${(s.containerFillRatio * 100).toFixed(0)}% full, haulers likely oversupplied at max ${current}`;
  }

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}

// ─── hauler.minCount ─────────────────────────────────────────

function evaluateHaulerMinCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  prevDirection: TrendDirection,
): ParamEvaluation {
  const param = "hauler.minCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) {
    return { newDirection: "none" };
  }

  const current = bounds.hauler?.minCount ?? 2;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;

  // 改进 B 一致性同步：minCount 与 maxCount 共享消费端约束，
  // 防止「min 上调 → max 不上调 → 死锁」。
  const storageSurplus = getStorageThresholds(s.rcl).surplus;
  const consumerSaturated =
    s.containerFillRatio > CONTAINER_HIGH &&
    s.avgStorageEnergy > storageSurplus &&
    s.avgReserveDelta > 0;

  let desired: TrendDirection = "none";
  let reason = "";

  // ↑ 增加：container 持续半满 + 经济健康 + 消费端未饱和
  if (
    s.containerFillRatio > CONTAINER_MODERATE &&
    economyHealthy &&
    !consumerSaturated &&
    current < boundsDef.ceiling
  ) {
    desired = "up";
    reason = `Containers ${(s.containerFillRatio * 100).toFixed(0)}% full, raising floor to ensure throughput`;
  }
  // ↓ 减少：container 持续极空 + hauler ≤ minCount
  else if (
    s.containerFillRatio < CONTAINER_VERY_LOW &&
    s.haulerCount <= current &&
    current > boundsDef.floor
  ) {
    desired = "down";
    reason = `Containers only ${(s.containerFillRatio * 100).toFixed(0)}% full, lowering floor to avoid idle haulers`;
  }

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}

// ─── harvester.maxCount ──────────────────────────────────────

function evaluateHarvesterMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  prevDirection: TrendDirection,
): ParamEvaluation {
  const param = "harvester.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) {
    return { newDirection: "none" };
  }

  const current = bounds.harvester?.maxCount ?? 4;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
  const economyNotCrisis = s.avgPressure < PRESSURE_STRESSED;

  let desired: TrendDirection = "none";
  let reason = "";

  // ↑ 增加：储备持续下降 + harvester 已达上限 + 经济非危机
  if (
    s.avgReserveDelta < RESERVE_DRAINING &&
    s.harvesterCount >= current &&
    economyNotCrisis &&
    current < boundsDef.ceiling
  ) {
    desired = "up";
    reason = `Reserve draining (${s.avgReserveDelta.toFixed(0)}/cycle) with harvesters at max ${current}`;
  }
  // ↓ 减少：储备持续增长 + harvester > minCount + 经济健康
  else if (
    s.avgReserveDelta > RESERVE_SURPLUS &&
    s.harvesterCount > (bounds.harvester?.minCount ?? 2) &&
    economyHealthy &&
    current > boundsDef.floor
  ) {
    desired = "down";
    reason = `Reserve surplus (+${s.avgReserveDelta.toFixed(0)}/cycle), harvesters oversupplied at max ${current}`;
  }

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}

// ─── upgrader.maxCount ───────────────────────────────────────

function evaluateUpgraderMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  prevDirection: TrendDirection,
): ParamEvaluation {
  const param = "upgrader.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) {
    return { newDirection: "none" };
  }

  const current = bounds.upgrader?.maxCount ?? 3;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
  const economyStressed = s.avgPressure > PRESSURE_STRESSED;

  // 改进 C：storage 阈值按 RCL 分级，不同发展阶段用不同标准。
  const { surplus: storageSurplus, low: storageLow } = getStorageThresholds(s.rcl);

  let desired: TrendDirection = "none";
  let reason = "";

  // ↑ 增加：storage 持续高位 + 经济健康 + upgrader 已达上限
  if (
    s.avgStorageEnergy > storageSurplus &&
    economyHealthy &&
    s.upgraderCount >= current &&
    current < boundsDef.ceiling
  ) {
    desired = "up";
    reason = `Storage ${s.avgStorageEnergy.toFixed(0)} energy (surplus ${storageSurplus}, RCL${s.rcl}) with upgraders at max ${current}, burning surplus`;
  }
  // ↓ 减少：storage 低位（仅 RCL4+，storage 已解锁）OR 经济压力高。
  // TU-1 修复：无 storage 的 RCL2-3 房间 avgStorageEnergy 恒 0 —
  // 原条件对它们永久成立，每 2000 tick 棘轮式把 upgrader 压到地板 1，
  // 早期升级产能被系统性压制。「storage 未解锁」≠「storage 枯竭」。
  else if (
    ((s.avgStorageEnergy < storageLow && s.rcl >= 4) || economyStressed) &&
    current > boundsDef.floor
  ) {
    desired = "down";
    reason = s.avgStorageEnergy < storageLow
      ? `Storage low (${s.avgStorageEnergy.toFixed(0)}, threshold ${storageLow}, RCL${s.rcl}), conserving upgrade capacity`
      : `Economy pressure high (${(s.avgPressure * 100).toFixed(0)}%), reducing upgrade capacity`;
  }

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}

// ─── builder.maxCount ────────────────────────────────────────

function evaluateBuilderMaxCount(
  s: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  tick: number,
  prevDirection: TrendDirection,
): ParamEvaluation {
  const param = "builder.maxCount";
  if (isInCooldown(param, lastAdjusted[param], tick)) {
    return { newDirection: "none" };
  }

  const current = bounds.builder?.maxCount ?? 4;
  const boundsDef = TUNING_BOUNDS[param]!;
  const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
  const economyStressed = s.avgPressure > 0.4;

  let desired: TrendDirection = "none";
  let reason = "";

  // ↑ 增加：buildQueue 持续积压 + 经济健康 + builder 已达上限
  if (
    s.buildQueueBacklog > BUILD_BACKLOG &&
    economyHealthy &&
    s.builderCount >= current &&
    current < boundsDef.ceiling
  ) {
    desired = "up";
    reason = `Build backlog ${s.buildQueueBacklog} items with builders at max ${current}`;
  }
  // ↓ 减少：buildQueue 空 OR 经济压力高
  else if (
    (s.buildQueueBacklog === 0 || economyStressed) &&
    current > boundsDef.floor
  ) {
    desired = "down";
    reason = s.buildQueueBacklog === 0
      ? `No build backlog, reducing builder capacity from ${current}`
      : `Economy pressure high (${(s.avgPressure * 100).toFixed(0)}%), reducing builder capacity`;
  }

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}

// ─── 趋势确认核心 ────────────────────────────────────────────

/**
 * 趋势确认逻辑（P1-1 调整置信度）。
 *
 * @param param        参数路径
 * @param desired      本次评估的期望方向
 * @param prevDirection 上次评估记录的方向
 * @param currentValue  当前参数值
 * @param step         步长
 * @param reason       调整原因（仅触发时使用）
 * @returns 参数评估结果（含可能的新调整和最新方向）
 *
 * 机制：
 *   - desired == "none" → 清除趋势，newDirection = "none"
 *   - desired != "none" 且 prevDirection == desired → 连续 2 次同方向，触发调整，newDirection 重置为 "none"
 *   - desired != "none" 且 prevDirection != desired → 首次观察，记录 newDirection = desired，不调整
 */
function confirmAndBuild(
  param: string,
  desired: TrendDirection,
  prevDirection: TrendDirection,
  currentValue: number,
  step: number,
  reason: string,
): ParamEvaluation {
  // 无调整倾向 — 清除趋势
  if (desired === "none") {
    return { newDirection: "none" };
  }

  // 连续 2 次同方向 — 触发调整，重置趋势
  if (prevDirection === desired) {
    const newValue = desired === "up"
      ? clampParam(param, currentValue + step)
      : clampParam(param, currentValue - step);
    return {
      adjustment: { param, oldValue: currentValue, newValue, reason },
      newDirection: "none", // 调整后重置，下次需重新积累 2 次确认
    };
  }

  // 首次观察 — 记录方向，不调整
  return { newDirection: desired };
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
    spawnFillRatio: Math.round(s.spawnFillRatio * 100) / 100,
    haulerCount: s.haulerCount,
    harvesterCount: s.harvesterCount,
    upgraderCount: s.upgraderCount,
    builderCount: s.builderCount,
    buildQueueBacklog: s.buildQueueBacklog,
    tierRank: s.tierRank,
    rcl: s.rcl,
  };
}
