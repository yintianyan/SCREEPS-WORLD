/** 能量核算纯函数单测——对账恒等式、不变量、三指标计算、Memory 快照往返。 */
import { describe, it, expect } from "vitest";
import {
  emptyLedger, ledgerAdd, ledgerDelta, ledgerIncome, ledgerConsumption, ledgerP0P1Consumption,
  emptyPools, contractReserveOf, trackedPoolsOf, rollupWindow, driftLimit, isDriftExcessive,
  updateNetFlowEma, riskBufferTicks, RISK_BUFFER_CAP, updateEfficiencyFactor, estimateIncome,
  toMemorySnapshot, fromMemorySnapshot, NOMINAL_INCOME_PER_SOURCE,
  type EnergyLedger,
} from "../../../src/domain/economy/accounting";

function led(over?: Partial<EnergyLedger>): EnergyLedger {
  return { ...emptyLedger(), ...over };
}

describe("EnergyLedger — L1 计数器", () => {
  it("ledgerAdd 忽略负数与零，维持 ≥0 不变量", () => {
    const l = emptyLedger();
    ledgerAdd(l, "harvested", 10);
    ledgerAdd(l, "harvested", -5);
    ledgerAdd(l, "harvested", 0);
    expect(l.harvested).toBe(10);
  });

  it("ledgerDelta 只返回非负差值（计数器跨窗连续）", () => {
    const a = led({ harvested: 100, spawned: 50 });
    const b = led({ harvested: 160, spawned: 40 });
    const d = ledgerDelta(a, b);
    expect(d.harvested).toBe(60);
    expect(d.spawned).toBe(0); // 倒退按 0 处理（防御），不产生负消费
  });

  it("收入/消费/P0P1 分解口径正确", () => {
    const l = led({ harvested: 30, pickedUp: 20, spawned: 25, towerSpent: 10, repaired: 5, upgraded: 100 });
    expect(ledgerIncome(l)).toBe(50);
    expect(ledgerConsumption(l)).toBe(140);
    expect(ledgerP0P1Consumption(l)).toBe(40);
  });
});

describe("AccountingWindow — 对账恒等式", () => {
  it("无漂移场景：Δtracked = income − consumption + refunds", () => {
    // 窗内：采 500，孵化 200，升级 100 → 净 +200 应等于受踪池增量
    const sL = led();
    const eL = led({ harvested: 500, spawned: 200, upgraded: 100 });
    const sP = { ...emptyPools(), spawnExt: 300 };
    const eP = { ...emptyPools(), spawnExt: 300, storage: 200 };
    const w = rollupWindow(0, 50, sL, eL, sP, eP);
    expect(w.income).toBe(500);
    expect(w.consumption).toBe(300);
    expect(w.drift).toBe(0);
    expect(w.p0p1PerTick).toBe(4);
  });

  it("资源移动不计消费：spawn→container 搬运不产生 drift", () => {
    // 300 从 spawn 搬进 container：tracked 总量不变（relocation 不入账）
    const sP = { ...emptyPools(), spawnExt: 300 };
    const eP = { ...emptyPools(), containers: 300 };
    const w = rollupWindow(0, 10, led(), led(), sP, eP);
    expect(w.drift).toBe(0);
  });

  it("recycle 冲销进恒等式：孵化后回收一半不虚增消耗", () => {
    // 孵化 400、回收返还 200：净消费 200，池减 200
    const eL = led({ spawned: 400, recycledRefund: 200 });
    const sP = { ...emptyPools(), spawnExt: 400 };
    const eP = { ...emptyPools(), spawnExt: 200 };
    const w = rollupWindow(0, 20, led(), eL, sP, eP);
    expect(w.drift).toBe(0);
  });

  it("otherPool 变化（factory 解压产能量）不误报 drift", () => {
    const sP = { ...emptyPools(), spawnExt: 100, other: 0 };
    const eP = { ...emptyPools(), spawnExt: 600, other: 500 };
    const w = rollupWindow(0, 50, led(), led({ harvested: 0 }), sP, eP);
    expect(w.drift).toBe(0);
  });

  it("loose 衰减单独报告且不影响 drift", () => {
    const sP = { ...emptyPools(), spawnExt: 100, loose: 500 };
    const eP = { ...emptyPools(), spawnExt: 100, loose: 300 };
    const w = rollupWindow(0, 50, led(), led(), sP, eP);
    expect(w.looseDelta).toBe(-200);
    expect(w.drift).toBe(0);
  });

  it("drift 判定：超容差报 excessive", () => {
    const sP = { ...emptyPools(), spawnExt: 1000 };
    const eP = { ...emptyPools(), spawnExt: 500 };
    // 账面无收支但池少了 500 → drift=-500
    const w = rollupWindow(0, 50, led(), led(), sP, eP);
    expect(w.drift).toBe(-500);
    expect(isDriftExcessive(w, 20, 0.02)).toBe(true);
    expect(driftLimit(w, 20, 0.02)).toBe(20);
  });
});

describe("三指标计算", () => {
  it("netFlow EMA 首窗取现值、后续平滑收敛", () => {
    expect(updateNetFlowEma(undefined, 5, 0.3)).toBe(5);
    const v1 = updateNetFlowEma(5, -5, 0.3);
    expect(v1).toBeCloseTo(5 + 0.3 * (-10));
    const v2 = updateNetFlowEma(v1, -5, 0.3);
    expect(v2).toBeLessThan(v1);
  });

  it("riskBuffer：储备÷速率，ε 下限防零除，封顶", () => {
    expect(riskBufferTicks(1000, 10)).toBe(100);
    // 零消费按 ε=0.05 地板速率折算：1000/0.05 = 20000 tick「至少」耐受
    expect(riskBufferTicks(1000, 0)).toBe(20000);
    // 低于 ε 的速率被地板抬到 0.05：1/0.05 = 20
    expect(riskBufferTicks(1, 0.001)).toBe(20);
    // 真正的封顶：巨量储备 ÷ 极小速率
    expect(riskBufferTicks(RISK_BUFFER_CAP * 10, 0.05)).toBe(RISK_BUFFER_CAP);
  });

  it("效率系数：clamp 到 [0,1] 并 EMA 校准", () => {
    const f0 = updateEfficiencyFactor(undefined, 7, 1, 0.3); // 名义 10，实测 7 → 0.7 初值语义
    expect(f0).toBeCloseTo(0.7);
    const f1 = updateEfficiencyFactor(f0, 10, 1, 0.3);
    expect(f1).toBeGreaterThan(f0);
    expect(updateEfficiencyFactor(f0, 999, 1, 0.3)).toBeLessThanOrEqual(1);
    expect(estimateIncome(2, 0.7)).toBeCloseTo(2 * NOMINAL_INCOME_PER_SOURCE * 0.7);
  });
});

describe("Memory 瘦快照往返", () => {
  it("to/from 往返恢复 EMA 与系数（整数化容差内）", () => {
    const snap = toMemorySnapshot(12345, -1.2345, 31032, 876.5, 12, 13.97, 0.6789);
    expect(snap.t).toBe(12345);
    expect(snap.nf).toBe(-123);
    expect(snap.cr).toBe(31032);
    const r = fromMemorySnapshot(snap);
    expect(r.netFlowEma).toBeCloseTo(-1.23, 2);
    expect(r.effFactor).toBeCloseTo(0.68, 2);
  });

  it("缺字段/undefined 回退 undefined 语义", () => {
    expect(fromMemorySnapshot(undefined).netFlowEma).toBeUndefined();
    expect(fromMemorySnapshot({}).effFactor).toBeUndefined();
  });
});