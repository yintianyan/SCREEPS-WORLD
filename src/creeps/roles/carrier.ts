/** Carrier */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";

/** 从 home 房 storage 取能（carrier acquire 链唯一动作）。 */
function withdrawSourceStorage(): ActionCandidate<StructureStorage> {
  return {
    name: "carrier:withdraw-storage",
    resolve: (ac) => {
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
    resolve: (ac) => {
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
      if (result === ERR_NOT_IN_RANGE) {
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
  shouldIdleWhenNoCandidate: () => true,
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
