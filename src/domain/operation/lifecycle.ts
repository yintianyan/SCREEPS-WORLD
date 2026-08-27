/** Operation Lifecycle */

import type { OperationContext, OperationStatus } from "./agenda-item";

/** 状态转换结果。 */
export interface TransitionResult {
  /** 转换后的操作上下文。 */
  op: OperationContext;
  /** 是否成功转换（false = 非法转换，原 op 不变）。 */
  ok: boolean;
  /** 失败原因（ok=false 时填充）。 */
  reason?: string;
}

/** 合法的前进状态转换图。 */
const FORWARD: Record<OperationStatus, OperationStatus | null> = {
  planned: "ready",
  ready: "running",
  running: "verifying",
  verifying: "completed",
  completed: null,
  blocked: "ready",
  failed: null,
  cancelled: null,
  expired: null,
};

/**
 * 通用状态转换函数 — 验证合法后更新状态。
 * 不允许跳跃转换（planned → running 非法）。
 */
function transition(
  op: OperationContext,
  to: OperationStatus,
  tick: number,
  reason?: string,
): TransitionResult {
  const forward = FORWARD[op.status];
  if (forward !== to) {
    // 特殊处理：任何活跃状态 → blocked / failed / cancelled / expired 都允许
    const isTerminalish =
      to === "blocked" || to === "failed" || to === "cancelled" || to === "expired";
    if (!isTerminalish) {
      return { op, ok: false, reason: `illegal transition: ${op.status} → ${to}` };
    }
    // 从终态不允许转换
    if (op.status === "completed" || op.status === "failed" || op.status === "cancelled" || op.status === "expired") {
      return { op, ok: false, reason: `terminal state: ${op.status}` };
    }
  }
  return {
    op: { ...op, status: to, updatedAt: tick, lastError: reason ?? op.lastError },
    ok: true,
  };
}

/** planned → ready：资源已确认可预留。 */
export function markReady(op: OperationContext, tick: number): TransitionResult {
  return transition(op, "ready", tick);
}

/** ready → running：TransportRequest 已提交到物流池。 */
export function markRunning(op: OperationContext, tick: number): TransitionResult {
  return transition(op, "running", tick);
}

/** running → verifying：Carrier 报告已到达目标，进入验证阶段。 */
export function markVerifying(op: OperationContext, tick: number): TransitionResult {
  return transition(op, "verifying", tick);
}

/** verifying → completed：目标增量验证通过。 */
export function markCompleted(op: OperationContext, tick: number): TransitionResult {
  return transition(op, "completed", tick);
}

/** 任意活跃态 → blocked：资源不足/路由不可用等暂时性失败。 */
export function markBlocked(op: OperationContext, tick: number, reason: string): TransitionResult {
  return transition(op, "blocked", tick, reason);
}

/** blocked → ready（重试）：冷却后重新就绪。 */
export function retryFromBlocked(op: OperationContext, tick: number): TransitionResult {
  if (op.status !== "blocked") {
    return { op, ok: false, reason: `retry only from blocked, got ${op.status}` };
  }
  if (op.retries >= op.maxRetries) {
    return { op, ok: false, reason: "max retries reached" };
  }
  return {
    op: { ...op, status: "ready", retries: op.retries + 1, updatedAt: tick },
    ok: true,
  };
}

/** 任意活跃态 → failed：不可恢复的失败（重试上限/目标消失）。 */
export function markFailed(op: OperationContext, tick: number, reason: string): TransitionResult {
  const result = transition(op, "failed", tick, reason);
  if (result.ok) {
    result.op.cooldownUntil = tick + 200; // 200 tick 重建冷却
  }
  return result;
}

/** 任意活跃态 → cancelled：外部取消（目标不再需要/Target 进入 Critical）。 */
export function markCancelled(op: OperationContext, tick: number, reason: string): TransitionResult {
  return transition(op, "cancelled", tick, reason);
}

/** 任意活跃态 → expired：超时。 */
export function markExpired(op: OperationContext, tick: number): TransitionResult {
  return transition(op, "expired", tick, "deadline exceeded");
}

/**
 * 超时检查 — 如果操作已超时且仍活跃，转为 expired。
 */
export function checkExpiry(op: OperationContext, tick: number): TransitionResult {
  if (op.status !== "expired" && op.status !== "completed" && op.status !== "failed" && op.status !== "cancelled") {
    if (tick > op.deadline) {
      return markExpired(op, tick);
    }
  }
  return { op, ok: true };
}

/**
 * 更新已送达量 — Carrier 报告部分送达时调用。
 * deliveredAmount 达到 requestedAmount 时自动从 verifying → completed。
 */
export function reportDelivery(
  op: OperationContext,
  amount: number,
  tick: number,
): OperationContext {
  const deliveredAmount = Math.min(op.requestedAmount, op.deliveredAmount + amount);
  let status = op.status;
  if (deliveredAmount >= op.requestedAmount && status === "verifying") {
    status = "completed";
  }
  return { ...op, deliveredAmount, status, updatedAt: tick };
}
