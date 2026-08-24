/**
 * Expansion Cost Model — A3.2 Phase 1：扩张成本估算。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §4 殖民自举五阶段成本。
 *
 * 定位：回答「扩张到新房需要多少资源」——不是「当前有多少可调拨」。
 * 估算 Bootstrap Cost（0→Autonomous）+ Travel Cost + Spawn Cost + Infrastructure Cost。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExpansionCandidateV2 } from "./candidate";

/** 扩张成本估算结果。 */
export interface ExpansionCostEstimate {
  /** 候选房名。 */
  roomName: string;
  /** 总估算成本（能量）。 */
  totalCost: number;
  // ── 分项 ──
  /** Claimer 成本（1 CLAIM + MOVE ≈ 650 能量）。 */
  claimerCost: number;
  /** 拓荒编队成本（worker + builder body 总和）。 */
  pioneerCost: number;
  /** Spawn 建造成本（5,000 能量 + 建材）。 */
  spawnCost: number;
  /** 通勤成本（pathCost 衍生的能量损耗估算）。 */
  travelCost: number;
  /** 基建成本（初期 structure 总和，简化估算）。 */
  infrastructureCost: number;
  /** 自举期输血总量估算（从 claim 到 spawn 落地期间的总输血量）。 */
  bootstrapEnergy: number;
  /** 估算依据摘要（人类可读）。 */
  evidence: string;
}

/** 成本估算选项。 */
export interface CostModelOptions {
  /** Claimer body 成本（1 CLAIM + MOVE ≈ 650 能量）。 */
  claimerBodyCost: number;
  /** 单个 Pioneer Worker body 成本（3W3C3M = 600 能量）。 */
  pioneerWorkerBodyCost: number;
  /** 单个 Pioneer Builder body 成本（同 worker）。 */
  pioneerBuilderBodyCost: number;
  /** Pioneer Worker 数量。 */
  pioneerWorkerCount: number;
  /** Pioneer Builder 数量。 */
  pioneerBuilderCount: number;
  /** Spawn 建造所需能量。 */
  spawnEnergyCost: number;
  /** 基建结构初期估算成本（extensions + containers + roads 简化）。 */
  infrastructureBase: number;
  /** 自举期输血估算系数（从 pathCost × distance × pioneerCount 推导）。 */
  bootstrapEnergyPerTickPerHop: number;
  /** 自举期估算时长（tick）。 */
  bootstrapDuration: number;
  /** 通勤损耗系数（每跳每 tick 的能量损耗）。 */
  travelLossPerHop: number;
}

export const DEFAULT_COST_OPTIONS: CostModelOptions = {
  claimerBodyCost: 650,
  pioneerWorkerBodyCost: 600,
  pioneerBuilderBodyCost: 600,
  pioneerWorkerCount: 2,
  pioneerBuilderCount: 2,
  spawnEnergyCost: 5000,
  infrastructureBase: 3000,
  bootstrapEnergyPerTickPerHop: 10,
  bootstrapDuration: 5000,
  travelLossPerHop: 5,
};

/**
 * 估算扩张总成本（纯函数）。
 *
 * 成本构成：
 * 1. Claimer  = claimerBodyCost（一次性）
 * 2. Pioneer  = (workerCount × workerBodyCost) + (builderCount × builderBodyCost)（一次性）
 * 3. Spawn    = spawnEnergyCost（一次性，含建材）
 * 4. Travel   = pathCost × travelLossPerHop × distance（通勤损耗估算）
 * 5. Bootstrap= bootstrapEnergyPerTickPerHop × distance × bootstrapDuration（输血总量）
 * 6. Infra    = infrastructureBase（基建初期）
 */
export function estimateExpansionCost(
  candidate: ExpansionCandidateV2,
  options: CostModelOptions = DEFAULT_COST_OPTIONS,
): ExpansionCostEstimate {
  const distance = candidate.distance;

  const claimerCost = options.claimerBodyCost;
  const pioneerCost =
    options.pioneerWorkerCount * options.pioneerWorkerBodyCost +
    options.pioneerBuilderCount * options.pioneerBuilderBodyCost;
  const spawnCost = options.spawnEnergyCost;

  // 通勤损耗：pathCost 或 distance 推导
  const pathCost = candidate.pathCost ?? distance * 50;
  const travelCost = Math.round(pathCost * options.travelLossPerHop);

  // 自举期输血总量
  const bootstrapEnergy = Math.round(
    options.bootstrapEnergyPerTickPerHop * distance * options.bootstrapDuration,
  );

  // 基建
  const infrastructureCost = options.infrastructureBase;

  const totalCost = claimerCost + pioneerCost + spawnCost + travelCost + bootstrapEnergy + infrastructureCost;

  const evidence = [
    `claimer=${claimerCost}`,
    `pioneer=${pioneerCost}(${options.pioneerWorkerCount}w+${options.pioneerBuilderCount}b)`,
    `spawn=${spawnCost}`,
    `travel=${travelCost}(pathCost=${pathCost})`,
    `bootstrap=${bootstrapEnergy}(${options.bootstrapDuration}t×${distance}hop)`,
    `infra=${infrastructureCost}`,
    `total=${totalCost}`,
  ].join(" ");

  return {
    roomName: candidate.roomName,
    totalCost,
    claimerCost,
    pioneerCost,
    spawnCost,
    travelCost,
    infrastructureCost,
    bootstrapEnergy,
    evidence,
  };
}

/**
 * 批量估算候选房成本。
 */
export function estimateCosts(
  candidates: readonly ExpansionCandidateV2[],
  options: CostModelOptions = DEFAULT_COST_OPTIONS,
): ExpansionCostEstimate[] {
  return candidates.map(c => estimateExpansionCost(c, options));
}
