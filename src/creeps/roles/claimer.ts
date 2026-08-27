/** Claimer */
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
