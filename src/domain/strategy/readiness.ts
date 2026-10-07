/** Expansion Readiness */

import type { EmpireResourceView } from "./resource-view";
import type { EmpireEconomicHealth } from "./economic-health";
import type { EmpireBudget } from "./budget";
import type { CapacityTier } from "./capacity";
import type { TieredExpansionBudget } from "../expansion/budget";
import type { ExpansionCandidateV2 } from "../expansion/candidate";
import type { ExpansionCostEstimate } from "../expansion/cost-model";
import type { RiskResult } from "../expansion/risk";

/**
 * 扩张就绪度。

 * - NOT_READY：当前经济不支持扩张
 * - READY：满足基本扩张门控
 * - STRONGLY_READY：经济充裕 + 多核心房 + CPU 余量充足
 */
export type ExpansionReadiness = "NOT_READY" | "READY" | "STRONGLY_READY";

/**
 * 扩张就绪度评估结果。
 */
export interface ExpansionReadinessResult {
  readiness: ExpansionReadiness;
  /** 人类可读的证据链。 */
  evidence: string;
  /** 各门控条目的通过/失败明细。 */
  gates: ExpansionGate[];
}

/**
 * 单个扩张门控条目。
 */
export interface ExpansionGate {
  /** 门控名称。 */
  name: string;
  /** 是否通过。 */
  passed: boolean;
  /** 当前值。 */
  value: string;
  /** 通过条件描述。 */
  condition: string;
}

/**
 * 扩张就绪度选项。
 */
export interface ReadinessOptions {
  /** READY 要求的最低健康度。 */
  minHealth: EmpireEconomicHealth;
  /** STRONGLY_READY 要求的最低健康度。 */
  stronglyMinHealth: EmpireEconomicHealth;
  /** READY 要求的最低核心房数。 */
  minCoreRooms: number;
  /** STRONGLY_READY 要求的最低核心房数。 */
  stronglyMinCoreRooms: number;
  /** READY 要求的最低 CPU tier。 */
  minCpuTier: CapacityTier;
  /** STRONGLY_READY 要求的最低 CPU tier。 */
  stronglyMinCpuTier: CapacityTier;
  /** READY 要求的最低净流（能量/tick）。 */
  minNetFlow: number;
  /** STRONGLY_READY 要求的最低净流。 */
  stronglyMinNetFlow: number;
  /** READY 要求的最低扩张可用预算。 */
  minExpansionBudget: number;
  /** 是否有活威胁时禁止扩张。 */
  blockOnLiveThreat: boolean;
  /** 是否有困难房时禁止扩张。 */
  blockOnStruggling: boolean;
  // ── A3.2 扩展 Gate ──
  /** G12: 候选评分最低阈值。 */
  minCandidateScore: number;
  /** G14: 风险分数最高阈值（超过则 NOT_READY）。 */
  maxRiskScore: number;
}

export const DEFAULT_READINESS_OPTIONS: ReadinessOptions = {
  minHealth: "growing",
  stronglyMinHealth: "healthy",
  minCoreRooms: 1,
  stronglyMinCoreRooms: 2,
  minCpuTier: "comfortable",
  stronglyMinCpuTier: "abundant",
  minNetFlow: 5,
  stronglyMinNetFlow: 15,
  minExpansionBudget: 2000,
  blockOnLiveThreat: true,
  blockOnStruggling: true,
  // A3.2 扩展 Gate 默认值
  minCandidateScore: 0.5,
  maxRiskScore: 0.8,
};

const TIER_RANK: Record<CapacityTier, number> = {
  abundant: 0,
  comfortable: 1,
  tight: 2,
  constrained: 3,
};

const HEALTH_RANK: Record<EmpireEconomicHealth, number> = {
  healthy: 0,
  growing: 1,
  stable: 2,
  deficit: 3,
  critical: 4,
};

/**
 * 评估扩张就绪度（纯函数）。

 * 门控序列（全部通过才 READY）：
 *   G1: 无活威胁（blockOnLiveThreat）
 *   G2: 无困难房（blockOnStruggling）
 *   G3: 经济健康度 ≥ minHealth
 *   G4: 帝国净流 ≥ minNetFlow
 *   G5: 核心房数 ≥ minCoreRooms
 *   G6: CPU tier ≤ minCpuTier（余量充足）
 *   G7: 扩张预算 ≥ minExpansionBudget

 * STRONGLY_READY 额外要求：
 *   G8: health ≥ stronglyMinHealth
 *   G9: coreRooms ≥ stronglyMinCoreRooms
 *   G10: cpuTier ≤ stronglyMinCpuTier
 *   G11: netFlow ≥ stronglyMinNetFlow

 * @param view EmpireResourceView
 * @param health EmpireEconomicHealth
 * @param budget EmpireBudget
 * @param cpuTier CapacityTier
 * @param postureExpansionAllowed posture 的 expansionAllowed 标志
 * @param options 选项
 */
export function evaluateExpansionReadiness(
  view: EmpireResourceView,
  health: EmpireEconomicHealth,
  budget: EmpireBudget,
  cpuTier: CapacityTier,
  postureExpansionAllowed: boolean,
  /**
   * 真正可动用的扩张额（`computeTieredBudget(budget).availableExpansion`）。
   * G7 用它而不是 `budget.expansion` —— 理由见下方 G7 注释。缺省时退回旧语义。
   */
  availableExpansion?: number,
  options: ReadinessOptions = DEFAULT_READINESS_OPTIONS,
): ExpansionReadinessResult {
  const gates: ExpansionGate[] = [];

  // G0: posture 授权（前置条件——posture 不允许则一切停止）
  const g0 = postureExpansionAllowed;
  gates.push({
    name: "G0: posture expansionAllowed",
    passed: g0,
    value: String(postureExpansionAllowed),
    condition: "posture.expansionAllowed === true",
  });

  // G1: 无活威胁
  const g1 = !view.hasLiveThreat;
  gates.push({
    name: "G1: no live threat",
    passed: g1,
    value: String(view.hasLiveThreat),
    condition: "hasLiveThreat === false",
  });

  // G2: 无困难房
  const g2 = !view.hasStruggling;
  gates.push({
    name: "G2: no struggling rooms",
    passed: g2,
    // 名单必须带上：G2/G5 同出一枚 economicClass 分类位（room-profile.ts:202-217），
    // 只报计数时读的人无法知道是哪间房（以及它是 core 掉下来的还是幼房）在关扩张。
    value: `struggling=${view.strugglingRooms}${
      view.strugglingRoomNames.length > 0 ? `[${view.strugglingRoomNames.join(",")}]` : ""
    }`,
    condition: "hasStruggling === false",
  });

  // G3: 经济健康度
  const g3 = HEALTH_RANK[health] <= HEALTH_RANK[options.minHealth];
  gates.push({
    name: "G3: economic health",
    passed: g3,
    // 健康度本身是三个输入的折叠结果（netFlow / coreRooms / selfSufficiency）——只报
    // "stable" 时读的人无法知道是哪一条把它压住，只能回源码重算（本轮就这么丢了两天）。
    // selfSufficiency 不在这里重复计算：它 = 1 − |netFlow| / income，而 income 已在
    // `Memory.rooms[r].economy.ei` 落盘 ⇒ 报出 netFlow 与 coreRooms 就完全可复算。
    value: `${health}(netFlow=${view.totalNetFlow.toFixed(1)},core=${view.coreRooms})`,
    condition: `health ≥ ${options.minHealth}`,
  });

  // G4: 净流
  const g4 = view.totalNetFlow >= options.minNetFlow;
  gates.push({
    name: "G4: net flow",
    passed: g4,
    value: view.totalNetFlow.toFixed(1),
    condition: `netFlow ≥ ${options.minNetFlow}`,
  });

  // G5: 核心房数
  const g5 = view.coreRooms >= options.minCoreRooms;
  gates.push({
    name: "G5: core rooms",
    passed: g5,
    value: String(view.coreRooms),
    condition: `coreRooms ≥ ${options.minCoreRooms}`,
  });

  // G6: CPU tier
  const g6 = TIER_RANK[cpuTier] <= TIER_RANK[options.minCpuTier];
  gates.push({
    name: "G6: CPU tier",
    passed: g6,
    value: cpuTier,
    condition: `tier ≤ ${options.minCpuTier}`,
  });

  // G7: 扩张预算 —— 必须用**真正付得起这笔钱的那个数**。
  //
  // 原先读 `budget.expansion`（分配器按健康度切出的"扩张片"，健康度掉一档就是 0），
  // 而批准执行的 `explainDecision` 与 dashboard 用的是 `computeTieredBudget` 的
  // `availableExpansion`（总量扣掉应急/核心/运营后的可动用额，上限为 expansion+free）。
  // ⇒ 同一个"扩张预算"存在两套公式，且**更严的那套在挡晋升**：
  // 线上 14:16 实测同一条 dashboard 里 `Budget=198112/900503` 与
  // `G7: expansion budget(v=0|expansion ≥ 2000)` 并存 —— 一边说没钱，一边说 198K，
  // 而待批的 plan 成本只有 61,300。属于本仓「一个量两种语义 ⇒ 入口判据出口不复检」那一族。
  //
  // 传了 availableExpansion 就用它；没传（老的调用方/测试）保持原语义，不静默改变别处。
  const expansionBudgetForGate = availableExpansion ?? budget.expansion;
  const g7 = expansionBudgetForGate >= options.minExpansionBudget;
  gates.push({
    name: "G7: expansion budget",
    passed: g7,
    value: String(expansionBudgetForGate),
    condition: `expansion ≥ ${options.minExpansionBudget}`,
  });

  // 基本门控全过 → 判定 READY vs STRONGLY_READY
  const allBasicPassed = gates.every(g => g.passed);
  if (!allBasicPassed) {
    const failedGates = gates.filter(g => !g.passed).map(g => g.name);
    return {
      readiness: "NOT_READY",
      evidence: `failed: ${failedGates.join(", ")}`,
      gates,
    };
  }

  // STRONGLY_READY 额外门控
  const g8 = HEALTH_RANK[health] <= HEALTH_RANK[options.stronglyMinHealth];
  const g9 = view.coreRooms >= options.stronglyMinCoreRooms;
  const g10 = TIER_RANK[cpuTier] <= TIER_RANK[options.stronglyMinCpuTier];
  const g11 = view.totalNetFlow >= options.stronglyMinNetFlow;

  const stronglyGates: ExpansionGate[] = [
    {
      name: "G8: health strongly",
      passed: g8,
      value: health,
      condition: `health ≥ ${options.stronglyMinHealth}`,
    },
    {
      name: "G9: core rooms strongly",
      passed: g9,
      value: String(view.coreRooms),
      condition: `coreRooms ≥ ${options.stronglyMinCoreRooms}`,
    },
    {
      name: "G10: CPU tier strongly",
      passed: g10,
      value: cpuTier,
      condition: `tier ≤ ${options.stronglyMinCpuTier}`,
    },
    {
      name: "G11: net flow strongly",
      passed: g11,
      value: view.totalNetFlow.toFixed(1),
      condition: `netFlow ≥ ${options.stronglyMinNetFlow}`,
    },
  ];

  const allStronglyPassed = stronglyGates.every(g => g.passed);
  const allGates = [...gates, ...stronglyGates];

  if (allStronglyPassed) {
    return {
      readiness: "STRONGLY_READY",
      evidence: `all gates passed: netFlow=${view.totalNetFlow.toFixed(1)} core=${view.coreRooms} health=${health} tier=${cpuTier}`,
      gates: allGates,
    };
  }

  return {
    readiness: "READY",
    evidence: `basic gates passed: netFlow=${view.totalNetFlow.toFixed(1)} core=${view.coreRooms} health=${health} tier=${cpuTier}`,
    gates: allGates,
  };
}

// ─── A3.2 扩展 Gate (G12–G15) ─────────────────────────────

/**
 * A3.2 扩展就绪度评估：在基础 G0–G11 通过后，追加 G12–G15 候选/成本/风险/保护层门控。

 * G12: 有评分合格候选（candidateScore ≥ minCandidateScore）
 * G13: Available Budget ≥ Estimated Cost
 * G14: Risk ≤ maxRiskScore
 * G15: Core Reserve 未被侵入

 * 返回新增的 Gate 条目列表，供调用方追加到基础 Gates 后。
 */
export function evaluateExpansionReadinessExtended(
  topCandidate: ExpansionCandidateV2 | undefined,
  cost: ExpansionCostEstimate | undefined,
  risk: RiskResult | undefined,
  tieredBudget: TieredExpansionBudget | undefined,
  options: ReadinessOptions = DEFAULT_READINESS_OPTIONS,
): { gates: ExpansionGate[]; allPassed: boolean; evidence: string } {
  const gates: ExpansionGate[] = [];

  // G12: 候选评分合格
  const g12 = topCandidate !== undefined && topCandidate.score >= options.minCandidateScore;
  gates.push({
    name: "G12: qualified candidate",
    passed: g12,
    value: topCandidate ? `score=${topCandidate.score.toFixed(2)}` : "none",
    condition: `candidateScore ≥ ${options.minCandidateScore}`,
  });

  // G13: 预算 ≥ 成本
  const g13 =
    cost !== undefined &&
    tieredBudget !== undefined &&
    tieredBudget.availableExpansion >= cost.totalCost;
  gates.push({
    name: "G13: budget ≥ cost",
    passed: g13,
    value:
      cost && tieredBudget ? `${tieredBudget.availableExpansion} ≥ ${cost.totalCost}` : "unknown",
    condition: "availableBudget ≥ estimatedCost",
  });

  // G14: 风险可接受
  const g14 = risk !== undefined && risk.score <= options.maxRiskScore;
  gates.push({
    name: "G14: risk acceptable",
    passed: g14,
    value: risk ? `${risk.level}(${risk.score.toFixed(2)})` : "unknown",
    condition: `riskScore ≤ ${options.maxRiskScore}`,
  });

  // G15: Core Reserve 未被侵入
  const g15 = tieredBudget !== undefined && !tieredBudget.coreInvaded;
  gates.push({
    name: "G15: core reserve safe",
    passed: g15,
    value: tieredBudget ? (tieredBudget.coreInvaded ? "INVADED" : "safe") : "unknown",
    condition: "coreInvaded === false",
  });

  const allPassed = gates.every(g => g.passed);
  const failed = gates.filter(g => !g.passed).map(g => g.name);
  const evidence = allPassed
    ? "extended gates passed (G12–G15)"
    : `extended gates failed: ${failed.join(", ")}`;

  return { gates, allPassed, evidence };
}
