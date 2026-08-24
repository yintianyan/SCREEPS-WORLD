/**
 * Colony Stability Dashboard — A3.4：Colony 稳定性可观测性。
 *
 * 合同锚点：A3.4 Task Spec §27 Observability。
 *
 * 把 Colony 的稳定性指标汇总为结构化 Dashboard，
 * 供 globalCache 写入、控制台/log 消费。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { AutonomyAgeResult } from "./autonomy";
import type { StabilityScoreResult } from "./stability-score";
import type { ColonyFailureResult } from "./colony-failure";

/** Colony Stability Dashboard 数据。 */
export interface ColonyStabilityDashboard {
  /** 采样 tick。 */
  tick: number;
  /** 房间名。 */
  roomName: string;
  // ── 基础 ──
  /** RCL。 */
  rcl: number;
  /** ColonyState。 */
  colonyState: string;
  /** Expansion 状态（COMPLETED / idle）。 */
  expansionStatus: string;
  /** Bootstrap 状态（active / none）。 */
  bootstrapStatus: string;
  // ── 经济 ──
  /** 能量净流。 */
  netEnergyFlow: number;
  /** 外部能量流入。 */
  externalInflow: number;
  /** 产能。 */
  production: number;
  /** 消耗。 */
  consumption: number;
  // ── 人口 ──
  /** 当前人口。 */
  population: number;
  /** 目标人口。 */
  targetPopulation: number;
  /** 是否有可用 spawn。 */
  spawnAvailable: boolean;
  /** Storage 能量。 */
  storageEnergy: number;
  // ── 稳定性 ──
  /** 自治年龄。 */
  autonomyAge: number;
  /** 自治等级。 */
  autonomyLevel: string;
  /** 稳定性总分。 */
  stabilityScore: number;
  /** 稳定性等级。 */
  stabilityLevel: string;
  /** 失败维度列表。 */
  failingDimensions: string[];
  /** 是否检测到失败。 */
  failureDetected: boolean;
  /** 失败类型列表。 */
  failureTypes: string[];
  /** Resource Network 角色（surplus/deficit/balanced）。 */
  resourceNetworkRole: string;
  // ── 摘要 ──
  /** 人类可读摘要。 */
  summary: string;
}

/**
 * 组装 Colony Stability Dashboard（纯函数）。
 */
export function buildColonyStabilityDashboard(input: {
  tick: number;
  roomName: string;
  rcl: number;
  colonyState: string;
  expansionStatus: string;
  bootstrapStatus: string;
  netEnergyFlow: number;
  externalInflow: number;
  production: number;
  consumption: number;
  population: number;
  targetPopulation: number;
  spawnAvailable: boolean;
  storageEnergy: number;
  autonomyResult?: AutonomyAgeResult;
  stabilityResult?: StabilityScoreResult;
  failureResult?: ColonyFailureResult;
  resourceNetworkRole?: string;
}): ColonyStabilityDashboard {
  const {
    tick, roomName, rcl, colonyState, expansionStatus, bootstrapStatus,
    netEnergyFlow, externalInflow, production, consumption,
    population, targetPopulation, spawnAvailable, storageEnergy,
    autonomyResult, stabilityResult, failureResult,
    resourceNetworkRole = "unknown",
  } = input;

  const failingDimensions = stabilityResult?.failingDimensions ?? [];
  const failureTypes = failureResult?.detected ? failureResult.failureTypes : [];

  const summary = [
    `Colony @${tick} ${roomName}`,
    `rcl=${rcl} state=${colonyState}`,
    `netFlow=${netEnergyFlow.toFixed(1)} external=${externalInflow}`,
    `pop=${population}/${targetPopulation}`,
    `score=${stabilityResult?.totalScore ?? "?"} (${stabilityResult?.level ?? "?"})`,
    `autonomy=${autonomyResult?.age ?? "?"}t (${autonomyResult?.level ?? "?"})`,
    failureTypes.length > 0 ? `FAIL: ${failureTypes.join(",")}` : "OK",
  ].join(" | ");

  return {
    tick,
    roomName,
    rcl,
    colonyState,
    expansionStatus,
    bootstrapStatus,
    netEnergyFlow,
    externalInflow,
    production,
    consumption,
    population,
    targetPopulation,
    spawnAvailable,
    storageEnergy,
    autonomyAge: autonomyResult?.age ?? 0,
    autonomyLevel: autonomyResult?.level ?? "new",
    stabilityScore: stabilityResult?.totalScore ?? 0,
    stabilityLevel: stabilityResult?.level ?? "CRITICAL",
    failingDimensions,
    failureDetected: failureResult?.detected ?? false,
    failureTypes,
    resourceNetworkRole,
    summary,
  };
}
