/** Transport Request V2 */

import type { ResourceType } from "../operation/agenda-item";
import type { RequestScope } from "../assignment/request-pool";

// ─── Transport Request 状态机 ──────────────────────────────

/**
 * Transport Request 状态机十态。

 * 状态流转：
 *   pending → planned → assigned → in_transit → delivering → delivered
 *                                        ↓            ↓
 *                                    blocked       partial → planned (重新规划)
 *                                        ↓
 *                                    failed / cancelled

 * - pending:     已创建，等待纳入 Transport Plan
 * - planned:     已纳入 Transport Plan，等待 Assignment
 * - assigned:    已分配给 hauler/carrier
 * - in_transit:  运输中
 * - delivering:  到达目的地，正在卸货
 * - delivered:   全部送达（终态）
 * - partial:     部分送达（可回到 planned 生成 remaining request）
 * - blocked:     路径/资源阻塞（可回到 planned 重试）
 * - failed:      不可恢复失败（终态）
 * - cancelled:   外部取消（终态）
 */
export type TransportStatus =
  | "pending"
  | "planned"
  | "assigned"
  | "in_transit"
  | "delivering"
  | "delivered"
  | "partial"
  | "blocked"
  | "failed"
  | "cancelled";

/**
 * 判定 Transport Request 状态是否终态（可归档删除）。
 * 纯函数。
 */
export function isTerminal(status: TransportStatus): boolean {
  return status === "delivered" || status === "failed" || status === "cancelled";
}

/**
 * 判定 Transport Request 状态是否活跃（非终态）。
 * 纯函数。
 */
export function isActiveRequest(status: TransportStatus): boolean {
  return !isTerminal(status);
}

// ─── 运输端点 ─────────────────────────────────────────────

/**
 * 运输端点类型。
 */
export type EndpointType =
  | "storage"
  | "container"
  | "terminal"
  | "spawn"
  | "extension"
  | "tower"
  | "lab"
  | "factory";

/**
 * 运输端点（源或目标）。
 * 描述资源的来源或去向。
 */
export interface TransportEndpoint {
  /** 房间名。 */
  room: string;
  /** 结构 ID（storage/container/terminal 等）。 */
  structureId?: string;
  /** 坐标。 */
  pos?: { x: number; y: number };
  /** 端点类型。 */
  type: EndpointType;
}

// ─── 路由偏好 ─────────────────────────────────────────────

/**
 * 路由偏好（可选）。
 * 影响路由选择策略。
 */
export interface RoutePreference {
  /** 是否允许经过 hostile 房间。 */
  allowHostile: boolean;
  /** 最大跳数。 */
  maxHops: number;
  /** 优先路线（已知安全路线 ID 列表）。 */
  preferredRouteIds?: string[];
}

// ─── Transport Request V2 模型 ────────────────────────────

/**
 * Transport Request V2 — 统一运输请求模型。

 * 字段设计原则（MEMORY_ARCHITECTURE）：
 * - 存储在 Memory.kernel.transportRequests（瘦快照，只存 ID + 数字 + 枚举）
 * - 不存完整路径/历史/运行时索引
 * - 终态后归档删除（与 OperationContext 同模式）

 * 与现有 `TransportRequest`（request-pool.ts）的关系：
 * - V2 是上层统一接口，现有 TransportRequest 是房内执行层接口
 * - V2 通过 adapter 映射为现有 TransportRequest 供 logistics.ts 消费
 * - 现有 TransportRequest 保持不变（向后兼容）
 */
export interface TransportRequestV2 {
  /** 全局唯一 ID："tr:<scope>:<sourceRoom>:<targetRoom>:<resource>:<seq>"。 */
  requestId: string;
  /** 资源类型。 */
  resource: ResourceType;
  /** 请求总量。 */
  amount: number;
  /** 源端点。 */
  source: TransportEndpoint;
  /** 目标端点。 */
  destination: TransportEndpoint;
  /** 优先级（0=最高 survival / 1=high / 2=normal / 3=low）。 */
  priority: 0 | 1 | 2 | 3;
  /** 请求归属域（room/empire/operation）。 */
  scope: RequestScope;
  /** 截止 tick（超时 → failed/expired）。 */
  deadline: number;
  /** 最小批量（低于此值不分配 hauler）。 */
  minBatch: number;
  /** 最大批量（单次运输上限）。 */
  maxBatch: number;
  /** 当前状态。 */
  status: TransportStatus;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近状态变更 tick。 */
  updatedAt: number;
  /** 来源标识：contract ID / operation ID / "logistics-auto"。 */
  origin: string;
  /** 可选：路由偏好。 */
  routePreference?: RoutePreference;
}

// ─── ID 生成 ──────────────────────────────────────────────

let _requestSeq = 0;

/**
 * 生成 Transport Request ID。
 * 格式："tr:<scope>:<sourceRoom>:<targetRoom>:<resource>:<seq>"

 * seq 是递增序号（heap 状态，global reset 后从 0 重新开始——
 * 因为旧 Request 已在 Memory 中持久化，不会冲突）。

 * 纯函数（除了 seq 自增——这是幂等创建的必要去重手段）。
 */
export function makeRequestId(
  scope: RequestScope,
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
): string {
  const seq = _requestSeq++;
  return `tr:${scope}:${sourceRoom}:${targetRoom}:${resource}:${seq}`;
}

/** 重置 seq（测试用）。 */
export function _resetRequestSeq(): void {
  _requestSeq = 0;
}

// ─── 创建 ──────────────────────────────────────────────────

/**
 * 创建新 Transport Request V2（初始状态 = pending）。

 * 纯函数 — 不访问 Game/Memory。

 * @param resource 资源类型
 * @param amount 请求总量
 * @param source 源端点
 * @param destination 目标端点
 * @param priority 优先级
 * @param scope 归属域
 * @param deadline 截止 tick
 * @param tick 当前 tick
 * @param origin 来源标识
 * @param minBatch 最小批量（默认 100）
 * @param maxBatch 最大批量（默认 5000）
 * @param routePreference 路由偏好（可选）
 */
export function createRequest(
  resource: ResourceType,
  amount: number,
  source: TransportEndpoint,
  destination: TransportEndpoint,
  priority: 0 | 1 | 2 | 3,
  scope: RequestScope,
  deadline: number,
  tick: number,
  origin: string,
  minBatch: number = 100,
  maxBatch: number = 5000,
  routePreference?: RoutePreference,
): TransportRequestV2 {
  return {
    requestId: makeRequestId(scope, source.room, destination.room, resource),
    resource,
    amount: Math.max(0, Math.floor(amount)),
    source,
    destination,
    priority,
    scope,
    deadline,
    minBatch,
    maxBatch,
    status: "pending",
    createdAt: tick,
    updatedAt: tick,
    origin,
    routePreference,
  };
}

// ─── 查询 ──────────────────────────────────────────────────

/**
 * 判断 Request 是否已超时。
 * 纯函数。
 */
export function isExpired(req: TransportRequestV2, tick: number): boolean {
  return tick > req.deadline;
}

/**
 * 计算 Request 的剩余量（amount - deliveredAmount）。
 * deliveredAmount 由 Transport Accounting 追踪，这里通过参数注入。
 * 纯函数。
 */
export function remainingAmount(req: TransportRequestV2, deliveredAmount: number): number {
  return Math.max(0, req.amount - deliveredAmount);
}

/**
 * 过滤出活跃 Request（非终态）。
 * 纯函数。
 */
export function filterActiveRequests(requests: readonly TransportRequestV2[]): TransportRequestV2[] {
  return requests.filter(r => isActiveRequest(r.status));
}

/**
 * 过滤出可归档的终态 Request。
 * 纯函数。
 */
export function filterTerminalRequests(requests: readonly TransportRequestV2[]): TransportRequestV2[] {
  return requests.filter(r => isTerminal(r.status));
}

/**
 * 按 scope 过滤 Request。
 * 纯函数。
 */
export function filterByScope(
  requests: readonly TransportRequestV2[],
  scope: RequestScope,
): TransportRequestV2[] {
  return requests.filter(r => r.scope === scope);
}

/**
 * 按 target room 过滤 Request。
 * 纯函数。
 */
export function filterByTargetRoom(
  requests: readonly TransportRequestV2[],
  room: string,
): TransportRequestV2[] {
  return requests.filter(r => r.destination.room === room);
}

/**
 * 按 source room 过滤 Request。
 * 纯函数。
 */
export function filterBySourceRoom(
  requests: readonly TransportRequestV2[],
  room: string,
): TransportRequestV2[] {
  return requests.filter(r => r.source.room === room);
}

// ─── 序列化 / 反序列化 ───────────────────────────────────

/**
 * Transport Request V2 瘦快照（存入 Memory.kernel.transportRequests）。
 * 只存必要字段——数字 + 枚举 + ID。
 * 坐标和 structureId 不持久化（每 tick 从快照重导出）。
 */
export interface TransportRequestSnapshot {
  /** requestId。 */
  i: string;
  /** resource code。 */
  r: string;
  /** amount。 */
  a: number;
  /** source room。 */
  sr: string;
  /** source type code。 */
  st: string;
  /** destination room。 */
  dr: string;
  /** destination type code。 */
  dt: string;
  /** priority。 */
  p: number;
  /** scope code。 */
  sc: string;
  /** deadline。 */
  dl: number;
  /** minBatch。 */
  mb: number;
  /** maxBatch。 */
  xb: number;
  /** status code。 */
  ss: string;
  /** createdAt。 */
  ca: number;
  /** updatedAt。 */
  ua: number;
  /** origin。 */
  o: string;
}

/** Endpoint type 编码。 */
function encodeEndpointType(type: EndpointType): string {
  switch (type) {
    case "storage": return "S";
    case "container": return "C";
    case "terminal": return "T";
    case "spawn": return "W";
    case "extension": return "E";
    case "tower": return "R";
    case "lab": return "L";
    case "factory": return "F";
  }
}

/** Endpoint type 解码。 */
function decodeEndpointType(code: string): EndpointType {
  switch (code) {
    case "S": return "storage";
    case "C": return "container";
    case "T": return "terminal";
    case "W": return "spawn";
    case "E": return "extension";
    case "R": return "tower";
    case "L": return "lab";
    case "F": return "factory";
    default: return "storage";
  }
}

/** TransportStatus 编码。 */
function encodeStatus(status: TransportStatus): string {
  switch (status) {
    case "pending": return "P";
    case "planned": return "L";
    case "assigned": return "A";
    case "in_transit": return "T";
    case "delivering": return "D";
    case "delivered": return "X";
    case "partial": return "R";
    case "blocked": return "B";
    case "failed": return "F";
    case "cancelled": return "C";
  }
}

/** TransportStatus 解码。 */
function decodeStatus(code: string): TransportStatus {
  switch (code) {
    case "P": return "pending";
    case "L": return "planned";
    case "A": return "assigned";
    case "T": return "in_transit";
    case "D": return "delivering";
    case "X": return "delivered";
    case "R": return "partial";
    case "B": return "blocked";
    case "F": return "failed";
    case "C": return "cancelled";
    default: return "pending";
  }
}

/** ResourceType 编码（复用 supply-contract.ts 的方案）。 */
function encodeResource(resource: ResourceType): string {
  return resource === "energy" ? "E" : resource;
}

/** ResourceType 解码。 */
function decodeResource(code: string): ResourceType {
  if (code === "E") return "energy";
  return code as ResourceType;
}

/**
 * 将 TransportRequestV2 序列化为 Memory 瘦快照。
 * 纯函数。
 */
export function serializeRequest(req: TransportRequestV2): TransportRequestSnapshot {
  return {
    i: req.requestId,
    r: encodeResource(req.resource),
    a: Math.round(req.amount),
    sr: req.source.room,
    st: encodeEndpointType(req.source.type),
    dr: req.destination.room,
    dt: encodeEndpointType(req.destination.type),
    p: req.priority,
    sc: req.scope,
    dl: req.deadline,
    mb: req.minBatch,
    xb: req.maxBatch,
    ss: encodeStatus(req.status),
    ca: req.createdAt,
    ua: req.updatedAt,
    o: req.origin.slice(0, 40),
  };
}

/**
 * 从 Memory 瘦快照反序列化 TransportRequestV2。
 * 纯函数。注意：structureId/pos/routePreference 不持久化（每 tick 重导出）。
 */
export function deserializeRequest(s: TransportRequestSnapshot): TransportRequestV2 {
  return {
    requestId: s.i,
    resource: decodeResource(s.r),
    amount: s.a,
    source: { room: s.sr, type: decodeEndpointType(s.st) },
    destination: { room: s.dr, type: decodeEndpointType(s.dt) },
    priority: s.p as 0 | 1 | 2 | 3,
    scope: s.sc as RequestScope,
    deadline: s.dl,
    minBatch: s.mb,
    maxBatch: s.xb,
    status: decodeStatus(s.ss),
    createdAt: s.ca,
    updatedAt: s.ua,
    origin: s.o,
  };
}

/**
 * 批量序列化。
 * 纯函数。
 */
export function serializeRequests(requests: readonly TransportRequestV2[]): TransportRequestSnapshot[] {
  return requests.map(serializeRequest);
}

/**
 * 批量反序列化。
 * 纯函数。
 */
export function deserializeRequests(snapshots: readonly TransportRequestSnapshot[]): TransportRequestV2[] {
  return snapshots.map(deserializeRequest);
}
