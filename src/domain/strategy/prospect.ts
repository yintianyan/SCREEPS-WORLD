/** 侦察目标选择 — 主动情报的纯决策层（R6b，docs/architecture/GOAL_POLICY_PLAN_MODEL.md）。 */
import { roomLinearDistance } from "../remote/targeting";

/**
 * hostile 相邻候选的评分罚分。取值需 > 任何候选房的可能距离（horizon 外扩下 ≤ ~6），
 * 使「干净房」在评分上永远压过「hostile 相邻房」，但全 hostile 包围时罚分均匀、仍选最近者。
 */
const HOSTILE_ADJACENCY_PENALTY = 10;

export interface ProspectCandidate {
  roomName: string;
  /** intel 归属房（孵化 scout 的 sponsor 候选）。 */
  home: string;
  kind: string;
  status: string;
  owner?: string;
  reservedBy?: string;
  myUsername: string;
  /** 已知 source 数（undefined = 从未有过视野）。 */
  sources?: number;
  lastSeen: number;
  pathCost?: number;
  /** 已被我方占用（殖民地/远矿运营/扩张目标）— 不侦察。 */
  occupied: boolean;
  /**
   * 是否已知房（intel 已收录）。false = 前沿发现候选：已知房相邻、但 intel 尚未
   * 收录的未知房。其 kind/status/owner 皆未知，selectProspectTarget 对 known=false
   * 跳过常规过滤、直接作为侦察目标去探明（见视野外扩 horizon，CONFIG.prospect.horizon）。
   * 省略（undefined）视为已知，兼容旧调用方与单测。
   */
  known?: boolean;
  /**
   * 候选房是否与已知 hostile 房（敌方所有 / 带遗迹 spawn）正交相邻。scout 若需穿越 hostile
   * 房才能 recon 该目标，会被吓退永远到不了 → 评分惩罚，优先选干净房（视野外扩场景下，
   * 紧贴 Aguia 房 W38S58 的 W38S57 会被惩罚，改选干净且直达的 W37S59）。
   */
  hostileAdjacent?: boolean;
}

export interface ProspectOptions {
  /** 视野新鲜窗口：sources 已知且 lastSeen 距今 ≤ 此值 → 无需侦察。 */
  intelFreshness: number;
}

export interface ProspectTarget {
  roomName: string;
  sponsor: string;
}

export function selectProspectTarget(
  candidates: readonly ProspectCandidate[],
  tick: number,
  options: ProspectOptions,
): ProspectTarget | undefined {
  let best: ProspectTarget | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    if (c.occupied) continue;
    // 前沿发现候选（known=false）：kind/status/owner 皆未知，无法套用常规过滤 —
    // 直接作为侦察目标去探明，按距离排序。这是视野外扩（horizon）的核心：
    // 已知世界锁死在己方房直接邻居时，靠它发现第 2 圈及以外的干净中立房。
    if (c.known === false) {
      // 评分：hostile 相邻候选加罚分（> 最大候选距离，确保干净房始终优先；全 hostile 包围时
      // 罚分均匀，仍选最近者）。recon scout 是便宜单位，但穿越 hostile 房会被吓退/阵亡，
      // 优先选无需穿越敌方房的干净目标才能稳定完成 recon。
      const distance = c.pathCost ?? roomLinearDistance(c.home, c.roomName);
      const effective = distance + (c.hostileAdjacent ? HOSTILE_ADJACENCY_PENALTY : 0);
      if (effective < bestDistance) {
        bestDistance = effective;
        best = { roomName: c.roomName, sponsor: c.home };
      }
      continue;
    }
    if (c.kind !== "normal" || c.status !== "normal") continue;
    if (c.owner && c.owner !== c.myUsername) continue;
    if (c.reservedBy && c.reservedBy !== c.myUsername) continue;
    // 视野已新鲜（sources 已知且未过期）→ 决策就绪，无需侦察。
    if (c.sources !== undefined && tick - c.lastSeen <= options.intelFreshness) continue;
    const distance = c.pathCost ?? roomLinearDistance(c.home, c.roomName);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { roomName: c.roomName, sponsor: c.home };
    }
  }
  return best;
}
