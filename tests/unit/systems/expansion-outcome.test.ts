/** 扩张台账事件测试（R7a ExpansionOutcome）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { expansionManagerSystem } from "../../../src/systems/expansion-manager";
import { mockBudget, mockSnapshot, resetGlobals, syncSquadIndex } from "../../role-helpers";
import { CONFIG } from "../../../src/config";

beforeEach(() => {
  resetGlobals();
});

function makeContext(): any {
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget("healthy"),
    globalSiteCount: 0,
    getSnapshot: () => mockSnapshot(),
    snapshots: function* () { yield mockSnapshot(); },
  };
}

function expansionEvents(): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === 28);
}

describe("expansion-manager — ExpansionOutcome 归因", () => {
  it("claiming 被抢占 → phase=claim outcome=stolen + 黑名单 + 清除行动", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W7N4: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansion: { state: "claiming", target: "W6N4", sponsor: "W7N4", startedAt: 900 },
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
      W6N4: { controller: { owner: { username: "Rival" } } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
    expect((globalThis as any).Memory.kernel.expansionBlacklist?.W6N4).toBeDefined();
    const ev = expansionEvents()[0];
    expect(ev?.r).toBe("W6N4");
    expect(ev?.d).toEqual([0, 1, (globalThis as any).Game.time - 900]); // [claim, stolen, duration]
  });

  it("pioneering 无视野（编队全灭失明）→ outcome=lost 而非 stolen（归因二分回归）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W7N4: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansion: { state: "bootstrapping", target: "W6N4", sponsor: "W7N4", startedAt: 1100, checkpointsPassed: 0, reservedEnergy: 0, consecutivePositiveTicks: 0 },
      },
    };
    syncSquadIndex();
    // 目标房不在 Game.rooms —— 我方在该房已无任何 creep 且无观察者支援。
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
    const ev = expansionEvents()[0];
    expect(ev?.r).toBe("W6N4");
    // [pioneer=1, lost=3, duration] —— 修复前此处误记 [1, 1, ...]（stolen）
    expect(ev?.d).toEqual([1, 3, (globalThis as any).Game.time - 1100]);
  });

  it("pioneering 有视野且 controller 易手 → 维持 outcome=stolen", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W7N4: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansion: { state: "bootstrapping", target: "W6N4", sponsor: "W7N4", startedAt: 1100, checkpointsPassed: 0, reservedEnergy: 0, consecutivePositiveTicks: 0 },
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
      // 有视野（如观察者支援）且 controller 非我方 —— 确证被抢
      W6N4: { controller: { owner: { username: "Rival" }, reservation: { username: "Rival" } } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
    const ev = expansionEvents()[0];
    expect(ev?.d).toEqual([1, 1, (globalThis as any).Game.time - 1100]); // [pioneer, stolen, duration]
  });

  it("bootstrapping spawn 上线 + 可孵化 → 推进到 economic_startup (A3.3)", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W7N4: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansion: { state: "bootstrapping", target: "W6N4", sponsor: "W7N4", startedAt: 1100, checkpointsPassed: 0, reservedEnergy: 0, consecutivePositiveTicks: 0 },
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
      W6N4: {
        controller: { my: true, owner: { username: "Me" } },
        energyAvailable: 300,
        find: (kind: number) => {
          if (kind === FIND_MY_SPAWNS) return [{ structureType: STRUCTURE_SPAWN }];
          if (kind === FIND_HOSTILE_CREEPS) return [];
          if (kind === FIND_MY_STRUCTURES) return [];
          if (kind === FIND_STRUCTURES) return [];
          return [];
        },
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    // A3.3: spawn 存在 + 可孵化 → CP2 通过 → 推进到 economic_startup
    // 不再直接完成（不降级为 spawn 建成=成功）
    const expansion = (globalThis as any).Memory.kernel.expansion;
    expect(expansion).toBeDefined();
    expect(expansion.state).toBe("economic_startup");
    expect(expansion.checkpointsPassed).toBeGreaterThanOrEqual(2);
  });
});

describe("expansion-manager — R7b 节奏自适应接线", () => {
  it("三连败 → 扩张暂停 + 黑名单 ×1.5 缩放", () => {
    (globalThis as any).Memory = {
      schemaVersion: 31,
      creeps: {},
      rooms: { W7N4: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansion: { state: "claiming", target: "W6N4", sponsor: "W7N4", startedAt: (globalThis as any).Game.time - CONFIG.expansion.claimTimeout - 100 }, // 已超时
        expansionRhythm: { ring: [2, 2], blacklistMultiplier: 1.5, minSources: 1 }, // 已两连 timeout
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    const kernel = (globalThis as any).Memory.kernel;
    // 第三条 timeout 追加 → 连续 3 败 → 暂停。
    expect(kernel.expansionRhythm.ring).toEqual([2, 2, 2]);
    expect(kernel.expansionPausedUntil).toBe((globalThis as any).Game.time + CONFIG.expansion.rhythm.pauseTicks);
    // 零成功窗口 → 黑名单 ×1.5。
    expect(kernel.expansionBlacklist?.W6N4)
      .toBe((globalThis as any).Game.time + Math.round(CONFIG.expansion.blacklistCooldown * 1.5));
  });

  it("暂停期内不开新扩张任务", () => {
    (globalThis as any).Memory = {
      schemaVersion: 31,
      creeps: {},
      rooms: {
        W7N4: {
          spawnQueue: [],
          buildQueue: [],
          intel: { W6N4: { kind: "normal", status: "normal", sources: 2, lastSeen: 900 } },
        },
      },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansionPausedUntil: (globalThis as any).Game.time + 5000,
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } }, energyCapacityAvailable: 800 },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.gcl = { level: 2 };

    expansionManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
  });
});
