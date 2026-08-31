/** 旧版残留扩张状态防护 — 状态机无分支的 state 静默穿透会永久卡死扩张管道。 */
import { beforeEach, describe, expect, it } from "vitest";
import { expansionManagerSystem } from "../../../src/systems/expansion-manager";
import { mockBudget, mockSnapshot, resetGlobals, syncSquadIndex } from "../../role-helpers";

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

describe("expansion-manager — 旧版残留状态清理", () => {
  it("legacy pioneering 记录在入口被清理，hasOtherExpansion 不再恒真", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W37S58: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "develop", since: 900, expansionAllowed: false, newRemoteOpsAllowed: true },
        expansion: { state: "pioneering", target: "W37S55", sponsor: "W37S58", startedAt: 100 },
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W37S58: { controller: { my: true, owner: { username: "Me" }, level: 7 } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    // 旧版 pioneering 无对应分支（静默穿透）— 必须被入口防护清理。
    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
  });

  it("未知 state（非旧版枚举）同样被清理", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W37S58: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "develop", since: 900, expansionAllowed: false, newRemoteOpsAllowed: true },
        expansion: { state: "some_future_state", target: "W36S58", sponsor: "W37S58", startedAt: 100 },
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W37S58: { controller: { my: true, owner: { username: "Me" }, level: 7 } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.expansion).toBeUndefined();
  });

  it("合法状态不受入口防护影响（preparing 正常推进）", () => {
    const tick = (globalThis as any).Game.time;
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: { W37S58: { spawnQueue: [], buildQueue: [] } },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        expansion: { state: "preparing", target: "W36S58", sponsor: "W37S58", startedAt: tick },
      },
    };
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W37S58: { controller: { my: true, owner: { username: "Me" }, level: 7 } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu = { bucket: 10000 };
    (globalThis as any).Game.creeps = {};

    expansionManagerSystem.run(makeContext());

    // preparing 是状态机合法分支 — 记录必须存活（由状态机自身逻辑推进）。
    expect((globalThis as any).Memory.kernel.expansion).toBeDefined();
  });
});
