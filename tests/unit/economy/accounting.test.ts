/** 能量核算纯函数单测——对账恒等式、不变量、三指标计算、Memory 快照往返。 */
import { describe, it, expect } from "vitest";
import {
  emptyLedger,
  ledgerAdd,
  ledgerDelta,
  ledgerIncome,
  ledgerConsumption,
  ledgerP0P1Consumption,
  emptyPools,
  rollupWindow,
  driftLimit,
  isDriftExcessive,
  updateNetFlowEma,
  riskBufferTicks,
  RISK_BUFFER_CAP,
  updateEfficiencyFactor,
  estimateIncome,
  toMemorySnapshot,
  fromMemorySnapshot,
  NOMINAL_INCOME_PER_SOURCE,
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
    const l = led({
      harvested: 30,
      pickedUp: 20,
      spawned: 25,
      towerSpent: 10,
      repaired: 5,
      upgraded: 100,
    });
    // pickedUp 不并入收入：采→掉→捡是同一度电的第二次流（散落池在恒等式两侧同时排除）。
    expect(ledgerIncome(l)).toBe(30);
    expect(ledgerConsumption(l)).toBe(140);
    expect(ledgerP0P1Consumption(l)).toBe(40);
  });

  it("imported（跨房导入）计入收入——远矿交付是本土房真实流入，与 ledgerConsumption 不含远矿采集侧对应，无双重计算", () => {
    const l = led({ harvested: 30, pickedUp: 20, imported: 500 });
    expect(ledgerIncome(l)).toBe(530);
    expect(ledgerConsumption(l)).toBe(0);
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

  it("跨房互济两端对称入账：发端 exported、收端 imported ⇒ 两房 drift 都归零（#42）", () => {
    // donor：storage 少 1100（货 1000 + 运费 100），账上记 exported 1000 + tradeFee 100
    const donor = rollupWindow(
      0,
      50,
      led(),
      led({ exported: 1000, tradeFee: 100 }),
      { ...emptyPools(), storage: 5000 },
      { ...emptyPools(), storage: 3900 },
    );
    expect(ledgerConsumption(led({ exported: 1000, tradeFee: 100 }))).toBe(1100);
    expect(donor.drift).toBe(0);
    // recipient：terminal 多 1000，账上记 imported 1000
    const recv = rollupWindow(
      0,
      50,
      led(),
      led({ imported: 1000 }),
      { ...emptyPools() },
      { ...emptyPools(), terminal: 1000 },
    );
    expect(recv.drift).toBe(0);
  });

  it("采→掉→捡一圈只算一次收入：pickedUp 不得进 income（#40 回归闸）", () => {
    // 采 500 进背包 → 掉 200 在地上（loose）→ 被捡回并全部落进 storage。
    // 真实净增 = 500（同一度电只是换了地方），收入必须仍按 harvested 算一次。
    // 旧口径 income = 500+200 = 700 ⇒ drift = 500−700 = −200，正是线上幼房
    // 「账面 +13.1/t 而 drift −13.3/t」的形状。
    const eL = led({ harvested: 500, pickedUp: 200 });
    const w = rollupWindow(
      0,
      50,
      led(),
      eL,
      { ...emptyPools() },
      { ...emptyPools(), storage: 500 },
    );
    expect(w.income).toBe(500);
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

  it("跨池搬运（storage → 工业池）不误报 drift；净增则必须报", () => {
    // 本用例原先写作「factory 解压产能量不误报」，但它的夹具是自相矛盾的：
    //   tracked +500 且 other +500，而计数器全 0 ⇒ 凭空出现 1000 能量。
    // 旧符号 `− Δother` 恰好把这种"双双增长"抹成 0（因为它把搬运算了两次），
    // 断言也就把 bug 固化成了期望。这里拆成两个各自说得通的情形：
    // ① 纯搬运：tracked 少 X、other 多 X ⇒ drift = 0（能量既没产生也没消失）。
    const transfer = rollupWindow(
      0,
      50,
      led(),
      led(),
      { ...emptyPools(), storage: 5000, other: 0 },
      { ...emptyPools(), storage: 4000, other: 1000 },
    );
    expect(transfer.drift).toBe(0);
    // ② 池子在无计数器支持下双双上涨 ⇒ 就是账实不符，必须报 +1000（旧实现报 0）。
    const appeared = rollupWindow(
      0,
      50,
      led(),
      led(),
      { ...emptyPools(), spawnExt: 100, other: 0 },
      { ...emptyPools(), spawnExt: 600, other: 500 },
    );
    expect(appeared.drift).toBe(1000);
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
    expect(v1).toBeCloseTo(5 + 0.3 * -10);
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
