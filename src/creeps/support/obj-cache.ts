/**
 * 每 tick 对象缓存（P2-6）— 去重同 tick 内对同一 id 的重复 Game.getObjectById
 * （predicate/execute 与多 creep 同目标场景 N→1）。
 * 安全性：tick 内对象身份不变（结构销毁/创建发生在 tick 边界），缓存 null 同样安全
 * （tick 内不存在的对象不会凭空出现）；以 Game.time 标记每 tick 自动重置。
 */

import { globalCache } from "../../kernel/global-cache";

function getCache(): Map<string, unknown> {
  const g = globalCache() as any;
  if (!g.__objCache || g.__objCacheTick !== Game.time) {
    g.__objCache = new Map();
    g.__objCacheTick = Game.time;
  }
  return g.__objCache as Map<string, unknown>;
}

export function getObjectById<T extends Id<_HasId>>(id: T): fromId<T> | null;
export function getObjectById<T extends _HasId>(id: Id<T>): T | null;
export function getObjectById(id: string): unknown {
  const cache = getCache();
  if (cache.has(id)) return cache.get(id);
  const obj = Game.getObjectById(id as Id<_HasId>);
  cache.set(id, obj);
  return obj;
}
