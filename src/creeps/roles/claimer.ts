/**
 * Claimer — P2 扩张占领角色。
 *
 * 职责：由 expansion-manager 派遣（memory.remoteTarget = 扩张目标房），
 * 走到目标房 controller 旁执行 claimController。占领成功后使命完成 —
 * CLAIM 部件 creep 寿命仅 600 tick，原地待机自然到期，不做回收长途跋涉。
 *
 * 与 reserver 的区别：reserver 续期远矿房预定（可反复），claimer 是一次性
 * 占领投送；两者共用 remoteTarget 导航栈（ensureHome 处理跨房通勤）。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { moveToTarget } from "../movement";
import { defineRole } from "../engine/role-runner";

/** 占领目标房 controller。 */
function claimControllerAction(): ActionCandidate<StructureController> {
  return {
    name: "claimer:claim-controller",
    resolve: (ac) => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      const controller = ac.creep.room.controller;
      if (!controller || controller.my) return undefined; // 已占领 — 使命完成。
      return controller;
    },
    execute: (ac, controller) => {
      const result = ac.creep.claimController(controller);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, controller);
      }
      // ERR_GCL_NOT_ENOUGH / ERR_INVALID_TARGET（被抢占）等由
      // expansion-manager 的超时废弃路径兜底，不在角色层重试决策。
    },
  };
}

const policy: RolePolicy = {
  acquire: [
    claimControllerAction(),
  ],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    claimControllerAction(),
  ],
};

export const claimerRole = defineRole("claimer", 2 as Priority, policy);
