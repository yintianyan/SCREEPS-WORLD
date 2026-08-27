/** Transport Accounting */

// ─── Transport Accounting 模型 ────────────────────────────

/**
 * Transport Accounting — 单 Request 级会计。
 */
export interface TransportAccounting {
  /** 关联的 Request ID。 */
  requestId: string;
  /** 请求总量。 */
  requested: number;
  /** 已分配量（所有 Assignment 的 assignedAmount 之和）。 */
  assigned: number;
  /** 已装载量。 */
  loaded: number;
  /** 已交付量。 */
  delivered: number;
  /** 损失量。 */
  lost: number;
  /** 剩余量（requested - delivered - lost）。 */
  remaining: number;
  /** 运输成本。 */
  cost: number;
  /** ROI = delivered / cost。 */
  roi: number;
}

// ─── 创建 ──────────────────────────────────────────────────

/**
 * 创建空 Transport Accounting。
 * 纯函数。
 */
export function createAccounting(requestId: string, requestedAmount: number): TransportAccounting {
  return {
    requestId,
    requested: Math.max(0, Math.floor(requestedAmount)),
    assigned: 0,
    loaded: 0,
    delivered: 0,
    lost: 0,
    remaining: Math.max(0, Math.floor(requestedAmount)),
    cost: 0,
    roi: 0,
  };
}

// ─── 累加操作 ──────────────────────────────────────────────

/**
 * 累加分配量。
 * 纯函数 — 返回新对象。
 */
export function recordAssigned(acc: TransportAccounting, amount: number): TransportAccounting {
  const assigned = acc.assigned + Math.max(0, amount);
  return { ...acc, assigned };
}

/**
 * 累加装载量。
 * 纯函数 — 返回新对象。
 */
export function recordLoaded(acc: TransportAccounting, amount: number): TransportAccounting {
  const loaded = acc.loaded + Math.max(0, amount);
  return { ...acc, loaded };
}

/**
 * 累加交付量。
 * 同时更新 remaining 和 roi。
 * 纯函数 — 返回新对象。
 */
export function recordDelivered(acc: TransportAccounting, amount: number): TransportAccounting {
  const delivered = acc.delivered + Math.max(0, amount);
  const remaining = computeRemaining({ ...acc, delivered });
  const roi = computeROI({ ...acc, delivered, remaining });
  return { ...acc, delivered, remaining, roi };
}

/**
 * 累加损失量。
 * 同时更新 remaining。
 * 纯函数 — 返回新对象。
 */
export function recordLost(acc: TransportAccounting, amount: number): TransportAccounting {
  const lost = acc.lost + Math.max(0, amount);
  const remaining = computeRemaining({ ...acc, lost });
  return { ...acc, lost, remaining };
}

/**
 * 设置运输成本。
 * 同时更新 roi。
 * 纯函数 — 返回新对象。
 */
export function setCost(acc: TransportAccounting, cost: number): TransportAccounting {
  const roi = cost > 0 ? acc.delivered / cost : (acc.delivered > 0 ? Infinity : 0);
  return { ...acc, cost: Math.max(0, cost), roi };
}

// ─── 计算工具 ──────────────────────────────────────────────

/**
 * 计算剩余量 = requested - delivered - lost。
 * 纯函数。
 */
export function computeRemaining(acc: TransportAccounting): number {
  return Math.max(0, acc.requested - acc.delivered - acc.lost);
}

/**
 * 计算 ROI = delivered / cost。
 * 纯函数。
 */
export function computeROI(acc: TransportAccounting): number {
  if (acc.cost <= 0) return acc.delivered > 0 ? Infinity : 0;
  return acc.delivered / acc.cost;
}

/**
 * 计算交付率 = delivered / requested。
 * 纯函数。
 */
export function deliveryRate(acc: TransportAccounting): number {
  if (acc.requested <= 0) return 0;
  return Math.min(1, acc.delivered / acc.requested);
}

/**
 * 计算损失率 = lost / requested。
 * 纯函数。
 */
export function lossRate(acc: TransportAccounting): number {
  if (acc.requested <= 0) return 0;
  return Math.min(1, acc.lost / acc.requested);
}

/**
 * 判断是否完成（delivered >= requested）。
 * 纯函数。
 */
export function isComplete(acc: TransportAccounting): boolean {
  return acc.delivered >= acc.requested;
}

/**
 * 判断是否有损失。
 * 纯函数。
 */
export function hasLoss(acc: TransportAccounting): boolean {
  return acc.lost > 0;
}

// ─── 批量统计 ─────────────────────────────────────────────

/**
 * 批量统计多个 Request 的会计。
 * 纯函数。
 */
export function summarizeAccounting(accounts: readonly TransportAccounting[]): {
  totalRequested: number;
  totalAssigned: number;
  totalLoaded: number;
  totalDelivered: number;
  totalLost: number;
  totalRemaining: number;
  totalCost: number;
  avgDeliveryRate: number;
  avgLossRate: number;
  completedCount: number;
  activeCount: number;
} {
  let totalRequested = 0;
  let totalAssigned = 0;
  let totalLoaded = 0;
  let totalDelivered = 0;
  let totalLost = 0;
  let totalRemaining = 0;
  let totalCost = 0;
  let completedCount = 0;
  let activeCount = 0;

  for (const acc of accounts) {
    totalRequested += acc.requested;
    totalAssigned += acc.assigned;
    totalLoaded += acc.loaded;
    totalDelivered += acc.delivered;
    totalLost += acc.lost;
    totalRemaining += acc.remaining;
    totalCost += acc.cost;
    if (isComplete(acc)) completedCount++;
    else activeCount++;
  }

  return {
    totalRequested,
    totalAssigned,
    totalLoaded,
    totalDelivered,
    totalLost,
    totalRemaining,
    totalCost,
    avgDeliveryRate: totalRequested > 0 ? totalDelivered / totalRequested : 0,
    avgLossRate: totalRequested > 0 ? totalLost / totalRequested : 0,
    completedCount,
    activeCount,
  };
}
