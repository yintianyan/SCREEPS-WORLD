import type { RoomSnapshot } from "../kernel/contracts";
import { CONFIG } from "../config";
import { classifyThreats, isSquadThreatCreeps } from "../domain/defense/threat";
import { preloadStructureCache, preloadStaticBlockers } from "../creeps/movement";

/**
 * 为单个自有房间构建 RoomSnapshot — 每 tick 唯一调用 room.find() 的地方，
 * 所有系统和角色都消费快照以避免重复扫描。
 * 成本：每房每 tick O(structures + sources + sites + hostiles)；必须保持廉价，
 * 不使用 PathFinder、全房 lookAt 或地形扫描（唯一例外：站桩阻挡在位核验 ≤4 个单格 lookForAt）。
 *
 * 三个 global* 参数由 Kernel 预构建（避免每房独立遍历 Game.creeps）：
 * globalSourceOccupancy（source 占用）、globalCreepEnergy（房间 → creep 携带能量，P1-5 ①）、
 * globalPendingHarvesters（房间 → 待计入 harvester，P0-1）。
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

  // 一次 find 获取所有中性结构，在 JS 层按类型分组 — 比多次带 filter 的 find
  // 更高效（减少 C++ ↔ JS 边界穿越）。
  const allStructures = room.find(FIND_STRUCTURES);
  const containers = allStructures.filter(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
  const roads = allStructures.filter(s => s.structureType === STRUCTURE_ROAD) as StructureRoad[];
  const walls = allStructures.filter(s => s.structureType === STRUCTURE_WALL) as StructureWall[];
  const ramparts = allStructures.filter(s => s.structureType === STRUCTURE_RAMPART) as StructureRampart[];
  const extractor = allStructures.find(s => s.structureType === STRUCTURE_EXTRACTOR) as StructureExtractor | undefined;
  const factory = allStructures.find(s => s.structureType === STRUCTURE_FACTORY) as StructureFactory | undefined;
  const observer = allStructures.find(s => s.structureType === STRUCTURE_OBSERVER) as StructureObserver | undefined;
  const powerSpawn = allStructures.find(s => s.structureType === STRUCTURE_POWER_SPAWN) as StructurePowerSpawn | undefined;
  const nuker = allStructures.find(s => s.structureType === STRUCTURE_NUKER) as StructureNuker | undefined;

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

  // nuke 落点预警（审计缺口 1）：自有房视野内 FIND_NUKES 是常量级查询，
  // 50000 tick 预警窗口是资产抢救的全部时限。try/catch 兼容未定义常量的
  // 旧测试 mock（与 tombstones 先例同款）。
  let incomingNukes: Nuke[] = [];
  try {
    incomingNukes = room.find(FIND_NUKES);
  } catch {
    // 常量未定义的环境（旧测试 mock）— 视为无预警。
  }

  // 掉落资源：采集地上散落的能量（creep 死亡掉落、harvester 溢出等）。
  const droppedEnergy = room.find(FIND_DROPPED_RESOURCES).filter(
    r => r.resourceType === RESOURCE_ENERGY,
  );

  // 遗留资源容器：坟墓（creep 死亡）与废墟（建筑被毁/拆除），均衰减灭失，hauler 优先回收。
  // 过滤口径为「任意资源总量 > 0」而非仅能量 — 否则只装矿物的坟墓（如满载矿物的
  // mineralMiner 死亡）被滤出快照，矿物无人可见、随尸体灭失（线上实证）。
  let tombstones: Tombstone[] = [];
  let ruins: Ruin[] = [];
  try {
    tombstones = room.find(FIND_TOMBSTONES).filter(
      t => t.store.getUsedCapacity() > 0,
    );
    ruins = room.find(FIND_RUINS).filter(
      r => r.store.getUsedCapacity() > 0,
    );
  } catch {
    // 常量未定义的环境（旧测试 mock）— 视为无遗留资源。
  }

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

  // ── 预热静态占位缓存（方案 B：根治路径缓存撞墙）──
  // 站桩位置 = source 旁 range<=1 的 container（harvester 矿位）+ controllerContainer（upgrader 站桩位）。
  // pathfinding 的 roomCallback 读取并标 255，使 PathFinder 算路径时天然绕开站桩矿工。
  // 复用已采集的 containers/sources/controllerContainer，零额外 find。
  //
  // 仅登记「当前确有己方 creep 在位」的格 — 阻挡语义是「绕开在位的站桩
  // creep」，不是「预留站桩位」。无条件标 255 的教训（线上实测）：拓荒房
  // 继承远矿时代的 source container 但没有矿工，空格变虚假实墙 — 矿旁狭窄
  // 地形下该格常是唯一采集位，builder 求路 incomplete 原地徘徊；upgrader
  // 想站上 controller container（0 通勤最优位）同样被自家阻挡拒之门外。
  // 换班空窗期格子放开无害：新路径穿过后若矿工到位，traffic 推挤/绕行接管。
  // 成本：每房 ≤4 格的单格 lookForAt（非全房 lookAt），O(1)/格。
  const staticBlockerPositions: number[] = [];
  const occupiedByMyCreep = (x: number, y: number): boolean =>
    room.lookForAt(LOOK_CREEPS, x, y).some(c => c.my);
  for (const c of containers) {
    if (sources.some(s => c.pos.getRangeTo(s.pos) <= 1) && occupiedByMyCreep(c.pos.x, c.pos.y)) {
      staticBlockerPositions.push(c.pos.x, c.pos.y);
    }
  }
  if (controllerContainer && occupiedByMyCreep(controllerContainer.pos.x, controllerContainer.pos.y)) {
    staticBlockerPositions.push(controllerContainer.pos.x, controllerContainer.pos.y);
  }
  preloadStaticBlockers(room.name, staticBlockerPositions);

  // ── 预计算关键维修目标（血量 < 50% 的 spawn/extension/tower/container）──
  // 供 tower-defense 和 builder actions 复用，避免各模块重复迭代。
  let criticalRepairTarget: AnyStructure | undefined;
  for (const s of spawns) {
    if (s.hits < s.hitsMax * 0.5) { criticalRepairTarget = s; break; }
  }
  if (!criticalRepairTarget) {
    for (const s of extensions) {
      if (s.hits < s.hitsMax * 0.5) { criticalRepairTarget = s; break; }
    }
  }
  if (!criticalRepairTarget) {
    for (const s of towers) {
      if (s.hits < s.hitsMax * 0.5) { criticalRepairTarget = s; break; }
    }
  }
  if (!criticalRepairTarget) {
    for (const s of containers) {
      if (s.hits < s.hitsMax * 0.5) { criticalRepairTarget = s; break; }
    }
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
    squadThreat: isSquadThreatCreeps(threatCreeps),
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
    observer,
    powerSpawn,
    nuker,
    droppedEnergy,
    tombstones,
    ruins,
    criticalRepairTarget,
    incomingNukes,
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

