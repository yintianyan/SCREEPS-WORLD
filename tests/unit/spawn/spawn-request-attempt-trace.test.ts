/**
 * #169 逐请求留痕（`attempts`／`block`）单测 —— 验的是**两问分得开**，不是行为变了。
 *
 * 立案缘由（roadmap §3.5 #169）：房间级 `spawnRejects` 每拍每请求计数，答「这一房被什么挡住了几拍」；
 * 但 builder 排产要的那个判别是**逐条**的——「这条请求是每次都去铸（等能量），还是从未被允许试铸
 * （被闸/隔离/编制挡在门外）」。老写法里这两种在 Memory 里长得一模一样：请求在场、`retries=0`、没孵出来。
 *
 * ⚠️本文件钉住的两条语义（都是实测出来的，不是设想）：
 *   一、`block` 是**本拍最后一步**＝后写覆盖先写。`budget`/`reserveOnly` 是同一条不等式的两档，
 *       写在前面，但那条路径若继续走到降级裁决，终码会变成 `degradeGateClosed`/`noDegrade`/`floor`
 *       ⇒ 「钱不够还是预留扣走」问房间级那两列，「卡在哪一步」问这一列。两把尺不互裁。
 *   二、`attempts` 只在真的调用 `spawnCreep` 那一行涨 ⇒ 缺席＝从未被允许试铸。
 *
 * 反向实验（写进锁）：删掉 cast 那行的 `req.attempts = ...` ⇒ 下面"试铸"三例转红、其余仍绿；
 * 把 `rejects()` 两档的三元写反 ⇒ 只有配对那两例转红（这条正是 #54 立案的论据，本文件守住它没被带跑）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trySpawn, type SpawnRejectStats } from "../../../src/systems/room/spawn-manager";
import { mockSnapshot, resetGlobals, mockPos } from "../../support/factories";

const ROOM = "W7N4";

function mockSpawn(energyAvailable: number, capacity = 1300, result = 0): any {
  return {
    id: "sp1",
    structureType: "spawn",
    spawning: null,
    room: { energyAvailable, energyCapacityAvailable: capacity },
    spawnCreep: vi.fn(() => result),
    pos: mockPos(),
  };
}

function makeRequest(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    key: "hauler:W7N4:0",
    role: "hauler",
    home: ROOM,
    priority: 1,
    survival: false,
    // [carry,carry,move,move] = 200 能量。
    body: ["carry", "carry", "move", "move"] as BodyPartConstant[],
    memory: { role: "hauler", home: ROOM, mode: "acquire" } as CreepMemory,
    createdAt: (globalThis as any).Game.time,
    retries: 0,
    ...overrides,
  };
}

function rejects(): SpawnRejectStats | undefined {
  return (Memory.rooms[ROOM] as (RoomMemory & { spawnRejects?: SpawnRejectStats }) | undefined)
    ?.spawnRejects;
}

const trace = (r: SpawnRequest) => ({ attempts: r.attempts, block: r.block, retries: r.retries });

beforeEach(() => {
  resetGlobals();
  Memory.rooms[ROOM] = { colonyState: "normal", economyPressure: 0 };
});

describe("#169 没走到孵化口 — attempts 缺席，block 指认止步处", () => {
  it("隔离名单命中 ⇒ block=blacklisted，且从未试铸", () => {
    Memory.rooms[ROOM]!.spawnBlacklist = { "hauler:W7N4:0": (globalThis as any).Game.time + 100 };
    const req = makeRequest();
    const spawn = mockSpawn(1300);
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req], 3, 1, false);
    expect(trace(req)).toEqual({ attempts: undefined, block: "blacklisted", retries: 0 });
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });

  it("生存否决挡住非 P0 ⇒ block=survivalBlock（同队列的 P0 自己停在 emptyBody）", () => {
    const p0 = makeRequest({
      key: "harvester:W7N4:0",
      role: "harvester",
      survival: true,
      body: [] as BodyPartConstant[],
    });
    const blocked = makeRequest();
    const spawn = mockSpawn(1300);
    trySpawn(mockSnapshot({ spawns: [spawn] }), [p0, blocked], 3, 1, false);
    expect(p0.block).toBe("emptyBody");
    expect(p0.retries).toBe(1); // emptyBody 烧 retries 是既有语义，本用例只是守住它
    expect(trace(blocked)).toEqual({ attempts: undefined, block: "survivalBlock", retries: 0 });
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });

  it("钱不够 ⇒ 终码 degradeGateClosed，而房间级记 budget（两把尺各答一问）", () => {
    const req = makeRequest();
    trySpawn(mockSnapshot({ spawns: [mockSpawn(150)] }), [req], 3, 1, false);
    expect(trace(req)).toEqual({
      attempts: undefined,
      block: "degradeGateClosed",
      retries: 0,
    });
    expect(rejects()?.budget).toBe(1);
    expect(rejects()?.reserveOnly).toBe(0);
  });

  it("钱够但被预留扣走 ⇒ 终码同值，房间级换成 reserveOnly（互斥两档仍分得开）", () => {
    const req = makeRequest();
    const spawn = mockSpawn(300);
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req], 3, 1, true);
    expect(trace(req)).toEqual({
      attempts: undefined,
      block: "degradeGateClosed",
      retries: 0,
    });
    expect(rejects()?.reserveOnly).toBe(1);
    expect(rejects()?.budget).toBe(0);
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });

  it("连最小 body 都凑不出 ⇒ block=noDegrade（等能量不烧 retries）", () => {
    const req = makeRequest({ createdAt: (globalThis as any).Game.time - 60 });
    trySpawn(mockSnapshot({ spawns: [mockSpawn(50)] }), [req], 3, 1, false);
    expect(trace(req)).toEqual({ attempts: undefined, block: "noDegrade", retries: 0 });
  });

  it("降级产物低于饥饿地板 ⇒ block=floor", () => {
    const req = makeRequest({
      body: [
        "carry",
        "carry",
        "carry",
        "carry",
        "move",
        "move",
        "move",
        "move",
      ] as BodyPartConstant[],
      createdAt: (globalThis as any).Game.time - 200,
    });
    trySpawn(mockSnapshot({ spawns: [mockSpawn(250)] }), [req], 3, 1, false);
    expect(trace(req)).toEqual({ attempts: undefined, block: "floor", retries: 0 });
  });
});

describe("#169 走到孵化口 — attempts 是唯一的判别列", () => {
  it("成功发起孵化 ⇒ attempts=1、block=cast，请求出队", () => {
    const req = makeRequest();
    const spawn = mockSpawn(300);
    const queue = [req];
    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3, 1, false);
    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
    expect(req.attempts).toBe(1);
    expect(req.block).toBe("cast");
    expect(queue).toHaveLength(0);
  });

  it("同一请求连走两拍 ⇒ attempts 累加到 2（历史不被清；retries 仍是 0）", () => {
    const req = makeRequest();
    trySpawn(mockSnapshot({ spawns: [mockSpawn(300)] }), [req], 3, 1, false);
    expect(req.attempts).toBe(1);
    trySpawn(mockSnapshot({ spawns: [mockSpawn(300)] }), [req], 3, 1, false);
    expect(req.attempts).toBe(2);
    expect(req.block).toBe("cast");
    expect(req.retries).toBe(0);
  });

  it("被闸挡住那一拍不会伪计 attempts：先 reject 后 cast ⇒ attempts 从缺席直接到 1", () => {
    const req = makeRequest();
    trySpawn(mockSnapshot({ spawns: [mockSpawn(150)] }), [req], 3, 1, false);
    expect(req.attempts).toBeUndefined();
    expect(req.block).toBe("degradeGateClosed");
    trySpawn(mockSnapshot({ spawns: [mockSpawn(300)] }), [req], 3, 1, false);
    expect(req.attempts).toBe(1);
    expect(req.block).toBe("cast");
  });
});
