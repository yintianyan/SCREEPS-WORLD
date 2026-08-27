/** Logistics ROI */

// ─── 结果 ──────────────────────────────────────────────────

/**
 * Logistics ROI 结果。
 */
export interface LogisticsROIResult {
  /** ROI 比率 = netValue / transportCost。 */
  roi: number;
  /** 净物流价值 = resourceValue - transportCost - riskCost。 */
  netValue: number;
  /** 资源价值。 */
  resourceValue: number;
  /** 运输成本。 */
  transportCost: number;
  /** 风险成本。 */
  riskCost: number;
  /** 等级。 */
  grade: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 计算 Logistics ROI。

 * Net Logistics Value = Resource Value - Transport Cost - Risk Cost
 * ROI = Net Value / Transport Cost

 * 纯函数。
 */
export function computeLogisticsROI(
  deliveredAmount: number,
  resourceValuePerUnit: number,
  transportCost: number,
  riskCost: number,
): LogisticsROIResult {
  const resourceValue = deliveredAmount * resourceValuePerUnit;
  const netValue = resourceValue - transportCost - riskCost;
  const roi = transportCost > 0 ? netValue / transportCost : (netValue > 0 ? Infinity : 0);

  let grade: string;
  if (roi >= 5) grade = "excellent";
  else if (roi >= 2) grade = "good";
  else if (roi >= 1) grade = "fair";
  else if (roi >= 0) grade = "poor";
  else grade = "bad";

  return {
    roi,
    netValue,
    resourceValue,
    transportCost,
    riskCost,
    grade,
  };
}

/**
 * 判断物流是否值得执行。
 * 纯函数。
 */
export function isWorthTransporting(roi: LogisticsROIResult): boolean {
  return roi.netValue > 0;
}
