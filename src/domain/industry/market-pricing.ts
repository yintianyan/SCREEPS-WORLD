/** 市场动态定价纯函数 — 替代 CONFIG 中的静态死价格。 */
import type { MarketPriceSnapshot } from "../../kernel/global-cache";

/** 行情快照表（资源类型 → 价格快照）。 */
export type PriceTable = Readonly<Record<string, MarketPriceSnapshot>>;

/**
 * 计算买入价格上限（用于 pickBestSellOrder 的 maxPrice 参数）。

 * 策略：取市场最低卖价 × buyPremium。无卖单时回退到 fallbackPrice。
 * fallbackPrice 为 CONFIG 中的静态值 — 仅在行情空窗期兜底，正常运行时不生效。

 * @param resource 资源类型。
 * @param prices 行情快照表。
 * @param buyPremium 溢价系数（1.1 = 比最低卖价高 10% 确保吃到单子）。
 * @param fallbackPrice 行情缺失时的兜底价格（CONFIG 静态值）。
 * @returns 买入价格上限。0 = 无行情且无 fallback = 不买。
 */
export function computeDynamicBuyPrice(
  resource: string,
  prices: PriceTable,
  buyPremium: number,
  fallbackPrice: number,
): number {
  const snapshot = prices[resource];
  if (snapshot && snapshot.sellMin > 0) {
    return snapshot.sellMin * buyPremium;
  }
  return fallbackPrice;
}

/**
 * 计算卖出价格下限（用于 pickBestBuyOrder 的 minPrice 参数）。

 * 策略：取市场最高买价 × sellDiscount。无买单时回退到 absoluteFloor。
 * absoluteFloor 为 CONFIG 中的静态地板值 — 防止无买盘时以 0 价格挂单。

 * @param resource 资源类型。
 * @param prices 行情快照表。
 * @param sellDiscount 折价系数（0.9 = 比最高买价低 10% 确保成交）。
 * @param absoluteFloor 绝对地板价（CONFIG 静态值，防 0 价格）。
 * @returns 卖出价格下限。
 */
export function computeDynamicSellPrice(
  resource: string,
  prices: PriceTable,
  sellDiscount: number,
  absoluteFloor: number,
): number {
  const snapshot = prices[resource];
  if (snapshot && snapshot.buyMax > 0) {
    return Math.max(snapshot.buyMax * sellDiscount, absoluteFloor);
  }
  return absoluteFloor;
}

/**
 * 从订单列表中采集行情快照（最低卖价 / 最高买价）。

 * terminal-manager 在每 interval tick 调用此函数刷新行情。
 * 只采集目标资源列表（控制遍历范围），避免全市场扫描。

 * @param resources 要采集的资源列表。
 * @param sellOrders 各资源的卖单列表（已按价格排序更佳，但不强制）。
 * @param buyOrders 各资源的买单列表。
 * @returns 资源 → { sellMin, buyMax } 映射。
 */
export function collectMarketPrices(
  resources: readonly string[],
  sellOrders: Readonly<Record<string, readonly { price: number }[]>>,
  buyOrders: Readonly<Record<string, readonly { price: number }[]>>,
): Record<string, MarketPriceSnapshot> {
  const result: Record<string, MarketPriceSnapshot> = {};
  for (const res of resources) {
    const sells = sellOrders[res];
    const buys = buyOrders[res];
    let sellMin = 0;
    let buyMax = 0;
    if (sells && sells.length > 0) {
      sellMin = Math.min(...sells.map(o => o.price));
    }
    if (buys && buys.length > 0) {
      buyMax = Math.max(...buys.map(o => o.price));
    }
    result[res] = { sellMin, buyMax };
  }
  return result;
}

/**
 * 挂单定价：基于行情快照的最优买价 × markup 计算挂单价。

 * 替代旧的 planSellOrder 中直接用 bestBuyPrice × markup 的逻辑 —
 * 行情快照版本不依赖当前 tick 的 getAllOrders（挂单操作不占 terminal 冷却，
 * 但 getAllOrders 开销仍需控制；复用已采集的行情快照零额外开销）。

 * @param resource 资源类型。
 * @param prices 行情快照表。
 * @param markup 挂单溢价系数（1.15 = 比最优 bid 高 15%）。
 * @param fallbackFloor 行情缺失时的兜底挂单价。
 * @returns 挂单价格（向下取两位小数）。undefined = 无行情且无 fallback = 不挂。
 */
export function computeOrderPrice(
  resource: string,
  prices: PriceTable,
  markup: number,
  fallbackFloor: number,
): number | undefined {
  const snapshot = prices[resource];
  if (snapshot && snapshot.buyMax > 0) {
    return Math.round(snapshot.buyMax * markup * 100) / 100;
  }
  if (fallbackFloor > 0) {
    return fallbackFloor;
  }
  return undefined;
}
