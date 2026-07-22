/**
 * Hauler — P1 物流角色。
 *
 * 策略声明：
 *   acquire: assignment container > 最满 container（限量）> storage（限量）
 *   work:    haul fillTarget（带 reservation）> storage > 升级
 *
 * hauler 没有 WORK 部件，不能采集。无能量来源时 idle 等待。
 */
import type { Priority } from "../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "./action-types";
import {
  fillStorage,
  haulFillTarget,
  haulMineralsToStorage,
  pickupDroppedEnergy,
  supplyLabs,
  upgradeController,
  withdrawCapped,
} from "./actions";
import { findRichestContainer } from "./targeting";
import { defineRole } from "./role-runner";
import { moveToTarget } from "./movement";

/** 从 assignment 指定的 container 限量取能。 */
function withdrawAssignmentContainer(): ActionCandidate {
  return {
    name: "withdraw:assignment-container",
    predicate: (ac) => {
      if (!ac.assignment?.sourceId) return false;
      const obj = Game.getObjectById(ac.assignment.sourceId as unknown as Id<StructureContainer>);
      return obj !== null && (obj as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const target = Game.getObjectById(ac.assignment!.sourceId as unknown as Id<StructureContainer>) as StructureContainer;
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

/** 从最满 container 限量取能。 */
function withdrawRichestCapped(): ActionCandidate {
  return withdrawCapped((ac: ActionContext) => {
    const best = findRichestContainer(ac.snapshot.containers);
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
    // 无处填充 — 升级。
    upgradeController(),
  ],
};

export const haulerRole = defineRole("hauler", 1 as Priority, policy);
