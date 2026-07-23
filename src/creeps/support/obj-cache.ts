/**
 * 每 tick 对象缓存 — 去重同 tick 内对同一 id 的重复 Game.getObjectById 调用（P2-6）。
 *
 * 典型冗余场景：
 *   - 角色 candidate 的 predicate 和 execute 对同一 targetId 各调一次（2→1）
 *   - builder 的 gate + predicate + execute 对同一 site 调三次（3→1）
 *   - 多 creep 分配到同一目标时各自查询（N→1）
 *
 * 安全性：单个 tick 内对象身份不变（结构销毁/创建发生在 tick 边界之间），
 * 缓存引用不会过期；缓存 null 同样安全（tick 内不存在的对象不会凭空出现）。
 * 缓存以 Game.time 标记，每 tick 自动重置；Global Reset 后随 globalCache 重建。
 *
 * 类型签名与 Game.getObjectById 完全一致（双重载），调用点零类型改动。
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
