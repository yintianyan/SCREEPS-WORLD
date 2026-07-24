/**
 * 远矿目标选择 — 纯函数，不访问 Game/Memory。
 *
 * 老玩家认知：远矿选址依赖邻房情报（RoomIntel），核心筛选条件：
 *   1. 普通房（有 controller，可 claim/reserve）
 *   2. 无主（owner 未定义）
 *   3. 房态正常（status === "normal"，排除 novice/respawn/closed）
 *   4. 有 source（有视野时记录了 sources > 0）
 *
 * 优先级排序：有视野 > 无视野（有视野说明已有 creep 路过，信息更可靠）。
 * 同等条件下选 source 数多的（normal 房固定 2 source，但未来 SK 房可能有 3）。
 *
 * 数据流：
 *   room-observer 采集 intel → 本函数筛选候选 → remote-mining-manager 创建 remoteOps
 */

import type { RoomIntel } from "../intel";

/** 远矿候选目标评估结果。 */
export interface RemoteCandidate {
  roomName: string;
  /** intel 中记录的 source 数（无视野时 undefined）。 */
  sources: number | undefined;
  /** 是否有近期视野（lastSeen 距当前 tick 在阈值内）。 */
  hasRecentVision: boolean;
}

/** 远矿目标筛选输入参数。 */
export interface RemoteTargetingInput {
  /** 本房名（用于排除自身）。 */
  homeRoom: string;
  /** 邻居房情报（来自 RoomMemory.intel）。 */
  intel: Readonly<Record<string, RoomIntel>> | undefined;
  /** 已有远矿运营（避免重复选择）。 */
  existingOps: Readonly<Record<string, { state: string }>> | undefined;
  /** 当前 tick（用于判断视野新鲜度）。 */
  tick: number;
  /** 视觉新鲜度阈值（超过此 tick 数视为旧情报）。 */
  staleThreshold: number;
}

/**
 * 从邻居房情报中筛选远矿候选目标。
 *
 * 纯函数 — 接收预收集的 intel 和 existingOps，不访问 Game/Memory。
 * 返回按优先级排序的候选列表。
 */
export function selectRemoteTargets(input: RemoteTargetingInput): RemoteCandidate[] {
  const { homeRoom, intel, existingOps, tick, staleThreshold } = input;
  if (!intel) return [];

  const candidates: RemoteCandidate[] = [];
  const activeTargets = new Set<string>();

  // 收集已有运营的目标（非 abandoned 状态）。
  if (existingOps) {
    for (const [roomName, op] of Object.entries(existingOps)) {
      if (op.state !== "abandoned") {
        activeTargets.add(roomName);
      }
    }
  }

  for (const [roomName, info] of Object.entries(intel)) {
    // 排除自身房间。
    if (roomName === homeRoom) continue;
    // 排除已有运营的房间。
    if (activeTargets.has(roomName)) continue;
    // 只选普通房（有 controller，可 reserve）。
    if (info.kind !== "normal") continue;
    // 排除有主的房间。
    if (info.owner) continue;
    // 排除非正常状态的房间（novice/respawn/closed）。
    if (info.status !== "normal") continue;

    const hasRecentVision = tick - info.lastSeen < staleThreshold;
    candidates.push({
      roomName,
      sources: info.sources,
      hasRecentVision,
    });
  }

  // 排序：有近期视野 > 无视野；source 数多 > 少；房名字母序（确定性）。
  candidates.sort((a, b) => {
    if (a.hasRecentVision !== b.hasRecentVision) {
      return a.hasRecentVision ? -1 : 1;
    }
    const aSources = a.sources ?? 0;
    const bSources = b.sources ?? 0;
    if (aSources !== bSources) return bSources - aSources;
    return a.roomName.localeCompare(b.roomName);
  });

  return candidates;
}

/**
 * 判断远矿运营是否应暂停（情报过期或房间状态变化）。
 *
 * 纯函数 — 接收显式参数，不访问 Game/Memory。
 */
export function shouldPauseOperation(
  op: { state: string; lastSeen: number },
  tick: number,
  staleThreshold: number,
): boolean {
  if (op.state === "abandoned") return true;
  return tick - op.lastSeen > staleThreshold;
}
