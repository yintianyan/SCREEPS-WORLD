/** Supply Node */

import type { RoomRegistryEntry } from "../strategy/room-registry";
import type { OperationPriority, ResourceType } from "./agenda-item";

/**
 * Supply Node — 单房单资源的供给节点。
 */
export interface SupplyNode {
  /** 房间名。 */
  room: string;
  /** 资源类型。 */
  resource: ResourceType;
  /** storage 内可用量（总能量）。 */
  available: number;
  /** 已被活跃 Reservation 锁定的量。 */
  reserved: number;
  /** 安全储备（不可被调拨的最低保留量）。 */
  safety: number;
  /** 可调拨量 = available - reserved - safety（≥ 0）。 */
  transferable: number;
  /** 供给优先级（由经济健康度推导，0=最高）。 */
  priority: OperationPriority;
  /** 经济健康度（0..1，越高越健康）。 */
  health: number;
  /** storage 容量。 */
  capacity: number;
  /** 最近更新 tick。 */
  timestamp: number;
}

/**
 * 从 RoomRegistryEntry 派生 Supply Node。

 * 只在 canExport=true 且 transferable > 0 时创建。
 * 返回 undefined 表示该房间不产生供给节点。

 * 纯函数 — 不访问 Game/Memory。
 */
export function buildSupplyNode(
  entry: RoomRegistryEntry,
  reservedAmount: number,
  tick: number,
  resource: ResourceType = "energy",
): SupplyNode | undefined {
  if (!entry.canExport || entry.transferable <= 0) return undefined;

  const health = computeRoomHealth(entry);
  const safety = Math.max(
    entry.storageCapacity * 0.2,
    5000,
  );

  return {
    room: entry.roomName,
    resource,
    available: entry.storageEnergy,
    reserved: reservedAmount,
    safety,
    transferable: entry.transferable,
    priority: deriveSupplyPriority(entry),
    health,
    capacity: entry.storageCapacity,
    timestamp: tick,
  };
}

/**
 * 批量构建 Supply Nodes。
 * 从 RoomRegistry + ReservationTable 派生所有活跃供给节点。
 * 返回按 transferable 降序排列的列表。

 * 纯函数 — 不访问 Game/Memory。
 */
export function buildSupplyNodes(
  surplusRooms: readonly RoomRegistryEntry[],
  reservedByRoom: ReadonlyMap<string, number>,
  tick: number,
): SupplyNode[] {
  const nodes: SupplyNode[] = [];
  for (const entry of surplusRooms) {
    const reserved = reservedByRoom.get(entry.roomName) ?? 0;
    const node = buildSupplyNode(entry, reserved, tick);
    if (node) nodes.push(node);
  }
  nodes.sort((a, b) => b.transferable - a.transferable);
  return nodes;
}

/**
 * 计算所有 Supply Nodes 的总可调拨量。
 */
export function sumSupplyTransferable(nodes: readonly SupplyNode[]): number {
  let sum = 0;
  for (const n of nodes) sum += n.transferable;
  return sum;
}

/**
 * 从经济指标推导供给优先级。
 * 健康度越高 → 优先级越低（不紧急对外输出）。
 * 但 struggling 房不产生 Supply Node（已在 buildSupplyNode 过滤）。
 */
function deriveSupplyPriority(entry: RoomRegistryEntry): OperationPriority {
  // 健康房（riskBuffer 充足）→ P3（低优先级供给）
  if (entry.riskBuffer > 2000) return 3;
  // 正常房 → P2
  if (entry.riskBuffer > 1000) return 2;
  // 紧凑房 → P1（虽然有富余但自身也不太宽裕）
  return 1;
}

/**
 * 计算房间经济健康度（0..1）。
 * 综合 riskBuffer / storageRatio / netFlow 推导。
 */
function computeRoomHealth(entry: RoomRegistryEntry): number {
  // riskBuffer 贡献（0..0.4）：riskBuffer > 2000 时满分
  const riskScore = Math.min(1, entry.riskBuffer / 2000) * 0.4;
  // storageRatio 贡献（0..0.3）：水位 > 0.5 时满分
  const storageScore = Math.min(1, entry.storageRatio / 0.5) * 0.3;
  // netFlow 贡献（0..0.3）：净流 > 0 时满分
  const flowScore = entry.netFlow > 0 ? 0.3 : Math.max(0, 0.3 + entry.netFlow * 0.01);
  return Math.max(0, Math.min(1, riskScore + storageScore + flowScore));
}
