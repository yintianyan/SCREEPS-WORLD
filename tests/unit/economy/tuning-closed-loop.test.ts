/** 改进 A 闭环验证测试 — 覆盖附录 D.8 用例（domain 层纯函数测试）。 */
import { describe, expect, it } from "vitest";
import {
  evaluateTuning,
  verifyPendingAdjustments,
  applyFreezePolicy,
} from "../../../src/domain/tuning/evaluator";
import type { TuningSignals, PendingValidation, FrozenParamState } from "../../../src/domain/tuning/types";
import { CONFIG } from "../../../src/config";

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
    spawnFillRatio: 0.5,
    haulerCount: 2,
    harvesterCount: 2,
    upgraderCount: 1,
    builderCount: 1,
    buildQueueBacklog: 0,
    srcRatio: 0,
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

/** 构造 hauler.maxCount 上调后的边界（maxCount=7）。 */
function boundsWithHaulerMax(maxCount: number): typeof DEFAULT_BOUNDS {
  return { ...DEFAULT_BOUNDS, hauler: { minCount: 2, maxCount } };
}

/** 构造 hauler.maxCount 上调的 pendingValidation。 */
function pendingHaulerUp(overrides: Partial<PendingValidation> = {}): PendingValidation {
  return {
    preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 },
    expectedDirection: "improve",
    adjustDirection: "up",
    adjustTick: 1000,
    preAdjustValue: 6,
    ...overrides,
  };
}

/** 构造 hauler.maxCount 下调的 pendingValidation。 */
function pendingHaulerDown(overrides: Partial<PendingValidation> = {}): PendingValidation {
  return {
    preAdjustSignals: { containerFillRatio: 0.2, spawnFillRatio: 0.9, roleCount: 7 },
    expectedDirection: "improve",
    adjustDirection: "down",
    adjustTick: 1000,
    preAdjustValue: 7,
    ...overrides,
  };
}

/** CONFIG 基线值表（用于 applyFreezePolicy）。 */
function configBaselines(): Record<string, number> {
  return {
    "hauler.maxCount": CONFIG.roles.hauler.maxCount,
    "hauler.minCount": CONFIG.roles.hauler.minCount,
    "harvester.maxCount": CONFIG.roles.harvester.maxCount,
    "upgrader.maxCount": CONFIG.roles.upgrader.maxCount,
    "builder.maxCount": CONFIG.roles.builder.maxCount,
  };
}

// ─── D.8 用例 1：pending-lock 竞态 ──────────────────────────

describe("D.8 pending-lock 竞态", () => {
  it("验证窗口内反向信号不触发反向调整（excludedParams 排除 + trend 置 none）", () => {
    // 场景：T=1000 时 hauler.maxCount 6→7 上调，pendingValidation 写入。
    // 之后 container 变空（反向信号），但因 pending-lock 不评估该参数。
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp(),
    };
    const bounds = boundsWithHaulerMax(7);
    const lastAdjusted = { "hauler.maxCount": 1000 };

    // T=1500（T+500）：反向信号出现（container 空），冷却期内 + pending-lock
    const signalsT1500 = healthySignals({ containerFillRatio: 0.15, haulerCount: 7 });
    const excluded = new Set(["hauler.maxCount"]);
    const evalT1500 = evaluateTuning(signalsT1500, bounds, lastAdjusted, 1500, { "hauler.maxCount": "none" }, excluded);
    // 无调整
    expect(evalT1500.adjustments).toHaveLength(0);
    // pending-lock：excluded 参数 trend 强制为 "none"（不记录反向 "down"）
    expect(evalT1500.newTrend["hauler.maxCount"]).toBe("none");

    // 对比：若不排除（无 pending-lock），trend 会记录 "down"
    const evalNoLock = evaluateTuning(signalsT1500, bounds, lastAdjusted, 1500, { "hauler.maxCount": "none" });
    expect(evalNoLock.newTrend["hauler.maxCount"]).toBe("none"); // 冷却期内也是 none
  });

  it("冷却到期但验证未到期时，pending-lock 仍阻止反向 trend 积累", () => {
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp(),
    };
    const bounds = boundsWithHaulerMax(7);
    const lastAdjusted = { "hauler.maxCount": 1000 };

    // T=2000（T+1000）：冷却到期（2000-1000=1000，不 < 1000），但 verifyDelay 未到期（1000 < 1500）
    const signalsT2000 = healthySignals({ containerFillRatio: 0.15, haulerCount: 7 });
    const excluded = new Set(["hauler.maxCount"]);

    // 有 pending-lock：trend="none"，无调整
    const evalLocked = evaluateTuning(signalsT2000, bounds, lastAdjusted, 2000, { "hauler.maxCount": "none" }, excluded);
    expect(evalLocked.newTrend["hauler.maxCount"]).toBe("none");
    expect(evalLocked.adjustments.find(a => a.param === "hauler.maxCount")).toBeUndefined();

    // 无 pending-lock：冷却已过 + 反向信号 → 记录 "down"（首次观察）
    const evalUnlocked = evaluateTuning(signalsT2000, bounds, lastAdjusted, 2000, { "hauler.maxCount": "none" });
    expect(evalUnlocked.newTrend["hauler.maxCount"]).toBe("down");
  });

  it("T+1500 验证到期后清空 pending，下周期 trend 从 none 重新积累", () => {
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({ preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 } }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=2500（T+1500）：verifyDelay 到期，信号改善（containerFill 0.8→0.5，hauler up 改善=container↓）
    const signalsT2500 = healthySignals({ containerFillRatio: 0.5, haulerCount: 7 });
    const verifyResult = verifyPendingAdjustments(signalsT2500, pending, bounds, 2500);
    // 改善 → 不回滚，但 clearedParams 含该参数（闭环结束）
    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");

    // 验证完成后 pending 清空，下周期（T=3000）excludedParams 不再包含该参数
    // prevTrend 为 "none"（pending-lock 期间强制），反向信号 → 首次观察 "down"
    const signalsT3000 = healthySignals({ containerFillRatio: 0.15, haulerCount: 7 });
    const evalT3000 = evaluateTuning(
      signalsT3000,
      bounds,
      { "hauler.maxCount": 1000 }, // lastAdjusted 仍为原调整 tick
      3000,
      { "hauler.maxCount": "none" }, // prevTrend 从 none 开始
      new Set(), // 无排除
    );
    expect(evalT3000.newTrend["hauler.maxCount"]).toBe("down");
    expect(evalT3000.adjustments.find(a => a.param === "hauler.maxCount")).toBeUndefined(); // 首次观察不调整
  });
});

// ─── D.8 用例 2：人口合同 blocked ─────────────────────────────

describe("D.8 人口合同 blocked", () => {
  it("上调后 roleCount 未达新边界 → 标 blocked，不回滚不计回滚次数", () => {
    // 场景：hauler.maxCount 6→7 上调，但 hauler 实际只 6（demand 阻塞未孵化到 7）
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({ preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 } }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=2500：verifyDelay 到期，roleCount=6（未达 7）
    const signals = healthySignals({ containerFillRatio: 0.9, haulerCount: 6 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // 人口未达新边界 → blocked，不回滚、不清空（下周期复验）
    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toHaveLength(0);
    expect(verifyResult.blockedParams).toContain("hauler.maxCount");

    // applyFreezePolicy：无回滚 → 不计回滚次数、不冻结
    const frozenParams: Record<string, FrozenParamState> = {};
    const freezeResult = applyFreezePolicy(frozenParams, verifyResult.rollbacks, verifyResult.clearedParams, configBaselines(), 2500);
    expect(freezeResult.newlyFrozen).toHaveLength(0);
    expect(frozenParams["hauler.maxCount"]).toBeUndefined();
  });
});

// ─── P1 补充：人口合同 blocked TTL ────────────────────────────

describe("P1 人口合同 blocked TTL（附录 E.2 修复）", () => {
  it("首次 blocked → 写入 blockedSinceTick + contractBlocked，pending 保留", () => {
    // 场景：hauler.maxCount 6→7 上调，verifyDelay 到期但 roleCount=6（未达 7）
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({ preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 } }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=2500：verifyDelay 到期（2500-1000=1500），roleCount=6（未达 7）
    const signals = healthySignals({ containerFillRatio: 0.9, haulerCount: 6 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // blocked 标记写入 pending（副作用）
    expect(pending["hauler.maxCount"]!.blockedSinceTick).toBe(2500);
    expect(pending["hauler.maxCount"]!.contractBlocked).toBe(true);
    // 仍保留 pending（未清空），下周期复验
    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toHaveLength(0);
    expect(verifyResult.blockedParams).toContain("hauler.maxCount");
  });

  it("blocked 连续 2 窗口（3000 tick）后 → 回滚到 preAdjustValue + 计 1 次回滚", () => {
    // 场景：hauler.maxCount 6→7 上调，T=2500 首次 blocked，
    // T=5500（2500+3000）TTL 到期仍未达人口 → 回滚
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({
        preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 },
        blockedSinceTick: 2500, // 已 blocked 一段时间
        contractBlocked: true,
      }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=5500：blockedSinceTick(2500) + 2*verifyDelay(3000) = 5500 <= 5500 → TTL 到期
    const signals = healthySignals({ containerFillRatio: 0.9, haulerCount: 6 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 5500);

    // TTL 到期 → 回滚到 preAdjustValue(6) + 清空 pending（闭环结束）
    expect(verifyResult.rollbacks).toHaveLength(1);
    expect(verifyResult.rollbacks[0]!.param).toBe("hauler.maxCount");
    expect(verifyResult.rollbacks[0]!.newValue).toBe(6); // preAdjustValue
    expect(verifyResult.rollbacks[0]!.reason).toContain("Contract blocked timeout");
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
    expect(verifyResult.blockedParams).toHaveLength(0); // 已转回滚，不再 blocked

    // applyFreezePolicy：1 次回滚 → rollbackCount 累加到 1（不达冻结阈值 3）
    const frozenParams: Record<string, FrozenParamState> = {};
    const freezeResult = applyFreezePolicy(frozenParams, verifyResult.rollbacks, verifyResult.clearedParams, configBaselines(), 5500);
    expect(freezeResult.newlyFrozen).toHaveLength(0);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(1);
    expect(frozenParams["hauler.maxCount"]!.frozenUntil).toBe(0); // 未冻结
  });

  it("blocked 未达 TTL（2999 tick）→ 仍保留 pending，不回滚", () => {
    // 边界用例：T=5499（2500+2999），差 1 tick 到 TTL
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({
        preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 },
        blockedSinceTick: 2500,
        contractBlocked: true,
      }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=5499：2500 + 3000 = 5500 > 5499 → TTL 未到期
    const signals = healthySignals({ containerFillRatio: 0.9, haulerCount: 6 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 5499);

    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toHaveLength(0);
    expect(verifyResult.blockedParams).toContain("hauler.maxCount");
  });

  it("blocked 中途人口到位 → 清空 blockedSinceTick，继续效果验证", () => {
    // 场景：hauler.maxCount 6→7 上调，T=2500 首次 blocked，
    // T=3000 roleCount 达到 7（合同满足）→ 清空 blocked 字段 + 继续效果验证
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({
        preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 },
        blockedSinceTick: 2500,
        contractBlocked: true,
      }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=3000：roleCount=7（合同满足），containerFill 0.8→0.5（改善）
    const signals = healthySignals({ containerFillRatio: 0.5, haulerCount: 7 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 3000);

    // 人口合同满足 → 清空 blocked 诊断字段
    expect(pending["hauler.maxCount"]!.blockedSinceTick).toBeUndefined();
    expect(pending["hauler.maxCount"]!.contractBlocked).toBeUndefined();
    // 继续效果验证：containerFill 0.8→0.5（改善）→ 不回滚，闭环结束
    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
    expect(verifyResult.blockedParams).toHaveLength(0);
  });

  it("blocked 中途人口到位但信号未改善 → 清空 blocked + 正常回滚", () => {
    // 场景：blocked 后人口到位，但效果信号未改善 → 正常回滚（非 TTL 回滚）
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({
        preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 },
        blockedSinceTick: 2500,
        contractBlocked: true,
      }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=3000：roleCount=7（合同满足），containerFill 0.8→0.9（恶化）
    const signals = healthySignals({ containerFillRatio: 0.9, haulerCount: 7 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 3000);

    // 人口合同满足 → 清空 blocked 字段
    expect(pending["hauler.maxCount"]!.blockedSinceTick).toBeUndefined();
    // 效果未改善 → 正常回滚（reason 是效果验证失败，非 TTL 超时）
    expect(verifyResult.rollbacks).toHaveLength(1);
    expect(verifyResult.rollbacks[0]!.reason).toContain("Effect verification failed");
    expect(verifyResult.rollbacks[0]!.newValue).toBe(6);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });
});

// ─── D.8 用例 3：人口合同 + 效果 ─────────────────────────────

describe("D.8 人口合同 + 效果", () => {
  it("人口到位但信号未改善 → 正常回滚", () => {
    // 场景：hauler.maxCount 6→7 上调，hauler 已孵化到 7（合同满足），
    // 但 containerFill 反而升高（hauler 增加未改善物流）
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({ preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 } }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=2500：roleCount=7（合同满足），containerFill 0.8→0.9（恶化）
    const signals = healthySignals({ containerFillRatio: 0.9, haulerCount: 7 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // 人口到位 + 信号未改善 → 回滚到 preAdjustValue(6)
    expect(verifyResult.rollbacks).toHaveLength(1);
    expect(verifyResult.rollbacks[0]!.param).toBe("hauler.maxCount");
    expect(verifyResult.rollbacks[0]!.newValue).toBe(6); // preAdjustValue
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");

    // applyFreezePolicy：1 次回滚，未达阈值 3 → 不冻结，但记录 rollbackCount
    const frozenParams: Record<string, FrozenParamState> = {};
    const freezeResult = applyFreezePolicy(frozenParams, verifyResult.rollbacks, verifyResult.clearedParams, configBaselines(), 2500);
    expect(freezeResult.newlyFrozen).toHaveLength(0);
    expect(frozenParams["hauler.maxCount"]).toBeDefined();
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(1);
    expect(frozenParams["hauler.maxCount"]!.frozenUntil).toBe(0); // 未冻结
  });
});

// ─── D.8 用例 4：下调护栏 ────────────────────────────────────

describe("D.8 下调护栏", () => {
  it("hauler 下调后 containerFill 改善但 spawnFill 跌破阈值 → 回滚", () => {
    // 场景：hauler.maxCount 7→6 下调，containerFill 0.2→0.5（改善=hauler 减少后 container 更满），
    // 但 spawnFill 0.9→0.4（跌破 0.5 护栏且恶化）→ 护栏触发回滚
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerDown({ preAdjustSignals: { containerFillRatio: 0.2, spawnFillRatio: 0.9, roleCount: 7 } }),
    };
    const bounds = boundsWithHaulerMax(6); // 下调后 maxCount=6

    // T=2500：containerFill 0.5（改善），spawnFill 0.4（跌破护栏 0.5）
    const signals = healthySignals({ containerFillRatio: 0.5, spawnFillRatio: 0.4, haulerCount: 6 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // 主信号改善但护栏触发 → 回滚
    expect(verifyResult.rollbacks).toHaveLength(1);
    expect(verifyResult.rollbacks[0]!.newValue).toBe(7); // 回滚到 preAdjustValue
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });

  it("hauler 下调后 containerFill 改善且 spawnFill 未跌破 → 不回滚", () => {
    // 对比用例：护栏未触发时不回滚
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerDown({ preAdjustSignals: { containerFillRatio: 0.2, spawnFillRatio: 0.6, roleCount: 7 } }),
    };
    const bounds = boundsWithHaulerMax(6);

    // T=2500：containerFill 0.5（改善），spawnFill 0.6（未跌破 0.5 护栏）
    const signals = healthySignals({ containerFillRatio: 0.5, spawnFillRatio: 0.6, haulerCount: 6 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });
});

// ─── P2 补充：hauler 下调护栏 reserveDelta 分支 ────────────────

describe("P2 hauler 下调护栏 reserveDelta 分支（死代码修复）", () => {
  it("hauler 下调后 avgReserveDelta 转负且恶化 → 触发回滚（护栏生效）", () => {
    // 场景：hauler.maxCount 7→6 下调，containerFill 0.2→0.5（主信号改善=hauler 减少后 container 更满），
    // spawnFill 0.9→0.85（未跌破 0.5 护栏），但 avgReserveDelta +50→-30（转负且恶化）
    // → reserveDelta 护栏触发回滚（即使主信号改善）
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerDown({
        preAdjustSignals: { containerFillRatio: 0.2, spawnFillRatio: 0.9, avgReserveDelta: 50, roleCount: 7 },
      }),
    };
    const bounds = boundsWithHaulerMax(6);

    const signals = healthySignals({
      containerFillRatio: 0.5, // 主信号改善（hauler down 改善 = container 更满）
      spawnFillRatio: 0.85,    // 未跌破 0.5 护栏
      avgReserveDelta: -30,    // 转负（< RESERVE_DELTA_GUARDRAIL=0）且比 +50 恶化
      haulerCount: 6,
    });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // 主信号改善但 reserveDelta 护栏触发 → 回滚到 preAdjustValue(7)
    expect(verifyResult.rollbacks).toHaveLength(1);
    expect(verifyResult.rollbacks[0]!.newValue).toBe(7);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });

  it("hauler 下调后 avgReserveDelta 不转负 → 护栏不触发，不回滚", () => {
    // 对比用例：reserveDelta 未转负（>= 0）时护栏不触发
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerDown({
        preAdjustSignals: { containerFillRatio: 0.2, spawnFillRatio: 0.9, avgReserveDelta: 50, roleCount: 7 },
      }),
    };
    const bounds = boundsWithHaulerMax(6);

    const signals = healthySignals({
      containerFillRatio: 0.5, // 主信号改善
      spawnFillRatio: 0.85,    // 未跌破护栏
      avgReserveDelta: 30,     // 仍为正（未转负）→ 护栏不触发
      haulerCount: 6,
    });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // 主信号改善且护栏未触发 → 不回滚
    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });

  it("hauler 下调后 avgReserveDelta 转负但未恶化（容差内）→ 护栏不触发", () => {
    // 边界用例：reserveDelta 从 +5（接近 0）→ -1，变化 6 在容差 max(0.05, 5*0.05=0.25)=0.25 之外
    // 但调整前 rBefore=5 已接近 0，current=-1 < 0（护栏阈值）但需要 current < rBefore - tol
    // rBefore - tol = 5 - 0.25 = 4.75；current=-1 < 4.75 → 触发护栏
    // 改用更明显的边界：rBefore=0.2 → tol=max(0.05, 0.01)=0.05；current=-0.1 < 0 且 < 0.2-0.05=0.15 → 触发
    // 此处验证「转负但容差内不恶化」的边界：rBefore=-5（已在负区）→ tol=0.25；current=-5.1
    // current < 0 ✓ 但 current < rBefore - tol = -5.25? -5.1 > -5.25 → 未恶化 → 护栏不触发
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerDown({
        preAdjustSignals: { containerFillRatio: 0.2, spawnFillRatio: 0.9, avgReserveDelta: -5, roleCount: 7 },
      }),
    };
    const bounds = boundsWithHaulerMax(6);

    const signals = healthySignals({
      containerFillRatio: 0.5,
      spawnFillRatio: 0.85,
      avgReserveDelta: -5.1, // 转负但未恶化（变化 0.1 < tol=0.25）
      haulerCount: 6,
    });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // 转负但容差内未恶化 → 护栏不触发，主信号改善 → 不回滚
    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });
});

// ─── D.8 用例 5：冻结复位 ────────────────────────────────────

describe("D.8 冻结复位", () => {
  it("连续 3 次回滚 → 冻结 + 参数复位到 CONFIG 基线", () => {
    // 场景：hauler.maxCount 反复调整-回滚 3 次，第 3 次触发冻结。
    // preAdjustValue=5（低于 CONFIG 基线 6），冻结时复位到基线 6 而非 preAdjustValue。
    const baselines = configBaselines();
    const configBaseline = baselines["hauler.maxCount"]!; // 6
    const frozenParams: Record<string, FrozenParamState> = {};

    // 模拟 3 个验证周期的回滚（每次 clearedParams 含该参数 = 闭环结束）
    const makeRollback = (reason: string) => ({
      param: "hauler.maxCount",
      oldValue: 7,
      newValue: 5, // preAdjustValue（低于基线 6）
      reason,
    });

    // 第 1 次回滚：rollbackCount 0→1，未冻结
    const rb1 = makeRollback("fail-1");
    let freezeResult = applyFreezePolicy(frozenParams, [rb1], ["hauler.maxCount"], baselines, 2500);
    expect(freezeResult.newlyFrozen).toHaveLength(0);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(1);
    expect(frozenParams["hauler.maxCount"]!.frozenUntil).toBe(0); // 未冻结

    // 第 2 次回滚：rollbackCount 1→2，未冻结
    const rb2 = makeRollback("fail-2");
    freezeResult = applyFreezePolicy(frozenParams, [rb2], ["hauler.maxCount"], baselines, 3000);
    expect(freezeResult.newlyFrozen).toHaveLength(0);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(2);

    // 第 3 次回滚：rollbackCount 2→3，达阈值 → 冻结 + 复位到 CONFIG 基线
    const rb3 = makeRollback("fail-3");
    expect(rb3.newValue).toBe(5); // 冻结前
    freezeResult = applyFreezePolicy(frozenParams, [rb3], ["hauler.maxCount"], baselines, 3500);
    expect(freezeResult.newlyFrozen).toHaveLength(1);
    expect(freezeResult.newlyFrozen[0]!.param).toBe("hauler.maxCount");

    // D.5：rb3.newValue 被修改为 CONFIG 基线（6），而非 preAdjustValue(5)
    expect(rb3.newValue).toBe(configBaseline);

    // 冻结状态写入
    expect(frozenParams["hauler.maxCount"]!.frozenUntil).toBe(3500 + 10000);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(3);
  });

  it("验证通过（cleared 无回滚）→ 重置 rollbackCount", () => {
    const baselines = configBaselines();
    const frozenParams: Record<string, FrozenParamState> = {};

    // 先累积 2 次回滚
    const rb1 = { param: "hauler.maxCount", oldValue: 7, newValue: 5, reason: "fail-1" };
    applyFreezePolicy(frozenParams, [rb1], ["hauler.maxCount"], baselines, 2500);
    const rb2 = { param: "hauler.maxCount", oldValue: 7, newValue: 5, reason: "fail-2" };
    applyFreezePolicy(frozenParams, [rb2], ["hauler.maxCount"], baselines, 3000);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(2);

    // 之后一次验证通过（cleared 但无回滚）→ rollbackCount 重置为 0
    applyFreezePolicy(frozenParams, [], ["hauler.maxCount"], baselines, 3500);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(0);
  });
});

// ─── P4 补充：解冻时清零 rollbackCount ────────────────────────

describe("P4 解冻时清零 rollbackCount（附录 E.2 修复）", () => {
  it("冻结期满后参数解冻 → 从 frozenParams 移除（rollbackCount 清零）", () => {
    // 场景：hauler.maxCount 冻结到 tick=10500，T=10500 解冻
    const baselines = configBaselines();
    const frozenParams: Record<string, FrozenParamState> = {
      "hauler.maxCount": {
        frozenAt: 500,
        frozenUntil: 10500, // 恰好到期
        reason: "Consecutive 3 rollbacks",
        rollbackCount: 3,
      },
    };

    // T=10500：frozenUntil <= currentTick → 解冻，从 frozenParams 移除
    const result = applyFreezePolicy(frozenParams, [], [], baselines, 10500);
    expect(frozenParams["hauler.maxCount"]).toBeUndefined(); // 已移除
    expect(result.unfrozenParams).toContain("hauler.maxCount");
    expect(result.newlyFrozen).toHaveLength(0);
  });

  it("解冻后再次回滚需重新累积 3 次才再冻结", () => {
    // 场景：解冻后 rollbackCount 清零，需 3 次新回滚才再冻结
    const baselines = configBaselines();
    const frozenParams: Record<string, FrozenParamState> = {
      "hauler.maxCount": {
        frozenAt: 500,
        frozenUntil: 10500,
        reason: "Consecutive 3 rollbacks",
        rollbackCount: 3,
      },
    };

    // T=10500：解冻（移除条目）
    applyFreezePolicy(frozenParams, [], [], baselines, 10500);
    expect(frozenParams["hauler.maxCount"]).toBeUndefined();

    // 解冻后第 1 次回滚：rollbackCount 0→1（重新从 0 开始累积），未冻结
    const rb1 = { param: "hauler.maxCount", oldValue: 7, newValue: 5, reason: "fail-after-unfreeze-1" };
    let result = applyFreezePolicy(frozenParams, [rb1], ["hauler.maxCount"], baselines, 11000);
    expect(result.newlyFrozen).toHaveLength(0); // 未冻结
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(1);
    expect(frozenParams["hauler.maxCount"]!.frozenUntil).toBe(0);

    // 第 2 次回滚：rollbackCount 1→2，未冻结
    const rb2 = { param: "hauler.maxCount", oldValue: 7, newValue: 5, reason: "fail-after-unfreeze-2" };
    result = applyFreezePolicy(frozenParams, [rb2], ["hauler.maxCount"], baselines, 11500);
    expect(result.newlyFrozen).toHaveLength(0);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(2);

    // 第 3 次回滚：rollbackCount 2→3，达阈值 → 再冻结
    const rb3 = { param: "hauler.maxCount", oldValue: 7, newValue: 5, reason: "fail-after-unfreeze-3" };
    result = applyFreezePolicy(frozenParams, [rb3], ["hauler.maxCount"], baselines, 12000);
    expect(result.newlyFrozen).toHaveLength(1);
    expect(frozenParams["hauler.maxCount"]!.frozenUntil).toBe(12000 + 10000);
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(3);
  });

  it("未到期冻结的参数不被解冻（frozenUntil > currentTick）", () => {
    // 边界用例：冻结未到期时不解冻
    const baselines = configBaselines();
    const frozenParams: Record<string, FrozenParamState> = {
      "hauler.maxCount": {
        frozenAt: 500,
        frozenUntil: 10500,
        reason: "Consecutive 3 rollbacks",
        rollbackCount: 3,
      },
    };

    // T=10499：frozenUntil(10500) > currentTick(10499) → 未到期，不解冻
    const result = applyFreezePolicy(frozenParams, [], [], baselines, 10499);
    expect(frozenParams["hauler.maxCount"]).toBeDefined(); // 仍存在
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(3); // 保留
    expect(result.unfrozenParams).toHaveLength(0);
  });

  it("frozenUntil=0（未冻结仅跟踪 rollbackCount）的参数不被解冻扫描移除", () => {
    // 边界用例：frozenUntil=0 表示「未冻结但跟踪 rollbackCount」，不应被解冻扫描移除
    const baselines = configBaselines();
    const frozenParams: Record<string, FrozenParamState> = {
      "hauler.maxCount": {
        frozenAt: 0,
        frozenUntil: 0, // 未冻结
        reason: "",
        rollbackCount: 2,
      },
    };

    const result = applyFreezePolicy(frozenParams, [], [], baselines, 5000);
    // frozenUntil=0 不满足 > 0 条件 → 不被移除
    expect(frozenParams["hauler.maxCount"]).toBeDefined();
    expect(frozenParams["hauler.maxCount"]!.rollbackCount).toBe(2);
    expect(result.unfrozenParams).toHaveLength(0);
  });
});

// ─── 边界条件 ────────────────────────────────────────────────

describe("闭环验证边界条件", () => {
  it("verifyDelay 未到期 → 跳过验证，保留 pending", () => {
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({ adjustTick: 1000 }),
    };
    const bounds = boundsWithHaulerMax(7);

    // T=1200：verifyDelay 1500 未到期（1200-1000=200 < 1500）
    const signals = healthySignals({ containerFillRatio: 0.95, haulerCount: 7 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 1200);

    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toHaveLength(0);
    expect(verifyResult.blockedParams).toHaveLength(0); // 未到期不检查人口合同
  });

  it("preAdjustSignals 缺失（containerFillRatio 未记录）→ 不回滚（保守）", () => {
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": {
        preAdjustSignals: { roleCount: 6 }, // containerFillRatio 缺失
        expectedDirection: "improve",
        adjustDirection: "up",
        adjustTick: 1000,
        preAdjustValue: 6,
      },
    };
    const bounds = boundsWithHaulerMax(7);

    // T=2500：verifyDelay 到期，人口合同满足（roleCount=7）
    const signals = healthySignals({ containerFillRatio: 0.95, haulerCount: 7 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    // preAdjustSignals 缺主信号 → 保守不回滚，但闭环结束（cleared）
    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });

  it("信号变化在容差范围内 → 不回滚（保守，避免误回滚）", () => {
    // containerFill 0.8→0.82，变化 0.02 < tol(0.04) → 无显著变化 → 不回滚
    const pending: Record<string, PendingValidation> = {
      "hauler.maxCount": pendingHaulerUp({ preAdjustSignals: { containerFillRatio: 0.8, spawnFillRatio: 0.5, roleCount: 6 } }),
    };
    const bounds = boundsWithHaulerMax(7);

    const signals = healthySignals({ containerFillRatio: 0.82, haulerCount: 7 });
    const verifyResult = verifyPendingAdjustments(signals, pending, bounds, 2500);

    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("hauler.maxCount");
  });

  it("未知参数的 pending → 清空不回滚", () => {
    const pending: Record<string, PendingValidation> = {
      "unknown.param": {
        preAdjustSignals: {},
        expectedDirection: "improve",
        adjustDirection: "up",
        adjustTick: 1000,
        preAdjustValue: 1,
      },
    };

    const signals = healthySignals();
    const verifyResult = verifyPendingAdjustments(signals, pending, DEFAULT_BOUNDS, 2500);

    expect(verifyResult.rollbacks).toHaveLength(0);
    expect(verifyResult.clearedParams).toContain("unknown.param");
  });

  it("pending-lock 同时排除 pending 与冻结中参数", () => {
    // 验证 buildExcludedParams 等价逻辑：pending + frozen(frozenUntil > tick) 都排除
    // 通过 evaluateTuning 的 excludedParams 行为验证
    const bounds = boundsWithHaulerMax(7);
    const lastAdjusted = { "hauler.maxCount": 1000, "harvester.maxCount": 500 };
    const signals = healthySignals({
      containerFillRatio: 0.75, haulerCount: 7,
      avgReserveDelta: -80, harvesterCount: 4,
    });

    // 同时排除两个参数
    const excluded = new Set(["hauler.maxCount", "harvester.maxCount"]);
    const result = evaluateTuning(signals, bounds, lastAdjusted, 2000, {}, excluded);

    // 两个参数都被排除 → newTrend="none"，无调整
    expect(result.newTrend["hauler.maxCount"]).toBe("none");
    expect(result.newTrend["harvester.maxCount"]).toBe("none");
    expect(result.adjustments.find(a => a.param === "hauler.maxCount")).toBeUndefined();
    expect(result.adjustments.find(a => a.param === "harvester.maxCount")).toBeUndefined();
  });
});
