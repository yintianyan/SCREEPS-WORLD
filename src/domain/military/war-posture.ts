/** War Posture */

import type { ThreatAssessment, ThreatLevel } from "../defense/threat-assessment";
import type { MultiDimensionalConfidence } from "../defense/confidence";
import type { PlayerIntelRecord } from "../defense/player-intel";

// ═══════════════════════════════════════════════════════════
// §1. WarPosture 类型
// ═══════════════════════════════════════════════════════════

export type WarPosture =
  | "DEFENSIVE"          // 纯防御，不进攻
  | "CONTAIN"            // 遏制（骚扰/否定，不全面进攻）
  | "LIMITED_OFFENSIVE"  // 有限进攻（特定目标）
  | "FULL_OFFENSIVE"     // 全面进攻
  | "CEASEFIRE";         // 停火（非 war 姿态）

// ═══════════════════════════════════════════════════════════
// §2. 输入类型
// ═══════════════════════════════════════════════════════════

export interface WarPostureInput {
  /** 帝国姿态（来自 empire-strategy）。 */
  empirePosture: "develop" | "expand" | "fortify" | "war";
  /** 当前 tick。 */
  tick: number;
  /** 帝国健康度等级。 */
  empireHealth: "healthy" | "stable" | "degraded" | "critical";
  /** 帝国能量储备。 */
  empireEnergyReserve: number;
  /** 威胁评估列表（各受威胁房）。 */
  threatAssessments: readonly { roomName: string; assessment: ThreatAssessment }[];
  /** 玩家情报（威胁来源玩家）。 */
  playerIntel?: PlayerIntelRecord;
  /** 多维度置信度（最高威胁房的）。 */
  confidence?: MultiDimensionalConfidence;
  /** CPU tier。 */
  cpuTier: "healthy" | "guarded" | "conserve" | "recovery";
  /** 活跃远矿数。 */
  activeRemoteCount: number;
  /** 帝国总 spawn 容量（可用 spawn 数）。 */
  spawnCapacity: number;
  /** 当前是否有活跃 Operation。 */
  hasActiveOperation: boolean;
}

// ═══════════════════════════════════════════════════════════
// §3. 评估输出
// ═══════════════════════════════════════════════════════════

export interface WarPostureResult {
  posture: WarPosture;
  /** 是否授权进攻。 */
  offensiveAuthorized: boolean;
  /** 授权的进攻级别（0=无, 1=有限, 2=全面）。 */
  offensiveLevel: 0 | 1 | 2;
  /** 原因链。 */
  reasons: string[];
  /** 证据。 */
  evidence: string[];
  /** 评估 tick。 */
  tick: number;
}

// ═══════════════════════════════════════════════════════════
// §4. 评估纯函数
// ═══════════════════════════════════════════════════════════

/**
 * 评估 WarPosture — 唯一进攻授权来源。

 * 决策矩阵：
 * 1. EmpirePosture !== "war" → CEASEFIRE（不授权任何进攻）
 * 2. EmpireHealth = CRITICAL → DEFENSIVE（帝国危急，不能进攻）
 * 3. CPUTier = RECOVERY → DEFENSIVE（CPU 不够，不能进攻）
 * 4. 无合格威胁 → DEFENSIVE（没人打我们，不需要进攻）
 * 5. 威胁 HIGH + IntelConfidence HIGH → CONTAIN（遏制）
 * 6. 威胁 CRITICAL + IntelConfidence HIGH + EmpireHealth STABLE+ → LIMITED_OFFENSIVE
 * 7. 威胁 CRITICAL + IntelConfidence CONFIRMED + EmpireHealth HEALTHY + Resource充足 → FULL_OFFENSIVE

 * Intel Confidence 必须影响 WarPosture：
 * - HIGH Threat + LOW Intel → CONTAIN / DEFENSIVE（不盲目进攻）
 * - HIGH Threat + HIGH Intel → 可以升级到 OFFENSIVE
 */
export function evaluateWarPosture(input: WarPostureInput): WarPostureResult {
  const reasons: string[] = [];
  const evidence: string[] = [];

  // 1. 非 war 姿态 → CEASEFIRE
  if (input.empirePosture !== "war") {
    reasons.push(`empirePosture=${input.empirePosture} (非战争)`);
    return {
      posture: "CEASEFIRE",
      offensiveAuthorized: false,
      offensiveLevel: 0,
      reasons,
      evidence,
      tick: input.tick,
    };
  }

  // 2. 帝国危急 → DEFENSIVE
  if (input.empireHealth === "critical") {
    reasons.push(`empireHealth=critical → 禁止非必要进攻`);
    return {
      posture: "DEFENSIVE",
      offensiveAuthorized: false,
      offensiveLevel: 0,
      reasons,
      evidence,
      tick: input.tick,
    };
  }

  // 3. CPU 不够 → DEFENSIVE
  if (input.cpuTier === "recovery") {
    reasons.push(`cpuTier=recovery → 无 CPU 余量进攻`);
    return {
      posture: "DEFENSIVE",
      offensiveAuthorized: false,
      offensiveLevel: 0,
      reasons,
      evidence,
      tick: input.tick,
    };
  }

  // 4. 评估最高威胁
  const maxThreat = input.threatAssessments.reduce((max, t) => {
    const level = t.assessment.level;
    return levelRank(level) > levelRank(max) ? level : max;
  }, "NONE" as ThreatLevel);

  // 5. 无 HIGH+ 威胁 → DEFENSIVE（没人严重威胁我们）
  if (levelRank(maxThreat) < levelRank("HIGH")) {
    reasons.push(`maxThreat=${maxThreat} (< HIGH) → 无需进攻`);
    return {
      posture: "DEFENSIVE",
      offensiveAuthorized: false,
      offensiveLevel: 0,
      reasons,
      evidence,
      tick: input.tick,
    };
  }

  // 6. Intel Confidence 检查 — 不盲目进攻
  const overallConfidence = input.confidence?.overallConfidence ?? 0.5;
  const intelConfidence = input.confidence?.intelConfidence ?? 0;

  // LOW Confidence + HIGH Threat → CONTAIN (不进攻，但骚扰/遏制)
  if (overallConfidence < 0.4 || intelConfidence < 0.2) {
    reasons.push(`threat=${maxThreat} + overallConfidence=${overallConfidence.toFixed(2)} < 0.4 → 情报不足，遏制`);
    evidence.push(`intelConfidence=${intelConfidence.toFixed(2)}`);
    return {
      posture: "CONTAIN",
      offensiveAuthorized: true,
      offensiveLevel: 1,
      reasons,
      evidence,
      tick: input.tick,
    };
  }

  // 7. CRITICAL Threat + HIGH Confidence → 进攻
  if (maxThreat === "CRITICAL") {
    // FULL_OFFENSIVE 需要严格条件
    if (input.empireHealth === "healthy" && input.spawnCapacity > 0 && overallConfidence >= 0.7) {
      reasons.push(`threat=CRITICAL + health=healthy + confidence=${overallConfidence.toFixed(2)} ≥ 0.7 → 全面进攻`);
      return {
        posture: "FULL_OFFENSIVE",
        offensiveAuthorized: true,
        offensiveLevel: 2,
        reasons,
        evidence,
        tick: input.tick,
      };
    }
    // LIMITED_OFFENSIVE
    reasons.push(`threat=CRITICAL + confidence=${overallConfidence.toFixed(2)} → 有限进攻`);
    return {
      posture: "LIMITED_OFFENSIVE",
      offensiveAuthorized: true,
      offensiveLevel: 1,
      reasons,
      evidence,
      tick: input.tick,
    };
  }

  // 8. HIGH Threat → CONTAIN
  reasons.push(`threat=HIGH + confidence=${overallConfidence.toFixed(2)} → 遏制`);
  return {
    posture: "CONTAIN",
    offensiveAuthorized: true,
    offensiveLevel: 1,
    reasons,
    evidence,
    tick: input.tick,
  };
}

function levelRank(level: ThreatLevel): number {
  return { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[level] ?? 0;
}

// ═══════════════════════════════════════════════════════════
// §5. 授权查询
// ═══════════════════════════════════════════════════════════

/**
 * 检查 WarPosture 是否授权特定 OperationType。

 * DEFENSIVE: 只允许 DEFEND / ESCORT / RETREAT
 * CONTAIN: DEFENSIVE + HARASS / REMOTE_DENIAL
 * LIMITED_OFFENSIVE: CONTAIN + SIEGE / RAID / CONTROLLER_ATTACK
 * FULL_OFFENSIVE: 全部
 * CEASEFIRE: 无进攻授权
 */
export function isOperationAuthorized(
  posture: WarPosture,
  operationType: string,
): boolean {
  const defensive = ["DEFEND", "ESCORT", "RETREAT", "ABORT"];
  const contain = [...defensive, "HARASS", "REMOTE_DENIAL"];
  const limited = [...contain, "SIEGE", "RAID", "CONTROLLER_ATTACK", "RESERVE"];
  const full = [...limited, "ASSAULT", "CLAIM"];

  switch (posture) {
    case "CEASEFIRE": return false;
    case "DEFENSIVE": return defensive.includes(operationType);
    case "CONTAIN": return contain.includes(operationType);
    case "LIMITED_OFFENSIVE": return limited.includes(operationType);
    case "FULL_OFFENSIVE": return full.includes(operationType);
    default: return false;
  }
}
