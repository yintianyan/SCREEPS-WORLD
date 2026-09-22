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
    // bucket 刻意压在 CONFIG.cpu.borrow.fromBucket(7200) 之下：本 describe 判的是
    // 「前馈用 cpuMax10/cpuAvg10 拒 P2+/P3」，其阈值（19.5/17.5）按未借用的
    // hard/soft = 19.2/17.5 标定；满仓会启用 bucket 借用把天花板抬到 24.96/22.75，
    // 那些值就不再触顶（借用的行为由下面「bucket 借用」describe 自己覆盖）。
    (globalThis as any).Game = {
      time: 82450000,
      cpu: {
        limit: 20,
        tickLimit: 500,
        bucket: 6000,
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

  it("P3 饥饿旁路：bypass 生效时 max10 触顶也放行 P2/P3（自锁解除）；recovery tier 旁路失效", () => {
    (globalThis as any).Memory = {
      kernel: { stats: { cpuMax10: 19.5, cpuAvg10: 18 }, p3StarveBypassUntil: 82450000 + 600 },
    };
    (globalThis as any).Game.cpu.getUsed = () => 3;
    (globalThis as any).Game.cpu.bucket = 10000;
    const budget = new CpuBudget("healthy");
    expect(budget.canStart(2 as Priority)).toBe(true);
    expect(budget.canStart(3 as Priority)).toBe(true);
    // bucket 在 conserve tier（≥ 1000）→ 旁路仍生效，P2 不受前馈限制
    (globalThis as any).Game.cpu.bucket = 2000;
    const budgetConserve = new CpuBudget("healthy");
    expect(budgetConserve.canStart(2 as Priority)).toBe(true);
    // bucket 在 recovery tier（< 1000）→ 旁路失效，前馈重新生效
    (globalThis as any).Game.cpu.bucket = 500;
    const budgetRecovery = new CpuBudget("healthy");
    expect(budgetRecovery.canStart(3 as Priority)).toBe(false);
  });

  it("旁路覆盖实时 softLimit 闸：post 段 P3 在 spent≥softLimit 时放行，P2 不豁免，安全层不动", () => {
    // 线上工况（2026-09-21 telemetry 停摆根因）：post 段系统排在所有 creep 之后，
    // 轮到它时 spent() 已≈本 tick 终值（实测 17.5~18.1）≥ softLimit(17.5) ——
    // 实时软上限对它是恒真闸，旁路若只解前馈则逃生口对它要救的系统打不开。
    const budget = new CpuBudget("healthy");
    (globalThis as any).Game.time = 82450000;
    (globalThis as any).Memory = {
      kernel: { stats: { cpuMax10: 5, cpuAvg10: 5 }, p3StarveBypassUntil: 82450600 },
    };
    // spent 落在 (softLimit, hardLimit - cpuReserve/2) 之间：只有旁路能救。
    const spent = (budget.softLimit + budget.hardLimit) / 2;
    (globalThis as any).Game.cpu.getUsed = () => spent;
    expect(budget.canStart(3 as Priority), "旁路内 P3 应越过实时软上限").toBe(true);
    expect(budget.canStart(2 as Priority), "P2 不豁免 — 有产出的活仍让位").toBe(false);

    // 豁免不吞安全层：spent 触到 hardLimit 仍拒（isExhausted 在最前）。
    (globalThis as any).Game.cpu.getUsed = () => budget.hardLimit;
    expect(budget.canStart(3 as Priority), "spent 达硬上限时旁路也不放行").toBe(false);

    // 旁路关闭（未置位）→ 同一 spent 照旧被实时闸拒。
    (globalThis as any).Game.cpu.getUsed = () => spent;
    delete (globalThis as any).Memory.kernel.p3StarveBypassUntil;
    expect(budget.canStart(3 as Priority), "无旁路时实时软上限语义不变").toBe(false);
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

// ── bucket 借用（#16）──────────────────────────────────────

describe("CpuBudget — bucket 借用", () => {
  const setup = (bucket: number, tickLimit = 500): void => {
    (globalThis as any).Game = {
      time: 82450000,
      cpu: { limit: 20, tickLimit, bucket, getUsed: () => 0 },
    };
    (globalThis as any).Memory = { kernel: { stats: { cpuMax10: 0, cpuAvg10: 0 } } };
  };

  it("满仓借满：hard 19.2→24.96、soft 17.5→22.75，spent=20 的 tick 不再拒 P2", () => {
    setup(10000);
    const budget = new CpuBudget("healthy");
    expect(budget.cpuBorrow).toBe(6);
    expect(Math.round(budget.hardLimit * 100) / 100).toBe(24.96);
    expect(Math.round(budget.softLimit * 100) / 100).toBe(22.75);
    // 20 CPU 正是线上实测常态（cpuAvg10=19.6）：旧天花板下 P2 整批被拒，借用后放行。
    (globalThis as any).Game.cpu.getUsed = () => 20;
    expect(budget.canStart(2 as Priority)).toBe(true);
  });

  it("线性中间点：bucket 8600 → 借 3", () => {
    setup(8600);
    expect(new CpuBudget("healthy").cpuBorrow).toBe(3);
  });

  it("低于水位不借；tickLimit 是引擎上界，借不到时回到旧语义", () => {
    setup(5000);
    const dry = new CpuBudget("healthy");
    expect(dry.cpuBorrow).toBe(0);
    expect(Math.round(dry.hardLimit * 100) / 100).toBe(19.2);

    // bucket 满但 tickLimit 只有 20（引擎没给突发额度）→ 额度算得出、天花板借不动。
    setup(10000, 20);
    const capped = new CpuBudget("healthy");
    expect(capped.cpuBorrow).toBe(6);
    expect(Math.round(capped.hardLimit * 100) / 100).toBe(19.2);
    (globalThis as any).Game.cpu.getUsed = () => 20;
    expect(capped.canStart(2 as Priority)).toBe(false);
  });
});
