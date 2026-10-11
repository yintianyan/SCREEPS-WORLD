/**
 * #174 CPU 率表的截断口径单测 —— 钉的是「哪张表能拿来复算恒等式」。
 *
 * 立案（roadmap 补245／补248）＝`computeCpuRate` 在同一个返回对象里给了**两种覆盖域**：
 * `unphased` 用 `sum(cum.phases)` 全量，而 `byPhase` 走 `slice(0, 10)`。两者只在标签数 ≤ 上限时同值；
 * 补248 落了 `phase/early` 之后标签数正好是 10，**下一枚相位标签**（#173 的后备判据就要加它）
 * 会让读数人拿 `total − ΣbyPhase` 复算出一枚假残差 —— 而那张表存在的唯一目的就是复算这笔账。
 * 所以相位表关掉截断；`bySystem`／`byRole` 是「谁在吃产能」的榜，键是无界的，截断留着才有意义。
 */
import { describe, expect, it } from "vitest";
import { computeCpuRate } from "../../../src/systems/telemetry-collector";

const WINDOW = 100;

/** 12 枚相位标签（超过旧上限 10），值刻意取整十／整五以便 round2 无损耗。 */
const TWELVE_PHASES: Record<string, number> = {
  creeps: 60,
  post: 50,
  systems: 40,
  snapshots: 30,
  pre: 20,
  early: 15,
  "segments-flush": 10,
  summary: 8,
  observability: 5,
  "flush-skips": 4,
  budget: 3,
  tail2: 2,
};
const PHASE_SUM = Object.values(TWELVE_PHASES).reduce((a, b) => a + b, 0);

function cumWith(overrides: Partial<Parameters<typeof computeCpuRate>[0]> = {}) {
  return {
    total: 1000,
    systems: {},
    roles: {},
    phases: { ...TWELVE_PHASES },
    ...overrides,
  };
}

describe("computeCpuRate 的截断口径", () => {
  it("相位表 12 枚 ⇒ 全部在场（旧写法只会给 10 枚）", () => {
    const r = computeCpuRate(cumWith(), WINDOW);
    expect(Object.keys(r.byPhase)).toHaveLength(12);
  });

  it("恒等式可用表复算：total − ΣbyPhase === unphased（这是这张表唯一的用途）", () => {
    const r = computeCpuRate(cumWith(), WINDOW);
    const sum = Object.values(r.byPhase).reduce((a, b) => a + b, 0);
    expect(r.total).toBe(10);
    expect(r.unphased).toBeCloseTo(7.53, 2);
    expect(Math.round((r.total - sum) * 100) / 100).toBe(r.unphased);
  });

  it("相位表仍按大小降序（关掉截断不等于放弃排序）", () => {
    const vals = Object.values(computeCpuRate(cumWith(), WINDOW).byPhase);
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
    expect(vals[0]).toBe(0.6);
  });

  it("byRole／bySystem 的截断留着：榜的键是无界的，这里不该改成全量", () => {
    const roles: Record<string, number> = {};
    for (let i = 0; i < 25; i++) roles[`role${  String(i).padStart(2, "0")}`] = i + 1;
    const r = computeCpuRate(cumWith({ roles, systems: roles }), WINDOW);
    expect(Object.keys(r.byRole)).toHaveLength(10);
    expect(Object.keys(r.bySystem)).toHaveLength(10);
    // 被切掉的项并没有消失：`unexplained` 用全量求和 ⇒ (1000 − 325 − 325) ÷ 100 拍 = 3.5，
    // 而榜上只显示前十的 19..10 之和。这两把尺各答一问，不许互相折算。
    expect(Object.values(roles).reduce((a, b) => a + b, 0)).toBe(325);
    expect(PHASE_SUM).toBe(247);
    expect(r.unexplained).toBe(3.5);
  });

  it("相位表为空 ⇒ byPhase 是空对象而不是伪造项，unphased 就等于 total", () => {
    const r = computeCpuRate(cumWith({ phases: {} }), WINDOW);
    expect(r.byPhase).toEqual({});
    expect(r.unphased).toBe(r.total);
  });
});
