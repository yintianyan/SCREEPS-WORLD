/**
 * Source Reservation — A3.0 跨房资源预留机制
 *（LOGISTICS §2.1 #3 防超卖）。
 *
 * 预留带 TTL 和心跳：
 *   - 创建时设 TTL（默认 500 tick）
 *   - 每次 Operation tick 心跳续期
 *   - TTL 到期自动释放（防泄漏）
 *   - Operation 完成时显式释放
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

/** 默认预留 TTL（tick）。500 tick ≈ 运输往返 + 安全余量。 */
export const DEFAULT_RESERVATION_TTL = 500;

/**
 * 单条预留记录。
 * 每条对应一个 Operation 的资源锁定。
 */
export interface Reservation {
  /** 对应的 Operation ID。 */
  operationId: string;
  /** 源房名。 */
  sourceRoom: string;
  /** 目标房名。 */
  targetRoom: string;
  /** 预留量。 */
  amount: number;
  /** 创建 tick。 */
  createdAt: number;
  /** 过期 tick（createdAt + TTL）。 */
  expiresAt: number;
  /** 上次心跳 tick。 */
  lastHeartbeat: number;
  /** 资源类型。 */
  resource: "energy";
}

/** 预留表 — operationId → Reservation。 */
export type ReservationTable = Map<string, Reservation>;

/**
 * 创建预留（幂等：同 operationId 覆盖旧值）。
 *
 * 纯函数 — 返回新表，不修改原表。
 */
export function createReservation(
  table: ReservationTable,
  operationId: string,
  sourceRoom: string,
  targetRoom: string,
  amount: number,
  tick: number,
  ttl: number = DEFAULT_RESERVATION_TTL,
): ReservationTable {
  const next = new Map(table);
  next.set(operationId, {
    operationId,
    sourceRoom,
    targetRoom,
    amount,
    createdAt: tick,
    expiresAt: tick + ttl,
    lastHeartbeat: tick,
    resource: "energy",
  });
  return next;
}

/**
 * 释放预留（幂等：不存在时无操作）。
 */
export function releaseReservation(
  table: ReservationTable,
  operationId: string,
): ReservationTable {
  const next = new Map(table);
  next.delete(operationId);
  return next;
}

/**
 * 心跳续期 — 延长 TTL。
 * 不存在时无操作。
 */
export function heartbeatReservation(
  table: ReservationTable,
  operationId: string,
  tick: number,
  ttl: number = DEFAULT_RESERVATION_TTL,
): ReservationTable {
  const entry = table.get(operationId);
  if (!entry) return table;
  const next = new Map(table);
  next.set(operationId, {
    ...entry,
    lastHeartbeat: tick,
    expiresAt: tick + ttl,
  });
  return next;
}

/**
 * 扫描并清除过期预留（TTL 到期自动释放）。
 * 返回新表 + 被清除的 operationId 列表（用于记录泄漏事件）。
 */
export function sweepExpired(
  table: ReservationTable,
  tick: number,
): { table: ReservationTable; expired: string[] } {
  const expired: string[] = [];
  const next = new Map<string, Reservation>();
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
 * 计算指定源房的活跃预留总量。
 * 用于 computeTransferable 的 activeReservations 参数。
 */
export function sumReservationsByRoom(
  table: ReservationTable,
  roomName: string,
): number {
  let sum = 0;
  for (const entry of table.values()) {
    if (entry.sourceRoom === roomName) {
      sum += entry.amount;
    }
  }
  return sum;
}

/**
 * 获取指定源房的所有活跃预留。
 */
export function getReservationsByRoom(
  table: ReservationTable,
  roomName: string,
): Reservation[] {
  const out: Reservation[] = [];
  for (const entry of table.values()) {
    if (entry.sourceRoom === roomName) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * 获取指定 Operation 的预留。
 */
export function getReservation(
  table: ReservationTable,
  operationId: string,
): Reservation | undefined {
  return table.get(operationId);
}

/**
 * 更新预留量（部分送达时减少预留）。
 * 不存在时无操作。
 */
export function reduceReservation(
  table: ReservationTable,
  operationId: string,
  consumedAmount: number,
): ReservationTable {
  const entry = table.get(operationId);
  if (!entry) return table;
  const newAmount = Math.max(0, entry.amount - consumedAmount);
  if (newAmount === 0) {
    return releaseReservation(table, operationId);
  }
  const next = new Map(table);
  next.set(operationId, { ...entry, amount: newAmount });
  return next;
}
