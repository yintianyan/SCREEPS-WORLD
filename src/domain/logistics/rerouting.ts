/**
 * Dynamic Rerouting — A4.3 Phase 2：动态重路由。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #11（无 Route Failure → Rerouting）、
 * §10 #11。
 *
 * 设计意图：
 *   现有 routeCache 不可达后直接 markBlocked，不尝试替代路线。
 *   Dynamic Rerouting 在 Route A 失效时尝试替代路线。
 *
 *   算法：
 *   1. 查询 routeCache 中所有 from→to 的替代路线
 *   2. 按 reliability × (1 - cost) 排序
 *   3. 选择最优替代路线
 *   4. 无替代 → 返回 undefined（触发 Request blocked）
 *
 *   替代路线来源：
 *   - 直接路线（from→to）以外的中转路线（from→via→to）
 *   - 缓存中的历史路线
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { Route } from "./route";
import { routeScore, isRouteUsable, makeRouteId } from "./route";
import type { RouteCache } from "./route-cache";

// ─── 重路由结果 ────────────────────────────────────────────

/**
 * 重路由结果。
 */
export interface ReroutingResult {
  /** 找到的替代路线（undefined = 无替代路线）。 */
  alternateRoute: Route | undefined;
  /** 尝试的候选路线数。 */
  candidatesTried: number;
  /** 原始路线 ID。 */
  originalRouteId: string;
  /** 原因。 */
  reason: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * Route A 失效时尝试替代路线。
 *
 * 查找策略：
 *   1. 首先查 routeCache 中是否有其他 from→to 的路线（可能有多个历史评估）
 *   2. 如果没有，尝试中转路线：from→via→to（查 routeCache 中 from→via + via→to 的组合）
 *   3. 按 routeScore 排序所有候选
 *   4. 返回最优候选
 *
 * 纯函数 — 不访问 Game/Memory（RouteCache 由参数注入）。
 *
 * @param cache Route Cache 实例
 * @param blockedRoute 被阻塞的原始路由
 * @param tick 当前 tick
 */
export function findAlternateRoute(
  cache: RouteCache,
  blockedRoute: Route,
  tick: number,
): ReroutingResult {
  const from = blockedRoute.from;
  const to = blockedRoute.to;

  // 策略 1：查找直接替代路线（可能有多条历史评估）
  const directAlternates = findDirectAlternates(cache, from, to, blockedRoute.routeId);
  if (directAlternates.length > 0) {
    const best = selectBestRoute(directAlternates);
    return {
      alternateRoute: best,
      candidatesTried: directAlternates.length,
      originalRouteId: blockedRoute.routeId,
      reason: `direct alternate found: ${best!.routeId}`,
    };
  }

  // 策略 2：查找中转路线 from→via→to
  const relayAlternates = findRelayAlternates(cache, from, to);
  if (relayAlternates.length > 0) {
    const best = selectBestRoute(relayAlternates);
    return {
      alternateRoute: best,
      candidatesTried: relayAlternates.length,
      originalRouteId: blockedRoute.routeId,
      reason: `relay alternate found: ${best!.routeId}`,
    };
  }

  // 无替代路线
  return {
    alternateRoute: undefined,
    candidatesTried: 0,
    originalRouteId: blockedRoute.routeId,
    reason: "no alternate route available",
  };
}

// ─── 内部函数 ──────────────────────────────────────────────

/**
 * 查找直接替代路线（同 from→to 但不同 routeId 或重新评估的）。
 */
function findDirectAlternates(
  cache: RouteCache,
  from: string,
  to: string,
  excludeRouteId: string,
): Route[] {
  const all = cache.all();
  return all.filter(r =>
    r.from === from &&
    r.to === to &&
    r.routeId !== excludeRouteId &&
    isRouteUsable(r.status),
  );
}

/**
 * 查找中转路线 from→via→to。
 * 需要 from→via 和 via→to 都可用。
 */
function findRelayAlternates(
  cache: RouteCache,
  from: string,
  to: string,
): Route[] {
  // 获取从 from 出发的所有路由
  const fromRoutes = cache.fromRoom(from);
  // 获取到达 to 的所有路由
  const toRoutes = cache.toRoom(to);
  const toRoomsSet = new Set(toRoutes.map(r => r.from));

  // 查找交点：from→via 且 via→to
  const relays: Route[] = [];
  for (const fromRoute of fromRoutes) {
    if (!isRouteUsable(fromRoute.status)) continue;
    if (fromRoute.to === to) continue; // 直接路线已排除
    // 检查 fromRoute.to 是否有到达 to 的路由
    if (toRoomsSet.has(fromRoute.to)) {
      // 找到中转：from→fromRoute.to→to
      // 使用 from→via 的路由作为代表（实际执行时需要两段路由）
      relays.push(fromRoute);
    }
  }
  return relays;
}

/**
 * 从候选列表中选择最优路由（按 routeScore 降序）。
 */
function selectBestRoute(candidates: Route[]): Route | undefined {
  if (candidates.length === 0) return undefined;
  let best = candidates[0]!;
  let bestScore = routeScore(best);
  for (let i = 1; i < candidates.length; i++) {
    const score = routeScore(candidates[i]!);
    if (score > bestScore) {
      best = candidates[i]!;
      bestScore = score;
    }
  }
  return best;
}

// ─── 批量重路由 ───────────────────────────────────────────

/**
 * 对一组被阻塞的路由批量查找替代路线。
 * 纯函数。
 */
export function batchFindAlternates(
  cache: RouteCache,
  blockedRoutes: readonly Route[],
  tick: number,
): ReroutingResult[] {
  return blockedRoutes.map(r => findAlternateRoute(cache, r, tick));
}
