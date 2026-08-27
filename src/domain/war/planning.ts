/**
 * 战争目标选择 — war 姿态授权之下的纯函数执行决策。
 *
 * LEGACY_COMPATIBILITY_ONLY：
 *   selectWarTarget / decideSquadSize 是 Legacy 路径。
 *   planMilitaryOperation()（domain/military/war-planning.ts）是 Canonical 路径。
 *   war-planner.ts 仅在 a5ForceReq 不存在时 fallback 到本模块。
 *   删除条件：当 war-planning-system 完全接管 WarPlan 产出后，
 *   本模块可安全删除（包括 war-planner.ts 中的 import 与 fallback 分支）。
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

/** 编队规模：base + 有塔目标追加 perTower 攻击者分摊塔伤。 */
export function decideSquadSize(towersSeen: number, base: number, perTower: number): number {
  return base + (towersSeen > 0 ? perTower : 0);
}

/**
 * 治疗编制（heal-tank）：每 ratio 个编制位配 1 个 healer，向上取整且至少 1。
 * 派生值 — 不入 Memory，war-planner 每轮按 squadSize 现算（squadSize 已持久化）。
 * 非正 squadSize 防御性回 1：0 奶编队在塔下静默送死，宁可多孵。
 */
export function decideHealerCount(squadSize: number, ratio: number): number {
  return Math.max(1, Math.ceil(squadSize / ratio));
}

// ─── R4：波次相位与战损止损（纯函数）──────────────────────────

/** 战争计划相位：build 集结 / advance 推进。 */
export type WarPlanPhase = "build" | "advance";

/**
 * 波次相位迟滞推进（R4）— 「整波集结」替代「散兵逐个送」：
 * build 满编（live ≥ squadSize）才 advance；advance 被打残（live < squadSize ×
 * regroupRatio）才回落 build 重组。双阈值不对称：推进保守、重组迟滞，防相位抖动。
 * boostReady（boost 战前强化门禁）：false = 编队未全员强化，满编也继续集结；
 * undefined = 降级豁免（sponsor 无 lab / 宽限期过，见 evaluateBoostGate）。
 */
export function nextWavePhase(
  prev: WarPlanPhase,
  live: number,
  squadSize: number,
  regroupRatio: number,
  boostReady?: boolean,
): WarPlanPhase {
  if (prev === "build") {
    if (live < squadSize) return "build";
    return boostReady === false ? "build" : "advance";
  }
  return live < squadSize * regroupRatio ? "build" : "advance";
}

/**
 * boost 门禁判定（boost 战前强化链）：编队全员已强化 → true；
 * 不可强化（canBoost=false，sponsor 无 lab/RCL 不足）或宽限期过
 * （graceExpired=true，防缺矿房永久卡死在 build）→ undefined（降级裸攻，
 * 战损止损链兜底）；否则按 boostedCount ≥ liveCount 判定。
 */
export function evaluateBoostGate(
  boostedCount: number,
  liveCount: number,
  canBoost: boolean,
  graceExpired: boolean,
): boolean | undefined {
  if (!canBoost || graceExpired) return undefined;
  return boostedCount >= liveCount;
}

/**
 * 战损止损判定（R4）：累计 spawned > squadSize × casualtyMultiplier 即判消耗战失败
 *（目标打不穿，再添油只是持续放血）。spawned 含在队 pending，但提交受
 * live+pending < squadSize 约束不会无限膨胀，TTL 重提交频率也远低于阈值，误判可忽略。
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

// ─── 核弹发射决策（nuker 战略威慑链，纯函数）──────────────────

/** 核弹发射的能量当量（引擎数值：launchNuke 每发消耗 50k energy + 5k G）。
 * 唯一定义点 — war-planner（发射就绪判定）与 actions/stockNuker（装填目标）共用。 */
export const NUKE_ENERGY_COST = 50000;
/** 核弹发射的 ghodium 当量。 */
export const NUKE_GHODIUM_COST = 5000;
/** 核弹飞行时长（引擎数值：发射到落地 50,000 tick）— 在途台账的到期基准。 */
export const NUKE_LANDING_TIME = 50000;

/** shouldLaunchNuke 的输入 — 全部由调用方自引擎态采集，本函数不读 Game/Memory。 */
export interface NukeLaunchInput {
  /** nuker 已满装填（energy ≥ 50k 且 G ≥ 5k）且 cooldown 归零。 */
  nukerReady: boolean;
  /** 目标房在途核弹数（Game.nukes 按 targetRoomName 过滤）。 */
  nukesInFlightToTarget: number;
  /** 目标 intel 塔数（攻坚门槛输入）。 */
  towersSeen: number;
  /** 发射塔数门槛（CONFIG.nuker.launchTowerThreshold）。 */
  towerThreshold: number;
  /** sponsor → 目标线性距离（射程预检口径）。 */
  linearDistance: number;
  /** 射程上限（CONFIG.nuker.maxRange）。 */
  maxRange: number;
}

/**
 * 核弹发射判定：war 姿态授权由调用方（war-planner）保证，本函数只裁决
 * 「值不值得打 + 打得着 + 没在打」：
 * - 未装填/冷却中 → false（发射必返 ERR_NOT_ENOUGH_RESOURCES，白跑）；
 * - 同目标已有在途核弹 → false（天然限频：5k 冷却 + 50k 落地，重叠发射只是
 *   把当量堆在同一片废墟上）；
 * - 塔数低于门槛 → false（轻防目标地面编队足够，核弹留给啃不动的重防）；
 * - 超射程 → false（走廊约束的保守预检，细判交给 launchNuke 返回码）。
 */
export function shouldLaunchNuke(input: NukeLaunchInput): boolean {
  if (!input.nukerReady) return false;
  if (input.nukesInFlightToTarget > 0) return false;
  if (input.towersSeen < input.towerThreshold) return false;
  if (input.linearDistance > input.maxRange) return false;
  return true;
}

/**
 * 战后核验（R4）：情报过期 → unknown（无证据不宣称胜利）；敌人弃房或塔网清零
 *（本轮远征的可达成目标 = 拆掉反制能力）→ success；其余 failure。
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