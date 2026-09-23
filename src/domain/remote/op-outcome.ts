/** 远矿 op 废弃归因 — 原因码与定长墓地（纯观测层：不参与任何决策，只留痕迹）。 */

/**
 * 废弃原因码。进 Memory 所以用数字；语义与 `systems/remote/op-lifecycle.ts` 里
 * 8 个 `state = "abandoned"` 赋值点一一对应。
 *
 * 为什么必须有：线上实测 W37S55 的 remoteOps 从 4 掉到 2，事后**完全查不出**那两房
 * 叫什么、为什么被弃 —— abandoned 记录会被卫生层整条 delete（staleThreshold×6），
 * 非自有房的 intel 只活在 heap（会 age + cap，不落 segment），而 8 条路径此前全都只
 * log 一行文本。"为什么少了两个矿点"这种问题不该取决于日志还留在不在屏幕上。
 *
 * 每块墓碑的 `d`（关键读数）按码解释：
 * - ZeroDelivery  [零交付时长, spawnCost, infraCost]
 * - NetRateLoss   [netRate×10, delivered, spawnCost, infraCost, 运行时长]
 * - LowScore      [netScore×10, 低于门槛时长, haulerNeed, sources]
 * - Claimed       [是否我方 claim(1/0), controller 等级]      w = owner 名
 * - HostileReserved []                                        w = 预定者名
 * - SealedAllExits [被封死的出口方向...]
 * - PausedTimeout  [距最后一次看见的时长]
 * - Stalled        [编队总数, 全员空转时长]
 */
export const REMOTE_ABANDON = {
  /** 零交付止损：过了承诺期、孵化投入烧穿门槛，且不在救援/威胁豁免窗口内。 */
  ZeroDelivery: 0,
  /** 实测净营收为负（账本口径，"运回来也不划算"）。 */
  NetRateLoss: 1,
  /** 静态经济重估持续低于门槛，超过 lowScoreGrace。 */
  LowScore: 2,
  /** 目标房 controller 已有 owner（含被自己 claim —— 转本地闭环，同样废弃）。 */
  Claimed: 3,
  /** controller 被敌对玩家预定（Invader Core 占坑不走这条）。 */
  HostileReserved: 4,
  /** 全部出口被人工墙封死，编队物理上进不去。 */
  SealedAllExits: 5,
  /** paused 且超过 staleThreshold×3 无 creep 到站（长期失明/无人）。 */
  PausedTimeout: 6,
  /** 编队全员空转超 stallAbandonTicks（吞吐反馈安全网）。 */
  Stalled: 7,
} as const;

/** 原因码 → 可读名（日志与墓地对照用；长度受控，只活在这份表里）。 */
export const REMOTE_ABANDON_LABEL: Record<number, string> = {
  [REMOTE_ABANDON.ZeroDelivery]: "零交付止损",
  [REMOTE_ABANDON.NetRateLoss]: "实测亏损收缩",
  [REMOTE_ABANDON.LowScore]: "经济重估废弃",
  [REMOTE_ABANDON.Claimed]: "目标房已有主",
  [REMOTE_ABANDON.HostileReserved]: "被敌对玩家预定",
  [REMOTE_ABANDON.SealedAllExits]: "入口全被封死",
  [REMOTE_ABANDON.PausedTimeout]: "长期失明转弃",
  [REMOTE_ABANDON.Stalled]: "编队空转止损",
};

/** 一块墓碑：一次废弃事件的最小可归因记录。 */
export interface RemoteOpTombstone {
  /** 目标房名（op 记录本身会被删除，这里是唯一留下"少了哪个"的地方）。 */
  t: string;
  /** REMOTE_ABANDON 码。 */
  r: number;
  /** 废弃发生的 tick。 */
  at: number;
  /** 现场关键读数（按码解释，见 REMOTE_ABANDON 注释）。 */
  d?: number[];
  /** 占房者 / 预定者名（仅 Claimed / HostileReserved 有值）。 */
  w?: string;
}

/**
 * 追加一块墓碑并按 cap 截断（保留最新）。原地修改并返回同一数组，便于调用方赋回。
 * 按条数截断而不做 TTL：一次远矿采集周期本身可能长达数万 tick，按时间清理会正好
 * 把"刚发生的那次"抹掉，而那是唯一有意义的一条。
 */
export function pushTombstone(
  yard: RemoteOpTombstone[] | undefined,
  rec: RemoteOpTombstone,
  cap: number,
): RemoteOpTombstone[] {
  const out = yard ?? [];
  out.push(rec);
  while (out.length > cap) out.shift();
  return out;
}
