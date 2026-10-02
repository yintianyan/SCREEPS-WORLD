/**
 * 交易运费的**通道分桶**（#76）—— 只观测，不改任何价格阈值。
 *
 * 立案理由是实测：本服 `calcTransactionCost(1000, …)` 邻房 = 33、远房 = 856~865
 * （2026-10-02 线上 mark LH11）⇒ 运费占货量 3%~87% 随对手房变化。而卖出闸门
 * `CONFIG.energy.minEnergySellPrice` 是一个**不含运费项**的定值，且原先只有一个
 * 合计格 `tradeFee`（买料 / 卖矿 / 互济 / 卖能量全混在一起）⇒ "卖能量是不是在
 * 拿盈余买信用顺路烧盈余"这个问题在账上无法回答。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { executeDeal } from "../../../src/systems/trade/terminal-market";
import {
  emptyLedger,
  ledgerConsumption,
  ledgerIncome,
  type EnergyLedger,
} from "../../../src/domain/economy/accounting";
import { resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;
const ledgerOf = (room: string): any => g().energyLedger.rooms[room];

const COST = 856;

function stubMarket(dealResult: number): void {
  g().Game.market = {
    credits: 1000,
    orders: {},
    getAllOrders: () => [],
    calcTransactionCost: () => COST,
    deal: () => dealResult,
  };
}

function terminalWith(energy: number): any {
  return {
    store: {
      getUsedCapacity: (r: string) => (r === RESOURCE_ENERGY ? energy : 0),
      getFreeCapacity: () => 0,
    },
  };
}

const order = {
  id: "o1",
  roomName: "W1N1",
  price: 0.02,
  type: ORDER_BUY,
  resourceType: RESOURCE_ENERGY,
};

beforeEach(() => {
  resetGlobals();
  stubMarket(OK);
});

describe("executeDeal — 运费通道分桶", () => {
  it("卖能量：合计格与 sell 桶同时进账，buy 桶不动", () => {
    expect(executeDeal(order as any, 1000, terminalWith(5000), "W37S58", "energySell")).toBe(true);
    const l = ledgerOf("W37S58");
    expect(l.tradeFee).toBe(COST);
    expect(l.tradeFeeEnergySell).toBe(COST);
    expect(l.tradeFeeEnergyBuy).toBe(0);
  });

  it("买能量：进 buy 桶而非 sell 桶", () => {
    expect(executeDeal(order as any, 1000, terminalWith(5000), "W37S58", "energyBuy")).toBe(true);
    const l = ledgerOf("W37S58");
    expect(l.tradeFee).toBe(COST);
    expect(l.tradeFeeEnergyBuy).toBe(COST);
    expect(l.tradeFeeEnergySell).toBe(0);
  });

  it("未标通道的 deal 仍进合计格（「每一笔成功的 deal 都计费」这条结构不变量不因分桶而漏账）", () => {
    expect(executeDeal(order as any, 1000, terminalWith(5000), "W37S58")).toBe(true);
    const l = ledgerOf("W37S58");
    expect(l.tradeFee).toBe(COST);
    expect(l.tradeFeeEnergySell).toBe(0);
    expect(l.tradeFeeEnergyBuy).toBe(0);
  });

  it("不变式 tradeFee ≥ sell桶 + buy桶（多笔混合后仍成立）", () => {
    executeDeal(order as any, 1000, terminalWith(50000), "W37S58", "energySell");
    executeDeal(order as any, 1000, terminalWith(50000), "W37S58", "energySell");
    executeDeal(order as any, 1000, terminalWith(50000), "W37S58", "energyBuy");
    executeDeal(order as any, 1000, terminalWith(50000), "W37S58"); // 卖矿一类：只进合计
    const l = ledgerOf("W37S58");
    expect(l.tradeFee).toBe(4 * COST);
    expect(l.tradeFeeEnergySell + l.tradeFeeEnergyBuy).toBe(3 * COST);
    expect(l.tradeFee).toBeGreaterThanOrEqual(l.tradeFeeEnergySell + l.tradeFeeEnergyBuy);
  });

  it("deal 失败时两格都不进账（分桶写在 OK 分支内，不是前置扣款）", () => {
    stubMarket(ERR_INVALID_ARGS);
    expect(executeDeal(order as any, 1000, terminalWith(5000), "W37S58", "energySell")).toBe(false);
    expect(g().energyLedger).toBeUndefined();
  });

  it("新增两键是纯观测：不改收入/消费合计（否则同一笔运费被记两次，净流立刻失真）", () => {
    const base = emptyLedger();
    base.tradeFee = COST;
    base.harvested = 5000;
    const withChannels: EnergyLedger = { ...base, tradeFeeEnergySell: COST, tradeFeeEnergyBuy: 0 };
    expect(ledgerIncome(withChannels)).toBe(ledgerIncome(base));
    expect(ledgerConsumption(withChannels)).toBe(ledgerConsumption(base));
  });
});
