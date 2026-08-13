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
  /** R4：战争失败目标黑名单（房名 → 冷却到期 tick）。冷却期内的候选直接剔除。 */
  blacklist?: Readonly<Record<string, number>>;
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
    // R4：失败目标黑名单 — 冷却期内不重选（避免「打不过 → 收摊 → 再选 → 再送」）。
    if (input.blacklist && (input.blacklist[c.roomName] ?? 0) > input.tick) continue;
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

// ─── R4：波次相位与战损止损（纯函数）──────────────────────────

/** 战争计划相位：build 集结 / advance 推进。 */
export type WarPlanPhase = "build" | "advance";

/**
 * 波次相位迟滞推进（R4）— 用「整波集结」替代「散兵逐个送」：
 *   build   → 满编（live ≥ squadSize）才 advance；
 *   advance → 被打残（live < squadSize × regroupRatio）才回落 build 重组。
 * 双阈值不对称：推进要满编（保守），重组要真打残（迟滞），防相位抖动。
 */
export function nextWavePhase(
  prev: WarPlanPhase,
  live: number,
  squadSize: number,
  regroupRatio: number,
): WarPlanPhase {
  if (prev === "build") {
    return live >= squadSize ? "advance" : "build";
  }
  return live < squadSize * regroupRatio ? "build" : "advance";
}

/**
 * 战损止损判定（R4）— spawned（累计提交的孵化请求数）超过编队规模 ×
 * 倍数即判消耗战失败：目标打不穿，再添油也只是持续放血。
 * spawned 含在队 pending — 队列被能量门禁卡住时不会无限膨胀
 * （提交受 live+pending < squadSize 约束），TTL 过期重提交的频率
 * 也远低于止损阈值，误判风险可忽略。
 */
export function isAttritionLost(
  spawned: number,
  squadSize: number,
  casualtyMultiplier: number,
): boolean {
  return spawned > squadSize * casualtyMultiplier;
}

/** 战后核验结论。 */
export type WarOutcome = "success" | "failure" | "unknown";

/**
 * 战后核验（R4）— 收摊时用目标房最新 intel 判定战果：
 *   - 情报过期（lastSeen 超出 freshness）→ unknown（无证据不宣称胜利）；
 *   - 敌人弃房（owner 消失）→ success；
 *   - 目标本有塔网（towersSeen > 0）且 intel 显示塔已清零 → success
 *     （本轮远征的可达成目标 = 拆掉反制能力）；
 *   - 其余 → failure。
 * success 免黑名单（目标已无价值/已瘫痪），failure/unknown 进黑名单。
 */
export function evaluateWarOutcome(
  towersSeen: number,
  intelTowers: number | undefined,
  intelOwner: string | undefined,
  intelLastSeen: number | undefined,
  tick: number,
  freshness: number,
): WarOutcome {
  if (intelLastSeen === undefined || tick - intelLastSeen > freshness) return "unknown";
  if (intelOwner === undefined) return "success";
  if (towersSeen > 0 && intelTowers === 0) return "success";
  return "failure";
}