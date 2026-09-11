import { describe, expect, it } from "vitest";
import { EventKind } from "../../../src/kernel/event-log";

/**
 * EventKind 稳定性守卫。
 *
 * EventKind 的整数编码会随事件写入 Memory/segment 持久化；历史事件依赖这些稳定的
 * 数值解读语义。任何「向中部插入新事件」或「重排已有成员」都会让已落盘的编码语义
 * 静默漂移（历史上已发生多次调整——见 28/37/44/45 的非连续与乱序），遥测/复盘会
 * 把同一数值解读成不同事件。
 *
 * 本测试冻结「成员名 ↔ 编码」基线：改动任何已有条目即失败。新增事件只允许追加到
 * 末尾；如需在中间插入，必须在 EXPECTED 里同步登记新条目（本测试会强制新条目唯一，
 * 但真正的防护是「禁止改动已登记条目的数值或名称」）。
 */
const EXPECTED: Record<string, number> = {
  PhaseTransition: 0,
  TierDowngrade: 1,
  TierUpgrade: 2,
  ColonyStateChange: 3,
  ControllerLevelUp: 4,
  ControllerDowngradeRisk: 5,
  P0SpawnRequest: 6,
  EnemyInvasion: 7,
  EnemyCleared: 8,
  SafeModeActivated: 9,
  PluginCooldown: 10,
  CreepStuck: 11,
  BuildComplete: 12,
  StructureDestroyed: 13,
  AssignmentRenewed: 14,
  AssignmentAssigned: 15,
  AssignmentExpired: 16,
  CreepDeath: 17,
  TowerVolley: 18,
  TuningAdjust: 19,
  TuningRollback: 20,
  TuningFreeze: 21,
  TuningBlocked: 22,
  WarOutcome: 23,
  EnergyTransfer: 24,
  AgendaChange: 25,
  ProspectOutcome: 26,
  ExpansionOutcome: 28,
  AgendaOutcome: 29,
  MineralTransfer: 30,
  PowerCreepMilestone: 31,
  NukeLaunched: 32,
  NukeDetected: 33,
  NukeSalvage: 34,
  EmergencySurvival: 35,
  PowerFarmOutcome: 36,
  SituationChange: 37,
  ExpectationViolation: 38,
  AccountingDrift: 39,
  RequestExpired: 40,
  WarPlanCreated: 41,
  ThreatUnhandled: 42,
  StrategyReview: 43,
  L2Intake: 44,
  P3StarvationFrozen: 45,
};

/** 从数字枚举对象提取 forward 映射（成员名 → 编码），忽略反向数值条目。 */
function enumForwardValues(obj: object): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "number") result[key] = value;
  }
  return result;
}

describe("EventKind 编码稳定性", () => {
  it("每两个成员占用唯一编码（无撞值）", () => {
    const actual = enumForwardValues(EventKind);
    const seen = new Map<number, string>();
    for (const [name, code] of Object.entries(actual)) {
      const prev = seen.get(code);
      if (prev !== undefined) {
        throw new Error(`EventKind 撞值：${prev} 与 ${name} 都编码为 ${code}`);
      }
      seen.set(code, name);
    }
  });

  it("冻结基线：成员名 ↔ 编码必须与冻结快照完全一致", () => {
    const actual = enumForwardValues(EventKind);
    for (const [name, code] of Object.entries(EXPECTED)) {
      expect(
        actual[name],
        `EventKind.${name} 的编码已变化（期望 ${code}）——历史事件语义会漂移，禁止改动`,
      ).toBe(code);
    }
    // 运行时不允许出现基线之外的成员（新增也必须先登记进 EXPECTED）。
    for (const name of Object.keys(actual)) {
      expect(
        Object.prototype.hasOwnProperty.call(EXPECTED, name),
        `EventKind.${name} 未在冻结基线中登记——新增事件请追加到末尾并同步登记`,
      ).toBe(true);
    }
  });

  it("基线自身不包含重复编码", () => {
    const codes = Object.values(EXPECTED);
    expect(new Set(codes).size).toBe(codes.length);
  });
});