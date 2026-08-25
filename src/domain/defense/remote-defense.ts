/**
 * Remote Defense Decision — A5.1 G4 纯函数。
 *
 * 远矿房威胁响应决策：CONTINUE / PAUSE / ESCORT / RETREAT / ABORT。
 *
 * 核心原则：不纯按 Threat Level 做 switch。必须综合考虑：
 * - 远矿经济价值（incomePerTick / replacementCost / escortCost）
 * - 威胁级别与意图
 * - 撤退成本（creep 是否能安全返回）
 * - 增援 ETA
 * - 房间战略价值
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / Creep / Room / 任何 Runtime 对象。
 */

import type { ThreatAssessment, ThreatLevel } from "./threat-assessment";
import type { TerrainContext } from "./terrain-context";

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

/** 远矿防御动作（五级决策）。 */
export type RemoteDefenseAction = "CONTINUE" | "PAUSE" | "ESCORT" | "RETREAT" | "ABORT";

/** 远矿运营状态快照。 */
export interface RemoteOperationState {
  /** 目标房名。 */
  targetRoom: string;
  /** home 房名。 */
  homeRoom: string;
  /** 运营状态。 */
  state: "active" | "paused" | "abandoned";
  /** source 数量。 */
  sources: number;
  /** hauler 需求量。 */
  haulerNeed: number;
  /** 远矿 creep 总数（harvester + hauler + reserver + defender）。 */
  creepCount: number;
  /** 远矿 creep 的总 body 投资成本（能量）。 */
  creepInvestment: number;
  /** 通勤距离（房数）。 */
  pathCost?: number;
  /** 最近受袭 tick。 */
  threatUntil?: number;
  /** 危险冷却到期 tick。 */
  dangerUntil?: number;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近观测 tick。 */
  lastSeen: number;
}

/** 帝国上下文快照。 */
export interface EmpireContext {
  /** 当前 tick。 */
  tick: number;
  /** 帝国姿态。 */
  posture: "develop" | "expand" | "fortify" | "war";
  /** 帝国总能量储备。 */
  empireEnergyReserve: number;
  /** CPU tier。 */
  cpuTier: "abundant" | "comfortable" | "tight" | "constrained";
  /** 帝国活跃远矿数。 */
  activeRemoteCount: number;
  /** 远矿上限。 */
  maxRemoteOps: number;
}

/** 物流上下文快照。 */
export interface LogisticsContext {
  /** hauler 平均通勤时间（tick，单程）。 */
  avgHaulerCommute: number;
  /** 可用 hauler 数量。 */
  availableHaulers: number;
}

/** 军事上下文快照。 */
export interface MilitaryContext {
  /** 可用 defender 数量。 */
  availableDefenders: number;
  /** defender 孵化成本（能量）。 */
  defenderSpawnCost: number;
  /** defender 通勤时间（tick，home → remote room）。 */
  defenderCommuteTicks: number;
  /** 是否处于战争状态（war 姿态时远矿优先级降低）。 */
  atWar: boolean;
}

/** decideRemoteDefenseAction 的完整输入。 */
export interface RemoteDefenseInput {
  threat: ThreatAssessment;
  remoteOp: RemoteOperationState;
  empireContext: EmpireContext;
  logisticsContext: LogisticsContext;
  militaryContext: MilitaryContext;
  /** A5.2：地形上下文（可选，用于 Retreat/Escort/Reinforcement 难度评估）。 */
  terrainContext?: TerrainContext;
}

// ═══════════════════════════════════════════════════════════
// §2. Expected Value 计算
// ═══════════════════════════════════════════════════════════

/** 远矿运营的期望价值评估。 */
export interface RemoteExpectedValue {
  /** 运营价值（energy/tick）。 */
  operationValue: number;
  /** 风险系数（0-1，基于威胁级别）。 */
  risk: number;
  /** 期望损失（energy，基于威胁持续时间和 creep 投资）。 */
  expectedLoss: number;
  /** 护航成本（energy，defender 孵化 + 维持）。 */
  escortCost: number;
  /** 替换成本（energy，损失 creep 后的重建成本）。 */
  replacementCost: number;
  /** 净价值 = (operationValue × expectedDuration - expectedLoss - escortCost) × (1 - risk)。 */
  netValue: number;
  /** 期望运营持续时间（tick，基于威胁消除预期）。 */
  expectedDuration: number;
}

/**
 * 估算远矿运营的期望价值。
 *
 * operationValue = sources × 10 (energy/tick per source, 3000/300=10)
 * risk: 映射 ThreatLevel → 0-1
 * expectedLoss: creepInvestment × risk × threatDuration
 * escortCost: defenderSpawnCost + defenderCommuteTicks × 0.1 (CPU 换算)
 * replacementCost: creepInvestment（全部损失的重建成本）
 */
export function evaluateRemoteExpectedValue(input: RemoteDefenseInput): RemoteExpectedValue {
  const { threat, remoteOp, militaryContext } = input;

  // 运营价值：每 source 10 energy/tick（3000 能量 / 300 tick = 10/tick）
  const operationValue = remoteOp.sources * 10;

  // 风险系数
  const riskMap: Record<ThreatLevel, number> = {
    NONE: 0,
    LOW: 0.1,
    MEDIUM: 0.3,
    HIGH: 0.6,
    CRITICAL: 0.9,
  };
  const risk = riskMap[threat.level];

  // 期望持续时间：威胁消除预期
  // NPC invader 通常 50-150 tick 清场
  // 玩家骚扰可能持续数百 tick
  // SIEGE/FULL_ASSAULT 可能持续数千 tick
  const intentDurationMap: Record<string, number> = {
    UNKNOWN: 100,
    SCOUTING: 0,
    HARASSMENT: 200,
    REMOTE_MINING_ATTACK: 300,
    SIEGE: 2000,
    CONTROLLER_ATTACK: 500,
    ECONOMIC_ATTACK: 500,
    CLAIM: 1000,
    FULL_ASSAULT: 3000,
    NUCLEAR: 50000,
  };
  const expectedDuration = Math.max(
    100,
    intentDurationMap[threat.estimatedIntent.intent] ?? 200,
  );

  // 期望损失：基于威胁持续时间和风险
  // 如果不撤退，威胁持续期间 creep 可能被杀
  // CRITICAL 级别时 creep 几乎肯定会全部损失（expectedLoss = creepInvestment）
  // 其他级别按 risk × duration 缩放
  const expectedLoss = threat.level === "CRITICAL"
    ? remoteOp.creepInvestment
    : Math.round(remoteOp.creepInvestment * risk * Math.min(expectedDuration / 500, 1));

  // 护航成本
  const escortCost = militaryContext.defenderSpawnCost +
    Math.round(militaryContext.defenderCommuteTicks * 0.5);

  // 替换成本
  const replacementCost = remoteOp.creepInvestment;

  // 净价值 = 运营价值 × 持续时间 × (1 - risk) - 期望损失 - 护航成本
  // (1 - risk) 反映威胁期间远矿无法正常运营的时间比例
  // expectedLoss 反映 creep 投资的期望损失
  const grossValue = operationValue * expectedDuration * (1 - risk);
  const netValue = Math.round(grossValue - expectedLoss - escortCost);

  return {
    operationValue,
    risk,
    expectedLoss,
    escortCost,
    replacementCost,
    netValue,
    expectedDuration,
  };
}

// ═══════════════════════════════════════════════════════════
// §3. 决策函数
// ═══════════════════════════════════════════════════════════

/** 决策结果。 */
export interface RemoteDefenseDecision {
  action: RemoteDefenseAction;
  /** 决策原因（可追溯）。 */
  reason: string;
  /** 期望价值评估。 */
  expectedValue: RemoteExpectedValue;
  /**
   * 如果 ESCORT，输出护航需求（需求标记，非 spawn 指令）。
   *
   * 权责边界：本字段只描述「需要多少 defender」，不直接触发 spawn。
   * 实际孵化走 evaluateRemoteDemand → spawnQueue → spawn-manager 标准链路。
   * remote-mining-manager 消费此决策后保持 op.state = "active"，
   * 由 evaluateRemoteDemand 根据 threatUntil / remoteThreats 生成 remoteDefender 请求。
   *
   * 严禁：decideRemoteDefenseAction 或其调用方直接调 submitRequest / spawnCreep。
   */
  escortDemand?: {
    /** 需要 defender 数量。 */
    count: number;
    /** 预估成本。 */
    cost: number;
    /** 通勤时间。 */
    commuteTicks: number;
  };
  /** 被拒绝的替代方案及原因。 */
  rejectedAlternatives: { action: RemoteDefenseAction; reason: string }[];
}

/**
 * 远矿防御决策——综合威胁级别、经济价值和风险。
 *
 * 这是 A4（经济运营）→ A5（军事防御）的第一个真正桥梁：
 *
 *   Remote Mining → Threat Assessment → Remote Defense Decision
 *     → CONTINUE / PAUSE / ESCORT / RETREAT / ABORT
 *       → Military Intent → Spawn / Logistics
 *
 * 权责边界（A4 体系不可绕过）：
 * - 本函数是纯函数，只输出决策，不执行任何动作
 * - ESCORT 的 escortDemand 是需求标记，不触发 spawn
 * - RETREAT/ABORT 只输出决策，由 remote-mining-manager 修改 op.state
 * - 实际 spawn 走 evaluateRemoteDemand → spawnQueue → spawn-manager
 * - remote-mining-manager 不得因 ESCORT 决策而自行 submitRequest
 *
 * 决策规则（非纯 switch，需综合 EV）：
 *
 * 1. ABORT: 威胁 CRITICAL 且净价值为负 且 替换成本 > 帝国储备 20%
 *    → 长期不可维持，放弃车道
 *
 * 2. RETREAT: 威胁 HIGH/CRITICAL 且 净价值为负
 *    → 撤退远矿 creep，车道暂停
 *    → 撤退成本 = creep 返程风险（如果能安全返回）
 *
 * 3. ESCORT: 威胁 MEDIUM/HIGH 且 护航后净价值为正
 *    → 派 duo 轻队护航，走防御预算
 *    → 输出 escortDemand（不直接 spawn）
 *
 * 4. PAUSE: 威胁 LOW/MEDIUM 且 净价值为正但风险较高
 *    → 暂停生产 N tick 后恢复（保留 op）
 *
 * 5. CONTINUE: 威胁 NONE/LOW 且 净价值为正
 *    → 正常运营
 */
export function decideRemoteDefenseAction(input: RemoteDefenseInput): RemoteDefenseDecision {
  const { threat, remoteOp, empireContext, militaryContext, terrainContext } = input;
  const ev = evaluateRemoteExpectedValue(input);

  const rejected: { action: RemoteDefenseAction; reason: string }[] = [];

  // A5.2: TerrainContext 影响 — retreatQuality 调整撤退安全性判定
  // POOR/CRITICAL retreat → 撤退更危险，可能需要 ESCORT 而非 RETREAT
  // VERY_GOOD/GOOD retreat → 撤退更安全，更倾向 RETREAT
  const retreatQuality = terrainContext?.retreatQuality ?? "UNKNOWN";
  const terrainRetreatBonus = retreatQuality === "VERY_GOOD" ? 1
    : retreatQuality === "GOOD" ? 0
      : retreatQuality === "POOR" ? -1
        : retreatQuality === "CRITICAL" ? -2
          : 0; // UNKNOWN
  // 撤退路径有效距离 = pathCost + terrainRetreatBonus（越好越短）
  const effectivePathCost = Math.max(0, (remoteOp.pathCost ?? 1) - terrainRetreatBonus);

  // 威胁 NONE → CONTINUE
  if (threat.level === "NONE") {
    return {
      action: "CONTINUE",
      reason: `威胁NONE，正常运营(value=${ev.operationValue}/tick)`,
      expectedValue: ev,
      rejectedAlternatives: rejected,
    };
  }

  // 战争姿态下远矿优先级降低——HIGH 以上直接 RETREAT
  if (empireContext.posture === "war" && threat.level === "HIGH") {
    rejected.push({ action: "ESCORT", reason: "war姿态下远矿优先级降低，不护航" });
    rejected.push({ action: "CONTINUE", reason: "战争期间减少远矿风险暴露" });
    return {
      action: "RETREAT",
      reason: `war姿态 + 威胁HIGH → 撤退远矿(投资=${remoteOp.creepInvestment})`,
      expectedValue: ev,
      rejectedAlternatives: rejected,
    };
  }

  // CRITICAL + 净价值为负 + 替换成本高 → ABORT
  const replacementCostRatio = empireContext.empireEnergyReserve > 0
    ? remoteOp.creepInvestment / empireContext.empireEnergyReserve
    : 1;
  if (threat.level === "CRITICAL" && ev.netValue < 0 && replacementCostRatio > 0.2) {
    rejected.push({ action: "RETREAT", reason: `CRITICAL + 净价值${ev.netValue}<0 + 替换成本占比${replacementCostRatio.toFixed(2)}>0.2` });
    rejected.push({ action: "ESCORT", reason: "CRITICAL 威胁下护航不足以保证安全" });
    rejected.push({ action: "CONTINUE", reason: "CRITICAL 威胁下继续运营等于送兵" });
    return {
      action: "ABORT",
      reason: `CRITICAL + netValue=${ev.netValue} + 替换成本占比=${replacementCostRatio.toFixed(2)} → 长期不可维持`,
      expectedValue: ev,
      rejectedAlternatives: rejected,
    };
  }

  // HIGH/CRITICAL + 净价值为负 → RETREAT
  if ((threat.level === "HIGH" || threat.level === "CRITICAL") && ev.netValue < 0) {
    // 检查撤退安全性：如果 creep 距离太远可能无法安全返回
    // A5.2: TerrainContext.retreatQuality 影响撤退安全性
    const canRetreatSafely = effectivePathCost <= 3; // 3 房以内可安全返回
    if (canRetreatSafely) {
      rejected.push({ action: "ESCORT", reason: `净价值${ev.netValue}<0，护航不划算` });
      rejected.push({ action: "CONTINUE", reason: `威胁${threat.level}继续运营风险过高` });
      return {
        action: "RETREAT",
        reason: `威胁${threat.level} + netValue=${ev.netValue} < 0 → 撤退(pathCost=${remoteOp.pathCost ?? "?"})`,
        expectedValue: ev,
        rejectedAlternatives: rejected,
      };
    } else {
      // 距离太远无法安全返回 → ABORT
      // A5.2: 但如果 retreatQuality 好，可能仍然可以撤退
      if (retreatQuality === "VERY_GOOD" || retreatQuality === "GOOD") {
        rejected.push({ action: "ABORT", reason: `retreatQuality=${retreatQuality}，仍有安全撤退可能` });
        rejected.push({ action: "CONTINUE", reason: `威胁${threat.level}继续运营风险过高` });
        return {
          action: "RETREAT",
          reason: `威胁${threat.level} + pathCost=${remoteOp.pathCost}但retreatQuality=${retreatQuality} → 仍可安全撤退`,
          expectedValue: ev,
          rejectedAlternatives: rejected,
        };
      }
      rejected.push({ action: "RETREAT", reason: `pathCost=${remoteOp.pathCost} > 3，无法安全撤退` });
      return {
        action: "ABORT",
        reason: `威胁${threat.level} + 距离过远(pathCost=${remoteOp.pathCost}) → 撤退不安全，放弃`,
        expectedValue: ev,
        rejectedAlternatives: rejected,
      };
    }
  }

  // LOW/MEDIUM + 风险较高 → PAUSE（先于 ESCORT 判断：低威胁不应直接派 defender）
  if ((threat.level === "LOW" || threat.level === "MEDIUM") && ev.risk > 0.15) {
    rejected.push({ action: "CONTINUE", reason: `风险${ev.risk}>0.15，继续运营可能损失creep` });
    rejected.push({ action: "ESCORT", reason: `威胁${threat.level}未达护航阈值，暂停优于派兵` });
    return {
      action: "PAUSE",
      reason: `威胁${threat.level} + 风险=${ev.risk.toFixed(2)} → 暂停生产${ev.expectedDuration}tick后恢复`,
      expectedValue: ev,
      rejectedAlternatives: rejected,
    };
  }

  // MEDIUM/HIGH + 护航后净价值为正 → ESCORT
  if (threat.level === "MEDIUM" || threat.level === "HIGH") {
    // 护航后净价值 = (运营价值 × 持续时间 - 护航成本) × (1 - 风险 × 0.3)
    const escortedNetValue = Math.round(
      (ev.operationValue * ev.expectedDuration - ev.escortCost) * (1 - ev.risk * 0.3),
    );
    if (escortedNetValue > 0 && !militaryContext.atWar) {
      // 需要的 defender 数量：基于威胁级别
      const escortCount = threat.level === "HIGH" ? 2 : 1;
      rejected.push({ action: "CONTINUE", reason: `威胁${threat.level}无护航风险过高` });
      rejected.push({ action: "PAUSE", reason: `护航后净价值${escortedNetValue}>0，护航优于暂停` });
      return {
        action: "ESCORT",
        reason: `威胁${threat.level} + 护航后净价值=${escortedNetValue} > 0 → 派${escortCount}defender护航`,
        expectedValue: { ...ev, netValue: escortedNetValue },
        escortDemand: {
          count: escortCount,
          cost: militaryContext.defenderSpawnCost * escortCount,
          commuteTicks: militaryContext.defenderCommuteTicks,
        },
        rejectedAlternatives: rejected,
      };
    } else if (escortedNetValue <= 0) {
      rejected.push({ action: "ESCORT", reason: `护航后净价值${escortedNetValue}≤0` });
    }
  }

  // 默认 CONTINUE
  rejected.push({ action: "PAUSE", reason: `风险${ev.risk.toFixed(2)}≤0.15，无需暂停` });
  rejected.push({ action: "ESCORT", reason: `威胁${threat.level}未达护航阈值` });
  return {
    action: "CONTINUE",
    reason: `威胁${threat.level} + 风险=${ev.risk.toFixed(2)} + netValue=${ev.netValue} → 继续运营`,
    expectedValue: ev,
    rejectedAlternatives: rejected,
  };
}
