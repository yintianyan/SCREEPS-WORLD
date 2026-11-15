/** Transport Capacity Reservation */

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

// ─── 操作 ──────────────────────────────────────────────────
