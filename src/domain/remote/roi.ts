/** Remote ROI */

import type { EconomicAccountingResult } from "./economic-accounting";

// ─── ROI 结果 ───────────────────────────────────────────

/**
 * ROI Result — 投资回报率计算结果。
 */
export interface ROIResult {
  /** 关联的 Operation ID。 */
  operationId: string;

  // ── 预期 ──
  /** 预期总产出（能量）。 */
  expectedProduction: number;
  /** 预期总成本（能量）。 */
  expectedCost: number;
  /** 预期 ROI = (expectedProduction - expectedCost) / expectedCost。 */
  expectedROI: number;

  // ── 实际 ──
  /** 实际总产出（能量）。 */
  actualProduction: number;
  /** 实际总交付（能量）。 */
  actualDelivered: number;
  /** 实际总成本（能量）。 */
  actualCost: number;
  /** 实际 ROI = (actualDelivered - actualCost) / actualCost。 */
  actualROI: number;

  // ── 对比 ──
  /** ROI 差值 = actualROI - expectedROI。 */
  roiDelta: number;
  /** ROI 达标率 = actualROI / expectedROI（>1 = 超预期，<1 = 未达标）。 */
  roiAchievement: number;
  /** 是否达到预期 ROI（actualROI >= expectedROI × threshold）。 */
  meetsExpectation: boolean;
}

// ─── 计算 ──────────────────────────────────────────────

/**
 * 计算预期 ROI。

 * expectedROI = (expectedProduction - expectedCost) / expectedCost
 * 如果 expectedCost = 0，返回 Infinity（无成本意味着无限回报）。

 * 纯函数。
 */
export function computeExpectedROI(
  expectedProduction: number,
  expectedCost: number,
): number {
  if (expectedCost <= 0) return expectedProduction > 0 ? Infinity : 0;
  return (expectedProduction - expectedCost) / expectedCost;
}

/**
 * 计算实际 ROI。

 * actualROI = (actualDelivered - actualCost) / actualCost
 * 如果 actualCost = 0，返回 Infinity。

 * 纯函数。
 */
export function computeActualROI(
  actualDelivered: number,
  actualCost: number,
): number {
  if (actualCost <= 0) return actualDelivered > 0 ? Infinity : 0;
  return (actualDelivered - actualCost) / actualCost;
}

/**
 * 计算完整 ROI 对比结果。

 * 纯函数 — 不访问 Game/Memory。

 * @param operationId Operation ID
 * @param expectedProduction 预期总产出
 * @param expectedCost 预期总成本
 * @param actualProduction 实际总产出
 * @param actualDelivered 实际总交付
 * @param actualCost 实际总成本（从 EconomicAccountingResult.totalCost × duration 计算）
 * @param achievementThreshold 达标阈值（0..1，如 0.8 表示需达到预期 80%）
 */
export function calculateROI(
  operationId: string,
  expectedProduction: number,
  expectedCost: number,
  actualProduction: number,
  actualDelivered: number,
  actualCost: number,
  achievementThreshold: number,
): ROIResult {
  const expectedROI = computeExpectedROI(expectedProduction, expectedCost);
  const actualROI = computeActualROI(actualDelivered, actualCost);
  const roiDelta = actualROI - expectedROI;
  const roiAchievement = expectedROI !== 0 && isFinite(expectedROI)
    ? actualROI / expectedROI
    : (actualROI > 0 ? 1 : 0);
  const meetsExpectation = roiAchievement >= achievementThreshold;

  return {
    operationId,
    expectedProduction,
    expectedCost,
    expectedROI,
    actualProduction,
    actualDelivered,
    actualCost,
    actualROI,
    roiDelta,
    roiAchievement,
    meetsExpectation,
  };
}

// ─── 从经济核算结果构建 ─────────────────────────────────

/**
 * 从 EconomicAccountingResult 构建 Actual ROI 输入。

 * actualCost = totalCost × duration（将 e/tick 转为总量）。

 * 纯函数。
 */
export function buildActualROIInput(
  accounting: EconomicAccountingResult,
): { actualCost: number; duration: number } {
  const duration = Math.max(1, accounting.periodEnd - accounting.periodStart);
  return {
    actualCost: accounting.totalCost * duration,
    duration,
  };
}

// ─── 判定 ──────────────────────────────────────────────

/**
 * 判定 ROI 是否为正（盈利）。
 * 纯函数。
 */
export function isPositiveROI(roi: number): boolean {
  return roi > 0;
}

/**
 * 判定 ROI 是否为负（亏损）。
 * 纯函数。
 */
export function isNegativeROI(roi: number): boolean {
  return roi < 0;
}

/**
 * 判定实际 ROI 是否显著低于预期（差距超阈值）。
 * 纯函数。
 */
export function isSignificantlyBelowExpectation(
  result: ROIResult,
  threshold: number,
): boolean {
  return result.roiAchievement < threshold;
}
