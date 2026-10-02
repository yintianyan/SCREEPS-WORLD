/** Expansion Candidate Model (v2) */

import type { RoomIntel, RoomKind } from "../intel";

/** 候选房生命周期状态。 */
export type CandidateStatus =
  | "UNKNOWN" // 仅从房名分类推断，无视野
  | "DISCOVERED" // 有过视野，Intel 已采集
  | "EVALUATED" // 已完成七因子评分
  | "QUALIFIED" // 评分 ≥ 阈值，进入候选池
  | "REJECTED" // 评分 < 阈值 或 硬否决
  | "BLACKLISTED"; // 失败冷却中

/** 四类扩张动机（EXPANSION_ARCHITECTURE §1.1）。 */
export type ExpansionReason =
  | "resource" // 资源产能
  | "gcl" // GCL 复利
  | "strategic" // 战略位置
  | "resilience"; // 避险分散

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

 * 纯函数 — 不访问 Game/Memory。
 */
export function buildCandidate(
  roomName: string,
  sponsorRoom: string,
  intel: RoomIntel,
  ownedRoomNames: readonly string[],
  tick: number,
  myUsername?: string,
  releasedRoomNames?: readonly string[],
): ExpansionCandidateV2 {
  const owned = new Set(ownedRoomNames);
  // 刚主动放弃的房：排除判定不能靠 intel 的 owner 字段 —— unclaim 之后它就是一个
  // 无主、有工事（路/容器/link）的高分候选，评分模型会立刻把它重新排进扩张池。
  const released = new Set(releasedRoomNames ?? []);
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
  const isHostileReserved =
    intel.reservedBy !== undefined &&
    intel.reservedBy !== myUsername &&
    intel.reservedBy !== "Invader";
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
  else if (released.has(roomName)) vetoReason = "recently-released";

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
 * 从重占排除表的候选池里剔掉命中的房。
 *
 * 为什么不能只靠 buildCandidate 的否决：候选只在 Intel 刷新时重建，一间「无主但留着
 * 我们工事」的刚放弃房会顶着旧的 QUALIFIED 状态直接被排进扩张池 —— 而它的评分恰恰因为
 * 那些工事而更高。排除判定必须作用在**候选池**上，而不是只作用在新建候选上。
 */
export function dropReleasedRooms<T extends { roomName: string }>(
  candidates: readonly T[],
  released: Readonly<Record<string, number>> | undefined,
): T[] {
  if (!released || Object.keys(released).length === 0) return [...candidates];
  return candidates.filter(c => released[c.roomName] === undefined);
}

/**
 * 把「已经是我自己的房」从候选池里剔掉。
 *
 * 与 `dropReleasedRooms` 是同一个洞的另一半：候选只在 Intel 刷新时才重建，所以**占领成功之后
 * 那条候选并不会随之失效** —— 它会顶着旧的 `QUALIFIED` 状态一直留在池子里，直到被排进计划生成。
 * 线上实证（2026-10-02 20:5xZ，t=83386099）：`Memory.kernel.expansionCandidates` 里
 * `W38S56 st=QUALIFIED`，而 W38S56 就是我 8.5 小时前claim 下的幼房（`lastExpansionCompletedTick`
 * =83328457 那一笔）——池子满容 10 条，这条白占一格，还把 dashboard 的 `candidateCount`
 * 读成"还有一个合格目标"（明明是我自己的房）。
 * 必须作用在**候选池**上而不是只作用在新建候选上，理由与 `dropReleasedRooms` 完全一样。
 *
 * ⚠️对状态不敏感是刻意的：`QUALIFIED`/`UNKNOWN`/任何状态一律剔 —— 自有房永远不是"待占领目标"，
 * 而旧状态恰恰是这条缺陷的载体。执行期本来也有自有房复检，这里不是补那道闸，是不让池子说谎。
 */
export function dropOwnedRooms<T extends { roomName: string }>(
  candidates: readonly T[],
  ownedRoomNames: readonly string[],
): T[] {
  if (ownedRoomNames.length === 0) return [...candidates];
  const owned = new Set(ownedRoomNames);
  return candidates.filter(c => !owned.has(c.roomName));
}

/**
 * R7b：按「扩张节奏自适应」算出的最低 source 数筛掉候选。
 *
 * 为什么需要这个函数：`evaluateExpansionRhythm` 的三个输出里，`blacklistMultiplier` 被
 * `blacklistTarget` 消费、`expansionPausedUntil` 被 expansion-manager 消费，而 `minSources`
 * 唯一的旧消费方 `domain/expansion/evaluator.ts` **在生产里零调用者**（只有它自己的测试在读）
 * ⇒ 「最近被抢频发就只挑 ≥2 source 的目标」这条收紧从未生效过一次。
 *
 * 两条刻意的保守：
 *   - `minSources ≤ 1` 原样返回（今天的实际值就是 1 ⇒ 接上它不改变当前行为，只是让
 *     「连续被抢之后自动变保守」这件事真的存在）；
 *   - `sourceCount === undefined` 一律保留 —— 那是「没看到」不是「不合格」，
 *     把它筛掉会让低情报覆盖的房永远进不了池子（与 `isEvaluable` 同一口径）。
 */
export function dropInsufficientSources<T extends { sourceCount?: number }>(
  candidates: readonly T[],
  minSources: number,
): T[] {
  if (minSources <= 1) return [...candidates];
  return candidates.filter(c => c.sourceCount === undefined || c.sourceCount >= minSources);
}

/**
 * 检查候选是否可评估（已侦察 + 非否决）。
 */
export function isEvaluable(candidate: ExpansionCandidateV2): boolean {
  return (
    candidate.status === "DISCOVERED" &&
    candidate.sourceCount !== undefined &&
    !candidate.vetoReason
  );
}

/**
 * 检查候选是否可入选（已评分 + 合格）。
 */
export function isQualified(candidate: ExpansionCandidateV2): boolean {
  return candidate.status === "QUALIFIED";
}
