/**
 * 参数自调优系统测试。
 *
 * 覆盖：
 *   - bounds.ts: clampParam、isInCooldown
 *   - evaluator.ts: 全局门禁、各参数增减逻辑、冷却期、边界钳制
 *   - tuned.ts: getRoleBounds 覆盖层、回退、钳制、不变量
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  TUNING_BOUNDS,
  clampParam,
  isInCooldown,
} from "../../../src/domain/tuning/bounds";
import { evaluateTuning } from "../../../src/domain/tuning/evaluator";
import type { TuningSignals } from "../../../src/domain/tuning/types";
import { getRoleBounds, getAllRoleBounds } from "../../../src/config/tuned";

// ─── Mock 设置 ───────────────────────────────────────────────

beforeEach(() => {
  (globalThis as any).Memory = {
    creeps: {},
    rooms: {},
    kernel: {},
  };
});

// ─── 辅助工厂 ────────────────────────────────────────────────

/** 创建默认健康信号——所有值表示经济健康、无压力。 */
function healthySignals(overrides: Partial<TuningSignals> = {}): TuningSignals {
  return {
    avgReserveDelta: 50,
    avgPressure: 0.1,
    avgDrainScore: 5,
    crisisRatio: 0,
    avgStorageEnergy: 20000,
    containerFillRatio: 0.3,
    spawnFillRatio: 0.5, // 默认消费端未饱和
    haulerCount: 2,
    harvesterCount: 2,
    upgraderCount: 1,
    builderCount: 1,
    buildQueueBacklog: 0,
    tierRank: 0,
    rcl: 4,
    ...overrides,
  };
}

/** 默认角色边界（与 CONFIG 一致）。 */
const DEFAULT_BOUNDS: Record<string, { minCount: number; maxCount: number }> = {
  hauler: { minCount: 2, maxCount: 6 },
  harvester: { minCount: 2, maxCount: 4 },
  upgrader: { minCount: 1, maxCount: 3 },
  builder: { minCount: 1, maxCount: 4 },
};

/**
 * 双次评估辅助（P1-1 趋势确认机制）。
 * 调优引擎要求连续 2 次评估窗口显示同方向信号才触发调整。
 * 第一次评估记录方向，第二次评估触发调整。
 * @returns 第二次评估的结果（含实际调整）
 */
function evaluateTwice(
  signals: TuningSignals,
  bounds: Record<string, { minCount: number; maxCount: number }> = DEFAULT_BOUNDS,
  lastAdjusted: Record<string, number> = {},
  tick = 1000,
): ReturnType<typeof evaluateTuning> {
  // 第一次评估——记录趋势方向，不产生调整
  const first = evaluateTuning(signals, bounds, lastAdjusted, tick, {});
  // 第二次评估——同方向信号触发调整
  return evaluateTuning(signals, bounds, lastAdjusted, tick + 500, first.newTrend);
}

// ─── Bounds 测试 ─────────────────────────────────────────────

describe("Tuning Bounds", () => {
  it("clampParam 钳制到 floor", () => {
    expect(clampParam("hauler.maxCount", 0)).toBe(2);
    expect(clampParam("hauler.minCount", 0)).toBe(1);
  });

  it("clampParam 钳制到 ceiling", () => {
    expect(clampParam("hauler.maxCount", 99)).toBe(8);
    expect("harvester.maxCount").toBeDefined();
    expect(clampParam("harvester.maxCount", 99)).toBe(6);
  });

  it("clampParam 不改变范围内的值", () => {
    expect(clampParam("hauler.maxCount", 5)).toBe(5);
    expect(clampParam("upgrader.maxCount", 2)).toBe(2);
  });

  it("clampParam 未知参数返回原值", () => {
    expect(clampParam("unknown.param", 42)).toBe(42);
  });

  it("isInCooldown 未调整过返回 false", () => {
    expect(isInCooldown("hauler.maxCount", undefined, 1000)).toBe(false);
  });

  it("isInCooldown 冷却期内返回 true", () => {
    expect(isInCooldown("hauler.maxCount", 1000, 1500)).toBe(true);
  });

  it("isInCooldown 冷却期外返回 false", () => {
    expect(isInCooldown("hauler.maxCount", 1000, 2500)).toBe(false);
  });
});

// ─── Evaluator 全局门禁测试 ──────────────────────────────────

describe("Tuning Evaluator — 全局门禁", () => {
  it("CPU tier conserve 跳过所有调优", () => {
    const result = evaluateTwice(
      healthySignals({ tierRank: 2 }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );
    expect(result.skipped).toBe("cpu_tier_conserve_or_worse");
    expect(result.adjustments).toHaveLength(0);
  });

  it("CPU tier recovery 跳过所有调优", () => {
    const result = evaluateTwice(
      healthySignals({ tierRank: 3 }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );
    expect(result.skipped).toBe("cpu_tier_conserve_or_worse");
  });

  it("危机比例过高跳过所有调优", () => {
    const result = evaluateTwice(
      healthySignals({ crisisRatio: 0.4 }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );
    expect(result.skipped).toBe("economy_unstable");
  });

  it("RCL < 2 跳过所有调优", () => {
    const result = evaluateTwice(
      healthySignals({ rcl: 1 }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );
    expect(result.skipped).toBe("rcl_too_low");
  });

  it("健康状态不跳过", () => {
    const result = evaluateTwice(
      healthySignals(),
      DEFAULT_BOUNDS,
      {},
      1000,
    );
    expect(result.skipped).toBeUndefined();
  });
});

// ─── hauler.maxCount 测试 ────────────────────────────────────

describe("Tuning Evaluator — hauler.maxCount", () => {
  it("container 持续满 + hauler 已达上限 → 增加", () => {
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.75,
        haulerCount: 6,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.oldValue).toBe(6);
    expect(adj!.newValue).toBe(7);
  });

  it("container 持续空 + hauler > minCount → 减少", () => {
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.15,
        haulerCount: 4,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.oldValue).toBe(6);
    expect(adj!.newValue).toBe(5);
  });

  it("container 满 但 hauler 未达上限 → 不调整", () => {
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.75,
        haulerCount: 3,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeUndefined();
  });

  it("经济不健康时不增加", () => {
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.75,
        haulerCount: 6,
        avgPressure: 0.4,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeUndefined();
  });

  it("已达 ceiling 不再增加", () => {
    const bounds = { ...DEFAULT_BOUNDS, hauler: { minCount: 2, maxCount: 8 } };
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.75,
        haulerCount: 8,
      }),
      bounds,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeUndefined();
  });

  it("冷却期内不调整", () => {
    // 冷却期测试用单次调用——evaluateTwice 第二次会跳过冷却期
    const result = evaluateTuning(
      healthySignals({
        containerFillRatio: 0.75,
        haulerCount: 6,
      }),
      DEFAULT_BOUNDS,
      { "hauler.maxCount": 1000 },
      1500, // 500 tick 后，冷却期 1000 tick 未过
      {},
    );

    const adj = result.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeUndefined();
  });
});

// ─── hauler.minCount 测试 ────────────────────────────────────

describe("Tuning Evaluator — hauler.minCount", () => {
  it("container 持续半满 + 经济健康 → 增加", () => {
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.55,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "hauler.minCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(3);
  });

  it("container 极空 + hauler ≤ minCount → 减少", () => {
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.1,
        haulerCount: 2,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "hauler.minCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(1);
  });
});

// ─── harvester.maxCount 测试 ─────────────────────────────────

describe("Tuning Evaluator — harvester.maxCount", () => {
  it("储备持续下降 + harvester 已达上限 → 增加", () => {
    const result = evaluateTwice(
      healthySignals({
        avgReserveDelta: -80,
        harvesterCount: 4,
        avgPressure: 0.35,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "harvester.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(5);
  });

  it("储备持续增长 + harvester > minCount → 减少", () => {
    const result = evaluateTwice(
      healthySignals({
        avgReserveDelta: 150,
        harvesterCount: 3,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "harvester.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(3);
  });
});

// ─── upgrader.maxCount 测试 ──────────────────────────────────

describe("Tuning Evaluator — upgrader.maxCount", () => {
  it("storage 持续高位 + upgrader 已达上限 → 增加", () => {
    const result = evaluateTwice(
      healthySignals({
        avgStorageEnergy: 60000,
        upgraderCount: 3,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "upgrader.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(4);
  });

  it("storage 低位 → 减少", () => {
    const result = evaluateTwice(
      healthySignals({
        avgStorageEnergy: 5000,
        upgraderCount: 2,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "upgrader.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(2);
  });

  it("经济压力高 → 减少", () => {
    const result = evaluateTwice(
      healthySignals({
        avgStorageEnergy: 30000,
        avgPressure: 0.6,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "upgrader.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(2);
  });
});

// ─── builder.maxCount 测试 ───────────────────────────────────

describe("Tuning Evaluator — builder.maxCount", () => {
  it("buildQueue 积压 + builder 已达上限 → 增加", () => {
    const result = evaluateTwice(
      healthySignals({
        buildQueueBacklog: 5,
        builderCount: 4,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "builder.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(5);
  });

  it("buildQueue 空 → 减少", () => {
    const result = evaluateTwice(
      healthySignals({
        buildQueueBacklog: 0,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "builder.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(3);
  });

  it("经济压力高 → 减少", () => {
    const result = evaluateTwice(
      healthySignals({
        buildQueueBacklog: 2,
        avgPressure: 0.5,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    const adj = result.adjustments.find(a => a.param === "builder.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(3);
  });
});

// ─── 多参数同时调整测试 ──────────────────────────────────────

describe("Tuning Evaluator — 多参数联动", () => {
  it("多个参数可同 tick 调整", () => {
    const result = evaluateTwice(
      healthySignals({
        containerFillRatio: 0.75, // hauler.maxCount ↑
        haulerCount: 6,
        avgStorageEnergy: 60000,   // upgrader.maxCount ↑
        upgraderCount: 3,
        buildQueueBacklog: 0,       // builder.maxCount ↓
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
    );

    expect(result.adjustments.length).toBeGreaterThanOrEqual(2);
    const params = result.adjustments.map(a => a.param);
    expect(params).toContain("hauler.maxCount");
    expect(params).toContain("upgrader.maxCount");
    expect(params).toContain("builder.maxCount");
  });
});

// ─── getRoleBounds 测试 ──────────────────────────────────────

describe("getRoleBounds — 覆盖层", () => {
  it("无覆盖时返回 CONFIG 默认值", () => {
    const bounds = getRoleBounds("hauler", "W1N1");
    expect(bounds.minCount).toBe(2);
    expect(bounds.maxCount).toBe(6);
  });

  it("有覆盖时返回覆盖值", () => {
    (globalThis as any).Memory.kernel.tuning = {
      lastTuned: 1000,
      rooms: {
        W1N1: {
          roleBounds: {
            hauler: { maxCount: 7 },
          },
          lastAdjusted: {},
        },
      },
    };

    const bounds = getRoleBounds("hauler", "W1N1");
    expect(bounds.maxCount).toBe(7);
    expect(bounds.minCount).toBe(2); // 未覆盖的字段用默认值
  });

  it("覆盖值超出 ceiling 时被钳制", () => {
    (globalThis as any).Memory.kernel.tuning = {
      lastTuned: 1000,
      rooms: {
        W1N1: {
          roleBounds: {
            hauler: { maxCount: 99 },
          },
          lastAdjusted: {},
        },
      },
    };

    const bounds = getRoleBounds("hauler", "W1N1");
    expect(bounds.maxCount).toBe(8); // TUNING_BOUNDS ceiling
  });

  it("覆盖值低于 floor 时被钳制", () => {
    (globalThis as any).Memory.kernel.tuning = {
      lastTuned: 1000,
      rooms: {
        W1N1: {
          roleBounds: {
            hauler: { minCount: 0 },
          },
          lastAdjusted: {},
        },
      },
    };

    const bounds = getRoleBounds("hauler", "W1N1");
    expect(bounds.minCount).toBe(1); // TUNING_BOUNDS floor
  });

  it("minCount > maxCount 时 minCount 被钳制到 maxCount", () => {
    (globalThis as any).Memory.kernel.tuning = {
      lastTuned: 1000,
      rooms: {
        W1N1: {
          roleBounds: {
            hauler: { minCount: 5, maxCount: 3 },
          },
          lastAdjusted: {},
        },
      },
    };

    const bounds = getRoleBounds("hauler", "W1N1");
    expect(bounds.minCount).toBe(3);
    expect(bounds.maxCount).toBe(3);
  });

  it("global reset 后（Memory.kernel 无 tuning）回退到 CONFIG", () => {
    (globalThis as any).Memory.kernel = {};

    const bounds = getRoleBounds("hauler", "W1N1");
    expect(bounds.minCount).toBe(2);
    expect(bounds.maxCount).toBe(6);
  });

  it("无 roomName 时返回 CONFIG 默认值", () => {
    const bounds = getRoleBounds("hauler");
    expect(bounds.minCount).toBe(2);
    expect(bounds.maxCount).toBe(6);
  });

  it("未知角色返回 {0, 0}", () => {
    const bounds = getRoleBounds("unknown_role", "W1N1");
    expect(bounds.minCount).toBe(0);
    expect(bounds.maxCount).toBe(0);
  });

  it("getAllRoleBounds 返回所有角色", () => {
    const all = getAllRoleBounds("W1N1");
    expect(all.hauler).toBeDefined();
    expect(all.harvester).toBeDefined();
    expect(all.upgrader).toBeDefined();
    expect(all.builder).toBeDefined();
  });
});

// ─── P1-1 趋势确认机制测试 ──────────────────────────────────

describe("Tuning Evaluator — 趋势确认 (P1-1)", () => {
  it("首次评估不产生调整，只记录方向", () => {
    const result = evaluateTuning(
      healthySignals({
        containerFillRatio: 0.75,
        haulerCount: 6,
      }),
      DEFAULT_BOUNDS,
      {},
      1000,
      {}, // 无上次趋势
    );

    // 无调整
    expect(result.adjustments).toHaveLength(0);
    // 但记录了方向
    expect(result.newTrend["hauler.maxCount"]).toBe("up");
  });

  it("连续 2 次同方向信号才触发调整", () => {
    const signals = healthySignals({
      containerFillRatio: 0.75,
      haulerCount: 6,
    });

    // 第一次：记录方向
    const first = evaluateTuning(signals, DEFAULT_BOUNDS, {}, 1000, {});
    expect(first.adjustments).toHaveLength(0);
    expect(first.newTrend["hauler.maxCount"]).toBe("up");

    // 第二次：同方向确认，触发调整
    const second = evaluateTuning(signals, DEFAULT_BOUNDS, {}, 1500, first.newTrend);
    const adj = second.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(7);
    // 调整后方向重置
    expect(second.newTrend["hauler.maxCount"]).toBe("none");
  });

  it("方向反转时重置计数，不触发调整", () => {
    const upSignals = healthySignals({
      containerFillRatio: 0.75,
      haulerCount: 6,
    });
    const downSignals = healthySignals({
      containerFillRatio: 0.15,
      haulerCount: 4,
    });

    // 第一次：方向 up
    const first = evaluateTuning(upSignals, DEFAULT_BOUNDS, {}, 1000, {});
    expect(first.newTrend["hauler.maxCount"]).toBe("up");

    // 第二次：方向反转为 down — 不触发调整，记录新方向
    const second = evaluateTuning(downSignals, DEFAULT_BOUNDS, {}, 1500, first.newTrend);
    expect(second.adjustments.find(a => a.param === "hauler.maxCount")).toBeUndefined();
    expect(second.newTrend["hauler.maxCount"]).toBe("down");

    // 第三次：同方向 down — 触发减少调整
    const third = evaluateTuning(downSignals, DEFAULT_BOUNDS, {}, 2000, second.newTrend);
    const adj = third.adjustments.find(a => a.param === "hauler.maxCount");
    expect(adj).toBeDefined();
    expect(adj!.newValue).toBe(5);
  });

  it("信号消失时清除趋势", () => {
    const upSignals = healthySignals({
      containerFillRatio: 0.75,
      haulerCount: 6,
      buildQueueBacklog: 5, // 避免 builder 触发调整干扰
    });
    const neutralSignals = healthySignals({
      containerFillRatio: 0.4, // 不满足 HIGH(0.7) 也不满足 LOW(0.2)
      haulerCount: 6,
      buildQueueBacklog: 5, // 保持 builder 信号一致，避免干扰
    });

    // 第一次：方向 up
    const first = evaluateTuning(upSignals, DEFAULT_BOUNDS, {}, 1000, {});
    expect(first.newTrend["hauler.maxCount"]).toBe("up");

    // 第二次：信号消失 — 清除趋势
    const second = evaluateTuning(neutralSignals, DEFAULT_BOUNDS, {}, 1500, first.newTrend);
    // hauler.maxCount 趋势被清除
    expect(second.newTrend["hauler.maxCount"]).toBe("none");
    // 不应有 hauler.maxCount 调整
    expect(second.adjustments.find(a => a.param === "hauler.maxCount")).toBeUndefined();
  });

  it("调整后趋势重置，下次需重新积累 2 次确认", () => {
    const signals = healthySignals({
      containerFillRatio: 0.75,
      haulerCount: 6,
    });

    // 第一次：记录 up
    const first = evaluateTuning(signals, DEFAULT_BOUNDS, {}, 1000, {});
    // 第二次：触发调整 6→7，重置为 none
    const second = evaluateTuning(signals, DEFAULT_BOUNDS, {}, 1500, first.newTrend);
    expect(second.adjustments.find(a => a.param === "hauler.maxCount")).toBeDefined();
    expect(second.newTrend["hauler.maxCount"]).toBe("none");

    // 第三次：调整后趋势已重置，需重新积累
    // 但 lastAdjusted 已设，冷却期内 isInCooldown 返回 true → newDirection = "none"
    const third = evaluateTuning(
      signals,
      DEFAULT_BOUNDS,
      { "hauler.maxCount": 1500 },
      2000,
      second.newTrend,
    );
    expect(third.adjustments.find(a => a.param === "hauler.maxCount")).toBeUndefined();
    expect(third.newTrend["hauler.maxCount"]).toBe("none");
  });

  it("全局门禁跳过时不产生趋势记录", () => {
    const result = evaluateTuning(
      healthySignals({ tierRank: 2 }),
      DEFAULT_BOUNDS,
      {},
      1000,
      {},
    );

    expect(result.skipped).toBe("cpu_tier_conserve_or_worse");
    expect(result.newTrend).toEqual({});
  });
});
