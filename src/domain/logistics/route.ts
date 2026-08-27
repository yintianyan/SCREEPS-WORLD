/** Route */

// ─── Route 状态 ────────────────────────────────────────────

/**
 * Route 状态。

 * - active:     可用
 * - congested:  拥堵（traffic > 阈值）
 * - degraded:   性能下降（reliability < 阈值）
 * - blocked:    不可达（当前 tick 不可通过）
 * - suspended:  长期不经济，暂停（ROI 持续低于阈值）
 * - failed:     永久失效（源/目标房失守）
 */
export type RouteStatus =
  | "active"
  | "congested"
  | "degraded"
  | "blocked"
  | "suspended"
  | "failed";

/**
 * 判定 Route 状态是否可用（可分配运输任务）。
 * 纯函数。
 */
export function isRouteUsable(status: RouteStatus): boolean {
  return status === "active" || status === "congested" || status === "degraded";
}

/**
 * 判定 Route 状态是否终态（可归档）。
 * 纯函数。
 */
export function isRouteTerminal(status: RouteStatus): boolean {
  return status === "failed";
}

// ─── Route 模型 ───────────────────────────────────────────

/**
 * Route — 路由一等对象。

 * 描述从源房到目标房的完整路由元数据。
 * 存储在 Memory.kernel.routes（瘦快照 + 终态归档）。
 */
export interface Route {
  /** 路由 ID："route:<from>:<to>"。 */
  routeId: string;
  /** 源房。 */
  from: string;
  /** 目标房。 */
  to: string;
  /** 路由跳数（跨房数，0=同房）。 */
  hops: number;
  /** 预估单程 tick 数。 */
  travelTime: number;
  /** 运输成本（来自 transport-cost.ts 的 total）。 */
  cost: number;
  /** 风险评分 (0..1, 0=安全, 1=极危险)。 */
  risk: number;
  /** 拥堵评分 (0..1, 0=畅通, 1=严重拥堵)。 */
  traffic: number;
  /** 可靠性评分 (0..1, 1=最可靠)。 */
  reliability: number;
  /** 状态。 */
  status: RouteStatus;
  /** 最近评估 tick。 */
  lastEvaluated: number;
  /** 历史成功率 (0..1)。 */
  successRate: number;
  /** 历史总运输次数。 */
  totalTrips: number;
  /** 历史失败次数。 */
  failedTrips: number;
  /** 中间房间列表（从 from 到 to 的路径）。 */
  via: string[];
  /** 创建 tick。 */
  createdAt: number;
}

// ─── ID 生成 ──────────────────────────────────────────────

/**
 * 生成路由 ID。
 * 格式："route:<from>:<to>"
 * 纯函数。
 */
export function makeRouteId(from: string, to: string): string {
  return `route:${from}:${to}`;
}

// ─── 创建 ──────────────────────────────────────────────────

/**
 * 创建新 Route（初始状态 = active）。

 * 纯函数 — 不访问 Game/Memory。

 * @param from 源房
 * @param to 目标房
 * @param hops 路由跳数
 * @param travelTime 预估单程 tick 数
 * @param cost 运输成本
 * @param tick 当前 tick
 * @param via 中间房间列表
 */
export function createRoute(
  from: string,
  to: string,
  hops: number,
  travelTime: number,
  cost: number,
  tick: number,
  via: string[] = [],
): Route {
  return {
    routeId: makeRouteId(from, to),
    from,
    to,
    hops,
    travelTime,
    cost,
    risk: 0,
    traffic: 0,
    reliability: 1.0,
    status: hops >= 0 ? "active" : "blocked",
    lastEvaluated: tick,
    successRate: 1.0,
    totalTrips: 0,
    failedTrips: 0,
    via,
    createdAt: tick,
  };
}

// ─── 状态更新 ──────────────────────────────────────────────

/**
 * 标记路由不可达。
 * 纯函数 — 返回新对象。
 */
export function markRouteBlocked(route: Route, tick: number, reason?: string): Route {
  return { ...route, status: "blocked", lastEvaluated: tick };
}

/**
 * 标记路由恢复可用。
 * 纯函数 — 返回新对象。
 */
export function markRouteActive(route: Route, tick: number): Route {
  return { ...route, status: "active", lastEvaluated: tick };
}

/**
 * 标记路由暂停。
 * 纯函数 — 返回新对象。
 */
export function markRouteSuspended(route: Route, tick: number): Route {
  return { ...route, status: "suspended", lastEvaluated: tick };
}

/**
 * 标记路由永久失效。
 * 纯函数 — 返回新对象。
 */
export function markRouteFailed(route: Route, tick: number): Route {
  return { ...route, status: "failed", lastEvaluated: tick };
}

// ─── 运输记录 ──────────────────────────────────────────────

/**
 * 记录一次运输结果。
 * 更新 totalTrips / failedTrips / successRate。
 * 纯函数 — 返回新对象。
 */
export function recordTrip(route: Route, success: boolean, tick: number): Route {
  const totalTrips = route.totalTrips + 1;
  const failedTrips = route.failedTrips + (success ? 0 : 1);
  const successRate = totalTrips > 0 ? (totalTrips - failedTrips) / totalTrips : 1.0;
  return {
    ...route,
    totalTrips,
    failedTrips,
    successRate,
    lastEvaluated: tick,
  };
}

// ─── 评估 ──────────────────────────────────────────────────

/**
 * 更新路由的评估指标。
 * 纯函数 — 返回新对象。
 */
export function updateRouteEvaluation(
  route: Route,
  evaluation: {
    cost?: number;
    risk?: number;
    traffic?: number;
    reliability?: number;
    travelTime?: number;
    status?: RouteStatus;
  },
  tick: number,
): Route {
  return {
    ...route,
    cost: evaluation.cost ?? route.cost,
    risk: evaluation.risk ?? route.risk,
    traffic: evaluation.traffic ?? route.traffic,
    reliability: evaluation.reliability ?? route.reliability,
    travelTime: evaluation.travelTime ?? route.travelTime,
    status: evaluation.status ?? route.status,
    lastEvaluated: tick,
  };
}

// ─── 查询 ──────────────────────────────────────────────────

/**
 * 计算路由的综合评分（用于排序和选择最优路由）。
 * 分越高 = 越优。

 * 评分因子：
 *   - reliability (40%)
 *   - cost efficiency (30%) — 1 / (1 + cost/1000)
 *   - safety (20%) — 1 - risk
 *   - traffic flow (10%) — 1 - traffic

 * 纯函数。
 */
export function routeScore(route: Route): number {
  const reliabilityScore = route.reliability * 0.40;
  const costScore = (1 / (1 + route.cost / 1000)) * 0.30;
  const safetyScore = (1 - route.risk) * 0.20;
  const trafficScore = (1 - route.traffic) * 0.10;
  return reliabilityScore + costScore + safetyScore + trafficScore;
}

/**
 * 计算路由的效率比率 = delivered / cost（来自 route-efficiency.ts 的概念）。
 * 纯函数。
 */
export function routeEfficiencyRatio(route: Route, delivered: number): number {
  if (route.cost <= 0) return delivered > 0 ? Infinity : 0;
  return delivered / route.cost;
}

/**
 * 过滤可用路由。
 * 纯函数。
 */
export function filterUsableRoutes(routes: readonly Route[]): Route[] {
  return routes.filter(r => isRouteUsable(r.status));
}

/**
 * 按源房过滤路由。
 * 纯函数。
 */
export function filterRoutesFrom(routes: readonly Route[], from: string): Route[] {
  return routes.filter(r => r.from === from);
}

/**
 * 按目标房过滤路由。
 * 纯函数。
 */
export function filterRoutesTo(routes: readonly Route[], to: string): Route[] {
  return routes.filter(r => r.to === to);
}

/**
 * 查找从 from 到 to 的路由。
 * 纯函数。
 */
export function findRoute(
  routes: readonly Route[],
  from: string,
  to: string,
): Route | undefined {
  return routes.find(r => r.from === from && r.to === to);
}

// ─── 序列化 / 反序列化 ───────────────────────────────────

/**
 * Route 瘦快照（存入 Memory.kernel.routes）。
 * via 列表不持久化（每 tick 从 routeCache 重导出）。
 */
export interface RouteSnapshot {
  /** routeId。 */
  i: string;
  /** from。 */
  f: string;
  /** to。 */
  t: string;
  /** hops。 */
  h: number;
  /** travelTime。 */
  tt: number;
  /** cost。 */
  c: number;
  /** risk ×100。 */
  rk: number;
  /** traffic ×100。 */
  tr: number;
  /** reliability ×100。 */
  re: number;
  /** status code。 */
  s: string;
  /** lastEvaluated。 */
  le: number;
  /** successRate ×100。 */
  sr: number;
  /** totalTrips。 */
  tp: number;
  /** failedTrips。 */
  fp: number;
  /** createdAt。 */
  ca: number;
}

/** RouteStatus 编码。 */
function encodeRouteStatus(status: RouteStatus): string {
  switch (status) {
    case "active": return "A";
    case "congested": return "C";
    case "degraded": return "D";
    case "blocked": return "B";
    case "suspended": return "S";
    case "failed": return "F";
  }
}

/** RouteStatus 解码。 */
function decodeRouteStatus(code: string): RouteStatus {
  switch (code) {
    case "A": return "active";
    case "C": return "congested";
    case "D": return "degraded";
    case "B": return "blocked";
    case "S": return "suspended";
    case "F": return "failed";
    default: return "active";
  }
}

/**
 * 将 Route 序列化为 Memory 瘦快照。
 * 纯函数。
 */
export function serializeRoute(route: Route): RouteSnapshot {
  return {
    i: route.routeId,
    f: route.from,
    t: route.to,
    h: route.hops,
    tt: route.travelTime,
    c: Math.round(route.cost),
    rk: Math.round(route.risk * 100),
    tr: Math.round(route.traffic * 100),
    re: Math.round(route.reliability * 100),
    s: encodeRouteStatus(route.status),
    le: route.lastEvaluated,
    sr: Math.round(route.successRate * 100),
    tp: route.totalTrips,
    fp: route.failedTrips,
    ca: route.createdAt,
  };
}

/**
 * 从 Memory 瘦快照反序列化 Route。
 * 纯函数。via 列表不持久化（每 tick 重导出）。
 */
export function deserializeRoute(s: RouteSnapshot): Route {
  return {
    routeId: s.i,
    from: s.f,
    to: s.t,
    hops: s.h,
    travelTime: s.tt,
    cost: s.c,
    risk: s.rk / 100,
    traffic: s.tr / 100,
    reliability: s.re / 100,
    status: decodeRouteStatus(s.s),
    lastEvaluated: s.le,
    successRate: s.sr / 100,
    totalTrips: s.tp,
    failedTrips: s.fp,
    via: [],
    createdAt: s.ca,
  };
}
