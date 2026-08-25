/**
 * Route Cache — A4.3 Phase 2：带失效条件的路由缓存。
 *
 * 合同锚点：A4.3 Architecture Audit §7.1（routeCache 无失效条件）、§10 #10。
 *
 * 设计意图：
 *   现有 agenda-manager 有 `routeCache`（heap Map），但**永不失效**（除非 global reset）。
 *   movement 有三层缓存（持久化/同 tick/跨房出口），但 agenda-manager 不复用。
 *
 *   Route Cache 提供带失效条件的路由缓存：
 *   - TTL 到期
 *   - 道路结构变化（revision 变化）
 *   - 威胁变化（新 hostile 房间）
 *   - Route 被标记 blocked
 *
 *   与 movement 的 path cache 的区别：
 *   - movement cache 是 per-creep path（某 creep 的路径）
 *   - Route Cache 是 per-room-pair route（两房间的路由元数据）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { Route } from "./route";
import { makeRouteId } from "./route";

// ─── 失效条件 ──────────────────────────────────────────────

/**
 * Route Cache 失效条件。
 */
export interface RouteInvalidationRule {
  /** 道路结构变化（revision 变化）。 */
  structureRevisionChanged: boolean;
  /** 威胁变化（新 hostile 房间）。 */
  threatChanged: boolean;
  /** Route 被标记 blocked。 */
  routeBlocked: boolean;
  /** TTL 到期。 */
  ttlExpired: boolean;
}

/**
 * 检查是否需要重新评估路由。
 *
 * 纯函数。
 */
export function needsReeval(
  route: Route,
  currentStructureRevision: number,
  lastStructureRevision: number,
  currentThreat: number,
  lastThreat: number,
  ttl: number,
  tick: number,
): RouteInvalidationRule {
  const structureRevisionChanged = currentStructureRevision !== lastStructureRevision;
  const threatChanged = Math.abs(currentThreat - lastThreat) > 0.2; // 威胁变化 > 0.2
  const routeBlocked = route.status === "blocked";
  const ttlExpired = tick - route.lastEvaluated > ttl;

  return {
    structureRevisionChanged,
    threatChanged,
    routeBlocked,
    ttlExpired,
  };
}

/**
 * 判断是否任一失效条件满足。
 * 纯函数。
 */
export function anyInvalidated(rule: RouteInvalidationRule): boolean {
  return rule.structureRevisionChanged ||
    rule.threatChanged ||
    rule.routeBlocked ||
    rule.ttlExpired;
}

// ─── Route Cache ──────────────────────────────────────────

/**
 * Route Cache — 带失效条件的路由缓存。
 *
 * 存储：heap（非 Memory）。global reset 后重建（从 Memory 快照恢复）。
 */
export class RouteCache {
  /** routeId → Route。 */
  private cache = new Map<string, Route>();
  /** room → last known structure revision。 */
  private lastStructureRevision = new Map<string, number>();
  /** room → last known threat level (0..1)。 */
  private lastThreatLevel = new Map<string, number>();

  /**
   * 查询路由。
   * 如果缓存中有且未失效，返回路由；否则返回 undefined。
   */
  get(from: string, to: string): Route | undefined {
    return this.cache.get(makeRouteId(from, to));
  }

  /**
   * 更新路由。
   * 同时更新结构版本和威胁等级快照。
   */
  set(
    route: Route,
    structureRevision?: number,
    threatLevel?: number,
  ): void {
    this.cache.set(route.routeId, route);
    if (structureRevision !== undefined) {
      this.lastStructureRevision.set(route.from, structureRevision);
      this.lastStructureRevision.set(route.to, structureRevision);
    }
    if (threatLevel !== undefined) {
      this.lastThreatLevel.set(route.from, threatLevel);
      this.lastThreatLevel.set(route.to, threatLevel);
    }
  }

  /**
   * 检查路由是否需要重新评估。
   */
  needsReeval(
    from: string,
    to: string,
    currentStructureRevision: number,
    currentThreat: number,
    ttl: number,
    tick: number,
  ): boolean {
    const route = this.get(from, to);
    if (!route) return true; // 不存在 → 需要评估

    const lastRev = this.lastStructureRevision.get(from) ?? 0;
    const lastThreat = this.lastThreatLevel.get(from) ?? 0;

    const rule = needsReeval(
      route,
      currentStructureRevision,
      lastRev,
      currentThreat,
      lastThreat,
      ttl,
      tick,
    );
    return anyInvalidated(rule);
  }

  /**
   * 获取所有缓存路由。
   */
  all(): Route[] {
    return Array.from(this.cache.values());
  }

  /**
   * 获取从指定源房出发的所有路由。
   */
  fromRoom(room: string): Route[] {
    const result: Route[] = [];
    for (const route of this.cache.values()) {
      if (route.from === room) result.push(route);
    }
    return result;
  }

  /**
   * 获取到达指定目标房的所有路由。
   */
  toRoom(room: string): Route[] {
    const result: Route[] = [];
    for (const route of this.cache.values()) {
      if (route.to === room) result.push(route);
    }
    return result;
  }

  /**
   * 批量清理过期项。
   * @param tick 当前 tick
   * @param maxAge 最大年龄（tick）
   * @returns 被清理的 routeId 列表
   */
  sweep(tick: number, maxAge: number): string[] {
    const expired: string[] = [];
    for (const [id, route] of this.cache) {
      if (tick - route.lastEvaluated > maxAge) {
        expired.push(id);
        this.cache.delete(id);
      }
    }
    return expired;
  }

  /**
   * 清除所有缓存（global reset 时调用）。
   */
  clear(): void {
    this.cache.clear();
    this.lastStructureRevision.clear();
    this.lastThreatLevel.clear();
  }

  /**
   * 缓存大小。
   */
  size(): number {
    return this.cache.size;
  }
}
