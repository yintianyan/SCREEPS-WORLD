/**
 * Starvation Detection — A4.3 Phase 5：饥饿检测。
 *
 * 合同锚点：A4.3 Architecture Audit §10 #28。
 *
 * 设计意图：
 *   长期缺资源 + Empire 总量足够 = Logistics Failure。
 *   区分「真的没资源」（Economic Deficit）和「有资源但运不到」（Logistics Failure）。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

// ─── 结果 ──────────────────────────────────────────────────

/**
 * Starvation 检测结果。
 */
export interface StarvationResult {
  /** 房间名。 */
  room: string;
  /** 是否饥饿。 */
  starving: boolean;
  /** 饥饿类型。 */
  type: "economic-deficit" | "logistics-failure" | "none";
  /** 原因。 */
  reason: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * Starvation Detection。
 *
 * 判断逻辑：
 *   1. deficitDuration > threshold → 饥饿
 *   2. empireTotalSupply >= empireTotalDemand → Logistics Failure（有资源但运不到）
 *   3. empireTotalSupply < empireTotalDemand → Economic Deficit（真的没资源）
 *
 * 纯函数。
 */
export function detectStarvation(
  room: string,
  deficitDuration: number,
  empireTotalSupply: number,
  empireTotalDemand: number,
  threshold: number = 1000,
): StarvationResult {
  // 未达饥饿阈值
  if (deficitDuration < threshold) {
    return {
      room,
      starving: false,
      type: "none",
      reason: `deficit duration ${deficitDuration}t < threshold ${threshold}t`,
    };
  }

  // 饥饿——判断类型
  if (empireTotalSupply >= empireTotalDemand) {
    // Empire 总量够 → Logistics Failure
    return {
      room,
      starving: true,
      type: "logistics-failure",
      reason: `deficit for ${deficitDuration}t, empire supply ${empireTotalSupply} >= demand ${empireTotalDemand}`,
    };
  }

  // Empire 总量不够 → Economic Deficit
  return {
    room,
    starving: true,
    type: "economic-deficit",
    reason: `deficit for ${deficitDuration}t, empire supply ${empireTotalSupply} < demand ${empireTotalDemand}`,
  };
}

/**
 * 批量检测饥饿。
 * 纯函数。
 */
export function batchDetectStarvation(
  inputs: readonly {
    room: string;
    deficitDuration: number;
  }[],
  empireTotalSupply: number,
  empireTotalDemand: number,
  threshold?: number,
): StarvationResult[] {
  return inputs.map(input =>
    detectStarvation(
      input.room,
      input.deficitDuration,
      empireTotalSupply,
      empireTotalDemand,
      threshold,
    ),
  );
}
