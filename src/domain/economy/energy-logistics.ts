/** 帝国能量互济与能量市场 — 纯函数决策层（R5 经济主线），执行层在 */

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

  to: string;
  /** 救助量（已受 recipientFloor/donorFloor/maxTransfer 三重约束）。 */
  amount: number;
}

/**
 * 规划一笔跨房能量救助（每轮至多一笔）。最饿者先救、最富者先捐；
 * 同房不互济；无合格候选返回 undefined（调用方本 tick 不发送）。
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


/**
 * 能量卖出量：仅真实盈余（storage 高于 sellFloor）才卖，受单笔上限约束 —
 * 市场是能量出口，不是挤占运营库存的渠道。
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
