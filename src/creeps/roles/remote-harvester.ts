/**
 * RemoteHarvester — P1 远矿采集者。
 *
 * 职责：在远矿房采集 source，将能量倒入附近 container（或 drop 在地上）。
 * 与本地 harvester 的区别：
 *   - 工作在 remoteTarget 房间（无 RoomSnapshot）
 *   - 通过 Game.rooms[remoteTarget] 直接发现 source（首次 find 后缓存 sourceId）
 *   - 倒能优先 container，无 container 时 drop（避免采满停滞）
 *
 * 策略声明：
 *   acquire: 远矿 source 采集（站桩 + 倒能）
 *   work:    倒入 container > drop（采满无处倒时释放产能）
 *
 * 架构约束：ensureHome 已适配 remoteTarget，本角色常驻 remoteTarget 房间。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";

/**
 * 获取远矿 source — 从缓存的 sourceId 或直接 find。
 * 首次进入远矿房时执行一次 room.find，之后复用 sourceId。
 */
function getRemoteSource(creep: Creep): Source | undefined {
  // 优先使用缓存的 sourceId。
  if (creep.memory.sourceId) {
    const source = getObjectById(creep.memory.sourceId);
    if (source) return source;
    // source 消失（如 SK 房 source 被占领），清除缓存。
    creep.memory.sourceId = undefined;
  }

  // 首次或缓存失效：从当前房间 find source。
  const room = creep.room;
  const sources = room.find(FIND_SOURCES);
  if (sources.length === 0) return undefined;

  // 选最近的 source（远矿房通常 2 个 source，选近的减少通勤）。
  let best = sources[0]!;
  let bestDist = creep.pos.getRangeTo(best);
  for (let i = 1; i < sources.length; i++) {
    const dist = creep.pos.getRangeTo(sources[i]!);
    if (dist < bestDist) {
      best = sources[i]!;
      bestDist = dist;
    }
  }
  creep.memory.sourceId = best.id;
  return best;
}

/**
 * 查找 source 旁的 container（range <= 1）。
 *
 * P2 优化：缓存 containerId 到 creep.memory.sourceContainerId，
 * 避免每 tick 调用 lookForAtArea（0.05-0.1 CPU/次）。
 * 缓存失效条件：container 被摧毁（getObjectById 返回 null）。
 */
function findSourceContainer(creep: Creep, source: Source): StructureContainer | undefined {
  // 优先使用缓存的 containerId。
  if (creep.memory.sourceContainerId) {
    const cached = getObjectById(creep.memory.sourceContainerId as Id<StructureContainer>);
    if (cached) {
      // 验证仍在 source 旁（防御性：container 可能被回收后在别处重建）。
      if (cached.pos.getRangeTo(source.pos) <= 1) return cached;
    }
    // 缓存失效 — 清除并重新扫描。
    creep.memory.sourceContainerId = undefined;
  }

  // 首次或缓存失效：lookForAtArea 扫描 source 周围 3x3 区域。
  const structures = creep.room.lookForAtArea(
    LOOK_STRUCTURES,
    Math.max(0, source.pos.y - 1),
    Math.max(0, source.pos.x - 1),
    Math.min(49, source.pos.y + 1),
    Math.min(49, source.pos.x + 1),
    true,
  );
  for (const entry of structures) {
    if (entry.structure.structureType === STRUCTURE_CONTAINER) {
      const container = entry.structure as StructureContainer;
      // 缓存 containerId，后续 tick 直接用 getObjectById 取回。
      creep.memory.sourceContainerId = container.id as Id<StructureContainer>;
      return container;
    }
  }
  return undefined;
}

/** 远矿采集 + 站桩倒能。 */
function remoteStationaryMine(): ActionCandidate<Source> {
  return {
    name: "remote-harvest:stationary-mine",
    resolve: (ac) => {
      const source = getRemoteSource(ac.creep);
      if (!source) return undefined;
      // 检查是否在采集范围内。
      if (ac.creep.pos.getRangeTo(source) > 1) return undefined;
      return source;
    },
    execute: (ac, source) => {
      // 采集。
      const harvestResult = ac.creep.harvest(source);
      if (harvestResult === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, source);
        return;
      }
      // 同 tick 倒能：如果背包有能量且旁边有 container，倒入 container。
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        const container = findSourceContainer(ac.creep, source);
        if (container) {
          const freeCap = container.store.getFreeCapacity(RESOURCE_ENERGY);
          if (freeCap > 0) {
            ac.creep.transfer(container, RESOURCE_ENERGY);
          }
        }
      }
    },
  };
}

/** 移动到 source 并采集（未到达站桩位时）。 */
function remoteHarvestSource(): ActionCandidate<Source> {
  return {
    name: "remote-harvest:move-and-mine",
    resolve: (ac) => getRemoteSource(ac.creep),
    execute: (ac, source) => {
      const result = ac.creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, source);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** dropEnergy 的 resolve 返回类型。 */
type DropEnergyTarget =
  | { type: "transfer"; container: StructureContainer }
  | { type: "drop" };

/** 采满且无 container 时 drop 能量（避免产能停滞）。 */
function dropEnergy(): ActionCandidate<DropEnergyTarget> {
  return {
    name: "remote-harvest:drop",
    resolve: (ac) => {
      if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return undefined;
      // 检查旁边是否有 container 可倒入。
      const source = getRemoteSource(ac.creep);
      if (source) {
        const container = findSourceContainer(ac.creep, source);
        if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          return { type: "transfer" as const, container };
        }
      }
      // 无 container 或 container 满 → drop
      return { type: "drop" as const };
    },
    execute: (ac, resolved) => {
      if (resolved.type === "transfer") {
        ac.creep.transfer(resolved.container, RESOURCE_ENERGY);
      } else {
        ac.creep.drop(RESOURCE_ENERGY);
      }
    },
  };
}

const policy: RolePolicy = {
  acquire: [
    // 站桩采集 + 同 tick 倒能（到达矿位后）。
    remoteStationaryMine(),
    // 移动到 source 并采集（通勤中）。
    remoteHarvestSource(),
  ],
  work: [
    // 站桩采集 + 同 tick 倒能（work 模式也继续采）。
    remoteStationaryMine(),
    // 采满无处倒 → drop 释放产能。
    dropEnergy(),
  ],
};

export const remoteHarvesterRole = defineRole("remoteHarvester", 1 as Priority, policy);
