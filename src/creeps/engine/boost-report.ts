/** Boost 报到拦截 — 连接「boost 决策」与「boostCreep 执行」的就位环节。 */
import { globalCache } from "../../kernel/global-cache";
import { CONFIG } from "../../config";
import { isWithinBoostWindow } from "../../domain/industry/boost";
import { getObjectById } from "../support/obj-cache";
import { moveToTarget, registerAnchor } from "../movement";

/** 检查 creep 是否需要去 boost lab 报到。返回 true 表示本 tick 已被报到流程接管（移动或原地等待）。 */
export function interceptForBoost(creep: Creep): boolean {
  // 战时编队角色在 build 相位不受通用报到窗口限制（与请求生成共用
  // isWithinBoostWindow 口径）：war 前馈产化合物需数百 tick，固定窗口
  // 会让编队永远错过强化；编队集结本就是待命，去 lab 报到无机会成本。
  const warPlan = Memory.kernel?.warPlan;
  const warBuildPhase = warPlan?.phase === "build" &&
    creep.memory.remoteTarget === warPlan.targetRoom;
  if (!isWithinBoostWindow(creep.memory.role ?? "", creep.ticksToLive ?? 0, warBuildPhase)) return false;

  const assignments = globalCache().boostAssignments;
  if (!assignments || assignments.tick !== Game.time) return false;

  const entry = assignments.byCreep[creep.name];
  if (!entry) return false;
  // lab 化合物未就位 — 不去罚站（尤其 defender：威胁在场时等待即战力真空）。
  // supplyLabs 备料完成后的分配周期会重新给出 ready 标记。
  if (!entry.ready) return false;

  const lab = getObjectById(entry.labId as Id<StructureLab>);
  if (!lab) return false;

  if (creep.pos.getRangeTo(lab.pos) > 1) {
    moveToTarget(creep, lab);
  } else {
    // 已在 lab 旁 — 登记锚定，等待 boostCreep 期间不被过路 creep 推离工位。
    registerAnchor(creep, CONFIG.movement.trafficPriority.anchorStation);
  }
  // 已在 lab 旁 — 原地等待 lab-system 执行 boostCreep（化合物由 supplyLabs 补给）。
  return true;
}
