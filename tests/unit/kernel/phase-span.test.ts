/**
 * #173 早段记账（`recordPhaseSpan`）单测 —— 验"补记"落进正确的桶，且闸关时确实记不进去。
 *
 * 立案过程见 roadmap 补245／补248：`recordCpu` 第一行要求 `g.telemetry.tick === Game.time`，
 * 而那个时标要到 `phase/pre` 内部的 telemetry-init 才刷新 ⇒ 早于它的语句（预算判定、上下文构造）
 * 用 `measuredRun` 包也只会得到一个**构造性 0**（不是"那里不花钱"）。线上实测这段 ≈0.87 CPU/拍
 * 长期住在 `unphased` 里；`recordPhaseSpan` 是闸打开之后按已知跨度补记的唯一入口，本文件钉住它。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalCache } from "../../../src/kernel/global-cache";
import { recordPhaseSpan } from "../../../src/kernel/safe-run";
import { computeCpuRate } from "../../../src/systems/telemetry-collector";
import { resetGlobals } from "../../support/factories";

const now = () => (globalThis as any).Game.time as number;

/**
 * 只喂 `recordCpu` 第一行要看的那一个字段；`cpuCumulative` 预先摆成"本拍刚开始"的形状，
 * 这样 phases 桶的有无就是唯一的变量（不用 delete，省掉与类型形状的争执）。
 */
function armGate(tick: number, total = 0): void {
  const g = globalCache();
  g.telemetry = { tick, systemCpu: {}, roleCpu: {}, errors: 0 } as never;
  g.cpuCumulative = { total, systems: {}, roles: {} };
}

beforeEach(() => {
  resetGlobals();
});

describe("recordPhaseSpan", () => {
  it("闸开 ⇒ 补记落进 phases 桶（与 measuredRun 的相位标签同一个桶）", () => {
    armGate(now());
    recordPhaseSpan("early", 0.5);
    expect(globalCache().cpuCumulative?.phases?.early).toBe(0.5);
  });

  it("同一拍两次调用是累加不是覆盖（跨度允许分段补记）", () => {
    armGate(now());
    recordPhaseSpan("early", 0.5);
    recordPhaseSpan("early", 0.25);
    expect(globalCache().cpuCumulative?.phases?.early).toBeCloseTo(0.75, 10);
  });

  it("闸关（时标不是本拍）⇒ 一个字都不写＝那个构造性 0 的真身", () => {
    armGate(now() - 1);
    recordPhaseSpan("early", 0.7);
    expect(globalCache().cpuCumulative?.phases?.early).toBeUndefined();
  });

  it("补记不污染系统榜与角色榜（三个桶各自的问法不能互裁）", () => {
    armGate(now());
    recordPhaseSpan("early", 0.5);
    const cum = globalCache().cpuCumulative;
    expect(Object.keys(cum?.systems ?? {})).toHaveLength(0);
    expect(Object.keys(cum?.roles ?? {})).toHaveLength(0);
    expect(Object.keys(cum?.phases ?? {})).toEqual(["early"]);
  });

  it("恒等式语义不变：total 不动而 unphased 随补记下降", () => {
    // 可执行版的"为什么要补记"：同一份 total=10（÷10 拍＝1/拍）的账，
    // 相位桶里有没有 early 这一项，unphased 差出一个跨度 —— 线上那 0.87/拍就住在这个差里。
    armGate(now(), 10);
    const before = computeCpuRate(globalCache().cpuCumulative!, 10).unphased;
    recordPhaseSpan("early", 0.87);
    const after = computeCpuRate(globalCache().cpuCumulative!, 10).unphased;
    expect(before).toBe(1);
    expect(after).toBeCloseTo(0.91, 2);
  });
});
