/** 市场挂单 + pixel 出售测试（审计缺口 4+5）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { terminalManagerSystem } from "../../../src/systems/trade/terminal-manager";
import { CONFIG } from "../../../src/config";
import {
  anchorSellPrice,
  planSellOrder,
  shouldCancelStaleOrder,
  shouldChangeOrderPrice,
} from "../../../src/domain/industry/market-orders";
import { mockBudget, mockSnapshot, resetGlobals } from "../../support/factories";

function terminalMock(resources: Record<string, number> = {}): any {
  return {
    cooldown: 0,
    store: {
      ...resources,
      getUsedCapacity: vi.fn((r?: string) => (r ? (resources[r] ?? 0) : 0)),
      getFreeCapacity: vi.fn(() => 300000),
    },
    send: vi.fn(() => OK),
  };
}

function makeContext(snapshots: any[]): any {
  const map: Record<string, any> = {};
  for (const s of snapshots) map[s.roomName] = s;
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget("healthy"),
    globalSiteCount: 0,
    getSnapshot: vi.fn((name: string) => map[name]),
    snapshots: vi.fn(function* () {
      for (const s of snapshots) yield s;
    }),
  };
}

/** 按订单类型区分的行情 mock — 卖单查询命中竞品 ask，买单查询命中 bid。 */
function marketOrdersMock(sells: any[], buys: any[]): any {
  return vi.fn(({ type }: any) => (type === ORDER_SELL ? sells : buys));
}

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Game.cpu.bucket = 10000;
});

describe("planSellOrder — 挂单决策纯函数", () => {
  const base = {
    resourceType: "U",
    markup: 1.15,
    maxOrderAmount: 5000,
    minOrderAmount: 1000,
  };

  it("盈余 + bid 锚定 → 挂单价 = bid × markup（两位小数）", () => {
    const plan = planSellOrder({
      ...base,
      surplus: 8000,
      existingOrderId: undefined,
      bestBuyPrice: 0.8,
    });
    expect(plan).toEqual({ resourceType: "U", price: 0.92, totalAmount: 5000 });
  });

  it("在途挂单 → 不重复挂", () => {
    expect(
      planSellOrder({ ...base, surplus: 8000, existingOrderId: "o1", bestBuyPrice: 0.8 }),
    ).toBeUndefined();
  });

  it("无 bid 锚定（死市场）→ 不挂", () => {
    expect(
      planSellOrder({
        ...base,
        surplus: 8000,
        existingOrderId: undefined,
        bestBuyPrice: undefined,
      }),
    ).toBeUndefined();
  });

  it("盈余量低于下限 → 不挂（手续费不值得）", () => {
    expect(
      planSellOrder({ ...base, surplus: 500, existingOrderId: undefined, bestBuyPrice: 0.8 }),
    ).toBeUndefined();
  });
});

describe("anchorSellPrice — bid/竞品 ask 双锚定价", () => {
  it("无竞品卖盘 → 纯 bid × markup", () => {
    expect(anchorSellPrice(0.8, 1.15, undefined)).toBe(0.92);
  });

  it("竞品 ask 低于 bid 锚 → 压价到 ask − step 抢先成交", () => {
    // bid 锚 92 > ask 锚 68.49 → 取 ask 锚。
    expect(anchorSellPrice(80, 1.15, { competingAsk: 68.5, step: 0.01 })).toBe(68.49);
  });

  it("竞品 ask 高于 bid 锚 → bid 锚生效（本就是最低卖价）", () => {
    expect(anchorSellPrice(80, 1.15, { competingAsk: 95, step: 0.01 })).toBe(92);
  });

  it("地板托底：ask 锚跌破地板 → 取地板（不贱卖）", () => {
    expect(anchorSellPrice(80, 1.15, { competingAsk: 1, floor: 5, step: 0.01 })).toBe(5);
  });

  it("floor 取整不反弹回竞品 ask 之上", () => {
    // ask=68.318 → ask 锚 68.308 → floor2=68.30 < 68.318。
    expect(anchorSellPrice(80, 1.15, { competingAsk: 68.318, step: 0.01 })).toBe(68.3);
  });
});

describe("shouldChangeOrderPrice — 改价决策（含竞品 ask 锚）", () => {
  it("零成交 + 价格变化超 5% → 改价到双锚价", () => {
    const next = shouldChangeOrderPrice(5000, 5000, 83.25, 70, 1.15, {
      competingAsk: 68.5,
      floor: 0.5,
      step: 0.01,
    });
    expect(next).toBe(68.49);
  });

  it("价格变化不足 5% → 不改价", () => {
    expect(
      shouldChangeOrderPrice(5000, 5000, 68.49, 70, 1.15, {
        competingAsk: 68.5,
        floor: 0.5,
        step: 0.01,
      }),
    ).toBeUndefined();
  });
});

describe("shouldCancelStaleOrder — 撤单决策纯函数", () => {
  const STALE = 1000;

  it("残单（remainingAmount=0）→ 清撤", () => {
    expect(shouldCancelStaleOrder(0, 0, 5000, 100, STALE)).toBe(true);
  });

  it("部分成交（remaining < total）→ 保留（价格有效）", () => {
    expect(shouldCancelStaleOrder(0, 3000, 5000, 100, STALE)).toBe(false);
  });

  it("超龄零成交 → 撤（价格随新 bid 重挂）", () => {
    expect(shouldCancelStaleOrder(0, 5000, 5000, 1001, STALE)).toBe(true);
    expect(shouldCancelStaleOrder(0, 5000, 5000, 999, STALE)).toBe(false);
  });
});

describe("terminal-manager — 挂单与 pixel 集成", () => {
  it("大宗矿物盈余 → createOrder（价 = bid × markup，无竞品卖盘）", () => {
    const createOrder = vi.fn(() => OK);
    (globalThis as any).Game.market = {
      credits: 1000,
      getAllOrders: marketOrdersMock(
        [], // 无竞品卖单
        [{ id: "b1", price: 0.8, remainingAmount: 10000, roomName: "W9N9" }],
      ),
      calcTransactionCost: vi.fn(() => 100),
      deal: vi.fn(() => OK),
      orders: {},
      createOrder,
      cancelOrder: vi.fn(() => OK),
    };
    // terminal 6000 + storage 0 - 3000 储备 = 3000 盈余 ≥ minOrderAmount。
    const snap = mockSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ U: 6000 }),
      minerals: [{ mineralType: "U" }] as any,
    });

    terminalManagerSystem.run(makeContext([snap]));

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sell",
        resourceType: "U",
        price: 0.92,
        totalAmount: 3000,
        roomName: "W7N4",
      }),
    );
  });

  it("存在更便宜竞品卖盘 → createOrder 压价到竞品 ask − step", () => {
    const createOrder = vi.fn(() => OK);
    (globalThis as any).Game.market = {
      credits: 1000,
      getAllOrders: marketOrdersMock(
        [{ id: "rival1", price: 68.5, remainingAmount: 9000, roomName: "W9N8" }],
        [{ id: "b1", price: 70, remainingAmount: 10000, roomName: "W9N9" }],
      ),
      calcTransactionCost: vi.fn(() => 100),
      deal: vi.fn(() => OK),
      orders: {},
      createOrder,
      cancelOrder: vi.fn(() => OK),
    };
    const snap = mockSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ U: 6000 }),
      minerals: [{ mineralType: "U" }] as any,
    });

    terminalManagerSystem.run(makeContext([snap]));

    // bid 锚 80.5 > ask 锚 68.49 → 压价。
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sell", resourceType: "U", price: 68.49 }),
    );
  });

  it("自有挂单不参与竞品 ask（防自我压价）", () => {
    const createOrder = vi.fn(() => OK);
    (globalThis as any).Game.market = {
      credits: 1000,
      getAllOrders: marketOrdersMock(
        [
          { id: "mine1", price: 0.5, remainingAmount: 5000, roomName: "W7N4" },
          { id: "rival1", price: 68.5, remainingAmount: 9000, roomName: "W9N8" },
        ],
        [{ id: "b1", price: 70, remainingAmount: 10000, roomName: "W9N9" }],
      ),
      calcTransactionCost: vi.fn(() => 100),
      deal: vi.fn(() => OK),
      orders: {
        mine1: { type: "sell", roomName: "W7N4", resourceType: "O", remainingAmount: 5000 },
      },
      createOrder,
      cancelOrder: vi.fn(() => OK),
    };
    // U 无在途挂单（mine1 是 O）→ U 走创建路径；U 的竞品 ask 缓存若把 mine1
    // 算进去会把价格压到 0.49，排除后取 rival1 68.5。
    const snap = mockSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ U: 6000, O: 30000 }),
      minerals: [{ mineralType: "U" }] as any,
    });

    terminalManagerSystem.run(makeContext([snap]));

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sell", resourceType: "U", price: 68.49 }),
    );
  });

  it("pixel 账户资源 → 吃最优 buy 单 deal（账户交割无 room）", () => {
    const deal = vi.fn(() => OK);
    (globalThis as any).Game.market = {
      credits: 1000,
      getAllOrders: vi.fn(({ resourceType }: any) =>
        resourceType === "pixel"
          ? [{ id: "px1", price: 500, remainingAmount: 100, roomName: undefined }]
          : [],
      ),
      calcTransactionCost: vi.fn(() => 100),
      deal,
      orders: {},
      createOrder: vi.fn(() => OK),
      cancelOrder: vi.fn(() => OK),
    };
    (globalThis as any).Game.resources = { pixel: 50 };

    terminalManagerSystem.run(
      makeContext([mockSnapshot({ roomName: "W7N4", terminal: terminalMock() })]),
    );

    expect(deal).toHaveBeenCalledWith("px1", 50);
  });
});

/**
 * 交叉市场（bid > ask）下的挂单定价与生命周期 —— 2026-10-18 官服 shard3 实证。
 *
 * 现场账（tick 83,725,711 行情 / 83,725,696 自有挂单）：
 *   O 最优买 37.846、最低竞品卖 27.091 ⇒ bid > ask。市场无自动撮合，交叉报价可长期并存。
 *   自有挂单 sell O 5,000 @36.38 —— 已挂 4,646 拍零成交；
 *   自有挂单 sell Z 1,150 @18.13 —— 已挂 46,535 拍零成交（Z 的 bid 只有 12.541）。
 *   同期 W37S58 terminal 用掉 278,956/300,000（93%），其中 O 117,009 单位。
 * 旧地板 = computeDynamicSellPrice = max(buyMax × 0.9, 0.5) = 34.06，高于
 * askAnchor = 27.081 ⇒ anchorSellPrice 的 max() 把压价锚整个吃掉，挂单价恒落在
 * 最低竞品 ask 之上 6.97，而买家只吃最低 ask ⇒ 这张单永远排不上队。
 */
describe("terminal-manager — 交叉市场挂单定价与生命周期", () => {
  const RIVAL_ASK = 27.091;
  const BEST_BID = 37.846;

  function crossedMarket(overrides: Record<string, any> = {}): Record<string, any> {
    return {
      credits: 1000,
      getAllOrders: marketOrdersMock(
        [{ id: "rival1", price: RIVAL_ASK, remainingAmount: 800, roomName: "W9N8" }],
        [{ id: "b1", price: BEST_BID, remainingAmount: 5446, roomName: "W9N9" }],
      ),
      calcTransactionCost: vi.fn(() => 100),
      deal: vi.fn(() => OK),
      createOrder: vi.fn(() => OK),
      changeOrderPrice: vi.fn(() => OK),
      cancelOrder: vi.fn(() => OK),
      orders: {},
      ...overrides,
    };
  }

  /** 自有零成交挂单（remaining == total）。`created` 是拍号 —— Screeps 的 Order 没有 createdTimestamp。 */
  function ownSellOrder(overrides: Record<string, any> = {}): Record<string, any> {
    return {
      o1: {
        id: "o1",
        type: "sell",
        roomName: "W7N4",
        resourceType: "O",
        price: 36.38,
        remainingAmount: 5000,
        totalAmount: 5000,
        created: 0,
        ...overrides,
      },
    };
  }

  function homeRoom(): any {
    return mockSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ O: 117009 }),
      minerals: [{ mineralType: "O" }] as any,
    });
  }

  it("零成交挂单改价到最低竞品 ask − step（不再被 bid 派生的地板抬回去）", () => {
    const market = crossedMarket({
      orders: ownSellOrder({ created: (globalThis as any).Game.time }), // 挂龄 0，远未超龄
    });
    (globalThis as any).Game.market = market;

    terminalManagerSystem.run(makeContext([homeRoom()]));

    // askAnchor = round((27.091 − 0.01) × 1000)/1000 = 27.081 → 两位向下取整 = 27.08，
    // 严格低于最低竞品 ask ⇒ 我们成为最便宜的那张单 ⇒ 买家会吃到。
    // 旧地板会给出 max(34.06, 27.081) = 34.06，仍高于 27.091 ⇒ 继续零成交。
    expect(market.changeOrderPrice).toHaveBeenCalledWith("o1", 27.08);
    expect(27.08).toBeLessThan(RIVAL_ASK);
    expect(market.cancelOrder).not.toHaveBeenCalled();
  });

  it("改价不受挂龄约束：当轮就改（挂龄只管撤单，不管改价）", () => {
    // 挂龄 1 拍 —— 旧码这里靠 `createdTimestamp ?? 0` 恒为 0 而"歪打正着"也会改价，
    // 所以本用例的判别力落在上一条的价格值上；这一条钉的是"未超龄也会走到改价分支"，
    // 防止有人把改价重新塞回挂龄条件里。
    const market = crossedMarket({
      orders: ownSellOrder({ created: (globalThis as any).Game.time - 1 }),
    });
    (globalThis as any).Game.market = market;

    terminalManagerSystem.run(makeContext([homeRoom()]));

    expect(market.changeOrderPrice).toHaveBeenCalledTimes(1);
    expect(market.cancelOrder).not.toHaveBeenCalled();
  });

  it("无 bid 锚（改不了价）+ 未超龄 ⇒ 不撤单", () => {
    (globalThis as any).Game.time = 100000;
    const market = crossedMarket({
      getAllOrders: marketOrdersMock([], []),
      orders: ownSellOrder({ created: 100000 - 10 }),
    });
    (globalThis as any).Game.market = market;

    terminalManagerSystem.run(makeContext([homeRoom()]));

    expect(market.changeOrderPrice).not.toHaveBeenCalled();
    expect(market.cancelOrder).not.toHaveBeenCalled();
  });

  it("无 bid 锚（改不了价）+ 真超龄（按拍号算）⇒ 撤单", () => {
    (globalThis as any).Game.time = 100000;
    const market = crossedMarket({
      getAllOrders: marketOrdersMock([], []),
      orders: ownSellOrder({ created: 100000 - (CONFIG.market.orderStaleTicks + 1) }),
    });
    (globalThis as any).Game.market = market;

    terminalManagerSystem.run(makeContext([homeRoom()]));

    expect(market.cancelOrder).toHaveBeenCalledWith("o1");
  });

  it("部分成交的挂单既不撤也不改（价格被市场验证过）", () => {
    (globalThis as any).Game.time = 100000;
    const market = crossedMarket({
      orders: ownSellOrder({ remainingAmount: 4000, created: 1 }), // 挂龄 99,999 拍
    });
    (globalThis as any).Game.market = market;

    terminalManagerSystem.run(makeContext([homeRoom()]));

    expect(market.changeOrderPrice).not.toHaveBeenCalled();
    expect(market.cancelOrder).not.toHaveBeenCalled();
  });

  it("挂单量上限按 maxOrderAmount 现算（已由 5,000 抬到 25,000）", () => {
    const market = crossedMarket({ orders: {} }); // 无在途挂单 → 走创建路径
    (globalThis as any).Game.market = market;

    terminalManagerSystem.run(makeContext([homeRoom()]));

    // 盈余 = terminal 117,009 + storage 0 − sellReserve ⇒ 远大于上限 ⇒ 由 maxOrderAmount 截断。
    expect(market.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "O",
        totalAmount: CONFIG.market.maxOrderAmount,
        price: 27.08, // 有竞品 ask ⇒ 压价锚生效，不是 bid × markup
      }),
    );
  });
});
