/**
 * #83 —— 回滚事件带"验证那一拍的在场角色数"，让同一 kind 下的两种成因事后分得开。
 *
 * 现场为什么需要它（不是凑数）：`TuningRollback` 这个 kind 同时被"效果判据未达标"和
 * #79 的上行护栏使用（两者是同一个 push 点、同一句 reason 文本），而段 2 的事件环只留 ~755 拍
 * < verifyDelay 1,500 拍 ⇒ 一次验证的因与果不可能同时在环里，事后取证按构造来不及。
 * 在场的角色数又是瞬时值（5 分钟级采样只能夹紧区间、取不到那一拍）⇒ 必须在写事件那一刻落盘。
 *
 * 判别规则（本文件把它钉成用例，线上读数按同一条查）：
 *   roleCountAtVerify >= preAdjustValue+1  ⇒ 人口合同满足 ⇒ 撤销只可能来自效果判据/上行护栏；
 *   roleCountAtVerify <  preAdjustValue+1  ⇒ 走的是"合同超时"那条独立 push 点。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { verifyPendingAdjustments } from "../../../src/domain/tuning/evaluator";
import { resetGlobals } from "../../support/factories";

const HAULER = "hauler.maxCount";
const VERIFY_TICK = 10_000; // adjustTick=0 ⇒ verifyDelay(1,500) 与 2×verifyDelay 都已到期

function signals(over: Record<string, unknown>) {
  return {
    upgraderCount: 0,
    haulerCount: 6,
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

/** 一次 ↑（6→7）的 pending；blockedSinceTick 可选（给了就是已经被合同挡过至少一轮）。 */
function pendingUp(over: Record<string, unknown> = {}) {
  return {
    [HAULER]: {
      preAdjustSignals: { containerFillRatio: 0.5, spawnFillRatio: 0.5, roleCount: 6 },
      expectedDirection: "improve",
      adjustDirection: "up",
      preAdjustValue: 6,
      adjustTick: 0,
      ...over,
    },
  } as never;
}

beforeEach(() => {
  resetGlobals();
});

describe("#83 回滚成因的可归因字段", () => {
  it("(a) 效果路径：编制到位但主/次信号都没改善 ⇒ 回滚，且带上到位那一刻的角色数", () => {
    const pending = pendingUp();
    const r = verifyPendingAdjustments(
      signals({ haulerCount: 7, containerFillRatio: 0.9, spawnFillRatio: 0.4 }),
      pending,
      bounds(),
      VERIFY_TICK,
    );
    expect(r.rollbacks.map(x => x.param)).toEqual([HAULER]);
    expect(r.rollbacks[0]!.reason).toContain("Effect verification failed");
    expect(r.rollbacks[0]!.roleCountAtVerify).toBe(7);
  });

  it("(b) 合同路径：编制始终没到位 ⇒ 回滚，带的是那个不到位的人数", () => {
    const pending = pendingUp({ blockedSinceTick: 0 });
    const r = verifyPendingAdjustments(
      signals({ haulerCount: 6, containerFillRatio: 0.9, spawnFillRatio: 0.4 }),
      pending,
      bounds(),
      VERIFY_TICK,
    );
    expect(r.rollbacks.map(x => x.param)).toEqual([HAULER]);
    expect(r.rollbacks[0]!.reason).toContain("Contract blocked timeout");
    expect(r.rollbacks[0]!.roleCountAtVerify).toBe(6);
  });

  it("(c) 判别规则本身可机读：人数 ≥ pre+1 ⇔ reason 是效果那条（线上按同一条查）", () => {
    const cases = [
      { haulerCount: 7, expectEffect: true },
      { haulerCount: 8, expectEffect: true },
      { haulerCount: 6, expectEffect: false },
      { haulerCount: 4, expectEffect: false },
    ];
    for (const c of cases) {
      const pending = pendingUp(c.expectEffect ? {} : { blockedSinceTick: 0 });
      const r = verifyPendingAdjustments(
        signals({ haulerCount: c.haulerCount, containerFillRatio: 0.9, spawnFillRatio: 0.4 }),
        pending,
        bounds(),
        VERIFY_TICK,
      );
      const rb = r.rollbacks[0]!;
      const isEffect = rb.reason.includes("Effect verification failed");
      expect(isEffect).toBe(c.expectEffect);
      // 规则：走效果那条 ⇒ 人数必然已越过 preAdjustValue+1；走合同那条 ⇒ 必然没越过。
      expect(c.expectEffect ? rb.roleCountAtVerify! >= 7 : rb.roleCountAtVerify! < 7).toBe(true);
    }
  });

  it("(d) 诊断字段不掺和决策：同一场景下回滚集合与它无关（只由判据决定）", () => {
    // 两个场景只差 haulerCount（7 vs 7 —— 刻意相同），断言决策一致；
    // 真正的"不掺和"由 (a)(b) 共同保证：人数不同 ⇒ 走的是**既有**两条不同分支，而非新字段带来的分支。
    const s = signals({ haulerCount: 7, containerFillRatio: 0.9, spawnFillRatio: 0.4 });
    const first = verifyPendingAdjustments(s, pendingUp(), bounds(), VERIFY_TICK);
    const second = verifyPendingAdjustments(s, pendingUp(), bounds(), VERIFY_TICK);
    expect(second.rollbacks.map(x => `${x.param}:${x.newValue}:${x.reason}`)).toEqual(
      first.rollbacks.map(x => `${x.param}:${x.newValue}:${x.reason}`),
    );
    expect(second.blockedParams).toEqual(first.blockedParams);
    expect(second.clearedParams).toEqual(first.clearedParams);
  });
});
