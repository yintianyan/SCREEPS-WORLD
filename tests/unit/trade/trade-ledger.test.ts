/**
 * 贸易决策账本 —— 四道总闸必须各自留下可读的原因。
 * 立案理由见 domain/industry/trade-ledger：2026-09-28 审计参与度时，贸易是唯一一个
 * 「线上看不出它为什么不动作」的模块（不写 Memory，决策输入只在函数栈里）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { terminalManagerSystem } from "../../../src/systems/trade/terminal-manager";
import { createTradeLedger } from "../../../src/domain/industry/trade-ledger";
import { globalCache } from "../../../src/kernel/global-cache";
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
        "credits",
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
});
