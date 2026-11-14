/** 事件载荷档案语义表 — packer 是列序唯一打包点， packed 数组与历史格式逐位一致。 */
import { describe, expect, it } from "vitest";
import { EventKind, packEventPayload } from "../../../src/kernel/event-log";

describe("事件载荷 packer — 列序 = 历史 d 数组", () => {
  it("CreepDeath 五列（#157 战斗黑匣子）", () => {
    expect(
      packEventPayload(EventKind.CreepDeath, { roleCode: 7, x: 20, y: 20, age: 335, natural: 0 }),
    ).toEqual([7, 20, 20, 335, 0]);
  });
  it("TowerVolley 五列（弹道序列）", () => {
    expect(
      packEventPayload(EventKind.TowerVolley, {
        firedCount: 6,
        targetX: 12,
        targetY: 34,
        targetHealParts: 3,
        targetHitsPer100: 14,
      }),
    ).toEqual([6, 12, 34, 3, 14]);
  });
  it("EnemyInvasion 四列（数量/治疗/远程/近战）", () => {
    expect(
      packEventPayload(EventKind.EnemyInvasion, {
        count: 1,
        healParts: 0,
        rangedParts: 3,
        meleeParts: 2,
      }),
    ).toEqual([1, 0, 3, 2]);
  });
  it("RecoveryEscalation 三列（#139 取列事故位）", () => {
    expect(
      packEventPayload(EventKind.RecoveryEscalation, { attempts: 2, terminal: 1, repeats: 3 }),
    ).toEqual([2, 1, 3]);
  });
  it("WarOutcome 三列（outcome/spawned/reason）", () => {
    expect(
      packEventPayload(EventKind.WarOutcome, { outcomeCode: 1, spawned: 0, reasonCode: 2 }),
    ).toEqual([1, 0, 2]);
  });
  it("LostRoomPurge 六列", () => {
    expect(
      packEventPayload(EventKind.LostRoomPurge, {
        reasonCode: 0,
        tuningOverrideCount: 2,
        pendingValidationCount: 1,
        frozenParamCount: 3,
        remoteOpCount: 0,
        lostForTicks: 20001,
      }),
    ).toEqual([0, 2, 1, 3, 0, 20001]);
  });
  it("RoomReleased 六列", () => {
    expect(
      packEventPayload(EventKind.RoomReleased, {
        reasonCode: 1,
        involuntary: 1,
        remoteOpsDropped: 2,
        drainingTicks: 500,
        unclaimAttempts: 1,
        lastUnclaimCode: -99,
      }),
    ).toEqual([1, 1, 2, 500, 1, -99]);
  });
  it("PowerCreepMilestone 变长（stage / stage+power）", () => {
    expect(packEventPayload(EventKind.PowerCreepMilestone, { stage: 0 })).toEqual([0]);
    expect(packEventPayload(EventKind.PowerCreepMilestone, { stage: 1, power: 3 })).toEqual([1, 3]);
  });
  it("P3StarvationFrozen 变长（bucket / bucket+duration）", () => {
    expect(packEventPayload(EventKind.P3StarvationFrozen, { bucket: 300 })).toEqual([300]);
    expect(
      packEventPayload(EventKind.P3StarvationFrozen, { bucket: 300, frozenDuration: 400 }),
    ).toEqual([300, 400]);
  });
  it("空载荷 kinds（EnemyCleared/TickFatal）→ 空数组", () => {
    expect(packEventPayload(EventKind.EnemyCleared, {})).toEqual([]);
    expect(packEventPayload(EventKind.TickFatal, {})).toEqual([]);
  });
  it("EmergencySurvival 方向沿（1=enter/0=exit）", () => {
    expect(packEventPayload(EventKind.EmergencySurvival, { direction: 1 })).toEqual([1]);
    expect(packEventPayload(EventKind.EmergencySurvival, { direction: 0 })).toEqual([0]);
  });
});
