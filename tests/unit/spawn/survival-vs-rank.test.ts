/**
 * B5-⑳ `SpawnRequest.priority` 的语义拆分：排队权重 ≠ 本房生存需求。
 *
 * 一个字段两种语义的原事故（A14）：捐出方房看见自己队列里有 `priority 0` 就停建、
 * 停孵本房其他请求 —— 而那个 0 可能只是 agenda-manager 替**别的房**求援运能
 * （`op.priority` 经 `allocation.ts` 的 `riskBuffer ?? 0` 判成 critical 而来）。
 * "被别的房求援"因此变成对自家基建与自家编制的否决权。
 *
 * 拆分后：priority 只回答"先孵谁"；生存否决一律读 `survival`（由请求产出方声明，
 * 类型必填 ⇒ 漏标即编译不过），消费者统一经 `hasSurvivalRequest()`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasSurvivalRequest, submitRequest } from "../../../src/domain/spawn/queue";
import { trySpawn } from "../../../src/systems/room/spawn-manager";
import { mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

const HOME = "W7N4";

function request(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    key: "worker:W7N4:0",
    role: "worker",
    home: HOME,
    priority: 1,
    survival: false,
    body: ["work", "carry", "move"] as BodyPartConstant[],
    memory: { role: "worker", home: HOME, mode: "acquire" } as CreepMemory,
    createdAt: 0,
    retries: 0,
    ...overrides,
  };
}

function mockSpawn(energyAvailable: number, capacity = 800): any {
  return {
    id: "sp1",
    structureType: "spawn",
    spawning: null,
    room: { energyAvailable, energyCapacityAvailable: capacity },
    spawnCreep: vi.fn(() => 0),
    pos: mockPos(25, 25, HOME),
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("hasSurvivalRequest：只读生存维度", () => {
  it("P0 但不是本房生存需求 → 不构成否决", () => {
    expect(hasSurvivalRequest([request({ priority: 0, survival: false })])).toBe(false);
  });

  it("两个维度互相独立：P1 的生存请求照样是否决", () => {
    // 恢复链的常规补位是 P1，但它慌的是本房；反过来跨房援运可以是 P0（帝国层面急着要），
    // 却不该停别家的基建 —— 这条断言就是"两个字段不能合并回去"的证明。
    expect(hasSurvivalRequest([request({ priority: 1, survival: true })])).toBe(true);
  });

  it("空队列 / 全部非生存 → false", () => {
    expect(hasSurvivalRequest([])).toBe(false);
    expect(
      hasSurvivalRequest([
        request({ key: "a", priority: 0, survival: false }),
        request({ key: "b", priority: 2, survival: false }),
      ]),
    ).toBe(false);
  });
});

describe("submitRequest：重提交不得丢掉生存标记", () => {
  it("同 key 合并时 survival 随新值更新（两个方向都要跟）", () => {
    // 漏抄这一行 = 把一间正在求生的房的否决权抹掉，而它看上去仍是一条 P0 请求。
    const queue: SpawnRequest[] = [];
    submitRequest(queue, request({ survival: true }));
    expect(hasSurvivalRequest(queue)).toBe(true);

    submitRequest(queue, request({ survival: false }));
    expect(queue).toHaveLength(1);
    expect(queue[0]!.survival).toBe(false);

    submitRequest(queue, request({ survival: true }));
    expect(queue[0]!.survival).toBe(true);
  });
});

describe("孵化阻塞：否决权只属于生存请求", () => {
  /** 一条孵不出来的请求（body 1000 > 能量 300，且非生存 ⇒ 不降级 ⇒ 跳过）。 */
  function blockedAidRequest(survival: boolean): SpawnRequest {
    return request({
      key: `carrier:${HOME}:0`,
      role: "carrier",
      priority: 0,
      survival,
      body: Array(20).fill("move") as BodyPartConstant[],
      memory: { role: "carrier", home: HOME, mode: "acquire" } as CreepMemory,
    });
  }

  it("跨房援运（P0、非本房生存）挡不住本房自己的编制", () => {
    const spawn = mockSpawn(300);
    const queue = [blockedAidRequest(false), request({ key: `worker:${HOME}:1` })];

    trySpawn(mockSnapshot({ roomName: HOME, spawns: [spawn] }), queue, 0);

    // 旧行为：queue.some(r => r.priority === 0) 命中 → 直接 return，一次都不孵。
    expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
  });

  it("同一条队列换成生存请求 → 仍然阻塞其他请求", () => {
    const spawn = mockSpawn(300);
    const queue = [blockedAidRequest(true), request({ key: `worker:${HOME}:1` })];

    trySpawn(mockSnapshot({ roomName: HOME, spawns: [spawn] }), queue, 0);

    expect(spawn.spawnCreep).not.toHaveBeenCalled();
  });
});
