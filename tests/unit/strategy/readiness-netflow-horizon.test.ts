/**
 * 就绪度净流「长视界仪器」的性质测试（6325d96）。
 *
 * 立案依据是线上同径实测：同一个净流量在相隔约 100 拍的五次读数里走
 * 17.7 → 0.4 → −2.8 → 12.1 → 17.2，`Blocked` 跟着在「只剩 G6」与 G3+G4+G7 之间翻脸；
 * 而 plan 晋升要求就绪度**连续** 500 拍成立（`domain/expansion/plan-lifecycle.ts:41`）。
 * ⇒ 一台 100 拍就能翻符号的仪器满足不了一个连续判据。
 *
 * 这里验的是**仪器选择本身**（纯函数 + 真配置常数），不验 empire-economy 里的接线：
 * 该系统没有单测夹具，接线目前只有集成用例与线上 `failedGates` 读数覆盖 —— 这个缺口写在提交里。
 */
import { describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { updateNetFlowEma } from "../../../src/domain/economy/accounting";

/** G4 的判据常量（`domain/strategy/readiness.ts` DEFAULT_READINESS_OPTIONS.minNetFlow）。 */
const G4_MIN_NET_FLOW = 5;

/** 把一串「每窗净流」喂给指定 α 的 EMA，返回逐窗读数。 */
function series(windowPerTick: number[], alpha: number): number[] {
  const out: number[] = [];
  let prev: number | undefined;
  for (const x of windowPerTick) {
    prev = updateNetFlowEma(prev, x, alpha);
    out.push(prev);
  }
  return out;
}

describe("净流双仪器：预算要快、就绪度闸要长视界", () => {
  it("配置不变式：闸用的那台必须比预算用的那台慢（否则一根时钟又两用）", () => {
    const operational = CONFIG.economy.accounting.netFlowAlpha;
    const gate = CONFIG.economy.accounting.netFlowGateAlpha;
    expect(gate).toBeLessThan(operational);
    // τ = windowTicks/α：慢的那台要跨得动投递脉搏（一包含 1000~2000 能量）。
    const w = CONFIG.economy.accounting.windowTicks;
    expect(w / gate).toBeGreaterThanOrEqual(10 * w);
  });

  it("脉冲序列（均值 6/t，高于 G4）：快仪器会翻到门槛下，慢仪器不会", () => {
    // 均值 6 ⇒ 经济本身是达标的；摆动来自"这一窗撞到几个投递包/几次孵化"，不是来自产能。
    const pulses: number[] = [];
    for (let i = 0; i < 24; i++) pulses.push(i % 2 === 0 ? 26 : -14);

    const fast = series(pulses, CONFIG.economy.accounting.netFlowAlpha);
    const gate = series(pulses, CONFIG.economy.accounting.netFlowGateAlpha);

    // 快仪器：稳态后仍会跌破 5 ⇒ 用它当判据会让 G4 反复开合（历史行为）。
    const fastFails = fast.slice(6).filter(v => v < G4_MIN_NET_FLOW).length;
    expect(fastFails).toBeGreaterThan(0);

    // 慢仪器：暖机后持续 ≥5 ⇒ 「连续 500 拍」第一次成为可满足的要求。
    const gateFails = gate.slice(6).filter(v => v < G4_MIN_NET_FLOW).length;
    expect(gateFails).toBe(0);

    // 且慢仪器的离散度必须明显更小（这才是"更长视界"，不是"更大的数"）。
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(gate.slice(6))).toBeLessThan(spread(fast.slice(6)));
  });

  it("慢仪器不给虚假绿灯：真值长期为负时它同样让 G4 失败", () => {
    // 反向用例 —— 否则这条修复就只是"把闸抬高"的另一种写法。
    const negative = series(new Array(24).fill(-8), CONFIG.economy.accounting.netFlowGateAlpha);
    expect(negative.every(v => v < G4_MIN_NET_FLOW)).toBe(true);
  });

  it("冷启动：首见即取当窗值播种，不假设零、也不给乐观值", () => {
    expect(updateNetFlowEma(undefined, 17.7, CONFIG.economy.accounting.netFlowGateAlpha)).toBe(
      17.7,
    );
    // 当窗是负的 ⇒ 播种也是负的（换码后头几窗不会误放行）。
    expect(updateNetFlowEma(undefined, -3, CONFIG.economy.accounting.netFlowGateAlpha)).toBe(-3);
  });
});
