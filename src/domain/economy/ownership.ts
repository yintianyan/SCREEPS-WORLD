/** Resource Ownership */

import type { RoomEconomicProfile } from "./room-profile";

/** 安全储备比例（storage 容量的最低保留比例，防抽干）。 */
const DEFAULT_SAFETY_RESERVE_RATIO = 0.2;

/** 最小安全储备绝对值（即使比例计算不足，也至少保留这个量）。 */
const MIN_SAFETY_RESERVE = 5000;

/**
 * 计算安全储备（不可被调拨的最低保留量）。
 * = max(storageCapacity × ratio, MIN_SAFETY_RESERVE)
 * 无 storage 时为 0。
 */
export function computeSafetyReserve(
  storageCapacity: number,
  ratio: number = DEFAULT_SAFETY_RESERVE_RATIO,
): number {
  if (storageCapacity <= 0) return 0;
  return Math.max(storageCapacity * ratio, MIN_SAFETY_RESERVE);
}

/**
 * 计算可调拨量 — 资源所有权的核心函数。

 * transferable = max(0, storageEnergy - reserve - safetyReserve - activeReservations)

 * 纯函数 — 不访问 Game/Memory。

 * @param profile 房间经济画像
 * @param activeReservations 当前活跃预留总量（所有跨房 Operation 的 reservedAmount 之和）
 * @param safetyReserveRatio 安全储备比例（默认 0.2）
 * @returns 可调拨量（≥ 0）
 */
export function computeTransferable(
  profile: RoomEconomicProfile,
  activeReservations: number,
  safetyReserveRatio: number = DEFAULT_SAFETY_RESERVE_RATIO,
): number {
  if (!profile.hasStorage) return 0;
  if (profile.isStruggling) return 0;

  const safety = computeSafetyReserve(profile.storageCapacity, safetyReserveRatio);
  const reserve = profile.contractReserve;
  const available = profile.storageEnergy - reserve - safety - activeReservations;

  return Math.max(0, Math.floor(available));
}

/**
 * 批量计算各房可调拨量 — 供 Room Registry 构建时使用。
 * 返回 roomName → transferable 的 Map。
 */
export function computeTransferableBulk(
  profiles: readonly RoomEconomicProfile[],
  reservationsByRoom: ReadonlyMap<string, number>,
  safetyReserveRatio: number = DEFAULT_SAFETY_RESERVE_RATIO,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const profile of profiles) {
    const activeReservations = reservationsByRoom.get(profile.roomName) ?? 0;
    out.set(profile.roomName, computeTransferable(profile, activeReservations, safetyReserveRatio));
  }
  return out;
}

/**
 * 计算房间总需求量（deficit 侧）。
 * = target 缺口量 - 已在途量（已分配的 Operation 的 requestedAmount - deliveredAmount）。
 */
export function computeRemainingDeficit(
  targetDeficit: number,
  inTransitAmount: number,
): number {
  return Math.max(0, targetDeficit - inTransitAmount);
}
