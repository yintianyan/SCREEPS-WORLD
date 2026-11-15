/** Remote Mining Operation */

import type { OperationContext, OperationStatus, OperationPriority } from "./agenda-item";
import { makeRemoteMiningOperationId, isActive } from "./agenda-item";

// ─── 检查点 ─────────────────────────────────────────────

/**
 * Remote Operation Checkpoint — 远矿运营的阶段性检查点。

 * 状态流转：
 *   DISCOVERED → VALIDATED → PREPARED → INFRASTRUCTURE_READY
 *     → MINING_ACTIVE → LOGISTICS_ACTIVE → ECONOMIC_ACTIVE

 * - DISCOVERED: intel 发现远矿候选
 * - VALIDATED: Execution Gate 通过
 * - PREPARED: spawn 请求提交
 * - INFRASTRUCTURE_READY: container 建成或 drop-mining 可接受
 * - MINING_ACTIVE: harvester 就位，production > 0
 * - LOGISTICS_ACTIVE: hauler 就位，delivered > 0
 * - ECONOMIC_ACTIVE: 连续窗口 netValue > threshold
 */
export type RemoteCheckpoint =
  | "discovered"
  | "validated"
  | "prepared"
  | "infrastructure_ready"
  | "mining_active"
  | "logistics_active"
  | "economic_active";

/** 检查点顺序（用于比较进度）。 */
export const CHECKPOINT_ORDER: readonly RemoteCheckpoint[] = [
  "discovered",
  "validated",
  "prepared",
  "infrastructure_ready",
  "mining_active",
  "logistics_active",
  "economic_active",
] as const;

/** 获取检查点的序号（0-based）。纯函数。 */
export function checkpointIndex(cp: RemoteCheckpoint): number {
  return CHECKPOINT_ORDER.indexOf(cp);
}

/** 判断 checkpoint A 是否在 B 之后。纯函数。 */
export function isAfter(a: RemoteCheckpoint, b: RemoteCheckpoint): boolean {
  return checkpointIndex(a) > checkpointIndex(b);
}

// ─── 经济健康度 ─────────────────────────────────────────

/**
 * Remote Economic Health — 远矿经济健康度五级。

 * - HEALTHY:      净价值 > 阈值 且 ROI > 预期 — 正常运营
 * - DEGRADED:     净价值 > 0 但 < 阈值，或运输 < 产出 — 监控
 * - UNPROFITABLE: 净价值 ≤ 0 持续 N 周期 — 暂停等待改善
 * - SUSPENDED:    威胁/预算耗尽/主动暂停 — 停止孵化回收 creep
 * - FAILED:        永久不可恢复（房间丢失/source 耗尽）— 归档删除
 */
export type RemoteEconomicHealth = "healthy" | "degraded" | "unprofitable" | "suspended" | "failed";

// ─── 预算 ──────────────────────────────────────────────

/**
 * Remote Operation Budget — 远矿运营预算追踪。

 * budgetLimit: 总预算上限（能量），由 CONFIG 配置。
 * consumed: 已消耗累计（spawn 成本 + 运输成本 + 基建成本 + 风险成本）。
 * remaining = limit - consumed.
 */
export interface RemoteOperationBudget {
  /** 预算上限（能量）。 */
  limit: number;
  /** 已消耗（能量）。 */
  consumed: number;
}

// ─── RemoteMiningOperationContext ───────────────────────

/**
 * RemoteMiningOperationContext — 远矿运营的完整运行时上下文。

 * 扩展 OperationContext，增加远矿特有字段。
 * 不修改原 OperationContext 接口——通过 extends 扩展。
 */
export interface RemoteMiningOperationContext extends OperationContext {
  /** 操作类型固定为 remote_mining。 */
  type: "remote_mining";

  // ── 远矿特有字段 ──
  /** RemoteSource 幂等键（"remote:${homeRoom}:${targetRoom}"）。 */
  sourceId: string;
  /** 预期产出速率（e/tick）。 */
  expectedYield: number;
  /** source 数量（1 或 2）。 */
  sourceCount: number;

  // ── 经济追踪（累计值）──
  /** 实际产出累计（能量）。 */
  actualProduction: number;
  /** 实际交付累计（能量）。 */
  actualDelivered: number;
  /** 损失累计（能量，含 drop/destroyed/container 满溢出）。 */
  actualLost: number;
  /** 最近一次产出 tick（用于检测停产）。 */
  lastProductionTick: number | undefined;
  /** 最近一次交付 tick（用于检测物流中断）。 */
  lastDeliveryTick: number | undefined;

  // ── 预算 ──
  budget: RemoteOperationBudget;

  // ── 检查点 ──
  checkpoint: RemoteCheckpoint;
  /** 检查点进入时间（用于超时检测）。 */
  checkpointSince: number;

  // ── 经济健康度 ──
  economicHealth: RemoteEconomicHealth;
  /** 健康度变更 tick。 */
  healthSince: number;

  // ── 经济激活窗口 ──
  /** 经济激活连续窗口计数。 */
  activationWindow: number;
  /** 经济激活所需连续窗口数。 */
  activationThreshold: number;
}

// ─── 创建 ──────────────────────────────────────────────

/**
 * 创建 RemoteMiningOperationContext 的输入参数。
 */
export interface CreateRemoteMiningOpInput {
  homeRoom: string;
  targetRoom: string;
  sourceId: string;
  sourceCount: number;
  expectedYield: number;
  budgetLimit: number;
  priority: OperationPriority;
  deadline: number;
  tick: number;
  /** 经济激活所需连续窗口数。 */
  activationThreshold: number;
  maxRetries?: number;
}

/**
 * 创建 RemoteMiningOperationContext。

 * 初始状态：
 * - status = planned
 * - checkpoint = discovered
 * - economicHealth = healthy
 * - budget = { limit: budgetLimit, consumed: 0 }
 * - 经济追踪全部归零

 * 纯函数 — 不访问 Game/Memory。
 */
export function createRemoteMiningOp(
  input: CreateRemoteMiningOpInput,
): RemoteMiningOperationContext {
  return {
    id: makeRemoteMiningOperationId(input.homeRoom, input.targetRoom),
    type: "remote_mining",
    status: "planned",
    sourceRoom: input.homeRoom,
    targetRoom: input.targetRoom,
    requestedAmount: input.budgetLimit,
    deliveredAmount: 0,
    reservedAmount: 0,
    priority: input.priority,
    resource: "energy",
    deadline: input.deadline,
    createdAt: input.tick,
    updatedAt: input.tick,
    retries: 0,
    maxRetries: input.maxRetries ?? 5,

    // 远矿特有
    sourceId: input.sourceId,
    expectedYield: input.expectedYield,
    sourceCount: input.sourceCount,

    // 经济追踪
    actualProduction: 0,
    actualDelivered: 0,
    actualLost: 0,
    lastProductionTick: undefined,
    lastDeliveryTick: undefined,

    // 预算
    budget: { limit: input.budgetLimit, consumed: 0 },

    // 检查点
    checkpoint: "discovered",
    checkpointSince: input.tick,

    // 经济健康度
    economicHealth: "healthy",
    healthSince: input.tick,

    // 经济激活窗口
    activationWindow: 0,
    activationThreshold: input.activationThreshold,
  };
}

// ─── 状态转换 ──────────────────────────────────────────

/**
 * 更新 Operation 状态。
 * 纯函数 — 返回新对象。
 */
export function updateOpStatus(
  op: RemoteMiningOperationContext,
  newStatus: OperationStatus,
  tick: number,
): RemoteMiningOperationContext {
  return { ...op, status: newStatus, updatedAt: tick };
}

/**
 * 推进检查点（只能向前推进，不能回退）。
 * 如果尝试推进到比当前更早的检查点，忽略。
 * 纯函数 — 返回新对象。
 */
export function advanceCheckpoint(
  op: RemoteMiningOperationContext,
  cp: RemoteCheckpoint,
  tick: number,
): RemoteMiningOperationContext {
  if (!isAfter(cp, op.checkpoint)) return op;
  return {
    ...op,
    checkpoint: cp,
    checkpointSince: tick,
    updatedAt: tick,
  };
}

/**
 * 更新经济健康度。
 * 纯函数 — 返回新对象。
 */
export function updateEconomicHealth(
  op: RemoteMiningOperationContext,
  health: RemoteEconomicHealth,
  tick: number,
): RemoteMiningOperationContext {
  if (op.economicHealth === health) return op;
  return {
    ...op,
    economicHealth: health,
    healthSince: tick,
    updatedAt: tick,
  };
}

// ─── 经济追踪 ──────────────────────────────────────────

// ─── 经济激活窗口 ──────────────────────────────────────

/**
 * 递增经济激活窗口计数。
 * 满足激活条件时调用——连续 N 个窗口满足后激活 ECONOMIC_ACTIVE。
 * 纯函数 — 返回新对象。
 */
export function incrementActivationWindow(
  op: RemoteMiningOperationContext,
  tick: number,
): RemoteMiningOperationContext {
  const window = op.activationWindow + 1;
  const reached = window >= op.activationThreshold;
  return {
    ...op,
    activationWindow: window,
    ...(reached && op.checkpoint !== "economic_active"
      ? advanceCheckpoint({ ...op, activationWindow: window }, "economic_active", tick)
      : {}),
    updatedAt: tick,
  };
}

/**
 * 重置经济激活窗口计数（条件不满足时调用）。
 * 纯函数 — 返回新对象。
 */
export function resetActivationWindow(
  op: RemoteMiningOperationContext,
  tick: number,
): RemoteMiningOperationContext {
  if (op.activationWindow === 0) return op;
  return {
    ...op,
    activationWindow: 0,
    updatedAt: tick,
  };
}

// ─── 预算操作 ──────────────────────────────────────────

// ─── 查询 ──────────────────────────────────────────────

/**
 * 判定 Operation 是否已经济激活（checkpoint = economic_active）。
 * 纯函数。
 */
export function isEconomicallyActive(op: RemoteMiningOperationContext): boolean {
  return op.checkpoint === "economic_active";
}

// ─── 序列化 ──────────────────────────────────────────────

/**
 * RemoteMiningOperation 的瘦快照（存入 Memory）。
 * 使用短 key 节省 Memory。
 */
export interface RemoteMiningOpSnapshot {
  i: string; // id
  s: string; // status code
  h: string; // homeRoom (sourceRoom)
  t: string; // targetRoom
  si: string; // sourceId
  sc: number; // sourceCount
  ey: number; // expectedYield
  pr: number; // actualProduction
  de: number; // actualDelivered
  lo: number; // actualLost
  lp: number | undefined; // lastProductionTick
  ld: number | undefined; // lastDeliveryTick
  bl: number; // budget.limit
  bc: number; // budget.consumed
  cp: string; // checkpoint code
  cs: number; // checkpointSince
  eh: string; // economicHealth code
  hs: number; // healthSince
  aw: number; // activationWindow
  at: number; // activationThreshold
  ca: number; // createdAt
  ua: number; // updatedAt
  rt: number; // retries
  mt: number; // maxRetries
  dl: number; // deadline
  pr2: number; // priority
  cd?: number; // cooldownUntil
  le?: string; // lastError
}

/** 状态码映射。 */
const STATUS_CODES: Record<OperationStatus, string> = {
  planned: "P",
  ready: "R",
  running: "RU",
  verifying: "V",
  completed: "C",
  blocked: "B",
  failed: "F",
  cancelled: "CA",
  expired: "E",
};

/** 状态码逆向映射。 */
const STATUS_DECODE: Record<string, OperationStatus> = {
  P: "planned",
  R: "ready",
  RU: "running",
  V: "verifying",
  C: "completed",
  B: "blocked",
  F: "failed",
  CA: "cancelled",
  E: "expired",
};

/** 检查点码映射。 */
const CHECKPOINT_CODES: Record<RemoteCheckpoint, string> = {
  discovered: "D",
  validated: "V",
  prepared: "P",
  infrastructure_ready: "IR",
  mining_active: "MA",
  logistics_active: "LA",
  economic_active: "EA",
};

/** 检查点码逆向映射。 */
const CHECKPOINT_DECODE: Record<string, RemoteCheckpoint> = {
  D: "discovered",
  V: "validated",
  P: "prepared",
  IR: "infrastructure_ready",
  MA: "mining_active",
  LA: "logistics_active",
  EA: "economic_active",
};

/** 健康度码映射。 */
const HEALTH_CODES: Record<RemoteEconomicHealth, string> = {
  healthy: "H",
  degraded: "D",
  unprofitable: "U",
  suspended: "S",
  failed: "F",
};

/** 健康度码逆向映射。 */
const HEALTH_DECODE: Record<string, RemoteEconomicHealth> = {
  H: "healthy",
  D: "degraded",
  U: "unprofitable",
  S: "suspended",
  F: "failed",
};

/**
 * 序列化 RemoteMiningOperation 为瘦快照。
 * 纯函数。
 */
export function serializeRemoteMiningOp(op: RemoteMiningOperationContext): RemoteMiningOpSnapshot {
  return {
    i: op.id,
    s: STATUS_CODES[op.status] ?? "P",
    h: op.sourceRoom,
    t: op.targetRoom,
    si: op.sourceId,
    sc: op.sourceCount,
    ey: Math.round(op.expectedYield),
    pr: Math.round(op.actualProduction),
    de: Math.round(op.actualDelivered),
    lo: Math.round(op.actualLost),
    lp: op.lastProductionTick,
    ld: op.lastDeliveryTick,
    bl: op.budget.limit,
    bc: op.budget.consumed,
    cp: CHECKPOINT_CODES[op.checkpoint] ?? "D",
    cs: op.checkpointSince,
    eh: HEALTH_CODES[op.economicHealth] ?? "H",
    hs: op.healthSince,
    aw: op.activationWindow,
    at: op.activationThreshold,
    ca: op.createdAt,
    ua: op.updatedAt,
    rt: op.retries,
    mt: op.maxRetries,
    dl: op.deadline,
    pr2: op.priority,
    cd: op.cooldownUntil,
    le: op.lastError,
  };
}

/**
 * 从瘦快照反序列化 RemoteMiningOperation。
 * 纯函数。
 */
export function deserializeRemoteMiningOp(
  snap: RemoteMiningOpSnapshot,
): RemoteMiningOperationContext {
  return {
    id: snap.i,
    type: "remote_mining",
    status: STATUS_DECODE[snap.s] ?? "planned",
    sourceRoom: snap.h,
    targetRoom: snap.t,
    requestedAmount: snap.bl, // budgetLimit
    deliveredAmount: snap.de, // actualDelivered
    reservedAmount: 0,
    priority: snap.pr2 as OperationPriority,
    resource: "energy",
    deadline: snap.dl,
    createdAt: snap.ca,
    updatedAt: snap.ua,
    retries: snap.rt,
    maxRetries: snap.mt,
    cooldownUntil: snap.cd,
    lastError: snap.le,
    // 远矿特有
    sourceId: snap.si,
    expectedYield: snap.ey,
    sourceCount: snap.sc,
    actualProduction: snap.pr,
    actualDelivered: snap.de,
    actualLost: snap.lo,
    lastProductionTick: snap.lp,
    lastDeliveryTick: snap.ld,
    budget: { limit: snap.bl, consumed: snap.bc },
    checkpoint: CHECKPOINT_DECODE[snap.cp] ?? "discovered",
    checkpointSince: snap.cs,
    economicHealth: HEALTH_DECODE[snap.eh] ?? "healthy",
    healthSince: snap.hs,
    activationWindow: snap.aw,
    activationThreshold: snap.at,
  };
}

// ─── 批量操作 ──────────────────────────────────────────

/**
 * 查找指定 (homeRoom, targetRoom) 的活跃 RemoteMiningOperation。
 * 纯函数。
 */
export function findActiveRemoteMiningOp(
  ops: readonly RemoteMiningOperationContext[],
  homeRoom: string,
  targetRoom: string,
): RemoteMiningOperationContext | undefined {
  const id = makeRemoteMiningOperationId(homeRoom, targetRoom);
  return ops.find(o => o.id === id && isActive(o));
}

/**
 * 检查是否已存在指定 (homeRoom, targetRoom) 的活跃 RemoteMiningOperation。
 * 纯函数——幂等性检查。
 */
export function hasActiveRemoteMiningOp(
  ops: readonly RemoteMiningOperationContext[],
  homeRoom: string,
  targetRoom: string,
): boolean {
  return findActiveRemoteMiningOp(ops, homeRoom, targetRoom) !== undefined;
}

/**
 * 过滤出运营中（非终态）的远矿 Operation。
 * 纯函数。
 */
export function filterActiveRemoteMiningOps(
  ops: readonly RemoteMiningOperationContext[],
): RemoteMiningOperationContext[] {
  return ops.filter(o => isActive(o));
}
