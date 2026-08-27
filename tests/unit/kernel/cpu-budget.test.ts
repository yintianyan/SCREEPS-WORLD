/** CpuBudget 比例化 CPU 上限测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { CpuBudget, createBudget } from "../../../src/kernel/scheduler";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 覆盖 Game.cpu.limit / tickLimit / getUsed。 */
function setCpu(limit: number, tickLimit = limit, used = 0): void {
  const cpu = (globalThis as { Game: { cpu: { limit: number; tickLimit: number; getUsed: () => number } } }).Game.cpu;
  cpu.limit = limit;
  cpu.tickLimit = tickLimit;
  cpu.getUsed = () => used;
}

describe("CpuBudget — 20 CPU 基线（官服行为零回归）", () => {
  it("healthy 档 soft/hard 与旧绝对值 17.5/19.2 一致", () => {
    setCpu(20);
    const budget = new CpuBudget("healthy");
    expect(budget.hardLimit).toBeCloseTo(19.2, 5);
    expect(budget.softLimit).toBeCloseTo(17.5, 5);
  });

  it("各档 soft/hard 反推自比例 × 20，与旧绝对值表一致", () => {
    setCpu(20);
    const expected = {
      healthy: { soft: 17.5, hard: 19.2 },
      guarded: { soft: 16, hard: 18.5 },
      conserve: { soft: 14, hard: 17 },
      recovery: { soft: 12, hard: 15.5 },
    } as const;
    for (const tier of ["healthy", "guarded", "conserve", "recovery"] as const) {
      const budget = new CpuBudget(tier);
      expect(budget.softLimit).toBeCloseTo(expected[tier].soft, 5);
      expect(budget.hardLimit).toBeCloseTo(expected[tier].hard, 5);
    }
  });
});

describe("CpuBudget — 100 CPU 私服（按比例放大）", () => {
  it("healthy 档释放预算：soft=87.5 / hard=96", () => {
    setCpu(100);
    const budget = new CpuBudget("healthy");
    expect(budget.hardLimit).toBeCloseTo(96, 5);
    expect(budget.softLimit).toBeCloseTo(87.5, 5);
  });

  it("各档均按 limit × ratio 线性缩放", () => {
    setCpu(100);
    for (const tier of ["healthy", "guarded", "conserve", "recovery"] as const) {
      const ratios = CONFIG.cpu.limits[tier];
      const budget = new CpuBudget(tier);
      // 100 CPU 下 reserve(0.8) 远小于比例余量，hardLimit = ratio × limit。
      expect(budget.hardLimit).toBeCloseTo(100 * ratios.hardRatio, 5);
      expect(budget.softLimit).toBeCloseTo(100 * ratios.softRatio, 5);
    }
  });
});

describe("CpuBudget — 10 CPU 低配（绝对余量保护生效）", () => {
  it("hardLimit 取 ratio 与 limit-reserve 的较小值（reserve 占比抬高）", () => {
    setCpu(10);
    const budget = new CpuBudget("healthy");
    // 10*0.96=9.6 vs 10-0.8=9.2 → 取 9.2（reserve 保护）
    expect(budget.hardLimit).toBeCloseTo(9.2, 5);
    // soft 受 hardLimit-1 兜底：min(10*0.875=8.75, 9.2-1=8.2) → 8.2
    expect(budget.softLimit).toBeCloseTo(8.2, 5);
  });

  it("所有档位 hardLimit 不低于 reserve 后的余量", () => {
    setCpu(10);
    const reserve = CONFIG.kernel.cpuReserve;
    for (const tier of ["healthy", "guarded", "conserve", "recovery"] as const) {
      const budget = new CpuBudget(tier);
      // hardLimit ≤ limit - reserve（绝对余量兜底）
      expect(budget.hardLimit).toBeLessThanOrEqual(10 - reserve);
      // softLimit < hardLimit（保留 P0 空间）
      expect(budget.softLimit).toBeLessThan(budget.hardLimit);
    }
  });
});

describe("CpuBudget — tickLimit 低位保护（bucket 借用耗尽）", () => {
  // 语义意图（Issue 1 锁定）：limit=20, tickLimit=15 时 effectiveLimit=15。
  // bucket 低位意味着可持续预算被压缩，各档 hard 按「档位比例 × tickLimit」收缩，
  // 而非沿用绝对值。相比旧逻辑（min(绝对hard, tickLimit-reserve)），非 healthy 档
  // 在新逻辑下更紧——这是有意为之：低优先级档位理应更早让出 CPU。
  //   healthy  hardRatio=0.96 → 14.4 > reserve 兜底 14.2 → 行为不变
  //   guarded  hardRatio=0.925 → 13.875 < 旧 14.2 → 更紧
  //   conserve hardRatio=0.85  → 12.75  < 旧 14.2 → 更紧
  //   recovery hardRatio=0.775 → 11.625 < 旧 14.2 → 更紧
  // 用具体数字断言（非实现表达式）以独立验证语义意图。

  it("healthy 档 hard 由 reserve 兜底（与旧绝对值逻辑一致）", () => {
    setCpu(20, 15);
    const budget = new CpuBudget("healthy");
    // hard = min(15×0.96=14.4, 15−0.8=14.2) → 14.2（reserve 先兜底）
    expect(budget.hardLimit).toBeCloseTo(14.2, 5);
    // soft = min(15×0.875=13.125, 14.2−1=13.2) → 13.125
    expect(budget.softLimit).toBeCloseTo(13.125, 5);
  });

  it("guarded 档 hard 按比例收缩（13.875 < 旧 14.2，更紧是有意为之）", () => {
    setCpu(20, 15);
    const budget = new CpuBudget("guarded");
    // hard = min(15×0.925=13.875, 14.2) → 13.875（比例先兜底）
    expect(budget.hardLimit).toBeCloseTo(13.875, 5);
    // soft = min(15×0.80=12, 13.875−1=12.875) → 12
    expect(budget.softLimit).toBeCloseTo(12, 5);
  });

  it("conserve 档 hard 按比例收缩（12.75 < 旧 14.2，更紧是有意为之）", () => {
    setCpu(20, 15);
    const budget = new CpuBudget("conserve");
    // hard = min(15×0.85=12.75, 14.2) → 12.75
    expect(budget.hardLimit).toBeCloseTo(12.75, 5);
    // soft = min(15×0.70=10.5, 12.75−1=11.75) → 10.5
    expect(budget.softLimit).toBeCloseTo(10.5, 5);
  });

  it("recovery 档 hard 按比例收缩（11.625 < 旧 14.2，更紧是有意为之）", () => {
    setCpu(20, 15);
    const budget = new CpuBudget("recovery");
    // hard = min(15×0.775=11.625, 14.2) → 11.625
    expect(budget.hardLimit).toBeCloseTo(11.625, 5);
    // soft = min(15×0.60=9, 11.625−1=10.625) → 9
    expect(budget.softLimit).toBeCloseTo(9, 5);
  });
});

describe("CpuBudget — 极端低 limit 防御（softLimit 不为负，Issue 2）", () => {
  // limit < reserve 的场景：服务器不会低于 20，私服自定义极少低于 5，
  // 但私服 CPU 可变，兜底防止负 softLimit 导致 canStart 语义混乱。
  it("limit=1 时 softLimit 兜底为 0（非 P0 全拒，P0 受 hardLimit 限制）", () => {
    setCpu(1);
    const budget = new CpuBudget("healthy");
    // hard = min(1×0.96=0.96, 1−0.8=0.2) → 0.2
    expect(budget.hardLimit).toBeCloseTo(0.2, 5);
    // soft = max(0, min(1×0.875=0.875, 0.2−1=−0.8)) → max(0, −0.8) → 0
    expect(budget.softLimit).toBe(0);
    expect(budget.softLimit).toBeGreaterThanOrEqual(0);
  });

  it("limit=3 时 softLimit 正常计算（reserve 未吃满，比例兜底生效）", () => {
    setCpu(3);
    const budget = new CpuBudget("healthy");
    // hard = min(3×0.96=2.88, 3−0.8=2.2) → 2.2
    expect(budget.hardLimit).toBeCloseTo(2.2, 5);
    // soft = max(0, min(3×0.875=2.625, 2.2−1=1.2)) → max(0, 1.2) → 1.2
    expect(budget.softLimit).toBeCloseTo(1.2, 5);
  });
});

describe("CpuBudget — canStart 限流行为", () => {
  it("P0 始终尝试（即使超 softLimit）", () => {
    setCpu(20, 20, 18); // used=18 > softLimit(17.5)，未超 hardLimit(19.2)
    const budget = new CpuBudget("healthy");
    expect(budget.canStart(0)).toBe(true);
  });

  it("非 P0 在超 softLimit 时被拒", () => {
    setCpu(20, 20, 18);
    const budget = new CpuBudget("healthy");
    expect(budget.canStart(1)).toBe(false);
    expect(budget.canStart(2)).toBe(false);
  });

  it("非 P0 在未超 softLimit 时放行", () => {
    setCpu(20, 20, 10);
    const budget = new CpuBudget("healthy");
    expect(budget.canStart(1)).toBe(true);
  });

  it("超 hardLimit 时 P0 也被拒（硬上限兜底）", () => {
    setCpu(20, 20, 19.5); // > hardLimit(19.2)
    const budget = new CpuBudget("healthy");
    expect(budget.isExhausted()).toBe(true);
    expect(budget.canStart(0)).toBe(false);
  });

  it("档位最大优先级限制：recovery 档拒绝 P2+", () => {
    setCpu(20, 20, 0);
    const budget = new CpuBudget("recovery");
    // recovery maxPriority = 1
    expect(budget.canStart(1)).toBe(true);
    expect(budget.canStart(2)).toBe(false);
  });
});

describe("createBudget — 档位跟踪与持久化", () => {
  it("高 bucket 时返回 healthy 档预算", () => {
    setCpu(20);
    (globalThis as { Game: { cpu: { bucket: number } } }).Game.cpu.bucket = 8000;
    const budget = createBudget();
    expect(budget.tier).toBe("healthy");
    expect(budget.hardLimit).toBeCloseTo(19.2, 5);
  });

  it("低 bucket 时返回 recovery 档预算并持久化 tier", () => {
    setCpu(20);
    (globalThis as { Game: { cpu: { bucket: number } } }).Game.cpu.bucket = 500;
    const budget = createBudget();
    expect(budget.tier).toBe("recovery");
    // recovery 在 20 CPU 下：hard = min(20*0.775=15.5, 20-0.8=19.2) → 15.5
    expect(budget.hardLimit).toBeCloseTo(15.5, 5);
  });
});
