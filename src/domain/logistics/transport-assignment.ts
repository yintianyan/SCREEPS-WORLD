/**
 * Transport Assignment — A4.3 Phase 1：运输分配模型。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #2（无统一 Transport Assignment）、
 * §10 #2。
 *
 * 设计意图：
 *   现有 hauler/carrier/remoteHauler 各自通过 memory.assignment 驱动，无正式
 *   Assignment 对象。`TransportAssignment` 是统一分配模型，追踪：
 *   - 哪个 creep 服务哪个 Request
 *   - 分配了多少、装载了多少、交付了多少、损失了多少
 *   - 路由 ID（关联 Route 一等对象）
 *
 *   Assignment 与 Request 分离——一个 Request 可被多个 Assignment 满足
 *   （Multi-Source Fulfillment）。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { ResourceType } from "../operation/agenda-item";

// ─── Assignment 状态 ──────────────────────────────────────

/**
 * Transport Assignment 状态。
 *
 * - assigned:   已分配，creep 尚未行动
 * - loading:    正在装载（在 source 取资源）
 * - in_transit: 运输中（前往 destination）
 * - unloading:  正在卸货（在 destination 放资源）
 * - completed:  完成（终态）
 * - failed:     失败（creep 死亡/路径不可达/资源消失）（终态）
 * - recycled:   creep 被回收（终态）
 */
export type AssignmentStatus =
  | "assigned"
  | "loading"
  | "in_transit"
  | "unloading"
  | "completed"
  | "failed"
  | "recycled";

/**
 * 判定 Assignment 状态是否终态。
 * 纯函数。
 */
export function isAssignmentTerminal(status: AssignmentStatus): boolean {
  return status === "completed" || status === "failed" || status === "recycled";
}

/**
 * 判定 Assignment 状态是否活跃。
 * 纯函数。
 */
export function isAssignmentActive(status: AssignmentStatus): boolean {
  return !isAssignmentTerminal(status);
}

// ─── Transport Assignment 模型 ─────────────────────────────

/**
 * 运输角色类型。
 * 与现有角色系统对齐（hauler/carrier/remoteHauler/distributor）。
 */
export type TransportRole = "hauler" | "carrier" | "remoteHauler" | "distributor";

/**
 * Transport Assignment — 运输分配模型。
 *
 * 一个 Assignment 表示「creep X 被分配去完成 Request Y 的一部分」。
 *
 * 生命周期：
 *   assigned → loading → in_transit → unloading → completed
 *                              ↓               ↓
 *                           failed          failed
 *
 * 一个 Request 可以有多个 Assignment（Multi-Source Fulfillment）：
 *   Request(5000 energy, roomA → roomB)
 *     ├── Assignment1(hauler1, 2000 energy)
 *     ├── Assignment2(hauler2, 2000 energy)
 *     └── Assignment3(hauler3, 1000 energy)
 *
 * 字段设计原则（MEMORY_ARCHITECTURE）：
 * - 存储在 Memory.kernel.transportAssignments（瘦快照）
 * - 终态后归档删除
 */
export interface TransportAssignment {
  /** 全局唯一 ID："ta:<requestId>:<creepName>"。 */
  assignmentId: string;
  /** 关联的 Transport Request ID。 */
  requestId: string;
  /** 执行 creep 名称。 */
  creepName: string;
  /** 执行角色。 */
  role: TransportRole;
  /** 资源类型。 */
  resource: ResourceType;
  /** 分配搬运量。 */
  assignedAmount: number;
  /** 已装载量。 */
  loadedAmount: number;
  /** 已交付量。 */
  deliveredAmount: number;
  /** 损失量（creep 死亡/掉落）。 */
  lostAmount: number;
  /** 路由 ID（关联 Route 一等对象，Phase 2）。 */
  routeId?: string;
  /** 分配 tick。 */
  assignedAt: number;
  /** 最近更新 tick。 */
  updatedAt: number;
  /** 状态。 */
  status: AssignmentStatus;
}

// ─── ID 生成 ──────────────────────────────────────────────

/**
 * 生成 Transport Assignment ID。
 * 格式："ta:<requestId>:<creepName>"
 * 纯函数。
 */
export function makeAssignmentId(requestId: string, creepName: string): string {
  return `ta:${requestId}:${creepName}`;
}

// ─── 创建 ──────────────────────────────────────────────────

/**
 * 创建新 Transport Assignment（初始状态 = assigned）。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param requestId 关联的 Transport Request ID
 * @param creepName 执行 creep 名称
 * @param role 执行角色
 * @param resource 资源类型
 * @param assignedAmount 分配搬运量
 * @param tick 当前 tick
 * @param routeId 路由 ID（可选）
 */
export function createAssignment(
  requestId: string,
  creepName: string,
  role: TransportRole,
  resource: ResourceType,
  assignedAmount: number,
  tick: number,
  routeId?: string,
): TransportAssignment {
  return {
    assignmentId: makeAssignmentId(requestId, creepName),
    requestId,
    creepName,
    role,
    resource,
    assignedAmount: Math.max(0, Math.floor(assignedAmount)),
    loadedAmount: 0,
    deliveredAmount: 0,
    lostAmount: 0,
    routeId,
    assignedAt: tick,
    updatedAt: tick,
    status: "assigned",
  };
}

// ─── 状态更新 ──────────────────────────────────────────────

/**
 * 标记为装载中。
 * 纯函数 — 返回新对象。
 */
export function markLoading(a: TransportAssignment, tick: number): TransportAssignment {
  return { ...a, status: "loading", updatedAt: tick };
}

/**
 * 标记为运输中。
 * 纯函数 — 返回新对象。
 */
export function markInTransit(a: TransportAssignment, tick: number): TransportAssignment {
  return { ...a, status: "in_transit", updatedAt: tick };
}

/**
 * 标记为卸货中。
 * 纯函数 — 返回新对象。
 */
export function markUnloading(a: TransportAssignment, tick: number): TransportAssignment {
  return { ...a, status: "unloading", updatedAt: tick };
}

/**
 * 标记为完成。
 * 纯函数 — 返回新对象。
 */
export function markCompleted(a: TransportAssignment, tick: number): TransportAssignment {
  return { ...a, status: "completed", updatedAt: tick };
}

/**
 * 标记为失败。
 * 纯函数 — 返回新对象。
 */
export function markFailed(a: TransportAssignment, tick: number, reason?: string): TransportAssignment {
  return { ...a, status: "failed", updatedAt: tick };
}

/**
 * 标记为已回收。
 * 纯函数 — 返回新对象。
 */
export function markRecycled(a: TransportAssignment, tick: number): TransportAssignment {
  return { ...a, status: "recycled", updatedAt: tick };
}

// ─── 追踪更新 ──────────────────────────────────────────────

/**
 * 记录装载量。
 * loadedAmount 累加。
 * 纯函数 — 返回新对象。
 */
export function recordLoaded(a: TransportAssignment, amount: number, tick: number): TransportAssignment {
  return {
    ...a,
    loadedAmount: a.loadedAmount + Math.max(0, amount),
    updatedAt: tick,
  };
}

/**
 * 记录交付量。
 * deliveredAmount 累加。
 * 纯函数 — 返回新对象。
 */
export function recordDelivered(a: TransportAssignment, amount: number, tick: number): TransportAssignment {
  const deliveredAmount = a.deliveredAmount + Math.max(0, amount);
  const completed = deliveredAmount >= a.assignedAmount;
  return {
    ...a,
    deliveredAmount,
    status: completed ? "completed" : a.status,
    updatedAt: tick,
  };
}

/**
 * 记录损失量。
 * lostAmount 累加。
 * 纯函数 — 返回新对象。
 */
export function recordLost(a: TransportAssignment, amount: number, tick: number): TransportAssignment {
  return {
    ...a,
    lostAmount: a.lostAmount + Math.max(0, amount),
    updatedAt: tick,
  };
}

// ─── 查询 ──────────────────────────────────────────────────

/**
 * 计算剩余分配量（assignedAmount - deliveredAmount - lostAmount）。
 * 纯函数。
 */
export function remainingAssigned(a: TransportAssignment): number {
  return Math.max(0, a.assignedAmount - a.deliveredAmount - a.lostAmount);
}

/**
 * 计算运输效率 (deliveredAmount / assignedAmount)。
 * 纯函数。
 */
export function assignmentEfficiency(a: TransportAssignment): number {
  if (a.assignedAmount <= 0) return 0;
  return a.deliveredAmount / a.assignedAmount;
}

/**
 * 计算损失率 (lostAmount / assignedAmount)。
 * 纯函数。
 */
export function assignmentLossRate(a: TransportAssignment): number {
  if (a.assignedAmount <= 0) return 0;
  return a.lostAmount / a.assignedAmount;
}

// ─── 批量查询 ─────────────────────────────────────────────

/**
 * 按 Request ID 过滤 Assignment。
 * 纯函数。
 */
export function filterByRequestId(
  assignments: readonly TransportAssignment[],
  requestId: string,
): TransportAssignment[] {
  return assignments.filter(a => a.requestId === requestId);
}

/**
 * 按 creep 名称过滤 Assignment。
 * 纯函数。
 */
export function filterByCreepName(
  assignments: readonly TransportAssignment[],
  creepName: string,
): TransportAssignment[] {
  return assignments.filter(a => a.creepName === creepName);
}

/**
 * 过滤活跃 Assignment。
 * 纯函数。
 */
export function filterActiveAssignments(
  assignments: readonly TransportAssignment[],
): TransportAssignment[] {
  return assignments.filter(a => isAssignmentActive(a.status));
}

/**
 * 过滤可归档的终态 Assignment。
 * 纯函数。
 */
export function filterTerminalAssignments(
  assignments: readonly TransportAssignment[],
): TransportAssignment[] {
  return assignments.filter(a => isAssignmentTerminal(a.status));
}

// ─── 序列化 / 反序列化 ───────────────────────────────────

/**
 * Transport Assignment 瘦快照（存入 Memory.kernel.transportAssignments）。
 */
export interface TransportAssignmentSnapshot {
  /** assignmentId。 */
  i: string;
  /** requestId。 */
  ri: string;
  /** creepName。 */
  cn: string;
  /** role code。 */
  ro: string;
  /** resource code。 */
  r: string;
  /** assignedAmount。 */
  aa: number;
  /** loadedAmount。 */
  la: number;
  /** deliveredAmount。 */
  da: number;
  /** lostAmount。 */
  lo: number;
  /** routeId。 */
  ru: string | undefined;
  /** assignedAt。 */
  at: number;
  /** updatedAt。 */
  ua: number;
  /** status code。 */
  ss: string;
}

/** TransportRole 编码。 */
function encodeRole(role: TransportRole): string {
  switch (role) {
    case "hauler": return "H";
    case "carrier": return "C";
    case "remoteHauler": return "R";
    case "distributor": return "D";
  }
}

/** TransportRole 解码。 */
function decodeRole(code: string): TransportRole {
  switch (code) {
    case "H": return "hauler";
    case "C": return "carrier";
    case "R": return "remoteHauler";
    case "D": return "distributor";
    default: return "hauler";
  }
}

/** AssignmentStatus 编码。 */
function encodeAssignmentStatus(status: AssignmentStatus): string {
  switch (status) {
    case "assigned": return "A";
    case "loading": return "L";
    case "in_transit": return "T";
    case "unloading": return "U";
    case "completed": return "X";
    case "failed": return "F";
    case "recycled": return "R";
  }
}

/** AssignmentStatus 解码。 */
function decodeAssignmentStatus(code: string): AssignmentStatus {
  switch (code) {
    case "A": return "assigned";
    case "L": return "loading";
    case "T": return "in_transit";
    case "U": return "unloading";
    case "X": return "completed";
    case "F": return "failed";
    case "R": return "recycled";
    default: return "assigned";
  }
}

/** ResourceType 编码。 */
function encodeResource(resource: ResourceType): string {
  return resource === "energy" ? "E" : resource;
}

/** ResourceType 解码。 */
function decodeResource(code: string): ResourceType {
  if (code === "E") return "energy";
  return code as ResourceType;
}

/**
 * 将 TransportAssignment 序列化为 Memory 瘦快照。
 * 纯函数。
 */
export function serializeAssignment(a: TransportAssignment): TransportAssignmentSnapshot {
  return {
    i: a.assignmentId,
    ri: a.requestId,
    cn: a.creepName,
    ro: encodeRole(a.role),
    r: encodeResource(a.resource),
    aa: Math.round(a.assignedAmount),
    la: Math.round(a.loadedAmount),
    da: Math.round(a.deliveredAmount),
    lo: Math.round(a.lostAmount),
    ru: a.routeId,
    at: a.assignedAt,
    ua: a.updatedAt,
    ss: encodeAssignmentStatus(a.status),
  };
}

/**
 * 从 Memory 瘦快照反序列化 TransportAssignment。
 * 纯函数。
 */
export function deserializeAssignment(s: TransportAssignmentSnapshot): TransportAssignment {
  return {
    assignmentId: s.i,
    requestId: s.ri,
    creepName: s.cn,
    role: decodeRole(s.ro),
    resource: decodeResource(s.r),
    assignedAmount: s.aa,
    loadedAmount: s.la,
    deliveredAmount: s.da,
    lostAmount: s.lo,
    routeId: s.ru,
    assignedAt: s.at,
    updatedAt: s.ua,
    status: decodeAssignmentStatus(s.ss),
  };
}

/**
 * 批量序列化。
 * 纯函数。
 */
export function serializeAssignments(
  assignments: readonly TransportAssignment[],
): TransportAssignmentSnapshot[] {
  return assignments.map(serializeAssignment);
}

/**
 * 批量反序列化。
 * 纯函数。
 */
export function deserializeAssignments(
  snapshots: readonly TransportAssignmentSnapshot[],
): TransportAssignment[] {
  return snapshots.map(deserializeAssignment);
}
