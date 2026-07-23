import type { RoomSnapshot } from "../kernel/contracts";
import { CONFIG } from "../config";
import { classifyThreats } from "../domain/defense/threat";
import { preloadStructureCache } from "../creeps/movement";

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
 * @param globalCreepEnergy 由 Kernel 预构建的全局“房间 → creep 携带能量”映射（P1-5 ①）。
 * @param globalPendingHarvesters 由 Kernel 预构建的全局“房间 → 待计入 harvester”映射（P0-1）。
 */
export function buildRoomSnapshot(
  room: Room,
  globalSourceOccupancy?: ReadonlyMap<string, number>,
  globalCreepEnergy?: ReadonlyMap<string, number>,
  globalPendingHarvesters?: ReadonlyMap<string, number>,
): RoomSnapshot {
  const myStructures = room.find(FIND_MY_STRUCTURES);
  const spawns = myStructures.filter(isSpawn);
  const extensions = myStructures.filter(isExtension);
  const towers = myStructures.filter(isTower);
  const links = myStructures.filter(isLink);
  const labs = myStructures.filter(isLab);

  // 一次 find 获取所有中性结构，在 JS 层按类型分组。
  // 比多次带 filter 的 find 更高效（减少 C++ ↔ JS 边界穿越）。
  const allStructures = room.find(FIND_STRUCTURES);
  const containers = allStructures.filter(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
  const roads = allStructures.filter(s => s.structureType === STRUCTURE_ROAD) as StructureRoad[];
  const walls = allStructures.filter(s => s.structureType === STRUCTURE_WALL) as StructureWall[];
  const ramparts = allStructures.filter(s => s.structureType === STRUCTURE_RAMPART) as StructureRampart[];
  const extractor = allStructures.find(s => s.structureType === STRUCTURE_EXTRACTOR) as StructureExtractor | undefined;
  const factory = allStructures.find(s => s.structureType === STRUCTURE_FACTORY) as StructureFactory | undefined;

  const storage = room.storage ?? undefined;
  const terminal = room.terminal ?? undefined;
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
  // 威胁分级：仅具备攻击/治疗/拆迁/claim 部件且非联盟者才算威胁（P0-2）。
  const threatCreeps = classifyThreats(hostileCreeps, CONFIG.defense.allies);

  // 掉落资源：采集地上散落的能量（creep 死亡掉落、harvester 溢出等）。
  const droppedEnergy = room.find(FIND_DROPPED_RESOURCES).filter(
    r => r.resourceType === RESOURCE_ENERGY,
  );

  // 探测 controller 旁 1 格内的 container — upgrader 站桩升级的能量来源。
  let controllerContainer: StructureContainer | undefined;
  if (room.controller) {
    const cx = room.controller.pos.x;
    const cy = room.controller.pos.y;
    controllerContainer = containers.find(
      c => Math.abs(c.pos.x - cx) <= 1 && Math.abs(c.pos.y - cy) <= 1,
    );
  }

  // 修复：tower 必须包含在 fillTargets 中，否则无 creep 给塔充能，RCL3+ 防御形同虚设。
  // controller container 也纳入 fillTargets — hauler 顺手补能，保证 upgrader 不断粮。
  const fillBase: (StructureSpawn | StructureExtension | StructureTower | StructureContainer)[] = [
    ...spawns,
    ...extensions,
    ...towers,
  ];
  if (controllerContainer) fillBase.push(controllerContainer);
  const fillTargets = fillBase.filter(
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

  // ── 预热移动模块的结构缓存（P1-2：通过模块公开 API 写入，消除 as any 隐式耦合）──
  // movement.ts 的 ensureStructureCache 原本每房间每 tick 额外调用
  // room.find(FIND_STRUCTURES) + room.find(FIND_MY_CONSTRUCTION_SITES)。
  // 此处利用 snapshot 已采集的数据直接构建缓存，消除冗余 find。
  // ensureStructureCache 检测 checkedTick === Game.time 后直接返回，不再 find。
  preloadStructureCache(room.name, allStructures, mySites);

  return {
    roomName: room.name,
    rcl: room.controller?.level ?? 0,
    controller: room.controller,
    spawns,
    extensions,
    towers,
    containers,
    roads,
    walls,
    ramparts,
    storage,
    controllerContainer,
    links,
    sources,
    constructionSites: allSites,
    myConstructionSites: mySites,
    hostileCreeps,
    threatCreeps,
    energyAvailable: room.energyAvailable,
    energyCapacityAvailable: room.energyCapacityAvailable,
    fillTargets,
    needsRecovery,
    sourceOccupancy,
    pendingHarvesters: globalPendingHarvesters?.get(room.name) ?? 0,
    creepEnergy: globalCreepEnergy?.get(room.name) ?? 0,
    minerals,
    labs,
    terminal,
    extractor,
    factory,
    droppedEnergy,
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

function isLink(s: AnyOwnedStructure): s is StructureLink {
  return s.structureType === STRUCTURE_LINK;
}

function isLab(s: AnyOwnedStructure): s is StructureLab {
  return s.structureType === STRUCTURE_LAB;
}


