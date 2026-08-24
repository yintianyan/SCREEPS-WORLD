import { CONFIG } from "../../config";

/**
 * 远矿 hauler 的孵化编制。满产需求按当前已就位（或已排队）采集者等比收缩；
 * 这是"少孵"的软上限，不用于回收健康现役 hauler——远矿通勤反馈长，已付出的
 * 运力应留到采集端恢复，避免低能量期把收缩放大成断供。
 */
export function remoteHaulerTarget(
  sources: number | undefined,
  haulerNeed: number | undefined,
  harvestersReady: number,
): number {
  const sourcesTotal = Math.max(1, sources ?? CONFIG.remote.harvestersPerTarget);
  const effectiveSources = Math.min(sourcesTotal, Math.max(1, harvestersReady));
  return Math.max(1, Math.ceil(
    (haulerNeed ?? CONFIG.remote.haulersPerTarget) * (effectiveSources / sourcesTotal),
  ));
}

/**
 * 远矿交接窗口中的通勤预算。pathCost 的 plain=1/swamp=5 与满 MOVE 通勤
 * tick 同量纲；额外 15 tick 覆盖出生、出口和 source/container 的末段偏差。
 */
export function remoteTravelBuffer(pathCost: number | undefined): number {
  if (pathCost === undefined || !Number.isFinite(pathCost)) return 50;
  return Math.max(35, Math.min(250, Math.ceil(pathCost) + 15));
}

/** 孵化时间 + 常规替补余量 + 到远矿岗位的通勤时间。 */
export function remoteReplacementThreshold(
  bodyLength: number | undefined,
  pathCost: number | undefined,
): number {
  return (bodyLength ?? 3) * 3 + CONFIG.spawn.replaceBuffer + remoteTravelBuffer(pathCost);
}

// ─── A4.1 扩展：基于实际生产的 Hauler Sizing ──────────────

/**
 * Hauler Sizing 输入参数 — 基于实际生产、距离、运力的动态编制。
 */
export interface HaulerSizingInput {
  /** 预期产出速率（e/tick）。 */
  expectedProduction: number;
  /** 实际产出速率（e/tick），如 0 则用预期值。 */
  actualProduction: number;
  /** PathFinder 实测通勤成本（plain=1, swamp=5）。 */
  pathCost: number;
  /** 是否有路（有路速度 ×2）。 */
  hasRoad: boolean;
  /** hauler body 的 CARRY 部件数。 */
  haulerCarryParts: number;
  /** hauler body 的 MOVE 部件数。 */
  haulerMoveParts: number;
  /** 当前 hauler 数量。 */
  currentHaulers: number;
  /** hauler 配额上限（防无限增长）。 */
  maxHaulers: number;
}

/**
 * Hauler Sizing 结果。
 */
export interface HaulerSizingResult {
  /** 所需 hauler 数量。 */
  requiredHaulers: number;
  /** 单只 hauler 运力（每 tick 能量）。 */
  perHaulerThroughput: number;
  /** 总运力（e/tick）。 */
  totalTransportCapacity: number;
  /** 往返时间（tick）。 */
  roundTripTime: number;
  /** 是否运力不足。 */
  isInsufficient: boolean;
  /** 是否运力过剩。 */
  isExcessive: boolean;
  /** 建议调整数量（正=增加，负=减少，0=维持）。 */
  adjustment: number;
}

/**
 * 计算单只 hauler 的吞吐量。
 *
 * perHaulerThroughput = carryCapacity / roundTripTime
 * carryCapacity = haulerCarryParts × 50
 * roundTripTime = pathCost × 2 / speed (有路 speed=2, 无路 speed=1)
 *
 * 纯函数。
 */
export function computePerHaulerThroughput(
  haulerCarryParts: number,
  pathCost: number,
  hasRoad: boolean,
): { throughput: number; roundTripTime: number; carryCapacity: number } {
  const carryCapacity = haulerCarryParts * CARRY_CAPACITY;
  const speed = hasRoad ? 2 : 1;
  const roundTripTime = Math.max(2, Math.ceil((pathCost * 2) / speed));
  const throughput = carryCapacity / roundTripTime;
  return { throughput, roundTripTime, carryCapacity };
}

/**
 * 基于 Expected Production / Travel Distance / Carry Capacity / Road Efficiency
 * 计算所需 hauler 数量。
 *
 * Transport Capacity ≥ Expected Production
 * requiredHaulers = ceil(production / perHaulerThroughput)
 *
 * A4.1 扩展：基于实际 Production 而非理论 Production 收缩：
 * if actualProduction < expectedProduction × 0.5:
 *   haulerTarget = max(1, ceil(haulerNeed × (actualProduction / expectedProduction)))
 *
 * 纯函数。
 */
export function computeHaulerSizing(input: HaulerSizingInput): HaulerSizingResult {
  const effectiveProduction = input.actualProduction > 0
    ? Math.max(input.actualProduction, input.expectedProduction * 0.5)
    : input.expectedProduction;

  const { throughput, roundTripTime } = computePerHaulerThroughput(
    input.haulerCarryParts,
    input.pathCost,
    input.hasRoad,
  );

  const requiredHaulers = Math.max(
    1,
    Math.min(
      Math.ceil(effectiveProduction / Math.max(0.1, throughput)),
      input.maxHaulers,
    ),
  );

  const totalTransportCapacity = requiredHaulers * throughput;
  const isInsufficient = totalTransportCapacity < effectiveProduction;
  const isExcessive = !isInsufficient && input.currentHaulers > requiredHaulers + 1;
  const adjustment = requiredHaulers - input.currentHaulers;

  return {
    requiredHaulers,
    perHaulerThroughput: throughput,
    totalTransportCapacity,
    roundTripTime,
    isInsufficient,
    isExcessive,
    adjustment,
  };
}

/**
 * Transport Capacity 验证。
 *
 * if TransportCapacity < ExpectedProduction:
 *   → Container Fill Rate 监控
 *   → if Container 持续满:
 *     → DEGRADED：增加 Transport Capacity 或降低 Mining Capacity
 *
 * 纯函数。
 */
export function validateTransportCapacity(
  transportCapacity: number,
  expectedProduction: number,
): {
  sufficient: boolean;
  deficit: number;
  ratio: number;
} {
  const ratio = expectedProduction > 0
    ? transportCapacity / expectedProduction
    : 1;
  return {
    sufficient: transportCapacity >= expectedProduction,
    deficit: Math.max(0, expectedProduction - transportCapacity),
    ratio,
  };
}
