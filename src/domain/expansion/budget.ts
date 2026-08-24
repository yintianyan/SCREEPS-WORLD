/**
 * Tiered Expansion Budget — A3.2 Phase 1：递进式预算计算。
 *
 * 合同锚点：GOAL_POLICY_PLAN §4 五域预算 + EXPANSION_ARCHITECTURE §2 G5 预算预演。
 *
 * 定位：回答「当前可用扩张预算有多少」——从 EmpireBudget 派生递进式预算：
 * Total → Emergency Reserve → Core Reserve → Operational Reserve → Available Expansion
 *
 * Core Protection Constraint：Available Expansion Budget 不得侵入 Emergency Reserve。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { EmpireBudget } from "../strategy/budget";

/** 递进式扩张预算。 */
export interface TieredExpansionBudget {
  /** 帝国总能量。 */
  totalEnergy: number;
  // ── 递进扣除 ──
  /** Emergency Reserve（不可触碰——保命底线）。 */
  emergencyReserve: number;
  /** Core Reserve（在 Emergency 之上的额外保守层）。 */
  coreReserve: number;
  /** Operational Reserve（维持日常生产运营）。 */
  operationalReserve: number;
  // ── 可用 ──
  /** Available Expansion Budget（可用于扩张的总量）。 */
  availableExpansion: number;
  /** 采样 tick。 */
  tick: number;
  /** 是否 Core Reserve 被侵入（安全红线）。 */
  coreInvaded: boolean;
  /** 人类可读证据。 */
  evidence: string;
}

/** 预算选项。 */
export interface TieredBudgetOptions {
  /** Emergency Reserve 占总能量比例。 */
  emergencyRatio: number;
  /** Core Reserve 占总能量比例（在 Emergency 之上）。 */
  coreRatio: number;
  /** Operational Reserve = survival + production + infrastructure。 */
  operationalRatio: number;
}

export const DEFAULT_TIERED_BUDGET_OPTIONS: TieredBudgetOptions = {
  emergencyRatio: 0.2,
  coreRatio: 0.1,
  operationalRatio: 0.6,
};

/**
 * 从 EmpireBudget 派生递进式扩张预算（纯函数）。
 *
 * 递进逻辑：
 * 1. Emergency Reserve = totalEnergy × emergencyRatio（不可触碰）
 * 2. Core Reserve = totalEnergy × coreRatio（在 Emergency 之上）
 * 3. Operational Reserve = budget.survival + budget.production + budget.infrastructure
 * 4. Available Expansion = totalEnergy - Emergency - Core - Operational
 *    （但不超过 budget.expansion + budget.free —— 不能把预算外能量全算进扩张）
 *
 * Core Protection：Available < 0 时设为 0，并标记 coreInvaded=true。
 */
export function computeTieredBudget(
  budget: EmpireBudget,
  options: TieredBudgetOptions = DEFAULT_TIERED_BUDGET_OPTIONS,
): TieredExpansionBudget {
  const totalEnergy = budget.totalEnergy;

  // Emergency Reserve
  const emergencyReserve = Math.floor(totalEnergy * options.emergencyRatio);

  // Core Reserve
  const coreReserve = Math.floor(totalEnergy * options.coreRatio);

  // Operational Reserve = survival + production + infrastructure
  const operationalReserve = budget.survival + budget.production + budget.infrastructure;

  // Available Expansion = total - emergency - core - operational
  let availableExpansion = totalEnergy - emergencyReserve - coreReserve - operationalReserve;

  // 上限：不超过 budget.expansion + budget.free（预算外可调拨量）
  const budgetCap = budget.expansion + budget.free;
  if (availableExpansion > budgetCap) {
    availableExpansion = budgetCap;
  }

  // 下限：不能为负（侵入 Emergency = 红线）
  const coreInvaded = availableExpansion < 0;
  if (availableExpansion < 0) {
    availableExpansion = 0;
  }

  const evidence = [
    `total=${totalEnergy}`,
    `emergency=${emergencyReserve}`,
    `core=${coreReserve}`,
    `operational=${operationalReserve}`,
    `available=${availableExpansion}`,
    coreInvaded ? "CORE_INVADED!" : "core-safe",
  ].join(" ");

  return {
    totalEnergy,
    emergencyReserve,
    coreReserve,
    operationalReserve,
    availableExpansion,
    tick: budget.tick,
    coreInvaded,
    evidence,
  };
}

/**
 * 检查计划成本是否在预算内（Core Protection Constraint）。
 */
export function isWithinBudget(
  planCost: number,
  tieredBudget: TieredExpansionBudget,
): boolean {
  return planCost > 0
    && planCost <= tieredBudget.availableExpansion
    && !tieredBudget.coreInvaded;
}
