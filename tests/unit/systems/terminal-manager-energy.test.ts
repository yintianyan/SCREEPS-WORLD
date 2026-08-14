/**
 * Terminal Manager 能量网络系统测试（R5 经济主线）。
 *
 * 覆盖：
 *   帝国能量互济：
 *   - 双房（盈余房 → 危机房）→ terminal.send 一次，量三重约束封顶
 *   - 捐赠方 terminal 能量不足（货量+运费+储备地板）→ 不发送
 *   - 单房 / 捐赠方冷却中 → 不发送
 *   - 成交记录 EnergyTransfer 事件（黑匣子）
 *   能量市场交易：
 *   - storage 溢出卖能量（deal 成交，价格底线生效）
 *   - 未达卖线 → 不卖
 *   - 危机买能量（credits/价格上限/缺口三重约束）
 *   - 价格超上限 / credits 低于地板 → 不买
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { terminalManagerSystem } from "../../../src/systems/terminal-manager";
import { mockBudget, mockSnapshot, mockStore, resetGlobals } from "../../role-helpers";
import { CONFIG } from "../../../src/config";

function terminalMock(opts: { energy?: number; cooldown?: number } = {}): any {
  return {
    cooldown: opts.cooldown ?? 0,
    store: mockStore(opts.energy ?? 12000, 300000),
    send: vi.fn(() => OK),
  };
}

function roomSnapshot(opts: { roomName?: string; storageEnergy?: number; terminal?: any } = {}): any {
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
    // 10000(货) + 100(运费) + 2000(储备) = 12100 ≤ 13000 → 预算充足。
    const donor = roomSnapshot({ roomName: "W7N4", storageEnergy: 80000, terminal: terminalMock({ energy: 13000 }) });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: 5000, terminal: terminalMock({ cooldown: 99 }) });

    terminalManagerSystem.run(makeContext([donor, needy]));

    // 缺口 15000、盈余 30000、上限 10000 → 10000。
    expect(donor.terminal.send).toHaveBeenCalledWith("energy", 10000, "W8N4");
    expect(transferEvents()).toEqual([
      expect.objectContaining({ k: 24, r: "W8N4", d: [10000] }),
    ]);
  });

  it("捐赠方 terminal 能量不足（货量+运费+储备地板）→ 不发送", () => {
    setupMarket();
    const donor = roomSnapshot({ roomName: "W7N4", storageEnergy: 80000, terminal: terminalMock({ energy: 11000 }) });
    // 10000 + 100(fee) + 2000(reserve) = 12100 > 11000 → 预算不足。
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: 5000 });

    terminalManagerSystem.run(makeContext([donor, needy]));

    expect(donor.terminal.send).not.toHaveBeenCalled();
    expect(transferEvents()).toHaveLength(0);
  });

  it("单房 → 不互济", () => {
    setupMarket();
    const only = roomSnapshot({ roomName: "W7N4", storageEnergy: 80000 });

    terminalManagerSystem.run(makeContext([only]));

    expect(only.terminal.send).not.toHaveBeenCalled();
  });

  it("捐赠方 terminal 冷却中（canSend=false）→ 不发送", () => {
    setupMarket();
    const donor = roomSnapshot({ roomName: "W7N4", storageEnergy: 80000, terminal: terminalMock({ cooldown: 5 }) });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: 5000 });

    terminalManagerSystem.run(makeContext([donor, needy]));

    expect(donor.terminal.send).not.toHaveBeenCalled();
  });

  it("无 market 交易费 API（部分私服）→ 互济整体跳过，不抛错", () => {
    setupMarket();
    delete (globalThis as any).Game.market.calcTransactionCost;
    const donor = roomSnapshot({ roomName: "W7N4", storageEnergy: 80000 });
    const needy = roomSnapshot({ roomName: "W8N4", storageEnergy: 5000 });

    expect(() => terminalManagerSystem.run(makeContext([donor, needy]))).not.toThrow();
    expect(donor.terminal.send).not.toHaveBeenCalled();
  });
});

describe("terminal-manager — 能量市场交易", () => {
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
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: CONFIG.energy.energySellFloor + 5000,
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("buy1", 1000, "W7N4");
  });

  it("未达能量卖线 → 不卖能量", () => {
    const getAllOrders = resourceAwareOrders({ energy: energyBuyOrders(0.05) });
    setupMarket({ getAllOrders });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: CONFIG.energy.energySellFloor - 1,
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("买单价格低于底线 → 不贱卖", () => {
    const getAllOrders = resourceAwareOrders({ energy: energyBuyOrders(CONFIG.energy.minEnergySellPrice - 0.01) });
    setupMarket({ getAllOrders });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: CONFIG.energy.energySellFloor + 5000,
      terminal: terminalMock({ energy: 20000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    expect((globalThis as any).Game.market.deal).not.toHaveBeenCalled();
  });

  it("危机买能量：缺口/单笔上限/可负担量三重约束 + deal 成交", () => {
    const getAllOrders = resourceAwareOrders({ energy: energySellOrders(0.04) });
    setupMarket({ getAllOrders, credits: 500 });
    const room = roomSnapshot({
      roomName: "W7N4",
      storageEnergy: CONFIG.energy.energyBuyFloor - 2000, // 缺口 2000
      terminal: terminalMock({ energy: 10000 }),
    });

    terminalManagerSystem.run(makeContext([room]));

    // affordable = floor((500-100)/0.05) = 8000；amount = min(2000, 1000, 8000) = 1000。
    expect((globalThis as any).Game.market.deal).toHaveBeenCalledWith("sell1", 1000, "W7N4");
  });

  it("卖单价格超上限 → 不买（宁可压缩运营）", () => {
    const getAllOrders = resourceAwareOrders({ energy: energySellOrders(CONFIG.energy.maxEnergyBuyPrice + 0.01) });
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
});
