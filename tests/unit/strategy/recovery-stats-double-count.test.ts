/** #112：恢复统计的"整表快照"被消费侧按拍累加 ⇒ 一次成功计约 50 次。
 * 修复口径 = 同拍增量 succeededThisTick / recoveryTimeThisTick。
 * 前提（读码）：succeeded 跃迁只发生在 recovery-execution-system 自己的 verify 通道，
 * 所以 record.updatedAt 必然等于本系统某一次运行的 tick，增量不会漏计。 */
import { describe, it, expect } from "vitest";
import {
  computeRecoveryStats,
  type RecoveryActionRecord,
  type RecoveryActionTable,
} from "../../../src/domain/strategy/recovery-lifecycle";

const TICK = 1000;

function succeededRecord(updatedAt: number, actionId = "a1"): RecoveryActionRecord {
  return {
    actionId,
    failureId: "f1",
    correlationId: "c1",
    type: "SPAWN_CREEP",
    domain: "spawn",
    room: "W1N1",
    state: "succeeded",
    attempts: 1,
    maxAttempts: 3,
    submittedAt: updatedAt - 100,
    updatedAt,
  } as unknown as RecoveryActionRecord;
}

function tableWith(...records: RecoveryActionRecord[]): RecoveryActionTable {
  const m = new Map<string, RecoveryActionRecord>();
  for (const r of records) m.set(r.actionId, r);
  return m as unknown as RecoveryActionTable;
}

describe("#112 恢复统计：快照不得当事件增量", () => {
  it("同拍增量只数这一拍跃迁成功的记录", () => {
    const table = tableWith(succeededRecord(TICK));
    expect(computeRecoveryStats(table, TICK).succeededThisTick).toBe(1);
    expect(computeRecoveryStats(table, TICK + 10).succeededThisTick).toBe(0);
  });

  it("一次成功在 500 拍保留期 / 10 拍 interval 的累计里仍等于 1（修复前此处为 50）", () => {
    const table = tableWith(succeededRecord(TICK));
    let acc = 0;
    let accTime = 0;
    for (let t = TICK; t <= TICK + 490; t += 10) {
      const s = computeRecoveryStats(table, t);
      acc += s.succeededThisTick;
      accTime += s.recoveryTimeThisTick;
    }
    expect(acc).toBe(1);
    expect(accTime).toBe(100);
  });

  it("快照字段语义不变（整表读数），避免误伤其他消费者", () => {
    const table = tableWith(succeededRecord(TICK), succeededRecord(TICK - 200, "a2"));
    const stats = computeRecoveryStats(table, TICK);
    expect(stats.succeededCount).toBe(2);
    expect(stats.succeededThisTick).toBe(1);
  });

  it("两条同拍成功各计一次，恢复时长按记录相加", () => {
    const table = tableWith(succeededRecord(TICK), succeededRecord(TICK, "a2"));
    const stats = computeRecoveryStats(table, TICK);
    expect(stats.succeededThisTick).toBe(2);
    expect(stats.recoveryTimeThisTick).toBe(200);
  });
});
