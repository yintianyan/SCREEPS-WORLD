import type { RoomSnapshot } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";

/** 获取或分配 creep 的 source。将 sourceId 存入 memory。 */
export function getSource(creep: Creep, snapshot: RoomSnapshot): Source | undefined {
  // 先尝试缓存的 source。
  if (creep.memory.sourceId) {
    const source = Game.getObjectById(creep.memory.sourceId);
    if (source) {
      // 拥挤检测：如果当前 source 占用超过公平份额，且存在更空闲的 source，则重分配。
      // 公平份额 = ceil(总占用 / source 数量)。例如 2 harvester + 2 source → 每个最多 1。
      if (snapshot.sources.length > 1) {
        const myCount = snapshot.sourceOccupancy.get(source.id) ?? 0;
        let totalOccupancy = 0;
        let minCount = Infinity;
        for (const s of snapshot.sources) {
          const c = snapshot.sourceOccupancy.get(s.id) ?? 0;
          totalOccupancy += c;
          if (c < minCount) minCount = c;
        }
        const fairShare = Math.ceil(totalOccupancy / snapshot.sources.length);
        // 当前 source 超过公平份额 且 存在更空闲的 source → 迁移。
        if (myCount > fairShare && minCount < myCount) {
          creep.memory.sourceId = undefined;
          // 落入下方重分配逻辑。
        } else {
          return source;
        }
      } else {
        return source;
      }
    } else {
      // source 消失 — 清除并重新分配。
      creep.memory.sourceId = undefined;
    }
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

/** 可被 hauler 填充的结构类型。 */
type FillTarget = StructureSpawn | StructureExtension | StructureTower | StructureContainer;

/** 在 targets 中找最近的「未预约」目标；给定 types 时仅在这些结构类型中挑选。 */
function pickFillTarget(
  creep: Creep,
  targets: readonly FillTarget[],
  reserved: Set<string>,
  types?: readonly string[],
): FillTarget | undefined {
  const pool = targets.filter(
    s => !reserved.has(s.id) && (types === undefined || types.includes(s.structureType)),
  );
  if (pool.length === 0) return undefined;
  return creep.pos.findClosestByRange(pool) ?? undefined;
}

/**
 * Hauler 专用的填充目标选择 — 带优先级与每 tick 预约去重。
 *
 * 老玩家填充优先级：
 *   0. controller container 低于半满时优先补 1 个 hauler（站桩升级供能核心，远离核心区易饿死）。
 *   1. spawn / extension —— 孵化引擎，断能即停产，最高优先。
 *   2. tower —— 防御/维修，次之。
 *   3. 其余（如非紧急的 controller container）。
 * 同级取最近未预约者；预约集合按 tick 惰性重置，避免多 hauler 抢同一目标互相堵位。
 * 所有目标都被预约时回退到最近目标（允许共享），避免死锁。
 */
export function getHaulFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;

  const g = globalCache();
  if (!g.fillReservations || g.fillReservationTick !== Game.time) {
    g.fillReservations = new Set();
    g.fillReservationTick = Game.time;
  }
  const reserved = g.fillReservations;

  // 0. 站桩升级保障：controller container 低于半满时优先派一个 hauler 补给。
  const cc = snapshot.controllerContainer;
  if (
    cc &&
    cc.store.getFreeCapacity(RESOURCE_ENERGY) > cc.store.getUsedCapacity(RESOURCE_ENERGY) &&
    !reserved.has(cc.id)
  ) {
    reserved.add(cc.id);
    return cc as unknown as AnyOwnedStructure;
  }

  // 1→2→3 分级挑选最近未预约目标。
  const target =
    pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION]) ??
    pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_TOWER]) ??
    pickFillTarget(creep, snapshot.fillTargets, reserved);

  if (target) {
    reserved.add(target.id);
    return target as unknown as AnyOwnedStructure;
  }

  // 全部已预约 — 回退最近目标（允许共享）避免死锁。
  return (creep.pos.findClosestByRange(snapshot.fillTargets as FillTarget[]) ?? undefined) as
    | AnyOwnedStructure
    | undefined;
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

/**
 * 找到距离 creep 最近且含有能量的 container。
 * 用于 builder 等需要在远处工地与能量源之间通勤的角色 — 选最近的能量源
 * 而非最满的，可显著缩短取能行走距离，提升建造 duty cycle。
 */
export function findClosestContainerWithEnergy(
  creep: Creep,
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestDist = Infinity;
  for (const c of containers) {
    if (c.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) continue;
    const d = creep.pos.getRangeTo(c);
    if (d < bestDist) {
      bestDist = d;
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
 * 选择下一个要拾取的掉落能量堆（考虑拾取范围与衰减）。
 *
 * 游戏机制：pickup 需相邻（range ≤ 1），每 tick 只能拾取一堆；掉落能量按
 * ceil(amount/1000)/tick 衰减，堆越大衰减越快。因此在“装满前持续拾取”时：
 *   - 若身边（range ≤ 1）有可拾取的堆，优先拾取能量最多的一堆
 *     （先拿大堆，减少剩余堆的衰减损耗）。
 *   - 否则走向最近的一堆去拾取。
 * “未装满则继续拾取”的跨 tick 循环由 FSM（updateMode：free>0 时保持 acquire）保证。
 */
export function selectDroppedEnergy(
  creep: Creep,
  dropped: readonly Resource[],
): Resource | undefined {
  if (dropped.length === 0) return undefined;

  // 优先拾取身边（range ≤ 1）能量最多的一堆。
  let richestAdjacent: Resource | undefined;
  for (const r of dropped) {
    if (creep.pos.getRangeTo(r) > 1) continue;
    if (!richestAdjacent || r.amount > richestAdjacent.amount) {
      richestAdjacent = r;
    }
  }
  if (richestAdjacent) return richestAdjacent;

  // 身边无可拾取 — 走向最近的一堆。
  return creep.pos.findClosestByRange([...dropped] as Resource[]) ?? undefined;
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
