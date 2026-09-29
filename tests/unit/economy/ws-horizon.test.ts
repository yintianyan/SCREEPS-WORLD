/**
 * `ws` = 视界累计 `[Σdrift, ΣflowBalance, Σticks]` 的语义。
 *
 * 立案理由：线上 `dr` 依次 −6 / +221 / −196 / −1378 / −2126 / +1712 / −2695，
 * 单看每一窗 |dr|≈200~2700 都"很大"，但**来回摆**（窗边界结算 artifact，账可用）
 * 与**单向漏记**（G4/净流不可信，必须先修账）在一窗读数控件上长得一模一样 ——
 * 于是 #17 卡在这里查不动。累计之后 Σdrift 一个数就能分开。
 *
 * 断言只引用窗对象自己算出的 `w.drift` / `w.income…`，不照抄恒等式公式
 * （见 pending-observability-debts 里"恒等式类断言不得照抄实现"那条纪律）。
 */
import { describe, expect, it } from "vitest";
import {
  accumulateWs,
  emptyLedger,
  flowBalanceOf,
  rollupWindow,
  WS_HORIZON_TICKS,
  type AccountingWindow,
  type EnergyLedger,
  type EnergyPools,
} from "../../../src/domain/economy/accounting";

function pools(o: Partial<EnergyPools>): EnergyPools {
  return {
    spawnExt: 0,
    containers: 0,
    storage: 0,
    terminal: 0,
    links: 0,
    carry: 0,
    towers: 0,
    loose: 0,
    other: 0,
    ...o,
  };
}

function win(
  t0: number,
  t1: number,
  from: Partial<EnergyPools>,
  to: Partial<EnergyPools>,
  ledgerDelta?: (l: EnergyLedger) => void,
): AccountingWindow {
  const a = emptyLedger();
  const b = emptyLedger();
  if (ledgerDelta) ledgerDelta(b);
  return rollupWindow(t0, t1, a, b, pools(from), pools(to));
}

describe("ws 视界累计", () => {
  it("首窗（该房首次核算，无 prev）从本窗起算，不凭空造基线", () => {
    const w = win(0, 50, { storage: 5000 }, { storage: 4800 });
    expect(w.drift).toBe(-200);
    expect(accumulateWs(undefined, w)).toEqual([-200, 0, 50]);
  });

  it("逐窗按分量累加：Σdrift / ΣflowBalance / Σticks 各自是各窗之和", () => {
    const w1 = win(0, 50, { storage: 5000 }, { storage: 4800 });
    const w2 = win(50, 130, { storage: 4800 }, { storage: 5000 }, l => {
      l.harvested = 200;
    });
    const w3 = win(130, 180, { storage: 5000 }, { storage: 4700 }, l => {
      l.upgraded = 300;
    });
    const ws = accumulateWs(accumulateWs(accumulateWs(undefined, w1), w2), w3);
    expect(ws[0]).toBe(w1.drift + w2.drift + w3.drift);
    expect(ws[1]).toBe(flowBalanceOf(w1) + flowBalanceOf(w2) + flowBalanceOf(w3));
    expect(ws[2]).toBe(50 + 80 + 50);
  });

  it("视界到点滚动重开（本字段无环形历史）：Σticks 回到本窗长度，且旧视界不渗进新视界", () => {
    const nearEnd = [12_345, 98_765, WS_HORIZON_TICKS - 20] as const;
    const w = win(0, 50, { storage: 5000 }, { storage: 5200 });
    expect(w.drift).toBe(200);
    // 跨过视界：只留本窗，前两分量必须与 nearEnd 完全无关。
    expect(accumulateWs(nearEnd, w)).toEqual([200, flowBalanceOf(w), 50]);
    // 未跨过：照旧累加。
    expect(accumulateWs([1, 2, WS_HORIZON_TICKS - 50] as const, w)[2]).toBe(WS_HORIZON_TICKS);
  });

  it("判别力：两窗 |drift| 都是 200，单窗读数分不开；累计后一个数分开振荡与漏账", () => {
    // 振荡：+200 与 −200 交替（模拟 carry/imported 落在窗边界两侧）。
    const o1 = win(0, 50, { storage: 5000 }, { storage: 5200 });
    const o2 = win(50, 100, { storage: 5200 }, { storage: 5000 });
    // 漏账：每窗都少 200 且没有任何计数器解释（模拟一个未记账的消费项）。
    const l1 = win(0, 50, { storage: 5000 }, { storage: 4800 });
    const l2 = win(50, 100, { storage: 4800 }, { storage: 4600 });

    // ① 单窗层面确实分不开——这正是 #17 卡住的原因。
    expect(Math.abs(o1.drift)).toBe(Math.abs(l1.drift));
    // ② 累计层面一眼可分。
    const osc = accumulateWs(accumulateWs(undefined, o1), o2);
    const leak = accumulateWs(accumulateWs(undefined, l1), l2);
    expect(osc[0]).toBe(0);
    expect(leak[0]).toBe(-400);
    // ③ 漏账的漏速要用同一视界的两分量相除才成立（ΣflowBalance=0 ⇒ 全部差额无人解释）。
    expect(leak[1]).toBe(0);
    expect(leak[0] / leak[2]).toBeCloseTo(-4, 10);
  });
});
