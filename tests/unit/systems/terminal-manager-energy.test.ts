/** Terminal Manager 能量网络系统测试（经济主线）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { terminalManagerSystem } from "../../../src/systems/trade/terminal-manager";
import { mockBudget, mockSnapshot, mockStore, resetGlobals } from "../../support/factories";
import { CONFIG } from "../../../src/config";
import { globalCache } from "../../../src/kernel/global-cache";
import { getEnergyPolicy } from "../../../src/domain/economy/energy-policy";
import {
  tryBuyCrisisEnergy,
  trySellSurplusEnergy,
} from "../../../src/systems/trade/terminal-market";

const policy = getEnergyPolicy(1_000_000);
const donorStorage = policy.aidDonorFloor + 30_000;
const needyStorage = policy.aidRecipientFloor - 15_000;

function terminalMock(opts: { energy?: number; cooldown?: number } = {}): any {
  return {
    cooldown: opts.cooldown ?? 0,
    store: mockStore(opts.energy ?? 12000, 300000),
    send: vi.fn(() => OK),
  };
}

function roomSnapshot(
  opts: { roomName?: string; storageEnergy?: number; terminal?: any } = {},
): any {
  const { roomName = "W7N4", storageEnergy = 0, terminal = terminalMock() } = opts;
  const overrides: any = { roomName, terminal };
  if (storageEnergy > 0) {
    overrides.storage = { store: mockStore(storageEnergy, 1000000) };
  }
  return mockSnapshot(overrides);
}

function setupMarket(overrides: Record<string, any> = {}): void {
  (globalThis as any).Game.cpu.bucket = 10000;
  (globalThis as any).Game.market = {
    credits: 1000,
    getAllOrders: vi.fn(() => []),
    calcTransactionCost: vi.fn(() => 100),
    deal: vi.fn(() => OK),
    ...overrides,
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

/** 读取 EnergyTransfer 事件（kind=24）。 */
function transferEvents(): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === 24);
}

beforeEach(() => {
  resetGlobals();
});

describe("terminal-manager — 帝国能量互济", () => {
  it("盈余房 → 危机房：terminal.send 一次，量三重约束封顶", () => {
    setupMarket();
    // 10000(货) + 100(运费) + 5000(储备) = 15100 ≤ 20000 → 预算充足。
    const donor = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: donorStorage,
      terminal: terminalMock({ energy: 20000 }),
    });
    const needy = roomSnapshot({
      roomName: "W8N4",
      storageEnergy: needyStorage,
      terminal: terminalMock({ cooldown: 99 }),
    });

    terminalManagerSystem.run(makeContext([donor, needy]));

    // 缺口 15000、盈余 30000、上限 10000 → 10000。
    expect(donor.terminal.send).toHaveBeenCalledWith("energy", 10000, "W8N4");
    expect(transferEvents()).toEqual([expect.objectContaining({ k: 24, r: "W8N4", d: [10000] })]);
  });

  it("受助房跌破危机线 → 允许 donor 让储备到紧急线 300k", () => {
    setupMarket();
    const donor = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: 310_000,
      terminal: terminalMock({ energy: 20_000 }),
    });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: 50_000 });

    terminalManagerSystem.run(makeContext([donor, needy]));

    expect(donor.terminal.send).toHaveBeenCalledWith("energy", 10_000, "W8N4");
  });

  it("无 storage 的新 claim 房不会永久开启紧急 donor 线", () => {
    setupMarket();
    const donor = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: 370_000,
      terminal: terminalMock({ energy: 20_000 }),
    });
    const claim = roomSnapshot({
      roomName: "W8N4",
      storageEnergy: 0,
      terminal: terminalMock({ energy: 1000 }),
    });

    terminalManagerSystem.run(makeContext([donor, claim]));

    expect(donor.terminal.send).not.toHaveBeenCalled();
  });

  it("规划量超出 terminal 余量 → 降额发送，不放弃整笔援助", () => {
    setupMarket();
    const donor = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: donorStorage,
      terminal: terminalMock({ energy: 11000 }),
    });
    // 规划 10000 + 100(fee) + 5000(reserve) = 15100 > 11000；
    // 最大可发 = 11000 - 100(fee) - 5000(reserve) = 5900。
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: needyStorage });

    terminalManagerSystem.run(makeContext([donor, needy]));

    expect(donor.terminal.send).toHaveBeenCalledWith("energy", 5900, "W8N4");
    expect(transferEvents()).toEqual([expect.objectContaining({ k: 24, r: "W8N4", d: [5900] })]);
  });

  it("terminal 连最小援助量都装不下 → 等储备回补后下轮再发", () => {
    setupMarket();
    const donor = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: donorStorage,
      terminal: terminalMock({ energy: 2500 }),
    });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: needyStorage });

    terminalManagerSystem.run(makeContext([donor, needy]));

    expect(donor.terminal.send).not.toHaveBeenCalled();
    expect(transferEvents()).toHaveLength(0);
    expect(globalCache().exportNeeds).toBeUndefined();
  });

  it("Plan 只有 storage→storage 请求时，自主能量互济仍执行", () => {
    setupMarket();
    const donor = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: donorStorage,
      terminal: terminalMock({ energy: 20000 }),
    });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: needyStorage });
    const tick = (globalThis as any).Game.time;
    globalCache().logisticsPlan = {
      tick,
      plan: {
        plannedAt: tick,
        requests: [
          {
            resource: "energy",
            amount: 1000,
            priority: 1,
            source: { room: "W7N4", type: "storage" },
            destination: { room: "W8N4", type: "storage" },
            deadline: tick + 1000,
            createdAt: tick,
            origin: "test",
          } as any,
        ],
      },
    } as any;

    terminalManagerSystem.run(makeContext([donor, needy]));

    expect(donor.terminal.send).toHaveBeenCalledWith("energy", 10000, "W8N4");
  });

  it("单房 → 不互济", () => {
    setupMarket();
    const only = roomSnapshot({ roomName: "W7N4", storageEnergy: donorStorage });

    terminalManagerSystem.run(makeContext([only]));

    expect(only.terminal.send).not.toHaveBeenCalled();
  });

  it("捐赠方 terminal 冷却中（canSend=false）→ 不发送", () => {
    setupMarket();
    const donor = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: donorStorage,
      terminal: terminalMock({ cooldown: 5 }),
    });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: needyStorage });

    terminalManagerSystem.run(makeContext([donor, needy]));

    expect(donor.terminal.send).not.toHaveBeenCalled();
  });

  it("无 market 交易费 API（部分私服）→ 互济整体跳过，不抛错", () => {
    setupMarket();
    delete (globalThis as any).Game.market.calcTransactionCost;
    const donor = roomSnapshot({ roomName: "W7N4", storageEnergy: donorStorage });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: needyStorage });

    expect(() => terminalManagerSystem.run(makeContext([donor, needy]))).not.toThrow();
    expect(donor.terminal.send).not.toHaveBeenCalled();
  });
});

describe("terminal-manager — 能量市场交易", () => {
  beforeEach(() => {
    globalCache().tradeLedger = undefined;
    globalCache().marketOrderCache = undefined;
    globalCache().marketPrices = undefined;
  });

  function energyBuyOrders(price: number): any[] {
    return [{ id: "buy1", price, amount: 100000, remainingAmount: 100000, roomName: "W9N9" }];
  }
  function energySellOrders(price: number): any[] {
    return [{ id: "sell1", price, amount: 100000, remainingAmount: 100000, roomName: "W9N9" }];
  }
  /** 按资源类型分派的 getAllOrders mock — 能量订单只响应 energy 查询，
   * 矿物分支（tryBuyDeficit）查询其他资源时得到空列表，避免抢单污染断言。 */
  function resourceAwareOrders(byResource: Record<string, any[]>): ReturnType<typeof vi.fn> {
    return vi.fn((opts: any) => byResource[opts.resourceType] ?? []);
  }

  it("storage 溢出卖能量：deal 成交，价格底线生效", () => {
    const getAllOrders = resourceAwareOrders({ energy: energyBuyOrders(0.05) });
    setupMarket({ getAllOrders });
    // 盈余刻意比单笔上限多 2,000 ⇒ 约束落在 maxDealAmount 上，而不是刚好和盈余相等
    //（旧写法盈余 5,000 对上限 1,000；上限抬到 5,000 后两者会撞成同一个数，用例就
    // 再也分辨不出"是哪一项截断的"，改一次常数就静默失去判别力）。
    const surplus = CONFIG.market.maxDealAmount + 2000;
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: getEnergyPolicy(1_000_000).saleFloor + surplus,
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    // terminal 现货 20,000 − 运费 100 远大于单笔上限 ⇒ 由 maxDealAmount 截断。
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith(
      "buy1",
      CONFIG.market.maxDealAmount,
      "W7N4",
    );
  });

  it("未达能量卖线 → 不卖能量", () => {
    const getAllOrders = resourceAwareOrders({ energy: energyBuyOrders(0.05) });
    setupMarket({ getAllOrders });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: getEnergyPolicy(1_000_000).saleFloor - 1,
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("买单价格低于底线 → 不贱卖", () => {
    const getAllOrders = resourceAwareOrders({
      energy: energyBuyOrders(CONFIG.energy.minEnergySellPrice - 0.01),
    });
    setupMarket({ getAllOrders });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: getEnergyPolicy(1_000_000).saleFloor + 5000,
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("主动卖能按市场买价动态定底价，不再用 0.02 遗物地板成交", () => {
    const getAllOrders = resourceAwareOrders({ energy: energyBuyOrders(20) });
    setupMarket({ getAllOrders });
    globalCache().marketPrices = {
      tick: Game.time,
      prices: { energy: { sellMin: 0, buyMax: 30 } },
    };
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: getEnergyPolicy(1_000_000).saleFloor + 5000,
      terminal: terminalMock({ energy: 20000 }),
    });

    expect(trySellSurplusEnergy(room, room.terminal, true)).toBe(false);
    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("危机买能量：缺口/单笔上限/可负担量三重约束 + deal 成交", () => {
    const getAllOrders = resourceAwareOrders({ energy: energySellOrders(0.04) });
    setupMarket({ getAllOrders, credits: 500 });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: getEnergyPolicy(1_000_000).crisisBuyFloor - 2000, // 缺口 2000
      terminal: terminalMock({ energy: 10000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    // affordable = floor((500-100)/dynamicCap)，dynamicCap=min(35, 0.04×1.5)=0.06；
    // amount = min(缺口 2000, 单笔上限 maxDealAmount, affordable) = 2000。
    // ⚠️ 缺口是这里的约束项，不是单笔上限（maxDealAmount 已由 1,000 抬到 5,000）——
    // 断言按 min() 的四项现算，常数再变时用例不会静默失去判别力。
    const dynamicCap = Math.min(
      CONFIG.energy.maxCrisisEnergyBuyPrice,
      0.04 * CONFIG.energy.crisisEnergyBuyPremium,
    );
    const affordable = Math.floor((500 - CONFIG.market.creditFloor) / dynamicCap);
    const expected = Math.min(2000, CONFIG.market.maxDealAmount, affordable);
    expect(expected).toBe(2000); // 前置断言：本用例声称的"缺口截断"确实成立
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("sell1", expected, "W7N4");
  });

  it("市场地板 18.44 不再被历史 0.05 闸锁死，可按动态上限买入", () => {
    const getAllOrders = resourceAwareOrders({ energy: energySellOrders(18.44) });
    setupMarket({ getAllOrders, credits: 1_000_000 });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: 1000,
      terminal: terminalMock({ energy: 20_000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith(
      "sell1",
      CONFIG.market.maxDealAmount,
      "W7N4",
    );
  });

  it("卖单价格超硬顶 → 不买（宁可压缩运营）", () => {
    const getAllOrders = resourceAwareOrders({
      energy: energySellOrders(CONFIG.energy.maxCrisisEnergyBuyPrice + 0.01),
    });
    setupMarket({ getAllOrders });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: 1000,
      terminal: terminalMock({ energy: 10000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("credits 低于信用地板 → 不买能量", () => {
    const getAllOrders = resourceAwareOrders({ energy: energySellOrders(0.04) });
    setupMarket({ getAllOrders, credits: 50 });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: 1000,
      terminal: terminalMock({ energy: 10000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("危机买能绕过 interval 缓存直查，避免拿到已被抢走的最低价单", () => {
    const stale = energySellOrders(18.44);
    stale[0].id = "stale-energy";
    const fresh = energySellOrders(19);
    fresh[0].id = "fresh-energy";
    globalCache().marketOrderCache = {
      tick: Game.time,
      orders: {
        [`${ORDER_SELL}/energy`]: [
          { id: "stale-energy", price: 18.44, amount: 100_000, roomName: "W9N9" },
        ],
      },
    };
    const getAllOrders = vi.fn(() => fresh);
    setupMarket({ getAllOrders, credits: 1_000_000 });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: 1000,
      terminal: terminalMock({ energy: 20_000 }),
    });

    expect(tryBuyCrisisEnergy(room, room.terminal)).toBe(true);

    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith(
      "fresh-energy",
      CONFIG.market.maxDealAmount,
      "W7N4",
    );
    expect(globalCache().tradeLedger?.lastBuy).toMatchObject({
      resource: "energy",
      orderId: "fresh-energy",
      price: 19,
      ok: true,
    });
  });

  it("危机买能 deal 失败后强刷订单并重试一次", () => {
    const first = energySellOrders(18.44);
    first[0].id = "energy-first";
    const second = energySellOrders(19);
    second[0].id = "energy-second";
    const getAllOrders = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    setupMarket({ getAllOrders, credits: 1_000_000 });
    (globalThis as any).Game.market.deal = vi
      .fn()
      .mockReturnValueOnce(ERR_NOT_ENOUGH_RESOURCES)
      .mockReturnValueOnce(OK);
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: 1000,
      terminal: terminalMock({ energy: 20_000 }),
    });

    expect(tryBuyCrisisEnergy(room, room.terminal)).toBe(true);

    expect((globalThis as any).Game.market.deal).toHaveBeenNthCalledWith(
      1,
      "energy-first",
      CONFIG.market.maxDealAmount,
      "W7N4",
    );
    expect((globalThis as any).Game.market.deal).toHaveBeenNthCalledWith(
      2,
      "energy-second",
      CONFIG.market.maxDealAmount,
      "W7N4",
    );
    const ledger = globalCache().tradeLedger!;
    expect(ledger.buyByResource.energy!.buyTried).toBe(2);
    expect(ledger.buyByResource.energy!.buyOk).toBe(1);
    expect(ledger.lastBuy).toMatchObject({ orderId: "energy-second", ok: true });
  });
});
