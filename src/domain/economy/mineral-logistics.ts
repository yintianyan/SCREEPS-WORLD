/** 帝国矿物互济 — 纯函数决策层，执行层在 systems/terminal-manager.ts。 */
import { getMineralDeficits } from "../industry/terminal-policy";

/** 单房间的矿物侧决策输入（调用方从 RoomSnapshot 采集）。 */
export interface RoomMineralState {
  roomName: string;
  /** 本房 home mineral 类型（无 extractor/快照缺失为 undefined — 该房无供给能力）。 */
  homeMineral?: string;
  /** storage+terminal 的 homeMineral 合计存量。 */
  homeStock: number;
  /** storage+terminal 的各矿物合计库存（缺口计算的输入）。 */
  inventory: Readonly<Record<string, number>>;
  /** 是否可发送（有 terminal 且冷却结束 — 由调用方过滤）。 */
  canSend: boolean;
  /** 是否可接收（有 terminal）。 */
  canReceive: boolean;
}

/** 矿物互济的阈值选项。 */
export interface MineralAidOptions {
  /** 捐赠保留量 — 与市场卖出同口径（sellReserve），捐赠后仍须留足自用。 */
  donorReserve: number;
  /** 单次互济上限（以不掏空捐赠方 terminal 为界）。 */
  maxTransfer: number;
  /** 低于此量不送（不值得占用一次 terminal 冷却与运费）。 */
  minTransfer: number;
}

/** 一笔跨房矿物互济决策。 */
export interface MineralAidPlan {
  /** 捐赠房（terminal.send 的发起方）。 */
  from: string;
  /** 接收房。 */
  to: string;
  /** 互济的矿物类型。 */
  mineral: string;
  /** 互济量（已受缺口/盈余/上限三重约束）。 */
  amount: number;
}

/**
 * 规划一笔跨房矿物互济（每轮至多一笔）。缺口最大者优先（反应链最先卡在
 * 存量最少的原料上，与市场买入同排序口径）；同缺口下最富捐赠者优先；
 * 同房不互济；无合格候选返回 undefined（调用方本 tick 不发送）。
 */
export function planMineralAid(
  rooms: readonly RoomMineralState[],
  opts: MineralAidOptions,
): MineralAidPlan | undefined {
  // 需求侧：所有可接收房的基础矿物缺口，按缺口降序。
  const needs: Array<{ roomName: string; mineral: string; deficit: number }> = [];
  for (const room of rooms) {
    if (!room.canReceive) continue;
    for (const d of getMineralDeficits(room.inventory)) {
      needs.push({ roomName: room.roomName, mineral: d.mineral, deficit: d.deficit });
    }
  }
  needs.sort((a, b) => b.deficit - a.deficit);
  if (needs.length === 0) return undefined;

  // 供给侧：各房 homeMineral 盈余（超出捐赠保留量），按盈余降序。
  const donors = rooms
    .filter(r => r.canSend && r.homeMineral !== undefined && r.homeStock > opts.donorReserve)
    .map(r => ({ roomName: r.roomName, mineral: r.homeMineral!, surplus: r.homeStock - opts.donorReserve }))
    .sort((a, b) => b.surplus - a.surplus);
  if (donors.length === 0) return undefined;

  for (const need of needs) {
    const donor = donors.find(
      d => d.mineral === need.mineral && d.roomName !== need.roomName && d.surplus >= opts.minTransfer,
    );
    if (!donor) continue;
    const amount = Math.min(need.deficit, donor.surplus, opts.maxTransfer);
    if (amount < opts.minTransfer) continue;
    return { from: donor.roomName, to: need.roomName, mineral: donor.mineral, amount };
  }
  return undefined;
}
