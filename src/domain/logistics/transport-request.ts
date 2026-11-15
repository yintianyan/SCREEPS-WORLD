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
  "storage" | "container" | "terminal" | "spawn" | "extension" | "tower" | "lab" | "factory";

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

// ─── 序列化 / 反序列化 ───────────────────────────────────

/** Endpoint type 编码。 */

/** Endpoint type 解码。 */

/** TransportStatus 编码。 */

/** TransportStatus 解码。 */

/** ResourceType 编码（复用 supply-contract.ts 的方案）。 */

/** ResourceType 解码。 */
