/** Batch Sizing */

// ─── 输入 / 输出 ──────────────────────────────────────────

/**
 * Batch Sizing 输入参数。
 */
export interface BatchSizingInput {
  /** 源侧可用量。 */
  sourceAvailable: number;
  /** 目标侧需求量。 */
  destinationDemand: number;
  /** 单个 hauler carry capacity。 */
  haulerCapacity: number;
  /** 运输成本（来自 transport-cost.ts，用于判断是否值得大批量运输）。 */
  travelCost: number;
  /** 优先级。 */
  priority: 0 | 1 | 2 | 3;
  /** 截止 tick。 */
  deadline: number;
  /** 当前 tick。 */
  currentTick: number;
  /** 最小批量。 */
  minBatch?: number;
  /** 最大批量。 */
  maxBatch?: number;
}

/**
 * Batch Sizing 结果。
 */
export interface BatchSizingResult {
  /** 计算出的批量大小。 */
  batchSize: number;
  /** 需要的来回趟数。 */
  trips: number;
  /** 是否紧急模式。 */
  emergency: boolean;
  /** 决策原因。 */
  reason: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/** 紧急模式阈值：剩余时间 < 200 tick。 */
const EMERGENCY_DEADLINE_TICKS = 200;

/** 默认参数。 */
const DEFAULT_MIN_BATCH = 100;
const DEFAULT_MAX_BATCH = 5000;

/**
 * 动态 Batch Size 计算。

 * 算法：
 *   1. 理论批量 = min(sourceAvailable, destinationDemand)
 *   2. 如果 haulerCapacity > 0:
 *      经济批量 = ceil(理论批量 / haulerCapacity) × haulerCapacity（向上取整到满载）
 *   3. 否则经济批量 = 理论批量
 *   4. 紧急模式（deadline 紧迫或 priority=0）: 批量取 minBatch（快速响应）
 *   5. 最终批量 = clamp(minBatch, 经济批量, maxBatch)
 *   6. trips = ceil(批量 / haulerCapacity)

 * 纯函数 — 不访问 Game/Memory。
 */
export function computeBatchSize(input: BatchSizingInput): BatchSizingResult {
  const minBatch = input.minBatch ?? DEFAULT_MIN_BATCH;
  const maxBatch = input.maxBatch ?? DEFAULT_MAX_BATCH;
  const remainingTime = input.deadline - input.currentTick;
  const emergency = remainingTime < EMERGENCY_DEADLINE_TICKS || input.priority === 0;

  // 理论批量
  const theoretical = Math.min(
    Math.max(0, input.sourceAvailable),
    Math.max(0, input.destinationDemand),
  );

  if (theoretical <= 0) {
    return {
      batchSize: 0,
      trips: 0,
      emergency: false,
      reason: "no available supply or demand",
    };
  }

  // 经济批量（满载优化）
  let economic: number;
  if (input.haulerCapacity > 0) {
    economic = Math.ceil(theoretical / input.haulerCapacity) * input.haulerCapacity;
  } else {
    economic = theoretical;
  }

  // 紧急模式：取 minBatch（快速响应，不等满载）
  let batchSize: number;
  let reason: string;

  if (emergency) {
    // 紧急模式：至少 minBatch，最多 maxBatch
    batchSize = Math.min(theoretical, Math.max(minBatch, input.haulerCapacity > 0 ? input.haulerCapacity : minBatch));
    reason = `emergency (priority=${input.priority}, remaining=${remainingTime}t)`;
  } else {
    batchSize = economic;
    reason = `economic (theoretical=${theoretical}, capacity=${input.haulerCapacity})`;
  }

  // clamp
  batchSize = Math.max(minBatch, Math.min(batchSize, maxBatch, theoretical));

  // 如果 clamp 后小于 minBatch（但 > 0），仍然返回（少量也比不运好）
  if (batchSize < minBatch && theoretical > 0 && theoretical < minBatch) {
    batchSize = theoretical;
    reason += ` [below minBatch, using all available=${theoretical}]`;
  }

  // trips
  const trips = input.haulerCapacity > 0
    ? Math.ceil(batchSize / input.haulerCapacity)
    : 1;

  return {
    batchSize,
    trips,
    emergency,
    reason,
  };
}

// ─── 便捷计算 ──────────────────────────────────────────────

/**
 * 快速计算批量大小（使用默认参数）。
 * 纯函数。
 */
export function quickBatchSize(
  sourceAvailable: number,
  destinationDemand: number,
  haulerCapacity: number,
  priority: 0 | 1 | 2 | 3,
  deadline: number,
  currentTick: number,
): BatchSizingResult {
  return computeBatchSize({
    sourceAvailable,
    destinationDemand,
    haulerCapacity,
    travelCost: 0,
    priority,
    deadline,
    currentTick,
  });
}

/**
 * 判断是否应该批量运输（vs 等待更多积压）。
 * 当可用量 < minBatch 时不应运输。
 * 纯函数。
 */
export function shouldBatch(
  available: number,
  minBatch: number,
  haulerCapacity: number,
): boolean {
  if (available < minBatch) return false;
  // 如果不够一趟满载，也不值得运
  if (haulerCapacity > 0 && available < haulerCapacity * 0.5) return false;
  return true;
}
