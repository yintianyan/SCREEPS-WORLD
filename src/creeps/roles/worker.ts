/**
 * Worker — P0 恢复混合角色。
 *
 * 策略声明：
 *   acquire: getSource（含拥挤迁移，source 分配统一入口）> 拾取掉落能量
 *   work:    assignment target > critical repair > fillTarget > 升级
 *
 * 启动期和灾后恢复的最后防线。直接采集 + 填充，防止能量死锁。
 * source 分配不经 assignment 系统（P1-1）— 与 harvester 一致走 getSource 公平份额。
 *
 * P0 修复：worker 被 kernel.ts 计入 repairRooms（与 builder 并列），但原先 work 链
 * 无任何 repair action → tower-defense 误判"本房有维修 creep"而跳过全部非战斗维修，
 * 形成塔修死区。现在 worker 携带 repairCritical，名实相符。
 */
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
import { defineRole } from "../engine/role-runner";

/** 向 assignment 指定的 target 送能。 */
function fillAssignmentTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:assignment-target",
    resolve: (ac) => {
      if (!ac.assignment?.targetId) return undefined;
      const target = getObjectById(ac.assignment.targetId as Id<AnyOwnedStructure>);
      return target ?? undefined;
    },
    execute: (ac, t) => {
      const result = ac.creep.transfer(t, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, t);
      } else if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES) {
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
