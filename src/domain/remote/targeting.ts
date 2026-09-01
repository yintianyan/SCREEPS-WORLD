/** 远矿目标选择 — 纯函数，不访问 Game/Memory。核心筛选：普通房（可 reserve）、 */

import { isHostilePlayerReservation, INVADER_USERNAME, type RoomIntel } from "../intel";
import { CONFIG } from "../../config";


export interface RemoteCandidate {
  roomName: string;
  /** intel 中记录的 source 数（无视野时 undefined）。 */
  sources: number | undefined;
  /** 是否有近期视野（lastSeen 距当前 tick 在阈值内）。 */
  hasRecentVision: boolean;
  /** 净收益评分（e/tick）— 吞吐上限减编队摊销，评选排序与门槛剔除的依据。 */
  netScore: number;
  /** 动态 hauler 编制（按通勤成本算出，1-haulersMax）。 */
  haulerNeed: number;
}


export interface RemoteTargetingInput {
  /** 本房名（用于排除自身）。 */
  homeRoom: string;
  /** 邻居房情报（来自 RoomMemory.intel）。 */
  intel: Readonly<Record<string, RoomIntel>> | undefined;
  /** 已有远矿运营（避免重复选择）。P1-G 后含 dangerUntil 字段用于危险冷却判定。 */
  existingOps: Readonly<Record<string, { state: string; dangerUntil?: number }>> | undefined;
  tick: number;
  /** 视野新鲜度阈值（超过此 tick 数视为旧情报）。 */
  staleThreshold: number;
  /** 全帝国已运营的远矿目标（跨房去重）。缺此参数教训：existingOps 只含本房，
   * 双主房时代第二房会把兄弟房运营中的远矿当合格候选 — 双编队抢同一 source
   * （产能固定 1500/300tick），双 reserver 各烧 1300 能量，收益不变成本翻倍。 */
  globalActiveTargets?: ReadonlySet<string>;
  /** remoteHauler 单只运力（carry 容量，调用方按当前 body 档位计算）。 */
  haulerCapacity: number;
  /** 本帝国用户名 — 排除被他人预定的房（己方续期中的房仍可选）。 */
  myUsername?: string;
  /** 我方所有殖民地房名（权威 controller.my，非 intel）。己方房永不可作远矿目标：
   * 新占殖民地 intel 常滞后未记 owner 会被当高分目标误选，与 self-claim 废弃形成
   * 开→废 churn；用权威集合硬排除。 */
  ownedRooms?: ReadonlySet<string>;
}

// ─── 远矿经济模型（评分公式的具名常量）───
// 收益：reserve 后单 source 3000/300tick = 10 e/tick；未预定仅 1500/300 = 5。
const SOURCE_INCOME = 10;
const SOURCE_INCOME_UNRESERVED = 5;
// 摊销：body 成本 / 寿命（e/tick）。harvester ~550/1500、hauler ~600/1500、
// reserver 1300/600（CLAIM 寿命仅 600，是编队里最贵的门票）。
const HARVESTER_UPKEEP = 0.4;
const HAULER_UPKEEP = 0.4;
const RESERVER_UPKEEP = 2.2;
// A-2 账本补全：defender 摊销（[2A,2M] ~520/1500 ≈ 0.35 e/tick，enableDefender
// 时计入 — 远矿房需常备/周期性防御）；道路维护随通勤里程缩放（road 每 tick 持续
// 衰减，里程越长维护越贵；系数含沼泽路 5× 衰减的保守放大）。二者原缺失 →
// 频繁被扰/远程房 netScore 虚高。
const DEFENDER_UPKEEP = 0.35;
const ROAD_UPKEEP_PER_PATHCOST = 0.002;

/** 房名解析坐标（纯函数，不依赖 Game.map）。 */
function parseRoomCoord(roomName: string): { x: number; y: number } | undefined {
  const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!m) return undefined;
  const x = m[1] === "W" ? -Number(m[2]) - 1 : Number(m[2]);
  const y = m[3] === "N" ? -Number(m[4]) - 1 : Number(m[4]);
  return { x, y };
}

/** 房间线性距离（Chebyshev，等价 Game.map.getRoomLinearDistance 的纯函数版）。 */
export function roomLinearDistance(a: string, b: string): number {
  const ca = parseRoomCoord(a);
  const cb = parseRoomCoord(b);
  if (!ca || !cb) return 1;
  return Math.max(Math.abs(ca.x - cb.x), Math.abs(ca.y - cb.y));
}

/**
 * 候选净收益评分（纯函数）— 把「性价比」算成一个数。
 * pathCost 是通勤账本核心（PathFinder 实测，swampCost:5 折算沼泽）；intel 缺失
 * 回退线性距离 × 70（约一个房对角穿越 + 余量，偏保守 — 宁可低估陌生房）。
 * 吞吐 = min(需求, 编制 × 单 hauler 往返运力)；净分 = 吞吐 - 编队摊销。
 * A-2 账本补全：upkeep 计入 defender（enableDefender 时）与道路维护；
 * reserved=false（无 CLAIM body / 未启用 reserver）时单源收益减半（5 e/tick）
 * 且不计 reserver 摊销 —— 评估口径与实际执行一致（B-3）。
 */
export function scoreRemoteCandidate(input: {
  pathCost: number | undefined;
  linearDistance: number;
  sources: number | undefined;
  haulerCapacity: number;
  /** 是否预定该房（默认 true）。false → 收益减半 + 不计 reserver 摊销。 */
  reserved?: boolean;
  /** 是否为该房配 defender（默认 CONFIG.remote.enableDefender）。 */
  withDefender?: boolean;
  /** 是否有道路覆盖（有路速度 ×2，等价 pathCost 减半）。默认 false 保守。 */
  hasRoad?: boolean;
}): { netScore: number; haulerNeed: number } {
  const pathCost = input.pathCost ?? input.linearDistance * 70;
  const sources = input.sources ?? 1; // 无视野保守估 1。
  const reserved = input.reserved ?? true;
  const withDefender = input.withDefender ?? CONFIG.remote.enableDefender;
  const hasRoad = input.hasRoad ?? false;
  const perSource = reserved ? SOURCE_INCOME : SOURCE_INCOME_UNRESERVED;
  const demand = sources * perSource;
  // 有路时 hauler 速度翻倍（道路 fatigue-free），等价 pathCost 减半。
  const effectivePathCost = hasRoad ? Math.max(1, pathCost / 2) : pathCost;
  const perHauler = input.haulerCapacity / (2 * Math.max(1, effectivePathCost));
  const haulerNeed = Math.min(
    CONFIG.remote.haulersMax,
    Math.max(1, Math.ceil(demand / Math.max(0.01, perHauler))),
  );
  const throughput = Math.min(demand, haulerNeed * perHauler);
  const upkeep =
    HARVESTER_UPKEEP * sources +
    HAULER_UPKEEP * haulerNeed +
    (reserved ? RESERVER_UPKEEP : 0) +
    (withDefender ? DEFENDER_UPKEEP : 0) +
    ROAD_UPKEEP_PER_PATHCOST * pathCost;
  return { netScore: throughput - upkeep, haulerNeed };
}

/**
 * 有效开点上限 — 消化能力与生产能力双重约束取最小。
 * 消化侧：无 storage 时收缩为 1（sink ≈ 4300 容量是唯一归宿，多点并发流入
 * 背压空转、container 溢出衰减），storage 建成后放开。
 * 生产侧：上限不超 spawn 数 — 每 op 稳态编制 3-5 只（reserver 因 CLAIM 寿命
 * 600 以 2.5 倍频率轮换），单 spawn 房开双远矿会持续占用孵化位，本地
 * upgrader/builder/distributor 寿终后排队队首（线上实测远程吃 50% 孵化产出）。
 */
export function effectiveMaxOperations(hasStorage: boolean, spawnCount: number): number {
  const digestCap = hasStorage ? CONFIG.remote.maxOperations : CONFIG.remote.maxOperationsNoStorage;
  return Math.min(digestCap, Math.max(0, spawnCount));
}

/** 从邻居房情报筛选远矿候选（纯函数），返回按优先级排序的候选列表。 */
export function selectRemoteTargets(input: RemoteTargetingInput): RemoteCandidate[] {
  const { homeRoom, intel, existingOps, tick, staleThreshold } = input;
  if (!intel) return [];

  const candidates: RemoteCandidate[] = [];
  const activeTargets = new Set<string>();

  if (existingOps) {
    for (const [roomName, op] of Object.entries(existingOps)) {
      if (op.state !== "abandoned") {
        activeTargets.add(roomName);
      }
    }
  }

  for (const [roomName, info] of Object.entries(intel)) {
    if (roomName === homeRoom) continue;
    // 排除我方殖民地（权威 controller.my）— intel owner 常滞后，防新占殖民地被误选 churn。
    if (input.ownedRooms?.has(roomName)) continue;
    if (activeTargets.has(roomName)) continue;
    // 排除他房已运营的目标（跨房去重 — 双编队抢矿是纯亏损）。
    if (input.globalActiveTargets?.has(roomName)) continue;
    // 只选普通房（有 controller，可 reserve）。
    if (info.kind !== "normal") continue;
    if (info.owner) continue;
    // 排除被敌对玩家预定的房（己方续期仍可选）。玩家争矿派 reserver 只能打
    // 无谓 attackController 拉锯，止损不去。Invader 预定不是争矿——是 Core 占坑，
    // 必须可选，否则 abandoned 远矿永远重不开（线上 W37S57/W36S58：三邻房全
    // reservedBy=Invader，coreClearer 因无 active op 永不派兵）。
    if (isHostilePlayerReservation(info.reservedBy, input.myUsername)) continue;
    if (info.status !== "normal") continue;
    // 排除危险冷却中的房间 — 威胁刚出现过的房不送兵（止损）。
    // P1-G：dangerUntil 从 intel 迁移到 remoteOps（remote-mining-manager 唯一写入）。
    const dangerUntil = existingOps?.[roomName]?.dangerUntil;
    if (dangerUntil !== undefined && tick < dangerUntil) continue;

    const hasRecentVision = tick - info.lastSeen < staleThreshold;
    // 净收益低于 minNetScore 的烂目标（沼泽远房/超远房）直接剔除 —
    // 名额只有 maxOperations 个，占位比空置更亏。
    const { netScore, haulerNeed } = scoreRemoteCandidate({
      pathCost: info.pathCost,
      linearDistance: roomLinearDistance(homeRoom, roomName),
      sources: info.sources,
      haulerCapacity: input.haulerCapacity,
      // Invader 预定期间无法 reserve，按未预定口径评分（收益减半、不计 reserver 摊销），
      // 避免把「拆核后才能满产」的房估成现成 10 e/tick。
      reserved: info.reservedBy !== INVADER_USERNAME,
    });
    if (netScore < CONFIG.remote.minNetScore) continue;
    candidates.push({
      roomName,
      sources: info.sources,
      hasRecentVision,
      netScore,
      haulerNeed,
    });
  }

  // 排序：净收益高 > 有近期视野 > 房名字母序（确定性）。
  candidates.sort((a, b) => {
    if (a.netScore !== b.netScore) return b.netScore - a.netScore;
    if (a.hasRecentVision !== b.hasRecentVision) {
      return a.hasRecentVision ? -1 : 1;
    }
    return a.roomName.localeCompare(b.roomName);
  });

  return candidates;
}

/** 远矿运营是否应暂停（abandoned 或情报过期）。纯函数。 */
export function shouldPauseOperation(
  op: { state: string; lastSeen: number },
  tick: number,
  staleThreshold: number,
): boolean {
  if (op.state === "abandoned") return true;
  return tick - op.lastSeen > staleThreshold;
}
