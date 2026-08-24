/**
 * Expansion Pressure Model — A3.2 Phase 1：帝国为什么想扩张。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §1.1 四类动机 + GOAL_POLICY_PLAN §3 posture。
 *
 * 定位：回答「帝国当前是否有扩张驱动力」——不是「能不能扩张」（Readiness），
 * 而是「想不想扩张」（Pressure）。Pressure=HIGH + Readiness=NOT_READY → 不扩张但
 * 标记需求；Pressure=LOW + Readiness=READY → 不扩张（没有驱动力）。
 *
 * 七维可解释检测，不用复杂公式：
 *   1. productionCapacity  — 产能利用率饱和度
 *   2. storageSaturation  — 储备水位饱和度
 *   3. spawnCapacity      — 孵化带宽饱和度
 *   4. resourceDeficit    — 资源缺口信号
 *   5. growthOpportunity  — GCL 余量 + 候选池深度
 *   6. strategicPosition — 战略位置需求（对手逼近）
 *   7. infrastructureSaturation — 基建饱和（无发展空间）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { EmpireResourceView } from "../strategy/resource-view";
import type { EmpireBudget } from "../strategy/budget";
import type { RoomCapacityProfile } from "../economy/capacity-profile";

/** 扩张压力等级。 */
export type ExpansionPressureLevel = "LOW" | "MEDIUM" | "HIGH";

/** 资源缺口严重度。 */
export type ResourceDeficitLevel = "none" | "low" | "medium" | "high";

/** 扩张压力评估输入。 */
export interface ExpansionPressureInput {
  /** 帝国资源视图。 */
  view: EmpireResourceView;
  /** 帝国预算。 */
  budget: EmpireBudget;
  /** 各房产能剖面。 */
  capacityProfiles: readonly RoomCapacityProfile[];
  /** 当前 GCL 等级。 */
  gclLevel: number;
  /** 当前自有房数。 */
  ownedRoomCount: number;
  /** 已知候选房数（从 Candidate Registry 传入）。 */
  candidateCount: number;
  /** 是否有对手逼近信号（从 situation 传入）。 */
  hasAdversaryPressure: boolean;
}

/** 扩张压力评估结果。 */
export interface ExpansionPressureResult {
  /** 压力等级。 */
  level: ExpansionPressureLevel;
  /** 七维明细。 */
  dimensions: {
    productionCapacity: number;
    storageSaturation: number;
    spawnCapacity: number;
    resourceDeficit: ResourceDeficitLevel;
    growthOpportunity: number;
    strategicPosition: number;
    infrastructureSaturation: number;
  };
  /** 综合压力分数（0..1）。 */
  score: number;
  /** 人类可读证据。 */
  evidence: string;
}

/** 压力阈值选项。 */
export interface PressureOptions {
  /** 产能利用率 ≥ 此值视为饱和。 */
  productionSaturated: number;
  /** 储备水位 ≥ 此值视为饱和。 */
  storageSaturated: number;
  /** 孵化利用率 ≥ 此值视为饱和。 */
  spawnSaturated: number;
  /** 综合分数 ≥ 此值 → HIGH。 */
  highThreshold: number;
  /** 综合分数 ≥ 此值 → MEDIUM。 */
  mediumThreshold: number;
  /** 基建利用率 ≥ 此值视为饱和。 */
  infraSaturated: number;
}

export const DEFAULT_PRESSURE_OPTIONS: PressureOptions = {
  productionSaturated: 0.8,
  storageSaturated: 0.85,
  spawnSaturated: 0.8,
  highThreshold: 0.6,
  mediumThreshold: 0.35,
  infraSaturated: 0.9,
};

/**
 * 评估帝国扩张压力（纯函数）。
 *
 * 综合七维信号，输出 LOW/MEDIUM/HIGH + 可解释证据。
 */
export function evaluateExpansionPressure(
  input: ExpansionPressureInput,
  options: PressureOptions = DEFAULT_PRESSURE_OPTIONS,
): ExpansionPressureResult {
  const { view, capacityProfiles, gclLevel, ownedRoomCount, candidateCount, hasAdversaryPressure } = input;

  // ── 1. Production Capacity ──
  // 帝国平均产能利用率；无房时 0。
  let avgUtilization = 0;
  if (capacityProfiles.length > 0) {
    let sum = 0;
    for (const cp of capacityProfiles) sum += cp.utilization;
    avgUtilization = sum / capacityProfiles.length;
  }
  const productionCapacity = clamp01(avgUtilization);

  // ── 2. Storage Saturation ──
  // 帝国总储备水位比例。
  let totalReserveCapacity = 0;
  let totalReserveUsed = 0;
  for (const cp of capacityProfiles) {
    totalReserveCapacity += cp.totalReserveCapacity;
    totalReserveUsed += cp.totalReserveCapacity * cp.reserveUtilization;
  }
  const storageSaturation = totalReserveCapacity > 0
    ? clamp01(totalReserveUsed / totalReserveCapacity)
    : 0;

  // ── 3. Spawn Capacity ──
  // 帝国平均孵化利用率。
  let avgSpawnUtil = 0;
  if (capacityProfiles.length > 0) {
    let sum = 0;
    for (const cp of capacityProfiles) sum += cp.spawnUtilization;
    avgSpawnUtil = sum / capacityProfiles.length;
  }
  const spawnCapacity = clamp01(avgSpawnUtil);

  // ── 4. Resource Deficit ──
  // 从 imbalance 信号派生。
  let resourceDeficit: ResourceDeficitLevel = "none";
  const deficitCount = view.deficitRooms.length;
  if (deficitCount >= 3) resourceDeficit = "high";
  else if (deficitCount >= 2) resourceDeficit = "medium";
  else if (deficitCount >= 1) resourceDeficit = "low";

  // ── 5. Growth Opportunity ──
  // GCL 余量 + 候选池深度。
  const gclHeadroom = Math.max(0, gclLevel - ownedRoomCount);
  const growthOpportunity = clamp01(
    (gclHeadroom > 0 ? 0.5 : 0) +
    (candidateCount >= 3 ? 0.5 : candidateCount / 6),
  );

  // ── 6. Strategic Position ──
  // 对手逼近 → 高战略需求。
  const strategicPosition = hasAdversaryPressure ? 1 : 0;

  // ── 7. Infrastructure Saturation ──
  // 基建瓶颈房占比（bottleneck !== "none" 的房比例）。
  let bottleneckCount = 0;
  for (const cp of capacityProfiles) {
    if (cp.bottleneck !== "none") bottleneckCount++;
  }
  const infrastructureSaturation = capacityProfiles.length > 0
    ? clamp01(bottleneckCount / capacityProfiles.length)
    : 0;

  // ── 综合评分 ──
  // 七维加权：产能/储备/孵化饱和度各 0.2，缺口 0.1，增长机会 0.1，战略 0.1，基建 0.1
  // （归一化后线性加权）
  const deficitScore = resourceDeficit === "high" ? 1
    : resourceDeficit === "medium" ? 0.6
    : resourceDeficit === "low" ? 0.3
    : 0;

  const score = clamp01(
    productionCapacity * 0.2 +
    storageSaturation * 0.2 +
    spawnCapacity * 0.15 +
    deficitScore * 0.1 +
    growthOpportunity * 0.15 +
    strategicPosition * 0.1 +
    infrastructureSaturation * 0.1,
  );

  const level: ExpansionPressureLevel =
    score >= options.highThreshold ? "HIGH"
    : score >= options.mediumThreshold ? "MEDIUM"
    : "LOW";

  const evidence = [
    `prod=${(productionCapacity * 100).toFixed(0)}%`,
    `storage=${(storageSaturation * 100).toFixed(0)}%`,
    `spawn=${(spawnCapacity * 100).toFixed(0)}%`,
    `deficit=${resourceDeficit}`,
    `growth=${(growthOpportunity * 100).toFixed(0)}%`,
    `strategic=${strategicPosition > 0 ? "yes" : "no"}`,
    `infra=${(infrastructureSaturation * 100).toFixed(0)}%`,
    `→ ${level}(${score.toFixed(2)})`,
  ].join(" ");

  return {
    level,
    dimensions: {
      productionCapacity,
      storageSaturation,
      spawnCapacity,
      resourceDeficit,
      growthOpportunity,
      strategicPosition,
      infrastructureSaturation,
    },
    score,
    evidence,
  };
}

/** clamp 到 [0, 1]。 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
