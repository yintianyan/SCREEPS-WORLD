/**
 * 侦察目标选择 — 主动情报的纯决策层（R6b，plan.md §14）。
 *
 * 背景：扩张「不见不选」（candidates 必须有过视野 sources），但视野只有
 * observer（RCL8）/过境 creep 顺带提供 — 高分候选房可能永远等不到视野。
 * 本模块选出「值得主动侦察」的目标，prospect-manager 派 scout 获取视野，
 * 产出决策就绪情报（intel.sources 落库，扩张评估器零改动消费）。
 *
 * 选择口径（镜像 expansion/evaluator 的 claimable 过滤）：
 *   normal 房 + status normal + 无主 + 无他人预定 + 未被占用 +
 *   不在失败冷却中 + 视野陈旧（sources 未知或 lastSeen 超期）。
 * 排序：pathCost 升序（缺失回退线性距离）— 通勤近的先侦察。
 * 纯函数 — 不访问 Game/Memory，全部输入由调用方采集。
 */
import { roomLinearDistance } from "../remote/targeting";

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
      const distance = c.pathCost ?? roomLinearDistance(c.home, c.roomName);
      if (distance < bestDistance) {
        bestDistance = distance;
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
