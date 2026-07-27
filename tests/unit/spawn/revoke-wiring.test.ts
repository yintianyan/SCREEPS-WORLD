/**
 * spawn 请求撤销通道接线测试。
 *
 * 背景：队列请求的常规出队路径只有孵化成功 / TTL(1000 tick) / 重试隔离，
 * removeRequest 曾全仓 0 调用 — 威胁清除后的 defender、状态翻转后的 upgrader
 * 请求会在 TTL 窗口内继续孵化（幽灵需求）。
 * 本文件走真实调用链（spawnManagerSystem.run → 队列副作用），
 * 同时覆盖 removeRequestsByRole 纯函数语义。
 */
import { beforeEach, describe, expect, it } from "vitest";
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
