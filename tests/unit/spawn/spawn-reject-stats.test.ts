/**
 * #54 拒因计数（spawnRejects）单测 —— 验的是**观测的口径分得开**，不是行为变了。
 *
 * 为什么每例都要断言"别的档没跟着涨"：这五档里 `budget`/`reserveOnly` 来自同一条不等式的两组阈值
 * （`cost > energyBudget` vs `cost > energyBudget - reserve`），互斥三分支的老写法会把
 * reserveOnly 吞进 budget —— 那正是"预留该不该豁免交付角色"唯一的论据。
 * 反向实验（写进锁）：把 countSpawnReject 钉成空函数 ⇒ 本文件全部转红、`try-spawn.test.ts` 仍全绿。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trySpawn, type SpawnRejectStats } from "../../../src/systems/room/spawn-manager";
import { mockSnapshot, resetGlobals, mockPos } from "../../support/factories";

const ROOM = "W7N4";

function mockSpawn(energyAvailable: number, capacity = 1300): any {
  return {
    id: "sp1",
    structureType: "spawn",
    spawning: null,
    room: { energyAvailable, energyCapacityAvailable: capacity },
    spawnCreep: vi.fn(() => 0),
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

beforeEach(() => {
  resetGlobals();
  Memory.rooms[ROOM] = { colonyState: "normal", economyPressure: 0 };
});

describe("#54 拒因计数 — budget 与 reserveOnly 必须是两档", () => {
  it("钱够但被预留扣走 ⇒ 只记 reserveOnly，不记 budget", () => {
    const spawn = mockSpawn(300);
    const queue = [makeRequest()];
    // collectorCount=3 避开条件 1；replacementReserve=true 走条件 3（采集者进替换窗）。
    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3, 1, true);
    expect(rejects()?.reserveOnly).toBe(1);
    expect(rejects()?.budget).toBe(0);
    expect(rejects()?.noDegrade).toBe(0);
    expect(rejects()?.floor).toBe(0);
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1); // 不烧 retries、不出队
  });

  it("连未扣预留的预算都不够 ⇒ 记 budget，不记 reserveOnly", () => {
    const spawn = mockSpawn(150);
    trySpawn(mockSnapshot({ spawns: [spawn] }), [makeRequest()], 3, 1, false);
    expect(rejects()?.budget).toBe(1);
    expect(rejects()?.reserveOnly).toBe(0);
  });
});

describe("#54 拒因计数 — 降级分支的两档", () => {
  it("饥饿降级连最小可用 body 都凑不出 ⇒ 记 noDegrade", () => {
    const spawn = mockSpawn(50);
    // starvedP1：waitTicks ≥ 2×(4 件 ×3) = 24。
    const req = makeRequest({ createdAt: (globalThis as any).Game.time - 60 });
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req], 3, 1, false);
    expect(rejects()?.noDegrade).toBe(1);
    expect(rejects()?.floor).toBe(0);
    expect(req.retries).toBe(0); // 等能量不是失败（既有语义，本用例守住它没被计数改动带跑）
  });

  it("降级产物低于饥饿地板且在 normal 态 ⇒ 记 floor", () => {
    const spawn = mockSpawn(250);
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
      createdAt: (globalThis as any).Game.time - 200, // 8 件 → spawnTime 24，starvedP1 需 ≥48
    });
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req], 3, 1, false);
    expect(rejects()?.floor).toBe(1);
    expect(rejects()?.noDegrade).toBe(0);
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });

  it("同一情形落在 recovery 带里 ⇒ 地板被豁免，floor 不涨（读数必须与 colonyState 同看）", () => {
    Memory.rooms[ROOM]!.colonyState = "recovery";
    const spawn = mockSpawn(250);
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
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req], 3, 1, false);
    // 这一档的"没涨"要有对照才算数：同一拍确实被 budget 档记过（对象存在），才证明 floor 是被豁免而不是没跑。
    expect(rejects()?.budget).toBe(1);
    expect(rejects()?.floor).toBe(0);
    expect(spawn.spawnCreep).toHaveBeenCalled(); // 带里放行降级产物
  });
});

describe("#54 拒因计数 — P0 生存否决那条 return", () => {
  it("P0 孵不动时整轮非 P0 一次都不被尝试 ⇒ 记被跳过的条数", () => {
    const spawn = mockSpawn(50);
    const p0 = makeRequest({
      key: "harvester:W7N4:0",
      role: "harvester",
      survival: true,
      priority: 0,
      body: ["work", "work", "carry", "move"] as BodyPartConstant[], // 300 > 50 ⇒ noDegrade
      memory: { role: "harvester", home: ROOM, mode: "acquire" } as CreepMemory,
    });
    const hauler = makeRequest({ createdAt: (globalThis as any).Game.time - 600 });
    const builder = makeRequest({
      key: "builder:W7N4:0",
      role: "builder",
      priority: 2,
      body: ["work", "work", "carry", "move"] as BodyPartConstant[],
      memory: { role: "builder", home: ROOM, mode: "acquire" } as CreepMemory,
      createdAt: (globalThis as any).Game.time - 600,
    });
    const queue = [p0, hauler, builder];
    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3, 1, false);
    // 队列里非 P0 有 2 条 ⇒ 一次 return 记 2，而不是记 1。
    expect(rejects()?.survivalBlock).toBe(2);
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });

  it("孵化成功 ⇒ 五档一个都不涨（对照组，防「计数器恒涨」假绿）", () => {
    const spawn = mockSpawn(1300);
    const queue = [makeRequest()];
    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3, 1, true);
    expect(spawn.spawnCreep).toHaveBeenCalled();
    expect(rejects()).toBeUndefined(); // 没有任何拒绝发生 ⇒ 连对象都不该建
  });
});

/**
 * #64 第 6 档 `degradeGateClosed` —— 它是**正交标签**（与 budget/reserveOnly 出自同一次判定），
 * 所以本块的第一条用例故意断言"两档同时涨"，与上面五档的互斥口径不同；
 * 而第三条对照用例（降级许可打开时它必须**不涨**）才是防止它退化成"每拍常数的"关键。
 */
describe("#64 降级许可从未打开 ⇒ 单独可计", () => {
  const gatedBuilder = () =>
    makeRequest({
      key: "builder:W7N4:0",
      role: "builder",
      priority: 2,
      body: ["work", "work", "carry", "move"] as BodyPartConstant[], // 300 能量
      memory: { role: "builder", home: ROOM, mode: "acquire" } as CreepMemory,
    });

  it("P2 付不起且降级许可五条件全假 ⇒ budget 与 degradeGateClosed 同时 +1（正交，不互斥）", () => {
    const spawn = mockSpawn(150);
    const req = gatedBuilder();
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req], 3, 1, false);
    expect(rejects()?.budget).toBe(1); // 300 > 未扣预留的 150
    expect(rejects()?.reserveOnly).toBe(0);
    expect(rejects()?.degradeGateClosed).toBe(1); // allowDegrade 从未为真
    expect(rejects()?.noDegrade).toBe(0); // 没进降级分支 ⇒ 这一档不该涨（两档的分工就在这里）
    expect(rejects()?.floor).toBe(0);
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
    expect(req.retries).toBe(0); // 等能量不是失败（既有语义不被新计数带跑）
  });

  it("旧五键形状的 Memory ⇒ 新档补零后计数（否则 undefined+1=NaN，计数器上线即哑火）", () => {
    // 线上各房的 spawnRejects 由 #54 那批建成，**没有第六键**；`??=` 对已存在对象不生效。
    (Memory.rooms[ROOM] as any).spawnRejects = {
      survivalBlock: 0,
      budget: 3,
      reserveOnly: 2,
      noDegrade: 1,
      floor: 0,
    };
    trySpawn(mockSnapshot({ spawns: [mockSpawn(150)] }), [gatedBuilder()], 3, 1, false);
    expect(Number.isFinite(rejects()?.degradeGateClosed)).toBe(true);
    expect(rejects()?.degradeGateClosed).toBe(1);
    expect(rejects()?.budget).toBe(4); // 旧档继续按老口径走
    expect(rejects()?.noDegrade).toBe(1); // 未被误记
  });

  it("控制组：同一次判定但降级许可打开 ⇒ degradeGateClosed 必须仍为 0，变化落在 noDegrade", () => {
    const spawn = mockSpawn(50);
    // starvedP1（wait ≥ 2×(4 件×3)=24）⇒ allowDegrade 为真 ⇒ 进得了分支就不该记"门没开"。
    const req = makeRequest({ createdAt: (globalThis as any).Game.time - 60 });
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req], 3, 1, false);
    expect(rejects()?.noDegrade).toBe(1);
    expect(rejects()?.degradeGateClosed).toBe(0);
  });
});
