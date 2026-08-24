/**
 * Candidate Discovery — A3.2 Phase 1：从 Intel 提取候选 + 去重。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §3 巡检发现候选 → 开 remote 车道。
 *
 * 定位：从各 sponsor 房的邻居 Intel 中提取可 claim 候选，
 * 标记 UNKNOWN / DISCOVERED，去重（同一 roomName 只保留一个 entry），
 * 为后续 Scoring 层提供输入。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { RoomIntel } from "../intel";
import { ExpansionCandidateV2, buildCandidate, isEvaluable } from "./candidate";

/** Discovery 输入。 */
export interface DiscoveryInput {
  /** 当前拥有的房间名集合。 */
  ownedRoomNames: readonly string[];
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
 *
 * 合并规则：
 * - 同一 roomName 只保留一个 entry
 * - 新 Intel lastSeen > 旧 lastSeen → 更新候选
 * - 新 Intel lastSeen ≤ 旧 lastSeen → 保留旧候选
 * - 新出现的 → 新建候选
 * - 已有候选但不在新 Intel 中的 → 保留（可能 Intel 覆盖范围未变）
 */
export function discoverCandidates(input: DiscoveryInput): DiscoveryResult {
  const { ownedRoomNames, intelBySponsor, tick, myUsername, existingCandidates = [] } = input;

  // 已有候选按 roomName 索引
  const candidateMap = new Map<string, ExpansionCandidateV2>();
  for (const c of existingCandidates) {
    candidateMap.set(c.roomName, c);
  }

  let newCount = 0;
  let updatedCount = 0;

  // 从各 sponsor 的邻居 Intel 提取候选
  for (const [sponsor, intel] of Object.entries(intelBySponsor)) {
    for (const [roomName, info] of Object.entries(intel)) {
      const existing = candidateMap.get(roomName);

      if (existing) {
        // 已有候选：检查 Intel 是否更新
        if (info.lastSeen > existing.lastSeen) {
          // Intel 刷新 → 重建候选（保留 discoveredAt 和 status 如果仍是 UNKNOWN）
          const refreshed = buildCandidate(roomName, sponsor, info, ownedRoomNames, tick, myUsername);
          refreshed.discoveredAt = existing.discoveredAt;
          // 如果旧候选已评分，保留评分直到重新评估
          if (existing.score > 0 && isEvaluable(refreshed)) {
            refreshed.score = existing.score;
            refreshed.scoreBreakdown = existing.scoreBreakdown;
            refreshed.evaluatedAt = existing.evaluatedAt;
            refreshed.status = existing.status;
          }
          candidateMap.set(roomName, refreshed);
          updatedCount++;
        }
        // Intel 未更新 → 保留旧候选
      } else {
        // 新候选
        const candidate = buildCandidate(roomName, sponsor, info, ownedRoomNames, tick, myUsername);
        candidateMap.set(roomName, candidate);
        newCount++;
      }
    }
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
export function getCandidateRoomNames(
  candidates: readonly ExpansionCandidateV2[],
): Set<string> {
  return new Set(candidates.map(c => c.roomName));
}
