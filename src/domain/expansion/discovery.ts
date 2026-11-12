/** Candidate Discovery */

import type { RoomIntel } from "../intel";
import {
  type ExpansionCandidateV2,
  buildCandidate,
  isEvaluable,
  revalidateCandidate,
} from "./candidate";

/** Discovery 输入。 */
export interface DiscoveryInput {
  /** 当前拥有的房间名集合。 */
  ownedRoomNames: readonly string[];
  /** 近期主动放弃的房（重占排除表）：命中即硬否决，见 candidate.buildCandidate。 */
  releasedRoomNames?: readonly string[];
  /** sponsor 房名 → 其邻居情报映射。 */
  intelBySponsor: Readonly<Record<string, Readonly<Record<string, RoomIntel>>>>;
  /** 当前 tick。 */
  tick: number;
  /** 帝国用户名。 */
  myUsername?: string;
  /** 已有候选列表（用于增量更新而非重建）。 */
  existingCandidates?: readonly ExpansionCandidateV2[];
}

/** Discovery 结果。 */
export interface DiscoveryResult {
  /** 全量候选列表（新增 + 更新 + 保留）。 */
  candidates: ExpansionCandidateV2[];
  /** 新发现的候选数。 */
  newCount: number;
  /** 更新的候选数（Intel 刷新）。 */
  updatedCount: number;
  /** 保留不变的候选数。 */
  retainedCount: number;
}

/**
 * 从 Intel 提取候选房，与已有候选合并去重。

 * 合并规则：
 * - 同一 roomName 只保留一个 entry
 * - 新 Intel lastSeen > 旧 lastSeen → 更新候选
 * - 新 Intel lastSeen ≤ 旧 lastSeen → 保留旧候选
 * - 新出现的 → 新建候选
 * - 已有候选但不在新 Intel 中的 → 保留（可能 Intel 覆盖范围未变）
 */
export function discoverCandidates(input: DiscoveryInput): DiscoveryResult {
  const {
    ownedRoomNames,
    releasedRoomNames,
    intelBySponsor,
    tick,
    myUsername,
    existingCandidates = [],
  } = input;

  // 已有候选按 roomName 索引
  const candidateMap = new Map<string, ExpansionCandidateV2>();
  for (const c of existingCandidates) {
    candidateMap.set(c.roomName, c);
  }

  let newCount = 0;
  let updatedCount = 0;

  // 本轮被 Intel 覆盖的房 —— 其余候选（Intel 未刷新）走 revalidate 分支。
  const refreshedRooms = new Set<string>();

  // 从各 sponsor 的邻居 Intel 提取候选
  for (const [sponsor, intel] of Object.entries(intelBySponsor)) {
    for (const [roomName, info] of Object.entries(intel)) {
      refreshedRooms.add(roomName);
      const existing = candidateMap.get(roomName);

      if (existing) {
        // 已有候选：每次评估都用当前规则重建，不再只在 Intel 刷新时重建。
        //
        // 为什么（2026-11-08 线上实证）：地形阈值 0.3→0.5 后，W8N2（wallRatio 0.36）
        // 的 Intel 已刷新、候选也重建了，但重建分支把 `existing.status` 覆盖回
        // REJECTED —— 旧状态粘滞，新阈值与 myUsername 修复全部白改；W7N4/W7N6
        // 因为 Intel 未刷新更是永远停在旧 veto。
        // status 必须由**本次** vetoReason 决定；只保留 discoveredAt 与历史评分。
        const refreshed = buildCandidate(
          roomName,
          sponsor,
          info,
          ownedRoomNames,
          tick,
          myUsername,
          releasedRoomNames,
        );
        refreshed.discoveredAt = existing.discoveredAt;
        if (existing.score > 0 && isEvaluable(refreshed)) {
          refreshed.score = existing.score;
          refreshed.scoreBreakdown = existing.scoreBreakdown;
          refreshed.evaluatedAt = existing.evaluatedAt;
        }
        candidateMap.set(roomName, refreshed);
        updatedCount++;
      } else {
        // 新候选
        const candidate = buildCandidate(
          roomName,
          sponsor,
          info,
          ownedRoomNames,
          tick,
          myUsername,
          releasedRoomNames,
        );
        candidateMap.set(roomName, candidate);
        newCount++;
      }
    }
  }

  // Intel 未覆盖的保留候选：用**当前**否决规则复算一次。
  // 只靠 Intel 刷新重建的旧实现会让阈值调整/用户名修复对这批房永远不生效
  // （线上实证：W6N1 墙比 0.32 在阈值降到 0.5 后仍显示 terrain-walls=0.32）。
  for (const [roomName, candidate] of candidateMap) {
    if (refreshedRooms.has(roomName)) continue;
    revalidateCandidate(candidate, ownedRoomNames, releasedRoomNames ?? [], myUsername);
  }

  const candidates = Array.from(candidateMap.values());
  const retainedCount = candidates.length - newCount - updatedCount;

  return {
    candidates,
    newCount,
    updatedCount,
    retainedCount: Math.max(0, retainedCount),
  };
}

/**
 * 过滤出可评估的候选（已侦察 + 非否决）。
 */
export function getEvaluableCandidates(
  candidates: readonly ExpansionCandidateV2[],
): ExpansionCandidateV2[] {
  return candidates.filter(isEvaluable);
}

/**
 * 过滤出合格的候选（已评分 + QUALIFIED）。
 */
export function getQualifiedCandidates(
  candidates: readonly ExpansionCandidateV2[],
): ExpansionCandidateV2[] {
  return candidates.filter(c => c.status === "QUALIFIED");
}

/**
 * 获取候选房名集合（用于 Plan 去重检查）。
 */
export function getCandidateRoomNames(candidates: readonly ExpansionCandidateV2[]): Set<string> {
  return new Set(candidates.map(c => c.roomName));
}
