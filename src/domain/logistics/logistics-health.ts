/** Logistics Health */

import type { TransportAccounting } from "./transport-accounting";
import { isComplete } from "./transport-accounting";
import type { TransportRequestV2 } from "./transport-request";
import { isActiveRequest } from "./transport-request";

// ─── 类型 ──────────────────────────────────────────────────

/**
 * Logistics 健康度等级。
 */
export type LogisticsHealthLevel =
  "healthy" | "stable" | "degraded" | "congested" | "starved" | "critical";

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
 * 延迟样本均值（纯函数）。
 *
 * `latencyRing` 记录的是「请求从首次在册到被认领」的 tick 差；空环返回 0（无样本）。
 * 四舍五入到整数 tick，与日志/判据（>500 判 congested）同量纲。
 */
export function averageLatency(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += Math.max(0, sample);
  return Math.round(sum / samples.length);
}

/**
 * 新请求的交付宽限（tick）：一趟搬运（认领→取货→送达）的最短耗时量级。
 * 宽限内且零证据（delivered=0 && lost=0）的请求是「在途」，不算交付率的分母；
 * 超过宽限仍零证据 ⇒ 真饿死，照常入分母（饿死不会被本宽限掩盖）。
 */
export const LOGISTICS_DELIVERY_GRACE_TICKS = 200;

/**
 * 计算 Logistics Health。

 * 与 network-health.ts 的区别：
 *   - network-health 看 supply/demand gap（资源层）
 *   - logistics-health 看 delivery rate / loss / latency（执行层）

 * 纯函数。
 */
export function computeLogisticsHealth(
  accounting: readonly TransportAccounting[],
  activeRequests: readonly TransportRequestV2[],
  avgLatency: number,
  tick: number,
): LogisticsHealthResult {
  // 基本统计 —— 分母只收「有结论或已过宽限」的请求；零证据的在途请求单列。
  // 线上实证（2026-11-22）：2 条刚在册的请求把 dRate 打成 0% ⇒ level=critical/score=0，
  // 与 empireHealth 的 logistics=1.0 互相打脸。宽限 = 一趟搬运（认领→取货→送达）的
  // 最短耗时量级；超宽限仍零证据 ⇒ 真饿死，照常入分母。
  const GRACE = LOGISTICS_DELIVERY_GRACE_TICKS;
  let totalRequested = 0;
  let totalDelivered = 0;
  let totalLost = 0;
  let inFlightCount = 0;
  for (const a of accounting) {
    const hasEvidence = a.delivered > 0 || a.lost > 0;
    const pastGrace = a.createdAt === undefined || tick - a.createdAt >= GRACE;
    if (!hasEvidence && !pastGrace) {
      inFlightCount++;
      continue;
    }
    totalRequested += a.requested;
    totalDelivered += a.delivered;
    totalLost += a.lost;
  }

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
  if (inFlightCount > 0) parts.push(`inFlight=${inFlightCount}`);
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
