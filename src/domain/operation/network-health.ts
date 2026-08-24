/**
 * Network Health — A3.1 Empire Resource Network 健康度
 *（A3.1 Architecture Review §4.6）。
 *
 * 四档健康度：
 *   - HEALTHY: 供给充足，无未满足需求
 *   - CONSTRAINED: 供给紧张，部分需求未满足但可管理
 *   - DEGRADED: 供给严重不足，多房需求未满足
 *   - CRITICAL: 网络崩溃——大量失败 Operation + 大量未满足需求
 *
 * 判断基于：
 *   - Supply vs Demand 缺口
 *   - 未满足需求数
 *   - 失败 Operation 数
 *   - Reservation 压力
 *   - Critical 房间数
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { NetworkSnapshot } from "./network-snapshot";
import type { OperationContext } from "./agenda-item";
import { isActive } from "./agenda-item";
import type { DemandNode } from "./demand-node";

/** 网络健康度四档。 */
export type NetworkHealthLevel =
  | "healthy"
  | "constrained"
  | "degraded"
  | "critical";

/** 网络健康度结果。 */
export interface NetworkHealthResult {
  /** 健康度等级。 */
  level: NetworkHealthLevel;
  /** 0..1 健康分数（1=完全健康）。 */
  score: number;
  /** 供需缺口（正=缺口，负=盈余）。 */
  gap: number;
  /** 未满足需求数。 */
  unsatisfiedCount: number;
  /** 失败 Operation 数。 */
  failedCount: number;
  /** 活跃 Operation 数。 */
  activeCount: number;
  /** Reservation 压力（活跃 Reservation / 总供给量）。 */
  reservationPressure: number;
  /** Critical 房间数（criticality=critical 的 Demand Nodes）。 */
  criticalRoomCount: number;
  /** 诊断消息。 */
  message: string;
}

/**
 * 计算 Network Health。
 *
 * @param snapshot 网络快照
 * @param operations 全部 Operation 列表（含终态）
 * @param tick 当前 tick
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function computeNetworkHealth(
  snapshot: NetworkSnapshot,
  operations: readonly OperationContext[],
  tick: number,
): NetworkHealthResult {
  const gap = snapshot.gap;
  const totalSupply = snapshot.totalSupply;
  const totalRemaining = snapshot.totalRemaining;

  // 统计失败 Operation（最近 1000 tick 内）
  const failedCount = operations.filter(
    op => op.status === "failed" && tick - op.updatedAt < 1000
  ).length;

  // 统计活跃 Operation
  const activeCount = operations.filter(isActive).length;

  // 统计未满足需求
  const unsatisfiedDemand = snapshot.demandNodes.filter(d => d.remaining > 0);
  const unsatisfiedCount = unsatisfiedDemand.length;

  // 统计 critical 房间
  const criticalRoomCount = snapshot.demandNodes.filter(
    d => d.criticality === "critical" && d.remaining > 0
  ).length;

  // Reservation 压力 = 活跃 Reservation 数 / (总供给量 + 1)
  const reservationPressure = totalSupply > 0
    ? snapshot.reservationCount / (totalSupply / 1000 + 1)
    : 0;

  // 健康分数（0..1）
  const supplyRatio = totalRemaining > 0
    ? Math.min(1, totalSupply / totalRemaining)
    : 1;
  const failurePenalty = Math.min(0.3, failedCount * 0.1);
  const pressurePenalty = Math.min(0.2, reservationPressure * 0.05);
  const criticalPenalty = Math.min(0.3, criticalRoomCount * 0.1);
  const score = Math.max(0, supplyRatio - failurePenalty - pressurePenalty - criticalPenalty);

  // 判定等级
  let level: NetworkHealthLevel;
  if (score >= 0.8 && criticalRoomCount === 0 && failedCount === 0) {
    level = "healthy";
  } else if (score >= 0.5 && criticalRoomCount <= 1) {
    level = "constrained";
  } else if (score >= 0.2) {
    level = "degraded";
  } else {
    level = "critical";
  }

  // 生成诊断消息
  const parts: string[] = [];
  parts.push(`level=${level}`);
  parts.push(`score=${score.toFixed(2)}`);
  parts.push(`supply=${totalSupply}`);
  parts.push(`remaining=${totalRemaining}`);
  parts.push(`gap=${gap}`);
  parts.push(`unsatisfied=${unsatisfiedCount}`);
  parts.push(`failed=${failedCount}`);
  parts.push(`active=${activeCount}`);
  parts.push(`critical=${criticalRoomCount}`);
  parts.push(`pressure=${reservationPressure.toFixed(2)}`);
  const message = parts.join(", ");

  return {
    level,
    score,
    gap,
    unsatisfiedCount,
    failedCount,
    activeCount,
    reservationPressure,
    criticalRoomCount,
    message,
  };
}
