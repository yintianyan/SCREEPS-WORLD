/** D-FINDING-04: 多房远矿同时失守级联故障测试 — 验证多 remoteOps 同时失效时系统不崩溃。 */
import { beforeEach, describe, expect, it } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockContext, mockSnapshot, resetGlobals, syncSquadIndex } from "../../support/factories";
import type { RoomSnapshot } from "../../../src/kernel/contracts";

const homeRoom1 = "W1N1";
const homeRoom2 = "W3N3";
const target1 = "W2N2";
const target2 = "W4N4";
const target3 = "W5N5";

interface RemoteOp {
  state: string;
  sources: number;
  haulerNeed: number;
  createdAt: number;
  lastSeen: number;
  [key: string]: unknown;
}

function activeOp(opts: Partial<RemoteOp> = {}): RemoteOp {
  const tick = (globalThis as any).Game.time as number;
  return {
    state: "active",
    sources: 1,
    haulerNeed: 1,
    createdAt: 0,
    lastSeen: tick,
    ...opts,
  };
}

function pausedOp(opts: Partial<RemoteOp> = {}): RemoteOp {
  const tick = (globalThis as any).Game.time as number;
  return {
    state: "paused",
    sources: 1,
    haulerNeed: 0,
    createdAt: 0,
    lastSeen: tick - 500,
    ...opts,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("D-FINDING-04: 多房远矿同时失守级联故障", () => {
  it("两个主房各有远矿目标同时失守 — 不崩溃，remoteOps 不交叉污染", () => {
    const g = globalThis as any;
    g.Game.time = 2000;
    g.Game.rooms = {};
    g.Game.creeps = {};
    syncSquadIndex();

    // 两个主房各有 2 个远矿目标，全部 active
    g.Memory.rooms[homeRoom1] = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [target1]: activeOp(),
        [target2]: activeOp(),
      },
    };
    g.Memory.rooms[homeRoom2] = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [target3]: activeOp(),
      },
    };

    // 播种 intel
    __resetIntelStateForTests();
    globalCache().intelHandoff = [
      { subject: target1, home: homeRoom1, source: "observer" as const, payload: { kind: "normal", status: "normal", lastSeen: 1000, pathCost: 60 } as never },
      { subject: target2, home: homeRoom1, source: "observer" as const, payload: { kind: "normal", status: "normal", lastSeen: 1000, pathCost: 60 } as never },
      { subject: target3, home: homeRoom2, source: "observer" as const, payload: { kind: "normal", status: "normal", lastSeen: 1000, pathCost: 60 } as never },
    ];
    intelligenceSystem.run({ tick: 2000, snapshots: () => [], budget: { canStart: () => true } } as never);

    const snap1 = mockSnapshot({ roomName: homeRoom1, rcl: 6, spawns: [{} as never], energyCapacityAvailable: 1300 });
    const snap2 = mockSnapshot({ roomName: homeRoom2, rcl: 6, spawns: [{} as never], energyCapacityAvailable: 1300 });

    // 运行两个房间的 remote-mining-manager
    const ctx = mockContext();
    (ctx as any).snapshots = () => [snap1, snap2];
    expect(() => remoteMiningManagerSystem.run(ctx)).not.toThrow();

    // 验证 remoteOps 不交叉污染
    const ops1 = g.Memory.rooms[homeRoom1].remoteOps;
    const ops2 = g.Memory.rooms[homeRoom2].remoteOps;
    expect(target1 in ops1).toBe(true);
    expect(target2 in ops1).toBe(true);
    expect(target3 in ops2).toBe(true);
    expect(target3 in ops1).toBe(false);
    expect(target1 in ops2).toBe(false);
  });

  it("主房失守（lostRooms grace）后 remoteOps 不被另一个主房的 remote-mining-manager 访问", () => {
    const g = globalThis as any;
    g.Game.time = 3000;
    g.Game.rooms = {};
    g.Game.creeps = {};
    syncSquadIndex();

    // homeRoom1 已失守（colonyState=recovery），但 remoteOps 仍在 Memory 中
    g.Memory.rooms[homeRoom1] = {
      colonyState: "recovery",
      spawnQueue: [],
      remoteOps: {
        [target1]: activeOp(),
      },
    };
    // homeRoom2 仍正常运营
    g.Memory.rooms[homeRoom2] = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [target3]: activeOp(),
      },
    };

    __resetIntelStateForTests();
    globalCache().intelHandoff = [
      { subject: target3, home: homeRoom2, source: "observer" as const, payload: { kind: "normal", status: "normal", lastSeen: 1000, pathCost: 60 } as never },
    ];
    intelligenceSystem.run({ tick: 3000, snapshots: () => [], budget: { canStart: () => true } } as never);

    // 只有 homeRoom2 是自有房（snapshots 只包含 controller.my）
    const snap2 = mockSnapshot({ roomName: homeRoom2, rcl: 6, spawns: [{} as never], energyCapacityAvailable: 1300 });

    expect(() => remoteMiningManagerSystem.run(mockContext(snap2))).not.toThrow();

    // homeRoom1 的 remoteOps 不被修改（不在 snapshots 中）
    expect(g.Memory.rooms[homeRoom1].remoteOps[target1].state).toBe("active");
  });

  it("所有远矿目标同时被入侵者占领 — 系统正确暂停/不崩溃", () => {
    const g = globalThis as any;
    g.Game.time = 4000;
    g.Game.creeps = {};
    syncSquadIndex();

    // 模拟远矿房有敌方
    g.Game.rooms = {
      [target1]: {
        name: target1,
        controller: { my: false, owner: { username: "Invader" } },
        find: () => [],
      },
      [target2]: {
        name: target2,
        controller: { my: false, owner: { username: "Invader" } },
        find: () => [],
      },
    };

    g.Memory.rooms[homeRoom1] = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [target1]: activeOp(),
        [target2]: activeOp(),
      },
    };

    __resetIntelStateForTests();
    globalCache().intelHandoff = [
      { subject: target1, home: homeRoom1, source: "observer" as const, payload: { kind: "hostile", status: "hostile", lastSeen: 1000, pathCost: 60 } as never },
      { subject: target2, home: homeRoom1, source: "observer" as const, payload: { kind: "hostile", status: "hostile", lastSeen: 1000, pathCost: 60 } as never },
    ];
    intelligenceSystem.run({ tick: 4000, snapshots: () => [], budget: { canStart: () => true } } as never);

    const snap = mockSnapshot({ roomName: homeRoom1, rcl: 6, spawns: [{} as never], energyCapacityAvailable: 1300 });

    // 系统不应崩溃
    expect(() => remoteMiningManagerSystem.run(mockContext(snap))).not.toThrow();

    // remoteOps 应仍存在（不丢失数据）
    const ops = g.Memory.rooms[homeRoom1].remoteOps;
    expect(target1 in ops).toBe(true);
    expect(target2 in ops).toBe(true);
  });

  it("多房远矿全部暂停后主房 spawn queue 不被远矿请求阻塞", () => {
    const g = globalThis as any;
    g.Game.time = 5000;
    g.Game.rooms = {};
    g.Game.creeps = {};
    syncSquadIndex();

    g.Memory.rooms[homeRoom1] = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [target1]: pausedOp(),
        [target2]: pausedOp(),
      },
    };

    const snap = mockSnapshot({ roomName: homeRoom1, rcl: 6, spawns: [{} as never], energyCapacityAvailable: 1300 });

    remoteMiningManagerSystem.run(mockContext(snap));

    // 暂停的远矿不应产生 spawn 请求
    const queue = g.Memory.rooms[homeRoom1].spawnQueue;
    const remoteReqs = queue.filter((r: any) => typeof r.role === "string" && r.role.startsWith("remote"));
    expect(remoteReqs.length).toBe(0);
  });
});
