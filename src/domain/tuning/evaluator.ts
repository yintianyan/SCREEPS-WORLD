/** Tuning Evaluator — 从聚合遥测信号推导参数调整的纯函数（无 Game/Memory，可 Vitest）。 */

import type {
  TuningSignals,
  TuningAdjustment,
  TuningEvaluation,
  TrendDirection,
  PendingValidation,
  AdjustSignalsSnapshot,
} from "./types";
import { TUNING_BOUNDS, clampParam, isInCooldown, getStorageThresholds, ROLLBACK_FREEZE_THRESHOLD, FROZEN_DURATION } from "./bounds";

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

// ─── 改进 A：闭环验证常量（附录 D）────────────────────────────

/** 容差双门限 max(5% 相对, 0.05 绝对)（附录 9.2-1），防低基数失效（container=0.1 时 5%=0.005）。 */
const TOLERANCE_RELATIVE = 0.05;
const TOLERANCE_ABSOLUTE = 0.05;

/** D.4 下调护栏：spawn 填充率 < 0.5 视为「spawn 饿死」（半空 = 搬运塌方证据），即使主信号改善也回滚。 */
const SPAWN_FILL_GUARDRAIL = 0.5;

/** D.4 下调护栏：avgReserveDelta 转负视为「储备恶化」，即使主信号改善也回滚。 */
const RESERVE_DELTA_GUARDRAIL = 0;

// ─── 单参数评估结果 ───────────────────────────────────────────

/** 单个参数的评估结果。 */
interface ParamEvaluation {
  /** 若触发调整则非空。 */
  adjustment?: TuningAdjustment;
  /** 本次评估为该参数记录的最新方向（写回 RoomTuningState.lastTrend）。 */
  newDirection: TrendDirection;
  /** 改进 A：触发调整时返回的 pendingValidation 写入指令（adjustTick 由调用方填入）。 */
  pendingValidation?: Omit<PendingValidation, "adjustTick">;
}

// ─── 主评估函数 ───────────────────────────────────────────────

/**
 * 评估所有可调参数，返回调整列表。
 * currentBounds 为 CONFIG + override 合并后的值；excludedParams（pending-lock D.2 +
 * frozen P3 的参数）从 evals 整体排除（含 trend 记录）。
 */
export function evaluateTuning(
  signals: TuningSignals,
  currentBounds: Record<string, { minCount: number; maxCount: number }>,
  lastAdjusted: Record<string, number>,
  currentTick: number,
  prevTrend: Record<string, TrendDirection> = {},
  excludedParams?: ReadonlySet<string>,
): TuningEvaluation {
  const adjustments: TuningAdjustment[] = [];
  const newTrend: Record<string, TrendDirection> = {};
  let pendingValidations: Record<string, PendingValidation> | undefined;
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

  const allEvals: Array<[string, ParamEvaluation]> = [
    ["hauler.maxCount", evaluateHaulerMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["hauler.maxCount"] ?? "none")],
    ["hauler.minCount", evaluateHaulerMinCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["hauler.minCount"] ?? "none")],
    ["harvester.maxCount", evaluateHarvesterMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["harvester.maxCount"] ?? "none")],
    ["upgrader.maxCount", evaluateUpgraderMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["upgrader.maxCount"] ?? "none")],
    ["builder.maxCount", evaluateBuilderMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["builder.maxCount"] ?? "none")],
  ];

  for (const [param, evalResult] of allEvals) {
    // 排除参数（D.2 pending-lock + P3 frozen）trend 置 none，验证完成后从 none 重新积累
    if (excludedParams?.has(param)) {
      newTrend[param] = "none";
      continue;
    }
    newTrend[param] = evalResult.newDirection;
    if (evalResult.adjustment) {
      adjustments.push(evalResult.adjustment);
    }
    if (evalResult.pendingValidation) {
      if (!pendingValidations) pendingValidations = {};
      pendingValidations[param] = {
        ...evalResult.pendingValidation,
        adjustTick: currentTick,
      };
    }
  }

  const result: TuningEvaluation = { adjustments, signals: signalRecord, newTrend };
  if (pendingValidations) result.pendingValidations = pendingValidations;
  return result;
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

  // 改进 B：消费端真实无去处 = container 满 + storage 盈余 + 储备在涨，替代旧
  // spawnFillRatio < 0.8 门禁（distributor 正常工作时该门禁永久不满足）。
  const storageSurplus = getStorageThresholds(s.rcl).surplus;
  const consumerSaturated =
    s.containerFillRatio > CONTAINER_HIGH &&
    s.avgStorageEnergy > storageSurplus &&
    s.avgReserveDelta > 0;

  let desired: TrendDirection = "none";
  let reason = "";

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
  else if (
    s.containerFillRatio < CONTAINER_LOW &&
    s.haulerCount > (bounds.hauler?.minCount ?? 2) &&
    economyHealthy &&
    current > boundsDef.floor
  ) {
    desired = "down";
    reason = `Containers only ${(s.containerFillRatio * 100).toFixed(0)}% full, haulers likely oversupplied at max ${current}`;
  }

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason, s);
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

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason, s);
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

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason, s);
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

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason, s);
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

  return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason, s);
}

// ─── 趋势确认核心 ────────────────────────────────────────────

/**
 * 趋势确认逻辑（P1-1）+ 改进 A 闭环验证快照构造。
 * 机制：desired=none → 清趋势；desired 与 prevDirection 相同（连续 2 次同方向）→
 * 触发调整并重置趋势；不同 → 首次观察，只记录方向不调整。
 * 改进 A：触发调整时同步构造 PendingValidation 写入指令（preAdjustSignals 快照 +
 * expectedDirection + adjustDirection），由调用方（tuning-engine）落 Memory。
 */
function confirmAndBuild(
  param: string,
  desired: TrendDirection,
  prevDirection: TrendDirection,
  currentValue: number,
  step: number,
  reason: string,
  signals: TuningSignals,
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
      // 改进 A：构造 pendingValidation 快照（adjustTick 由 evaluateTuning 填入 currentTick）
      pendingValidation: {
        preAdjustSignals: capturePreAdjustSignals(param, signals),
        expectedDirection: getExpectedDirection(param, desired),
        adjustDirection: desired,
        preAdjustValue: currentValue,
      },
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

// ─── 改进 A：闭环验证辅助函数 ──────────────────────────────

/**
 * 从当前 signals 捕获参数相关的快照子集（控 Memory 体积）。
 * 每个参数只记录它验证时需要的字段。
 */
function capturePreAdjustSignals(param: string, s: TuningSignals): AdjustSignalsSnapshot {
  const snapshot: AdjustSignalsSnapshot = { roleCount: getRoleCount(param, s) };
  if (param.startsWith("hauler.")) {
    snapshot.containerFillRatio = s.containerFillRatio;
    snapshot.spawnFillRatio = s.spawnFillRatio;
    // P2 修复（附录 E.2）：补 avgReserveDelta 到快照，否则 isGuardrailTriggered
    // 的 reserveDelta 护栏分支恒读取 undefined → 永不触发（死代码）。
    // hauler 下调可能引发储备恶化（搬运产能下降 → source 满溢 → 储备赤字），
    // 护栏需在「主信号改善但储备转负」时触发回滚。
    snapshot.avgReserveDelta = s.avgReserveDelta;
  } else if (param.startsWith("harvester.")) {
    snapshot.avgReserveDelta = s.avgReserveDelta;
  } else if (param.startsWith("upgrader.")) {
    snapshot.avgStorageEnergy = s.avgStorageEnergy;
    snapshot.avgPressure = s.avgPressure;
  } else if (param.startsWith("builder.")) {
    snapshot.buildQueueBacklog = s.buildQueueBacklog;
  }
  return snapshot;
}

/**
 * 获取参数对应角色的当前存活数。
 * 用于 D.3 人口合同前置验证。
 */
function getRoleCount(param: string, s: TuningSignals): number {
  if (param.startsWith("hauler.")) return s.haulerCount;
  if (param.startsWith("harvester.")) return s.harvesterCount;
  if (param.startsWith("upgrader.")) return s.upgraderCount;
  if (param.startsWith("builder.")) return s.builderCount;
  return 0;
}

/**
 * 参数在指定调整方向下的期望信号方向（improve/worsen，§3.1.2）：
 * hauler → improve；harvester up=improve（恢复储备）/down=worsen（主动节能）；
 * upgrader up=worsen（烧库存）/down=improve（攒库存）；
 * builder up=improve（消除积压）/down=worsen（主动降产）。
 */
function getExpectedDirection(param: string, adjustDirection: TrendDirection): "improve" | "worsen" {
  if (param.startsWith("hauler.")) return "improve";
  if (param.startsWith("harvester.")) return adjustDirection === "up" ? "improve" : "worsen";
  if (param.startsWith("upgrader.")) return adjustDirection === "up" ? "worsen" : "improve";
  if (param.startsWith("builder.")) return adjustDirection === "up" ? "improve" : "worsen";
  return "improve";
}

/**
 * 计算容差双门限：max(5% 相对, 0.05 绝对)。
 * 防低基数失效（container=0.1 时 5%=0.005 无意义）。
 */
function computeTolerance(baseValue: number): number {
  return Math.max(TOLERANCE_ABSOLUTE, Math.abs(baseValue) * TOLERANCE_RELATIVE);
}

/**
 * D.3 人口合同前置：roleCount 是否达到新边界（up → preAdjustValue+1，down →
 * preAdjustValue-1）。未达 → 标 pending-blocked，不判失败不计回滚，下周期复验。
 */
function isContractMet(pv: PendingValidation, currentRoleCount: number): boolean {
  if (pv.adjustDirection === "up") {
    return currentRoleCount >= pv.preAdjustValue + 1;
  }
  return currentRoleCount <= pv.preAdjustValue - 1;
}

/**
 * P2 多信号验证 + D.4 下调护栏：判断调整后效果是否改善。
 * 多信号 OR（§3.1.7）：每参数「改善证据集」任一满足即算改善，避免单瞬态信号
 * （如 backlog 归零）误回滚。D.4 下调护栏：下调验证 = 主信号方向 AND 护栏
 * （spawnFillRatio 不跌破阈值、avgReserveDelta 不转负；upgrader 下调查 avgPressure），
 * 护栏触发即回滚（防假阳性 — 把伤害当改善接受）。
 * 返回 true = 改善或无显著变化（不回滚）；false = 未改善（回滚）。
 */
function isImprovedMultiSignal(
  param: string,
  pv: PendingValidation,
  currentSignals: TuningSignals,
): boolean {
  const before = pv.preAdjustSignals;
  const isUp = pv.adjustDirection === "up";

  // ── D.4 下调护栏：仅下调方向检查 ──
  if (!isUp && isGuardrailTriggered(param, before, currentSignals)) {
    return false; // 护栏触发 → 回滚
  }

  // ── P2 多信号 OR 判定 ──
  if (param.startsWith("hauler.")) {
    // hauler: containerFillRatio ↓（up 改善=container 不那么满）
    //         OR spawnFillRatio ↑（P2 能量再分配证据）
    //         down 改善 = containerFillRatio ↑（hauler 减少 → container 更满）
    const cBefore = before.containerFillRatio;
    const cAfter = currentSignals.containerFillRatio;
    if (cBefore !== undefined) {
      const delta = cAfter - cBefore;
      const tol = computeTolerance(cBefore);
      if (Math.abs(delta) < tol) return true; // 无显著变化 → 不回滚（保守）
      const cImproved = isUp ? delta < -tol : delta > tol;
      if (cImproved) return true;
      // 检查 spawnFillRatio 作为次要证据（仅 up 方向）
      if (isUp) {
        const sBefore = before.spawnFillRatio;
        const sAfter = currentSignals.spawnFillRatio;
        if (sBefore !== undefined) {
          const sDelta = sAfter - sBefore;
          const sTol = computeTolerance(sBefore);
          if (sDelta > sTol) return true; // spawnFill 上升 = 能量再分配证据
        }
      }
      return false; // 主信号未改善，次要证据也不成立 → 回滚
    }
    return true; // preAdjustSignals 缺失 → 不验证，不回滚（保守）
  }

  if (param.startsWith("harvester.")) {
    const before_ = before.avgReserveDelta;
    const after = currentSignals.avgReserveDelta;
    if (before_ === undefined) return true;
    const delta = after - before_;
    const tol = computeTolerance(before_);
    if (Math.abs(delta) < tol) return true;
    // up(improve) = reserveDelta ↑；down(worsen) = reserveDelta ↓
    return isUp ? delta > tol : delta < -tol;
  }

  if (param.startsWith("upgrader.")) {
    const before_ = before.avgStorageEnergy;
    const after = currentSignals.avgStorageEnergy;
    if (before_ === undefined) return true;
    const delta = after - before_;
    const tol = computeTolerance(before_);
    if (Math.abs(delta) < tol) return true;
    // up(worsen=烧库存) = storageEnergy ↓；down(improve=攒库存) = storageEnergy ↑
    return isUp ? delta < -tol : delta > tol;
  }

  if (param.startsWith("builder.")) {
    // builder up: backlog ↓ OR builderCount >= preAdjustValue+1（人口到位即生效）
    if (isUp) {
      const roleCount = getRoleCount(param, currentSignals);
      if (roleCount >= pv.preAdjustValue + 1) return true; // 人口到位
    }
    const before_ = before.buildQueueBacklog;
    const after = currentSignals.buildQueueBacklog;
    if (before_ === undefined) return true;
    const delta = after - before_;
    const tol = computeTolerance(before_);
    if (Math.abs(delta) < tol) return true;
    // up(improve) = backlog ↓；down(worsen) = backlog ↑
    return isUp ? delta < -tol : delta > tol;
  }

  return true; // 未知参数 → 不回滚（保守）
}

/**
 * D.4 下调护栏（仅下调方向）：hauler 下调 spawnFillRatio 跌破阈值或 avgReserveDelta
 * 转负且比调整前恶化、upgrader 下调 avgPressure 超阈值且恶化 → 回滚。
 * 「比调整前恶化」要求信号不仅越过危险阈值还要朝坏方向移动 — 防「调整前就在
 * 危险区」误触发护栏。
 */
function isGuardrailTriggered(
  param: string,
  before: AdjustSignalsSnapshot,
  current: TuningSignals,
): boolean {
  if (param.startsWith("hauler.")) {
    // spawnFillRatio 跌破阈值且恶化
    const sBefore = before.spawnFillRatio;
    if (sBefore !== undefined) {
      if (
        current.spawnFillRatio < SPAWN_FILL_GUARDRAIL &&
        current.spawnFillRatio < sBefore - computeTolerance(sBefore)
      ) {
        return true;
      }
    }
    // avgReserveDelta 转负且恶化
    const rBefore = before.avgReserveDelta;
    if (rBefore !== undefined) {
      if (
        current.avgReserveDelta < RESERVE_DELTA_GUARDRAIL &&
        current.avgReserveDelta < rBefore - computeTolerance(rBefore)
      ) {
        return true;
      }
    }
    return false;
  }

  if (param.startsWith("upgrader.")) {
    // avgPressure 超阈值且恶化
    const pBefore = before.avgPressure;
    if (pBefore !== undefined) {
      if (
        current.avgPressure > PRESSURE_STRESSED &&
        current.avgPressure > pBefore + computeTolerance(pBefore)
      ) {
        return true;
      }
    }
    return false;
  }

  // harvester/builder 下调无额外护栏（主信号已足够）
  return false;
}

// ─── 改进 A：验证 pass 主函数 ───────────────────────────────

/**
 * 验证 pass：检查所有 pendingValidation 中到期参数的调整效果。
 * 集成点：tuning-engine.ts:safeRunTuning 内、evaluateTuning 调用之前。
 * 流程（§3.1.10 步骤 3-3.6）：verifyDelay 未到期跳过；D.3 人口合同未达 → blocked
 * （P1：连续 2 个 verifyDelay 窗口未恢复 → 回滚 + 计 1 次回滚）；D.4+P2 信号未改善
 * → 回滚；验证完成清空 pending。
 * 副作用说明（P1）：本函数写入/清空 pv.blockedSinceTick + pv.contractBlocked（pending
 * 生命周期本由本函数驱动 — clearedParams 触发外部 delete），故非纯函数。
 */
export function verifyPendingAdjustments(
  signals: TuningSignals,
  pending: Record<string, PendingValidation>,
  currentBounds: Record<string, { minCount: number; maxCount: number }>,
  currentTick: number,
): {
  rollbacks: TuningAdjustment[];
  clearedParams: string[];
  blockedParams: string[];
} {
  const rollbacks: TuningAdjustment[] = [];
  const clearedParams: string[] = [];
  const blockedParams: string[] = [];

  for (const param in pending) {
    const pv = pending[param]!;
    const bounds = TUNING_BOUNDS[param];
    if (!bounds) {
      // 未知参数 — 清空 pending，不回滚
      clearedParams.push(param);
      continue;
    }

    // 1. verifyDelay 未到期 — 跳过验证，保留 pending
    if (currentTick - pv.adjustTick < bounds.verifyDelay) continue;

    // 2. D.3 人口合同前置：roleCount 未达新边界
    const currentRoleCount = getRoleCount(param, signals);
    if (!isContractMet(pv, currentRoleCount)) {
      // P1 修复（附录 E.2）：blocked TTL 机制
      // 首次 blocked：记录 blockedSinceTick
      if (pv.blockedSinceTick === undefined) {
        pv.blockedSinceTick = currentTick;
      }
      pv.contractBlocked = true;

      // TTL 检查：连续 2 个 verifyDelay 窗口仍未达人口 → 回滚 + 计 1 次回滚
      // 设计依据：参数被 pending-lock 永久排除且零告警是 P1 病理场景；
      // 2 窗口（3000 tick）给 demand 足够时间收敛，超时则承认调整无效并回滚。
      if (pv.blockedSinceTick + 2 * bounds.verifyDelay <= currentTick) {
        const currentValue = getCurrentParamValue(param, currentBounds);
        rollbacks.push({
          param,
          oldValue: currentValue,
          newValue: pv.preAdjustValue,
          reason: `Contract blocked timeout: ${param} roleCount not reached after ${2 * bounds.verifyDelay} ticks`,
        });
        clearedParams.push(param); // TTL 回滚 = 闭环结束，清空 pending
      } else {
        blockedParams.push(param); // 仍在 TTL 窗口内，保留 pending 下周期复验
      }
      continue;
    }

    // 人口合同满足 — 清空 blocked 诊断字段（P1）
    if (pv.contractBlocked !== undefined || pv.blockedSinceTick !== undefined) {
      delete pv.contractBlocked;
      delete pv.blockedSinceTick;
    }

    // 3. D.4 + P2 多信号验证
    const improved = isImprovedMultiSignal(param, pv, signals);

    if (!improved) {
      // 回滚到 preAdjustValue
      const currentValue = getCurrentParamValue(param, currentBounds);
      rollbacks.push({
        param,
        oldValue: currentValue,
        newValue: pv.preAdjustValue,
        reason: `Effect verification failed: ${param} signal not improved after verifyDelay`,
      });
    }

    // 4. 验证完成 — 清空 pending（无论回滚与否）
    clearedParams.push(param);
  }

  return { rollbacks, clearedParams, blockedParams };
}

/**
 * 从 currentBounds 获取参数的当前值。
 * 用于回滚时构造 TuningAdjustment.oldValue。
 */
function getCurrentParamValue(
  param: string,
  currentBounds: Record<string, { minCount: number; maxCount: number }>,
): number {
  const [role, field] = parseParamPath(param);
  if (!role || !field) return 0;
  const bounds = currentBounds[role];
  if (!bounds) return 0;
  return field === "maxCount" ? bounds.maxCount : bounds.minCount;
}

/** 解析参数路径 "hauler.maxCount" → ["hauler", "maxCount"]。 */
function parseParamPath(param: string): [string, string] | [undefined, undefined] {
  const idx = param.indexOf(".");
  if (idx === -1) return [undefined, undefined];
  return [param.slice(0, idx), param.slice(idx + 1)];
}

// ─── 改进 A：冻结策略（P3）──────────────────────────────────

/**
 * 应用冻结策略：回滚次数达阈值则冻结参数。
 * 评审修正（附录 D.5）：冻结只停评估不停值 — 冻结时参数复位到 CONFIG 基线
 * （避免钉死错误值）；冻结事件写 event-log（由调用方 recordEvent）；rollbackCount
 * 解冻后清零（P4 修复，附录 E.2）— 原实现保留导致一次回滚即再冻结，对「冻结期
 * 世界已变」过于粘滞；解冻后重新累积，复发确认交给阈值 3。
 */
export function applyFreezePolicy(
  frozenParams: Record<string, import("./types").FrozenParamState>,
  rollbacks: TuningAdjustment[],
  clearedParams: string[],
  configBaselines: Record<string, number>,
  currentTick: number,
): { newlyFrozen: Array<{ param: string; reason: string }>; unfrozenParams: string[] } {
  const newlyFrozen: Array<{ param: string; reason: string }> = [];
  const unfrozenParams: string[] = [];

  // P4 修复（附录 E.2）：解冻扫描 — 冻结期满的参数从 frozenParams 移除。
  // 原实现解冻后 frozenUntil=0 但 rollbackCount 保留 → 一次回滚即再冻结 10000 tick，
  // 对「冻结期世界已变」的场景过于粘滞。解冻后 rollbackCount 清零重新累积，
  // 复发确认重新交给 ROLLBACK_FREEZE_THRESHOLD(3) 阈值。
  // 注意：buildExcludedParams 已通过 frozenUntil > tick 判定排除状态，
  // 解冻后参数不再被排除（恢复正常评估），此处仅清理 frozenParams 条目。
  for (const param in frozenParams) {
    const fp = frozenParams[param];
    if (!fp) continue;
    if (fp.frozenUntil > 0 && fp.frozenUntil <= currentTick) {
      delete frozenParams[param];
      unfrozenParams.push(param);
    }
  }

  // 验证通过（cleared 但无回滚）的参数 → 重置 rollbackCount
  const rolledBackParams = new Set(rollbacks.map(r => r.param));
  for (const param of clearedParams) {
    if (!rolledBackParams.has(param)) {
      const existing = frozenParams[param];
      if (existing && existing.rollbackCount > 0) {
        existing.rollbackCount = 0;
      }
    }
  }

  // 回滚的参数 → 累加 rollbackCount，达阈值则冻结
  for (const rb of rollbacks) {
    const existing = frozenParams[rb.param];
    const newCount = (existing?.rollbackCount ?? 0) + 1;

    if (newCount >= ROLLBACK_FREEZE_THRESHOLD) {
      // D.5 冻结复位到 CONFIG 基线
      const baseline = configBaselines[rb.param];
      if (baseline !== undefined) {
        rb.newValue = baseline;
        rb.reason += ` → FROZEN (reset to CONFIG baseline ${baseline})`;
      }
      frozenParams[rb.param] = {
        frozenAt: currentTick,
        frozenUntil: currentTick + FROZEN_DURATION,
        reason: `Consecutive ${newCount} rollbacks`,
        rollbackCount: newCount,
      };
      newlyFrozen.push({ param: rb.param, reason: `Consecutive ${newCount} rollbacks` });
    } else {
      // 未达阈值 — 跟踪 rollbackCount（frozenUntil=0 表示未冻结）
      if (!existing || existing.frozenUntil === 0) {
        frozenParams[rb.param] = {
          frozenAt: 0,
          frozenUntil: 0,
          reason: "",
          rollbackCount: newCount,
        };
      } else {
        existing.rollbackCount = newCount;
      }
    }
  }

  return { newlyFrozen, unfrozenParams };
}
