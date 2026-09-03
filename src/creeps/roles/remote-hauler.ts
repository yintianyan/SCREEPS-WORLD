/** RemoteHauler */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  fillStorage,
  haulFillTarget,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";
import { findRemoteContainersCached, findDroppedEnergyCached, findRuinsCached, findTombstonesCached } from "../support/room-scans";

/** container 选择的距离权重（与本地 HAUL_CONTAINER_DISTANCE_WEIGHT 一致）：
 * 每格距离折算 10 能量。满溢的远 container 仍优先于近乎空的近 container。 */
const REMOTE_CONTAINER_DISTANCE_WEIGHT = 10;

/** 从远矿 container 取能。 */
function withdrawRemoteContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "remote-hauler:withdraw-container",
    resolve: (ac) => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      return findRemoteContainer(ac.creep);
    },
    execute: (ac, container) => {
      const available = container.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      if (amount <= 0) return;
      const result = ac.creep.withdraw(container, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, container);
      }
    },
  };
}

/** 从远矿房坟墓/废墟中提取遗留能量。
 * 坟墓/废墟不能用 pickup，必须用 withdraw。远矿房 creep 死亡后留下坟墓，
 * 坟墓在 5 tick 后消失，能量随之灭失——应优先于 container 回收（container 不衰减）。 */
function lootRemoteRemains(): ActionCandidate<Tombstone | Ruin> {
  return {
    name: "remote-hauler:loot-remains",
    resolve: (ac) => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      const candidates: (Tombstone | Ruin)[] = [];
      for (const t of findTombstonesCached(ac.creep.room)) {
        if (t.store.getUsedCapacity(RESOURCE_ENERGY) > 0) candidates.push(t);
      }
      for (const r of findRuinsCached(ac.creep.room)) {
        if (r.store.getUsedCapacity(RESOURCE_ENERGY) > 0) candidates.push(r);
      }
      if (candidates.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(candidates) ?? candidates[0];
    },
    execute: (ac, remains) => {
      const available = remains.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      if (amount <= 0) return;
      const result = ac.creep.withdraw(remains, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, remains);
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
 * 第一层 per-creep：remoteContainerId 仍有能量时直接复用。
 * 第二层 per-tick per-room 共享：container 空窗期内若无共享缓存，每只 remoteHauler 每 tick
 * 各自全房 FIND_STRUCTURES，违反「角色禁止全房 find」硬约束（与 findDroppedEnergy 同一模式）。
 * 导出仅供接线测试验证共享缓存行为。 */
export function findRemoteContainer(creep: Creep): StructureContainer | undefined {
  // 优先使用缓存的 containerId — 避免每 tick find。
  if (creep.memory.remoteContainerId) {
    const cached = getObjectById(creep.memory.remoteContainerId as Id<StructureContainer>);
    if (cached && cached.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      return cached;
    }
    // 缓存失效 — container 被摧毁或空了，清除并重新 find。
    creep.memory.remoteContainerId = undefined;
  }

  // 首次或缓存失效：走 per-tick per-room 共享列表（同房多 hauler 一次 find）。
  const containers = findRemoteContainersCached(creep.room).filter(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  if (containers.length === 0) return undefined;

  // 加权分散（E-2 修复）：原纯 findClosestByRange 在 2-source 房（两 container）会让所有 hauler
  // 挤最近那个、远 container 积压溢出（羊群）。改为「能量 - 距离×权重」打分 + 名哈希起点散布，
  // 照本地 selectHaulSourceContainer 的已验证手法。
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

 * 掉落资源列表走 per-tick per-room 缓存：远矿房无 RoomSnapshot 预热，
 * 若每 tick 直接 room.find，container 空档期内 acquire 链每 tick 都会全房扫描，
 * 违反「角色禁止全房 find」硬约束。缓存生命周期单 tick，同房多 hauler 共享。
 */
function findDroppedEnergy(creep: Creep): Resource | undefined {
  const resources = findDroppedEnergyCached(creep.room);
  if (resources.length === 0) return undefined;
  return creep.pos.findClosestByRange(resources) ?? resources[0];
}

const policy: RolePolicy = {
  park: true,
  // P2-M：原 role-runner 硬编码 `role === "remoteHauler" && mode === "work" && room === home`
  //   下沉为角色钩子。work 在 home 房无候选时切 idle（ensureHome 保持在家）；
  //   acquire 在 home 房不切 idle（保持 acquire mode，ensureHome 导航去 remoteTarget）。
  shouldIdleWhenNoCandidate: (ac) => {
    const c = ac.creep;
    return c.memory.mode === "work" && c.room.name === c.memory.home;
  },
  acquire: [
    // 衰减资源优先回收：坟墓/废墟中的能量会随时间灭失，而 container 中的能量不衰减。
    // 与本地 hauler 设计一致——大额遗留优先于 container 取能。
    lootRemoteRemains(),
    // 地上掉落能量（remoteHarvester 溢出 drop 的）——同样在衰减，优先于 container。
    pickupRemoteDropped(),
    // 从 container 取能（不衰减，可延后）。
    withdrawRemoteContainer(),
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
