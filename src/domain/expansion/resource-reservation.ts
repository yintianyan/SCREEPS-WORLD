/** Resource Reservation */

/** 预留状态。 */
export type ReservationStatus = "PENDING" | "RESERVED" | "RELEASED" | "CONSUMED";

/** 资源预留记录。 */
export interface ResourceReservation {
  /** 关联的 planId。 */
  planId: string;
  /** 预留能量。 */
  reservedEnergy: number;
  /** 预留 CPU 预算份额。 */
  reservedCpuShare: number;
  /** 预留状态。 */
  status: ReservationStatus;
  /** 预留 tick。 */
  reservedAt: number;
  /** 释放 tick。 */
  releasedAt?: number;
  /** 消耗 tick。 */
  consumedAt?: number;
  /** 释放原因。 */
  releaseReason?: string;
}

/** 预留输入。 */
export interface ReservationInput {
  /** planId。 */
  planId: string;
  /** 需要预留的能量。 */
  energyNeeded: number;
  /** 当前可用的扩张预算。 */
  availableExpansionBudget: number;
  /** 当前 tick。 */
  tick: number;
}

/** 预留结果。 */
export interface ReservationResult {
  /** 成功与否。 */
  success: boolean;
  /** 预留记录（如果成功）。 */
  reservation?: ResourceReservation;
  /** 失败原因。 */
  failReason?: string;
  /** 预留后的剩余预算。 */
  remainingBudget: number;
}

/**
 * 尝试预留资源（纯函数）。

 * 条件：energyNeeded <= availableExpansionBudget
 */
export function tryReserve(input: ReservationInput): ReservationResult {
  if (input.energyNeeded > input.availableExpansionBudget) {
    return {
      success: false,
      failReason: `insufficient budget: ${input.energyNeeded} > ${input.availableExpansionBudget}`,
      remainingBudget: input.availableExpansionBudget,
    };
  }

  const reservation: ResourceReservation = {
    planId: input.planId,
    reservedEnergy: input.energyNeeded,
    reservedCpuShare: 0.5, // 预留 0.5% CPU 预算
    status: "RESERVED",
    reservedAt: input.tick,
  };

  return {
    success: true,
    reservation,
    remainingBudget: input.availableExpansionBudget - input.energyNeeded,
  };
}

/**
 * 释放预留资源（纯函数）。
 */
export function releaseReservation(
  reservation: ResourceReservation,
  tick: number,
  reason: string,
): ResourceReservation {
  return {
    ...reservation,
    status: "RELEASED",
    releasedAt: tick,
    releaseReason: reason,
  };
}

/**
 * 消耗预留资源（纯函数）。
 */
export function consumeReservation(
  reservation: ResourceReservation,
  tick: number,
): ResourceReservation {
  return {
    ...reservation,
    status: "CONSUMED",
    consumedAt: tick,
  };
}

/**
 * 检查预留是否过期（超时未消耗）。
 */
export function isReservationExpired(
  reservation: ResourceReservation,
  tick: number,
  timeoutTicks: number = 2000,
): boolean {
  if (reservation.status !== "RESERVED") return false;
  return tick - reservation.reservedAt > timeoutTicks;
}

/**
 * 批量清理过期预留。
 */
export function cleanupExpiredReservations(
  reservations: ResourceReservation[],
  tick: number,
  timeoutTicks: number = 2000,
): { active: ResourceReservation[]; expired: ResourceReservation[] } {
  const active: ResourceReservation[] = [];
  const expired: ResourceReservation[] = [];

  for (const r of reservations) {
    if (isReservationExpired(r, tick, timeoutTicks)) {
      expired.push({ ...r, status: "RELEASED" as ReservationStatus, releasedAt: tick, releaseReason: "expired" });
    } else {
      active.push(r);
    }
  }

  return { active, expired };
}

/**
 * 计算当前被预留的总量。
 */
export function getTotalReserved(reservations: ResourceReservation[]): number {
  return reservations
    .filter(r => r.status === "RESERVED")
    .reduce((sum, r) => sum + r.reservedEnergy, 0);
}
