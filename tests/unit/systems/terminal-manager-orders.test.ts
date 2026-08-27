/** 市场挂单 + pixel 出售测试（审计缺口 4+5）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { terminalManagerSystem } from "../../../src/systems/terminal-manager";
import { CONFIG } from "../../../src/config";
import {
  planSellOrder,
  shouldCancelStaleOrder,
} from "../../../src/domain/industry/market-orders";
import { mockBudget, mockSnapshot, resetGlobals } from "../../role-helpers";

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
    const plan = planSellOrder({ ...base, surplus: 8000, existingOrderId: undefined, bestBuyPrice: 0.8 });
    expect(plan).toEqual({ resourceType: "U", price: 0.92, totalAmount: 5000 });
  });

  it("在途挂单 → 不重复挂", () => {
    expect(planSellOrder({ ...base, surplus: 8000, existingOrderId: "o1", bestBuyPrice: 0.8 })).toBeUndefined();
  });

  it("无 bid 锚定（死市场）→ 不挂", () => {
    expect(planSellOrder({ ...base, surplus: 8000, existingOrderId: undefined, bestBuyPrice: undefined })).toBeUndefined();
  });

  it("盈余量低于下限 → 不挂（手续费不值得）", () => {
    expect(planSellOrder({ ...base, surplus: 500, existingOrderId: undefined, bestBuyPrice: 0.8 })).toBeUndefined();
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
  it("大宗矿物盈余 → createOrder（价 = bid × markup）", () => {
    const createOrder = vi.fn(() => OK);
    (globalThis as any).Game.market = {
      credits: 1000,
      getAllOrders: vi.fn(() => [{ id: "b1", price: 0.8, remainingAmount: 10000, roomName: "W9N9" }]),
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

  it("pixel 账户资源 → 吃最优 buy 单 deal（账户交割无 room）", () => {
    const deal = vi.fn(() => OK);
    (globalThis as any).Game.market = {
      credits: 1000,
      getAllOrders: vi.fn(({ resourceType }: any) =>
        resourceType === "pixel"
          ? [{ id: "px1", price: 500, remainingAmount: 100, roomName: undefined }]
          : []),
      calcTransactionCost: vi.fn(() => 100),
      deal,
      orders: {},
      createOrder: vi.fn(() => OK),
      cancelOrder: vi.fn(() => OK),
    };
    (globalThis as any).Game.resources = { pixel: 50 };

    terminalManagerSystem.run(makeContext([mockSnapshot({ roomName: "W7N4", terminal: terminalMock() })]));

    expect(deal).toHaveBeenCalledWith("px1", 50);
  });
});
