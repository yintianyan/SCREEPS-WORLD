/** Terminal 交易策略纯函数测试。 */
import { describe, expect, it } from "vitest";
import {
  getMineralDeficits,
  pickBestSellOrder,
  pickBestBuyOrder,
  planEnergySale,
  type MarketOrderSummary,
} from "../../../src/domain/industry/terminal-policy";

function order(overrides: Partial<MarketOrderSummary>): MarketOrderSummary {
  return { id: "o1", price: 1, amount: 1000, roomName: "W9N9", ...overrides };
}

describe("terminal-policy — getMineralDeficits", () => {
  it("库存为空时全部基础矿物都在缺口列表", () => {
    const deficits = getMineralDeficits({});
    const minerals = deficits.map(d => d.mineral).sort();
    expect(minerals).toEqual(["H", "K", "L", "O", "U", "X", "Z"]);
  });

  it("达标矿物不计入缺口，未达标的报告差额", () => {
    const deficits = getMineralDeficits({ H: 500, O: 100 });
    expect(deficits.find(d => d.mineral === "H")).toBeUndefined();
    expect(deficits.find(d => d.mineral === "O")?.deficit).toBe(400);
  });
});

describe("terminal-policy — pickBestSellOrder（买入用）", () => {
  it("选单价最低的卖单", () => {
    const best = pickBestSellOrder(
      [order({ id: "expensive", price: 2 }), order({ id: "cheap", price: 0.5 })],
      3,
    );
    expect(best?.id).toBe("cheap");
  });

  it("超过价格上限的订单被剔除", () => {
    const best = pickBestSellOrder([order({ price: 10 })], 1.5);
    expect(best).toBeUndefined();
  });

  it("同价时量大者优先（摊薄运费）", () => {
    const best = pickBestSellOrder(
      [order({ id: "small", price: 1, amount: 100 }), order({ id: "big", price: 1, amount: 900 })],
      2,
    );
    expect(best?.id).toBe("big");
  });

  it("零量或缺 roomName 的订单被剔除", () => {
    const best = pickBestSellOrder(
      [order({ amount: 0 }), order({ id: "noroom", roomName: undefined })],
      2,
    );
    expect(best).toBeUndefined();
  });
});

describe("terminal-policy — pickBestBuyOrder（卖出用）", () => {
  it("选单价最高的买单", () => {
    const best = pickBestBuyOrder(
      [order({ id: "low", price: 0.5 }), order({ id: "high", price: 1.2 })],
      0.3,
    );
    expect(best?.id).toBe("high");
  });

  it("低于价格底线的订单被剔除（不贱卖）", () => {
    const best = pickBestBuyOrder([order({ price: 0.1 })], 0.3);
    expect(best).toBeUndefined();
  });
});

describe("terminal-policy — planEnergySale", () => {
  const cost = (_amount: number, roomName: string) => (roomName === "far" ? 900 : 0);

  it("高单价但高运费的订单，净收益可能低于低价近单", () => {
    const plan = planEnergySale(
      [
        order({ id: "far", price: 1, roomName: "far" }),
        order({ id: "near", price: 2, roomName: "near" }),
      ],
      1000,
      10_000,
      0.01,
      cost,
    );
    expect(plan?.order.id).toBe("near");
    expect(plan?.proceeds).toBe(2000);
  });

  it("运费吃光可出货量 → 放弃成交", () => {
    const plan = planEnergySale([order({ price: 10, roomName: "far" })], 1000, 900, 0.01, cost);
    expect(plan).toBeUndefined();
  });

  it("实际出货量同时受订单余量和 terminal 能量约束", () => {
    const plan = planEnergySale(
      [order({ amount: 300, roomName: "far" })],
      1000,
      250,
      0.01,
      () => 100,
    );
    expect(plan?.amount).toBe(150);
    expect(plan?.fee).toBe(100);
  });
});
