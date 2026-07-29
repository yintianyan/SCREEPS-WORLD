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
import { CONFIG } from "../../config";

/** 远矿候选目标评估结果。 */
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
  /** 全帝国已运营的远矿目标（跨房去重）。
   * 缺此参数的教训：existingOps 只含本房运营，双主房时代第二个房达到
   * RCL4 后会把兄弟房正在运营的远矿当合格候选 — 双编队抢同一 source
   * （产能固定 1500/300tick），双 reserver 各烧 1300 能量，收益不变
   * 成本翻倍，远矿利润腰斩。 */
  globalActiveTargets?: ReadonlySet<string>;
  /** remoteHauler 单只运力（carry 容量，调用方按当前 body 档位计算）。 */
  haulerCapacity: number;
}

// ─── 远矿经济模型（评分公式的具名常量）────────────────────────
// 收益：reserve 后单 source 3000/300tick = 10 e/tick。
const SOURCE_INCOME = 10;
// 摊销：body 成本 / 寿命（e/tick）。harvester ~550/1500、hauler ~600/1500、
// reserver 1300/600（CLAIM 寿命仅 600，是编队里最贵的门票）。
const HARVESTER_UPKEEP = 0.4;
const HAULER_UPKEEP = 0.4;
const RESERVER_UPKEEP = 2.2;

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
 *
 * pathCost 是通勤账本的核心：PathFinder 实测（swampCost:5 已把沼泽折算成
 * 等效路程）；intel 缺失时回退线性距离 × 70（约一个房的对角穿越 + 余量，
 * 偏保守 — 宁可低估陌生房，不高估）。
 * 吞吐 = min(需求, 编制 × 单 hauler 往返运力)；净分 = 吞吐 - 编队摊销。
 */
export function scoreRemoteCandidate(input: {
  pathCost: number | undefined;
  linearDistance: number;
  sources: number | undefined;
  haulerCapacity: number;
}): { netScore: number; haulerNeed: number } {
  const pathCost = input.pathCost ?? input.linearDistance * 70;
  const sources = input.sources ?? 1; // 无视野保守估 1。
  const demand = sources * SOURCE_INCOME;
  const perHauler = input.haulerCapacity / (2 * Math.max(1, pathCost));
  const haulerNeed = Math.min(
    CONFIG.remote.haulersMax,
    Math.max(1, Math.ceil(demand / Math.max(0.01, perHauler))),
  );
  const throughput = Math.min(demand, haulerNeed * perHauler);
  const upkeep = HARVESTER_UPKEEP * sources + HAULER_UPKEEP * haulerNeed + RESERVER_UPKEEP;
  return { netScore: throughput - upkeep, haulerNeed };
}

/**
 * 有效开点上限 — 无 storage 时收缩为 1（消化保护）。
 *
 * 本房 sink（spawn/ext/tower/controller container ≈ 4300 容量）在无 storage
 * 时是远矿能量的唯一归宿，多点并发流入必然背压空转（远矿 container 溢出
 * drop 衰减）。storage 建成后自动放开。
 */
export function effectiveMaxOperations(hasStorage: boolean): number {
  return hasStorage ? CONFIG.remote.maxOperations : CONFIG.remote.maxOperationsNoStorage;
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
    // 排除他房已运营的目标（跨房去重 — 双编队抢矿是纯亏损）。
    if (input.globalActiveTargets?.has(roomName)) continue;
    // 只选普通房（有 controller，可 reserve）。
    if (info.kind !== "normal") continue;
    // 排除有主的房间。
    if (info.owner) continue;
    // 排除非正常状态的房间（novice/respawn/closed）。
    if (info.status !== "normal") continue;
    // 排除危险冷却中的房间 — 威胁刚出现过的房不送兵（止损）。
    if (info.dangerUntil !== undefined && tick < info.dangerUntil) continue;

    const hasRecentVision = tick - info.lastSeen < staleThreshold;
    // 净收益评分：吞吐上限减编队摊销；低于门槛的烂目标（沼泽远房/超远房）
    // 直接剔除 — 名额只有 maxOperations 个，占位比空置更亏。
    const { netScore, haulerNeed } = scoreRemoteCandidate({
      pathCost: info.pathCost,
      linearDistance: roomLinearDistance(homeRoom, roomName),
      sources: info.sources,
      haulerCapacity: input.haulerCapacity,
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
