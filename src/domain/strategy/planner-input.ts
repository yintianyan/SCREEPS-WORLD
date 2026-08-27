/** Empire Planner Input */

import type { RoomEconomicProfile } from "../economy/room-profile";
import type { RoomCapacityProfile } from "../economy/capacity-profile";
import type { EmpireResourceView } from "./resource-view";
import type { EconomicHealthResult } from "./economic-health";
import type { ResourceImbalanceResult } from "./imbalance";
import type { EmpireBudget } from "./budget";
import type { ExpansionReadinessResult } from "./readiness";
import type { SafetyMarginResult } from "./safety-margin";
import type { ExpansionPressureResult } from "../expansion/pressure";

/**
 * Empire Planner Input — 帝国级规划输入的完整汇总。

 * 这条链的最终产物：
 *   Room Economy → Room Economic Profile → Empire Resource View →
 *   Empire Economic Health → Resource Imbalance → Expansion Readiness →
 *   Empire Planner Input

 * 不变量：
 *   - 所有字段从调用方注入的子结果组装
 *   - 不访问 Game/Memory
 *   - 不执行任何 Multi-Room Action
 */
export interface EmpirePlannerInput {
  /** 采样 tick。 */
  tick: number;
  // ── 各房剖面 ──
  /** 各房经济剖面。 */
  profiles: readonly RoomEconomicProfile[];
  /** 各房产能剖面。 */
  capacityProfiles: readonly RoomCapacityProfile[];
  // ── 帝国级聚合 ──
  /** 帝国资源视图。 */
  resourceView: EmpireResourceView;
  /** 帝国经济健康度。 */
  health: EconomicHealthResult;
  /** 资源余缺检测。 */
  imbalance: ResourceImbalanceResult;
  /** 帝国预算。 */
  budget: EmpireBudget;
  /** 扩张就绪度。 */
  readiness: ExpansionReadinessResult;
  /** 安全边际。 */
  safetyMargin: SafetyMarginResult;
  /** A3.2 扩张压力评估。 */
  expansionPressure?: ExpansionPressureResult;
  // ── 派生 ──
  /** 人类可读摘要（供 dashboard / log 用）。 */
  summary: string;
}

/**
 * 汇总全部子结果为 Empire Planner Input。

 * 调用方（empire-economy 系统薄壳）依次调用步 1–9 的纯函数，
 * 将产出传入本函数组装为最终 Planner Input。

 * 纯函数 — 不引用 Game/Memory。

 * @param tick 当前 tick
 * @param profiles 各房经济剖面（步 1）
 * @param capacityProfiles 各房产能剖面（步 3）
 * @param resourceView 帝国资源视图（步 4）
 * @param health 经济健康度（步 5）
 * @param imbalance 资源余缺检测（步 6）
 * @param budget 帝国预算（步 7）
 * @param readiness 扩张就绪度（步 8）
 * @param safetyMargin 安全边际（步 9）
 */
export function buildEmpirePlannerInput(
  tick: number,
  profiles: readonly RoomEconomicProfile[],
  capacityProfiles: readonly RoomCapacityProfile[],
  resourceView: EmpireResourceView,
  health: EconomicHealthResult,
  imbalance: ResourceImbalanceResult,
  budget: EmpireBudget,
  readiness: ExpansionReadinessResult,
  safetyMargin: SafetyMarginResult,
): EmpirePlannerInput {
  const summary = formatEmpireSummary(
    resourceView,
    health,
    imbalance,
    budget,
    readiness,
    safetyMargin,
  );

  return {
    tick,
    profiles,
    capacityProfiles,
    resourceView,
    health,
    imbalance,
    budget,
    readiness,
    safetyMargin,
    summary,
  };
}

/**
 * 格式化帝国经济摘要（供 Observability / Dashboard 用）。

 * 输出示例：
 * ┌─────────────────────────────────┐
 * │ Empire                           │
 * │ Rooms: 3                         │
 * │ Energy: 6,200                    │
 * │ Production: +27/tick              │
 * │ Consumption: -10/tick             │
 * │ Net: +17/tick                    │
 * │ Deficit Rooms: 1                  │
 * │ Surplus Rooms: 2                  │
 * │ Critical Requests: 0             │
 * │ Health: growing                  │
 * │ Safety: 0.72                     │
 * │ Expansion: READY                 │
 * └─────────────────────────────────┘
 */
export function formatEmpireSummary(
  view: EmpireResourceView,
  health: EconomicHealthResult,
  imbalance: ResourceImbalanceResult,
  budget: EmpireBudget,
  readiness: ExpansionReadinessResult,
  safetyMargin: SafetyMarginResult,
): string {
  const lines = [
    "Empire",
    "---------------------",
    `Rooms: ${view.roomCount}`,
    `Energy: ${view.totalEnergy.toLocaleString()}`,
    `Production: +${view.totalProduction.toFixed(0)}/tick`,
    `Net: ${view.totalNetFlow >= 0 ? "+" : ""}${view.totalNetFlow.toFixed(1)}/tick`,
    `Deficit Rooms: ${imbalance.deficitCount}`,
    `Surplus Rooms: ${imbalance.surplusCount}`,
    `Imbalance: ${imbalance.hasImbalance ? "YES" : "NO"}`,
    `Budget: reserve=${budget.reserve} survival=${budget.survival} prod=${budget.production} infra=${budget.infrastructure} expand=${budget.expansion} free=${budget.free}`,
    `Health: ${health.health}`,
    `Safety: ${safetyMargin.score.toFixed(2)}`,
    `Expansion: ${readiness.readiness}`,
  ];
  return lines.join("\n");
}
