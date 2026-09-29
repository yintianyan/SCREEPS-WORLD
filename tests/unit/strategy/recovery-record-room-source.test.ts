/**
 * 回归：恢复动作记录的房名**只能**来自 `action.room`。
 *
 * 立案依据（官服实测）：`submitTerminalTrade` 原先用 `targetFailureId.split(":")[1]` 取房名，
 * 而 id 的形状在各生产者之间不一致（`failure:<dim>:<tick>` 与 `failure:colony:<room>:<tick>` 并存，
 * `RecoveryAction.room` 的注释早就写明这点），于是那条矿物故障把**维度名**当房名用 ⇒
 * 按房查 storage 永远落空 ⇒ 缺口恒等于整条买入地板 ⇒ 在 storage≈90 万时照买能量：
 * credits 457,666 → 331,398（约 −126K / 40 分钟）。
 *
 * `recovery-lifecycle.createActionRecord` 是把脏房名写进记录的源头，这里钉住它；
 * 同型的 6 处解析在 `recovery-execution-system.ts` 里一起改成了 action.room（那文件没有系统级夹具，
 * 接线仍靠集成用例与线上 `demandTop` 形态读数 —— 缺口写在这里，不假装覆盖到）。
 */
import { describe, expect, it } from "vitest";
import { createActionRecord } from "../../../src/domain/strategy/recovery-lifecycle";
import type { RecoveryAction } from "../../../src/domain/strategy/recovery-priority";
import { GLOBAL_ROOM } from "../../../src/domain/strategy/recovery-priority";

function makeAction(over: Partial<RecoveryAction>): RecoveryAction {
  return {
    id: "a1",
    type: "TERMINAL_TRADE" as RecoveryAction["type"],
    targetFailureId: "failure:mineral:83306739-83306742",
    domain: "mineral" as RecoveryAction["domain"],
    room: "W37S58",
    priority: 50,
    estimatedCost: 100,
    estimatedBenefit: 200,
    roi: 2,
    urgent: false,
    estimatedRecoveryTime: 500,
    description: "买能量恢复矿物采集",
    recommendation: "terminal-trade energy",
    ...over,
  };
}

describe("恢复记录的房间来源（c459dd5 回归）", () => {
  it("房名取 action.room，不从 targetFailureId 按位置解析", () => {
    const rec = createActionRecord(makeAction({}), 1000);
    // 旧实现会写成 "mineral"（那是维度名），于是下游按房取数全部落空。
    expect(rec.room).toBe("W37S58");
  });

  it("id 里确实带房名时，仍以 action.room 为准（两种形状不能靠位置猜）", () => {
    const rec = createActionRecord(
      makeAction({ targetFailureId: "failure:colony:W36S58:1234", room: "W37S58" }),
      1000,
    );
    expect(rec.room).toBe("W37S58");
  });

  it("无房间维度的动作写 GLOBAL_ROOM —— 下游据此显式跳过，而不是当成某个房去买", () => {
    const rec = createActionRecord(makeAction({ room: GLOBAL_ROOM }), 1000);
    expect(rec.room).toBe(GLOBAL_ROOM);
  });

  it("correlationId 与房无关的字段保持不变（这条修复不该动别的口径）", () => {
    const rec = createActionRecord(makeAction({ id: "zz" }), 4321);
    expect(rec.correlationId).toBe("rcv-zz-4321");
    expect(rec.actionId).toBe("zz");
    expect(rec.failureId).toBe("failure:mineral:83306739-83306742");
    expect(rec.state).toBe("proposed");
  });
});
