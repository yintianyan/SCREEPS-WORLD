/** 止损链场景测试（Batch 3 — 病理③「止损豁免缺失」修复回归）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { expansionManagerSystem } from "../../../src/systems/expansion-manager";
import { evaluateRemoteDemand } from "../../../src/domain/remote/demand";
import { evaluateDemand } from "../../../src/domain/spawn/demand";
import { defenderRole } from "../../../src/creeps/roles/defender";
import { remoteDefenderRole } from "../../../src/creeps/roles/remote-defender";
import {
  mockBudget,
  mockContext,
  mockCreep,
  mockHostile,
  mockSnapshot,
  resetGlobals,
  syncSquadIndex,
} from "../../role-helpers";

const g = (): any => globalThis as any;

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

// ─── RM-2：威胁失明持久化 ─────────────────────────────────────

describe("RM-2 — 远矿威胁失明持久化（threatUntil 双轨）", () => {
  const target = "W8N4";

  function setupHome(): void {
    g().Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: { [target]: { state: "active", createdAt: 0, lastSeen: g().Game.time } },
      intel: { [target]: { kind: "normal", status: "normal", lastSeen: g().Game.time } },
    };
  }

  function armedHostileRoom(): void {
    g().Game.rooms[target] = {
      name: target,
      find: vi.fn((type: number, opts?: any) => {
        if (type === FIND_HOSTILE_CREEPS) {
          const hostiles = [{
            owner: { username: "enemy" },
            body: [{ type: "attack" }, { type: "move" }],
            pos: { x: 25, y: 25 },
          }];
          return opts?.filter ? hostiles.filter(opts.filter) : hostiles;
        }
        return [];
      }),
    };
  }

  function run(): void {
    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));
  }

  it("有视野威胁：写 threatUntil + 冻结经济孵化 + 孵 defender", () => {
    setupHome();
    armedHostileRoom();

    run();

    const op = g().Memory.rooms.W7N4.remoteOps[target];
    expect(op.threatUntil).toBe(g().Game.time + 300); // threatBlindHold（审查修正后的短窗口）
    const roles = (g().Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).toContain("remoteDefender");
    expect(roles).not.toContain("remoteHarvester");
    expect(roles).not.toContain("remoteHauler");
  });

  it("失明期（无视野 + 冷却未到期）：经济孵化维持冻结 — 不再循环送兵", () => {
    setupHome();
    g().Memory.rooms.W7N4.remoteOps[target].threatUntil = g().Game.time + 1500;
    delete g().Game.rooms[target]; // 失明

    run();

    const roles = (g().Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).not.toContain("remoteHarvester");
    // 冷却保留（未到期）。
    expect(g().Memory.rooms.W7N4.remoteOps[target].threatUntil).toBeDefined();
  });

  it("有视野确认清空：立即解除冷却，经济孵化恢复", () => {
    setupHome();
    g().Memory.rooms.W7N4.remoteOps[target].threatUntil = g().Game.time + 1500;
    g().Game.rooms[target] = {
      name: target,
      controller: { owner: undefined },
      find: vi.fn(() => []),
    };

    run();

    expect(g().Memory.rooms.W7N4.remoteOps[target].threatUntil).toBeUndefined();
    const roles = (g().Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).toContain("remoteHarvester");
  });
});

// ─── RM-3：被自己 claim 的远矿房 ─────────────────────────────

describe("RM-3 — 远矿房被自己 claim 后运营关停", () => {
  it("controller.my → 运营废弃 + 现役远矿 creep 标记回收", () => {
    const target = "W8N4";
    g().Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: { [target]: { state: "active", createdAt: 0, lastSeen: g().Game.time } },
    };
    g().Game.rooms[target] = {
      name: target,
      controller: { owner: { username: "me" }, my: true },
      find: vi.fn(() => []),
    };
    g().Game.creeps.rh_1 = {
      name: "rh_1",
      body: [{ type: "work" }, { type: "move" }],
      ticksToLive: 800,
      memory: { role: "remoteHarvester", home: "W7N4", remoteTarget: target },
    };
    syncSquadIndex();

    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    expect(g().Memory.rooms.W7N4.remoteOps[target].state).toBe("abandoned");
    expect(g().Game.creeps.rh_1.memory.recycle).toBe(true);
  });
});

// ─── RM-2 纯函数：威胁暂停经济孵化 ────────────────────────────

describe("evaluateRemoteDemand — 威胁在场暂停经济孵化", () => {
  const base = {
    homeRoom: "W7N4",
    colonyState: "normal" as const,
    energyCapacityAvailable: 800,
    tick: 1000,
    remoteOps: { W8N4: { state: "active", lastSeen: 1000 } },
    remoteCreeps: [],
    spawnQueue: [],
  };

  it("hasThreats：仅 defender，无 harvester/hauler/reserver", () => {
    const { requests } = evaluateRemoteDemand({ ...base, remoteThreats: { W8N4: true } });
    const roles = requests.map(r => r.role);
    expect(roles).toContain("remoteDefender");
    expect(roles).not.toContain("remoteHarvester");
    expect(roles).not.toContain("remoteHauler");
    expect(roles).not.toContain("reserver");
  });

  it("无威胁：经济孵化照常（回归保护）", () => {
    const { requests } = evaluateRemoteDemand({ ...base, remoteThreats: { W8N4: false } });
    const roles = requests.map(r => r.role);
    expect(roles).toContain("remoteHarvester");
    expect(roles).not.toContain("remoteDefender");
  });
});

// ─── DF-1：defender 追击边界 ─────────────────────────────────

describe("DF-1 — defender 追击边界", () => {
  it("威胁贴出口（边界 1 格内）时不追击 — 交给塔", () => {
    const edgeHostile = mockHostile("edge");
    edgeHostile.pos = { ...edgeHostile.pos, x: 0, y: 25 };
    const snap = mockSnapshot({ threatCreeps: [edgeHostile] });
    const creep = mockCreep({ name: "def_1", role: "defender" });

    defenderRole.run(creep, mockContext(snap));

    expect(creep.attack).not.toHaveBeenCalled();
  });

  it("内场威胁照常接敌", () => {
    const hostile = mockHostile("inner");
    hostile.pos = { ...hostile.pos, x: 25, y: 25 };
    const snap = mockSnapshot({ threatCreeps: [hostile] });
    const creep = mockCreep({ name: "def_1", role: "defender" });

    defenderRole.run(creep, mockContext(snap));

    expect(creep.attack).toHaveBeenCalledWith(hostile);
  });

  it("defender 被弹出 home 房时不接敌（ensureHome 接管导航）", () => {
    const hostile = mockHostile("inner");
    hostile.pos = { ...hostile.pos, x: 25, y: 25 };
    const snap = mockSnapshot({ threatCreeps: [hostile] });
    const creep = mockCreep({ name: "def_1", role: "defender", home: "W7N4" });
    creep.room.name = "W6N4"; // 异房

    defenderRole.run(creep, mockContext(snap));

    expect(creep.attack).not.toHaveBeenCalled();
  });
});

// ─── RD-1：remote-defender 血量护栏 ──────────────────────────

describe("RD-1 — remote-defender 半血撤退", () => {
  it("hits < 50% → 标记 recycle 且不再接敌", () => {
    const creep = mockCreep({ name: "rd_1", role: "remoteDefender", home: "W7N4" });
    creep.memory.remoteTarget = "W8N4";
    creep.room.name = "W8N4";
    creep.hits = 400;
    creep.hitsMax = 1000;
    creep.room.find = vi.fn(() => [{ owner: { username: "enemy" }, pos: { x: 25, y: 25 } }]);
    const snap = mockSnapshot();

    remoteDefenderRole.run(creep, mockContext(snap));

    expect(creep.memory.recycle).toBe(true);
    expect(creep.attack).not.toHaveBeenCalled();
  });

  it("血量健康时照常接敌（回归保护）", () => {
    const hostile = { owner: { username: "enemy" }, pos: { x: 25, y: 25 } };
    const creep = mockCreep({ name: "rd_1", role: "remoteDefender", home: "W7N4" });
    creep.memory.remoteTarget = "W8N4";
    creep.room.name = "W8N4";
    creep.hits = 1000;
    creep.hitsMax = 1000;
    creep.room.find = vi.fn((_t: number, opts?: any) =>
      opts?.filter ? [hostile].filter(opts.filter) : [hostile]);
    creep.pos.findClosestByRange = vi.fn(() => hostile);
    const snap = mockSnapshot();

    remoteDefenderRole.run(creep, mockContext(snap));

    expect(creep.attack).toHaveBeenCalledWith(hostile);
  });
});

// ─── W-3：P0 团灭恢复的 defense 态感知 ───────────────────────

describe("W-3 — P0 恢复在威胁在场时先孵 defender", () => {
  const ctx = { colonyState: "defense" as const, controllerDowngradeRisk: false, energyAvailable: 300, economyPressure: 0 };

  it("团灭 + 威胁在场：P0 defender 先于 P0 worker 入队", () => {
    const hostile = mockHostile();
    const snap = mockSnapshot({ threatCreeps: [hostile] });
    const { requests } = evaluateDemand(snap, [], "defense", [], [], ctx, 1000);

    expect(requests).toHaveLength(2);
    expect(requests[0]!.role).toBe("defender");
    expect(requests[0]!.priority).toBe(0);
    expect(requests[1]!.role).toBe("worker");
    expect(requests[1]!.priority).toBe(0);
  });

  it("团灭无威胁：只孵 P0 worker（原行为不回归）", () => {
    const snap = mockSnapshot({ threatCreeps: [] });
    const { requests } = evaluateDemand(snap, [], "recovery", [], [], { ...ctx, colonyState: "recovery" }, 1000);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.role).toBe("worker");
  });
});

// ─── C-1/C-2：expansion 状态机止损 ───────────────────────────

describe("C-1/C-2 — expansion 状态机止损豁免", () => {
  it("C-1：conserve tier 下 pioneering 超时判定仍然运行（状态机不被门禁冻结）", () => {
    g().Game.time = 30000;
    g().Memory.kernel = {
      expansion: { state: "bootstrapping", target: "W9N9", sponsor: "W7N4", startedAt: 1, checkpointsPassed: 0, reservedEnergy: 0, consecutivePositiveTicks: 0 },
    };
    g().Memory.rooms.W7N4 = { spawnQueue: [] };
    g().Game.rooms.W9N9 = {
      name: "W9N9",
      controller: { my: true },
      find: vi.fn(() => []), // 无 spawn 无敌人 → 走超时分支
    };

    // 修复前：conserve 在函数入口 return → expansion 永久残留。
    expansionManagerSystem.run(mockContext(mockSnapshot(), mockBudget("conserve")));

    expect(g().Memory.kernel.expansion).toBeUndefined();
  });

  it("C-2：拓荒编队全灭 + 威胁在场 → 放弃 + 黑名单冷却", () => {
    g().Game.time = 5000;
    g().Memory.kernel = {
      expansion: { state: "bootstrapping", target: "W9N9", sponsor: "W7N4", startedAt: 4900, checkpointsPassed: 0, reservedEnergy: 0, consecutivePositiveTicks: 0 },
    };
    g().Memory.rooms.W7N4 = { spawnQueue: [] };
    g().Game.rooms.W9N9 = {
      name: "W9N9",
      controller: { my: true },
      find: vi.fn((type: number, opts?: any) => {
        if (type === FIND_HOSTILE_CREEPS) {
          const hostiles = [{
            owner: { username: "enemy" },
            body: [{ type: "attack" }],
            pos: { x: 20, y: 20 },
          }];
          return opts?.filter ? hostiles.filter(opts.filter) : hostiles;
        }
        return []; // 无 spawn
      }),
    };
    // Game.creeps 空 = 编队已全灭。

    expansionManagerSystem.run(mockContext(mockSnapshot(), mockBudget("healthy")));

    expect(g().Memory.kernel.expansion).toBeUndefined();
    expect(g().Memory.kernel.expansionBlacklist?.W9N9).toBeGreaterThan(5000);
  });

  it("C-2：威胁在场但编队存活 → 暂停补充不放弃（过境骚扰可恢复）", () => {
    g().Game.time = 5000;
    g().Memory.kernel = {
      expansion: { state: "bootstrapping", target: "W9N9", sponsor: "W7N4", startedAt: 4900, checkpointsPassed: 0, reservedEnergy: 0, consecutivePositiveTicks: 0 },
    };
    g().Memory.rooms.W7N4 = { spawnQueue: [] };
    g().Game.rooms.W9N9 = {
      name: "W9N9",
      controller: { my: true },
      find: vi.fn((type: number, opts?: any) => {
        if (type === FIND_HOSTILE_CREEPS) {
          const hostiles = [{
            owner: { username: "enemy" },
            body: [{ type: "attack" }],
            pos: { x: 20, y: 20 },
          }];
          return opts?.filter ? hostiles.filter(opts.filter) : hostiles;
        }
        return [];
      }),
    };
    g().Game.creeps.pioneer_1 = {
      name: "pioneer_1",
      memory: { role: "worker", home: "W9N9" },
    };
    syncSquadIndex();

    expansionManagerSystem.run(mockContext(mockSnapshot(), mockBudget("healthy")));

    // 行动保留（不放弃），但不提交新的拓荒请求。
    expect(g().Memory.kernel.expansion).toBeDefined();
    expect(g().Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
  });
});
