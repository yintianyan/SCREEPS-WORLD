/** Threat Assessment */

import {
  evaluateCombatCapability,
  aggregateCombatCapability,
  computeCombatPower,
  type CreepSnapshot,
  type CombatCapability,
  type CombatPower,
} from "../combat/capability";
import type { TerrainContext } from "./terrain-context";
import type { PlayerIntelRecord } from "./player-intel";
import type { MultiDimensionalConfidence } from "./confidence";
import {
  computeFactConfidence,
  computeCombatConfidence,
  computeIntentConfidence,
  computeTerrainConfidence,
  computeIntelConfidence,
  aggregateConfidence,
  toThreatConfidence,
} from "./confidence";

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

/** 威胁来源类型。 */
export type ThreatSource = "npc_invader" | "source_keeper" | "player";

/** 威胁意图（A5.0 THREAT_MODEL.md §3.1）。 */
export type ThreatIntent =
  | "UNKNOWN"
  | "SCOUTING"
  | "HARASSMENT"
  | "REMOTE_MINING_ATTACK"
  | "SIEGE"
  | "CONTROLLER_ATTACK"
  | "ECONOMIC_ATTACK"
  | "CLAIM"
  | "FULL_ASSAULT"
  | "NUCLEAR";

/** 威胁级别（五级，非简单 hostile count）。 */
export type ThreatLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** 置信度等级（A5.0 INTELLIGENCE_ARCHITECTURE 硬门槛）。 */
export type ThreatConfidence = "fact" | "stale" | "inferred" | "unknown";

/** 推荐防御姿态。 */
export type RecommendedPosture = "NORMAL" | "WATCH" | "ALERT" | "FORTIFY" | "EMERGENCY";

/** 最小 HostileSnapshot——不持有 Creep 对象。 */
export interface HostileSnapshot {
  id: string;
  owner: string;
  /** packed position (x*50+y)。 */
  pos: number;
  body: readonly {
    type: BodyPartConstant;
    boost?: string;
    damaged?: boolean;
  }[];
  hits: number;
  hitsMax: number;
  ticksToLive?: number;
  room: string;
}

/** 房间上下文快照。 */
export interface RoomContext {
  roomName: string;
  /** 核心锚点 packed pos（spawn 或 controller）。 */
  corePos: number;
  /** 塔数量。 */
  towerCount: number;
  /** 塔总能量。 */
  towerEnergyTotal: number;
  /** rampart 覆盖率（0-1）。 */
  rampartCoverage: number;
  /** controller 等级。 */
  rcl: number;
  /** safe mode 可用次数。 */
  safeModeAvailable: number;
  /** safe mode 剩余 tick。 */
  safeModeTicks?: number;
  /** 是否有 storage。 */
  hasStorage: boolean;
  /** 是否有 spawn。 */
  hasSpawn: boolean;
  /** 房间内我方 creep 数量。 */
  friendlyCreepCount: number;
  /** source 数量。 */
  sourceCount: number;
  /** 是否是远矿房。 */
  isRemoteRoom: boolean;
  /** nuke 落点数量（本房视野内）。 */
  incomingNukes: number;
}

/** 防御上下文快照。 */
export interface DefenseContext {
  /** 当前 colonyState。 */
  colonyState: string;
  /** 最近受袭 tick。 */
  lastHostileAt?: number;
  /** 上一 tick 威胁数量。 */
  prevThreatCount: number;
}

/** 玩家情报摘要。 */
export interface PlayerIntelSummary {
  username: string;
  /** 威胁指数（0-100）。 */
  threatIndex: number;
  /** 黑名单标记。 */
  blacklist: boolean;
  /** 最后活动房。 */
  lastActiveRoom?: string;
  /** 到我方核心房的线性距离。 */
  nemesisDistance?: number;
}

/** 远矿上下文（可选，仅远矿房提供）。 */
export interface RemoteContext {
  /** 远矿 home 房。 */
  homeRoom: string;
  /** 远矿目标房。 */
  targetRoom: string;
  /** 远矿 creep 数量。 */
  remoteCreepCount: number;
  /** 远矿经济价值（energy/tick）。 */
  incomePerTick: number;
}

/** assessThreat 的完整输入。 */
export interface ThreatAssessmentInput {
  tick: number;
  hostiles: readonly HostileSnapshot[];
  roomContext: RoomContext;
  defenseContext: DefenseContext;
  /** A5.1 兼容：旧的 PlayerIntel Map（向后兼容）。 */
  playerIntel?: Map<string, PlayerIntelSummary>;
  /** A5.2：升级后的 PlayerIntelRecord（优先使用）。 */
  playerIntelRecord?: PlayerIntelRecord;
  remoteContext?: RemoteContext;
  /** A5.2：地形上下文（可选，无则 terrainConfidence=0.3）。 */
  terrainContext?: TerrainContext;
}

// ═══════════════════════════════════════════════════════════
// §2. ThreatAssessment 输出
// ═══════════════════════════════════════════════════════════

/** 意图推断结果（含置信度和证据）。 */
export interface IntentAssessment {
  intent: ThreatIntent;
  /** 置信度（0-1，不是确定事实）。 */
  confidence: number;
  /** 推断证据链（可追溯）。 */
  evidence: string[];
}

/** 威胁评分来源拆解（可解释，非黑盒数字）。 */
export interface ThreatScoreBreakdown {
  /** 战斗力维度得分。 */
  combat: number;
  /** 意图维度得分。 */
  intent: number;
  /** 接近度维度得分。 */
  proximity: number;
  /** 目标维度得分。 */
  objective: number;
  /** Boost 维度得分。 */
  boost: number;
  /** 防御覆盖维度得分。 */
  defense: number;
  /** 经济影响维度得分。 */
  economicImpact: number;
  /** 总分。 */
  total: number;
}

/** 完整威胁评估结果。 */
export interface ThreatAssessment {
  level: ThreatLevel;
  /** 可拆解的评分。 */
  score: ThreatScoreBreakdown;
  /** 评估置信度（A5.1 兼容字段）。 */
  confidence: ThreatConfidence;
  /** A5.2：多维度置信度（不压缩为单一数字）。 */
  multiConfidence?: MultiDimensionalConfidence;
  /** 估计的敌方战力。 */
  estimatedPower: {
    attack: number;
    rangedAttack: number;
    heal: number;
    effectiveHP: number;
    dismantle: number;
    toughParts: number;
    boosted: boolean;
    maxBoostTier: 0 | 1 | 2 | 3;
  };
  /** 估计的敌方编队战力（聚合）。 */
  enemyCombatPower: CombatPower;
  /** 意图推断。 */
  estimatedIntent: IntentAssessment;
  /** 预计到达核心区 tick 数。 */
  timeToImpact: number;
  /** 威胁来源。 */
  sources: ThreatSource[];
  /** 推荐姿态。 */
  recommendedPosture: RecommendedPosture;
  /** A5.2：地形上下文证据（用于 DecisionTrace）。 */
  terrainEvidence?: {
    terrainType: string;
    retreatQuality: string;
    mobilityModifier: number;
    towerCoverage: string;
  };
  /** A5.2：情报证据（用于 DecisionTrace）。 */
  intelEvidence?: {
    hasIntel: boolean;
    aggregatedConfidence: string;
    threatIndex: number;
    hasConflict: boolean;
    evidenceCount: number;
  };
  /** 评估 tick。 */
  tick: number;
}

// ═══════════════════════════════════════════════════════════
// §3. 辅助函数
// ═══════════════════════════════════════════════════════════

/** 判断 hostile 是否为 NPC。 */
function isNpc(owner: string): boolean {
  return owner === "Invader" || owner === "Source Keeper";
}

/** 判断 hostile 是否为 Source Keeper。 */
function isSourceKeeper(owner: string): boolean {
  return owner === "Source Keeper";
}

/** 从 packed pos 解包坐标。 */
function unpackPos(packed: number): { x: number; y: number } {
  return { x: Math.floor(packed / 50), y: packed % 50 };
}

/** 切比雪夫距离（Screeps 使用的距离公式）。 */
function chebyshevDistance(pos1: number, pos2: number): number {
  const a = unpackPos(pos1);
  const b = unpackPos(pos2);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 将 HostileSnapshot 转为 CreepSnapshot（G2 输入格式）。 */
function toCreepSnapshot(h: HostileSnapshot): CreepSnapshot {
  return {
    id: h.id,
    owner: h.owner,
    body: h.body,
    hits: h.hits,
    hitsMax: h.hitsMax,
    ticksToLive: h.ticksToLive,
    room: h.room,
    pos: h.pos,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Body 分析（复用 G2，不写第二套算法）
// ═══════════════════════════════════════════════════════════

/**
 * 分析敌方 body，返回 CombatCapability。
 * 直接调用 G2 的 evaluateCombatCapability——单一 body 解析算法。
 */
export function analyzeHostileBody(hostile: HostileSnapshot): CombatCapability {
  return evaluateCombatCapability(toCreepSnapshot(hostile));
}

// ═══════════════════════════════════════════════════════════
// §5. Intent 推断（纯函数，禁止读 Game/Memory）
// ═══════════════════════════════════════════════════════════

/**
 * 推断威胁意图。

 * 推断链（按优先级从高到低，§3.2 规则）：
 * 1. nuke 落点 → NUCLEAR (fact)
 * 2. claim 部件 → CLAIM (fact)
 * 3. dismantle + 接近 storage → ECONOMIC_ATTACK (fact)
 * 4. heal ≥ 塔净伤 + 房外驻留 → SIEGE (fact + 行为)
 * 5. 大编队(≥4) + boost → FULL_ASSAULT (fact + PlayerIntel)
 * 6. 远矿房 + 武装 → REMOTE_MINING_ATTACK (fact)
 * 7. 接近 controller + claim/attack → CONTROLLER_ATTACK (fact)
 * 8. 1-2 武装 + 攻击外围 → HARASSMENT (fact)
 * 9. 仅 MOVE / 穿过 → SCOUTING (fact)
 * 10. 信息不足 → UNKNOWN

 * confidence 不是确定事实，而是基于证据强度的估计值。
 */
export function inferThreatIntent(
  hostiles: readonly HostileSnapshot[],
  capabilities: readonly CombatCapability[],
  roomContext: RoomContext,
  playerIntel?: Map<string, PlayerIntelSummary>,
): IntentAssessment {
  const evidence: string[] = [];

  // 1. NUCLEAR — 引擎事实
  if (roomContext.incomingNukes > 0) {
    evidence.push(`nuke落点=${roomContext.incomingNukes}`);
    return { intent: "NUCLEAR", confidence: 1.0, evidence };
  }

  // 无威胁单位
  if (hostiles.length === 0) {
    return { intent: "UNKNOWN", confidence: 0, evidence: ["无可见敌方单位"] };
  }

  // 聚合能力
  const agg = aggregateCombatCapability(capabilities);

  // 2. CLAIM — claim 部件可见
  if (agg.totalClaim > 0) {
    // 区分 CLAIM vs CONTROLLER_ATTACK：接近 controller 才是 CONTROLLER_ATTACK
    const controllerPos = roomContext.corePos; // 简化：用 corePos 近似
    let nearController = false;
    for (const h of hostiles) {
      if (chebyshevDistance(h.pos, controllerPos) <= 5) {
        nearController = true;
        break;
      }
    }
    if (nearController) {
      evidence.push(`claim部件=${agg.totalClaim} + 接近controller`);
      return { intent: "CONTROLLER_ATTACK", confidence: 0.9, evidence };
    }
    evidence.push(`claim部件=${agg.totalClaim} + 不接近controller`);
    return { intent: "CLAIM", confidence: 0.85, evidence };
  }

  // 3. ECONOMIC_ATTACK — dismantle + 接近 storage
  if (agg.totalDismantle > 0 && roomContext.hasStorage) {
    evidence.push(`dismantle=${agg.totalDismantle} + storage存在`);
    // 如果 dismantle 部件多且接近核心区
    if (agg.totalDismantle >= 100) { // ≥2 WORK parts
      return { intent: "ECONOMIC_ATTACK", confidence: 0.8, evidence };
    }
  }

  // 4. SIEGE — heal ≥ 塔净伤 + 不突入
  // 塔净伤估计：每塔 600 × towerCount（满伤），但考虑衰减取保守值
  // 仅在有塔时检查 SIEGE（无塔时 heal ≥ 0 恒真，会误判所有带 HEAL 的 creep 为 SIEGE）
  const towerNetDamage = roomContext.towerCount > 0
    ? roomContext.towerCount * 600 * 0.5
    : -1; // -1 确保 heal ≥ -1 不触发 SIEGE
  if (agg.totalHeal >= towerNetDamage && hostiles.length >= 1 && roomContext.towerCount > 0) {
    // 检查是否在核心区外（SIEGE 通常在房边缘游走）
    let allOutside = true;
    for (const h of hostiles) {
      if (chebyshevDistance(h.pos, roomContext.corePos) <= 10) {
        allOutside = false;
        break;
      }
    }
    if (allOutside) {
      evidence.push(`heal=${agg.totalHeal} ≥ 塔净伤估计=${towerNetDamage} + 核心区外驻留`);
      return { intent: "SIEGE", confidence: 0.75, evidence };
    }
  }

  // 5. FULL_ASSAULT — 大编队 + boost
  if (hostiles.length >= 4 && agg.maxBoostTier >= 2) {
    evidence.push(`编队=${hostiles.length} ≥ 4 + boost=T${agg.maxBoostTier}`);
    // PlayerIntel 增强置信度
    const playerHostiles = hostiles.filter(h => !isNpc(h.owner));
    if (playerHostiles.length > 0 && playerIntel) {
      const intel = playerIntel.get(playerHostiles[0]!.owner);
      if (intel) {
        evidence.push(`PlayerIntel: ${intel.username} threatIndex=${intel.threatIndex}`);
        return { intent: "FULL_ASSAULT", confidence: 0.9, evidence };
      }
    }
    return { intent: "FULL_ASSAULT", confidence: 0.7, evidence };
  }

  // 6. REMOTE_MINING_ATTACK — 远矿房 + 武装
  if (roomContext.isRemoteRoom && (agg.totalAttack > 0 || agg.totalRangedAttack > 0)) {
    evidence.push(`远矿房 + attack=${agg.totalAttack} ranged=${agg.totalRangedAttack}`);
    return { intent: "REMOTE_MINING_ATTACK", confidence: 0.85, evidence };
  }

  // 7. CONTROLLER_ATTACK — 接近 controller + attack 部件（无 claim 的变种）
  if (agg.totalAttack > 0) {
    let nearCore = false;
    for (const h of hostiles) {
      if (chebyshevDistance(h.pos, roomContext.corePos) <= 5) {
        nearCore = true;
        break;
      }
    }
    if (nearCore && roomContext.rcl > 0) {
      evidence.push(`attack=${agg.totalAttack} + 接近controller(rcl=${roomContext.rcl})`);
      return { intent: "CONTROLLER_ATTACK", confidence: 0.65, evidence };
    }
  }

  // 8. HARASSMENT — 1-2 武装 + 攻击外围
  if (hostiles.length <= 2 && (agg.totalAttack > 0 || agg.totalRangedAttack > 0)) {
    evidence.push(`1-2武装(attack=${agg.totalAttack} ranged=${agg.totalRangedAttack})`);
    return { intent: "HARASSMENT", confidence: 0.7, evidence };
  }

  // 9. SCOUTING — 仅 MOVE / 无战斗部件
  const hasCombatParts = agg.totalAttack > 0 || agg.totalRangedAttack > 0 ||
    agg.totalHeal > 0 || agg.totalDismantle > 0 || agg.totalClaim > 0;
  if (!hasCombatParts) {
    evidence.push(`无战斗部件(totalParts=${agg.creepCount > 0 ? hostiles.length : 0})`);
    return { intent: "SCOUTING", confidence: 0.9, evidence };
  }

  // 10. UNKNOWN — 信息不足
  evidence.push(`信息不足(hostiles=${hostiles.length} combat=${agg.totalAttack + agg.totalRangedAttack})`);
  return { intent: "UNKNOWN", confidence: 0.3, evidence };
}

// ═══════════════════════════════════════════════════════════
// §6. 威胁分级 + 评分
// ═══════════════════════════════════════════════════════════

/**
 * 综合威胁评分——可拆解，非黑盒。

 * 这不是「hostile count + boost ? 20 : 0 + attackParts * 5」的复杂版。
 * 每个维度都有独立的语义和证据支撑，消费者应优先看维度拆解而非 total。

 * 各维度语义：
 * - combat: 敌方战力估计（基于 G2 CombatCapability 聚合，含 boost/HP/heal）
 *   ⚠ 这是多维度压缩值，消费者应同时检查 estimatedPower 各字段
 * - intent: 意图危险度（基于 G1 inferThreatIntent 推断，非 hostile count）
 * - proximity: 接近核心区的程度（基于位置距离，非简单 in-room 布尔）
 * - objective: 目标价值（controller/storage/source 存在性加权）
 * - boost: boost 等级（T1-T3 × boostedCount，反映军备竞赛投入）
 * - defense: 我方防御覆盖（反向——防御强则威胁分降低）
 * - economicImpact: 经济影响（远矿房损失 vs 自有房风险）

 * total 是加权求和，用于快速分级，不能替代各维度精细判断。
 */
function computeThreatScore(
  hostiles: readonly HostileSnapshot[],
  capabilities: readonly CombatCapability[],
  intent: IntentAssessment,
  roomContext: RoomContext,
  remoteContext?: RemoteContext,
): ThreatScoreBreakdown {
  const agg = aggregateCombatCapability(capabilities);

  // combat 维度：总战力归一化
  const combatRaw = agg.totalAttack + agg.totalRangedAttack + agg.totalHeal * 0.5 +
    agg.totalEffectiveHP * 0.01 + agg.totalDismantle * 0.3;
  const combat = Math.min(combatRaw / 10, 100); // 归一化到 0-100

  // intent 维度：按意图危险度映射
  const intentScores: Record<ThreatIntent, number> = {
    UNKNOWN: 10,
    SCOUTING: 5,
    HARASSMENT: 25,
    REMOTE_MINING_ATTACK: 30,
    SIEGE: 60,
    CONTROLLER_ATTACK: 70,
    ECONOMIC_ATTACK: 65,
    CLAIM: 75,
    FULL_ASSAULT: 90,
    NUCLEAR: 100,
  };
  const intentScore = intentScores[intent.intent] * intent.confidence;

  // proximity 维度：最近敌方到核心区的距离
  let minDistance = Infinity;
  for (const h of hostiles) {
    const dist = chebyshevDistance(h.pos, roomContext.corePos);
    if (dist < minDistance) minDistance = dist;
  }
  // 距离越近分数越高：dist=0 → 100, dist=50 → 0
  const proximity = hostiles.length > 0
    ? Math.max(0, 100 - minDistance * 2)
    : 0;

  // objective 维度：目标价值
  let objective = 0;
  if (roomContext.rcl > 0) objective += 30; // 有 controller 的自有房
  if (roomContext.hasStorage) objective += 20;
  if (roomContext.hasSpawn) objective += 15;
  if (roomContext.towerCount > 0) objective += 10;
  if (roomContext.isRemoteRoom) objective = 20; // 远矿房目标价值较低
  objective = Math.min(objective, 100);

  // boost 维度
  const boost = agg.maxBoostTier > 0
    ? agg.maxBoostTier * 20 + (agg.boostedCount > 1 ? 10 : 0)
    : 0;

  // defense 维度（反向）：我方防御越强威胁越低
  const defenseRaw = roomContext.towerCount * 15 +
    roomContext.rampartCoverage * 30 +
    (roomContext.safeModeAvailable > 0 ? 10 : 0);
  const defense = Math.min(defenseRaw, 100); // 越高威胁分越低

  // economicImpact 维度
  let economicImpact = 30; // 默认
  if (remoteContext) {
    economicImpact = Math.min(remoteContext.incomePerTick * 10, 50);
  } else if (roomContext.rcl >= 7) {
    economicImpact = 80; // 高 RCL 房损失大
  } else if (roomContext.rcl >= 4) {
    economicImpact = 50;
  }

  // 总分 = 各维度加权（defense 是减项）
  const total = Math.max(0, Math.min(100,
    combat * 0.25 +
    intentScore * 0.30 +
    proximity * 0.15 +
    objective * 0.10 +
    boost * 0.10 +
    economicImpact * 0.10 -
    defense * 0.20,
  ));

  return {
    combat: Math.round(combat * 10) / 10,
    intent: Math.round(intentScore * 10) / 10,
    proximity: Math.round(proximity * 10) / 10,
    objective: Math.round(objective * 10) / 10,
    boost: Math.round(boost * 10) / 10,
    defense: Math.round(defense * 10) / 10,
    economicImpact: Math.round(economicImpact * 10) / 10,
    total: Math.round(total * 10) / 10,
  };
}

/** 从评分映射到威胁级别。 */
function scoreToLevel(score: number): ThreatLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  if (score >= 10) return "LOW";
  return "NONE";
}

/** 从级别映射到推荐姿态。 */
function levelToPosture(level: ThreatLevel, intent: ThreatIntent): RecommendedPosture {
  // NUCLEAR intent 直接 EMERGENCY
  if (intent === "NUCLEAR") return "EMERGENCY";
  switch (level) {
    case "NONE": return "NORMAL";
    case "LOW": return "WATCH";
    case "MEDIUM": return "ALERT";
    case "HIGH": return "FORTIFY";
    case "CRITICAL": return "EMERGENCY";
  }
}

// ═══════════════════════════════════════════════════════════
// §7. 主函数 assessThreat
// ═══════════════════════════════════════════════════════════

/**
 * 综合评估房间威胁。

 * A5.2 链路：
 *   HostileSnapshot → CombatCapability → TerrainContext → PlayerIntel
 *   → ThreatIntent → ThreatScore → Confidence → ThreatAssessment

 * 算法：
 * 1. 将 HostileSnapshot → CreepSnapshot → evaluateCombatCapability（G2）
 * 2. 聚合编队战力 computeCombatPower
 * 3. 推断意图 inferThreatIntent（消费 PlayerIntel 作为 Evidence，不直接提升 Level）
 * 4. 计算可拆解评分 computeThreatScore
 * 5. 映射级别 + 推荐姿态
 * 6. 估计 timeToImpact（TerrainContext.mobilityModifier 影响）
 * 7. A5.2：计算多维度置信度（fact/combat/intent/terrain/intel → overall）

 * 向后兼容：terrainContext / playerIntelRecord 为可选参数，不传时
 * terrainConfidence=0.3, intelConfidence=0.0，不影响 A5.1 行为。

 * 复杂度：O(hostiles.length × body.length)，hostiles 通常 ≤ 20，body ≤ 50。
 */
export function assessThreat(input: ThreatAssessmentInput): ThreatAssessment {
  const { tick, hostiles, roomContext, defenseContext, playerIntel, playerIntelRecord, remoteContext, terrainContext } = input;

  // 无敌方单位 — 仍需检查 nuke 落点（引擎事实，不依赖 hostile 可见性）
  if (hostiles.length === 0) {
    if (roomContext.incomingNukes > 0) {
      const mc = aggregateConfidence(1.0, 1.0, 1.0, 0.3, 0.0);
      return {
        level: "CRITICAL",
        score: {
          combat: 0, intent: 100, proximity: 0, objective: 0,
          boost: 0, defense: 0, economicImpact: 0, total: 100,
        },
        confidence: "fact",
        multiConfidence: mc,
        estimatedPower: {
          attack: 0, rangedAttack: 0, heal: 0, effectiveHP: 0,
          dismantle: 0, toughParts: 0, boosted: false, maxBoostTier: 0,
        },
        enemyCombatPower: computeCombatPower([]),
        estimatedIntent: { intent: "NUCLEAR", confidence: 1.0, evidence: [`nuke落点=${roomContext.incomingNukes}`] },
        timeToImpact: Infinity,
        sources: [],
        recommendedPosture: "EMERGENCY",
        tick,
      };
    }
    const mc0 = aggregateConfidence(1.0, 1.0, 0.0, 0.3, 0.0);
    return {
      level: "NONE",
      score: {
        combat: 0, intent: 0, proximity: 0, objective: 0,
        boost: 0, defense: 0, economicImpact: 0, total: 0,
      },
      confidence: "fact",
      multiConfidence: mc0,
      estimatedPower: {
        attack: 0, rangedAttack: 0, heal: 0, effectiveHP: 0,
        dismantle: 0, toughParts: 0, boosted: false, maxBoostTier: 0,
      },
      enemyCombatPower: computeCombatPower([]),
      estimatedIntent: { intent: "UNKNOWN", confidence: 0, evidence: ["无可见敌方单位"] },
      timeToImpact: Infinity,
      sources: [],
      recommendedPosture: "NORMAL",
      tick,
    };
  }

  // 1. Body 分析（复用 G2）
  const capabilities = hostiles.map(h => analyzeHostileBody(h));

  // 2. 编队聚合
  // A5.2: TerrainContext 不修改 CombatCapability（G2 不变），
  // 只通过 EffectiveCombatModifier 影响 timeToImpact 等派生量。
  const enemyPower = computeCombatPower(capabilities, {
    towerCoverage: roomContext.towerCount > 0
      ? Math.min(roomContext.towerEnergyTotal / (roomContext.towerCount * 1000), 1)
      : 0,
    terrain: "plain",
    boosted: capabilities.some(c => c.boosted),
  });

  // 3. 意图推断
  // A5.2: PlayerIntel 只作为 Intent Evidence，不直接提升 Threat Level。
  const intentAssessment = inferThreatIntent(hostiles, capabilities, roomContext, playerIntel);

  // 4. 评分
  const score = computeThreatScore(hostiles, capabilities, intentAssessment, roomContext, remoteContext);

  // 5. 级别 + 姿态
  const level = scoreToLevel(score.total);
  const recommendedPosture = levelToPosture(level, intentAssessment.intent);

  // 6. A5.2 多维度置信度计算
  const allBodiesVisible = hostiles.every(h => h.body.length > 0);
  const allBoostsIdentified = capabilities.every(c =>
    !c.boosted || c.maxBoostTier > 0,
  );

  const factConfidence = computeFactConfidence(
    roomContext.incomingNukes > 0,
    allBodiesVisible,
    hostiles.length,
  );
  const combatConfidence = computeCombatConfidence(allBodiesVisible, allBoostsIdentified);
  const intentConfidence = computeIntentConfidence(intentAssessment.confidence);
  const terrainConfidence = terrainContext
    ? computeTerrainConfidence(terrainContext)
    : 0.3; // 无 TerrainContext 时默认低置信度
  const intelConfidence = computeIntelConfidence(playerIntelRecord);

  const multiConfidence = aggregateConfidence(
    factConfidence,
    combatConfidence,
    intentConfidence,
    terrainConfidence,
    intelConfidence,
  );

  // 向后兼容：将 overallConfidence 映射为 A5.1 的 ThreatConfidence
  const confidence = roomContext.incomingNukes > 0
    ? "fact" as ThreatConfidence
    : toThreatConfidence(multiConfidence.overallConfidence);

  // 7. timeToImpact 估计
  // A5.2: TerrainContext.mobilityModifier 影响移动估计
  let timeToImpact = Infinity;
  const agg = aggregateCombatCapability(capabilities);
  if (hostiles.length > 0 && agg.avgMobility > 0) {
    let minDistance = Infinity;
    for (const h of hostiles) {
      const dist = chebyshevDistance(h.pos, roomContext.corePos);
      if (dist < minDistance) minDistance = dist;
    }
    // mobility=1 时平原 1 tick/步，mobility=0.5 时 2 tick/步
    // A5.2: TerrainContext.mobilityModifier 调整移动速度
    const terrainMobilityMod = terrainContext?.mobilityModifier ?? 1.0;
    const effectiveMobility = agg.avgMobility * terrainMobilityMod;
    // timeToImpact ≈ distance / (effectiveMobility × 0.5)（保守估计）
    timeToImpact = Math.ceil(minDistance / Math.max(effectiveMobility * 0.5, 0.1));
  }

  // 8. 威胁来源
  const sources: ThreatSource[] = [];
  for (const h of hostiles) {
    if (isSourceKeeper(h.owner)) {
      if (!sources.includes("source_keeper")) sources.push("source_keeper");
    } else if (isNpc(h.owner)) {
      if (!sources.includes("npc_invader")) sources.push("npc_invader");
    } else {
      if (!sources.includes("player")) sources.push("player");
    }
  }

  // 9. A5.2: 构建 terrainEvidence 和 intelEvidence（用于 DecisionTrace）
  const terrainEvidence = terrainContext
    ? {
        terrainType: terrainContext.terrainType,
        retreatQuality: terrainContext.retreatQuality,
        mobilityModifier: terrainContext.mobilityModifier,
        towerCoverage: terrainContext.towerCoverage,
      }
    : undefined;

  const intelEvidence = playerIntelRecord
    ? {
        hasIntel: true,
        aggregatedConfidence: playerIntelRecord.aggregatedConfidence,
        threatIndex: playerIntelRecord.threatIndex,
        hasConflict: playerIntelRecord.hasConflict,
        evidenceCount: playerIntelRecord.evidence.length,
      }
    : undefined;

  return {
    level,
    score,
    confidence,
    multiConfidence,
    estimatedPower: {
      attack: agg.totalAttack,
      rangedAttack: agg.totalRangedAttack,
      heal: agg.totalHeal,
      effectiveHP: agg.totalEffectiveHP,
      dismantle: agg.totalDismantle,
      toughParts: agg.totalToughParts,
      boosted: agg.maxBoostTier > 0,
      maxBoostTier: agg.maxBoostTier,
    },
    enemyCombatPower: enemyPower,
    estimatedIntent: intentAssessment,
    timeToImpact,
    sources,
    recommendedPosture,
    terrainEvidence,
    intelEvidence,
    tick,
  };
}
