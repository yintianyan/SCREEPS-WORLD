/**
 * 贸易决策账本 —— 四道总闸必须各自留下可读的原因。
 * 立案理由见 domain/industry/trade-ledger：2026-09-28 审计参与度时，贸易是唯一一个
 * 「线上看不出它为什么不动作」的模块（不写 Memory，决策输入只在函数栈里）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { terminalManagerSystem } from "../../../src/systems/trade/terminal-manager";
import { tryBuyDeficit } from "../../../src/systems/trade/terminal-market";
import { createTradeLedger } from "../../../src/domain/industry/trade-ledger";
import { globalCache, publishProcurementDemands } from "../../../src/kernel/global-cache";
import { mockBudget, mockContext, mockSnapshot, resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;

function runWith(snapshot?: any, tier = "healthy"): void {
  terminalManagerSystem.run(mockContext(snapshot ?? mockSnapshot(), mockBudget(tier as any)));
}

beforeEach(() => {
  resetGlobals();
  g().tradeLedger = undefined;
  g().Game.cpu.bucket = CONFIG.market.minBucket + 1;
  g().Game.market = {
    credits: 1234,
    orders: {},
    getAllOrders: () => [],
    createOrder: () => OK,
    cancelOrder: () => OK,
  };
});

describe("terminal-manager — 决策账本", () => {
  it("账本字段齐全（读数时「没有这格」与「值是 0」不能混）", () => {
    expect(Object.keys(createTradeLedger()).sort()).toEqual(
      [
        "bucket",
        "buyBestAsk",
        "buyBlockedBy",
        "buyDeficitPriority",
        "buyGatePrice",
        "buyNoMatch",
        "buyOk",
        "buyTried",
        "credits",
        "demandTop",
        "demandsLive",
        "demandsPublished",
        "publishedAt",
        "gatedBy",
        "lastTick",
        "myOrders",
        "roomsOnCooldown",
        "roomsWithTerminal",
        "runs",
        "storageEnergy",
        "terminalEnergy",
      ].sort(),
    );
  });

  it('bucket 低于 market.minBucket → gatedBy="bucket"，runs 仍然计数', () => {
    g().Game.cpu.bucket = CONFIG.market.minBucket - 1;
    runWith();
    const ledger = globalCache().tradeLedger!;
    expect(ledger.runs).toBe(1);
    expect(ledger.gatedBy).toBe("bucket");
    // 决策输入连被闸挡住的这一轮也要记下 —— 判的是"差多少"，不是"有没有跑"。
    expect(ledger.bucket).toBe(CONFIG.market.minBucket - 1);
    expect(ledger.credits).toBe(1234);
  });

  it('无市场 API（私服/测试环境）→ gatedBy="no-market-api"', () => {
    g().Game.market = {};
    runWith();
    expect(globalCache().tradeLedger!.gatedBy).toBe("no-market-api");
  });

  it('CPU 档位不足 → gatedBy="cpu-tier"（贸易不是生存关键）', () => {
    runWith(undefined, "conserve");
    expect(globalCache().tradeLedger!.gatedBy).toBe("cpu-tier");
  });

  it("跑进决策后 gatedBy 归零；没有 terminal 的房不计入库存", () => {
    runWith();
    const ledger = globalCache().tradeLedger!;
    expect(ledger.gatedBy).toBe("");
    expect(ledger.roomsWithTerminal).toBe(0);
    expect(ledger.terminalEnergy).toBe(0);
  });

  it("有 terminal 时记下它的能量、本房 storage 的盈余与账户挂单数", () => {
    const snapshot = mockSnapshot({
      terminal: {
        store: { getUsedCapacity: () => 10013 },
        cooldown: 0,
      } as any,
      storage: { store: { getUsedCapacity: () => 915129 } } as any,
    });
    g().Game.market.orders = { o1: {}, o2: {} };
    runWith(snapshot);
    const ledger = globalCache().tradeLedger!;
    expect(ledger.roomsWithTerminal).toBe(1);
    expect(ledger.terminalEnergy).toBe(10013);
    expect(ledger.storageEnergy).toBe(915129);
    expect(ledger.myOrders).toBe(2);
  });

  it("terminal 在冷却中 → 记 roomsOnCooldown（冷却被谁吃掉是可见的）", () => {
    const snapshot = mockSnapshot({
      terminal: { store: { getUsedCapacity: () => 500 }, cooldown: 20 } as any,
    });
    runWith(snapshot);
    const ledger = globalCache().tradeLedger!;
    expect(ledger.roomsWithTerminal).toBe(1);
    expect(ledger.roomsOnCooldown).toBe(1);
  });

  it("需求表每轮由 terminal-manager 自己抄一份 —— 否则「没需求」与「这个候选没被执行」读起来一样", () => {
    const snapshot = mockSnapshot({
      terminal: { store: { getUsedCapacity: () => 5000 }, cooldown: 0 } as any,
    });
    g().Game.time = 5000;
    publishProcurementDemands(
      "W7N4",
      [{ resource: "U", amount: 200, priority: 60, deadline: 6000, reason: "lab-reaction" }] as any,
      5000,
    );

    runWith(snapshot);

    const ledger = globalCache().tradeLedger!;
    expect(ledger.demandsLive).toBe(1);
    expect(ledger.demandTop).toBe("U:200/p60/lab-reaction");
    // 高于 SELL_PRIORITY_CAP(50) ⇒ 有需求时买入不会被日常卖出挤出 deal 窗口。
    expect(ledger.buyDeficitPriority).toBeGreaterThan(50);
  });
});

/**
 * 采购侧读数 —— 工业（10 座 lab 空转、计划要 X+GH2O、本房矿是 GO）能不能买到原料，
 * 必须一次读数就分清「需求没发布」「价门禁不下」「市场真没单」「deal 被拒」这四种止步。
 */
describe("terminal-market — 采购侧账本", () => {
  // 这三个键挂在 globalCache（= globalThis 形态）上，resetGlobals 不碰它们：不隔离的话
  // 前一个用例发布的需求与行情缓存会漏进来，demandsLive 与「有没有卖单」都不是本用例的现场。
  beforeEach(() => {
    g().procurementDemands = undefined;
    g().marketOrderCache = undefined;
    g().marketPrices = undefined;
    g().tradeLedger = undefined;
  });

  const terminal = () => ({ store: { getUsedCapacity: () => 5000 }, cooldown: 0 }) as any;
  const ctx = () => {
    g().Game.time = 5000;
    return mockContext();
  };
  const publish = (resource: string, amount = 100) =>
    publishProcurementDemands(
      "W7N4",
      [{ resource, amount, priority: 10, deadline: 6000, reason: "lab-reaction" }] as any,
      5000,
    );

  it("有需求但市场一张单都没匹配上 → buyNoMatch 计数、demandTop 指出是哪种料", () => {
    publish("U");
    const ok = tryBuyDeficit(mockSnapshot(), terminal(), ctx());

    const ledger = globalCache().tradeLedger!;
    expect(ok).toBe(false);
    expect(ledger.demandsLive).toBe(1);
    expect(ledger.demandTop).toBe("U:100/p10/lab-reaction");
    expect(ledger.buyNoMatch).toBe(1);
    expect(ledger.buyBestAsk).toBe(0);
    expect(ledger.buyTried).toBe(0);
    expect(ledger.buyGatePrice).toBeGreaterThan(0);
  });

  it("credits 不足 → 记成 credits-floor（与「没需求」必须是两个不同的读数）", () => {
    g().Game.market.credits = 50;
    publish("U");
    expect(tryBuyDeficit(mockSnapshot(), terminal(), ctx())).toBe(false);
    expect(globalCache().tradeLedger!.buyBlockedBy).toBe("credits-floor");
  });

  it("成交时 buyTried/buyOk 同步走，buyBestAsk 留下当时看到的价", () => {
    publish("Z");
    // 价取远低于任何门禁：本用例钉的是「撮合成功后计数怎么走」，门禁有自己的用例，
    // 这样它不会随 CONFIG 行情表漂移而假红。
    g().Game.market.getAllOrders = () =>
      [
        { id: "o1", type: ORDER_SELL, resourceId: "Z", amount: 400, price: 1e-6, roomName: "W1N1" },
      ] as any;
    g().Game.market.calcTransactionCost = () => 10;
    g().Game.market.deal = () => OK;

    expect(tryBuyDeficit(mockSnapshot(), terminal(), ctx())).toBe(true);

    const ledger = globalCache().tradeLedger!;
    expect(ledger.buyTried).toBe(1);
    expect(ledger.buyOk).toBe(1);
    expect(ledger.buyBestAsk).toBe(1e-6);
    expect(ledger.buyNoMatch).toBe(0);
  });
});
