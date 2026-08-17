/**
 * Terminal Manager 工业链扩展测试 — battery 卖 / power 买 / 矿物互济。
 *
 * 覆盖：
 *   battery 卖（trySellSurplusBattery）：
 *   - terminal 现货 + 买单价达标 → deal 成交（量受现货/订单/单笔上限约束）
 *   - 买单价低于底线 → 不贱卖
 *   - terminal 无现货 → 不查单不成交
 *   power 买（tryBuyPower）：
 *   - 高信用 + 库存缺口 + 卖单价达标 → deal 成交
 *   - credits 低于高信用门禁 → 不买（预算让位生存采购）
 *   - 卖单价超上限 / 库存已达标 → 不买
 *   矿物互济（tryEmpireMineralAid）：
 *   - 姐妹房 homeMineral 盈余 → 缺口房 terminal.send + MineralTransfer 事件
 *   - 捐赠方 terminal 能量不足（运费+储备地板）→ 不发送
 *   - 单房 → 不互济
 *   ghodium 买（tryBuyGhodium）：
 *   - 高信用 + 库存缺口 + 卖单价达标 → deal 成交（量受缺口/订单/单笔上限约束）
 *   - credits 低于高信用门禁 → 不买（战略采购排在所有生存采购之后）
 *   - 卖单价超上限 / 库存已达标 / 无 nuker → 不买（G 无其他消费方，不囤死资本）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { terminalManagerSystem } from "../../../src/systems/terminal-manager";
import { mockBudget, mockSnapshot, resetGlobals } from "../../role-helpers";
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
        battery: [{ id: "bb1", price: CONFIG.market.minBatterySellPrice + 0.2, amount: 100000, roomName: "W9N9" }],
      }),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000, battery: 1500 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("bb1", 1000, "W7N4");
  });

  it("买单价低于底线 → 不贱卖（囤着等行情）", () => {
    setupMarket({
      getAllOrders: ordersOf({
        battery: [{ id: "bb1", price: CONFIG.market.minBatterySellPrice - 0.01, amount: 100000, roomName: "W9N9" }],
      }),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000, battery: 1500 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("terminal 无 battery 现货 → 不成交", () => {
    const getAllOrders = vi.fn(() => [{ id: "bb1", price: 2, amount: 1000, roomName: "W9N9" }]);
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
      getAllOrders: vi.fn((opts: any) => (opts.resourceType === "power" ? powerSellOrders(0.3) : [])),
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
      getAllOrders: vi.fn((opts: any) => (opts.resourceType === "power" ? powerSellOrders(0.3) : [])),
    });
    const room = roomSnapshot({
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("卖单价超上限 → 不买", () => {
    setupMarket({
      credits: 100000,
      getAllOrders: vi.fn((opts: any) => (opts.resourceType === "power" ? powerSellOrders(CONFIG.market.powerBuyMaxPrice + 0.01) : [])),
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
      getAllOrders: vi.fn((opts: any) => (opts.resourceType === "power" ? powerSellOrders(0.3) : [])),
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
    expect(mineralAidEvents()).toEqual([
      expect.objectContaining({ k: 30, r: "W2N1", d: [500] }),
    ]);
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
      credits: 50000,
      getAllOrders: vi.fn((opts: any) =>
        opts.resourceType === "G"
          ? [{ id: "g1", price: CONFIG.nuker.ghodiumBuyMaxPrice - 0.1, amount: 100000, roomName: "W9N9" }]
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

    // 缺口 5000、订单充足、credits 充足 → 受单笔上限 1000 截断。
    const expected = Math.min(
      CONFIG.nuker.ghodiumStockpile,
      CONFIG.market.maxDealAmount,
    );
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
    ghodiumMarket({
      getAllOrders: vi.fn((opts: any) =>
        opts.resourceType === "G"
          ? [{ id: "g1", price: CONFIG.nuker.ghodiumBuyMaxPrice + 0.01, amount: 100000, roomName: "W9N9" }]
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
