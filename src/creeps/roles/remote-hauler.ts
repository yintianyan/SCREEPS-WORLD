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
import { globalCache } from "../../kernel/global-cache";

/** container 选择的距离权重（与本地 HAUL_CONTAINER_DISTANCE_WEIGHT 一致）：
 * 每格距离折算 10 能量。满溢的远 container 仍优先于近乎空的近 container。 */
const REMOTE_CONTAINER_DISTANCE_WEIGHT = 10;

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

/** 在远矿房查找有能量的 container（双层缓存避免每 tick find）。
 *
 * 第一层 per-creep：remoteContainerId 仍有能量时直接复用。
 * 第二层 per-tick per-room 共享：container 空窗期内，若无共享缓存，
 * 每只 remoteHauler 每 tick 会各自全房 FIND_STRUCTURES，
 * 违反「角色禁止全房 find」硬约束（与 findDroppedEnergy 同一约束、同一模式）。
 * 导出仅供接线测试验证共享缓存行为。
 */
export function findRemoteContainer(creep: Creep): StructureContainer | undefined {
  // 优先使用缓存的 containerId — 避免每 tick room.find。
  if (creep.memory.remoteContainerId) {
    const cached = Game.getObjectById(creep.memory.remoteContainerId as Id<StructureContainer>);
    if (cached && cached.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      return cached;
    }
    // 缓存失效 — container 被摧毁或空了，清除并重新 find。
    creep.memory.remoteContainerId = undefined;
  }

  // 首次或缓存失效：走 per-tick per-room 共享列表（同房多 hauler 一次 find）。
  const g = globalCache() as { __remoteContainers?: Record<string, { tick: number; list: StructureContainer[] }> };
  if (!g.__remoteContainers) g.__remoteContainers = {};
  const roomCached = g.__remoteContainers[creep.room.name];
  let containers: StructureContainer[];
  if (roomCached && roomCached.tick === Game.time) {
    containers = roomCached.list;
  } else {
    containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    }) as StructureContainer[];
    g.__remoteContainers[creep.room.name] = { tick: Game.time, list: containers };
  }
  if (containers.length === 0) return undefined;

  // 加权分散（E-2 修复）：原纯 findClosestByRange 在 2-source 房（两 container）
  // 会让所有 hauler 挤最近那个、远 container 积压溢出（羊群）。改为"能量 - 距离×权重"
  // 打分 + 名哈希起点散布，照本地 selectHaulSourceContainer 的已验证手法。
  let nameHash = 0;
  for (let i = 0; i < creep.name.length; i++) {
    nameHash = (nameHash * 31 + creep.name.charCodeAt(i)) | 0;
  }
  const offset = Math.abs(nameHash) % containers.length;
  let best = containers[offset]!;
  let bestScore = -Infinity;
  for (let i = 0; i < containers.length; i++) {
    const c = containers[(offset + i) % containers.length]!;
    const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
    const score = energy - creep.pos.getRangeTo(c) * REMOTE_CONTAINER_DISTANCE_WEIGHT;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // 缓存 containerId，后续 tick 直接用 getObjectById 取回。
  creep.memory.remoteContainerId = best.id as Id<StructureContainer>;
  return best;
}

/** 在远矿房查找最近的掉落能量。
 *
 * 掉落资源列表走 per-tick per-room 缓存：远矿房无 RoomSnapshot 预热，
 * 若每 tick 直接 room.find，container 空档期内 acquire 链每 tick 都会全房扫描，
 * 违反「角色禁止全房 find」硬约束。缓存生命周期单 tick，同房多 hauler 共享。
 */
function findDroppedEnergy(creep: Creep): Resource | undefined {
  const g = globalCache() as { __remoteDropped?: Record<string, { tick: number; list: Resource[] }> };
  if (!g.__remoteDropped) g.__remoteDropped = {};
  const cached = g.__remoteDropped[creep.room.name];
  let resources: Resource[];
  if (cached && cached.tick === Game.time) {
    resources = cached.list;
  } else {
    resources = creep.room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY,
    });
    g.__remoteDropped[creep.room.name] = { tick: Game.time, list: resources };
  }
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
