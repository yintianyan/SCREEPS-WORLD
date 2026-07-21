/**
 * Worker — P0 恢复混合角色。
 *
 * 策略声明：
 *   acquire: assignment source > getSource（含拥挤迁移）
 *   work:    assignment target > fillTarget > 升级
 *
 * 启动期和灾后恢复的最后防线。直接采集 + 填充，防止能量死锁。
 */
import type { Priority } from "../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "./action-types";
import {
  fillTarget,
  harvestSource,
  upgradeController,
} from "./actions";
import { moveToTarget } from "./movement";
import { getSource } from "./targeting";
import { defineRole } from "./role-runner";

/** 使用 assignment 指定的 source 采集。 */
function harvestAssignmentSource(): ActionCandidate {
  return {
    name: "harvest:assignment-source",
    predicate: (ac) => {
      if (!ac.assignment?.sourceId) return false;
      return Game.getObjectById(ac.assignment.sourceId) !== null;
    },
    execute: (ac) => {
      const source = Game.getObjectById(ac.assignment!.sourceId!)!;
      ac.creep.memory.sourceId = ac.assignment!.sourceId as Id<Source>;
      const result = ac.creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, source);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** 向 assignment 指定的 target 送能。 */
function fillAssignmentTarget(): ActionCandidate {
  return {
    name: "fill:assignment-target",
    predicate: (ac) => {
      if (!ac.assignment?.targetId) return false;
      return Game.getObjectById(ac.assignment.targetId as Id<AnyOwnedStructure>) !== null;
    },
    execute: (ac) => {
      const target = Game.getObjectById(ac.assignment!.targetId as Id<AnyOwnedStructure>)!;
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
    // 优先使用 assignment 指定的 source。
    harvestAssignmentSource(),
    // 回退到 getSource（含拥挤迁移）。
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
