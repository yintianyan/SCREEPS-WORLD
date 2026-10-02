/**
 * #68 —— upgrader ↑ 的闭环验证：编制到位即算改善（补一条成功出口，不放宽任何判据）。
 *
 * 现场形状（线上实测）：`upgrader.maxCount` 1→2 于 tick 83374266，当场两只在场（+16/拍），
 * 1,500 拍后被回滚（lastAdjusted 83375766），期间 `p=0`、`se` 62k→66k **一路上行**
 * ⇒ 旧判据"storage 必须转跌才叫改善"在盈余房里按构造不可满足 ⇒ 每一次 ↑ 必被撤销。
 * 本文件把那条**必然被撤销**的形状钉成用例（(a)），并用两条对照证明豁免没有被加宽：
 *  (b) 编制没到位 ⇒ 走 D.3 人口合同的 blocked 路径，既不 clear 也不 rollback；
 *  (c) hauler ↑ 主/次信号都没改善 ⇒ 仍然回滚（我只给 upgrader 加了出口）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { verifyPendingAdjustments } from "../../../src/domain/tuning/evaluator";
import { resetGlobals } from "../../support/factories";

const UPGRADER = "upgrader.maxCount";
const HAULER = "hauler.maxCount";

// adjustTick=0 + currentTick=10000 ⇒ 任何 verifyDelay 都已到期，本文件不依赖具体数字。
const VERIFY_TICK = 10_000;

function signals(over: Record<string, unknown>) {
  return {
    upgraderCount: 0,
    haulerCount: 0,
    harvesterCount: 2,
    builderCount: 1,
    avgStorageEnergy: 66_000,
    avgPressure: 0,
    avgReserveDelta: 12,
    avgDrainScore: 0,
    crisisRatio: 0,
    containerFillRatio: 0.5,
    spawnFillRatio: 0.5,
    buildQueueBacklog: 0,
    hasStorage: true,
    rcl: 4,
    ...over,
  } as never;
}

function bounds() {
  return {
    upgrader: { minCount: 1, maxCount: 2 },
    hauler: { minCount: 3, maxCount: 8 },
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("#68 upgrader ↑ 的效果豁免", () => {
  it("(a) 盈余房现场形状：两只在场但 storage 仍在上行 ⇒ 算改善（清空 pending，不回滚）", () => {
    const pending = {
      [UPGRADER]: {
        preAdjustSignals: { avgStorageEnergy: 62_000, roleCount: 1 },
        expectedDirection: "improve",
        adjustDirection: "up",
        preAdjustValue: 1,
        adjustTick: 0,
      },
    } as never;
    const r = verifyPendingAdjustments(
      signals({ upgraderCount: 2, avgStorageEnergy: 66_000 }),
      pending,
      bounds(),
      VERIFY_TICK,
    );
    expect(r.rollbacks).toEqual([]); // 旧实现会在这里推一条 "signal not improved" 的回滚
    expect(r.clearedParams).toContain(UPGRADER);
    expect(r.blockedParams).toEqual([]);
  });

  it("(b) 控制组：编制没到位 ⇒ 仍走人口合同的 blocked 路径，既不 clear 也不 rollback（豁免没绕过 D.3）", () => {
    const pending = {
      [UPGRADER]: {
        preAdjustSignals: { avgStorageEnergy: 62_000, roleCount: 1 },
        expectedDirection: "improve",
        adjustDirection: "up",
        preAdjustValue: 1,
        adjustTick: 0,
      },
    } as never;
    const r = verifyPendingAdjustments(
      signals({ upgraderCount: 1, avgStorageEnergy: 66_000 }),
      pending,
      bounds(),
      VERIFY_TICK,
    );
    expect(r.rollbacks).toEqual([]);
    expect(r.clearedParams).toEqual([]);
    expect(r.blockedParams).toContain(UPGRADER);
    const blocked = (pending as never as Record<string, { contractBlocked?: boolean } | undefined>)[
      UPGRADER
    ];
    expect(blocked?.contractBlocked).toBe(true);
  });

  it("(c) 无连带放宽：hauler ↑ 主/次信号都未改善 ⇒ 仍然回滚", () => {
    const pending = {
      [HAULER]: {
        preAdjustSignals: { containerFillRatio: 0.5, spawnFillRatio: 0.5, roleCount: 6 },
        expectedDirection: "improve",
        adjustDirection: "up",
        preAdjustValue: 6,
        adjustTick: 0,
      },
    } as never;
    const r = verifyPendingAdjustments(
      signals({ haulerCount: 7, containerFillRatio: 0.9, spawnFillRatio: 0.4 }),
      pending,
      bounds(),
      VERIFY_TICK,
    );
    expect(r.rollbacks.map(x => x.param)).toEqual([HAULER]);
    expect(r.clearedParams).toContain(HAULER);
  });
});
