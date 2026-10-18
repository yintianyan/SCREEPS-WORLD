/** 市场动态定价纯函数 — 替代 CONFIG 中的静态死价格。 */
import type { MarketPriceSnapshot } from "../../kernel/global-cache";

/** 行情快照表（资源类型 → 价格快照）。 */
export type PriceTable = Readonly<Record<string, MarketPriceSnapshot>>;

/**
 * 计算买入价格上限（用于 pickBestSellOrder 的 maxPrice 参数）。

 * 策略：市场最低卖价 × buyPremium，然后**无条件**再套一层 ceiling 硬上限。
 *
 * ceiling 同时扮演两个角色，而且这两件事本来就该是同一个数：行情空窗期照它定价、
 * 行情在位时受它封顶。旧写法只在无行情时用 ceiling（文档原话「正常运行时不生效」），
 * 于是「我们最多肯为一单位付多少」这条闸在有行情时等于不存在 —— 官服实测后果：
 * GH2O 唯一在位的卖单 2260.78/t ⇒ 门禁价 2486 ⇒ 成交，一次 50 单花掉 113,000 credits；
 * X 在 ceiling 配的是 240，却按 325.75 买过。两份读数的代价合起来是两小时 373K credits。
 * 一个只有「无数据时才生效」的价格上限，语义上不是上限（家族：同一字段两种语义）。
 *
 * @param resource 资源类型。
 * @param prices 行情快照表。
 * @param buyPremium 溢价系数（1.1 = 比最低卖价高 10% 确保吃到单子）。
 * @param ceiling 单单位愿意付的上限（CONFIG 静态值）：无行情时即价格上限，有行情时封顶。
 * @returns 买入价格上限。0 = 无行情且无 ceiling = 不买。
 */
export function computeDynamicBuyPrice(
  resource: string,
  prices: PriceTable,
  buyPremium: number,
  ceiling: number,
): number {
  const snapshot = prices[resource];
  if (snapshot && snapshot.sellMin > 0) {
    return Math.min(snapshot.sellMin * buyPremium, ceiling);
  }
  return ceiling;
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
 * commodity 批次正 ROI 判据（纯函数）—— factory 原料缺口的采购需求只有在
 * 「买齐缺料的代价 ≤ 产物卖出额 ÷ (1 + margin)」时才允许上报。
 *
 * 为什么要这道闸：买中间品产商品在某些行情下是**深度倒挂**的投资
 * （线上实测 @00:51Z：一批 wire 产 20 只需 20 utrium_bar(279.7) + 100 silicon(2973.639)
 * = 302,958 credits，而 wire 最高买单 253.16 ⇒ 回收率 1.7%）。没有这道闸，
 * 「缺料就上报需求」会把国库接到一条稳定亏损的通道上。
 *
 * 口径取舍（写清以免被误读成"完整成本核算"）：
 * · 能量按自有产能计，**不计入买入成本**（配方能量由 distributor 从 storage 供）；
 * · 任一缺料没有卖单（`sellMin===0`）或产物没有买单（`buyMax===0`）⇒ 判不可行：
 *   前者买不到、后者卖了等于砸在手里；
 * · margin 只近似覆盖运费/手续费/冷却机会成本 —— 跨房运费依赖目标房，这里不精确算，
 *   用一个有余量的比例代替，宁可放过也不买错。
 */
export function commodityBatchRoi(
  missingToBuy: Readonly<Record<string, number>>,
  prices: Readonly<Record<string, MarketPriceSnapshot>>,
  productType: string,
  batchUnits: number,
  margin: number,
): { profitable: boolean; cost: number; revenue: number } {
  let cost = 0;
  for (const [res, qty] of Object.entries(missingToBuy)) {
    if (res === "energy" || qty <= 0) continue;
    const quote = prices[res];
    if (!quote || quote.sellMin <= 0) return { profitable: false, cost: 0, revenue: 0 };
    cost += quote.sellMin * qty;
  }
  const revenue = (prices[productType]?.buyMax ?? 0) * Math.max(1, batchUnits);
  if (revenue <= 0) return { profitable: false, cost, revenue: 0 };
  return { profitable: revenue >= cost * (1 + margin), cost, revenue };
}

/**
 * commodity「转换」正 ROI 判据（纯函数）—— 用**自有库存**产商品时的机会成本闸。
 *
 * 为什么不能复用 `commodityBatchRoi`：那是另一把尺，两个问题必须分开估。
 * · `commodityBatchRoi` 问「要不要**花钱买料**来产」⇒ 成本按 `sellMin`（买入代价）；
 * · 本函数问「要不要把**已经在手**的料转化掉」⇒ 成本按 `buyMax`
 *   （这批料此刻直接卖能拿到的钱 ＝ 真实机会成本）。
 * 用 `sellMin` 估自有库存会系统性高估收益：官服 shard3 实测（tick 83,725,692）
 * O 的 `sellMin` 27.091 而 `buyMax` 37.846 —— 市场无自动撮合，交叉报价可长期并存，
 * 两把尺差 40%。按 `sellMin` 算 oxidant 回收率 99%（看着快打平），按 `buyMax` 算只有 71%。
 *
 * 能量同样计入机会成本（与 `commodityBatchRoi` 的取舍相反）：那条尺问的是"要不要额外
 * 花钱买料"，而能量从不买入、按自有产能计；这条尺问的是"这批能量拿去卖是不是更值"，
 * 而能量在本服有活跃买盘（实测 `buyMax` 32.186）⇒ 烧进 factory 就是放弃了这笔钱。
 * 满仓压缩链（`storageNearFull`）不走本闸 —— 那条链的语义是"能量马上要在源头被浪费"，
 * 止损不等于增值，见 factory-manager.ts 的 battery 压缩分支。
 *
 * `judgeable` 必须与 `profitable` 分开返回（本仓库纪律：判不了 ≠ 不划算）：
 * 行情表整个为空（私服/测试环境无市场 API）时判不了，调用方**不得**据此停产。
 * 单个组件两价都缺同样判不了；产物无买盘则是"判得了且不划算"（卖了砸在手里）。
 *
 * @param components 单批配方（含 energy 项，按机会成本计）。
 * @param prices 行情快照表。
 * @param productType 产物资源类型。
 * @param batchUnits 单批产量（`COMMODITIES[x].amount`）。
 * @param margin 余量系数（与 `commodityRoiMargin` 同值同义：覆盖运费/手续费/冷却机会成本）。
 */
export function commodityConvertRoi(
  components: Readonly<Record<string, number>>,
  prices: Readonly<Record<string, MarketPriceSnapshot>>,
  productType: string,
  batchUnits: number,
  margin: number,
): { profitable: boolean; judgeable: boolean; cost: number; revenue: number } {
  const unjudgeable = { profitable: false, judgeable: false, cost: 0, revenue: 0 };
  let cost = 0;
  for (const [res, qty] of Object.entries(components)) {
    if (qty <= 0) continue;
    const quote = prices[res];
    // 机会成本优先取买盘（能立刻变现的价）；无买盘时退到卖盘（至少知道它值多少）。
    const unit = quote ? (quote.buyMax > 0 ? quote.buyMax : quote.sellMin) : 0;
    if (unit <= 0) return unjudgeable;
    cost += unit * qty;
  }
  const productBid = prices[productType]?.buyMax ?? 0;
  if (productBid <= 0) return { profitable: false, judgeable: true, cost, revenue: 0 };
  const revenue = productBid * Math.max(1, batchUnits);
  return { profitable: revenue >= cost * (1 + margin), judgeable: true, cost, revenue };
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
