import { CONFIG } from "../config";
import type { RoomSnapshot } from "../kernel/contracts";

/** 将 RoomPosition 压缩为单个数字：x * 50 + y。 */
export function packPos(pos: RoomPosition): number {
  return pos.x * 50 + pos.y;
}

/**
 * 确保 creep 已设置 home 房间；不在 home 时尝试向 home 方向移动。
 * 只有 creep 实际在 home 房间内时才返回 true，
 * 避免跨房目标导致 moveTo(maxRooms:1) 永远无法到达。
 */
export function ensureHome(creep: Creep): boolean {
  if (!creep.memory.home) {
    creep.memory.home = creep.room.name;
  }
  const home = creep.memory.home;
  // 只有在 home 房间内才返回 true。
  if (creep.room.name === home) return true;
  // 不在 home — 向 home 方向移动到出口。
  moveTowardRoom(creep, home);
  return false;
}

/** 向目标房间方向移动（通过最近出口）。 */
export function moveTowardRoom(creep: Creep, targetRoom: string): void {
  const exitDir = creep.room.findExitTo(targetRoom) as number;
  if (exitDir < 0) return; // 错误码为负值
  const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
  if (exit) {
    creep.moveTo(exit, { reusePath: 10 });
  }
}

/** 根据能量存储更新 creep 模式。仅在阈值跨越时写入。 */
export function updateMode(creep: Creep): void {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const mode = creep.memory.mode ?? "acquire";

  if (mode === "acquire" && free === 0) {
    creep.memory.mode = "work";
  } else if (mode === "work" && used === 0) {
    creep.memory.mode = "acquire";
  } else if (!creep.memory.mode) {
    creep.memory.mode = used > 0 ? "work" : "acquire";
  }
}

/** 获取或分配 creep 的 source。将 sourceId 存入 memory。 */
export function getSource(creep: Creep, snapshot: RoomSnapshot): Source | undefined {
  // 先尝试缓存的 source。
  if (creep.memory.sourceId) {
    const source = Game.getObjectById(creep.memory.sourceId);
    if (source) return source;
    // source 消失 — 清除并重新分配。
    creep.memory.sourceId = undefined;
  }

  // 使用快照数据分配占用最少的 source（无需全局扫描）。
  let best: Source | undefined;
  let bestCount = Infinity;
  for (const source of snapshot.sources) {
    const count = snapshot.sourceOccupancy.get(source.id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = source;
    }
  }

  if (best) {
    creep.memory.sourceId = best.id;
  }
  return best;
}

/**
 * 查找最近的需能量结构（有空闲容量的 spawn 或 extension）。
 * 使用引擎原生 findClosestByRange 替代手动迭代。
 */
export function getFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;
  return creep.pos.findClosestByRange(snapshot.fillTargets as AnyOwnedStructure[]) ?? undefined;
}

/** 找到能量最多的 container。 */
export function findRichestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestEnergy = 0;
  for (const c of containers) {
    const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = c;
    }
  }
  return best;
}

/** 找到空闲容量最大的 container。 */
export function findEmptiestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestFree = 0;
  for (const c of containers) {
    const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
    if (free > bestFree) {
      bestFree = free;
      best = c;
    }
  }
  return best;
}

/**
 * 移动到目标，带卡位检测和路径缓存复用。
 * 仅在操作返回 ERR_NOT_IN_RANGE 时调用。
 * 注意：ERR_TIRED 不触发卡位计数（疲劳是正常机制）。
 */
export function moveToTarget(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
): ScreepsReturnCode {
  const pos = "pos" in target ? target.pos : target;

  // 卡位检测。
  const currentPacked = packPos(creep.pos);
  if (creep.memory.lastPos === currentPacked) {
    creep.memory.stuckTicks = (creep.memory.stuckTicks ?? 0) + 1;
  } else {
    creep.memory.stuckTicks = 0;
  }
  creep.memory.lastPos = currentPacked;

  const stuckTicks = creep.memory.stuckTicks ?? 0;

  // 超过重寻路限制（stuckThreshold + repathLimit）— 清除目标并进入 idle，
  // 让角色下一 tick 重新评估目标，避免永久卡死。
  if (stuckTicks >= CONFIG.kernel.stuckThreshold + CONFIG.kernel.repathLimit) {
    clearTarget(creep);
    creep.memory.mode = "idle";
    return ERR_NO_PATH;
  }

  // 默认 ignoreCreeps: true 减少路径绕行；卡位时关闭以绕过阻挡的 creep。
  const options: MoveToOpts = {
    reusePath: 5,
    maxRooms: 1,
    ignoreCreeps: true,
    ...(stuckTicks >= CONFIG.kernel.stuckThreshold ? { ignoreCreeps: false } : {}),
  };

  const result = creep.moveTo(pos, options);
  // ERR_TIRED 时不重置卡位计数 — 疲劳不应被误判为卡位。
  return result;
}

/** 清除 creep 的目标和分配，进入安全空闲。 */
export function clearTarget(creep: Creep): void {
  creep.memory.targetId = undefined;
  creep.memory.assignment = undefined;
  creep.memory.stuckTicks = 0;
}

/**
 * 查找紧急维修目标：按优先级检查 spawn/extension、tower、container。
 * 血量低于 50% 的第一个结构被返回。
 * 供 builder 回退和 tower-defense 共享，避免重复逻辑。
 */
export function findCriticalRepair(
  snapshot: RoomSnapshot,
): AnyStructure | undefined {
  // 按优先级分组检查：spawn/extension 优先，然后 tower，最后 container。
  const groups: readonly (readonly AnyStructure[])[] = [
    snapshot.spawns,
    snapshot.extensions,
    snapshot.towers,
    snapshot.containers,
  ];
  for (const group of groups) {
    for (const s of group) {
      if (s.hits < s.hitsMax * 0.5) {
        return s;
      }
    }
  }
  return undefined;
}

/** 检查 creep 是否应逃跑（有敌对单位且非战斗单位）。 */
export function shouldFlee(snapshot: RoomSnapshot): boolean {
  return snapshot.hostileCreeps.length > 0;
}

/**
 * 逃跑到安全位置 — 避免冲向敌人。
 * 策略：如果 spawn 比最近的敌人更远，则走向 spawn（spawn 通常在塔防范围内）；
 * 否则走向 home 方向的出口。
 */
export function flee(creep: Creep, snapshot: RoomSnapshot): void {
  const nearestHostile = creep.pos.findClosestByRange(snapshot.hostileCreeps as Creep[]);

  if (snapshot.spawns.length > 0 && nearestHostile) {
    const spawn = snapshot.spawns[0]!;
    const creepToSpawn = creep.pos.getRangeTo(spawn);
    const hostileToSpawn = nearestHostile.pos.getRangeTo(spawn);
    // 只有当 spawn 比敌人更近时才走向 spawn（spawn 在安全侧）。
    if (creepToSpawn < hostileToSpawn) {
      if (creepToSpawn > 3) {
        creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
      }
      return;
    }
    // spawn 比敌人远 — 走向反方向出口。
  }

  // 无 spawn 或 spawn 不安全 — 逃向 home 方向的出口。
  const home = creep.memory.home;
  if (home && creep.room.name !== home) {
    moveTowardRoom(creep, home);
  } else if (snapshot.spawns.length > 0) {
    // 已在 home 但 spawn 不安全 — 至少向 spawn 移动（比站着好）。
    const spawn = snapshot.spawns[0];
    if (spawn && creep.pos.getRangeTo(spawn) > 3) {
      creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
    }
  }
}
