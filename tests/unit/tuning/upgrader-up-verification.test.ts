/**
 * #68 + #79 —— upgrader ↑ 的闭环验证：编制到位是**必要条件**，不再是充分证据。
 *
 * #68 的现场形状（线上实测）：`upgrader.maxCount` 1→2 于 tick 83374266，当场两只在场（+16/拍），
 * 1,500 拍后被回滚，期间 `p=0`、`se` 62k→66k **一路上行**
 * ⇒ 旧判据"storage 必须转跌才叫改善"在盈余房里按构造不可满足 ⇒ 每一次 ↑ 必被撤销。
 *
 * ⚠️#68 当时的解法（"人口到位即算改善"）后来被证明**错在类型**：该谓词与 D.3 `isContractMet`
 * 逐字相同、且 D.3 先行，于是凡能走到效果判据的 ↑ 必然放行 ⇒ 效果检验被折叠 ⇒ ↑ 成为单向棘轮
 * （线上指纹：maxCount 1→2→3 而 `rollbackCount` 始终 0）。
 * #79 的解法：人口到位之后仍要过**上行护栏**——多出来的编制若把储备抽干（`avgReserveDelta`
 * 转负且比调整前更坏），这次抬高就被撤销。只用既有字段与既有容差，**没有新增阈值**。
 *
 * 本文件因此同时钉住四种形状：
 *  (a) 到位 + 快照没有储备字段（旧 pending 记录）⇒ 保守接受，不回滚；
 *  (b) 编制没到位 ⇒ 走 D.3 人口合同的 blocked 路径，既不 clear 也不 rollback；
 *  (c) hauler ↑ 主/次信号都没改善 ⇒ 仍然回滚（上行护栏没连带放宽别的角色）；
 *  (d) 到位 **但储备被抽干** ⇒ 回滚（这就是 #68 缺失的那条可否证路径）；
 *  (e) 到位、储备虽降但仍为正 ⇒ 接受（护栏不在"变慢"上误触发）。
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

/** 盈余房的 ↑ 记录：两只在场（合同满足），storage 仍在上行（旧判据必撤销）。 */
function surplusPending(over: Record<string, unknown> = {}) {
  return {
    [UPGRADER]: {
      preAdjustSignals: { avgStorageEnergy: 62_000, roleCount: 1, ...over },
      expectedDirection: "improve",
      adjustDirection: "up",
      preAdjustValue: 1,
      adjustTick: 0,
    },
  } as never;
}

beforeEach(() => {
  resetGlobals();
});

describe("#68/#79 upgrader ↑ 的闭环验证", () => {
  it("(a) 到位 + 旧记录没有储备快照 ⇒ 保守接受（不回滚，豁免不惩罚历史 pending）", () => {
    const r = verifyPendingAdjustments(
      signals({ upgraderCount: 2, avgStorageEnergy: 66_000 }),
      surplusPending(), // preAdjustSignals 里刻意不含 avgReserveDelta
      bounds(),
      VERIFY_TICK,
    );
    expect(r.rollbacks).toEqual([]);
    expect(r.clearedParams).toContain(UPGRADER);
    expect(r.blockedParams).toEqual([]);
  });

  it("(d) 到位 **但储备被抽干** ⇒ 回滚（#68 缺的那条可否证路径）", () => {
    const r = verifyPendingAdjustments(
      signals({ upgraderCount: 2, avgStorageEnergy: 66_000, avgReserveDelta: -300 }),
      surplusPending({ avgReserveDelta: 12 }),
      bounds(),
      VERIFY_TICK,
    );
    expect(
      r.rollbacks.map(x => x.param),
      "编制到位不再等于改善：把储备抽干的 ↑ 必须可被撤销",
    ).toEqual([UPGRADER]);
    expect(r.clearedParams).toContain(UPGRADER);
  });

  it("(e) 到位、储备增量变小但仍为正 ⇒ 接受（护栏不在『只是变慢』上误触发）", () => {
    const r = verifyPendingAdjustments(
      signals({ upgraderCount: 2, avgReserveDelta: 5 }),
      surplusPending({ avgReserveDelta: 12 }),
      bounds(),
      VERIFY_TICK,
    );
    expect(r.rollbacks).toEqual([]);
    expect(r.clearedParams).toContain(UPGRADER);
  });

  it("(b) 控制组：编制没到位 ⇒ 仍走人口合同的 blocked 路径，既不 clear 也不 rollback（护栏没绕过 D.3）", () => {
    const pending = surplusPending({ avgReserveDelta: 12 });
    const r = verifyPendingAdjustments(
      signals({ upgraderCount: 1, avgStorageEnergy: 66_000, avgReserveDelta: -300 }),
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
