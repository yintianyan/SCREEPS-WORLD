/**
 * Expansion Payback Model — A3.2 Phase 1：Cost vs Benefit 比较。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §1 投资决策合同 + §6 GCL 节奏。
 *
 * 定位：回答「扩张到新房多久能回本」——比较估算成本与预期收益，
 * 输出回收周期和投资回报率。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExpansionCandidateV2 } from "./candidate";
import type { ExpansionCostEstimate } from "./cost-model";

/** 回收期评估结果。 */
export interface PaybackResult {
  /** 候选房名。 */
  roomName: string;
  /** 估算总成本（能量）。 */
  totalCost: number;
  /** 预期每 tick 净收益（能量/tick）。 */
  expectedIncomePerTick: number;
  /** 回收周期（tick）。 */
  paybackTicks: number;
  /** 投资回报率（1.0 = 盈亏平衡，>1.0 = 盈利）。 */
  roi: number;
  /** 是否值得投资。 */
  worthwhile: boolean;
  /** 人类可读证据。 */
  evidence: string;
}

/** Payback 选项。 */
export interface PaybackOptions {
  /** 名义产能 per source（能量/tick）。 */
  nominalIncomePerSource: number;
  /** 效率系数假设（新殖民地在 bootstrap 期间效率较低）。 */
  assumedEfficiency: number;
  /** 回收周期上限（超过则不值得）。 */
  maxPaybackTicks: number;
  /** ROI 下限（低于则不值得）。 */
  minRoi: number;
  /** 殖民地稳定后的效率系数（成熟期）。 */
  matureEfficiency: number;
}

export const DEFAULT_PAYBACK_OPTIONS: PaybackOptions = {
  nominalIncomePerSource: 10,
  assumedEfficiency: 0.3,
  maxPaybackTicks: 50000,
  minRoi: 1.5,
  matureEfficiency: 0.7,
};

/**
 * 评估扩张投资回收期（纯函数）。
 *
 * 收益估算 = source 数 × 名义产能 × 假设效率 × 净产出率（约 50% 可调拨）
 * 回收周期 = 总成本 / 每 tick 净收益
 * ROI = (整个回收期内总收益) / 总成本
 */
export function evaluatePayback(
  candidate: ExpansionCandidateV2,
  cost: ExpansionCostEstimate,
  options: PaybackOptions = DEFAULT_PAYBACK_OPTIONS,
): PaybackResult {
  const sourceCount = candidate.sourceCount ?? 0;

  // 预期每 tick 净收益（bootstrap 期使用低效率）
  const grossIncome = sourceCount * options.nominalIncomePerSource * options.assumedEfficiency;
  // 净产出率：约 50% 可调拨（维持本地消耗后）
  const expectedIncomePerTick = Math.round(grossIncome * 0.5);

  // 回收周期
  const paybackTicks = expectedIncomePerTick > 0
    ? Math.ceil(cost.totalCost / expectedIncomePerTick)
    : Infinity;

  // ROI：在 maxPaybackTicks 内的总收益 / 总成本
  // 成熟期效率更高，假设回收期后半段进入成熟期
  const matureIncome = sourceCount * options.nominalIncomePerSource * options.matureEfficiency * 0.5;
  const avgIncome = (expectedIncomePerTick + matureIncome) / 2;
  const lifetimeRevenue = avgIncome * options.maxPaybackTicks;
  const roi = cost.totalCost > 0 ? lifetimeRevenue / cost.totalCost : 0;

  const worthwhile = paybackTicks <= options.maxPaybackTicks && roi >= options.minRoi;

  const evidence = [
    `cost=${cost.totalCost}`,
    `income=${expectedIncomePerTick}/t(bootstrap)→${Math.round(matureIncome)}/t(mature)`,
    `payback=${paybackTicks === Infinity ? "∞" : paybackTicks + "t"}`,
    `roi=${roi.toFixed(2)}`,
    worthwhile ? "WORTHWHILE" : "NOT_WORTHWHILE",
  ].join(" ");

  return {
    roomName: candidate.roomName,
    totalCost: cost.totalCost,
    expectedIncomePerTick,
    paybackTicks,
    roi,
    worthwhile,
    evidence,
  };
}
