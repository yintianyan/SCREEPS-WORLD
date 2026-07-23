/**
 * Hauler — P1 物流角色。
 *
 * 策略声明：
 *   acquire: assignment container > 最满 container（限量）> storage（限量）
 *   work:    haul fillTarget（带 reservation）> storage > 待命
 *
 * hauler 没有 WORK 部件，不能采集或升级。无能量来源时 idle 等待。
 * 所有 sink 满时原地待命 — 供给 > 需求是正确信号，demand 系统会减少 hauler 孵化。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  fillStorage,
  haulFillTarget,
  haulMineralsToStorage,
  pickupDroppedEnergy,
  supplyLabs,
  withdrawCapped,
} from "../engine/actions";
import { findRichestContainer } from "../support/targeting";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";

/** 从 assignment 指定的 container 限量取能。 */
function withdrawAssignmentContainer(): ActionCandidate {
  return {
    name: "withdraw:assignment-container",
    predicate: (ac) => {
      if (!ac.assignment?.sourceId) return false;
      const obj = getObjectById(ac.assignment.sourceId as unknown as Id<StructureContainer>);
      return obj !== null && (obj as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const target = getObjectById(ac.assignment!.sourceId as unknown as Id<StructureContainer>) as StructureContainer;
      const available = target.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = ac.creep.withdraw(target, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, target);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** 从最满的非 controller container 限量取能。
 *
 * 禁止从 controller container 取能：hauler 的 work 链会向 controller container 倒能
 * （haulFillTarget 将低于半满的 controller container 列为最高优先级填充目标）。
 * 如果 acquire 链同时从 controller container 取能，会形成「取→倒→取→倒」振荡。
 */
function withdrawRichestCapped(): ActionCandidate {
  return withdrawCapped((ac: ActionContext) => {
    // 排除 controller container — 它是 hauler 的填充目标，不是取能来源。
    const candidates = ac.snapshot.controllerContainer
      ? ac.snapshot.containers.filter(c => c.id !== ac.snapshot.controllerContainer!.id)
      : ac.snapshot.containers;
    const best = findRichestContainer(candidates);
    if (!best || best.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
    return best;
  });
}

/** 从 storage 限量取能（RCL4+ 回退）。 */
function withdrawStorageCapped(): ActionCandidate {
  return withdrawCapped((ac: ActionContext) => {
    const st = ac.snapshot.storage;
    if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
    return st;
  });
}

const policy: RolePolicy = {
  acquire: [
    // 0. 拾取地上掉落能量 — 衰减资源，最高优先回收。
    pickupDroppedEnergy(),
    // 优先使用 assignment 指定的 container。
    withdrawAssignmentContainer(),
    // 回退到最满 container。
    withdrawRichestCapped(),
    // RCL4+ 回退到 storage。
    withdrawStorageCapped(),
  ],

  work: [
    // 矿物优先搬运（高价值资源不应滞留在 container）。
    haulMineralsToStorage(),
    // 带 reservation 去重的优先级填充。
    haulFillTarget(),
    // 化合物供料到 lab。
    supplyLabs(),
    // spawn/extension 全满 — 送 storage。
    fillStorage(),
    // 所有 sink 均满 — 原地待命。
    // hauler 无 WORK 部件，不能升级控制器（upgradeController 会 ERR_NO_BODYPART）。
    // 空闲是正确信号：供给 > 需求，demand 系统会据此减少 hauler 孵化数量。
    // 下一 tick sink 释放容量后自然恢复填充。
  ],
};

export const haulerRole = defineRole("hauler", 1 as Priority, policy);
