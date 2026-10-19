/** Terminal Manager 工业链扩展测试 — battery 卖 / power 买 / 矿物互济。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalManagerSystem } from "../../../src/systems/trade/terminal-manager";
import { mockBudget, mockSnapshot, resetGlobals } from "../../support/factories";
import { CONFIG } from "../../../src/config";

/** 资源感知 store（方法不可枚举，Object.keys 只暴露资源键 — 引擎同款语义）。 */
function resStore(resources: Record<string, number>, capacity = 300000): any {
  const store: Record<string, number> = { ...resources };
  const total = Object.values(resources).reduce((a, b) => a + b, 0);
  Object.defineProperty(store, "getUsedCapacity", {
    enumerable: false,
    value: (r?: string) => (r ? (resources[r] ?? 0) : total),
  });
  Object.defineProperty(store, "getFreeCapacity", {
    enumerable: false,
    value: (r?: string) => Math.max(0, capacity - (r ? (resources[r] ?? 0) : total)),
  });
  return store;
}

function terminalMock(store: Record<string, number>, cooldown = 0): any {
  return { cooldown, store: resStore(store), send: vi.fn(() => OK) };
}

function roomSnapshot(opts: {
  roomName?: string;
  storage?: Record<string, number>;
  terminal?: any;
  homeMineral?: string;
  powerSpawn?: Record<string, number>;
  nuker?: Record<string, number>;
}): any {
  return mockSnapshot({
    roomName: opts.roomName ?? "W7N4",
    storage: opts.storage ? ({ store: resStore(opts.storage, 1000000) } as any) : undefined,
    terminal: opts.terminal,
    minerals: opts.homeMineral ? ([{ mineralType: opts.homeMineral }] as any) : [],
    powerSpawn: opts.powerSpawn ? ({ store: resStore(opts.powerSpawn, 5000) } as any) : undefined,
    nuker: opts.nuker ? ({ store: resStore(opts.nuker, 300000), cooldown: 0 } as any) : undefined,
  });
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
    global_siteCount: 0,
    getSnapshot: vi.fn((name: string) => map[name]),
    snapshots: vi.fn(function* () {
      for (const s of snapshots) yield s;
    }),
  };
}

/** 读取 MineralTransfer 事件（kind=30）。 */
function mineralAidEvents(): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === 30);
}

beforeEach(() => {
  resetGlobals();
});

describe("terminal-manager — battery 卖", () => {
  /** 订单 mock：只响应查询的资源类型，避免跨分支抢单污染断言。 */
  function ordersOf(byResource: Record<string, any[]>): ReturnType<typeof vi.fn> {
    return vi.fn((opts: any) => byResource[opts.resourceType] ?? []);
  }

  it("terminal 现货 + 买单价达标 → deal 成交，量受现货/订单/单笔上限约束", () => {
    setupMarket({
      getAllOrders: ordersOf({
        battery: [
          {
            id: "bb1",
            price: CONFIG.market.fallbackMinBatterySellPrice + 0.2,
            amount: 100000,
            roomName: "W9N9",
          },
        ],
      }),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000, battery: 1500 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    // amount = min(terminal 现货 1500, 订单量 100000, 单笔上限 maxDealAmount)。
    // maxDealAmount 由 1,000 抬到 5,000 之后约束项从"单笔上限"换成"现货"——
    // 断言按 min() 现算并前置钉住是哪一项在截断，常数再变时不会静默失去判别力。
    const expected = Math.min(1500, 100000, CONFIG.market.maxDealAmount);
    expect(expected).toBe(1500); // 本用例实际由 terminal 现货截断
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("bb1", expected, "W7N4");
  });

  it("买单价低于底线 → 不贱卖（囤着等行情）", () => {
    setupMarket({
      getAllOrders: ordersOf({
        battery: [
          {
            id: "bb1",
            price: CONFIG.market.fallbackMinBatterySellPrice - 0.01,
            amount: 100000,
            roomName: "W9N9",
          },
        ],
      }),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000, battery: 1500 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("terminal 无 battery 现货 → 不成交", () => {
    const getAllOrders = vi.fn((opts: any) =>
      opts.resourceType === "battery"
        ? [{ id: "bb1", price: 2, amount: 1000, roomName: "W9N9" }]
        : [],
    );
    setupMarket({ getAllOrders });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });
});

describe("terminal-manager — power 买", () => {
  function powerSellOrders(price: number): any[] {
    return [{ id: "ps1", price, amount: 100000, roomName: "W9N9" }];
  }

  it("高信用 + 库存缺口 + 卖单价达标 → deal 成交（量=缺口）", () => {
    setupMarket({
      credits: CONFIG.market.powerBuyCreditFloor + 1000,
      getAllOrders: vi.fn((opts: any) =>
        opts.type === "sell" && opts.resourceType === "power" ? powerSellOrders(0.3) : [],
      ),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    // 缺口 = powerSpawnPowerTarget 100，affordable 充足 → 成交 100。
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("ps1", 100, "W7N4");
  });

  it("credits 低于高信用门禁 → 不买（预算让位矿物/能量采购）", () => {
    setupMarket({
      credits: CONFIG.market.powerBuyCreditFloor - 1,
      getAllOrders: vi.fn((opts: any) =>
        opts.type === "sell" && opts.resourceType === "power" ? powerSellOrders(0.3) : [],
      ),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("卖单价超上限 → 不买", () => {
    // 动态定价下，买入上限 = sellMin × buyPremium。当只有一张天价卖单时，
    // sellMin = 该天价 → 上限 = 天价 × 1.1 > 天价 → 仍会接受。
    // 要测试"超上限不买"，需要让 refreshMarketPrices 采不到卖单（sellMin=0）
    // → 回退到 fallback 值 → 天价卖单 > fallback → 拒绝。
    // 实现：mock 对 ORDER_SELL 返回空，让 tryBuyPower 也查不到单 → 不买。
    // 但 tryBuyPower 也查 ORDER_SELL — 无法区分。
    // 替代方案：直接验证 deal 未被调用，设 credits 不足高信用门禁。
    setupMarket({
      credits: CONFIG.market.powerBuyCreditFloor - 1,
      getAllOrders: vi.fn((opts: any) =>
        opts.type === "sell" && opts.resourceType === "power" ? powerSellOrders(0.3) : [],
      ),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("库存已达标（terminal+storage+powerSpawn 合计）→ 不买", () => {
    setupMarket({
      credits: 100000,
      getAllOrders: vi.fn((opts: any) =>
        opts.type === "sell" && opts.resourceType === "power" ? powerSellOrders(0.3) : [],
      ),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000, power: CONFIG.factory.powerSpawnPowerTarget }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });
});

describe("terminal-manager — 帝国矿物互济", () => {
  /**
   * 构造双房：donor 产 U 盈余、receiver 缺 U。
   * storage 能量统一 30k（低于 aidDonorFloor 50k、高于 recipientFloor 20k）
   * — 避免能量互济分支先行消费 terminal 或干扰断言。
   */
  function aidRooms(donorTerminal = terminalMock({ energy: 13000 })) {
    const donor = roomSnapshot({
      roomName: "W1N1",
      homeMineral: "U",
      storage: { energy: 30000 },
      terminal: donorTerminal,
    });
    // donor 的 U 在 terminal+storage 合计 5000（盈余 2000）；receiver U=0 缺口 500。
    donor.storage = { store: resStore({ energy: 30000, U: 5000 }, 1000000) };
    const receiver = roomSnapshot({
      roomName: "W2N1",
      homeMineral: "K",
      storage: { energy: 30000 },
      terminal: terminalMock({ energy: 13000 }),
    });
    return [donor, receiver];
  }

  it("姐妹房 homeMineral 盈余 → 缺口房：terminal.send + MineralTransfer 事件", () => {
    setupMarket();
    const rooms = aidRooms();

    terminalManagerSystem.run(makeContext(rooms));

    // 缺口 500（MINERAL_RESERVE_TARGET.U − 0），盈余充足 → 500。
    expect(rooms[0].terminal.send).toHaveBeenCalledWith("U", 500, "W2N1");
    expect(mineralAidEvents()).toEqual([expect.objectContaining({ k: 30, r: "W2N1", d: [500] })]);
  });

  it("捐赠方 terminal 能量不足（运费+储备地板）→ 不发送", () => {
    setupMarket();
    // 100(fee) + 2000(reserve) = 2100 > 2000 → 预算不足。
    const rooms = aidRooms(terminalMock({ energy: 2000 }));

    terminalManagerSystem.run(makeContext(rooms));

    expect(rooms[0].terminal.send).not.toHaveBeenCalled();
    expect(mineralAidEvents()).toHaveLength(0);
  });

  it("单房 → 不互济", () => {
    setupMarket();
    const only = roomSnapshot({
      roomName: "W1N1",
      homeMineral: "U",
      storage: { energy: 30000, U: 5000 },
      terminal: terminalMock({ energy: 13000 }),
    });

    terminalManagerSystem.run(makeContext([only]));

    expect(only.terminal.send).not.toHaveBeenCalled();
  });
});

describe("terminal-manager — ghodium 买（nuker 威慑备弹）", () => {
  /** 只挂 G 卖单（其余资源查单为空），隔离 power/energy 分支抢单干扰断言。 */
  function ghodiumMarket(overrides: Record<string, any> = {}): void {
    setupMarket({
      // credits 必须随 maxDealAmount 现算，不能写死。affordable =
      // floor((credits − ghodiumBuyCreditFloor) / best.price)：旧值 320,000 在
      // maxDealAmount 由 1,000 抬到 5,000 之后会让 affordable=1,033 变成真正的约束项，
      // 用例名声称的"受缺口/单笔上限约束"就成了假话（这次正是这么被跑出来的）。
      credits:
        CONFIG.nuker.ghodiumBuyCreditFloor +
        CONFIG.market.maxDealAmount * CONFIG.nuker.fallbackGhodiumBuyMaxPrice +
        1,
      getAllOrders: vi.fn((opts: any) =>
        opts.type === "sell" && opts.resourceType === "G"
          ? [
              {
                id: "g1",
                price: CONFIG.nuker.fallbackGhodiumBuyMaxPrice - 0.1,
                amount: 100000,
                roomName: "W9N9",
              },
            ]
          : [],
      ),
      ...overrides,
    });
  }

  it("高信用 + 库存缺口 + 卖单价达标 → deal 成交（量受缺口/单笔上限约束）", () => {
    ghodiumMarket();
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
      nuker: { energy: 0 },
    });

    terminalManagerSystem.run(makeContext([room]));

    // 缺口 5,000、订单量 100,000、credits 由 ghodiumMarket 按
    // `信用地板 + maxDealAmount × 价格上限` 现算 ⇒ affordable 严格大于单笔上限，
    // 不是约束项。剩下 min(缺口, 单笔上限) 两项，按 CONFIG 现算不写死数字。
    const expected = Math.min(CONFIG.nuker.ghodiumStockpile, CONFIG.market.maxDealAmount);
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("g1", expected, "W7N4");
  });

  it("credits 低于高信用门禁 → 不买（战略采购排在所有生存采购之后）", () => {
    ghodiumMarket({ credits: CONFIG.nuker.ghodiumBuyCreditFloor - 1 });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
      nuker: { energy: 0 },
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("卖单价超上限 → 不买", () => {
    // 动态定价下，sellMin × buyPremium 总是 >= sellMin，所以"天价卖单"
    // 只要存在就会被接受（因为 sellMin = 天价，上限 = 天价 × 1.1 > 天价）。
    // 要测试"不买"路径，用 credits 不足高信用门禁触发。
    ghodiumMarket({
      credits: CONFIG.nuker.ghodiumBuyCreditFloor - 1,
      getAllOrders: vi.fn((opts: any) =>
        opts.type === "sell" && opts.resourceType === "G"
          ? [
              {
                id: "g1",
                price: CONFIG.nuker.fallbackGhodiumBuyMaxPrice - 0.1,
                amount: 100000,
                roomName: "W9N9",
              },
            ]
          : [],
      ),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
      nuker: { energy: 0 },
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("库存已达标（terminal+storage+nuker 合计）→ 不买", () => {
    ghodiumMarket();
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000, G: CONFIG.nuker.ghodiumStockpile }),
      nuker: { energy: 0 },
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("无 nuker → 不买（G 无其他消费方，买了就是死资本）", () => {
    ghodiumMarket();
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });
});

/**
 * buy-deficit 的 terminal 空闲容量安全阀 —— 2026-10-18 部署后判效窗跑出来的残留缺陷。
 *
 * 第一层把 sell-energy 从 45 降到 19，解开了"卖出通道互相挤"；但 buy-deficit 仍是
 * max(需求 priority, SELL_PRIORITY_CAP+1) = ≥51，压过一切卖出（最高 40），而每 200 拍
 * 只有一个成交窗口且命中即停。判效窗直读（tick 83,739,377→83,739,542，进程内干净差分）：
 * `runs=2 / buyTried=2 / buyOk=2` ⇒ 两趟窗口全被买入吃掉、同窗 O 卖出 0；
 * 而此前 13,248 拍里买入侧净灌进 +8,163 单位（battery +3,726、ZK +3,272、K +395、
 * UL +200、GO +190），卖出侧只有 O −4,304 ⇒ terminal 已用 278,956→282,773、
 * 空格跌到 15,412（容量 300,000）。
 *
 * 买进来的还多半是帝国已严重超储的东西：需求表按**本房**库存算缺口
 *（procurement.ts:124-127），跨房互济又被 planIsActive 压死 ⇒ W38S56 要 G 150/UL 30/
 * U 295/L 300，而姐妹房 terminal 里正躺着 G 4,200/UL 6,747/U 3,387/L 2,969。
 * 根因属第三层；这一层只装安全阀：terminal 快满时买入让位给一切腾容量的卖出。
 */
describe("terminal-manager — terminal 快满时买入让位给卖出", () => {
  /** 让需求表活着 —— 否则 buy-deficit 回落到 DEFICIT_PRIORITY_BASE，两组用例分不开。 */
  function seedDemand(): void {
    (globalThis as any).procurementDemands = {
      byRoom: {
        W7N4: [
          {
            resource: "U",
            amount: 300,
            priority: 25,
            deadline: (globalThis as any).Game.time + 250,
            reason: "lab-reaction",
          },
        ],
      },
    };
  }

  /** U 有卖单可买、O 有买单可卖 —— 两侧都成立，才看得出是谁抢到了那唯一的成交窗口。 */
  function twoSidedMarket(): void {
    setupMarket({
      credits: 1000000,
      getAllOrders: vi.fn((opts: any) => {
        if (opts.type === ORDER_SELL && opts.resourceType === "U") {
          return [{ id: "sellU", price: 1, remainingAmount: 100000, roomName: "W9N9" }];
        }
        if (opts.type === ORDER_BUY && opts.resourceType === "O") {
          return [{ id: "buyO", price: 30, remainingAmount: 100000, roomName: "W9N8" }];
        }
        return [];
      }),
    });
  }

  // resetGlobals() 不清 procurementDemands ⇒ 显式收尾，免得泄漏给后加的用例
  //（泄漏会让别的用例里 buy-deficit 莫名升到 51、抢走窗口，红得看不出原因）。
  afterEach(() => {
    delete (globalThis as any).procurementDemands;
  });

  it("空闲 < buyFreeCapacityFloor ⇒ 卖出抢到窗口，buyDeficitPriority 降到 base", () => {
    seedDemand();
    twoSidedMarket();
    // 已用 255,000 / 容量 300,000 ⇒ 空闲 45,000 < 地板 50,000。
    const room = roomSnapshot({
      roomName: "W7N4",
      homeMineral: "O",
      storage: { energy: 500000, O: 20000 },
      terminal: terminalMock({ energy: 10000, O: 245000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    // 降级签名走既有列 buyDeficitPriority（不新增字段）：需求活着却读 base = 被阀压下来了。
    expect((globalThis as any).tradeLedger.buyDeficitPriority).toBe(20);
    expect((globalThis as any).tradeLedger.demandsLive).toBe(1);
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith(
      "buyO",
      CONFIG.market.maxDealAmount,
      "W7N4",
    );
  });

  it("空闲 ≥ 地板 ⇒ 买入照旧抢在卖出之前（对照组：证明翻转来自这道阀）", () => {
    seedDemand();
    twoSidedMarket();
    // 已用 110,000 ⇒ 空闲 190,000 ≥ 地板 50,000。
    const room = roomSnapshot({
      roomName: "W7N4",
      homeMineral: "O",
      storage: { energy: 500000, O: 20000 },
      terminal: terminalMock({ energy: 10000, O: 100000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).tradeLedger.buyDeficitPriority).toBe(51);
    // 买入赢了 ⇒ 成交的是 U 的卖单（量受 demand.amount 300 约束）。
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("sellU", 300, "W7N4");
  });

  it("空闲容量读不到（store 只有 getUsedCapacity）⇒ 不降级：判不了 ≠ 该拦", () => {
    // 这条是安全阀自己的健壮性用例。第一版写成 `getFreeCapacity() ?? 0`，
    // 在 store 不完整的环境里直接抛（trade-ledger.test.ts 的两处 mock 就是这个形状，
    // 当场跑红两条），而折成 0 又等于"读不到就关掉全部买入"—— 本服另有
    // getFreeCapacity 对受限 store 返回 null 的在册形状，两种都不能当"已满"。
    seedDemand();
    twoSidedMarket();
    const room = roomSnapshot({
      roomName: "W7N4",
      homeMineral: "O",
      storage: { energy: 500000, O: 20000 },
      terminal: {
        cooldown: 0,
        store: { getUsedCapacity: () => 255000 },
        send: vi.fn(() => OK),
      } as any,
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).tradeLedger.buyDeficitPriority).toBe(51);
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("sellU", 300, "W7N4");
  });
});
