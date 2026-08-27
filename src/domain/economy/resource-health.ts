/** Resource Health */

import type { ResourceType } from "../operation/agenda-item";
import type { ResourceLedgerEntry } from "./resource-ledger";
import { stockReserve } from "./resource-ledger";
import { isCriticalResource, defaultSafetyReserve } from "./resource-definition";

// ─── 健康度枚举 ──────────────────────────────────────────────

/** 单资源健康状态。 */
export type ResourceHealthStatus =
  | "healthy"
  | "stable"
  | "degraded"
  | "deficit"
  | "critical";

// ─── 健康度评估结果 ───────────────────────────────────────────

/** 健康度评估结果。 */
export interface ResourceHealthResult {
  /** 资源类型。 */
  resource: ResourceType;
  /** 健康状态。 */
  health: ResourceHealthStatus;
  /** 人类可读的证据链。 */
  evidence: string;
  /** 当前储备量。 */
  reserve: number;
  /** 安全储备量。 */
  safetyReserve: number;
  /** 生产速率（单位/tick，undefined = 无数据）。 */
  productionRate: number | undefined;
  /** 消费速率（单位/tick，undefined = 无数据）。 */
  consumptionRate: number | undefined;
  /** 净速率 = productionRate - consumptionRate。 */
  netRate: number;
  /** 是否为关键资源。 */
  critical: boolean;
  /** 缺口量（>0 表示有缺口）。 */
  deficit: number;
}

// ─── 评估参数 ──────────────────────────────────────────────

/** 健康度评估参数。 */
export interface ResourceHealthOptions {
  /** STABLE 要求的最低储备覆盖率（reserve / safetyReserve）。 */
  stableCoverageRatio: number;
  /** HEALTHY 要求的最低储备覆盖率。 */
  healthyCoverageRatio: number;
  /** DEFICIT 的储备量绝对阈值（低于此值且 netRate < 0）。 */
  deficitAbsoluteThreshold: number;
  /** 速率 EMA alpha（由调用方传入，不在此模块硬编码）。 */
  rateAlpha: number;
}

/** 默认参数。 */
export const DEFAULT_RESOURCE_HEALTH_OPTIONS: ResourceHealthOptions = {
  stableCoverageRatio: 1.0,
  healthyCoverageRatio: 2.0,
  deficitAbsoluteThreshold: 100,
  rateAlpha: 0.15,
};

// ─── 评估函数 ──────────────────────────────────────────────

/**
 * 评估单资源健康度。纯函数。

 * 判定优先级（从高到低）：
 * 1. CRITICAL: reserve === 0 && productionRate === 0（无储备无生产）
 * 2. DEFICIT: reserve < deficitAbsoluteThreshold && netRate < 0
 * 3. DEGRADED: netRate < 0（趋势恶化）或 reserve < safetyReserve
 * 4. STABLE: coverage >= stableCoverageRatio
 * 5. HEALTHY: coverage >= healthyCoverageRatio && netRate >= 0

 * @param entry 资源账本条目
 * @param expectedConsumption 预期消费量（用于缺口计算，默认 0）
 * @param options 评估参数
 */
export function evaluateResourceHealth(
  entry: ResourceLedgerEntry,
  expectedConsumption: number = 0,
  options: ResourceHealthOptions = DEFAULT_RESOURCE_HEALTH_OPTIONS,
): ResourceHealthResult {
  const { resource } = entry;
  const reserve = stockReserve(entry.stock);
  const safety = defaultSafetyReserve(resource);
  const safetyReserve = safety > 0 ? safety : Math.max(reserve * 0.2, 5000);
  const productionRate = entry.productionRate;
  const consumptionRate = entry.consumptionRate;

  const prodRate = productionRate ?? 0;
  const consRate = consumptionRate ?? 0;
  const netRate = prodRate - consRate;

  const critical = isCriticalResource(resource);
  const deficit = Math.max(0, safetyReserve + expectedConsumption - reserve - entry.inTransit);
  const coverage = safetyReserve > 0 ? reserve / safetyReserve : Infinity;

  // ── 1. CRITICAL：无储备无生产 ──
  if (reserve === 0 && prodRate === 0 && consRate === 0) {
    return {
      resource,
      health: "critical",
      evidence: `no reserve, no production`,
      reserve,
      safetyReserve,
      productionRate,
      consumptionRate,
      netRate,
      critical,
      deficit,
    };
  }

  if (reserve === 0 && prodRate === 0 && consRate > 0) {
    return {
      resource,
      health: "critical",
      evidence: `no reserve, consuming at ${consRate.toFixed(2)}/tick`,
      reserve,
      safetyReserve,
      productionRate,
      consumptionRate,
      netRate,
      critical,
      deficit,
    };
  }

  // ── 2. DEFICIT：储备极低 + 入不敷出 ──
  if (reserve < options.deficitAbsoluteThreshold && netRate < 0) {
    return {
      resource,
      health: "deficit",
      evidence: `reserve=${reserve}<${options.deficitAbsoluteThreshold}, netRate=${netRate.toFixed(2)}`,
      reserve,
      safetyReserve,
      productionRate,
      consumptionRate,
      netRate,
      critical,
      deficit,
    };
  }

  // ── 3. DEGRADED：趋势恶化或储备不足 ──
  if (netRate < 0 || reserve < safetyReserve) {
    return {
      resource,
      health: "degraded",
      evidence: netRate < 0
        ? `netRate=${netRate.toFixed(2)}<0`
        : `reserve=${reserve}<safety=${safetyReserve}`,
      reserve,
      safetyReserve,
      productionRate,
      consumptionRate,
      netRate,
      critical,
      deficit,
    };
  }

  // ── 4. HEALTHY：充裕 + 正净流（先判 HEALTHY 再判 STABLE，避免高覆盖被误判 STABLE）──
  if (coverage >= options.healthyCoverageRatio && netRate >= 0) {
    return {
      resource,
      health: "healthy",
      evidence: `coverage=${coverage.toFixed(2)}>=${options.healthyCoverageRatio}, netRate=${netRate.toFixed(2)}>=0`,
      reserve,
      safetyReserve,
      productionRate,
      consumptionRate,
      netRate,
      critical,
      deficit,
    };
  }

  // ── 5. STABLE：覆盖率达标但不够充裕 ──
  if (coverage >= options.stableCoverageRatio) {
    return {
      resource,
      health: "stable",
      evidence: `coverage=${coverage.toFixed(2)}>=${options.stableCoverageRatio}`,
      reserve,
      safetyReserve,
      productionRate,
      consumptionRate,
      netRate,
      critical,
      deficit,
    };
  }

  // ── 兜底：有储备但覆盖率不足 ──
  return {
    resource,
    health: "stable",
    evidence: `coverage=${coverage.toFixed(2)}, netRate=${netRate.toFixed(2)}`,
    reserve,
    safetyReserve,
    productionRate,
    consumptionRate,
    netRate,
    critical,
    deficit,
  };
}

// ─── 健康度排序权重 ───────────────────────────────────────────

/**
 * 健康度 → 排序权重（用于多资源排序，值越小优先级越高）。
 * 纯函数。
 */
export function healthRank(h: ResourceHealthStatus): number {
  switch (h) {
    case "critical": return 0;
    case "deficit": return 1;
    case "degraded": return 2;
    case "stable": return 3;
    case "healthy": return 4;
  }
}

/**
 * 判断健康度是否为「问题状态」（需要关注）。
 * 纯函数。
 */
export function isHealthProblematic(h: ResourceHealthStatus): boolean {
  return h === "critical" || h === "deficit" || h === "degraded";
}

/**
 * 判断健康度是否为「健康状态」。
 * 纯函数。
 */
export function isHealthGood(h: ResourceHealthStatus): boolean {
  return h === "healthy" || h === "stable";
}
