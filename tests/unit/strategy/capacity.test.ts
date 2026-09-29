/** 算力容量模型纯函数测试（R7a）。 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPACITY_OPTIONS,
  evaluateCapacity,
  pickCpuUsagePerTick,
  type CapacityInput,
} from "../../../src/domain/strategy/capacity";

const TICK = 1000;

function input(overrides: Partial<CapacityInput> = {}): CapacityInput {
  return {
    cpuLimit: 20,
    tickLimit: 500,
    bucket: 10000,
    cpuUsagePerTick: 2,
    cpuMax10: 4,
    ...overrides,
  };
}

describe("evaluateCapacity — 分档", () => {
  it("avg/limit ≤ abundantRatio → abundant", () => {
    const r = evaluateCapacity(input({ cpuUsagePerTick: 2 }), undefined, TICK); // 10% 占用
    expect(r.tier).toBe("abundant");
    expect(r.headroom).toBeCloseTo(0.9);
  });

  it("comfortable / tight / constrained 边界", () => {
    // 40% 占用：介于 abundant(35%) 与 tight(60%) 之间 → comfortable
    expect(evaluateCapacity(input({ cpuUsagePerTick: 8 }), undefined, TICK).tier).toBe(
      "comfortable",
    );
    // 70% 占用：介于 tight(60%) 与 constrained(80%) 之间 → tight
    expect(evaluateCapacity(input({ cpuUsagePerTick: 14 }), undefined, TICK).tier).toBe("tight");
    // 90% 占用 → constrained
    expect(evaluateCapacity(input({ cpuUsagePerTick: 18 }), undefined, TICK).tier).toBe(
      "constrained",
    );
  });

  it("有效上限取 min(cpuLimit, tickLimit) — 不写死 20 CPU", () => {
    // tickLimit=10 更小 → 有效上限 10：avg=4 = 40% → comfortable（而非 20 下的 abundant）。
    expect(
      evaluateCapacity(input({ cpuLimit: 100, tickLimit: 10, cpuUsagePerTick: 4 }), undefined, TICK)
        .tier,
    ).toBe("comfortable");
    // 大 limit（订阅/GCL 增长）：avg=4 / limit=200 = 2% → abundant。
    expect(
      evaluateCapacity(
        input({ cpuLimit: 200, tickLimit: 500, cpuUsagePerTick: 4 }),
        undefined,
        TICK,
      ).tier,
    ).toBe("abundant");
  });
});

describe("evaluateCapacity — 滞回", () => {
  it("降档立即生效（收缩刻不容缓）", () => {
    const r = evaluateCapacity(
      input({ cpuUsagePerTick: 18 }),
      { tier: "abundant", since: TICK - 5, upgradeTicks: 0 },
      TICK,
    );
    expect(r.tier).toBe("constrained");
    expect(r.since).toBe(TICK);
  });

  it("升档需持续满足窗口（防尖峰间隙误扩雄心）", () => {
    const prev = { tier: "comfortable" as const, since: TICK - 500, upgradeTicks: 0 };
    // 第 1 次满足 → 仍 comfortable，计数 1。
    const r1 = evaluateCapacity(input({ cpuUsagePerTick: 2 }), prev, TICK);
    expect(r1.tier).toBe("comfortable");
    expect(r1.upgradeTicks).toBe(1);

    // 第 windowTicks-1 次满足 → 计数满 → 升档（本轮即第 windowTicks 次持续满足）。
    const near = {
      tier: "comfortable" as const,
      since: TICK - 500,
      upgradeTicks: DEFAULT_CAPACITY_OPTIONS.upgradeWindowTicks - 1,
    };
    const r2 = evaluateCapacity(input({ cpuUsagePerTick: 2 }), near, TICK);
    expect(r2.tier).toBe("abundant");
    expect(r2.upgradeTicks).toBe(0);
    expect(r2.since).toBe(TICK);
  });

  it("同档保持 since 与计数归零", () => {
    const r = evaluateCapacity(
      input({ cpuUsagePerTick: 2 }),
      { tier: "abundant", since: TICK - 800, upgradeTicks: 5 },
      TICK,
    );
    expect(r.tier).toBe("abundant");
    expect(r.since).toBe(TICK - 800);
    expect(r.upgradeTicks).toBe(0);
  });

  it("首次评估（无 prev）直接采纳目标档", () => {
    const r = evaluateCapacity(input({ cpuUsagePerTick: 18 }), undefined, TICK);
    expect(r.tier).toBe("constrained");
  });
});

describe("pickCpuUsagePerTick — 用哪一份 CPU 均值分档", () => {
  // 线上实测形状：逐拍均量 10.56（窗 420 拍、unsampledTicks=0）vs 同一时刻
  // cpuAvg10=13.2。门槛 comfortable 需要 ≤12 ⇒ 喂后者会把有 47% 余量的帝国判成 tight。
  it("三份窗内读数一致时可采信逐拍均量", () => {
    expect(
      pickCpuUsagePerTick({
        avg10: 13.2,
        rateTotal: 10.56,
        rateWindowTicks: 420,
        rateUnsampledTicks: 0,
      }),
    ).toBe(10.56);
  });

  it("窗未建立（新 Memory／首次采样前）退回偏高的 avg10 —— 保守侧", () => {
    expect(pickCpuUsagePerTick({ avg10: 13.2 })).toBe(13.2);
    expect(
      pickCpuUsagePerTick({
        avg10: 13.2,
        rateTotal: 5.1,
        rateWindowTicks: 0,
        rateUnsampledTicks: 0,
      }),
    ).toBe(13.2);
  });

  it("窗长不足 100 拍（启动期把单拍用量当均值）不采信", () => {
    expect(
      pickCpuUsagePerTick({
        avg10: 13.2,
        rateTotal: 5.1,
        rateWindowTicks: 1,
        rateUnsampledTicks: 0,
      }),
    ).toBe(13.2);
    // 恰好到 100（≈ 被替换掉的 cpuAvg10 所覆盖的拍数）才开始采信。
    expect(
      pickCpuUsagePerTick({
        avg10: 13.2,
        rateTotal: 10.6,
        rateWindowTicks: 100,
        rateUnsampledTicks: 0,
      }),
    ).toBe(10.6);
  });

  it("窗内有漏采的拍 ⇒ total 少算了消耗（偏低＝不安全），退回 avg10", () => {
    expect(
      pickCpuUsagePerTick({
        avg10: 13.2,
        rateTotal: 8.0,
        rateWindowTicks: 420,
        rateUnsampledTicks: 3,
      }),
    ).toBe(13.2);
  });

  it("接进分档：同一帝国用逐拍均量判 comfortable、用 avg10 判 tight", () => {
    const base = { cpuLimit: 20, tickLimit: 500, bucket: 10000, cpuMax10: 15.2 };
    expect(
      evaluateCapacity(
        {
          ...base,
          cpuUsagePerTick: pickCpuUsagePerTick({
            avg10: 13.2,
            rateTotal: 10.56,
            rateWindowTicks: 420,
            rateUnsampledTicks: 0,
          }),
        },
        undefined,
        TICK,
      ).tier,
    ).toBe("comfortable");
    expect(
      evaluateCapacity(
        { ...base, cpuUsagePerTick: pickCpuUsagePerTick({ avg10: 13.2 }) },
        undefined,
        TICK,
      ).tier,
    ).toBe("tight");
  });
});
