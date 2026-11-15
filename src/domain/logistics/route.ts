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
export type RouteStatus = "active" | "congested" | "degraded" | "blocked" | "suspended" | "failed";

/**
 * 判定 Route 状态是否可用（可分配运输任务）。
 * 纯函数。
 */
export function isRouteUsable(status: RouteStatus): boolean {
  return status === "active" || status === "congested" || status === "degraded";
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

// ─── 运输记录 ──────────────────────────────────────────────

// ─── 评估 ──────────────────────────────────────────────────

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
  const reliabilityScore = route.reliability * 0.4;
  const costScore = (1 / (1 + route.cost / 1000)) * 0.3;
  const safetyScore = (1 - route.risk) * 0.2;
  const trafficScore = (1 - route.traffic) * 0.1;
  return reliabilityScore + costScore + safetyScore + trafficScore;
}

// ─── 序列化 / 反序列化 ───────────────────────────────────

/** RouteStatus 编码。 */

/** RouteStatus 解码。 */
