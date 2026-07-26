/**
 * RemoteHauler — P1 远矿穿梭搬运工。
 *
 * 职责：从远矿房 container 取能，搬运回 home 房存入 storage/sink。
 * 与本地 hauler 的区别：
 *   - acquire 在 remoteTarget 房间取能（无 snapshot，直接 Game.rooms 访问）
 *   - work 在 home 房间存能（有 snapshot，复用本地 hauler 的 fillStorage/haulFillTarget）
 *   - ensureHome 根据 mode 自动切换导航目标（acquire→remote, work→home）
 *
 * 策略声明：
 *   acquire: 远矿 container 取能 > 远矿 drop 能量拾取
 *   work:    storage 填充 > spawn/extension 直送 > 待命
 *
 * 架构约束：ensureHome 已适配 remoteHauler 的穿梭行为。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  fillStorage,
  haulFillTarget,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";

/** 从远矿 container 取能。 */
function withdrawRemoteContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "remote-hauler:withdraw-container",
    resolve: (ac) => {
      // 只在 remoteTarget 房间内执行（ensureHome 保证已到达）。
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      return findRemoteContainer(ac.creep);
    },
    execute: (ac, container) => {
      const available = container.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      if (amount <= 0) {
        // container 空了 → 检查地上是否有 drop 的能量。
        const dropped = findDroppedEnergy(ac.creep);
        if (dropped) {
          const result = ac.creep.pickup(dropped);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(ac.creep, dropped);
          }
        }
        return;
      }
      const result = ac.creep.withdraw(container, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, container);
      }
    },
  };
}

/** 拾取远矿房地上掉落的能量（remoteHarvester drop 的）。 */
function pickupRemoteDropped(): ActionCandidate<Resource> {
  return {
    name: "remote-hauler:pickup-dropped",
    resolve: (ac) => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      return findDroppedEnergy(ac.creep);
    },
    execute: (ac, dropped) => {
      const result = ac.creep.pickup(dropped);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, dropped);
      }
    },
  };
}

/** 在远矿房查找有能量的 container（缓存 containerId 避免每 tick find）。 */
function findRemoteContainer(creep: Creep): StructureContainer | undefined {
  // 优先使用缓存的 containerId — 避免每 tick room.find。
  if (creep.memory.remoteContainerId) {
    const cached = Game.getObjectById(creep.memory.remoteContainerId as Id<StructureContainer>);
    if (cached && cached.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      return cached;
    }
    // 缓存失效 — container 被摧毁或空了，清除并重新 find。
    creep.memory.remoteContainerId = undefined;
  }

  // 首次或缓存失效：find 有能量的 container。
  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureContainer[];
  if (containers.length === 0) return undefined;

  const closest = (creep.pos.findClosestByRange(containers) ?? containers[0])!;
  // 缓存 containerId，后续 tick 直接用 getObjectById 取回。
  creep.memory.remoteContainerId = closest.id as Id<StructureContainer>;
  return closest;
}

/** 在远矿房查找最近的掉落能量。 */
function findDroppedEnergy(creep: Creep): Resource | undefined {
  const resources = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: (r) => r.resourceType === RESOURCE_ENERGY,
  });
  if (resources.length === 0) return undefined;
  return creep.pos.findClosestByRange(resources) ?? resources[0];
}

const policy: RolePolicy = {
  park: true,
  acquire: [
    // 优先从 container 取能。
    withdrawRemoteContainer(),
    // 回退：拾取地上 drop 的能量。
    pickupRemoteDropped(),
  ],
  work: [
    // 存入 storage（RCL4+）。
    fillStorage(),
    // 回退：直送 spawn/extension。
    haulFillTarget(),
    // 所有 sink 满 — 待命（ensureHome 会导航回 home，parkIdleCreep 归位）。
  ],
};

export const remoteHaulerRole = defineRole("remoteHauler", 1 as Priority, policy);
