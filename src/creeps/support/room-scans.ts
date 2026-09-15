/**
 * 角色层共享的 per-tick per-room 扫描缓存。
 *
 * 架构约束：角色文件（creeps/roles/）禁止直接调用 room.find / Game.getObjectById。
 * 所有全房扫描必须通过此文件暴露的缓存函数进行，确保同房多 creep 共享同一次 find 结果。
 * 此文件位于 creeps/support/，不在角色目录扫描守卫范围内。
 */

import { globalCache, tickCacheEntry } from "../../kernel/global-cache";

// ─── remote-harvester: source 列表 ──────────────────────────

/** per-tick per-room 共享缓存：房间内全部 source。 */
export function findSourcesCached(room: Room): Source[] {
  const g = globalCache();
  return tickCacheEntry((g.__remoteSources ??= {}), room.name, () => ({
    tick: Game.time,
    sources: room.find(FIND_SOURCES),
  })).sources;
}

// ─── remote-harvester: 同房己方 creep 列表 ────────────────

/** per-tick per-room 共享缓存：房间内全部己方 creep。 */
export function findMyCreepsCached(room: Room): Creep[] {
  const g = globalCache();
  return tickCacheEntry((g.__myCreepsCache ??= {}), room.name, () => ({
    tick: Game.time,
    creeps: room.find(FIND_MY_CREEPS),
  })).creeps;
}

// ─── remote-harvester: 跨房兄弟查询（occupancy 统计用）────────

/**
 * per-tick 缓存：匹配指定 remoteTarget 的全部 remoteHarvester（不限房间）。
 *
 * 用于 bindInitialSource 的 occupancy 统计 — 兄弟 harvester 可能在通勤路上
 * （home 房或中间房），仅扫本房会漏掉已绑 sourceId 的兄弟 → 竞态绑同一 source。
 * 此函数在 support 层封装 Object.values(Game.creeps)，避免角色层直接全局扫描。
 */
export function findRemoteHarvestersByTarget(targetRoom: string): Creep[] {
  const g = globalCache();
  return tickCacheEntry((g.__remoteHarvestersByTarget ??= {}), targetRoom, () => ({
    tick: Game.time,
    creeps: Object.values(Game.creeps).filter(
      c => c.memory.role === "remoteHarvester" && c.memory.remoteTarget === targetRoom,
    ),
  })).creeps;
}

// ─── remote-hauler: 掉落能量列表 ────────────────────────────

/** per-tick per-room 共享缓存：房间内全部掉落能量堆。 */
export function findDroppedEnergyCached(room: Room): Resource[] {
  const g = globalCache();
  return tickCacheEntry((g.__remoteDropped ??= {}), room.name, () => ({
    tick: Game.time,
    list: room.find(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY,
    }),
  })).list;
}

// ─── pb-collector: power 掉落堆 + 含 power 的废墟 ──────────

/** per-tick per-room 共享缓存：掉落 power 列表 + 含 power 的废墟列表。 */
export interface PbRoomCache {
  tick: number;
  droppedPower: Resource[];
  powerRuins: Ruin[];
}

export function getPbRoomCache(room: Room): PbRoomCache {
  const g = globalCache();
  return tickCacheEntry((g.__pbRoomCache ??= {}), room.name, () => ({
    tick: Game.time,
    droppedPower: room.find(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_POWER,
    }),
    powerRuins: room.find(FIND_RUINS, {
      filter: r => (r.store[RESOURCE_POWER] ?? 0) > 0,
    }),
  }));
}

// ─── remote-hauler: 坟墓列表 ────────────────────────────────

/** per-tick per-room 共享缓存：房间内全部坟墓。 */
export function findTombstonesCached(room: Room): Tombstone[] {
  const g = globalCache();
  return tickCacheEntry((g.__remoteTombstones ??= {}), room.name, () => ({
    tick: Game.time,
    list: room.find(FIND_TOMBSTONES) as Tombstone[],
  })).list;
}

// ─── core-clearer: 废墟列表（含 loot） ──────────────────────

/** per-tick per-room 共享缓存：房间内全部废墟。 */
export function findRuinsCached(room: Room): Ruin[] {
  const g = globalCache();
  return tickCacheEntry((g.__remoteRuins ??= {}), room.name, () => ({
    tick: Game.time,
    list: room.find(FIND_RUINS) as Ruin[],
  })).list;
}

// ─── attacker: 敌方结构列表 ──────────────────────────────────

/** per-tick per-room 共享缓存：房间内全部敌方结构。 */
export function getHostileStructuresCached(room: Room): AnyStructure[] {
  const g = globalCache();
  return tickCacheEntry((g.__warStructures ??= {}), room.name, () => ({
    tick: Game.time,
    list: room.find(FIND_HOSTILE_STRUCTURES),
  })).list;
}

/** per-tick per-room 共享缓存：房间内 power bank。 */
export function getPowerBankCached(room: Room): StructurePowerBank | undefined {
  const g = globalCache();
  return tickCacheEntry((g.__powerBanks ??= {}), room.name, () => ({
    tick: Game.time,
    pb: room.find(FIND_STRUCTURES).find(s => s.structureType === STRUCTURE_POWER_BANK) as
      StructurePowerBank | undefined,
  })).pb;
}

// ─── remote-defender: 防守位锚点（container/source 质心所需的扫描） ────────

/** per-tick per-room 共享缓存：房间内全部 container。 */
export function findContainersCached(room: Room): StructureContainer[] {
  const g = globalCache();
  return tickCacheEntry((g.__containersCache ??= {}), room.name, () => ({
    tick: Game.time,
    containers: room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[],
  })).containers;
}

// ─── remote-hauler: 通勤建路（脚下/邻近 site 扫描） ─────────────────────

/** per-tick per-room 共享缓存：房间内全部我方工地。 */
export function findMySitesCached(room: Room): ConstructionSite[] {
  const g = globalCache();
  return tickCacheEntry((g.__mySitesCache ??= {}), room.name, () => ({
    tick: Game.time,
    sites: room.find(FIND_MY_CONSTRUCTION_SITES),
  })).sites;
}

// ─── dismantler: neutral wall 列表（路径阻断墙拆除）─────────

/** per-tick per-room 共享缓存：房间内全部 wall 结构（含我方与 neutral）。
 * dismantler 用此查找路径阻断 wall 的拆除目标。 */
export function findWallsCached(room: Room): StructureWall[] {
  const g = globalCache();
  return tickCacheEntry((g.__wallStructures ??= {}), room.name, () => ({
    tick: Game.time,
    list: room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_WALL,
    }) as StructureWall[],
  })).list;
}

// ─── remote-defender / scout: 房间出口列表 ──────────────────

/** per-tick per-room 共享缓存：房间出口位置列表（FIND_EXIT）。 */
export function findExitsCached(room: Room): RoomPosition[] {
  const g = globalCache() as any;
  return tickCacheEntry((g.__exitsCache ??= {}), room.name, () => ({
    tick: Game.time,
    list: room.find(FIND_EXIT),
  })).list;
}
