/**
 * trySpawn 消费逻辑测试 — SP-1 recovery 能量预留 + 首批管线本体覆盖。
 *
 * 背景（审计 SP-1）：AGENTS.md「保留恢复能源是不可妥协的硬约束」，但孵化侧
 * 原先不预留一分 — 低优先级孵化可把能量花到 0，团灭窗口内 P0 恢复要
 * 等 ~200 tick 被动回能。修复：采集链濒临断裂（collectorCount ≤ 1）时
 * 非 P0 请求按 energyBudget - recoveryEnergyReserve 校验。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trySpawn } from "../../../src/systems/spawn-manager";
import { CONFIG } from "../../../src/config";
import { mockPos, mockSnapshot, resetGlobals } from "../../role-helpers";

function mockSpawn(energyAvailable: number, capacity = 800): any {
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
    home: "W7N4",
    priority: 1,
    // [carry,carry,move,move] = 200 能量。
    body: ["carry", "carry", "move", "move"] as BodyPartConstant[],
    memory: { role: "hauler", home: "W7N4", mode: "acquire" } as CreepMemory,
    createdAt: (globalThis as any).Game.time,
    retries: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Memory.rooms.W7N4 = { colonyState: "normal", economyPressure: 0 };
});

describe("trySpawn — SP-1 recovery 能量预留", () => {
  it("采集者 ≤1 时非 P0 请求不得动用预留能量（cost > budget - reserve → 不孵化）", () => {
    // 能量 300，请求 200，预留 200 → 有效额度 100 < 200 → 排队等待。
    const spawn = mockSpawn(200 + CONFIG.spawn.recoveryEnergyReserve - 100);
    const queue = [makeRequest()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 1);

    // 常态非饥饿 P1 不降级 → 请求保留在队列（不孵化不 retries）。
    expect(spawn.spawnCreep).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.retries).toBe(0);
  });

  it("采集者充足时不预留（现有行为不回归）", () => {
    const spawn = mockSpawn(200 + CONFIG.spawn.recoveryEnergyReserve - 100);
    const queue = [makeRequest()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(0); // 成功后同 tick 出队。
  });

  it("P0 请求豁免预留 — 恢复 body 可动用全部能量", () => {
    // 能量恰为 200：P0 请求 200 应立即孵化（预留是留给它的）。
    const spawn = mockSpawn(200);
    const queue = [makeRequest({
      key: "worker:W7N4:0",
      role: "worker",
      priority: 0,
      body: ["work", "carry", "move"] as BodyPartConstant[], // 200 能量
      memory: { role: "worker", home: "W7N4", mode: "acquire" } as CreepMemory,
    })];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 0);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
  });

  it("预留生效时能量充足的非 P0 照常孵化（预留不是一刀切禁孵）", () => {
    // 能量 500，请求 200，预留 200 → 有效 300 ≥ 200 → 正常孵化。
    const spawn = mockSpawn(500);
    const queue = [makeRequest()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 1);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
  });

  it("采集角色豁免预留 — harvester 扩编本身就是恢复路径", () => {
    // 能量 300 < 200 + 预留 200，但 harvester 是采集角色 → 照常孵化。
    // 不豁免的后果（rcl1-survival 回归）：1 采集者 + 满能量的房间
    // 永远孵不出第二只采集者，spawn 永久 idle。
    const spawn = mockSpawn(300);
    const queue = [makeRequest({
      key: "harvester:W7N4:0",
      role: "harvester",
      body: ["work", "work", "carry", "move"] as BodyPartConstant[], // 300
      memory: { role: "harvester", home: "W7N4", mode: "acquire" } as CreepMemory,
    })];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 1);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
  });
});

describe("trySpawn — 管线本体基线（补测试债）", () => {
  it("P0 请求待处理时阻塞所有低优先级请求", () => {
    // P0 请求 500 超出能量 100 且降级失败 → 后续 P1 也不孵化。
    const spawn = mockSpawn(100);
    const queue = [
      makeRequest({
        key: "worker:W7N4:0", role: "worker", priority: 0,
        body: Array(10).fill("work") as BodyPartConstant[], // 1000 能量，无法降级到 100
      }),
      makeRequest(),
    ];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3);

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });

  it("多 spawn 并行：同 tick 逐个消费队列且 energyBudget 逐次扣减", () => {
    const sp1 = mockSpawn(450);
    const sp2 = { ...mockSpawn(450), id: "sp2", spawnCreep: vi.fn(() => 0) };
    const queue = [
      makeRequest(),
      makeRequest({ key: "hauler:W7N4:1" }),
      makeRequest({ key: "hauler:W7N4:2" }), // 第三个：450 - 200 - 200 = 50 < 200，无 spawn 也无预算
    ];

    trySpawn(mockSnapshot({ spawns: [sp1, sp2] as any }), queue, 3);

    expect(sp1.spawnCreep).toHaveBeenCalledTimes(1);
    expect(sp2.spawnCreep).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(1); // 第三个请求保留。
  });

  it("body 超容量：retries 递增（走隔离路径）", () => {
    const spawn = mockSpawn(2000, 300); // 容量仅 300
    const queue = [makeRequest({
      body: Array(10).fill("carry") as BodyPartConstant[], // 500 > 容量 300
    })];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3);

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
    expect(queue[0]!.retries).toBe(1);
  });
});

describe("trySpawn — SP-10 饥饿降级成本地板", () => {
  // 满配 hauler 6C6M = 600 能量；createdAt 提前 500 tick，
  // 远超 P1 饥饿窗口（2 × 12 部件 × 3 = 72 tick）→ starvedP1 成立。
  function starvedHauler(): SpawnRequest {
    return makeRequest({
      body: [
        "carry", "carry", "carry", "carry", "carry", "carry",
        "move", "move", "move", "move", "move", "move",
      ] as BodyPartConstant[],
      createdAt: (globalThis as any).Game.time - 500,
    });
  }

  it("饥饿 P1 降级产物低于地板：不孵化、不递增 retries（等能量，不是失败）", () => {
    // 能量 250 → 降级产物 3C2M = 250 < 地板 300 → 继续排队。
    const spawn = mockSpawn(250);
    const queue = [starvedHauler()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3);

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    // retries 不递增 — 烧穿 maxRetries 会把「等能量」变成 1000 tick 黑名单隔离。
    expect(queue[0]!.retries).toBe(0);
  });

  it("饥饿 P1 降级产物达到地板：照常孵化", () => {
    // 能量 350 → 降级产物 4C3M = 350 ≥ 地板 300 → 放行。
    const spawn = mockSpawn(350);
    const queue = [starvedHauler()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(0);
  });

  it("P0 生存路径豁免地板：降级产物 200 < 300 也速出保命", () => {
    // [3W,C,M] = 400，能量 250 → 降到 [W,C,M] = 200 < 地板，但 P0 豁免。
    const spawn = mockSpawn(250);
    const queue = [makeRequest({
      key: "worker:W7N4:0",
      role: "worker",
      priority: 0,
      body: ["work", "work", "work", "carry", "move"] as BodyPartConstant[],
      memory: { role: "worker", home: "W7N4", mode: "acquire" } as CreepMemory,
    })];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 0);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
  });

  it("bootstrap 生存路径豁免地板：小 body 建链优先于体格质量", () => {
    (globalThis as any).Memory.rooms.W7N4.colonyState = "bootstrap";
    const spawn = mockSpawn(250); // 降级产物 250 < 300
    const queue = [starvedHauler()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
  });
});

describe("trySpawn — 泵断供降级（distributor 存活数 0）", () => {
  // 满配 distributor 6C6M = 600；createdAt = 当前 tick（非饥饿）。
  function freshDistributor(): SpawnRequest {
    return makeRequest({
      key: "distributor:W7N4:0",
      role: "distributor",
      body: [
        "carry", "carry", "carry", "carry", "carry", "carry",
        "move", "move", "move", "move", "move", "move",
      ] as BodyPartConstant[],
      memory: { role: "distributor", home: "W7N4", mode: "acquire" } as CreepMemory,
    });
  }

  it("断供（存活 0）：不等饥饿窗口立即降级孵化", () => {
    // 能量 350 → 降级产物 4C3M = 350 ≥ 地板 → 速出小泵。
    const spawn = mockSpawn(350);
    const queue = [freshDistributor()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3, 0);

    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
  });

  it("泵在岗（存活 ≥1）：非饥饿不降级，等满配能量", () => {
    const spawn = mockSpawn(350);
    const queue = [freshDistributor()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3, 1);

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
  });

  it("断供降级仍受成本地板约束：产物 < 300 继续排队等能量", () => {
    // 能量 250 → 降级产物 250 < 地板 300 → 不孵化不 retries（不铸残废泵）。
    const spawn = mockSpawn(250);
    const queue = [freshDistributor()];

    trySpawn(mockSnapshot({ spawns: [spawn] }), queue, 3, 0);

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
    expect(queue[0]!.retries).toBe(0);
  });
});
