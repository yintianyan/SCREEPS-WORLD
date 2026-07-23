/**
 * Worker — P0 恢复混合角色。
 *
 * 策略声明：
 *   acquire: getSource（含拥挤迁移，source 分配统一入口）> 拾取掉落能量
 *   work:    assignment target > fillTarget > 升级
 *
 * 启动期和灾后恢复的最后防线。直接采集 + 填充，防止能量死锁。
 * source 分配不经 assignment 系统（P1-1）— 与 harvester 一致走 getSource 公平份额。
 */
import type { Priority } from "../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "./action-types";
import {
  fillTarget,
  harvestSource,
  pickupDroppedEnergy,
  upgradeController,
} from "./actions";
import { moveToTarget } from "./movement";
import { getObjectById } from "./obj-cache";
import { defineRole } from "./role-runner";

/** 向 assignment 指定的 target 送能。 */
function fillAssignmentTarget(): ActionCandidate {
  return {
    name: "fill:assignment-target",
    predicate: (ac) => {
      if (!ac.assignment?.targetId) return false;
      return getObjectById(ac.assignment.targetId as Id<AnyOwnedStructure>) !== null;
    },
    execute: (ac) => {
      const target = getObjectById(ac.assignment!.targetId as Id<AnyOwnedStructure>)!;
      const result = ac.creep.transfer(target, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, target);
      } else if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES) {
        const used = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
        if (used === 0) ac.creep.memory.mode = "acquire";
      }
    },
  };
}

const policy: RolePolicy = {
  acquire: [
    // 拾取地上掉落能量（衰减资源，优先于采集）。
    pickupDroppedEnergy(),
    // 采集 — getSource 公平份额分配（含拥挤迁移），source 分配统一入口。
    harvestSource(),
  ],

  work: [
    // 优先使用 assignment 指定的 target。
    fillAssignmentTarget(),
    // 回退到最近 fillTarget。
    fillTarget(),
    // 无填充目标 — 升级。
    upgradeController(),
  ],
};

export const workerRole = defineRole("worker", 0 as Priority, policy);
