/**
 * 算力容量模型纯函数测试（R7a）。
 *
 * 覆盖：四档分界（abundant/comfortable/tight/constrained）、
 * 有效上限取 min(cpuLimit, tickLimit)（不写死 20 CPU）、
 * 降档立即、升档需持续窗口（滞回防抖）、余量计算。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPACITY_OPTIONS,
  evaluateCapacity,
  type CapacityInput,
} from "../../../src/domain/strategy/capacity";

const TICK = 1000;

function input(overrides: Partial<CapacityInput> = {}): CapacityInput {
  return {
    cpuLimit: 20,
    tickLimit: 500,
    bucket: 10000,
    cpuAvg10: 2,
    cpuMax10: 4,
    ...overrides,
  };
}

describe("evaluateCapacity — 分档", () => {
  it("avg/limit ≤ abundantRatio → abundant", () => {
    const r = evaluateCapacity(input({ cpuAvg10: 2 }), undefined, TICK); // 10% 占用
    expect(r.tier).toBe("abundant");
    expect(r.headroom).toBeCloseTo(0.9);
  });

  it("comfortable / tight / constrained 边界", () => {
    // 40% 占用：介于 abundant(35%) 与 tight(60%) 之间 → comfortable
    expect(evaluateCapacity(input({ cpuAvg10: 8 }), undefined, TICK).tier).toBe("comfortable");
    // 70% 占用：介于 tight(60%) 与 constrained(80%) 之间 → tight
    expect(evaluateCapacity(input({ cpuAvg10: 14 }), undefined, TICK).tier).toBe("tight");
    // 90% 占用 → constrained
    expect(evaluateCapacity(input({ cpuAvg10: 18 }), undefined, TICK).tier).toBe("constrained");
  });

  it("有效上限取 min(cpuLimit, tickLimit) — 不写死 20 CPU", () => {
    // tickLimit=10 更小 → 有效上限 10：avg=4 = 40% → comfortable（而非 20 下的 abundant）。
    expect(
      evaluateCapacity(input({ cpuLimit: 100, tickLimit: 10, cpuAvg10: 4 }), undefined, TICK).tier,
    ).toBe("comfortable");
    // 大 limit（订阅/GCL 增长）：avg=4 / limit=200 = 2% → abundant。
    expect(
      evaluateCapacity(input({ cpuLimit: 200, tickLimit: 500, cpuAvg10: 4 }), undefined, TICK).tier,
    ).toBe("abundant");
  });
});

describe("evaluateCapacity — 滞回", () => {
  it("降档立即生效（收缩刻不容缓）", () => {
    const r = evaluateCapacity(
      input({ cpuAvg10: 18 }),
      { tier: "abundant", since: TICK - 5, upgradeTicks: 0 },
      TICK,
    );
    expect(r.tier).toBe("constrained");
    expect(r.since).toBe(TICK);
  });

  it("升档需持续满足窗口（防尖峰间隙误扩雄心）", () => {
    const prev = { tier: "comfortable" as const, since: TICK - 500, upgradeTicks: 0 };
    // 第 1 次满足 → 仍 comfortable，计数 1。
    const r1 = evaluateCapacity(input({ cpuAvg10: 2 }), prev, TICK);
    expect(r1.tier).toBe("comfortable");
    expect(r1.upgradeTicks).toBe(1);

    // 第 windowTicks-1 次满足 → 计数满 → 升档（本轮即第 windowTicks 次持续满足）。
    const near = { tier: "comfortable" as const, since: TICK - 500, upgradeTicks: DEFAULT_CAPACITY_OPTIONS.upgradeWindowTicks - 1 };
    const r2 = evaluateCapacity(input({ cpuAvg10: 2 }), near, TICK);
    expect(r2.tier).toBe("abundant");
    expect(r2.upgradeTicks).toBe(0);
    expect(r2.since).toBe(TICK);
  });

  it("同档保持 since 与计数归零", () => {
    const r = evaluateCapacity(
      input({ cpuAvg10: 2 }),
      { tier: "abundant", since: TICK - 800, upgradeTicks: 5 },
      TICK,
    );
    expect(r.tier).toBe("abundant");
    expect(r.since).toBe(TICK - 800);
    expect(r.upgradeTicks).toBe(0);
  });

  it("首次评估（无 prev）直接采纳目标档", () => {
    const r = evaluateCapacity(input({ cpuAvg10: 18 }), undefined, TICK);
    expect(r.tier).toBe("constrained");
  });
});
