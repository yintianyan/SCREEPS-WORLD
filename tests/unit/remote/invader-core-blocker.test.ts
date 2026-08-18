/**
 * InvaderCore 压制止损链接线测试。
 *
 * 背景：InvaderCore 是敌对结构而非 creep — FIND_HOSTILE_CREEPS 检测不到，
 * 旧实现对「房里只有一个核心、没有 Invader creep」完全漏报：
 * 运营继续送 harvester（source 被压在 1500 容量）、reserver 空耗
 * （attackController -1/次磨不过核心 +2/tick 续期）、威胁层不写危险冷却。
 *
 * 止损链（P1 升级）：
 *   - 大要塞（level≥1 或带守卫）→ 维持 blockedUntil + recycle 规避 + dangerUntil，等自然 decay；
 *   - 次级核心（level 0、无守卫）→ 标 needCoreClear 驱动孵 coreClearer 拆核回收 op 名额，
 *     不阻塞运营（核心清除后 demand 立即恢复），经济 creep 仍回收（无法采集）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateRemoteDemand, type RemoteCreepSummary } from "../../../src/domain/remote/demand";
import {
  remoteMiningManagerSystem,
  collectRemoteBlockers,
  classifyInvaderCores,
} from "../../../src/systems/remote-mining-manager";
import { roomHasInvaderCore } from "../../../src/creeps/roles/reserver";
import type { ColonyState } from "../../../src/kernel/contracts";
import { mockContext, mockCreep, mockSnapshot, resetGlobals } from "../../role-helpers";

const tick = 100000;
const homeRoom = "W1N1";
const targetRoom = "W2N1";

const baseInput = {
  homeRoom,
  colonyState: "normal" as ColonyState,
  energyCapacityAvailable: 800,
  tick,
  remoteOps: {
    [targetRoom]: { state: "active", sources: 2, createdAt: tick - 1000, lastSeen: tick },
  },
  remoteCreeps: [] as RemoteCreepSummary[],
  spawnQueue: [] as SpawnRequest[],
};

/** 按 find 常量分发的远矿房 mock：仅 FIND_HOSTILE_STRUCTURES 返回核心（level 可选）。 */
function makeCoreRoom(name: string, opts: { level?: number; hostiles?: boolean } = {}) {
  const level = opts.level ?? 1;
  const find = vi.fn((type: number) => {
    if (type === FIND_HOSTILE_STRUCTURES) {
      return [{ structureType: "invaderCore", hits: 100000, level, pos: { x: 25, y: 25 } }];
    }
    if (type === FIND_HOSTILE_CREEPS) {
      return opts.hostiles ? [{ name: "inv", owner: { username: "Invader" }, pos: { x: 1, y: 1 } }] : [];
    }
    return [];
  });
  return { name, find };
}

beforeEach(() => {
  resetGlobals();
});

describe("remote demand — blockedRooms 止损（大要塞压制）", () => {
  it("压制房暂停一切孵化（含 defender — 打不动不送死）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteThreats: { [targetRoom]: true }, // 即使同时报告 creep 威胁
      blockedRooms: new Set([targetRoom]),
    });
    expect(requests).toHaveLength(0);
  });

  it("非压制房不受影响（正常孵化 harvester/hauler/reserver）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      blockedRooms: new Set(["W9N9"]),
    });
    expect(requests.map((r) => r.role)).toEqual(
      expect.arrayContaining(["remoteHarvester", "remoteHauler", "reserver"]),
    );
  });

  it("压制解除（集合为空）后孵化自动恢复", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      blockedRooms: new Set(),
    });
    expect(requests.length).toBeGreaterThan(0);
  });
});

describe("remote-mining-manager — collectRemoteBlockers 检测（按核心等级二分）", () => {
  it("level-1 核心（大要塞）识别为 stronghold", () => {
    (globalThis as any).Game.rooms = { [targetRoom]: makeCoreRoom(targetRoom, { level: 1 }) };
    const blockers = collectRemoteBlockers({
      [targetRoom]: { state: "active", createdAt: tick, lastSeen: tick },
    });
    expect(blockers[targetRoom]).toEqual({ kind: "stronghold" });
  });

  it("level-0 无守卫核心识别为 lesser（可拆）", () => {
    (globalThis as any).Game.rooms = { [targetRoom]: makeCoreRoom(targetRoom, { level: 0 }) };
    const blockers = collectRemoteBlockers({
      [targetRoom]: { state: "active", createdAt: tick, lastSeen: tick },
    });
    expect(blockers[targetRoom]).toEqual({ kind: "lesser" });
  });

  it("带守卫 creep 的 level-0 核心仍判 stronghold（保守规避，不送无治疗 clearer）", () => {
    (globalThis as any).Game.rooms = { [targetRoom]: makeCoreRoom(targetRoom, { level: 0, hostiles: true }) };
    const blockers = collectRemoteBlockers({
      [targetRoom]: { state: "active", createdAt: tick, lastSeen: tick },
    });
    expect(blockers[targetRoom]).toEqual({ kind: "stronghold" });
  });

  it("无视野的房不误报；非 active 运营跳过", () => {
    (globalThis as any).Game.rooms = {};
    const blockers = collectRemoteBlockers({
      [targetRoom]: { state: "active", createdAt: tick, lastSeen: tick },
      W9N9: { state: "paused", createdAt: tick, lastSeen: tick },
    });
    expect(blockers[targetRoom]).toEqual({ kind: "unknown" });
    expect(blockers.W9N9).toBeUndefined();
  });
});

describe("remote-mining-manager — 压制房止损接线（run 级副作用，大要塞）", () => {
  it("检测核心 → 写 dangerUntil + 回收现役 creep + 不生成该房孵化请求", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;

    // 远矿房：大要塞（level 1，无守卫 creep），维持旧 block 行为。
    g.Game.rooms[targetRoom] = makeCoreRoom(targetRoom, { level: 1 });

    // 现役远矿 creep（home=W7N4 与 mockSnapshot 对齐）。
    const harvester = mockCreep({ name: "rh1", role: "remoteHarvester", home: "W7N4" });
    harvester.memory.remoteTarget = targetRoom;
    g.Game.creeps = { rh1: harvester };

    g.Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [targetRoom]: { state: "active", createdAt: now - 500, lastSeen: now },
      },
      intel: {
        [targetRoom]: { kind: "normal", status: "normal", lastSeen: now },
      },
    };

    const snapshot = mockSnapshot({ rcl: 5, spawns: [{} as never] });
    remoteMiningManagerSystem.run(mockContext(snapshot));

    const roomMem = g.Memory.rooms.W7N4;
    // 危险冷却已写入（P1-G：迁至 remoteOps）— 冷却期内不作为新远矿/扩张候选。
    expect(roomMem.remoteOps[targetRoom].dangerUntil).toBeGreaterThan(now);
    // 现役 creep 被标记回收 — 不再空耗。
    expect(harvester.memory.recycle).toBe(true);
    // 孵化冻结 — 队列中无任何指向压制房的请求。
    const remoteReqs = (roomMem.spawnQueue as SpawnRequest[]).filter(
      r => r.memory.remoteTarget === targetRoom,
    );
    expect(remoteReqs).toHaveLength(0);
  });
});

describe("remote-mining-manager — 次级核心(lesser)清核接线", () => {
  it("检测 level-0 核心 → 标 needCoreClear + 回收经济 creep + 不写 dangerUntil + 孵 coreClearer", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;

    g.Game.rooms[targetRoom] = makeCoreRoom(targetRoom, { level: 0 }); // 次级核心，无守卫

    const harvester = mockCreep({ name: "rh1", role: "remoteHarvester", home: "W7N4" });
    harvester.memory.remoteTarget = targetRoom;
    g.Game.creeps = { rh1: harvester };

    g.Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [targetRoom]: { state: "active", createdAt: now - 500, lastSeen: now },
      },
      intel: {
        [targetRoom]: { kind: "normal", status: "normal", lastSeen: now },
      },
    };

    const snapshot = mockSnapshot({ rcl: 5, spawns: [{} as never] });
    remoteMiningManagerSystem.run(mockContext(snapshot));

    const roomMem = g.Memory.rooms.W7N4;
    // lesser 核心：标 needCoreClear 驱动孵 clearer，不阻塞（不写 dangerUntil）。
    expect(roomMem.remoteOps[targetRoom].needCoreClear).toBe(true);
    expect(roomMem.remoteOps[targetRoom].dangerUntil).toBeUndefined();
    // 经济 creep 仍回收（核心压制 source，无法采集）。
    expect(harvester.memory.recycle).toBe(true);
    // demand 孵出 coreClearer（不孵经济 creep）。
    const clearerReqs = (roomMem.spawnQueue as SpawnRequest[]).filter(
      r => r.role === "coreClearer" && r.memory.remoteTarget === targetRoom,
    );
    expect(clearerReqs).toHaveLength(1);
  });

  it("核心清除（视野确认消失）→ needCoreClear 清除、孵化恢复", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    // 有视野且无核心。
    g.Game.rooms[targetRoom] = { name: targetRoom, find: vi.fn(() => []) };
    g.Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        [targetRoom]: { state: "active", sources: 2, createdAt: now - 500, lastSeen: now, needCoreClear: true },
      },
      intel: { [targetRoom]: { kind: "normal", status: "normal", lastSeen: now } },
    };
    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));
    const roomMem = g.Memory.rooms.W7N4;
    expect(roomMem.remoteOps[targetRoom].needCoreClear).toBeUndefined();
    const remoteReqs = (roomMem.spawnQueue as SpawnRequest[]).filter(
      r => r.memory.remoteTarget === targetRoom,
    );
    expect(remoteReqs.length).toBeGreaterThan(0); // 经济孵恢复
  });
});

describe("reserver — roomHasInvaderCore 兜底自检", () => {
  it("检测核心并按 tick 缓存（同房同 tick 只 find 一次）", () => {
    const room = makeCoreRoom(targetRoom);
    expect(roomHasInvaderCore(room as unknown as Room)).toBe(true);
    expect(roomHasInvaderCore(room as unknown as Room)).toBe(true);
    expect(room.find).toHaveBeenCalledTimes(1);
  });

  it("无核心的房返回 false", () => {
    const find = vi.fn(() => []);
    const room = { name: "W3N1", find };
    expect(roomHasInvaderCore(room as unknown as Room)).toBe(false);
  });
});

describe("remote-mining-manager — 压制状态持久化（防失明解封死循环，大要塞）", () => {
  /** 构造带 remoteOps 的 home 房 Memory，返回 roomMem 引用。 */
  function setupHome(op: Record<string, unknown>) {
    const g = globalThis as any;
    g.Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: { [targetRoom]: op },
      intel: { [targetRoom]: { kind: "normal", status: "normal", lastSeen: g.Game.time } },
    };
    return g.Memory.rooms.W7N4;
  }

  it("有视野发现核心 → 写入 blockedUntil 冷却", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    g.Game.rooms[targetRoom] = makeCoreRoom(targetRoom, { level: 1 });
    const roomMem = setupHome({ state: "active", createdAt: now - 500, lastSeen: now });

    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    expect(roomMem.remoteOps[targetRoom].blockedUntil).toBeGreaterThan(now);
  });

  it("失明期间（无视野 + 冷却未到期）孵化保持冻结 — 旧实现的死循环场景", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    // 无视野：Game.rooms 不含目标房（creep 已被回收撤离）。
    const roomMem = setupHome({
      state: "active", createdAt: now - 500, lastSeen: now - 100,
      blockedUntil: now + 3000, // 冷却未到期
    });

    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    // 孵化仍冻结 — 队列中无任何指向压制房的请求。
    const remoteReqs = (roomMem.spawnQueue as SpawnRequest[]).filter(
      r => r.memory.remoteTarget === targetRoom,
    );
    expect(remoteReqs).toHaveLength(0);
    // 冷却保留（无视野不清除）。
    expect(roomMem.remoteOps[targetRoom].blockedUntil).toBe(now + 3000);
  });

  it("有视野确认核心消失 → 立即清除冷却，孵化恢复", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    // 有视野且无核心。
    g.Game.rooms[targetRoom] = { name: targetRoom, find: vi.fn(() => []) };
    const roomMem = setupHome({
      state: "active", sources: 2, createdAt: now - 500, lastSeen: now,
      blockedUntil: now + 3000,
    });

    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    expect(roomMem.remoteOps[targetRoom].blockedUntil).toBeUndefined();
    // 孵化恢复。
    const remoteReqs = (roomMem.spawnQueue as SpawnRequest[]).filter(
      r => r.memory.remoteTarget === targetRoom,
    );
    expect(remoteReqs.length).toBeGreaterThan(0);
  });

  it("冷却到期 + 无视野 → 解封（恢复孵化以重获视野再评估）", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    const roomMem = setupHome({
      state: "active", sources: 2, createdAt: now - 8000, lastSeen: now - 100,
      blockedUntil: now - 1, // 已到期
    });

    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    expect(roomMem.remoteOps[targetRoom].blockedUntil).toBeUndefined();
    const remoteReqs = (roomMem.spawnQueue as SpawnRequest[]).filter(
      r => r.memory.remoteTarget === targetRoom,
    );
    expect(remoteReqs.length).toBeGreaterThan(0);
  });
});

describe("classifyInvaderCores — 纯函数（核心等级二分）", () => {
  it("level 1 核心 → stronghold（大要塞，规避）", () => {
    expect(classifyInvaderCores({ cores: [{ level: 1 }], hostileCreepCount: 0 })).toBe("stronghold");
  });
  it("level 0 无守卫核心 → lesser（可派 clearer 拆）", () => {
    expect(classifyInvaderCores({ cores: [{ level: 0 }], hostileCreepCount: 0 })).toBe("lesser");
  });
  it("level 0 但带守卫 creep → stronghold（保守规避）", () => {
    expect(classifyInvaderCores({ cores: [{ level: 0 }], hostileCreepCount: 2 })).toBe("stronghold");
  });
  it("level 缺失保守判 stronghold（不送无治疗 creep 进未知险境）", () => {
    expect(classifyInvaderCores({ cores: [{}], hostileCreepCount: 0 })).toBe("stronghold");
  });
});

describe("remote demand — clearRooms 次级核心清核", () => {
  it("次级核心房只孵 coreClearer，不孵经济 creep", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      clearRooms: new Set([targetRoom]),
    });
    expect(requests.map((r) => r.role)).toEqual(["coreClearer"]);
  });

  it("已有 coreClearer 在场则不重复孵（单只节流）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      clearRooms: new Set([targetRoom]),
      remoteCreeps: [{ name: "cc1", role: "coreClearer", remoteTarget: targetRoom, ticksToLive: 1000, bodyLength: 10 }],
    });
    expect(requests.filter((r) => r.role === "coreClearer")).toHaveLength(0);
  });

  it("clearRooms 与 blockedRooms 互斥：clearRooms 房不冻结经济（只走清核分支）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      clearRooms: new Set([targetRoom]),
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.role).toBe("coreClearer");
  });
});
