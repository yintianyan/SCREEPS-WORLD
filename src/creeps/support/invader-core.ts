/** InvaderCore 共享探测缓存 — 全仓唯一写者（键冲突修复）。 */

import { globalCache } from "../../kernel/global-cache";

/** 探测房间内全部 InvaderCore（per-tick per-room 共享缓存）。 */
export function findInvaderCores(room: Room): StructureInvaderCore[] {
  const g = globalCache();
  if (!g.__remoteInvaderCore) g.__remoteInvaderCore = {};
  const cached = g.__remoteInvaderCore[room.name];
  if (cached && cached.tick === Game.time) return cached.cores;

  const cores = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
  }) as StructureInvaderCore[];
  g.__remoteInvaderCore[room.name] = { tick: Game.time, cores };
  return cores;
}

/** 房间是否被 InvaderCore 压制（派生布尔语义，供 reserver 兜底自检）。 */
export function roomHasInvaderCore(room: Room): boolean {
  return findInvaderCores(room).length > 0;
}
