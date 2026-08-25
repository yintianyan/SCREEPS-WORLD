/**
 * Bottleneck Detection — A4.3 Phase 5：瓶颈检测 + 链分析。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #9（无 Logistics Bottleneck Detection）、
 * §10 #26 #27。
 *
 * 设计意图：
 *   区分 Production/Logistics/Storage/Consumption/Spawn 瓶颈。
 *   识别 Bottleneck Chain 中的真正限制环节。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

// ─── 类型 ──────────────────────────────────────────────────

/**
 * Bottleneck 类型。
 */
export type BottleneckType =
  | "production"
  | "logistics"
  | "storage"
  | "consumption"
  | "spawn";

/**
 * Bottleneck Chain 链节。
 */
export interface BottleneckChainLink {
  /** 环节类型。 */
  step: BottleneckType;
  /** 实际速率 (e/tick)。 */
  rate: number;
  /** 容量速率 (e/tick)。 */
  capacity: number;
  /** 利用率 (0..1)。 */
  utilization: number;
}

/**
 * Bottleneck 检测结果。
 */
export interface BottleneckResult {
  /** 房间名。 */
  room: string;
  /** 瓶颈类型。 */
  type: BottleneckType;
  /** 严重度 (0..1, 1=最严重)。 */
  severity: number;
  /** 瓶颈链。 */
  chain: BottleneckChainLink[];
  /** 限制环节。 */
  limitingStep: BottleneckType;
  /** 原因。 */
  reason: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * Bottleneck Detection + Chain 分析。
 *
 * 输入四个环节的速率和容量，识别真正限制环节。
 *
 * 纯函数。
 */
export function detectBottleneck(
  productionRate: number,
  logisticsCapacity: number,
  storageCapacity: number,
  consumptionRate: number,
  room: string,
): BottleneckResult {
  // 构建瓶颈链
  const chain: BottleneckChainLink[] = [
    {
      step: "production",
      rate: productionRate,
      capacity: productionRate, // production 的 capacity = 当前 rate（无上限信息）
      utilization: 1.0,
    },
    {
      step: "logistics",
      rate: Math.min(productionRate, logisticsCapacity),
      capacity: logisticsCapacity,
      utilization: logisticsCapacity > 0 ? Math.min(1, productionRate / logisticsCapacity) : 1,
    },
    {
      step: "storage",
      rate: Math.min(productionRate, storageCapacity),
      capacity: storageCapacity,
      utilization: storageCapacity > 0 ? Math.min(1, productionRate / storageCapacity) : 0,
    },
    {
      step: "consumption",
      rate: consumptionRate,
      capacity: consumptionRate,
      utilization: consumptionRate > 0 ? Math.min(1, productionRate / consumptionRate) : 0,
    },
  ];

  // 找限制环节（capacity 最小的环节）
  let limitingStep: BottleneckType = "production";
  let minCapacity = Infinity;
  for (const link of chain) {
    if (link.capacity < minCapacity && link.capacity > 0) {
      minCapacity = link.capacity;
      limitingStep = link.step;
    }
  }

  // 严重度 = 1 - (minCapacity / maxCapacity)
  const maxCapacity = Math.max(...chain.map(l => l.capacity));
  const severity = maxCapacity > 0 ? Math.max(0, 1 - minCapacity / maxCapacity) : 1;

  // 原因描述
  const limitingLink = chain.find(l => l.step === limitingStep);
  const reason = `${limitingStep} is limiting (capacity=${limitingLink?.capacity ?? 0} e/tick, utilization=${limitingLink?.utilization.toFixed(2) ?? 0})`;

  return {
    room,
    type: limitingStep,
    severity: Math.min(1, severity),
    chain,
    limitingStep,
    reason,
  };
}

/**
 * 判断是否为 Logistics Bottleneck（vs Economic Deficit）。
 * 纯函数。
 */
export function isLogisticsBottleneck(result: BottleneckResult): boolean {
  return result.limitingStep === "logistics";
}

/**
 * 判断是否为 Production Bottleneck。
 * 纯函数。
 */
export function isProductionBottleneck(result: BottleneckResult): boolean {
  return result.limitingStep === "production";
}

/**
 * 批量检测多房间瓶颈。
 * 纯函数。
 */
export function batchDetectBottlenecks(
  inputs: readonly {
    room: string;
    productionRate: number;
    logisticsCapacity: number;
    storageCapacity: number;
    consumptionRate: number;
  }[],
): BottleneckResult[] {
  return inputs.map(input =>
    detectBottleneck(
      input.productionRate,
      input.logisticsCapacity,
      input.storageCapacity,
      input.consumptionRate,
      input.room,
    ),
  );
}
