/** Reliability */

// ─── 输入 / 输出 ──────────────────────────────────────────

/**
 * Reliability 计算输入。
 */
export interface ReliabilityInput {
  /** 历史成功率 (0..1)。 */
  successRate: number;
  /** 历史失败次数。 */
  failureCount: number;
  /** 路由风险评分 (0..1, 0=安全)。 */
  routeRisk: number;
  /** 威胁等级 (0..1, 0=无威胁)。 */
  threatLevel: number;
  /** 拥堵评分 (0..1, 0=畅通)。 */
  trafficLevel: number;
  /** Creep 死亡率 (0..1, 0=无死亡)。 */
  creepDeathRate: number;
  /** 路径失败率 (0..1, 0=无失败)。 */
  pathFailureRate: number;
}

/**
 * Reliability 评估结果。
 */
export interface ReliabilityResult {
  /** 可靠性评分 (0..1, 1=最可靠)。 */
  reliability: number;
  /** 各因子贡献。 */
  factors: ReliabilityFactors;
  /** 诊断消息。 */
  message: string;
}

/**
 * 各因子贡献明细。
 */
export interface ReliabilityFactors {
  successRateContribution: number;
  routeSafetyContribution: number;
  threatSafetyContribution: number;
  trafficFlowContribution: number;
  creepSurvivalContribution: number;
  pathStabilityContribution: number;
}

// ─── 权重 ──────────────────────────────────────────────────

/**
 * 因子权重。
 * 总和 = 1.0。
 */
export const RELIABILITY_WEIGHTS = {
  successRate: 0.40,
  routeSafety: 0.20,
  threatSafety: 0.15,
  trafficFlow: 0.10,
  creepSurvival: 0.10,
  pathStability: 0.05,
} as const;

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 计算 Transport Reliability Score。

 * 加权平均：
 *   successRate(40%) + routeSafety(20%) + threatSafety(15%)
 *   + trafficFlow(10%) + creepSurvival(10%) + pathStability(5%)

 * 每个因子归一化到 0..1：
 *   - successRate 直接使用 (0..1)
 *   - routeSafety = 1 - routeRisk
 *   - threatSafety = 1 - threatLevel
 *   - trafficFlow = 1 - trafficLevel
 *   - creepSurvival = 1 - creepDeathRate
 *   - pathStability = 1 - pathFailureRate

 * 纯函数。
 */
export function computeReliability(input: ReliabilityInput): ReliabilityResult {
  const w = RELIABILITY_WEIGHTS;

  const successRate = clamp01(input.successRate);
  const routeSafety = clamp01(1 - input.routeRisk);
  const threatSafety = clamp01(1 - input.threatLevel);
  const trafficFlow = clamp01(1 - input.trafficLevel);
  const creepSurvival = clamp01(1 - input.creepDeathRate);
  const pathStability = clamp01(1 - input.pathFailureRate);

  const factors: ReliabilityFactors = {
    successRateContribution: successRate * w.successRate,
    routeSafetyContribution: routeSafety * w.routeSafety,
    threatSafetyContribution: threatSafety * w.threatSafety,
    trafficFlowContribution: trafficFlow * w.trafficFlow,
    creepSurvivalContribution: creepSurvival * w.creepSurvival,
    pathStabilityContribution: pathStability * w.pathStability,
  };

  const reliability = clamp01(
    factors.successRateContribution +
    factors.routeSafetyContribution +
    factors.threatSafetyContribution +
    factors.trafficFlowContribution +
    factors.creepSurvivalContribution +
    factors.pathStabilityContribution,
  );

  // 诊断消息
  const parts: string[] = [];
  parts.push(`reliability=${reliability.toFixed(3)}`);
  parts.push(`success=${successRate.toFixed(2)}`);
  parts.push(`safety=${routeSafety.toFixed(2)}`);
  parts.push(`threat=${threatSafety.toFixed(2)}`);
  parts.push(`traffic=${trafficFlow.toFixed(2)}`);
  parts.push(`survival=${creepSurvival.toFixed(2)}`);
  parts.push(`path=${pathStability.toFixed(2)}`);
  if (input.failureCount > 0) {
    parts.push(`failures=${input.failureCount}`);
  }
  const message = parts.join(", ");

  return { reliability, factors, message };
}

// ─── 可靠性等级 ────────────────────────────────────────────

/**
 * 可靠性等级。
 */
export type ReliabilityGrade =
  | "excellent"  // >= 0.90
  | "good"       // >= 0.75
  | "fair"       // >= 0.50
  | "poor"       // >= 0.25
  | "critical";  // < 0.25

/**
 * 根据可靠性评分判定等级。
 * 纯函数。
 */
export function gradeReliability(reliability: number): ReliabilityGrade {
  if (reliability >= 0.90) return "excellent";
  if (reliability >= 0.75) return "good";
  if (reliability >= 0.50) return "fair";
  if (reliability >= 0.25) return "poor";
  return "critical";
}

/**
 * 判断是否达到最低可靠性阈值。
 * 纯函数。
 */
export function meetsReliabilityThreshold(
  reliability: number,
  threshold: number = 0.50,
): boolean {
  return reliability >= threshold;
}

// ─── 内部工具 ──────────────────────────────────────────────

/** clamp 到 0..1。 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
