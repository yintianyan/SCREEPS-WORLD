/**
 * Plan Lifecycle — A3.2 Phase 1：Plan 生命周期管理 + 去重 + 重评。
 *
 * 合同锚点：PLANNING_ARCHITECTURE §4 防振荡三防线。
 *
 * 定位：管理 Plan 的状态流转（DISCOVERED→...→WAITING_EXECUTION），
 * 包括去重（同一 roomName 最多一个 Active Plan）、重评（经济/Intel 变化时）、
 * 和防抖（READY↔NOT_READY 滞回）。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExpansionPlan, PlanStatus } from "./plan";
import { updatePlanStatus } from "./plan";

/** Active 状态集合（在生命周期中的 Plan）。 */
const ACTIVE_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "DISCOVERED",
  "EVALUATED",
  "READY",
  "APPROVED",
  "WAITING_EXECUTION",
]);

/** 最大 Active Plan 数（有界列表）。 */
export const MAX_ACTIVE_PLANS = 5;

/** 防抖选项。 */
export interface LifecycleOptions {
  /** READY → NOT_READY 需要持续不满足的 tick 数。 */
  downgradeTicks: number;
  /** NOT_READY → READY 需要持续满足的 tick 数。 */
  upgradeTicks: number;
  /** 重建冷却（CANCELLED 后多久不能重建同 roomName）。 */
  rebuildCooldown: number;
  /** 重评间隔（tick）。 */
  reevalInterval: number;
}

export const DEFAULT_LIFECYCLE_OPTIONS: LifecycleOptions = {
  downgradeTicks: 200,
  upgradeTicks: 500,
  rebuildCooldown: 10000,
  reevalInterval: 500,
};

/** 防抖状态跟踪。 */
export interface PlanHysteresis {
  /** 持续满足 ready 条件的 tick 数。 */
  readyTicks: number;
  /** 持续不满足 ready 条件的 tick 数。 */
  notReadyTicks: number;
  /** 最近一次评估 tick。 */
  lastEvalTick: number;
}

/** Plan + 防抖状态。 */
export interface PlanWithHysteresis {
  plan: ExpansionPlan;
  hysteresis: PlanHysteresis;
}

/**
 * Plan 去重：同一 roomName 最多一个 Active Plan。
 * 如已有 Active Plan 则不新增。
 */
export function deduplicatePlans(
  existing: readonly ExpansionPlan[],
  newPlan: ExpansionPlan,
): { plans: ExpansionPlan[]; deduplicated: boolean } {
  const conflict = existing.find(
    p => p.roomName === newPlan.roomName && ACTIVE_STATUSES.has(p.status),
  );
  if (conflict) {
    return { plans: [...existing], deduplicated: true };
  }
  return { plans: [...existing, newPlan], deduplicated: false };
}

/**
 * 清理终态 Plan（移除非 Active 且超过冷却期的 Plan）。
 */
export function prunePlans(
  plans: readonly ExpansionPlan[],
  tick: number,
  options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS,
): ExpansionPlan[] {
  return plans.filter(p => {
    if (ACTIVE_STATUSES.has(p.status)) return true;
    // 终态 Plan 保留到冷却期后移除
    if (p.status === "CANCELLED" || p.status === "BLACKLISTED") {
      return tick - p.updatedAt < options.rebuildCooldown;
    }
    if (p.status === "COMPLETED") {
      return tick - p.updatedAt < options.rebuildCooldown;
    }
    return false;
  });
}

/**
 * 获取 Active Plan 列表（截断到 MAX_ACTIVE_PLANS）。
 */
export function getActivePlans(
  plans: readonly ExpansionPlan[],
): ExpansionPlan[] {
  return plans
    .filter(p => ACTIVE_STATUSES.has(p.status))
    .slice(0, MAX_ACTIVE_PLANS);
}

/**
 * 检查 roomName 是否在重建冷却期内（禁止重建）。
 */
export function isRebuildBlocked(
  plans: readonly ExpansionPlan[],
  roomName: string,
  tick: number,
  options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS,
): boolean {
  return plans.some(
    p => p.roomName === roomName
    && (p.status === "CANCELLED" || p.status === "BLACKLISTED")
    && tick - p.updatedAt < options.rebuildCooldown,
  );
}

/**
 * 防抖判定：根据 ready 条件和持续时间决定 Plan 状态流转。
 *
 * @param current 当前 Plan + 防抖状态
 * @param isReady 当前是否满足 ready 条件
 * @param tick 当前 tick
 * @param options 防抖选项
 * @returns 更新后的 Plan + 防抖状态
 */
export function applyHysteresis(
  current: PlanWithHysteresis,
  isReady: boolean,
  tick: number,
  options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS,
): PlanWithHysteresis {
  const h = { ...current.hysteresis, lastEvalTick: tick };

  if (isReady) {
    h.readyTicks++;
    h.notReadyTicks = 0;

    // 持续满足 → 升级到 READY
    if (h.readyTicks >= options.upgradeTicks && current.plan.status === "EVALUATED") {
      return {
        plan: updatePlanStatus(current.plan, "READY", tick),
        hysteresis: h,
      };
    }
  } else {
    h.notReadyTicks++;
    h.readyTicks = 0;

    // 持续不满足 → 降级到 EVALUATED
    if (h.notReadyTicks >= options.downgradeTicks && current.plan.status === "READY") {
      return {
        plan: updatePlanStatus(current.plan, "EVALUATED", tick, "hysteresis-downgrade"),
        hysteresis: h,
      };
    }
  }

  return { plan: current.plan, hysteresis: h };
}

/**
 * 判断是否需要重评（经济/Intel/Cost/Core Health 变化时触发）。
 */
export function needsReevaluation(
  plan: ExpansionPlan,
  tick: number,
  options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS,
): boolean {
  if (!ACTIVE_STATUSES.has(plan.status)) return false;
  return tick - plan.updatedAt >= options.reevalInterval;
}
