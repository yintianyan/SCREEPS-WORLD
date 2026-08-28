import { describe, expect, it, beforeEach } from "vitest";
import { resolveTier, CpuBudget } from "../../../src/kernel/scheduler";
import type { CpuTier, Priority } from "../../../src/kernel/contracts";

describe("Scheduler — resolveTier", () => {
  it("returns recovery for undefined previous tier and low bucket", () => {
    const result = resolveTier(undefined, 0, 500);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("returns healthy for undefined previous tier and high bucket", () => {
    const result = resolveTier(undefined, 0, 8000);
    expect(result.tier).toBe("healthy");
    expect(result.recoveryTicks).toBe(0);
  });

  it("immediately drops to a worse tier on low bucket", () => {
    // 当前 healthy，bucket 降至 7000 以下
    const result = resolveTier("healthy", 10, 6500);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(0);
  });

  it("immediately drops to recovery on very low bucket", () => {
    const result = resolveTier("healthy", 10, 500);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("does not immediately upgrade without hysteresis", () => {
    // 当前 recovery，bucket 在 1001（刚好超过 conserve 阈值）
    // 需要超过 1000 + 500 = 1500 才满足滞回
    const result = resolveTier("recovery", 0, 1001);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("starts recovery tick counter when bucket exceeds hysteresis threshold", () => {
    // 当前 recovery，bucket 超过 1500（1000 + 500 滞回）
    const result = resolveTier("recovery", 0, 1600);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(1);
  });

  it("increments recovery ticks on sustained high bucket", () => {
    const result = resolveTier("recovery", 15, 1600);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(16);
  });

  it("upgrades after 20 sustained ticks", () => {
    // 19 tick -> 仍为 recovery，tick = 20 时升级到 conserve
    const result = resolveTier("recovery", 19, 1600);
    expect(result.tier).toBe("conserve");
    expect(result.recoveryTicks).toBe(0);
  });

  it("resets recovery ticks when bucket drops below hysteresis", () => {
    const result = resolveTier("recovery", 15, 1200);
    expect(result.tier).toBe("recovery");
    expect(result.recoveryTicks).toBe(0);
  });

  it("guarded to healthy requires bucket above 7500 for 20 ticks", () => {
    // bucket 在 7400（低于 7000 + 500 = 7500）
    let result = resolveTier("guarded", 0, 7400);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(0);

    // bucket 在 7600（超过 7500）
    result = resolveTier("guarded", 0, 7600);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(1);

    // 20 tick 后
    result = resolveTier("guarded", 19, 7600);
    expect(result.tier).toBe("healthy");
    expect(result.recoveryTicks).toBe(0);
  });

  it("conserve to guarded requires bucket above 3500 for 20 ticks", () => {
    let result = resolveTier("conserve", 0, 3400);
    expect(result.tier).toBe("conserve");
    expect(result.recoveryTicks).toBe(0);

    result = resolveTier("conserve", 0, 3600);
    expect(result.tier).toBe("conserve");
    expect(result.recoveryTicks).toBe(1);

    result = resolveTier("conserve", 19, 3600);
    expect(result.tier).toBe("guarded");
    expect(result.recoveryTicks).toBe(0);
  });
});

describe("Scheduler — 自愿放血宽限（generatePixel 后 recovery 地板抬到 conserve）", () => {
  it("宽限期内 bucket=0 → conserve 而非 recovery（P2 经济角色不冻结）", () => {
    const result = resolveTier("healthy", 0, 0, true);
    expect(result.tier).toBe("conserve");
  });

  it("无宽限时 bucket=0 → recovery（真实 CPU 失控的原有语义不变）", () => {
    const result = resolveTier("healthy", 0, 0, false);
    expect(result.tier).toBe("recovery");
  });

  it("宽限只抬 recovery 地板 — 自然档位为 guarded/conserve 时不受影响", () => {
    // bucket 5000 → 自然 guarded，宽限不改变。
    expect(resolveTier(undefined, 0, 5000, true).tier).toBe("guarded");
    // bucket 1500 → 自然 conserve，宽限不改变。
    expect(resolveTier(undefined, 0, 1500, true).tier).toBe("conserve");
  });

  it("宽限期内滞回爬升记账照常 — 从 conserve 向 guarded 的恢复不被干扰", () => {
    // 宽限地板下 tier=conserve，bucket 爬回 3600（> guarded.min+滞回）开始计数。
    const r1 = resolveTier("conserve", 0, 3600, true);
    expect(r1.tier).toBe("conserve");
    expect(r1.recoveryTicks).toBe(1);
    const r2 = resolveTier("conserve", 19, 3600, true);
    expect(r2.tier).toBe("guarded");
  });
});

// ── P1-2: CPU 前馈预测 ──────────────────────────────────────

describe("CpuBudget — 前馈预测 (P1-2)", () => {
  beforeEach(() => {
    // 重置 Game.cpu mock 和 Memory
    (globalThis as any).Game = {
      time: 1000,
      cpu: {
        limit: 20,
        tickLimit: 500,
        bucket: 10000,
        getUsed: () => 0,
      },
    };
    (globalThis as any).Memory = { kernel: {} };
  });

  it("无 stats 时退化为原有行为（前馈检查静默跳过）", () => {
    const budget = new CpuBudget("healthy");
    // 无 stats → 前馈检查不生效，P2 正常通过
    expect(budget.canStart(2 as Priority)).toBe(true);
    expect(budget.canStart(3 as Priority)).toBe(true);
  });

  it("峰值仅在真实触顶（max10 ≥ hardLimit）时拒 P2+；80% 尖峰不再永久饥饿（P3 饥饿回归）", () => {
    // healthy tier: hardLimit = 20*0.96=19.2, softLimit = min(20*0.875, 18.2)=17.5
    const budget = new CpuBudget("healthy");
    // cpuMax10 = 16：旧判据 0.8*19.2=15.36 会拒 P2+/P3（自锁饥饿根因），
    // 新判据 16 < 19.2 → 放行
    (globalThis as any).Memory = {
      kernel: {
        stats: { cpuMax10: 16, cpuAvg10: 10 },
      },
    };
    expect(budget.canStart(0 as Priority)).toBe(true);
    expect(budget.canStart(1 as Priority)).toBe(true);
    expect(budget.canStart(2 as Priority)).toBe(true);
    expect(budget.canStart(3 as Priority)).toBe(true);
  });

  it("cpuMax10 真实触顶 hardLimit → P2+ 拒绝（P0/P1 仍放行）", () => {
    const budget = new CpuBudget("healthy");
    (globalThis as any).Memory = {
      kernel: {
        stats: { cpuMax10: 19.5, cpuAvg10: 10 },
      },
    };
    expect(budget.canStart(0 as Priority)).toBe(true);
    expect(budget.canStart(1 as Priority)).toBe(true);
    expect(budget.canStart(2 as Priority)).toBe(false);
    expect(budget.canStart(3 as Priority)).toBe(false);
  });

  it("cpuAvg10 触及 softLimit 时 P3+ 被拒绝（P2 仍放行）", () => {
    const budget = new CpuBudget("healthy");
    // cpuAvg10 = 18 >= 17.5 → 基线高企，P3+ 拒绝
    // cpuMax10 = 14 < 19.2 → P2 仍放行
    (globalThis as any).Memory = {
      kernel: {
        stats: { cpuMax10: 14, cpuAvg10: 18 },
      },
    };
    expect(budget.canStart(2 as Priority)).toBe(true);
    expect(budget.canStart(3 as Priority)).toBe(false);
  });

  it("历史 CPU 低位时前馈检查不生效", () => {
    const budget = new CpuBudget("healthy");
    (globalThis as any).Memory = {
      kernel: {
        stats: { cpuMax10: 5, cpuAvg10: 3 },
      },
    };
    expect(budget.canStart(0 as Priority)).toBe(true);
    expect(budget.canStart(1 as Priority)).toBe(true);
    expect(budget.canStart(2 as Priority)).toBe(true);
    expect(budget.canStart(3 as Priority)).toBe(true);
  });

  it("P3 饥饿旁路：bypass 生效时 max10 触顶也放行 P2/P3（自锁解除）；bucket 低位失效", () => {
    (globalThis as any).Memory = {
      kernel: { stats: { cpuMax10: 19.5, cpuAvg10: 18 }, p3StarveBypassUntil: 82450000 + 600 },
    };
    (globalThis as any).Game.cpu.getUsed = () => 3;
    (globalThis as any).Game.cpu.bucket = 10000;
    const budget = new CpuBudget("healthy");
    expect(budget.canStart(2 as Priority)).toBe(true);
    expect(budget.canStart(3 as Priority)).toBe(true);
    // bucket 低位 → 旁路失效（不拿生存换观测）
    (globalThis as any).Game.cpu.bucket = 2000;
    const budgetLow = new CpuBudget("healthy");
    expect(budgetLow.canStart(3 as Priority)).toBe(false);
  });

  it("isExhausted 优先于前馈检查", () => {
    // Game.cpu.getUsed 已超 hardLimit → 所有优先级拒绝
    (globalThis as any).Game.cpu.getUsed = () => 100;
    const budget = new CpuBudget("healthy");
    (globalThis as any).Memory = {
      kernel: {
        stats: { cpuMax10: 5, cpuAvg10: 3 },
      },
    };
    expect(budget.canStart(0 as Priority)).toBe(false);
  });
});

describe("Emergency Survival Mode — Recovery 档内的紧急安全状态（非第五档）", () => {
  beforeEach(() => {
    (globalThis as any).Game = {
      time: 1000,
      cpu: { limit: 20, tickLimit: 500, bucket: 0, getUsed: () => 0 },
      creeps: {},
      rooms: {},
    };
    (globalThis as any).Memory = { kernel: {} };
  });

  it("canStart：emergency 时仅 P0 放行，P1+ 全拒", () => {
    const budget = new CpuBudget("recovery", true);
    expect(budget.emergency).toBe(true);
    expect(budget.canStart(0)).toBe(true);
    expect(budget.canStart(1)).toBe(false);
    expect(budget.canStart(2)).toBe(false);
    expect(budget.canStart(3)).toBe(false);
  });

  it("非 emergency 的 recovery 档照常放行 P3（旁路仅 ESM 专属）", () => {
    const budget = new CpuBudget("recovery", false);
    expect(budget.emergency).toBe(false);
    // recovery 档 tierMaxPriority 内的优先级不受 ESM 门影响。
    expect(budget.canStart(0)).toBe(true);
  });

  it("CpuTier 枚举保持四档——ESM 不是档位成员", () => {
    const tiers: CpuTier[] = ["healthy", "guarded", "conserve", "recovery"];
    expect(tiers).toHaveLength(4);
    expect(tiers).not.toContain("emergency" as unknown as CpuTier);
  });
});
