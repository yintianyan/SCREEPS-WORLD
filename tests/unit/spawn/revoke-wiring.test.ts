/** spawn 请求撤销通道接线测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { spawnManagerSystem } from "../../../src/systems/spawn-manager";
import { removeRequestsByRole } from "../../../src/domain/spawn/queue";
import { mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";

function makeRequest(role: string, home: string, overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    key: `${role}:${home}:0`,
    role,
    home,
    priority: 1,
    body: ["attack", "move"] as BodyPartConstant[],
    memory: { role, home, mode: "acquire" } as CreepMemory,
    createdAt: 900,
    expiresAt: 1900,
    retries: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("queue — removeRequestsByRole（纯函数）", () => {
  it("只移除匹配 role + home 的请求并返回数量", () => {
    const queue = [
      makeRequest("defender", "W7N4"),
      makeRequest("defender", "W7N4", { key: "defender:W7N4:1" }),
      makeRequest("defender", "W8N4"), // 他房请求不受影响
      makeRequest("hauler", "W7N4"),
    ];
    const removed = removeRequestsByRole(queue, "defender", "W7N4");
    expect(removed).toBe(2);
    expect(queue.map(r => r.key)).toEqual(["defender:W8N4:0", "hauler:W7N4:0"]);
  });

  it("无匹配时返回 0 且队列不变", () => {
    const queue = [makeRequest("hauler", "W7N4")];
    expect(removeRequestsByRole(queue, "defender", "W7N4")).toBe(0);
    expect(queue).toHaveLength(1);
  });
});

describe("spawn-manager — 请求撤销接线（幽灵需求回收）", () => {
  it("威胁清除后撤销 pending defender 请求", () => {
    const queue = [makeRequest("defender", "W7N4"), makeRequest("hauler", "W7N4")];
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: queue,
      colonyState: "normal",
    };

    // 无威胁快照 → defender 请求应被撤销，hauler 保留。
    const snapshot = mockSnapshot({ threatCreeps: [] });
    spawnManagerSystem.run(mockContext(snapshot));

    const roles = ((globalThis as any).Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).not.toContain("defender");
    expect(roles).toContain("hauler");
  });

  it("威胁仍在时 defender 请求保留", () => {
    const queue = [makeRequest("defender", "W7N4")];
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: queue,
      colonyState: "normal",
    };

    const hostile = { id: "h1", name: "h1", pos: { x: 10, y: 10 }, owner: { username: "enemy" } };
    const snapshot = mockSnapshot({ threatCreeps: [hostile as any] });
    spawnManagerSystem.run(mockContext(snapshot));

    const roles = ((globalThis as any).Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).toContain("defender");
  });

  it("recovery 且无降级风险时撤销 pending upgrader 请求", () => {
    const queue = [makeRequest("upgrader", "W7N4", { priority: 2, body: ["work", "carry", "move"] as BodyPartConstant[] })];
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: queue,
      colonyState: "recovery",
      controllerDowngradeRisk: false,
    };

    spawnManagerSystem.run(mockContext(mockSnapshot()));

    const roles = ((globalThis as any).Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).not.toContain("upgrader");
  });

  it("recovery 但有降级风险时 upgrader 请求保留（保级豁免）", () => {
    const queue = [makeRequest("upgrader", "W7N4", { priority: 2, body: ["work", "carry", "move"] as BodyPartConstant[] })];
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: queue,
      colonyState: "recovery",
      controllerDowngradeRisk: true,
    };

    spawnManagerSystem.run(mockContext(mockSnapshot()));

    const roles = ((globalThis as any).Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).toContain("upgrader");
  });

  /** 在 Game.creeps 中放一个存活 distributor（供 collectCreepSummaries 收集）。 */
  function addLivingDistributor(): void {
    (globalThis as any).Game.creeps.dist_1 = {
      name: "dist_1",
      spawning: false,
      ticksToLive: 1000,
      body: [1, 2, 3, 4],
      memory: { role: "distributor", home: "W7N4" },
      room: { name: "W7N4" },
    };
  }

  it("填充需求清零且编制达地板时撤销 pending distributor 请求（尖峰残留回收）", () => {
    const queue = [
      makeRequest("distributor", "W7N4", { key: "distributor:W7N4:1", body: ["carry", "move"] as BodyPartConstant[] }),
      makeRequest("hauler", "W7N4"),
    ];
    (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: queue, colonyState: "normal" };
    addLivingDistributor();

    // fillTargets 空 = 孵化尖峰已被在途编制消化 → 扩编请求是幽灵需求。
    spawnManagerSystem.run(mockContext(mockSnapshot({ fillTargets: [] })));

    const roles = ((globalThis as any).Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).not.toContain("distributor");
    expect(roles).toContain("hauler");
  });

  it("填充需求仍在时 distributor 请求保留", () => {
    const queue = [makeRequest("distributor", "W7N4", { key: "distributor:W7N4:1", body: ["carry", "move"] as BodyPartConstant[] })];
    (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: queue, colonyState: "normal" };
    addLivingDistributor();

    const spawn = { id: "sp1", structureType: "spawn", store: { getUsedCapacity: () => 100, getCapacity: () => 300, getFreeCapacity: () => 200 }, pos: { x: 25, y: 25, getRangeTo: () => 5 } };
    spawnManagerSystem.run(mockContext(mockSnapshot({ fillTargets: [spawn as any] })));

    const roles = ((globalThis as any).Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).toContain("distributor");
  });

  it("存活编制低于 minCount 时不撤销（保护 storage 刚建成的首个 distributor 请求）", () => {
    const queue = [makeRequest("distributor", "W7N4", { body: ["carry", "move"] as BodyPartConstant[] })];
    (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: queue, colonyState: "normal" };
    // Game.creeps 无 distributor → 存活 0 < minCount 1 → 保留。

    spawnManagerSystem.run(mockContext(mockSnapshot({ fillTargets: [] })));

    const roles = ((globalThis as any).Memory.rooms.W7N4.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).toContain("distributor");
  });
});

describe("spawn-manager — SP-2 黑名单闭环（隔离 → 冷却拒重建 → 到期放行）", () => {
  /** 存活 harvester 防 P0 短路（P0 分支只出 worker/defender）。 */
  function addLivingHarvester(): void {
    (globalThis as any).Game.creeps.h_1 = {
      name: "h_1",
      spawning: false,
      ticksToLive: 1000,
      body: [1, 2, 3],
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 50 },
      memory: { role: "harvester", home: "W7N4", sourceId: "source_1" },
      room: { name: "W7N4" },
    };
  }

  it("达重试上限的请求被隔离入黑名单，冷却期内 demand 同 key 重建被拒", () => {
    const hostile = { id: "h1", name: "h1", pos: { x: 10, y: 10 }, owner: { username: "enemy" } };
    // 预置一个已烧穿重试的 defender 请求。
    const failed = makeRequest("defender", "W7N4");
    failed.retries = CONFIG.spawn.maxRetries;
    (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: [failed], colonyState: "normal" };
    addLivingHarvester();

    // 威胁在场 → demand 会尝试重建 defender:W7N4:0（同 key）。
    const snapshot = mockSnapshot({ threatCreeps: [hostile as any] });
    spawnManagerSystem.run(mockContext(snapshot));

    const roomMem = (globalThis as any).Memory.rooms.W7N4;
    // 黑名单已写入（冷却 = requestTtl）。
    expect(roomMem.spawnBlacklist["defender:W7N4:0"]).toBeGreaterThan((globalThis as any).Game.time);
    // 冷却期内重建被拒 — 队列中无 defender（翻炒循环被打破）。
    const roles = (roomMem.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).not.toContain("defender");
  });

  it("冷却到期后条目被清理，重建放行", () => {
    const hostile = { id: "h1", name: "h1", pos: { x: 10, y: 10 }, owner: { username: "enemy" } };
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: [],
      colonyState: "normal",
      spawnBlacklist: { "defender:W7N4:0": (globalThis as any).Game.time - 1 }, // 已过期
    };
    addLivingHarvester();

    const snapshot = mockSnapshot({ threatCreeps: [hostile as any] });
    spawnManagerSystem.run(mockContext(snapshot));

    const roomMem = (globalThis as any).Memory.rooms.W7N4;
    expect(roomMem.spawnBlacklist["defender:W7N4:0"]).toBeUndefined(); // prune 生效
    const roles = (roomMem.spawnQueue as SpawnRequest[]).map(r => r.role);
    expect(roles).toContain("defender"); // 放行重建
  });
});
