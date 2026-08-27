/** Transport Cost */

// ─── 距离成本 ─────────────────────────────────────────────

/**
 * 计算路径距离成本。

 * 使用线性距离作为近似值（避免每 tick 调 PathFinder.search）。
 * distanceCost = linearDistance × DISTANCE_WEIGHT

 * 纯函数。

 * @param linearDistance 两房间间的线性距离（Game.map.getRoomLinearDistance）
 * @param weight 每单位距离的权重（默认 10）
 */
export function computeDistanceCost(
  linearDistance: number,
  weight: number = 10,
): number {
  return Math.max(0, linearDistance * weight);
}

// ─── Hauler Body 成本 ─────────────────────────────────────

/**
 * Hauler body 配置摘要（由系统侧从 CONFIG.bodies 注入）。
 */
export interface HaulerBodyConfig {
  /** body 中的 CARRY 部件数。 */
  carryParts: number;
  /** body 中的 MOVE 部件数。 */
  moveParts: number;
  /** spawn 此 body 的总能量花费。 */
  spawnCost: number;
  /** 负重（= carryParts × 50）。 */
  capacity: number;
}

/**
 * 计算 Hauler body 成本。

 * bodyCost = spawnCost / expectedLifespanTicks
 * （将 spawn 成本均摊到预期寿命上）

 * 纯函数。

 * @param body Hauler body 配置
 * @param expectedLifespan 预期寿命 tick 数（默认 1000，即 CREEP_LIFE_TIME）
 * @param costPerSpawnEnergy 每 1 spawn 能量的成本权重（默认 1）
 */
export function computeBodyCost(
  body: HaulerBodyConfig,
  expectedLifespan: number = 1000,
  costPerSpawnEnergy: number = 1,
): number {
  if (expectedLifespan <= 0) return body.spawnCost * costPerSpawnEnergy;
  return (body.spawnCost * costPerSpawnEnergy) / expectedLifespan;
}

// ─── 能量损耗成本 ─────────────────────────────────────────

/**
 * 计算搬运过程中的能量损耗成本。

 * Hauler 每个来回需要走 distance × 2 步（去 + 回）。
 * 路上每 tick 有 fatigue / move 消耗（如果道路不通畅）。
 * 这里使用简化模型：energyLoss = roundTrips × decayPerTrip

 * 纯函数。

 * @param amount 搬运总量
 * @param body Hauler body 配置
 * @param linearDistance 线性距离
 * @param decayPerTrip 每趟来回的能量损耗（默认 0，理想道路无损耗）
 */
export function computeEnergyCost(
  amount: number,
  body: HaulerBodyConfig,
  linearDistance: number,
  decayPerTrip: number = 0,
): number {
  if (body.capacity <= 0 || amount <= 0) return 0;
  const roundTrips = Math.ceil(amount / body.capacity);
  return roundTrips * decayPerTrip;
}

// ─── 时间成本 ─────────────────────────────────────────────

/**
 * 计算搬运时间成本。

 * timeCost = totalTicks × cpuTimeValue

 * totalTicks = roundTrips × roundTripTicks
 * roundTripTicks ≈ linearDistance × 2 / moveSpeed
 * moveSpeed = 1（有路）或 0.5（无路）

 * 纯函数。

 * @param amount 搬运总量
 * @param body Hauler body 配置
 * @param linearDistance 线性距离
 * @param cpuTimeValue 每 tick 的 CPU 时间价值（默认 0.1）
 * @param hasRoad 是否有路（影响 moveSpeed）
 */
export function computeTimeCost(
  amount: number,
  body: HaulerBodyConfig,
  linearDistance: number,
  cpuTimeValue: number = 0.1,
  hasRoad: boolean = true,
): number {
  if (body.capacity <= 0 || amount <= 0) return 0;
  const roundTrips = Math.ceil(amount / body.capacity);
  const moveSpeed = hasRoad ? 1 : 0.5;
  const roundTripTicks = linearDistance > 0
    ? Math.ceil((linearDistance * 2) / moveSpeed)
    : 1;
  const totalTicks = roundTrips * roundTripTicks;
  return totalTicks * cpuTimeValue;
}

// ─── 总运输成本 ───────────────────────────────────────────

/**
 * 运输成本输入参数。
 */
export interface TransportCostInput {
  /** 搬运总量。 */
  amount: number;
  /** 线性距离（Game.map.getRoomLinearDistance）。 */
  linearDistance: number;
  /** Hauler body 配置。 */
  body: HaulerBodyConfig;
  /** 是否有路（影响时间成本）。 */
  hasRoad: boolean;
  /** 每趟来回的能量损耗。 */
  decayPerTrip: number;
  /** Hauler 预期寿命。 */
  haulerLifespan: number;
  /** 距离权重。 */
  distanceWeight: number;
  /** 每 spawn 能量的成本权重。 */
  costPerSpawnEnergy: number;
  /** 每 tick 的 CPU 时间价值。 */
  cpuTimeValue: number;
}

/**
 * 默认运输成本参数。
 */
export const DEFAULT_TRANSPORT_PARAMS: Omit<TransportCostInput, "amount" | "linearDistance" | "body"> = {
  hasRoad: true,
  decayPerTrip: 0,
  haulerLifespan: 1000,
  distanceWeight: 10,
  costPerSpawnEnergy: 1,
  cpuTimeValue: 0.1,
};

/**
 * 运输成本明细。
 */
export interface TransportCostBreakdown {
  /** 距离成本。 */
  distance: number;
  /** Body 成本。 */
  body: number;
  /** 能量损耗成本。 */
  energy: number;
  /** 时间成本。 */
  time: number;
  /** 总成本。 */
  total: number;
  /** 来回趟数。 */
  roundTrips: number;
  /** 预估总 tick 数。 */
  estimatedTicks: number;
}

/**
 * 计算总运输成本（含明细）。

 * totalCost = distanceCost + bodyCost + energyCost + timeCost

 * 纯函数。
 */
export function computeTransportCost(
  input: TransportCostInput,
): TransportCostBreakdown {
  const {
    amount, linearDistance, body,
    hasRoad, decayPerTrip, haulerLifespan,
    distanceWeight, costPerSpawnEnergy, cpuTimeValue,
  } = input;

  const distance = computeDistanceCost(linearDistance, distanceWeight);
  const bodyCost = computeBodyCost(body, haulerLifespan, costPerSpawnEnergy);
  const energy = computeEnergyCost(amount, body, linearDistance, decayPerTrip);

  // 时间成本
  const roundTrips = body.capacity > 0 && amount > 0
    ? Math.ceil(amount / body.capacity)
    : 0;
  const moveSpeed = hasRoad ? 1 : 0.5;
  const roundTripTicks = linearDistance > 0
    ? Math.ceil((linearDistance * 2) / moveSpeed)
    : 1;
  const estimatedTicks = roundTrips * roundTripTicks;
  const time = estimatedTicks * cpuTimeValue;

  const total = distance + bodyCost + energy + time;

  return { distance, body: bodyCost, energy, time, total, roundTrips, estimatedTicks };
}

// ─── 便捷计算 ─────────────────────────────────────────────

/**
 * 使用默认参数快速计算运输总成本。
 * 纯函数。
 */
export function quickTransportCost(
  amount: number,
  linearDistance: number,
  body: HaulerBodyConfig,
  overrides?: Partial<TransportCostInput>,
): TransportCostBreakdown {
  const input: TransportCostInput = {
    ...DEFAULT_TRANSPORT_PARAMS,
    amount,
    linearDistance,
    body,
    ...overrides,
  };
  return computeTransportCost(input);
}
