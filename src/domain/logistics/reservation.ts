/**
 * Transport Capacity Reservation — A4.3 Phase 5：运力预留 + TTL。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #16（无 Transport Reservation）、§10 #15 #16。
 *
 * 与 operation/reservation.ts 的区别：
 *   - operation/reservation.ts 预留 source 资源量
 *   - logistics/reservation.ts 预留 hauler carry capacity
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

// ─── 预留模型 ──────────────────────────────────────────────

/**
 * Transport Capacity Reservation。
 */
export interface CapacityReservation {
  /** 预留 ID。 */
  reservationId: string;
  /** 关联的 Request ID。 */
  requestId: string;
  /** 预留的 creep 名称（如有）。 */
  creepName?: string;
  /** 预留运力。 */
  reservedCapacity: number;
  /** 创建 tick。 */
  createdAt: number;
  /** 过期 tick。 */
  expiresAt: number;
  /** 上次心跳 tick。 */
  lastHeartbeat: number;
}

/** 预留表 — reservationId → CapacityReservation。 */
export type CapacityReservationTable = Map<string, CapacityReservation>;

/** 默认预留 TTL（tick）。 */
export const DEFAULT_CAPACITY_RESERVATION_TTL = 500;

// ─── 操作 ──────────────────────────────────────────────────

/**
 * 创建运力预留（幂等：同 reservationId 覆盖旧值）。
 * 纯函数 — 返回新表。
 */
export function createCapacityReservation(
  table: CapacityReservationTable,
  reservationId: string,
  requestId: string,
  reservedCapacity: number,
  tick: number,
  ttl: number = DEFAULT_CAPACITY_RESERVATION_TTL,
  creepName?: string,
): CapacityReservationTable {
  const next = new Map(table);
  next.set(reservationId, {
    reservationId,
    requestId,
    creepName,
    reservedCapacity: Math.max(0, reservedCapacity),
    createdAt: tick,
    expiresAt: tick + ttl,
    lastHeartbeat: tick,
  });
  return next;
}

/**
 * 释放运力预留。
 * 纯函数 — 返回新表。
 */
export function releaseCapacityReservation(
  table: CapacityReservationTable,
  reservationId: string,
): CapacityReservationTable {
  const next = new Map(table);
  next.delete(reservationId);
  return next;
}

/**
 * 心跳续期。
 * 纯函数 — 返回新表。
 */
export function heartbeatCapacityReservation(
  table: CapacityReservationTable,
  reservationId: string,
  tick: number,
  ttl: number = DEFAULT_CAPACITY_RESERVATION_TTL,
): CapacityReservationTable {
  const entry = table.get(reservationId);
  if (!entry) return table;
  const next = new Map(table);
  next.set(reservationId, {
    ...entry,
    lastHeartbeat: tick,
    expiresAt: tick + ttl,
  });
  return next;
}

/**
 * 扫描并清除过期预留。
 * 纯函数 — 返回新表 + 被清除的 ID 列表。
 */
export function sweepExpiredCapacityReservations(
  table: CapacityReservationTable,
  tick: number,
): { table: CapacityReservationTable; expired: string[] } {
  const expired: string[] = [];
  const next = new Map<string, CapacityReservation>();
  for (const [id, entry] of table) {
    if (entry.expiresAt <= tick) {
      expired.push(id);
    } else {
      next.set(id, entry);
    }
  }
  return { table: next, expired };
}

/**
 * 计算指定房间的总预留运力。
 * 纯函数。
 */
export function sumReservedCapacityByRequest(
  table: CapacityReservationTable,
  requestId: string,
): number {
  let sum = 0;
  for (const entry of table.values()) {
    if (entry.requestId === requestId) {
      sum += entry.reservedCapacity;
    }
  }
  return sum;
}
