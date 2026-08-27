/** Empire Budget */

import type { EmpireResourceView } from "./resource-view";
import type { EmpireEconomicHealth } from "./economic-health";

/**
 * 帝国预算分配结果。
 */
export interface EmpireBudget {
  /** 采样 tick。 */
  tick: number;
  /** 帝国总能量（= View.totalEnergy + spawnExt 等——此处用 View.totalEnergy）。 */
  totalEnergy: number;
  // ── 预算域 ──
  /** 战略储备（不可触碰——保命底线）。 */
  reserve: number;
  /** 生存预算（困难房援助 + 紧急孵化地板）。 */
  survival: number;
  /** 生产预算（维持日常生产消费）。 */
  production: number;
  /** 基建预算（建造/升级投资）。 */
  infrastructure: number;
  /** 扩张预算（殖民/远矿启动成本预留）。 */
  expansion: number;
  /** 自由浮动量（预算外可调拨）。 */
  free: number;
  // ── 派生 ──
  /** 储备率 = reserve / totalEnergy（0..1）。 */
  reserveRatio: number;
  /** 扩张可用率 = (expansion + free) / totalEnergy（0..1）。 */
  expansionAvailableRatio: number;
}

/**
 * 预算选项。
 */
export interface BudgetOptions {
  /** Emergency Reserve 占比（任何情况下不可触碰）。 */
  emergencyReserveRatio: number;
  /** Core Reserve 占比（在 Emergency 之上的额外保守层）。 */
  coreReserveRatio: number;
  /** Expansion Reserve 占比（扩张预留——仅在 health ≥ stable 时生效）。 */
  expansionReserveRatio: number;
  /** 生产预算占可用量（扣除储备后）的比例。 */
  productionRatio: number;
  /** 基建预算占可用量的比例。 */
  infrastructureRatio: number;
  /** 困难房时生存预算的额外占比。 */
  survivalExtraRatio: number;
}

export const DEFAULT_BUDGET_OPTIONS: BudgetOptions = {
  emergencyReserveRatio: 0.2,
  coreReserveRatio: 0.1,
  expansionReserveRatio: 0.15,
  productionRatio: 0.4,
  infrastructureRatio: 0.2,
  survivalExtraRatio: 0.15,
};

/**
 * 计算帝国经济预算分配（纯函数）。

 * 分配逻辑：
 * 1. Reserve = totalEnergy × (emergencyRatio + coreRatio)
 *    - health=critical/deficit 时 Reserve = emergency only（收紧保守层）
 *    - health=healthy 时 Reserve 不增加（已充裕，多余进 Free）
 * 2. 可用量 = totalEnergy - Reserve
 * 3. Survival = hasStruggling ? available × survivalExtra : 0
 * 4. Expansion = (health ≥ stable) ? totalEnergy × expansionRatio : 0
 * 5. 剩余 = 可用量 - Survival - Expansion
 * 6. Production = 剩余 × productionRatio
 * 7. Infrastructure = 剩余 × infrastructureRatio
 * 8. Free = 剩余 - Production - Infrastructure

 * @param view EmpireResourceView
 * @param health EmpireEconomicHealth（步 5 产出）
 * @param tick 当前 tick
 * @param options 预算选项
 */
export function allocateEmpireBudget(
  view: EmpireResourceView,
  health: EmpireEconomicHealth,
  tick: number,
  options: BudgetOptions = DEFAULT_BUDGET_OPTIONS,
): EmpireBudget {
  const totalEnergy = view.totalEnergy;

  // ── 1. Reserve ──
  let reserveRatio = options.emergencyReserveRatio;
  if (health === "stable" || health === "growing" || health === "healthy") {
    reserveRatio += options.coreReserveRatio;
  }
  // critical/deficit 只保 emergency reserve
  let reserve = Math.floor(totalEnergy * reserveRatio);

  // ── 2. 可用量 ──
  let available = totalEnergy - reserve;

  // ── 3. Survival ──
  let survival = 0;
  if (view.hasStruggling) {
    survival = Math.floor(available * options.survivalExtraRatio);
  }

  // ── 4. Expansion ──
  let expansion = 0;
  if (health === "stable" || health === "growing" || health === "healthy") {
    expansion = Math.floor(totalEnergy * options.expansionReserveRatio);
  }
  // Expansion 不得把 Core Room 经济抽干（ECONOMY §6 红线 1）
  // 防护：expansion 不超过 available - survival
  const expansionCap = available - survival;
  if (expansion > expansionCap) expansion = Math.max(0, expansionCap);

  // ── 5. 剩余 ──
  const remaining = available - survival - expansion;

  // ── 6. Production ──
  const production = Math.floor(remaining * options.productionRatio);

  // ── 7. Infrastructure ──
  const infrastructure = Math.floor(remaining * options.infrastructureRatio);

  // ── 8. Free ──
  const free = Math.max(0, remaining - production - infrastructure);

  return {
    tick,
    totalEnergy,
    reserve,
    survival,
    production,
    infrastructure,
    expansion,
    free,
    reserveRatio: totalEnergy > 0 ? reserve / totalEnergy : 0,
    expansionAvailableRatio: totalEnergy > 0 ? (expansion + free) / totalEnergy : 0,
  };
}
