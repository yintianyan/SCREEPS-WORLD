/**
 * Expansion Candidate Model (v2) — A3.2 Phase 1：候选房间模型。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §1.2 七因子评分输入。
 *
 * 替代 evaluator.ts 中仅 4 字段的 ExpansionCandidate。本模型携带 14+ 字段 +
 * lifecycle status，支撑 Candidate Discovery / Scoring / Ranking / Plan 全链。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { RoomIntel, RoomKind } from "../intel";

/** 候选房生命周期状态。 */
export type CandidateStatus =
  | "UNKNOWN"        // 仅从房名分类推断，无视野
  | "DISCOVERED"     // 有过视野，Intel 已采集
  | "EVALUATED"      // 已完成七因子评分
  | "QUALIFIED"     // 评分 ≥ 阈值，进入候选池
  | "REJECTED"       // 评分 < 阈值 或 硬否决
  | "BLACKLISTED";   // 失败冷却中

/** 四类扩张动机（EXPANSION_ARCHITECTURE §1.1）。 */
export type ExpansionReason =
  | "resource"      // 资源产能
  | "gcl"           // GCL 复利
  | "strategic"     // 战略位置
  | "resilience";   // 避险分散

/** 候选房地形摘要（从 Intel 派生）。 */
export interface TerrainSummary {
  /** 出口方向数（1-4，越少越易守）。 */
  exitCount: number;
  /** 封死的出口方向数。 */
  sealedExitCount: number;
  /** 人工墙数（0 = 无前任工事）。 */
  wallCount: number;
}

/** 候选房控制器信息。 */
export interface ControllerInfo {
  /** 是否有主。 */
  hasOwner: boolean;
  /** 主人名（有主时）。 */
  owner?: string;
  /** 预定者名（有预定时）。 */
  reservedBy?: string;
  /** 是否被己方预定。 */
  isMine: boolean;
  /** 是否被敌方预定。 */
  isHostileReserved: boolean;
}

/**
 * Expansion Candidate (v2) — 完整候选房模型。
 */
export interface ExpansionCandidateV2 {
  /** 稳定 key = roomName。 */
  roomName: string;
  /** 负责孵化 claimer 与拓荒编队的 sponsor 房。 */
  sponsorRoom: string;
  /** 房间类型（normal/sk/center/highway）。 */
  kind: RoomKind;
  /** 房态（normal/closed/novice/respawn）。 */
  roomStatus: string;
  /** 已知 source 数（undefined = 未侦察）。 */
  sourceCount: number | undefined;
  /** 矿物类型（undefined = 未侦察）。 */
  mineral: string | undefined;
  /** 地形摘要。 */
  terrain: TerrainSummary;
  /** 控制器信息。 */
  controller: ControllerInfo;
  /** 通勤成本（PathFinder pathCost，undefined = 未算）。 */
  pathCost: number | undefined;
  /** 最后观测 tick。 */
  lastSeen: number;
  /** 距最近自有房跳数（1 = 直接邻居）。 */
  distance: number;
  /** 周边邻接房名列表（从 describeExits 派生）。 */
  neighborRooms: string[];
  /** 评分（七因子，EVALUATED 后填充）。 */
  score: number;
  /** 评分明细（各因子值）。 */
  scoreBreakdown?: CandidateScoreBreakdown;
  /** 候选生命周期状态。 */
  status: CandidateStatus;
  /** 候选创建 tick。 */
  discoveredAt: number;
  /** 最近一次评估 tick。 */
  evaluatedAt?: number;
  /** 硬否决原因（有值则不可入选）。 */
  vetoReason?: string;
}

/** 七因子评分明细。 */
export interface CandidateScoreBreakdown {
  sourceValue: number;
  mineralValue: number;
  distanceScore: number;
  neighborSafety: number;
  rivalProximity: number;
  defensibility: number;
  layoutFitness: number;
  /** 加权总分。 */
  total: number;
}

/**
 * 从 RoomIntel + 上下文构建候选房初始模型。
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function buildCandidate(
  roomName: string,
  sponsorRoom: string,
  intel: RoomIntel,
  ownedRoomNames: readonly string[],
  tick: number,
  myUsername?: string,
): ExpansionCandidateV2 {
  const owned = new Set(ownedRoomNames);
  const distance = 1; // 直接邻居 distance=1（多跳由 discovery 层递增）

  // 地形摘要
  const sealedExits = intel.sealedExits ?? [];
  const exitCount = 4 - sealedExits.length; // 简化：4 出口减去封死
  const terrain: TerrainSummary = {
    exitCount: Math.max(0, exitCount),
    sealedExitCount: sealedExits.length,
    wallCount: intel.wallCount ?? 0,
  };

  // 控制器信息
  const hasOwner = intel.owner !== undefined;
  const isMine = intel.owner === myUsername;
  const isHostileReserved = intel.reservedBy !== undefined
    && intel.reservedBy !== myUsername
    && intel.reservedBy !== "Invader";
  const controller: ControllerInfo = {
    hasOwner,
    owner: intel.owner,
    reservedBy: intel.reservedBy,
    isMine,
    isHostileReserved,
  };

  // 硬否决判定
  let vetoReason: string | undefined;
  if (intel.kind !== "normal") vetoReason = `kind=${intel.kind}`;
  else if (intel.status !== "normal") vetoReason = `status=${intel.status}`;
  else if (hasOwner && !isMine) vetoReason = `owner=${intel.owner}`;
  else if (isHostileReserved) vetoReason = `reservedBy=${intel.reservedBy}`;
  else if ((intel.towers ?? 0) > 0) vetoReason = `towers=${intel.towers}`;
  else if ((intel.enemySpawns ?? 0) > 0) vetoReason = `enemySpawns=${intel.enemySpawns}`;
  else if (owned.has(roomName)) vetoReason = "already-owned";

  // 初始状态
  let status: CandidateStatus = "DISCOVERED";
  if (intel.sources === undefined) status = "UNKNOWN";
  if (vetoReason) status = "REJECTED";

  return {
    roomName,
    sponsorRoom,
    kind: intel.kind,
    roomStatus: intel.status,
    sourceCount: intel.sources,
    mineral: intel.mineral,
    terrain,
    controller,
    pathCost: intel.pathCost,
    lastSeen: intel.lastSeen,
    distance,
    neighborRooms: [], // 由 discovery 层填充
    score: 0,
    status,
    discoveredAt: tick,
    vetoReason,
  };
}

/**
 * 检查候选是否可评估（已侦察 + 非否决）。
 */
export function isEvaluable(candidate: ExpansionCandidateV2): boolean {
  return candidate.status === "DISCOVERED"
    && candidate.sourceCount !== undefined
    && !candidate.vetoReason;
}

/**
 * 检查候选是否可入选（已评分 + 合格）。
 */
export function isQualified(candidate: ExpansionCandidateV2): boolean {
  return candidate.status === "QUALIFIED";
}
