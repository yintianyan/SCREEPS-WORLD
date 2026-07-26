/**
 * Boost 报到拦截 — 连接「boost 决策」与「boostCreep 执行」的就位环节。
 *
 * 数据流：lab-system（P1 系统，先于角色运行）每 tick 把「creep → boost lab」
 * 分配写入 globalCache.boostAssignments；role-runner 在角色管线早段调用本函数，
 * 命中分配的新生 creep 被引导到 lab 旁并原地等待，lab-system 在相邻时执行
 * lab.boostCreep（该 API 要求 creep 与 lab 相邻）。
 *
 * 自限性防呆：拦截仅在报到窗口内生效（ticksToLive > BOOST_REPORT_TTL，
 * 与请求生成共用同一阈值）。窗口一过，请求端不再生成、拦截端自动放行，
 * creep 转入正常工作 — 即使化合物迟迟不到位也不会在 lab 旁永久罚站。
 */
import { globalCache } from "../../kernel/global-cache";
import { BOOST_REPORT_TTL } from "../../domain/industry/boost";
import { getObjectById } from "../support/obj-cache";
import { moveToTarget } from "../movement";

/**
 * 检查 creep 是否需要去 boost lab 报到。
 * 返回 true 表示本 tick 已被报到流程接管（移动或原地等待），角色管线应直接返回。
 */
export function interceptForBoost(creep: Creep): boolean {
  // 报到窗口已过 — 放行去干活。
  if ((creep.ticksToLive ?? 0) <= BOOST_REPORT_TTL) return false;

  const assignments = globalCache().boostAssignments;
  if (!assignments || assignments.tick !== Game.time) return false;

  const labId = assignments.byCreep[creep.name];
  if (!labId) return false;

  const lab = getObjectById(labId as Id<StructureLab>);
  if (!lab) return false;

  if (creep.pos.getRangeTo(lab.pos) > 1) {
    moveToTarget(creep, lab);
  }
  // 已在 lab 旁 — 原地等待 lab-system 执行 boostCreep（化合物由 supplyLabs 补给）。
  return true;
}
