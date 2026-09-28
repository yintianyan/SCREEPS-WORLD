/** Plan Lifecycle */

import type { ExpansionPlan, PlanStatus } from "./plan";
import { updatePlanStatus } from "./plan";

/** Active 状态集合（在生命周期中的 Plan）。 */
const ACTIVE_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "DISCOVERED",
  "EVALUATED",
  "READY",
  "APPROVED",
  "WAITING_EXECUTION",
  // "执行中"也是在生命周期内 —— prunePlans 的判据是"非 Active 且已过冷却即删"，
  // 少了这一格，plan-adapter 每次标记 EXECUTING 都会在下一个 planner 周期被
  // 连账本一起抹掉（expansion-planner 步 10/11 会把裁剪结果写回 Memory）。
  // 后果不止观测：state-machine 的三处 COMPLETED 与一处 CANCELLED 都是按 planId
  // 找记录写的，记录没了就全成空写 → 终态不留 rebuildCooldown → 同一片废墟被
  // 反复重新立项（deduplicatePlans 的"同房不得有两个在途计划"同样瞎）。
  // 它**不进** isRebuildBlocked（那是 CANCELLED/BLACKLISTED 的冷却语义）——
  // "正在执行"≠"刚失败"，这条界线由用例钉住。
  "EXECUTING",
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
  // planId 是 roomName + discoveredAt 派生的，而 discoveredAt 跟着候选活下来 ——
  // 于是"同一间房在 CANCELLED 孪生记录还在冷却期时被重新立项"会拿到**同一个 planId**。
  // 终态回写 (`updatePlanStatus`) 是按 planId 找第一条，重复 id 会把 COMPLETED 写进那条
  // 早已终态的孪生记录里，真正在执行的计划永远停在 EXECUTING —— 而 EXECUTING 算在途，
  // 上面那条同房互斥就会把这间房永久挡死。身份唯一性在这里守，比在每个读者那里防便宜。
  if (existing.some(p => p.planId === newPlan.planId)) {
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
export function getActivePlans(plans: readonly ExpansionPlan[]): ExpansionPlan[] {
  return plans.filter(p => ACTIVE_STATUSES.has(p.status)).slice(0, MAX_ACTIVE_PLANS);
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
    p =>
      p.roomName === roomName &&
      (p.status === "CANCELLED" || p.status === "BLACKLISTED") &&
      tick - p.updatedAt < options.rebuildCooldown,
  );
}

/**
 * 防抖判定：按 **tick 时长**决定 Plan 升/降档，计时状态就存在 Plan 上（持久化）。
 *
 * 口径必须是 tick：`upgradeTicks` / `downgradeTicks` 的语义写的是「持续多少 tick」，
 * 而 planner 每 100 tick 才运行一次。旧实现按**调用次数**累加、且计数器活在 heap 里 ——
 * 阈值 500 等于要 50,000 个 tick 不间断，任何一次 global reset（每次部署必然发生）都清零。
 * 线上后果：7 张 Plan 在 75 万 tick 里一张都没升过档，扩张模块从未真正参与过决策。
 *
 * 返回值就是更新后的 Plan —— 不再有外部缓存副产物，调用方不必维护 hysteresisCache。
 */
export function applyHysteresis(
  plan: ExpansionPlan,
  isReady: boolean,
  tick: number,
  options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS,
): ExpansionPlan {
  if (plan.status !== "EVALUATED" && plan.status !== "READY") return plan;

  if (isReady) {
    const readySince = plan.readySince ?? tick;
    const next =
      plan.readySince === readySince && plan.notReadySince === undefined
        ? plan
        : { ...plan, readySince, notReadySince: undefined };
    if (next.status === "EVALUATED" && tick - readySince >= options.upgradeTicks) {
      return updatePlanStatus(next, "READY", tick);
    }
    return next;
  }

  const notReadySince = plan.notReadySince ?? tick;
  const next = { ...plan, notReadySince, readySince: undefined as number | undefined };
  if (next.status === "READY" && tick - notReadySince >= options.downgradeTicks) {
    return updatePlanStatus(next, "EVALUATED", tick, "hysteresis-downgrade");
  }
  return next;
}

/**
 * Sponsor 房已不在手里的 Plan：改挂到仍在场的 sponsor，挂不上就 CANCELLED。
 *
 * 为什么必须有：`plan.sponsorRoom` 创建时定死，而候选房会重新挂靠（discovery 每轮重算
 * sponsor）。线上实测：一张 W37S56 的 Plan 仍挂着 `sr=W37S55`，而那间房已被我们主动放弃。
 * 执行侧对「sponsor 不存在」毫无防御 —— state-machine 的 submitClaimer 见
 * `Memory.rooms[sponsor]` 缺失就静默 return，claimer 永不入场，Plan 原地挂到
 * claimTimeout(6,000 tick) 才被撤；这期间它占着 MAX_ACTIVE_PLANS 名额并挡住新计划进场。
 *
 * 只动「还没交给执行层」的状态：EXECUTING 的 sponsor 语义已由状态机与超时负责，
 * 在这里改挂会让执行中的编队指向另一个房，那是更大的错。
 */
export function rehomePlanSponsors(
  plans: readonly ExpansionPlan[],
  ownedRoomNames: readonly string[],
  candidates: readonly { roomName: string; sponsorRoom: string }[],
  tick: number,
): ExpansionPlan[] {
  const owned = new Set(ownedRoomNames);
  const sponsorByRoom = new Map(candidates.map(c => [c.roomName, c.sponsorRoom]));
  return plans.map(plan => {
    if (owned.has(plan.sponsorRoom)) return plan;
    if (!PRE_EXECUTION_STATUSES.has(plan.status)) return plan;
    const alt = sponsorByRoom.get(plan.roomName);
    if (alt !== undefined && alt !== plan.sponsorRoom && owned.has(alt)) {
      return { ...plan, sponsorRoom: alt, updatedAt: tick };
    }
    return updatePlanStatus(plan, "CANCELLED", tick, "sponsor-lost");
  });
}

/** 尚未交给执行层的Plan状态（可安全改挂 sponsor）。 */
const PRE_EXECUTION_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "DISCOVERED",
  "EVALUATED",
  "READY",
  "APPROVED",
  "WAITING_EXECUTION",
]);

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
