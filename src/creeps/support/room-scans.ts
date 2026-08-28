/**
 * 角色层共享的 per-tick per-room 扫描缓存。
 *
 * 架构约束（R8）：角色文件（creeps/roles/）禁止直接调用 room.find / Game.getObjectById。
 * 所有全房扫描必须通过此文件暴露的缓存函数进行，确保同房多 creep 共享同一次 find 结果。
 * 此文件位于 creeps/support/，不在 R8 守卫的 roles 目录扫描范围内。
 */

import { globalCache } from "../../kernel/global-cache";

// ─── remote-harvester: source 列表 ──────────────────────────

/** per-tick per-room 共享缓存：房间内全部 source。 */
export function findSourcesCached(room: Room): Source[] {
  const g = globalCache();
  if (!g.__remoteSources) g.__remoteSources = {};
  const cached = g.__remoteSources[room.name];
  if (cached && cached.tick === Game.time) return cached.sources;
  const sources = room.find(FIND_SOURCES);
  g.__remoteSources[room.name] = { tick: Game.time, sources };
  return sources;
}

// ─── remote-harvester: 同房己方 creep 列表 ────────────────

/** per-tick per-room 共享缓存：房间内全部己方 creep。 */
export function findMyCreepsCached(room: Room): Creep[] {
  const g = globalCache();
  if (!g.__myCreepsCache) g.__myCreepsCache = {};
  const cached = g.__myCreepsCache[room.name];
  if (cached && cached.tick === Game.time) return cached.creeps;
  const creeps = room.find(FIND_MY_CREEPS);
  g.__myCreepsCache[room.name] = { tick: Game.time, creeps };
  return creeps;
}

// ─── remote-hauler: container 列表 ──────────────────────────

/** per-tick per-room 共享缓存：房间内全部 container（含 source container）。 */
export function findRemoteContainersCached(room: Room): StructureContainer[] {
  const g = globalCache();
  if (!g.__remoteContainers) g.__remoteContainers = {};
  const cached = g.__remoteContainers[room.name];
  if (cached && cached.tick === Game.time) return cached.list;
  const list = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];
  g.__remoteContainers[room.name] = { tick: Game.time, list };
  return list;
}

// ─── remote-hauler: 掉落能量列表 ────────────────────────────

/** per-tick per-room 共享缓存：房间内全部掉落能量堆。 */
export function findDroppedEnergyCached(room: Room): Resource[] {
  const g = globalCache();
  if (!g.__remoteDropped) g.__remoteDropped = {};
  const cached = g.__remoteDropped[room.name];
  if (cached && cached.tick === Game.time) return cached.list;
  const list = room.find(FIND_DROPPED_RESOURCES, {
    filter: r => r.resourceType === RESOURCE_ENERGY,
  });
  g.__remoteDropped[room.name] = { tick: Game.time, list };
  return list;
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
  if (!g.__pbRoomCache) g.__pbRoomCache = {};
  const cached = g.__pbRoomCache[room.name];
  if (cached && cached.tick === Game.time) return cached;
  const droppedPower = room.find(FIND_DROPPED_RESOURCES, {
    filter: r => r.resourceType === RESOURCE_POWER,
  });
  const powerRuins = room.find(FIND_RUINS, {
    filter: r => (r.store[RESOURCE_POWER] ?? 0) > 0,
  });
  const entry: PbRoomCache = { tick: Game.time, droppedPower, powerRuins };
  g.__pbRoomCache[room.name] = entry;
  return entry;
}

// ─── core-clearer: 废墟列表（含 loot） ──────────────────────

/** per-tick per-room 共享缓存：房间内全部废墟。 */
export function findRuinsCached(room: Room): Ruin[] {
  const g = globalCache();
  if (!g.__remoteRuins) g.__remoteRuins = {};
  const cached = g.__remoteRuins[room.name];
  if (cached && cached.tick === Game.time) return cached.list;
  const list = room.find(FIND_RUINS) as Ruin[];
  g.__remoteRuins[room.name] = { tick: Game.time, list };
  return list;
}

// ─── attacker: 敌方结构列表 ──────────────────────────────────

/** per-tick per-room 共享缓存：房间内全部敌方结构。 */
export function getHostileStructuresCached(room: Room): AnyStructure[] {
  const g = globalCache();
  if (!g.__warStructures) g.__warStructures = {};
  const cached = g.__warStructures[room.name];
  if (cached && cached.tick === Game.time) return cached.list;
  const list = room.find(FIND_HOSTILE_STRUCTURES);
  g.__warStructures[room.name] = { tick: Game.time, list };
  return list;
}

/** per-tick per-room 共享缓存：房间内 power bank。 */
export function getPowerBankCached(room: Room): StructurePowerBank | undefined {
  const g = globalCache();
  if (!g.__powerBanks) g.__powerBanks = {};
  const cached = g.__powerBanks[room.name];
  if (cached && cached.tick === Game.time) return cached.pb;
  const pb = room.find(FIND_STRUCTURES).find(
    s => s.structureType === STRUCTURE_POWER_BANK,
  ) as StructurePowerBank | undefined;
  g.__powerBanks[room.name] = { tick: Game.time, pb };
  return pb;
}
