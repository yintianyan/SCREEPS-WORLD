/** 市场挂单决策 — 纯函数层（审计缺口 4：只吃单不挂单损失买卖价差）。 */

/** 挂单决策输入（执行层从 Game.market / snapshot 采集）。 */
export interface SellOrderInput {
  /** 资源类型。 */
  resourceType: string;
  /** 可售盈余（terminal + storage - 自用储备）。 */
  surplus: number;
  /** 本房该资源既存挂单的 id（有则不重复挂）。 */
  existingOrderId: string | undefined;
  /** 市场当前最优 buy 价（无 bid 市场不挂 — 无锚定价）。 */
  bestBuyPrice: number | undefined;
  /** 挂单价格溢价系数（1.15 = 比最优 bid 高 15%）。 */
  markup: number;
  /** 单笔挂单量上限（手续费与流动性暴露的封顶）。 */
  maxOrderAmount: number;
  /** 挂单量下限（低于此量的手续费不值得挂）。 */
  minOrderAmount: number;
  /** 竞品卖盘环境（可选 — 无则退化为纯 bid 锚定）。 */
  pricing?: SellPricingEnv;
}

/**
 * 竞品卖盘定价环境。市场无自动撮合：买家只吃最低 ask，仅锚 bid 的挂单在
 * 存在更便宜竞品时永远排不上队（terminal 长期积压的实证根因）。
 */
export interface SellPricingEnv {
  /** 竞品最低卖价（必须排除自有挂单，否则自我压价死循环）。 */
  competingAsk?: number;
  /** 卖出价值地板（动态行情下限）— 低于此价不卖。 */
  floor?: number;
  /** 压价步长（略大于报价粒度，确保严格低于竞品）。 */
  step?: number;
}

/**
 * 挂单定价锚点：min(bid × markup, 竞品 ask − step)，再抬到价值地板。
 * - bid 锚：挂单等买家的价差补偿（吃即刻成交的卖方溢价）。
 * - ask 锚：比最便宜的竞品卖单低一个步长，抢先成交。
 * - 地板：两个锚都跌破价值下限时取地板（宁可挂着不成交也不贱卖）。
 *
 * ⚠️ `floor` 必须是**绝对**价值地板（CONFIG 里的静态兜底价），不得由 bid 派生。
 * 市场无自动撮合 ⇒ bid 高于 ask 的交叉报价可长期并存；此时 `buyMax × 0.9` 会高于
 * `ask − step`，`max()` 把压价锚整个吃掉，挂单价恒落在最低竞品 ask 之上 ⇒ 永不成交
 *（官服实测：O bid 37.846 / 最低 ask 27.091 ⇒ 地板 34.06 压过 askAnchor 27.08，
 * 那张 5,000 单位的单挂了 4,646 拍零成交）。"我愿意接受的最低即时成交价"是 deal 侧
 * `pickBestBuyOrder(minPrice)` 的语义，不是挂单地板 —— 两个决策不共用一个数。
 */
export function anchorSellPrice(
  bestBuyPrice: number,
  markup: number,
  pricing: SellPricingEnv | undefined,
): number {
  const step = pricing?.step ?? 0.01;
  const floor = pricing?.floor ?? 0;
  const bidAnchor = bestBuyPrice * markup;
  const ask = pricing?.competingAsk;
  // ask 锚先按市场报价粒度（0.001）取整，消除浮点减法噪声（68.5-0.01=68.4899…）。
  const askAnchor =
    ask !== undefined && ask > 0 ? Math.round((ask - step) * 1000) / 1000 : bidAnchor;
  // 向下取两位小数（两位保守）——floor 而非 round，防止取整后反弹回竞品 ask 之上；
  // +1e-6 容差吸收浮点表示噪声（68.49×100 = 6848.999…），不影响真实分数位。
  return Math.floor((Math.max(floor, Math.min(bidAnchor, askAnchor)) + 1e-6) * 100) / 100;
}

/** 挂单计划。 */
export interface SellOrderPlan {
  resourceType: string;
  price: number;
  totalAmount: number;
}

/** 决策是否挂卖单：盈余充足 + 无在途挂单 + 有市场锚定 bid + 量达下限。 */
export function planSellOrder(input: SellOrderInput): SellOrderPlan | undefined {
  if (input.existingOrderId !== undefined) return undefined;
  if (input.bestBuyPrice === undefined || input.bestBuyPrice <= 0) return undefined;
  const totalAmount = Math.min(input.surplus, input.maxOrderAmount);
  if (totalAmount < input.minOrderAmount) return undefined;
  const price = anchorSellPrice(input.bestBuyPrice, input.markup, input.pricing);
  return { resourceType: input.resourceType, price, totalAmount };
}

/**
 * 撤单决策：挂龄超限且 remainingAmount 未减（零成交）→ 撤。
 *
 * ⚠️ 量纲是**拍**，不是毫秒 —— Screeps 的 Order 只有 `created`（拍号）这一个时间字段，
 * 没有 `createdTimestamp`。调用方曾经传 `order.createdTimestamp ?? 0` 配 `Date.now()`，
 * 于是 `now - 0 > stale` 恒真、这道闸形同不存在（每轮都判超龄）。算术本身没错，
 * 错的是喂进来的两把尺不同源。
 *
 * 与改价的分工（见 shouldChangeOrderPrice）：改价每轮跟行情、零成本，所以**不受挂龄约束**；
 * 撤单会重付一次挂单成本，所以只在"改不了价且真超龄"时发生。本函数只回答后者。
 */
export function shouldCancelStaleOrder(
  createdTick: number,
  remainingAmount: number,
  totalAmount: number,
  nowTick: number,
  staleTicks: number,
): boolean {
  if (remainingAmount <= 0) return true; // 已成交完的残单 — 清理
  if (remainingAmount < totalAmount) return false; // 有部分成交 — 价格有效，保留
  return nowTick - createdTick > staleTicks;
}

/**
 * 改价决策：挂龄超限且零成交，但市场 bid 仍存在 → 不撤单重挂（省 5% 手续费），
 * 直接 changeOrderPrice 到新价（随 bid 自适应下行）。

 * 返回值：undefined = 不改价（保留或走撤单路径）；number = 新价格。
 * 条件：① 零成交（remaining == total）；② 有新 bid 锚定；③ 新价与旧价差异超阈值
 * （价格不变改价无意义，且 changeOrderPrice 有调用成本）。
 * pricing 环境与 planSellOrder 同锚点（bid/竞品 ask 双锚 + 地板）。
 */
export function shouldChangeOrderPrice(
  remainingAmount: number,
  totalAmount: number,
  currentPrice: number,
  bestBuyPrice: number | undefined,
  markup: number,
  pricing?: SellPricingEnv,
): number | undefined {
  // 零成交才考虑改价（有部分成交说明价格有效）。
  if (remainingAmount < totalAmount) return undefined;
  if (bestBuyPrice === undefined || bestBuyPrice <= 0) return undefined;
  const newPrice = anchorSellPrice(bestBuyPrice, markup, pricing);
  // 价格变化需超过 5% 才值得改价（避免微小波动频繁触发）。
  if (Math.abs(newPrice - currentPrice) / currentPrice < 0.05) return undefined;
  return newPrice;
}
