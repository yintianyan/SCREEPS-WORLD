/**
 * Threat Escalation — A3.3 Phase 1：威胁升级响应。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §2 G4 可撤离门控 +
 * DEFENSE_ARCHITECTURE §1 威胁评估。
 *
 * 定位：扩张执行过程中，如果新房或路径上出现威胁升级，
 * 需要决策：继续 / 暂停 / 撤离。
 *
 * 三级威胁响应：
 *   1. GREEN: 无威胁 → 继续
 *   2. YELLOW: 可疑活动 → 暂停 + 评估
 *   3. RED: 确认威胁 → 撤离 + 释放资源
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExecutionState } from "./execution-state";

/** 威胁等级。 */
export type ThreatLevel = "GREEN" | "YELLOW" | "RED";

/** 威胁评估输入。 */
export interface ThreatEscalationInput {
  /** 新房是否有敌方 creep。 */
  hasHostileCreep: boolean;
  /** 新房 controller 是否被敌方 reservation。 */
  hasHostileReservation: boolean;
  /** 路径上是否有敌方 creep。 */
  hasPathThreat: boolean;
  /** Sponsor 房是否被攻击。 */
  sponsorUnderAttack: boolean;
  /** 新房是否有敌方塔。 */
  hasHostileTower: boolean;
  /** 当前 ExecutionState。 */
  executionState: ExecutionState;
  /** 当前 tick。 */
  tick: number;
}

/** 威胁响应动作。 */
export type ThreatResponseAction =
  | "CONTINUE"       // 继续执行
  | "PAUSE"         // 暂停（等待威胁解除）
  | "REINFORCE"     // 增援（调派防御部队）
  | "ABORT"         // 终止扩张
  | "EVACUATE";     // 撤离已有单位

/** 威胁评估结果。 */
export interface ThreatEscalationResult {
  /** 威胁等级。 */
  level: ThreatLevel;
  /** 响应动作。 */
  action: ThreatResponseAction;
  /** 威胁证据。 */
  evidence: string[];
  /** 是否应暂停执行。 */
  shouldPause: boolean;
  /** 是否应终止扩张。 */
  shouldAbort: boolean;
  /** 人类可读摘要。 */
  summary: string;
}

/**
 * 评估威胁升级并决定响应动作（纯函数）。
 *
 * 判定逻辑：
 *   - RED: hasHostileCreep || hasHostileTower || sponsorUnderAttack
 *   - YELLOW: hasHostileReservation || hasPathThreat
 *   - GREEN: none of above
 *
 * 响应逻辑：
 *   - GREEN → CONTINUE
 *   - YELLOW → PAUSE（如果 state < CLAIMED）或 CONTINUE（如果已 claim）
 *   - RED + state < CLAIMED → ABORT
 *   - RED + state >= CLAIMED → EVACUATE（保护已有投入）
 */
export function evaluateThreatEscalation(input: ThreatEscalationInput): ThreatEscalationResult {
  const evidence: string[] = [];

  // 威胁等级判定
  const redThreats: string[] = [];
  const yellowThreats: string[] = [];

  if (input.hasHostileCreep) {
    redThreats.push("hostile creep in target room");
    evidence.push("hostileCreep=true");
  }
  if (input.hasHostileTower) {
    redThreats.push("hostile tower detected");
    evidence.push("hostileTower=true");
  }
  if (input.sponsorUnderAttack) {
    redThreats.push("sponsor room under attack");
    evidence.push("sponsorUnderAttack=true");
  }
  if (input.hasHostileReservation) {
    yellowThreats.push("hostile reservation on controller");
    evidence.push("hostileReservation=true");
  }
  if (input.hasPathThreat) {
    yellowThreats.push("hostile creep on path");
    evidence.push("pathThreat=true");
  }

  const level: ThreatLevel = redThreats.length > 0 ? "RED"
    : yellowThreats.length > 0 ? "YELLOW"
    : "GREEN";

  // 响应动作判定
  let action: ThreatResponseAction = "CONTINUE";
  let shouldPause = false;
  let shouldAbort = false;

  const claimedOrBeyond: boolean =
    input.executionState === "CLAIMED" ||
    input.executionState === "BOOTSTRAPPING" ||
    input.executionState === "ECONOMIC_STARTUP" ||
    input.executionState === "INTEGRATING" ||
    input.executionState === "COMPLETED";

  switch (level) {
    case "GREEN":
      action = "CONTINUE";
      break;
    case "YELLOW":
      // 如果还未 claim，暂停等待威胁解除
      // 如果已 claim，继续但保持警惕
      if (claimedOrBeyond) {
        action = "CONTINUE";
      } else {
        action = "PAUSE";
        shouldPause = true;
      }
      break;
    case "RED":
      if (claimedOrBeyond) {
        // 已有大量投入，撤离保护资产
        action = "EVACUATE";
        shouldAbort = true;
      } else {
        // 投入不大，直接终止
        action = "ABORT";
        shouldAbort = true;
      }
      break;
  }

  const threatSummary = redThreats.length > 0
    ? `RED: ${redThreats.join("; ")}`
    : yellowThreats.length > 0
    ? `YELLOW: ${yellowThreats.join("; ")}`
    : "GREEN: no threats";

  const summary = `ThreatEscalation @${input.tick}: ${level} → ${action} | ${threatSummary}`;

  return {
    level,
    action,
    evidence,
    shouldPause,
    shouldAbort,
    summary,
  };
}
