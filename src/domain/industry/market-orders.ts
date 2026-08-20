/**
 * 市场挂单决策 — 纯函数层（审计缺口 4：只吃单不挂单损失买卖价差）。
 *
 * 背景：deal 吃单即刻成交但付价差（矿物流动性差，吃单往往贱卖 10-30%）；
 * createOrder 挂单等合理买家，代价是 5% 手续费 + 成交时滞。策略：大宗盈余
 * （吃单单笔消化不完）走挂单，价 = 当前最优 buy 价 × markup（比最优 bid
 * 略高的 ask，市场微观结构的合理溢价）。
 *
 * 生命周期：每房每资源至多 1 张挂单；挂龄超 staleMs 且零成交 → 撤单重挂
 *（重挂价随市场 bid 重算，天然自适应下行）。
 */

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
  // 价格向下取两位小数（市场最小报价粒度 0.001，两位保守）。
  const price = Math.round(input.bestBuyPrice * input.markup * 100) / 100;
  return { resourceType: input.resourceType, price, totalAmount };
}

/** 撤单决策：挂龄超限且 remainingAmount 未减（零成交）→ 撤。 */
export function shouldCancelStaleOrder(
  createdTimestamp: number,
  remainingAmount: number,
  totalAmount: number,
  nowMs: number,
  staleMs: number,
): boolean {
  if (remainingAmount <= 0) return true; // 已成交完的残单 — 清理
  if (remainingAmount < totalAmount) return false; // 有部分成交 — 价格有效，保留
  return nowMs - createdTimestamp > staleMs;
}

/**
 * 改价决策：挂龄超限且零成交，但市场 bid 仍存在 → 不撤单重挂（省 5% 手续费），
 * 直接 changeOrderPrice 到新价（随 bid 自适应下行）。
 *
 * 返回值：undefined = 不改价（保留或走撤单路径）；number = 新价格。
 * 条件：① 零成交（remaining == total）；② 有新 bid 锚定；③ 新价与旧价差异超阈值
 * （价格不变改价无意义，且 changeOrderPrice 有调用成本）。
 */
export function shouldChangeOrderPrice(
  remainingAmount: number,
  totalAmount: number,
  currentPrice: number,
  bestBuyPrice: number | undefined,
  markup: number,
): number | undefined {
  // 零成交才考虑改价（有部分成交说明价格有效）。
  if (remainingAmount < totalAmount) return undefined;
  if (bestBuyPrice === undefined || bestBuyPrice <= 0) return undefined;
  const newPrice = Math.round(bestBuyPrice * markup * 100) / 100;
  // 价格变化需超过 5% 才值得改价（避免微小波动频繁触发）。
  if (Math.abs(newPrice - currentPrice) / currentPrice < 0.05) return undefined;
  return newPrice;
}
