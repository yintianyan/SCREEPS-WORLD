/** Link 拆改计划管理（死资产检测 → 替代建造 → 验证 → 拆除）。 */
import type { DismantlePlan } from "../../kernel/global-cache";

/** 死资产判定阈值：source link 持续满足三重校验的 tick 数。 */
export const DEAD_ASSET_THRESHOLD = 500;

/** 拆改冷却：每房每 1000t 最多启动 1 个拆改计划。 */
export const DISMANTLE_COOLDOWN = 1000;

/** 拆改计划 ttl：1500t 未完成则 abort。 */
export const DISMANTLE_TTL = 1500;

/** 替代 link 灌能验证窗口。 */
export const DISMANTLE_VALIDATION_DELAY = 500;

/** link 几何受限重试间隔。 */
export const LINK_CONSTRAINED_RETRY_INTERVAL = 1000;

/**
 * 状态转移：waiting → validating（替代 link 建成后开始灌能验证）。
 * 纯函数，实际 cache 写入由调用方负责。
 */
export function transitionDismantlePlan(
  plan: DismantlePlan,
  tick: number,
): DismantlePlan {
  if (plan.state === "waiting") {
    return { ...plan, state: "validating", validatingSince: tick };
  }
  return plan;
}

/**
 * 检查房间是否处于拆改冷却期。
 */
export function isDismantleOnCooldown(
  lastDismantleTick: Map<string, number> | undefined,
  roomName: string,
  tick: number,
): boolean {
  const lastTick = lastDismantleTick?.get(roomName);
  if (lastTick === undefined) return false;
  return tick - lastTick < DISMANTLE_COOLDOWN;
}

/**
 * 检查房间是否处于 link 几何受限状态。
 */
export function isLinkConstrained(
  linkConstrained: Map<string, number> | undefined,
  roomName: string,
  tick: number,
): boolean {
  const since = linkConstrained?.get(roomName);
  if (since === undefined) return false;
  return tick - since < LINK_CONSTRAINED_RETRY_INTERVAL;
}

/**
 * 判定房间是否处于战时状态。
 * colonyState 由调用方从 Memory 读取后注入（domain 层禁止直读 Memory）。
 */
export function isRoomInDefense(colonyState: string | undefined): boolean {
  return colonyState === "defense";
}
