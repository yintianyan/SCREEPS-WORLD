/** Worker */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import {
  fillTarget,
  harvestSource,
  pickupDroppedEnergy,
  repairCritical,
  upgradeController,
} from "../engine/actions";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";
import { releaseAssignment } from "../support";
import { defineRole } from "../engine/role-runner";

/** 向 assignment 指定的 target 送能。 */
function fillAssignmentTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:assignment-target",
    resolve: (ac) => {
      if (!ac.assignment?.targetId) return undefined;
      const target = getObjectById(ac.assignment.targetId as Id<AnyOwnedStructure>);
      if (!target) return undefined;
      // W-1 修复：目标已满时释放 assignment 并返回 undefined，
      // 放行 work 链 fallthrough（repairCritical / fillTarget / upgradeController）。
      // 原先容量检查缺失 → 携能 worker 对满目标每 tick transfer 得 ERR_FULL，
      // execute 已被调用即终止候选链 — 携能活锁，能量冻结在背包里。
      // 资格检查前置到 resolve 是唯一放行闸门（EN-1 公理）。
      const store = (target as AnyStoreStructure).store;
      if (store && store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        releaseAssignment(ac.creep);
        return undefined;
      }
      return target;
    },
    execute: (ac, t) => {
      const result = ac.creep.transfer(t, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, t);
      } else if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES) {
        // 残余竞态防护：同 tick 他人抢先填满 — 空载时切回 acquire。
        const used = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
        if (used === 0) ac.creep.memory.mode = "acquire";
      }
    },
  };
}

const policy: RolePolicy = {
  park: true,
  acquire: [
    // 拾取地上掉落能量（衰减资源，优先于采集）。
    pickupDroppedEnergy(),
    // 采集 — getSource 公平份额分配（含拥挤迁移），source 分配统一入口。
    harvestSource(),
  ],

  work: [
    // 优先使用 assignment 指定的 target。
    fillAssignmentTarget(),
    // 紧急：修复血量 < 50% 的关键结构（spawn/tower/extension/container）。
    // P0 修复：worker 被 kernel 计入 repairRooms，必须有实际 repair action 才名副其实。
    // 优先于 fill — 结构快塌了比填能量更紧急。
    repairCritical(),
    // 回退到最近 fillTarget。
    fillTarget(),
    // 无填充目标 — 升级。
    upgradeController(),
  ],
};

export const workerRole = defineRole("worker", 0 as Priority, policy);
