/** Carrier */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { bumpEnergyCounter } from "../../kernel/global-cache";

/** 从 home 房 storage 取能（carrier acquire 链唯一动作）。 */
function withdrawSourceStorage(): ActionCandidate<StructureStorage> {
  return {
    name: "carrier:withdraw-storage",
    resolve: ac => {
      // 仅在 home 房执行取能（ensureHome 保证 acquire mode 已导航回 home）。
      if (ac.creep.room.name !== ac.creep.memory.home) return undefined;
      const storage = ac.creep.room.storage;
      if (!storage) return undefined;
      if (storage.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return storage;
    },
    execute: (ac, storage) => {
      const available = storage.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      if (amount <= 0) return;
      const result = ac.creep.withdraw(storage, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, storage);
      }
    },
  };
}

/** 在 target 房 storage 卸能（carrier work 链唯一动作）。 */
function transferTargetStorage(): ActionCandidate<StructureStorage> {
  return {
    name: "carrier:transfer-storage",
    resolve: ac => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget) return undefined;
      // 仅在 target 房执行卸能（ensureHome 保证 work mode 已导航到 remoteTarget）。
      if (ac.creep.room.name !== remoteTarget) return undefined;
      const storage = ac.creep.room.storage;
      if (!storage) return undefined;
      if (storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return storage;
    },
    execute: (ac, storage) => {
      const carryUsed = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
      if (carryUsed <= 0) return;
      const free = storage.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(carryUsed, free);
      const result = ac.creep.transfer(storage, RESOURCE_ENERGY, amount);
      if (result === OK) {
        // 两侧同一拍成对入账（债单 #42 下半场 / #59）：收端按「目标池所在房」记 imported，
        // 发端按「背包出发的那间房」记 exported。取能时刻不记 —— storage→carry 两头都在同一房的
        // tracked 池里，先记 exported 会把"满载但还没出门"（线上实测过停滞形态）当成已发出。
        bumpEnergyCounter(ac.creep.room.name, "imported", amount);
        const source = ac.creep.memory.home;
        if (source !== undefined && source !== ac.creep.room.name) {
          bumpEnergyCounter(source, "exported", amount);
        }
      } else if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, storage);
      }
    },
  };
}

/**
 * Carrier 专属 gate：背包满切 work，背包空切 acquire。
 * 不使用 assignment 任务池 — carrier 由 operationId 直接驱动。
 */
function carrierGate(ac: ActionContext): boolean {
  const creep = ac.creep;
  const carryUsed = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const carryFree = creep.store.getFreeCapacity(RESOURCE_ENERGY);

  // 模式切换：满载 → work，空载 → acquire
  if (carryUsed > 0 && carryFree === 0) {
    creep.memory.mode = "work";
  } else if (carryUsed === 0 && creep.memory.mode !== "acquire") {
    creep.memory.mode = "acquire";
  }

  return true;
}

const policy: RolePolicy = {
  park: true,
  gate: carrierGate,
  // 仅当已站在「该在的房间」才允许无候选切 idle。恒 true 会造成满载停滞死锁：
  // work 候选在非目标房失败 → 切 idle → 下一 tick ensureHome 把 mode=idle 的 carrier
  // 判定「回 home」（已在家，直接放行）→ updateMode 翻回 work → 候选再失败 → 再 idle
  // —— 跨房导航只发生在 ensureHome 返回 false 的 tick，而 mode 总在导航前被打回 idle
  // （线上实证：6 只 1200/1200 满载 carrier 停在出生区耗完整段寿命）。
  shouldIdleWhenNoCandidate: ac => {
    const creep = ac.creep;
    const dest = creep.memory.mode === "work" ? creep.memory.remoteTarget : creep.memory.home;
    return creep.room.name === dest;
  },
  acquire: [
    // 从 home 房 storage 取能。
    withdrawSourceStorage(),
    // 无 storage 或 storage 空 — idle（ensureHome 保持在 home 房等待）。
  ],
  work: [
    // 在 target 房 storage 卸能。
    transferTargetStorage(),
    // storage 满或无 storage — idle（ensureHome 保持在 target 房等待）。
  ],
};

export const carrierRole = defineRole("carrier", 1 as Priority, policy);
