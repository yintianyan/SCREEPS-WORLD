/**
 * 帝国能量互济与能量市场 — 纯函数决策层（R5 经济主线）。
 *
 * 背景：M12「双房互济」验收项（主房向新房输血能量）长期空缺 —
 * singleRoomTerminalPolicy 明确写着「单房间阶段不主动发送」。本模块补上
 * 跨房能量调度的决策核心；执行层在 systems/terminal-manager.ts
 * （terminal 的唯一业务属主：市场 deal 与 terminal.send 同处一室）。
 *
 * 设计要点：
 *   - 决策无状态（每轮从世界快照现算），不新增 Memory 字段 —
 *     滞回由「捐赠地板 > 救助地板」的结构性不等式提供：
 *     受助房被补到 recipientFloor（20k）后仍远低于 donorFloor（50k），
 *     同一笔救助不可能让受助方翻转为捐赠方 — 震荡在结构上不可能。
 *   - 每轮至多一笔救助：terminal.send 有 10 tick 冷却，且单笔决策
 *     让「谁最饿、谁最富」的排序直白可解释。
 *   - 纯函数不碰 Game/Memory — 全部输入由调用方采集注入。
 */

/** 单房间的能量侧决策输入（调用方从 RoomSnapshot 采集）。 */
export interface RoomEnergyState {
  roomName: string;
  /** storage 能量存量（无 storage 为 0）。 */
  storageEnergy: number;
  /** 是否可发送（有 terminal 且冷却结束 — 由调用方过滤）。 */
  canSend: boolean;
  /** 是否可接收（有 terminal）。 */
  canReceive: boolean;
}

/** 能量互济的阈值选项。 */
export interface EnergyAidOptions {
  /** 救助地板：storage 低于此值 → 救助候选。 */
  recipientFloor: number;
  /** 捐赠地板：storage 高于此值才可捐赠；捐赠后仍须高于此值。 */
  donorFloor: number;
  /** 单次救助上限（以不掏空捐赠方 terminal 为界）。 */
  maxTransfer: number;
  /** 低于此量不送（能量运费不划算）。 */
  minTransfer: number;
}

/** 一笔跨房能量救助决策。 */
export interface EnergyAidPlan {
  /** 捐赠房（terminal.send 的发起方）。 */
  from: string;
  /** 受助房。 */
  to: string;
  /** 救助量（已受 recipientFloor/donorFloor/maxTransfer 三重约束）。 */
  amount: number;
}

/**
 * 规划一笔跨房能量救助（每轮至多一笔）。
 *
 * 规则：
 *   1. 救助候选：storage < recipientFloor，按缺口降序（最饿者先救）；
 *   2. 捐赠候选：canSend 且 storage > donorFloor，按盈余降序（最富者先捐）；
 *   3. 量 = min(缺口, 盈余, maxTransfer)，低于 minTransfer 不送；
 *   4. 同房不互济；受助候选须 canReceive（有 terminal 才收得到）。
 *
 * 无合格候选返回 undefined（调用方本 tick 不发送）。
 */
export function planEnergyAid(
  rooms: readonly RoomEnergyState[],
  opts: EnergyAidOptions,
): EnergyAidPlan | undefined {
  const recipients = rooms
    .filter(r => r.canReceive && r.storageEnergy < opts.recipientFloor)
    .map(r => ({ roomName: r.roomName, deficit: opts.recipientFloor - r.storageEnergy }))
    .sort((a, b) => b.deficit - a.deficit);
  if (recipients.length === 0) return undefined;

  const donors = rooms
    .filter(r => r.canSend && r.storageEnergy > opts.donorFloor)
    .map(r => ({ roomName: r.roomName, surplus: r.storageEnergy - opts.donorFloor }))
    .sort((a, b) => b.surplus - a.surplus);
  if (donors.length === 0) return undefined;

  for (const donor of donors) {
    for (const recipient of recipients) {
      if (donor.roomName === recipient.roomName) continue;
      const amount = Math.min(recipient.deficit, donor.surplus, opts.maxTransfer);
      if (amount < opts.minTransfer) continue;
      return { from: donor.roomName, to: recipient.roomName, amount };
    }
  }
  return undefined;
}

// ─── 能量市场交易（纯函数）──────────────────────────────────

/**
 * 能量卖出量：storage 溢出部分（高于 sellFloor），受单笔上限约束。
 * 只在真实盈余时卖 — 市场是能量出口，不是挤占运营库存的渠道。
 */
export function energySellAmount(storageEnergy: number, sellFloor: number, maxDeal: number): number {
  const surplus = storageEnergy - sellFloor;
  return surplus > 0 ? Math.min(surplus, maxDeal) : 0;
}

/**
 * 能量买入量：危机缺口（buyFloor − storage），受单笔上限与
 * credits 可负担量（调用方按最高买价预算）三重约束。
 */
export function energyBuyAmount(
  storageEnergy: number,
  buyFloor: number,
  maxDeal: number,
  affordable: number,
): number {
  const deficit = buyFloor - storageEnergy;
  if (deficit <= 0 || affordable <= 0) return 0;
  return Math.min(deficit, maxDeal, affordable);
}
