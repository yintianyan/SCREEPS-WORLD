/**
 * InvaderCore 共享探测缓存 — 全仓唯一写者（键冲突修复）。
 *
 * 历史：reserver 与 core-clearer 曾各自以同名键 __remoteInvaderCore 向 globalCache
 * 写不同形状（reserver 写 {tick,blocked:boolean}，core-clearer 写 {tick,list:[]}）。
 * 同 tick 同房共存时，两角色执行序随 kernel 的 TTL 升序排序波动：
 *   - clearer 先写 {list} → reserver 读 .blocked 得 undefined（falsy）→ 恒判"无核心"，
 *     对被核心每 tick +2 续期的 controller 做 -1/tick 的 attackController 纯空耗；
 *   - reserver 先写 {blocked} → clearer 读 .list 得 undefined → cores[0] 抛 TypeError，
 *     连续 3 次触发 safeRun 插件冷却（50-200t），且 reserver 每 tick 重写毒化形状，
 *     清核者进入「冷却到期→再炸→加长冷却」螺旋，清核链路等效残废。
 *
 * 现约定：单一形状 { tick, cores }，blocked 语义由消费方派生（cores.length > 0）。
 * 缓存语义与原实现一致：per-tick per-room，同 tick 命中不重复 find（角色硬约束——
 * 远矿房无 RoomSnapshot 预热），跨 tick 失效重算；global reset 后随 heap 重建。
 */

import { globalCache } from "../../kernel/global-cache";

interface InvaderCoreCacheEntry {
  tick: number;
  cores: StructureInvaderCore[];
}

/** 探测房间内全部 InvaderCore（per-tick per-room 共享缓存）。 */
export function findInvaderCores(room: Room): StructureInvaderCore[] {
  const g = globalCache() as {
    __remoteInvaderCore?: Record<string, InvaderCoreCacheEntry>;
  };
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
