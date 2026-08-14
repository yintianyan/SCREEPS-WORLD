/**
 * 扩张台账事件测试（R7a ExpansionOutcome）。
 *
 * 覆盖：claim 阶段被抢占 → 记录 ExpansionOutcome（phase=claim, outcome=stolen,
 * 时长）+ 黑名单 + 行动清除；pioneering 阶段 spawn 上线 → success 归因。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { expansionManagerSystem } from "../../../src/systems/expansion-manager";
import { mockBudget, mockSnapshot, resetGlobals } from "../../role-helpers";

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
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
      W6N4: { controller: { owner: { username: "Rival" } } },
    };
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
    expect((globalThis as any).Memory.kernel.expansionBlacklist?.W6N4).toBeDefined();
    const ev = expansionEvents()[0];
    expect(ev?.r).toBe("W6N4");
    expect(ev?.d).toEqual([0, 1, (globalThis as any).Game.time - 900]); // [claim, stolen, duration]
  });

  it("pioneering spawn 上线 → phase=pioneer outcome=success", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W7N4: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansion: { state: "pioneering", target: "W6N4", sponsor: "W7N4", startedAt: 1100 },
      },
    };
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
      W6N4: {
        controller: { my: true, owner: { username: "Me" } },
        find: (kind: number) => {
          if (kind === FIND_MY_SPAWNS) return [{ structureType: STRUCTURE_SPAWN }];
          if (kind === FIND_HOSTILE_CREEPS) return [];
          return [];
        },
      },
    };
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
    const ev = expansionEvents()[0];
    expect(ev?.d).toEqual([1, 0, (globalThis as any).Game.time - 1100]); // [pioneer, success, duration]
  });
});
