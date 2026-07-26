/**
 * Terminal 交易与备货策略 — 纯函数层。
 *
 * 单房间只产一种矿物，lab 反应链需要多矿种原料 — terminal 市场交易是
 * 多房间/跨帝国补给接入前唯一的原料来源，也是 credits 的唯一收入
 *（卖出本房盈余矿物 → 买入缺口矿物，形成自给的贸易闭环）。
 *
 * 分工：
 *   - 本文件：库存缺口计算、订单挑选（纯函数，Vitest 可测）
 *   - systems/terminal-manager.ts：getAllOrders/deal 等 Game.market 调用
 *   - distributor 的 stockTerminalEnergy action：维持 terminal 能量（交易运费）
 */
import type { TerminalPolicy, TerminalTransfer } from "./types";

/** 基础矿物库存目标（每种至少保留的量）。 */
const MINERAL_RESERVE_TARGET: Readonly<Record<string, number>> = {
  H: 500,
  O: 500,
  U: 500,
  L: 500,
  K: 500,
  Z: 500,
  X: 200,
};

/**
 * 单房间 Terminal 策略 — 当前为空操作（no-op）。
 * 未来多房间时替换为实际调度逻辑。
 */
export const singleRoomTerminalPolicy: TerminalPolicy = {
  planTransfers(_roomName: string, _available: Readonly<Record<string, number>>): readonly TerminalTransfer[] {
    // 单房间阶段：不主动发送
    return [];
  },
};

/**
 * 检查房间是否缺少某种基础矿物（用于市场采购决策）。
 *
 * @param available 当前库存
 * @returns 缺少的矿物列表及缺口量
 */
export function getMineralDeficits(
  available: Readonly<Record<string, number>>,
): Array<{ mineral: string; deficit: number }> {
  const deficits: Array<{ mineral: string; deficit: number }> = [];
  for (const [mineral, target] of Object.entries(MINERAL_RESERVE_TARGET)) {
    const have = available[mineral] ?? 0;
    if (have < target) {
      deficits.push({ mineral, deficit: target - have });
    }
  }
  return deficits;
}

// ─── 市场订单挑选（纯函数） ─────────────────────────────────

/** 订单摘要 — 只保留决策所需字段，不持有 Game.market 的 Order 对象。 */
export interface MarketOrderSummary {
  id: string;
  /** 单价（credits/单位）。 */
  price: number;
  /** 剩余可成交量。 */
  amount: number;
  /** 对方 terminal 所在房（计算能量运费用）。 */
  roomName?: string;
}

/**
 * 从卖单中挑最优买入目标：单价不超上限，价低者优先，同价量大者优先
 *（一次 deal 吃满批量，摊薄能量运费）。
 */
export function pickBestSellOrder(
  orders: readonly MarketOrderSummary[],
  maxPrice: number,
): MarketOrderSummary | undefined {
  let best: MarketOrderSummary | undefined;
  for (const o of orders) {
    if (o.price > maxPrice) continue;
    if (o.amount <= 0 || !o.roomName) continue;
    if (!best || o.price < best.price || (o.price === best.price && o.amount > best.amount)) {
      best = o;
    }
  }
  return best;
}

/**
 * 从买单中挑最优卖出目标：单价不低于底线，价高者优先，同价量大者优先。
 */
export function pickBestBuyOrder(
  orders: readonly MarketOrderSummary[],
  minPrice: number,
): MarketOrderSummary | undefined {
  let best: MarketOrderSummary | undefined;
  for (const o of orders) {
    if (o.price < minPrice) continue;
    if (o.amount <= 0 || !o.roomName) continue;
    if (!best || o.price > best.price || (o.price === best.price && o.amount > best.amount)) {
      best = o;
    }
  }
  return best;
}
