/** Terminal 交易与备货策略 — 纯函数层。单房只产一种矿物，而 lab 反应链需要 */

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

/** 低于 MINERAL_RESERVE_TARGET 的矿物缺口列表（供市场采购决策）。 */
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

/** 订单摘要 — 纯数据（决策所需字段），不持有 Game.market 的 Order 对象。 */
export interface MarketOrderSummary {
  id: string;
  /** 成交回执归因用；不参与订单挑选。 */
  type?: "buy" | "sell";
  /** 单价（credits/单位）。 */
  price: number;
  /** 剩余可成交量。 */
  amount: number;
  /** 对方 terminal 所在房（计算能量运费用）。 */
  roomName?: string;
  /** 成交回执归因用；不参与订单挑选。 */
  resourceType?: MarketResourceConstant;
}

/** 挑最优卖单：单价不超上限、价低优先、同价量大优先（一次 deal 吃满批量摊薄运费）。 */
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

/** 挑最优买单：单价不低于底线、价高优先、同价量大优先（卖出方向镜像）。 */
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

export interface EnergySalePlan {
  order: MarketOrderSummary;
  amount: number;
  fee: number;
  proceeds: number;
  netPrice: number;
}

/** 按扣除能量运费后的实际出货量挑选买单；运费吃光货量时放弃成交。 */
export function planEnergySale(
  orders: readonly MarketOrderSummary[],
  requestedAmount: number,
  terminalEnergy: number,
  minPrice: number,
  transactionCost: (amount: number, roomName: string) => number,
): EnergySalePlan | undefined {
  let best: EnergySalePlan | undefined;
  for (const order of orders) {
    if (order.price < minPrice || order.amount <= 0 || !order.roomName) continue;
    let amount = Math.min(requestedAmount, order.amount);
    if (amount <= 0) continue;
    let fee = transactionCost(amount, order.roomName);
    if (amount + fee > terminalEnergy) {
      amount = terminalEnergy - fee;
      if (amount <= 0) continue;
      fee = transactionCost(amount, order.roomName);
    }
    const proceeds = amount * order.price;
    const netPrice = proceeds / (amount + fee);
    if (!best || netPrice > best.netPrice || (netPrice === best.netPrice && fee < best.fee)) {
      best = { order, amount, fee, proceeds, netPrice };
    }
  }
  return best;
}
