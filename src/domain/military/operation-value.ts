/** Operation Value */

import type { WarCost } from "./war-cost";
import type { RiskResult } from "./risk-model";

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

export interface OperationValueInput {
  /** 目标战略价值（0-100）。 */
  targetStrategicValue: number;
  /** 目标经济价值（energy 等价）。 */
  targetEconomicValue: number;
  /** 预计成功率（0-1）。 */
  expectedSuccessRate: number;
  /** 战争成本。 */
  warCost: WarCost;
  /** 风险评估。 */
  risk: RiskResult;
  /** 情报置信度（0-1）。 */
  confidence: number;
  /** 是否是防御性操作。 */
  isDefensive: boolean;
}

export interface OperationValueResult {
  /** 预期收益。 */
  expectedGain: number;
  /** 预期损失。 */
  expectedLoss: number;
  /** 军事成本。 */
  militaryCost: number;
  /** 经济成本。 */
  economicCost: number;
  /** 战略价值（0-100）。 */
  strategicValue: number;
  /** 风险分数（0-1）。 */
  risk: number;
  /** 置信度（0-1）。 */
  confidence: number;
  /** 净价值 = expectedGain - expectedLoss - militaryCost - economicCost。 */
  netValue: number;
  /** 建议。 */
  recommendation: "PROCEED" | "DOWNGRADE" | "DELAY" | "ABORT";
  /** 证据。 */
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════
// §2. 评估纯函数
// ═══════════════════════════════════════════════════════════

export function evaluateOperationValue(input: OperationValueInput): OperationValueResult {
  const evidence: string[] = [];

  // 预期收益 = 目标价值 × 成功率
  const expectedGain = Math.round(
    (input.targetEconomicValue + input.targetStrategicValue * 100) * input.expectedSuccessRate,
  );
  evidence.push(`gain=${expectedGain} (targetEcon=${input.targetEconomicValue} + strategic=${input.targetStrategicValue}×100) × success=${input.expectedSuccessRate.toFixed(2)}`);

  // 预期损失 = 战争成本 × (1 - 成功率) × 风险系数
  const lossMultiplier = (1 - input.expectedSuccessRate) * (0.5 + input.risk.score * 0.5);
  const expectedLoss = Math.round(input.warCost.total * lossMultiplier);
  evidence.push(`loss=${expectedLoss} (cost=${input.warCost.total} × ${(1 - input.expectedSuccessRate).toFixed(2)} × risk=${input.risk.score.toFixed(2)})`);

  // 军事成本
  const militaryCost = input.warCost.spawnEnergyCost + input.warCost.boostCost + input.warCost.cpuCost;
  evidence.push(`militaryCost=${militaryCost}`);

  // 经济成本
  const economicCost = input.warCost.opportunityCost + input.warCost.transportCost + input.warCost.recoveryCost;
  evidence.push(`economicCost=${economicCost}`);

  // 战略价值
  const strategicValue = input.targetStrategicValue;
  evidence.push(`strategicValue=${strategicValue}`);

  // 净价值
  const netValue = expectedGain - expectedLoss - militaryCost - economicCost;
  evidence.push(`netValue=${netValue}`);

  // 推荐
  let recommendation: OperationValueResult["recommendation"] = "PROCEED";
  if (netValue < 0) {
    recommendation = input.isDefensive ? "DOWNGRADE" : "ABORT";
    evidence.push(`recommendation=${recommendation} (netValue < 0)`);
  } else if (input.risk.score > 0.6 && !input.isDefensive) {
    recommendation = "DOWNGRADE";
    evidence.push(`recommendation=DOWNGRADE (risk=${input.risk.score.toFixed(2)} > 0.6)`);
  } else if (input.confidence < 0.3) {
    recommendation = "DELAY";
    evidence.push(`recommendation=DELAY (confidence=${input.confidence.toFixed(2)} < 0.3)`);
  } else if (netValue < input.warCost.total * 0.5 && !input.isDefensive) {
    recommendation = "DELAY";
    evidence.push(`recommendation=DELAY (netValue < cost×0.5)`);
  }

  return {
    expectedGain,
    expectedLoss,
    militaryCost,
    economicCost,
    strategicValue,
    risk: input.risk.score,
    confidence: input.confidence,
    netValue,
    recommendation,
    evidence,
  };
}
