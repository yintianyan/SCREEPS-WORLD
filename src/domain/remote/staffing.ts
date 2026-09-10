import { CONFIG } from "../../config";

/**
 * 远矿 hauler 的孵化编制。hauler 数量 = ceil(source 总产出 / 单只 hauler 吞吐)。
 *
 * 单只吞吐 = carryCapacity / roundTripTime，
 * roundTripTime = ceil(pathCost × 2 / speed)，有路 speed=2 无路 speed=1。
 *
 * 大 body 时单只吞吐可能覆盖多个 source，haulerNeed 可低至 1；
 * 小 body 或远距离时可能需要 2-3 只。不做硬编码限制。
 *
 * 爬坡期按就位 harvester 数收缩（未到位不配满），下限 1 保物流连通。
 *
 * 纯函数。
 */
export function remoteHaulerTarget(
  sources: number | undefined,
  haulerNeed: number | undefined,
  harvestersReady: number,
): number {
  const harvestersAvailable = Math.max(1, harvestersReady);

  // haulerNeed 来自 scoreRemoteCandidate（按 pathCost、body 运力、source 产能算出）。
  // 缺失时回退 1（最小可用，不假设 source 数）。
  const target = Math.max(1, Math.min(CONFIG.remote.haulersMax, haulerNeed ?? 1));

  // 爬坡期收缩：未到位的 harvester 意味着产能未满，不需要满配 hauler。
  // 按 harvester 就位比例收缩，下限 1。
  return Math.max(1, Math.min(target, harvestersAvailable));
}

/**
 * 基于实际 body 配置精确计算 hauler 需求量。
 *
 * 不依赖缓存的 haulerNeed，而是用当前 body 的 carry 部件数、pathCost、
 * 道路状态直接算出。RCL 升级后 body 变大时自动缩编。
 *
 * 收入 = hauler 实际拉回 storage 的速率 = min(source 产出, hauler 总运力)。
 * 余量（运力 - 产出）超过 10% 视为过配，需缩编。
 *
 * 纯函数。
 */
export function computeHaulerNeed(
  sources: number | undefined,
  sourceIncomePerSource: number,
  haulerCarryParts: number,
  pathCost: number,
  hasRoad: boolean,
): { haulerNeed: number; perHaulerThroughput: number; totalThroughput: number; headroom: number } {
  const sourcesTotal = Math.max(1, sources ?? 1);
  const production = sourcesTotal * sourceIncomePerSource;

  const { throughput: perHaulerThroughput } = computePerHaulerThroughput(
    haulerCarryParts,
    pathCost,
    hasRoad,
  );

  const haulerNeed = Math.max(
    1,
    Math.min(CONFIG.remote.haulersMax, Math.ceil(production / Math.max(0.01, perHaulerThroughput))),
  );

  const totalThroughput = haulerNeed * perHaulerThroughput;
  const headroom = totalThroughput > 0 ? (totalThroughput - production) / production : 0;

  return { haulerNeed, perHaulerThroughput, totalThroughput, headroom };
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

 * perHaulerThroughput = carryCapacity / roundTripTime
 * carryCapacity = haulerCarryParts × 50
 * roundTripTime = pathCost × 2 / speed (有路 speed=2, 无路 speed=1)

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

 * Transport Capacity ≥ Expected Production
 * requiredHaulers = ceil(production / perHaulerThroughput)

 * A4.1 扩展：基于实际 Production 而非理论 Production 收缩：
 * if actualProduction < expectedProduction × 0.5:
 *   haulerTarget = max(1, ceil(haulerNeed × (actualProduction / expectedProduction)))

 * 纯函数。
 */
export function computeHaulerSizing(input: HaulerSizingInput): HaulerSizingResult {
  const effectiveProduction =
    input.actualProduction > 0
      ? Math.max(input.actualProduction, input.expectedProduction * 0.5)
      : input.expectedProduction;

  const { throughput, roundTripTime } = computePerHaulerThroughput(
    input.haulerCarryParts,
    input.pathCost,
    input.hasRoad,
  );

  const requiredHaulers = Math.max(
    1,
    Math.min(Math.ceil(effectiveProduction / Math.max(0.1, throughput)), input.maxHaulers),
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

 * if TransportCapacity < ExpectedProduction:
 *   → Container Fill Rate 监控
 *   → if Container 持续满:
 *     → DEGRADED：增加 Transport Capacity 或降低 Mining Capacity

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
  const ratio = expectedProduction > 0 ? transportCapacity / expectedProduction : 1;
  return {
    sufficient: transportCapacity >= expectedProduction,
    deficit: Math.max(0, expectedProduction - transportCapacity),
    ratio,
  };
}
