/** Request Lifecycle */

import type { TransportRequestV2, TransportStatus } from "./transport-request";
import { isTerminal } from "./transport-request";

// ─── 状态转换结果 ──────────────────────────────────────────

/**
 * 状态转换结果。
 * 与 operation/lifecycle.ts 的 TransitionResult 一致模式。
 */
export interface TransitionResult {
  /** 转换后的 Request。 */
  req: TransportRequestV2;
  /** 是否成功转换（false = 非法转换，原 req 不变）。 */
  ok: boolean;
  /** 失败原因（ok=false 时填充）。 */
  reason?: string;
}

// ─── 合法状态转换图 ────────────────────────────────────────

/**
 * 合法的前进状态转换图。
 * key = 源状态，value = 可到达的目标状态集合。

 * 注意：
 * - 终态（delivered/failed/cancelled）不可转换
 * - 任何活跃状态 → cancelled 都允许（外部取消）
 * - blocked → planned（重试）
 * - partial → planned（生成 remaining request）
 */
const VALID_TRANSITIONS: ReadonlyMap<TransportStatus, ReadonlySet<TransportStatus>> = new Map([
  ["pending",    new Set(["planned", "cancelled"] as const)],
  ["planned",    new Set(["assigned", "cancelled"] as const)],
  ["assigned",   new Set(["in_transit", "blocked", "failed", "cancelled"] as const)],
  ["in_transit", new Set(["delivering", "blocked", "failed", "cancelled"] as const)],
  ["delivering", new Set(["delivered", "partial", "failed", "cancelled"] as const)],
  ["delivered",  new Set() as ReadonlySet<TransportStatus>],
  ["partial",    new Set(["planned", "cancelled"] as const)],
  ["blocked",    new Set(["planned", "failed", "cancelled"] as const)],
  ["failed",     new Set() as ReadonlySet<TransportStatus>],
  ["cancelled",  new Set() as ReadonlySet<TransportStatus>],
]);

/**
 * 检查状态转换是否合法。
 * 纯函数。
 */
export function canTransition(from: TransportStatus, to: TransportStatus): boolean {
  if (from === to) return true; // 自转换合法（幂等）
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? allowed.has(to) : false;
}

// ─── 通用状态转换 ──────────────────────────────────────────

/**
 * 通用状态转换函数 — 验证合法后更新状态。
 * 不允许跳跃转换（如 pending → in_transit 非法）。

 * 纯函数 — 返回新对象，不修改原对象。
 */
function transition(
  req: TransportRequestV2,
  to: TransportStatus,
  tick: number,
  reason?: string,
): TransitionResult {
  if (!canTransition(req.status, to)) {
    return {
      req,
      ok: false,
      reason: `illegal transition: ${req.status} → ${to}`,
    };
  }
  if (req.status === to) {
    return { req, ok: true }; // 幂等
  }
  return {
    req: { ...req, status: to, updatedAt: tick },
    ok: true,
  };
}

// ─── 便捷转换函数 ──────────────────────────────────────────

/**
 * pending → planned：已纳入 Transport Plan。
 * 纯函数。
 */
export function markPlanned(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "planned", tick);
}

/**
 * planned → assigned：已分配给 hauler/carrier。
 * 纯函数。
 */
export function markAssigned(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "assigned", tick);
}

/**
 * assigned → in_transit：creep 已装载并出发。
 * 纯函数。
 */
export function markInTransit(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "in_transit", tick);
}

/**
 * in_transit → delivering：到达目的地，正在卸货。
 * 纯函数。
 */
export function markDelivering(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "delivering", tick);
}

/**
 * delivering → delivered：全部送达。
 * 纯函数。
 */
export function markDelivered(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "delivered", tick);
}

/**
 * delivering → partial：部分送达（剩余部分可重新规划）。
 * 纯函数。
 */
export function markPartial(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "partial", tick);
}

/**
 * 任意活跃态 → blocked：路径/资源阻塞。
 * 纯函数。
 */
export function markBlocked(req: TransportRequestV2, tick: number, reason?: string): TransitionResult {
  return transition(req, "blocked", tick, reason);
}

/**
 * blocked → planned：重试（重新规划）。
 * 纯函数。
 */
export function retryFromBlocked(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "planned", tick);
}

/**
 * partial → planned：生成 remaining request 后重新规划。
 * 纯函数。
 */
export function replanFromPartial(req: TransportRequestV2, tick: number): TransitionResult {
  return transition(req, "planned", tick);
}

/**
 * 任意活跃态 → failed：不可恢复失败。
 * 纯函数。
 */
export function markFailed(req: TransportRequestV2, tick: number, reason?: string): TransitionResult {
  return transition(req, "failed", tick, reason);
}

/**
 * 任意活跃态 → cancelled：外部取消。
 * 纯函数。
 */
export function markCancelled(req: TransportRequestV2, tick: number, reason?: string): TransitionResult {
  return transition(req, "cancelled", tick, reason);
}

// ─── 超时检查 ──────────────────────────────────────────────

/**
 * 超时检查 — 如果 Request 已超时且仍活跃，转为 failed。
 * 与 operation/lifecycle.ts 的 checkExpiry 一致模式。

 * 纯函数。
 */
export function checkExpiry(req: TransportRequestV2, tick: number): TransitionResult {
  // 终态不检查
  if (isTerminal(req.status)) return { req, ok: true };
  // 超时 → failed
  if (tick > req.deadline) {
    return markFailed(req, tick, "deadline exceeded");
  }
  return { req, ok: true };
}

// ─── 批量处理 ─────────────────────────────────────────────

/**
 * 批量超时检查。
 * 对一组 Request 执行 checkExpiry，返回更新后的数组。
 * 纯函数。
 */
export function batchCheckExpiry(
  requests: readonly TransportRequestV2[],
  tick: number,
): TransportRequestV2[] {
  return requests.map(req => {
    const result = checkExpiry(req, tick);
    return result.req;
  });
}
