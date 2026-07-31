/**
 * InvaderCore 压制止损链接线测试。
 *
 * 背景：InvaderCore 是敌对结构而非 creep — FIND_HOSTILE_CREEPS 检测不到，
 * 旧实现对「房里只有一个核心、没有 Invader creep」完全漏报：
 * 运营继续送 harvester（source 被压在 1500 容量）、reserver 空耗
 * （attackController -1/次磨不过核心 +2/tick 续期）、威胁层不写危险冷却。
 *
 * 止损链：检测核心 → dangerUntil 冷却 + 暂停该房全部孵化（含 defender，
 * 100k hits 打不动不送死）+ 回收现役 creep → 核心 decay 后自动恢复。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateRemoteDemand, type RemoteCreepSummary } from "../../../src/domain/remote/demand";
import {
  remoteMiningManagerSystem,
  collectRemoteBlockers,
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

const invaderCore = { structureType: "invaderCore", hits: 100000, pos: { x: 25, y: 25 } };

/** 按 find 常量分发的远矿房 mock：仅 FIND_HOSTILE_STRUCTURES 返回核心。 */
function makeBlockedRoom(name: string) {
  const find = vi.fn((type: number) =>
    type === FIND_HOSTILE_STRUCTURES ? [invaderCore] : [],
  );
  return { name, find };
}

beforeEach(() => {
  resetGlobals();
});

describe("remote demand — blockedRooms 止损（InvaderCore 压制）", () => {
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
    expect(requests.map(r => r.role)).toEqual(
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

describe("remote-mining-manager — collectRemoteBlockers 检测", () => {
  it("仅 InvaderCore 无敌对 creep 的房被识别为压制（旧实现的漏报场景）", () => {
    (globalThis as any).Game.rooms = { [targetRoom]: makeBlockedRoom(targetRoom) };
    const blockers = collectRemoteBlockers({
      [targetRoom]: { state: "active", createdAt: tick, lastSeen: tick },
    });
    expect(blockers[targetRoom]).toBe(true);
  });

  it("无视野的房不误报；非 active 运营跳过", () => {
    (globalThis as any).Game.rooms = {};
    const blockers = collectRemoteBlockers({
      [targetRoom]: { state: "active", createdAt: tick, lastSeen: tick },
      W9N9: { state: "paused", createdAt: tick, lastSeen: tick },
    });
    expect(blockers[targetRoom]).toBeUndefined();
    expect(blockers.W9N9).toBeUndefined();
  });
});

describe("remote-mining-manager — 压制房止损接线（run 级副作用）", () => {
  it("检测核心 → 写 dangerUntil + 回收现役 creep + 不生成该房孵化请求", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;

    // 远矿房：只有 InvaderCore，无敌对 creep。
    g.Game.rooms[targetRoom] = makeBlockedRoom(targetRoom);

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

describe("reserver — roomHasInvaderCore 兜底自检", () => {
  it("检测核心并按 tick 缓存（同房同 tick 只 find 一次）", () => {
    const room = makeBlockedRoom(targetRoom);
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

describe("remote-mining-manager — 压制状态持久化（防失明解封死循环）", () => {
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
    g.Game.rooms[targetRoom] = makeBlockedRoom(targetRoom);
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
