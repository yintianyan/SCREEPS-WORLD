import type { RoomSnapshot } from "../kernel/contracts";

/**
 * 为单个自有房间构建 RoomSnapshot。
 * 这是每 tick 唯一调用 room.find() 的地方 — 所有系统和角色
 * 都消费快照以避免重复扫描。
 *
 * 成本：每房每 tick O(structures + sources + sites + hostiles)。
 * 必须保持廉价：此处不使用 PathFinder、lookAt 或地形扫描。
 *
 * @param globalSourceOccupancy 由 Kernel 预构建的全局 source 占用映射，
 *   避免每个房间独立遍历全部 Game.creeps。
 */
export function buildRoomSnapshot(
  room: Room,
  globalSourceOccupancy?: ReadonlyMap<string, number>,
): RoomSnapshot {
  const myStructures = room.find(FIND_MY_STRUCTURES);
  const spawns = myStructures.filter(isSpawn);
  const extensions = myStructures.filter(isExtension);
  const towers = myStructures.filter(isTower);

  // 使用带 filter 的 find 让引擎在 C++ 层过滤，避免全量遍历。
  const containers = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_CONTAINER,
  });
  const roads = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_ROAD,
  });

  const storage = room.storage ?? undefined;
  const sources = room.find(FIND_SOURCES);
  let minerals: Mineral[] = [];
  try {
    minerals = room.find(FIND_MINERALS);
  } catch {
    // FIND_MINERALS 可能在测试环境未定义。
  }
  const allSites = room.find(FIND_CONSTRUCTION_SITES);
  const mySites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const hostileCreeps = room.find(FIND_HOSTILE_CREEPS);

  const fillTargets = [...spawns, ...extensions].filter(
    s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  );

  // needsRecovery 仅基于 spawn 存在性；
  // 更精细的恢复判断由 Kernel.computeColonyState 负责（已统计 harvester 数量）。
  const needsRecovery = spawns.length === 0;

  // 资源占用：使用 Kernel 预构建的全局映射，或本房独立构建。
  const sourceOccupancy = new Map<string, number>();
  for (const source of sources) {
    sourceOccupancy.set(source.id, globalSourceOccupancy?.get(source.id as string) ?? 0);
  }

  return {
    roomName: room.name,
    rcl: room.controller?.level ?? 0,
    controller: room.controller,
    spawns,
    extensions,
    towers,
    containers,
    roads,
    storage,
    sources,
    constructionSites: allSites,
    myConstructionSites: mySites,
    hostileCreeps,
    energyAvailable: room.energyAvailable,
    energyCapacityAvailable: room.energyCapacityAvailable,
    fillTargets,
    needsRecovery,
    sourceOccupancy,
    minerals,
  };
}

// 结构筛选类型守卫。
function isSpawn(s: AnyOwnedStructure): s is StructureSpawn {
  return s.structureType === STRUCTURE_SPAWN;
}

function isExtension(s: AnyOwnedStructure): s is StructureExtension {
  return s.structureType === STRUCTURE_EXTENSION;
}

function isTower(s: AnyOwnedStructure): s is StructureTower {
  return s.structureType === STRUCTURE_TOWER;
}


