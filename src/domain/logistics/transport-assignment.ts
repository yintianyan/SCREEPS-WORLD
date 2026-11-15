/** Transport Assignment */

import type { ResourceType } from "../operation/agenda-item";

// ─── Assignment 状态 ──────────────────────────────────────

/**
 * Transport Assignment 状态。

 * - assigned:   已分配，creep 尚未行动
 * - loading:    正在装载（在 source 取资源）
 * - in_transit: 运输中（前往 destination）
 * - unloading:  正在卸货（在 destination 放资源）
 * - completed:  完成（终态）
 * - failed:     失败（creep 死亡/路径不可达/资源消失）（终态）
 * - recycled:   creep 被回收（终态）
 */
export type AssignmentStatus =
  "assigned" | "loading" | "in_transit" | "unloading" | "completed" | "failed" | "recycled";

// ─── Transport Assignment 模型 ─────────────────────────────

/**
 * 运输角色类型。
 * 与现有角色系统对齐（hauler/carrier/remoteHauler/distributor）。
 */
export type TransportRole = "hauler" | "carrier" | "remoteHauler" | "distributor";

/**
 * Transport Assignment — 运输分配模型。

 * 一个 Assignment 表示「creep X 被分配去完成 Request Y 的一部分」。

 * 生命周期：
 *   assigned → loading → in_transit → unloading → completed
 *                              ↓               ↓
 *                           failed          failed

 * 一个 Request 可以有多个 Assignment（Multi-Source Fulfillment）：
 *   Request(5000 energy, roomA → roomB)
 *     ├── Assignment1(hauler1, 2000 energy)
 *     ├── Assignment2(hauler2, 2000 energy)
 *     └── Assignment3(hauler3, 1000 energy)

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

 * 纯函数 — 不访问 Game/Memory。

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

// ─── 追踪更新 ──────────────────────────────────────────────

// ─── 查询 ──────────────────────────────────────────────────

// ─── 批量查询 ─────────────────────────────────────────────

// ─── 序列化 / 反序列化 ───────────────────────────────────

/** TransportRole 编码。 */

/** TransportRole 解码。 */

/** AssignmentStatus 编码。 */

/** AssignmentStatus 解码。 */

/** ResourceType 编码。 */

/** ResourceType 解码。 */
