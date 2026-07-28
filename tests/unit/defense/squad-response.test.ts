/**
 * M11 防御 L1 三件套测试。
 *
 * ① 小队威胁判定（isSquadThreat）：≥2 武装或武装+治疗组合才算小队 —
 *    独狼/纯拆迁/纯奶不触发全员避险（避免过度反应打断经济）。
 * ② 战时集结避险：squadThreat 在场时非战斗角色撤入核心集结区
 *    （不限 fleeRange），战斗角色（combat=true）豁免照常接敌。
 * ③ defender 双编制：squadThreat 时编制保底 2 只且优先级 P0。
 * ④ safe mode 舰队伤亡熔断：窗口内战损达阈值触发（黑匣子计数联动）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSquadThreat } from "../../../src/domain/defense/threat";
import { evaluateDemand } from "../../../src/domain/spawn/demand";
import { haulerRole } from "../../../src/creeps/roles/hauler";
import { globalCache } from "../../../src/kernel/global-cache";
import { recordCreepDeath } from "../../../src/kernel/event-log";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../role-helpers";

const A = "attack" as BodyPartConstant;
const R = "ranged_attack" as BodyPartConstant;
const H = "heal" as BodyPartConstant;
const W = "work" as BodyPartConstant;
const M = "move" as BodyPartConstant;

function threat(...parts: BodyPartConstant[]) {
  return { owner: "enemy", bodyParts: parts };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("isSquadThreat — 威胁分级", () => {
  it("双武装 = 小队", () => {
    expect(isSquadThreat([threat(A, M), threat(R, M)])).toBe(true);
  });

  it("武装 + 治疗组合 = 小队（heal-tank 编队）", () => {
    expect(isSquadThreat([threat(R, M), threat(H, M)])).toBe(true);
  });

  it("独狼武装不算小队（塔集火可处理）", () => {
    expect(isSquadThreat([threat(A, A, M)])).toBe(false);
  });

  it("纯拆迁/纯治疗编队不算小队（无杀伤能力）", () => {
    expect(isSquadThreat([threat(W, M), threat(W, M), threat(H, M)])).toBe(false);
  });

  it("空威胁列表不算小队", () => {
    expect(isSquadThreat([])).toBe(false);
  });
});

describe("集结避险 — squadThreat 时非战斗角色撤向核心", () => {
  it("hauler 在小队威胁下不执行常规链，mode 转 flee 并向 storage 集结", () => {
    const storage = mockStructure("storage", { id: "st", energy: 10000, capacity: 1000000 });
    const container = mockStructure("container", { id: "c1", energy: 1500, capacity: 2000 });
    const hostile = { id: "h1", pos: { x: 40, y: 40, getRangeTo: () => 30 }, owner: { username: "enemy" } };
    const snap = mockSnapshot({
      storage,
      containers: [container],
      threatCreeps: [hostile] as any,
      squadThreat: true,
    });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
    creep.pos.getRangeTo = vi.fn(() => 20); // 距 storage/威胁都很远（fleeRange 外）。

    haulerRole.run(creep, mockContext(snap));

    expect(creep.memory.mode).toBe("flee");
    // 集结移动发生（moveTo 被调），常规取货链被跳过。
    expect(creep.withdraw).not.toHaveBeenCalled();
  });
});

describe("defender 编制 — 威胁分级响应", () => {
  function demandWith(squad: boolean, threatCount: number) {
    const hostiles = Array.from({ length: threatCount }, (_, i) => ({ id: `h${i}` }));
    const snap = mockSnapshot({
      threatCreeps: hostiles as any,
      squadThreat: squad,
      rcl: 5,
    });
    const roomCtx = {
      colonyState: "normal" as const,
      controllerDowngradeRisk: false,
      energyAvailable: 800,
      economyPressure: 0,
    };
    // 存活 harvester：避免触发 P0 团灭恢复短路（那个分支有自己的 defender 逻辑）。
    const alive = [{
      name: "harvester_1", role: "harvester", home: "W7N4", ticksToLive: 1200,
      bodyLength: 7, sourceId: "source_1" as Id<Source>, spawnIndex: 0,
    }];
    return evaluateDemand(snap, [], "normal", alive as any, [], roomCtx as any, 1000);
  }

  it("单威胁（非小队）：1 只 defender，P1", () => {
    const { requests } = demandWith(false, 1);
    const defenders = requests.filter(r => r.role === "defender");
    expect(defenders).toHaveLength(1);
    expect(defenders[0]!.priority).toBe(1);
  });

  it("小队威胁：编制保底 2 只且升 P0（即使威胁数为 1 组合判定成立）", () => {
    const { requests } = demandWith(true, 2);
    const defenders = requests.filter(r => r.role === "defender");
    expect(defenders).toHaveLength(2);
    expect(defenders.every(r => r.priority === 0)).toBe(true);
  });
});

describe("safe mode 熔断 — 战损计数联动（黑匣子）", () => {
  it("recordCreepDeath 的非自然死亡进入 recentCombatDeaths，自然死亡不进", () => {
    (globalThis as any).Game.time = 82000000;
    globalCache().creepLastSeen = new Map([
      ["hauler-W1N1-0-81999800-aaaa", { r: "W1N1", x: 10, y: 10 }],
      ["harvester-W1N1-0-81998500-bbbb", { r: "W1N1", x: 12, y: 12 }],
    ]);

    recordCreepDeath("hauler-W1N1-0-81999800-aaaa"); // age 200 → 战损。
    recordCreepDeath("harvester-W1N1-0-81998500-bbbb"); // age 1500 → 寿终。

    const deaths = globalCache().recentCombatDeaths ?? [];
    expect(deaths).toHaveLength(1);
    expect(deaths[0]!.r).toBe("W1N1");
  });
});
