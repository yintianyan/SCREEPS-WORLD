/** 远矿运营账本单测 — 净营收口径、冲销不变量、窗口速率。 */
import { describe, it, expect } from "vitest";
import {
  emptyOpLedger,
  bumpOpLedger,
  opUnrecoveredInvestment,
  opNetDelivered,
  opNetRate,
  opProfitable,
  summarizeOpLedger,
  toOpLedgerSnapshot,
  fromOpLedgerSnapshot,
  recordOpCpu,
  type RemoteOpLedger,
} from "../../../src/domain/remote/op-ledger";

function led(over?: Partial<RemoteOpLedger>): RemoteOpLedger {
  return { ...emptyOpLedger(0), ...over };
}

describe("RemoteOpLedger — 累计不变量", () => {
  it("空账本全零，窗口起点取传入 tick", () => {
    const l = emptyOpLedger(1234);
    expect(opNetDelivered(l)).toBe(0);
    expect(l.windowStart).toBe(1234);
    expect(l.delivered).toBe(0);
  });

  it("bumpOpLedger 忽略零、负数与非有限输入", () => {
    const l = emptyOpLedger(0);
    bumpOpLedger(l, "delivered", 100);
    bumpOpLedger(l, "delivered", 0);
    bumpOpLedger(l, "delivered", -50);
    bumpOpLedger(l, "delivered", Number.NaN);
    bumpOpLedger(l, "delivered", Number.POSITIVE_INFINITY);
    expect(l.delivered).toBe(100);
  });
});

describe("RemoteOpLedger — 净营收口径", () => {
  it("未回收投入 = 孵化 − 回收返还，且不为负", () => {
    expect(opUnrecoveredInvestment(led({ spawnCost: 1000, refund: 300 }))).toBe(700);
    // 跨窗口返还大于本窗投入时不得为负（否则凭空放大净营收）。
    expect(opUnrecoveredInvestment(led({ spawnCost: 100, refund: 300 }))).toBe(0);
  });

  it("交付大于未回收投入 + 基建 才算营收", () => {
    const good = led({ delivered: 5000, spawnCost: 1800, refund: 200, infraCost: 100 });
    // 5000 − (1800−200) − 100 = 3300
    expect(opNetDelivered(good)).toBe(3300);
    expect(opProfitable(good)).toBe(true);

    const bad = led({ delivered: 500, spawnCost: 1800, refund: 200, infraCost: 100 });
    expect(opNetDelivered(bad)).toBe(-1200);
    expect(opProfitable(bad)).toBe(false);
  });

  it("回收型轮换不被记成亏损（返还应冲销投入）", () => {
    // 孵化 1500、回收返还 1400、交付 300：净 = 300 − 100 = 200 > 0
    const l = led({ delivered: 300, spawnCost: 1500, refund: 1400 });
    expect(opUnrecoveredInvestment(l)).toBe(100);
    expect(opNetDelivered(l)).toBe(200);
    expect(opProfitable(l)).toBe(true);
  });

  it("净营收速率按窗口长度摊薄，未结算账本不除零", () => {
    const l = led({ delivered: 2000, windowStart: 0 });
    expect(opNetRate(l, 1000)).toBe(2);
    expect(opNetRate(l, 0)).toBe(2000); // 窗口长度地板 1
  });

  it("摘要含净营收、速率、CPU 与各项分解", () => {
    const s = summarizeOpLedger(
      "W1N1",
      "W1N2",
      led({
        delivered: 3000,
        spawnCost: 1000,
        refund: 200,
        infraCost: 100,
        windowStart: 0,
        cpuPerTick: 0.123,
      }),
      1000,
    );
    expect(s).toContain("W1N1->W1N2");
    expect(s).toContain("net=2100e");
    expect(s).toContain("+2.10e/t");
    expect(s).toContain("delivered=3000");
    expect(s).toContain("cpu=0.123");
    expect(s).toContain("win=1000t");
  });
});

describe("RemoteOpLedger — CPU 测量", () => {
  it("首样本直接置位，不缓慢爬升", () => {
    const l = led();
    recordOpCpu(l, 0.5);
    expect(l.cpuPerTick).toBe(0.5);
  });

  it("EMA 平滑：多次同值保持该值", () => {
    const l = led();
    recordOpCpu(l, 0.4);
    for (let i = 0; i < 10; i++) recordOpCpu(l, 0.4);
    expect(l.cpuPerTick).toBeCloseTo(0.4, 6);
  });

  it("EMA 向新稳态收敛", () => {
    const l = led();
    recordOpCpu(l, 1.0);
    // 连续注入 0.0，约 30 tick 后应接近 0
    for (let i = 0; i < 50; i++) recordOpCpu(l, 0.0);
    expect(l.cpuPerTick).toBeLessThan(0.01);
    expect(l.cpuPerTick).toBeGreaterThanOrEqual(0);
  });

  it("非法输入（NaN / 负值）静默忽略", () => {
    const l = led({ cpuPerTick: 0.5 });
    recordOpCpu(l, Number.NaN);
    recordOpCpu(l, -1);
    expect(l.cpuPerTick).toBe(0.5);
  });
});

describe("RemoteOpLedger — Memory 快照往返", () => {
  it("往返保留收支与窗口起点（整数化）", () => {
    const l = led({
      delivered: 3000.4,
      spawnCost: 1000.6,
      refund: 200,
      infraCost: 100,
      windowStart: 12345,
    });
    const snap = toOpLedgerSnapshot(l);
    expect(snap).toEqual({ d: 3000, s: 1001, r: 200, i: 100, w: 12345 });

    const back = fromOpLedgerSnapshot(snap, 99999);
    expect(back.delivered).toBe(3000);
    expect(back.spawnCost).toBe(1001);
    expect(back.windowStart).toBe(12345);
    expect(back.lastTick).toBe(99999);
  });

  it("快照缺失/字段非法时回退空账本，窗口从当前 tick 起算", () => {
    expect(fromOpLedgerSnapshot(undefined, 500).windowStart).toBe(500);
    const bad = fromOpLedgerSnapshot(
      { d: Number.NaN, s: -5, r: 0, i: 0, w: Number.NaN } as never,
      500,
    );
    expect(bad.delivered).toBe(0);
    expect(bad.spawnCost).toBe(0);
    expect(bad.windowStart).toBe(500);
  });
});
