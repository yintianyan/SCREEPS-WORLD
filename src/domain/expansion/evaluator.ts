/**
 * 扩张目标评估 — 纯函数，不访问 Game/Memory。
 *
 * 战略约束：
 *   - claim 是重投资（claimer 600 能量 + 拓荒编队 + 新房自举期），
 *     禁止盲选 — 候选必须有过视野（sources 已知）。这与远矿的盲选自举
 *     刻意不同：远矿失败损失一只 creep，扩张失败损失一个 GCL 窗口。
 *   - GCL 无余量（level <= 已拥有房数）时不评估。
 *   - 失败目标进黑名单冷却（被抢占/无锚点/超时），冷却期内不重选。
 *
 * 评分：source 数主导（2 源房是标配，1 源房仅在无更优时接受），
 * 情报新鲜度做次级修正（越新越可信）。
 */
import type { RoomIntel } from "../intel";

/** 扩张候选评估结果。 */
export interface ExpansionCandidate {
  /** 目标房名。 */
  roomName: string;
  /** 负责孵化 claimer 与拓荒编队的 sponsor 房。 */
  sponsorRoom: string;
  /** 综合评分（越高越好）。 */
  score: number;
  /** 已知 source 数。 */
  sources: number;
}

/** selectExpansionTarget 的输入。 */
export interface ExpansionInput {
  /** 当前拥有的房间名集合。 */
  ownedRoomNames: readonly string[];
  /** 当前 GCL 等级。 */
  gclLevel: number;
  /** sponsor 房名 → 其邻居情报映射。 */
  intelBySponsor: Readonly<Record<string, Readonly<Record<string, RoomIntel>>>>;
  /**
   * P1-G：sponsor 房名 → 远矿房名 → dangerUntil 截止 tick。
   * 从各 sponsor 的 remoteOps 提取，用于过滤危险冷却中的扩张候选。
   * 缺失视为无危险标记（房间从未作为远矿目标时无记录）。
   */
  dangerUntilBySponsor?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** 当前 tick。 */
  tick: number;
  /** 目标黑名单：房名 → 冷却到期 tick。 */
  blacklist?: Readonly<Record<string, number>>;
  /** 情报陈旧上限（超过则不可信，不入选）。默认 10000。 */
  maxIntelAge?: number;
  /** 本帝国用户名 — 排除被他人预定的房（claim 会 ERR_INVALID_TARGET 白费一个 claimer + 超时窗口）。 */
  myUsername?: string;
}

/**
 * 从各 sponsor 房的邻居情报中评选扩张目标。
 * 返回最优候选；无可行目标（或 GCL 无余量）返回 undefined。
 */
export function selectExpansionTarget(input: ExpansionInput): ExpansionCandidate | undefined {
  const { ownedRoomNames, gclLevel, intelBySponsor, dangerUntilBySponsor, tick, blacklist, maxIntelAge = 10000, myUsername } = input;

  // GCL 余量门禁：可占房数 = GCL 等级。
  if (gclLevel <= ownedRoomNames.length) return undefined;

  const owned = new Set(ownedRoomNames);
  let best: ExpansionCandidate | undefined;

  for (const [sponsor, intel] of Object.entries(intelBySponsor)) {
    for (const [roomName, info] of Object.entries(intel)) {
      if (owned.has(roomName)) continue;
      // 只考虑可 claim 的普通房。
      if (info.kind !== "normal") continue;
      if (info.status !== "normal") continue;
      // 有主房不碰（占领 ≠ 宣战）。
      if (info.owner) continue;
      // 被他人预定的房不碰：claimController 对敌方预定返 ERR_INVALID_TARGET，
      // 白费一个 claimer + 一个 claimTimeout 窗口才 blacklist。己方续期房不排除。
      if (info.reservedBy && info.reservedBy !== myUsername) continue;
      // 必须有过视野 — sources 未知即盲区，claim 不赌。
      if (info.sources === undefined) continue;
      if (info.sources < 1) continue;
      // 情报过期不可信。
      const age = tick - info.lastSeen;
      if (age > maxIntelAge) continue;
      // 危险冷却中的房不选（威胁刚出现过 — 拓荒编队会被白吃）。
      // P1-G：dangerUntil 从 intel 迁移到 remoteOps，由调用方提取为 dangerUntilBySponsor。
      const dangerUntil = dangerUntilBySponsor?.[sponsor]?.[roomName];
      if (dangerUntil !== undefined && tick < dangerUntil) continue;
      // 有敌塔的房不选：塔会点杀 claimer 与拓荒者，claim 变成送葬。
      if ((info.towers ?? 0) > 0) continue;
      // 黑名单冷却。
      const retryAt = blacklist?.[roomName];
      if (retryAt !== undefined && tick < retryAt) continue;

      // 评分：source 数主导 + 新鲜度修正（满分 100，线性衰减到 0）。
      const freshness = Math.max(0, 100 - (age / maxIntelAge) * 100);
      const score = info.sources * 1000 + freshness;

      if (!best || score > best.score) {
        best = { roomName, sponsorRoom: sponsor, score, sources: info.sources };
      }
    }
  }

  return best;
}
