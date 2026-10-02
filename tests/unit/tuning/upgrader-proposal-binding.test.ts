/**
 * #85 —— ↑ 的事前绑定判据：需求阶梯正在压着 maxCount 时，别提落不了地的扩容。
 *
 * 现场病灶（2026-10-02 实测）：幼房 `upgrader.maxCount` 被抬到 3、而在场恒为 2 ——
 * 因为冲刺档写死 `min(maxCount, 2)`（`demand.ts`），那个"3"根本不参与计算。
 * 于是 D.3 的 `roleCount >= preAdjustValue+1` 必假 ⇒ 每 ~3×verifyDelay 被撤一次，
 * 调优器把自己的空转当成"效果未达标"。**修法是让它别提出这种 ↑，不是放宽任何判据。**
 *
 * 关键控制组（缺这条就是"把正常通路焊死而不自知"）：钳位不存在时必须照常提 ↑。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateTuning } from "../../../src/domain/tuning/evaluator";
import type { TuningSignals } from "../../../src/domain/tuning/types";
import { resetGlobals } from "../../support/factories";

const PARAM = "upgrader.maxCount";

// 富余到 surplus 门槛之上的库存读数（门槛按 RCL 分级，这里取一个跨档位都算"高位"的数）。
function signals(over: Partial<TuningSignals> = {}) {
  return {
    upgraderCount: 2,
    haulerCount: 6,
    harvesterCount: 2,
    builderCount: 1,
    avgStorageEnergy: 500_000,
    avgPressure: 0,
    avgReserveDelta: 12,
    avgDrainScore: 0,
    crisisRatio: 0,
    containerFillRatio: 0.3,
    spawnFillRatio: 0.9,
    buildQueueBacklog: 0,
    hasStorage: true,
    rcl: 4,
    srcRatio: 1,
    ...over,
  } as TuningSignals;
}

function bounds() {
  return {
    upgrader: { minCount: 1, maxCount: 2 },
    hauler: { minCount: 3, maxCount: 8 },
  };
}

/** prevTrend 给 "up" 是因为提案要连续两轮同向才落地（confirmAndBuild 的确认逻辑）。 */
function propose(s: TuningSignals) {
  return evaluateTuning(s, bounds(), {}, 100_000, { [PARAM]: "up" }, undefined, () => 0.99);
}

function proposedUp(s: TuningSignals): boolean {
  const r = propose(s);
  return r.adjustments.some(a => a.param === PARAM && a.newValue === 3);
}

beforeEach(() => {
  resetGlobals();
});

describe("#85 upgrader ↑ 的事前绑定判据", () => {
  it("(a) 冲刺档把需求压在 2 ⇒ 不再将 maxCount 提向 3（这发 ↑ 按构造落不了地）", () => {
    expect(proposedUp(signals({ upgraderClamp: 2 }))).toBe(false);
  });

  it("(b) 控制组：没有结构钳位 ⇒ 照常提 ↑（判据不得把正常通路焊死）", () => {
    expect(proposedUp(signals())).toBe(true);
    expect(proposedUp(signals({ upgraderClamp: undefined }))).toBe(true);
  });

  it("(c) 钳位够高 ⇒ 放行：maintain 档压到 1 时不提，保级档（钳位 3）时提", () => {
    expect(proposedUp(signals({ upgraderClamp: 1 }))).toBe(false);
    expect(proposedUp(signals({ upgraderClamp: 3 }))).toBe(true);
  });

  it("(d) 只管 ↑ 不管 ↓：低库存 + 钳位存在时 ↓ 仍照常发生", () => {
    const downSignals = signals({
      avgStorageEnergy: 500,
      upgraderClamp: 1,
      rcl: 8,
      upgraderCount: 2,
    });
    const r = evaluateTuning(
      downSignals,
      { upgrader: { minCount: 1, maxCount: 2 }, hauler: bounds().hauler },
      {},
      100_000,
      { [PARAM]: "down" },
      undefined,
      () => 0.99,
    );
    const down = r.adjustments.find(a => a.param === PARAM);
    expect(down?.newValue).toBe(1);
  });

  it("(e) 边界值：钳位恰好等于新值时放行（判据是 <=，不是 <）", () => {
    const r = evaluateTuning(
      signals({ upgraderClamp: 4, upgraderCount: 3 }),
      { upgrader: { minCount: 1, maxCount: 3 }, hauler: bounds().hauler },
      {},
      100_000,
      { [PARAM]: "up" },
      undefined,
      () => 0.99,
    );
    expect(r.adjustments.some(a => a.param === PARAM && a.newValue === 4)).toBe(true);
  });
});
