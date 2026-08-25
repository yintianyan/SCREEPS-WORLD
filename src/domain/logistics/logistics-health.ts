/**
 * Logistics Health — A4.3 Phase 6：物流健康度。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #19（无 Logistics Health）、§10 #33。
 *
 * 设计意图：
 *   与 network-health.ts 的区别：
 *   - network-health 看 supply/demand gap（资源层）
 *   - logistics-health 看 delivery rate / loss / latency（执行层）
 *
 *   六档健康度：
 *   - healthy:    运力充足，交付率高
 *   - stable:      运力匹配，偶有积压
 *   - degraded:    运力不足，部分积压
 *   - congested:   路由拥堵，交付延迟
 *   - starved:     长期缺资源，物流失败
 *   - critical:    网络崩溃，大量失败
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { TransportAccounting } from "./transport-accounting";
import { deliveryRate, lossRate, isComplete } from "./transport-accounting";
import type { TransportRequestV2 } from "./transport-request";
import { isActiveRequest } from "./transport-request";

// ─── 类型 ──────────────────────────────────────────────────

/**
 * Logistics 健康度等级。
 */
export type LogisticsHealthLevel =
  | "healthy"
  | "stable"
  | "degraded"
  | "congested"
  | "starved"
  | "critical";

/**
 * Logistics 健康度结果。
 */
export interface LogisticsHealthResult {
  /** 等级。 */
  level: LogisticsHealthLevel;
  /** 健康分数 (0..1, 1=完全健康)。 */
  score: number;
  /** 交付率 (0..1)。 */
  deliveryRate: number;
  /** 损失率 (0..1)。 */
  lossRate: number;
  /** 平均延迟（tick）。 */
  avgLatency: number;
  /** 积压请求数。 */
  backlogCount: number;
  /** 瓶颈房间。 */
  bottleneckRoom?: string;
  /** 诊断消息。 */
  message: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 计算 Logistics Health。
 *
 * 与 network-health.ts 的区别：
 *   - network-health 看 supply/demand gap（资源层）
 *   - logistics-health 看 delivery rate / loss / latency（执行层）
 *
 * 纯函数。
 */
export function computeLogisticsHealth(
  accounting: readonly TransportAccounting[],
  activeRequests: readonly TransportRequestV2[],
  avgLatency: number,
  tick: number,
): LogisticsHealthResult {
  // 基本统计
  const totalRequested = accounting.reduce((s, a) => s + a.requested, 0);
  const totalDelivered = accounting.reduce((s, a) => s + a.delivered, 0);
  const totalLost = accounting.reduce((s, a) => s + a.lost, 0);

  const dRate = totalRequested > 0 ? totalDelivered / totalRequested : 1;
  const lRate = totalRequested > 0 ? totalLost / totalRequested : 0;
  const backlogCount = activeRequests.filter(r => isActiveRequest(r.status)).length;
  const completedCount = accounting.filter(isComplete).length;

  // 健康分数
  const deliveryScore = dRate; // 0..1
  const lossPenalty = Math.min(0.3, lRate * 3);
  const latencyPenalty = Math.min(0.2, avgLatency / 1000);
  const backlogPenalty = Math.min(0.2, backlogCount / 50);
  const score = Math.max(0, deliveryScore - lossPenalty - latencyPenalty - backlogPenalty);

  // 判定等级
  let level: LogisticsHealthLevel;
  if (score >= 0.9 && lRate < 0.05 && backlogCount < 5) {
    level = "healthy";
  } else if (score >= 0.7 && backlogCount < 15) {
    level = "stable";
  } else if (score >= 0.5) {
    level = avgLatency > 500 ? "congested" : "degraded";
  } else if (score >= 0.3) {
    level = "starved";
  } else {
    level = "critical";
  }

  // 诊断消息
  const parts: string[] = [];
  parts.push(`level=${level}`);
  parts.push(`score=${score.toFixed(2)}`);
  parts.push(`delivery=${(dRate * 100).toFixed(1)}%`);
  parts.push(`loss=${(lRate * 100).toFixed(1)}%`);
  parts.push(`latency=${avgLatency}t`);
  parts.push(`backlog=${backlogCount}`);
  parts.push(`completed=${completedCount}`);
  const message = parts.join(", ");

  return {
    level,
    score,
    deliveryRate: dRate,
    lossRate: lRate,
    avgLatency,
    backlogCount,
    message,
  };
}
