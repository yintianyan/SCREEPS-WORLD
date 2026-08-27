/** Execution Dashboard */

import type { ExecutionState } from "./execution-state";
import type { CheckpointRecord } from "./checkpoint";
import type { EconomicActivationResult } from "./economic-activation";
import type { EmpireIntegrationResult } from "./empire-integration";
import type { ThreatEscalationResult } from "./threat-escalation";

/** Execution Dashboard 数据。 */
export interface ExecutionDashboard {
  /** 采样 tick。 */
  tick: number;
  // ── 当前执行 ──
  /** 当前执行状态。 */
  executionState: ExecutionState | "idle";
  /** 目标房名。 */
  targetRoom?: string;
  /** Sponsor 房名。 */
  sponsorRoom?: string;
  /** 执行进度百分比。 */
  progress: number;
  /** 状态描述。 */
  stateDescription: string;
  // ── Checkpoints ──
  /** 已通过 checkpoint 数。 */
  checkpointsPassed: number;
  /** 总 checkpoint 数。 */
  checkpointsTotal: number;
  /** Checkpoint 详情。 */
  checkpointDetails: { id: string; status: string; description: string }[];
  // ── 经济激活 ──
  /** 经济激活状态。 */
  economicActivated: boolean;
  /** 能量净流。 */
  netEnergyFlow: number;
  /** 是否自给自足。 */
  selfSustaining: boolean;
  /** 连续净流为正的 tick 数。 */
  consecutivePositiveTicks: number;
  // ── 帝国集成 ──
  /** 帝国集成状态。 */
  empireIntegrated: boolean;
  /** 缺失的集成系统。 */
  missingSystems: string[];
  // ── 威胁 ──
  /** 威胁等级。 */
  threatLevel: "GREEN" | "YELLOW" | "RED";
  /** 威胁响应动作。 */
  threatAction: string;
  // ── 资源 ──
  /** 预留能量。 */
  reservedEnergy: number;
  // ── 摘要 ──
  /** 人类可读摘要。 */
  summary: string;
}

/**
 * 组装 Execution Dashboard（纯函数）。
 */
export function buildExecutionDashboard(input: {
  tick: number;
  executionState: ExecutionState | "idle";
  targetRoom?: string;
  sponsorRoom?: string;
  progress: number;
  checkpointsPassed: number;
  checkpointRecords?: CheckpointRecord[];
  economicResult?: EconomicActivationResult;
  integrationResult?: EmpireIntegrationResult;
  threatResult?: ThreatEscalationResult;
  reservedEnergy: number;
}): ExecutionDashboard {
  const {
    tick,
    executionState,
    targetRoom,
    sponsorRoom,
    progress,
    checkpointsPassed,
    checkpointRecords = [],
    economicResult,
    integrationResult,
    threatResult,
    reservedEnergy,
  } = input;

  const checkpointDetails = checkpointRecords.map(r => ({
    id: r.id,
    status: r.status,
    description: r.description,
  }));

  const summary = [
    `Execution Dashboard @${tick}`,
    `state=${executionState} progress=${progress}%`,
    targetRoom ? `target=${targetRoom}` : "no active expansion",
    sponsorRoom ? `sponsor=${sponsorRoom}` : "",
    `checkpoints=${checkpointsPassed}/5`,
    economicResult ? `netFlow=${economicResult.netFlow.toFixed(1)}` : "",
    economicResult?.activated ? "ECONOMICALLY_ACTIVATED" : "",
    integrationResult?.integrated ? "INTEGRATED" : "",
    threatResult ? `threat=${threatResult.level}` : "",
    progress === 100 ? "AUTONOMOUS" : "",
  ].filter(Boolean).join(" | ");

  return {
    tick,
    executionState,
    targetRoom,
    sponsorRoom,
    progress,
    stateDescription: executionState,
    checkpointsPassed,
    checkpointsTotal: 5,
    checkpointDetails,
    economicActivated: economicResult?.activated ?? false,
    netEnergyFlow: economicResult?.netFlow ?? 0,
    selfSustaining: economicResult?.selfSustaining ?? false,
    consecutivePositiveTicks: economicResult?.consecutivePositiveTicks ?? 0,
    empireIntegrated: integrationResult?.integrated ?? false,
    missingSystems: integrationResult?.missingSystems ?? [],
    threatLevel: threatResult?.level ?? "GREEN",
    threatAction: threatResult?.action ?? "CONTINUE",
    reservedEnergy,
    summary,
  };
}
