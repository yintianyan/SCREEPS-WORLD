/** 自检面（E 系列）的截断留痕列＝`Memory.kernel.expectations.violationsTotal`。
 * 动它的原因：`violations` 是 `.slice(0,10)` 的当前 pass 快照、`recent` 另有 LRU 上限，
 * 于是"这一列里没有 E5"与"E5 没有违例"是同一个形状——而这是机器的自检面，读错方向是往
 * "一切正常"那边读。加一列全数，配平检查就能做（total>榜宽 ⇒ 快照被切，负向结论作废）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { Kernel } from "../../../src/kernel/kernel";
import { Registry } from "../../../src/kernel/registry";
import { resetGlobals } from "../../support/factories";

function makeCtx(tick: number): any {
  return {
    tick,
    budget: {
      tier: "healthy",
      softLimit: 12,
      hardLimit: 20,
      canStart: () => true,
      isExhausted: () => false,
      spent: () => 0,
    },
    // 各 collect* 只遍历快照 ⇒ 空集合＝它们都零输入，违例只能来自 stats/bootTick 这类帝国级缺件。
    snapshots: () => [],
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("expectations.violationsTotal — 自检面的截断前全数", () => {
  it("缺 stats 的现场会违例，且落盘的榜长恒等于 min(全数, 10)", () => {
    (globalThis as any).Memory.kernel = { bootTick: (globalThis as any).Game.time };
    const kernel = new Kernel(new Registry());

    (kernel as any).runExpectations(makeCtx((globalThis as any).Game.time));

    const exp = (globalThis as any).Memory.kernel.expectations;
    // 前提检查：这条路真的有产出（否则下面的不变式是空集上恒真＝假守卫）
    expect(exp).toBeDefined();
    expect(typeof exp.violationsTotal).toBe("number");
    expect(exp.violationsTotal).toBeGreaterThan(0);
    expect(exp.violations.length).toBe(Math.min(exp.violationsTotal, 10));
  });

  it("榜未截断时两列同数（total 不是榜长的复读，而是截断前的真值）", () => {
    (globalThis as any).Memory.kernel = { bootTick: (globalThis as any).Game.time };
    const kernel = new Kernel(new Registry());

    (kernel as any).runExpectations(makeCtx((globalThis as any).Game.time));

    const exp = (globalThis as any).Memory.kernel.expectations;
    if (exp.violationsTotal <= 10) {
      expect(exp.violations.length).toBe(exp.violationsTotal);
    } else {
      expect(exp.violations.length).toBe(10);
    }
  });

  it('零违例那一支也必须写这列（缺席只允许有一种解释＝产物没这列，而不是"没违例"）', () => {
    // 现场：帝国级输入齐全 ⇒ 走 `else` 支（`violations=[]`）。
    (globalThis as any).Memory.kernel = {
      bootTick: (globalThis as any).Game.time,
      // 两处都要给：`lastSample` 喂 telemetryStale（E1），`cpuRate` 的窗喂采样类判据。
      stats: {
        lastSample: (globalThis as any).Game.time,
        cpuRate: { total: 10, windowTicks: 1000, sampledTicks: 1000, unsampledTicks: 0 },
      },
    };
    (globalThis as any).Memory.rooms = {};
    const kernel = new Kernel(new Registry());

    (kernel as any).runExpectations(makeCtx((globalThis as any).Game.time));

    const exp = (globalThis as any).Memory.kernel.expectations;
    expect(exp).toBeDefined();
    // 这条断言就是本次修复的全部动机：零违例时 `violationsTotal` 要在场且等于 0，
    // 于是读数人拿"键不存在"只剩一个合法解释（旧写法下它恒等于 0 ⇒ 与未上线同形）。
    expect(exp.violations.length).toBe(0);
    expect(exp.violationsTotal).toBe(0);
  });
});
