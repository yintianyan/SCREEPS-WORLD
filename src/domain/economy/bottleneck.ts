/** Resource Bottleneck */

import type { ResourceType } from "../operation/agenda-item";
import type { ResourceLedger } from "./resource-ledger";
import { stockReserve } from "./resource-ledger";
import type { ResourceHealthResult } from "./resource-health";
import { evaluateResourceHealth } from "./resource-health";
import { isCriticalResource, defaultSafetyReserve } from "./resource-definition";

// ─── 瓶颈条目 ──────────────────────────────────────────────

/**
 * 单资源的瓶颈评估结果。
 */
export interface BottleneckEntry {
  /** 资源类型。 */
  resource: ResourceType;
  /** 瓶颈分数（0..1，越高越严重）。 */
  score: number;
  /** 人类可读原因。 */
  reason: string;
  /** 健康度。 */
  health: ResourceHealthResult["health"];
  /** 缺口量。 */
  deficit: number;
  /** 生产速率。 */
  productionRate: number;
  /** 消费速率。 */
  consumptionRate: number;
  /** 生产缺口 = consumptionRate - productionRate（正值 = 供不应求）。 */
  productionGap: number;
  /** 是否为关键资源。 */
  critical: boolean;
  /** 恢复所需资源量（达到 safetyReserve 的缺口）。 */
  recoveryAmount: number;
}

// ─── 排序参数 ──────────────────────────────────────────────

/** 瓶颈排序参数。 */
export interface BottleneckOptions {
  /** 关键资源权重倍数（关键资源的 score × 此值）。 */
  criticalMultiplier: number;
  /** 缺口绝对值权重（deficit × 此值）。 */
  deficitWeight: number;
  /** 生产缺口权重（productionGap × 此值）。 */
  productionGapWeight: number;
  /** 健康度权重（healthRank 反转 × 此值）。 */
  healthWeight: number;
}

/** 默认参数。 */
export const DEFAULT_BOTTLENECK_OPTIONS: BottleneckOptions = {
  criticalMultiplier: 1.5,
  deficitWeight: 0.4,
  productionGapWeight: 0.3,
  healthWeight: 0.3,
};

// ─── 评估函数 ──────────────────────────────────────────────

/**
 * 评估单个资源的瓶颈分数。纯函数。

 * 分数 = (deficitScore × deficitWeight + productionGapScore × productionGapWeight
 *         + healthScore × healthWeight) × criticalMultiplier

 * 各子分数归一化到 [0, 1]。
 */
export function evaluateBottleneck(
  resource: ResourceType,
  healthResult: ResourceHealthResult,
  options: BottleneckOptions = DEFAULT_BOTTLENECK_OPTIONS,
): BottleneckEntry {
  const { deficit, health, critical, reserve, safetyReserve } = healthResult;
  const productionRate = healthResult.productionRate ?? 0;
  const consumptionRate = healthResult.consumptionRate ?? 0;

  // 缺口分数：deficit / max(safetyReserve, 1)，clamp [0, 1]
  const deficitScore = Math.min(1, deficit / Math.max(safetyReserve, 1));

  // 生产缺口分数：productionGap / max(consumptionRate, 1)，clamp [0, 1]
  const productionGap = Math.max(0, consumptionRate - productionRate);
  const productionGapScore = consumptionRate > 0
    ? Math.min(1, productionGap / consumptionRate)
    : 0;

  // 健康度分数：越差越高（critical=1.0, deficit=0.8, degraded=0.6, stable=0.2, healthy=0.0）
  const healthScore = healthToScore(health);

  // 恢复量 = safetyReserve - reserve（达到安全储备还需多少）
  const recoveryAmount = Math.max(0, safetyReserve - reserve);

  // 综合分数
  let score = deficitScore * options.deficitWeight
    + productionGapScore * options.productionGapWeight
    + healthScore * options.healthWeight;

  // 关键资源加权
  if (critical) {
    score *= options.criticalMultiplier;
  }

  // clamp [0, 1]
  score = Math.max(0, Math.min(1, score));

  // 原因
  const reasons: string[] = [];
  if (healthScore >= 0.6) reasons.push(`health=${health}`);
  if (deficitScore > 0.3) reasons.push(`deficit=${deficit}`);
  if (productionGapScore > 0.3) reasons.push(`prodGap=${productionGap.toFixed(1)}/tick`);
  if (critical) reasons.push("critical");
  const reason = reasons.length > 0 ? reasons.join(", ") : "no-bottleneck";

  return {
    resource,
    score,
    reason,
    health,
    deficit,
    productionRate,
    consumptionRate,
    productionGap,
    critical,
    recoveryAmount,
  };
}

/**
 * 识别并排序瓶颈资源。纯函数。

 * @param ledger 帝国级 ResourceLedger
 * @param options 排序参数
 * @returns 按瓶颈分数降序排列的列表（空列表 = 无瓶颈）
 */
export function identifyBottlenecks(
  ledger: ResourceLedger,
  options: BottleneckOptions = DEFAULT_BOTTLENECK_OPTIONS,
): BottleneckEntry[] {
  const entries: BottleneckEntry[] = [];

  for (const [resource, entry] of ledger) {
    const healthResult = evaluateResourceHealth(entry, 0);
    const bottleneck = evaluateBottleneck(resource, healthResult, options);
    // 只收录分数 > 0 的资源（完全健康的资源不列入瓶颈）
    if (bottleneck.score > 0) {
      entries.push(bottleneck);
    }
  }

  // 按分数降序排列
  entries.sort((a, b) => b.score - a.score);

  return entries;
}

/**
 * 获取最严重的瓶颈资源。纯函数。
 * 返回 undefined 表示无瓶颈。
 */
export function getTopBottleneck(
  ledger: ResourceLedger,
  options: BottleneckOptions = DEFAULT_BOTTLENECK_OPTIONS,
): BottleneckEntry | undefined {
  const list = identifyBottlenecks(ledger, options);
  return list.length > 0 ? list[0] : undefined;
}

// ─── 内部工具 ────────────────────────────────────────────

/**
 * 健康度 → 瓶颈分数（越差越高）。内部函数。
 */
function healthToScore(h: ResourceHealthResult["health"]): number {
  switch (h) {
    case "critical": return 1.0;
    case "deficit": return 0.8;
    case "degraded": return 0.6;
    case "stable": return 0.2;
    case "healthy": return 0.0;
  }
}
