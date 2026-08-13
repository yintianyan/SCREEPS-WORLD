/**
 * 战争目标选择 — Strategy 层授权（war 姿态）之下的纯函数执行决策。
 *
 * 位置：Strategy 层（empire-strategy 发布 posture）与执行层（war-planner 系统）之间。
 * 本模块只做「从情报候选中选出攻击目标」的纯决策，不读 Game/Memory —
 * 所有输入由调用方（war-planner）采集后注入。
 *
 * 目标资格（全部满足才可选，v1 原则「不见不打」）：
 *   1. 普通房（kind === "normal"）— 不打 SK/center/highway（无玩家归属或价值密度不足）
 *   2. 有 owner 且非本人（未 claim 的野房不是战争目标）
 *   3. 情报新鲜（lastSeen 距今 ≤ freshness）— 没有视野的房不贸然进攻
 *   4. tower 数 < maxTowers — 塔网太密的目标啃不动，宁可等待或换目标
 *   5. 未被我方占用（非我方殖民地 / 非远矿运营目标 / 非当前扩张目标）
 *
 * 排序：通勤成本（pathCost，缺失回退线性距离）最小者优先；sponsor = 情报归属的 home。
 */
import type { RoomKind } from "../intel";
import { roomLinearDistance } from "../remote/targeting";

export interface WarTargetCandidate {
  roomName: string;
  /** 情报所属的 home 房（代孵候选）。 */
  home: string;
  kind: RoomKind;
  owner: string | undefined;
  lastSeen: number;
  towers: number | undefined;
  pathCost: number | undefined;
  /** 已被我方占用（己方殖民地 / 远矿 / 扩张目标）— 不打自己正在用的房。 */
  occupied: boolean;
}

export interface WarTargetInput {
  tick: number;
  myUsername: string;
  candidates: readonly WarTargetCandidate[];
  /** 情报新鲜度窗口（tick）。 */
  freshness: number;
  /** 目标 tower 数上限（≥ 此值不可攻击）。 */
  maxTowers: number;
}

export interface WarTarget {
  roomName: string;
  /** 代孵 sponsor 房（通勤最近的 home）。 */
  sponsor: string;
  towersSeen: number;
  distance: number;
}

export function selectWarTarget(input: WarTargetInput): WarTarget | undefined {
  let best: WarTarget | undefined;
  for (const c of input.candidates) {
    if (c.kind !== "normal") continue;
    if (!c.owner || c.owner === input.myUsername) continue;
    if (input.tick - c.lastSeen > input.freshness) continue;
    if ((c.towers ?? 0) >= input.maxTowers) continue;
    if (c.occupied) continue;
    const distance = c.pathCost ?? roomLinearDistance(c.home, c.roomName);
    if (best === undefined || distance < best.distance) {
      best = { roomName: c.roomName, sponsor: c.home, towersSeen: c.towers ?? 0, distance };
    }
  }
  return best;
}

/** 编队规模：基数 + 目标有 tower 时按塔数追加（有塔目标需要更多攻击者分摊塔伤）。 */
export function decideSquadSize(towersSeen: number, base: number, perTower: number): number {
  return base + (towersSeen > 0 ? perTower : 0);
}