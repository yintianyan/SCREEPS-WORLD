/** Transport Capacity Planning */

// ─── 房间级输入 / 输出 ────────────────────────────────────

/**
 * 房间级运力需求输入。
 */
export interface RoomCapacityInput {
  /** 房间名。 */
  room: string;
  /** 生产速率（e/tick）。来自 source / remote source。 */
  productionRate: number;
  /** 消费速率（e/tick）。来自 sink（spawn/extension/tower/lab）。 */
  consumptionRate: number;
  /** 本地搬运平均往返 tick 数。 */
  localRoundTripTicks: number;
  /** 跨房搬运平均往返 tick 数（如有）。 */
  crossRoomRoundTripTicks: number;
  /** 单个 hauler carry capacity。 */
  haulerCapacity: number;
  /** 当前 hauler 数量。 */
  currentHaulerCount: number;
  /** 当前 carrier 数量。 */
  currentCarrierCount: number;
}

/**
 * 房间级运力需求输出。
 */
export interface RoomCapacityResult {
  /** 房间名。 */
  room: string;
  /** 所需本地 hauler 数。 */
  requiredHaulers: number;
  /** 所需跨房 carrier 数。 */
  requiredCarriers: number;
  /** 当前运力缺口（正=缺，负=溢）。 */
  haulerGap: number;
  /** 当前运力缺口（正=缺，负=溢）。 */
  carrierGap: number;
  /** 理论运力 (e/tick)。 */
  theoreticalCapacity: number;
  /** 实际运力 (e/tick)。 */
  actualCapacity: number;
  /** 利用率 (0..1)。 */
  utilization: number;
}

/**
 * 计算房间级运力需求。

 * 公式：
 *   requiredHaulers = ceil(productionRate × localRoundTripTicks / haulerCapacity)
 *   requiredCarriers = ceil(crossRoomDemand × crossRoomRoundTripTicks / haulerCapacity)
 *   theoreticalCapacity = requiredHaulers × haulerCapacity / localRoundTripTicks
 *   actualCapacity = currentHaulerCount × haulerCapacity / localRoundTripTicks
 *   utilization = productionRate / max(1, actualCapacity)

 * 纯函数 — 不访问 Game/Memory。
 */
export function planRoomCapacity(input: RoomCapacityInput): RoomCapacityResult {
  const {
    room,
    productionRate,
    consumptionRate,
    localRoundTripTicks,
    crossRoomRoundTripTicks,
    haulerCapacity,
    currentHaulerCount,
    currentCarrierCount,
  } = input;

  // 本地 hauler 需求
  const requiredHaulers = haulerCapacity > 0 && localRoundTripTicks > 0
    ? Math.ceil((productionRate * localRoundTripTicks) / haulerCapacity)
    : 0;

  // 跨房 carrier 需求（基于跨房供需）
  const crossRoomDemand = Math.max(0, productionRate - consumptionRate);
  const requiredCarriers = haulerCapacity > 0 && crossRoomRoundTripTicks > 0
    ? Math.ceil((crossRoomDemand * crossRoomRoundTripTicks) / haulerCapacity)
    : 0;

  // 运力计算
  const theoreticalCapacity = localRoundTripTicks > 0
    ? (requiredHaulers * haulerCapacity) / localRoundTripTicks
    : 0;
  const actualCapacity = localRoundTripTicks > 0
    ? (currentHaulerCount * haulerCapacity) / localRoundTripTicks
    : 0;

  // 利用率
  const utilization = actualCapacity > 0
    ? Math.min(1, productionRate / actualCapacity)
    : 0;

  return {
    room,
    requiredHaulers,
    requiredCarriers,
    haulerGap: requiredHaulers - currentHaulerCount,
    carrierGap: requiredCarriers - currentCarrierCount,
    theoreticalCapacity,
    actualCapacity,
    utilization,
  };
}

// ─── Empire 级汇总 ────────────────────────────────────────

/**
 * Empire 级运力汇总。
 */
export interface EmpireCapacityResult {
  /** 各房间运力结果。 */
  rooms: RoomCapacityResult[];
  /** Empire 总所需 hauler 数。 */
  totalRequiredHaulers: number;
  /** Empire 总所需 carrier 数。 */
  totalRequiredCarriers: number;
  /** Empire 总 hauler 缺口。 */
  totalHaulerGap: number;
  /** Empire 总 carrier 缺口。 */
  totalCarrierGap: number;
  /** Empire 平均利用率。 */
  empireUtilization: number;
}

/**
 * Empire 级运力估算。
 * 纯函数。
 */
export function planEmpireCapacity(rooms: readonly RoomCapacityInput[]): EmpireCapacityResult {
  const results = rooms.map(planRoomCapacity);

  let totalRequiredHaulers = 0;
  let totalRequiredCarriers = 0;
  let totalHaulerGap = 0;
  let totalCarrierGap = 0;
  let totalActualCapacity = 0;
  let totalProduction = 0;

  for (const r of results) {
    totalRequiredHaulers += r.requiredHaulers;
    totalRequiredCarriers += r.requiredCarriers;
    totalHaulerGap += Math.max(0, r.haulerGap);
    totalCarrierGap += Math.max(0, r.carrierGap);
    totalActualCapacity += r.actualCapacity;
    totalProduction += rooms.find(x => x.room === r.room)?.productionRate ?? 0;
  }

  const empireUtilization = totalActualCapacity > 0
    ? Math.min(1, totalProduction / totalActualCapacity)
    : 0;

  return {
    rooms: results,
    totalRequiredHaulers,
    totalRequiredCarriers,
    totalHaulerGap,
    totalCarrierGap,
    empireUtilization,
  };
}
