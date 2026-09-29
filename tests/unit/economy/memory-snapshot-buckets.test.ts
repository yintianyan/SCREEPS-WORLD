/**
 * 核算快照的可归因性 —— `Memory.rooms[r].economy` 必须能独立复算出 drift。
 * 立案理由：线上 `dr=-1802/50t`（≈ −36/t 持续超容差）而 `nf=+11.85`、环上净流读 −27.9，
 * 三份读数互相打脸却**点不出名**：桶增量在 `rollupWindow` 里算完就被扔掉。
 * 本测试钉两件事：(1) 落盘的 bk/pl 够独立复算 drift；(2) 不传窗口时形状与旧版完全一致
 * （消费方 `queryEconomy`/恢复路径不能因为加了字段而变）。
 */
import { describe, expect, it } from "vitest";
import { toMemorySnapshot, type AccountingWindow } from "../../../src/domain/economy/accounting";

/** 一个自洽的核算窗：收入 1000、消费 1300、退还 50 ⇒ 流平衡 −250；
 *  跟踪池 900_000 → 899_700（−300），other 池 +40，loose −10
 *  ⇒ drift = Δtracked − 流平衡 − looseΔ − otherΔ = −300 +250 +10 −40 = −80 */
const window: AccountingWindow = {
  t0: 1000,
  t1: 1050,
  ticks: 50,
  income: 1000,
  consumption: 1300,
  refunds: 50,
  byBucket: {
    harvested: 900,
    imported: 100,
    spawned: 700,
    upgraded: 600,
    sold: 0,
    exported: 0,
    lost: 0,
    recycledRefund: 50,
  } as never,
  trackedStart: 900_000,
  trackedEnd: 899_700,
  otherStart: 5_000,
  otherEnd: 5_040,
  looseDelta: -10,
  drift: -80,
  p0p1PerTick: 26,
  incomePerTick: 20,
};

describe("economy 瘦快照：落盘的数必须能点名 drift 的来源", () => {
  it("bk 只记非零桶，pl 记五个池读数", () => {
    const snap = toMemorySnapshot(1050, 11.85, 899_700, 100, -80, 20, 1, window);
    expect(snap.bk).toEqual({
      harvested: 900,
      imported: 100,
      spawned: 700,
      upgraded: 600,
      recycledRefund: 50,
    });
    expect(snap.pl).toEqual([900_000, 899_700, 5_000, 5_040, -10]);
  });

  it("恒等式可复算：一个只读 Memory 的人能自己算出 drift（这才叫归因）", () => {
    const snap = toMemorySnapshot(1050, 11.85, 899_700, 100, -80, 20, 1, window);
    const bk = snap.bk!;
    const [trackedStart, trackedEnd, otherStart, otherEnd, looseDelta] = snap.pl as [
      number,
      number,
      number,
      number,
      number,
    ];
    const inflow = (bk.harvested ?? 0) + (bk.imported ?? 0) + (bk.bought ?? 0) + (bk.pickedUp ?? 0);
    const outflow =
      (bk.spawned ?? 0) +
      (bk.upgraded ?? 0) +
      (bk.built ?? 0) +
      (bk.repaired ?? 0) +
      (bk.towerSpent ?? 0) +
      (bk.sold ?? 0);
    const refunds = bk.recycledRefund ?? 0;
    const recomputed =
      trackedEnd -
      trackedStart -
      (inflow - outflow + refunds) -
      looseDelta -
      (otherEnd - otherStart);
    expect(recomputed).toBe(snap.dr);
  });

  it("缺窗口参数时保持旧形状：多出来的字段是可选的，不能凭空出现", () => {
    const legacy = toMemorySnapshot(1050, 11.85, 899_700, 100, -80, 20, 1);
    expect(legacy).toEqual({ t: 1050, nf: 1185, cr: 899700, rb: 1000, dr: -80, ei: 200, ef: 100 });
    expect(legacy.bk).toBeUndefined();
    expect(legacy.pl).toBeUndefined();
  });
});
