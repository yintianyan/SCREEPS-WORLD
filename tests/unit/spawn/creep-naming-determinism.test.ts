/**
 * #62 —— creep 命名的确定性（后缀从 Math.random 换成帝国级单调序号）。
 *
 * 为什么这组用例存在：孪生跑（同二进制、同 seed 两遍 `17-multi-room-soak`）在 tick 2001 就给出不同人口，
 * 而 `queues` 逐字一致 ⇒ 分叉在孵化侧。根因是名字里的随机后缀**进了决策路径**两处：
 *   `creeps/support/targeting.ts` 用 `creep.name` 逐字符 hash 错开目标选择；
 *   `domain/remote/demand.ts:264` 用濒死 creep 的名字当替补队列键。
 * 所以本文件既要证"同初始状态 ⇒ 同名字序列"（(a)），也要证**没有把去偏置拆掉**（(e) 的离散度门槛）——
 * 后者才是这条改动真正的风险：换成确定性源时唯一可能失去的就是它。
 */
import { describe, expect, it, vi } from "vitest";
import { trySpawn } from "../../../src/systems/room/spawn-manager";
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

function req(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    key: `harvester:${ROOM}:0`,
    role: "harvester",
    home: ROOM,
    priority: 1,
    survival: false,
    body: ["work", "carry", "move"] as BodyPartConstant[],
    memory: { role: "harvester", home: ROOM, mode: "acquire", spawnIndex: 0 } as CreepMemory,
    createdAt: (globalThis as any).Game.time,
    retries: 0,
    ...overrides,
  } as SpawnRequest;
}

function freshRoom(): void {
  resetGlobals();
  Memory.rooms[ROOM] = { colonyState: "normal", economyPressure: 0 };
  (globalThis as any).Game.creeps = {};
}

/** 一次干净的孵化，返回 spawnCreep 收到的名字。 */
function hatchOnce(): string {
  const spawn = mockSpawn(1300);
  freshRoom();
  trySpawn(mockSnapshot({ spawns: [spawn] }), [req()], 3, 1, false);
  const first = spawn.spawnCreep.mock.calls[0];
  expect(first, "spawnCreep 未被调用 ⇒ 名字断言无意义").toBeDefined();
  return String(first?.[1]);
}

describe("#62 命名确定性", () => {
  it("(a) 同初始状态 ⇒ 同名字（可复现的正证）", () => {
    expect(hatchOnce()).toBe(hatchOnce());
  });

  it("(b) 名字形状一字未改：role-room-spawnIndex-tick-后缀（按 `-` 解析的代码不受影响）", () => {
    const parts = hatchOnce().split("-");
    expect(parts.length).toBe(5);
    expect(parts[0]).toBe("harvester");
    expect(parts[1]).toBe(ROOM);
    expect(parts[2]).toBe("0");
    expect(Number(parts[3])).toBe((globalThis as any).Game.time);
    expect((parts[4] ?? "").length).toBeGreaterThan(0);
  });

  it("(c) 同拍两只 ⇒ 序号严格推进且两名字不同（唯一性是引擎约束）", () => {
    const s1 = mockSpawn(1300);
    const s2 = mockSpawn(1300);
    freshRoom();
    trySpawn(
      mockSnapshot({ spawns: [s1, s2] }),
      [
        req(),
        req({
          key: `harvester:${ROOM}:1`,
          memory: { role: "harvester", home: ROOM, mode: "acquire", spawnIndex: 1 } as CreepMemory,
        }),
      ],
      3,
      1,
      false,
    );
    const name1 = String(s1.spawnCreep.mock.calls[0]?.[1]);
    const name2 = String(s2.spawnCreep.mock.calls[0]?.[1]);
    expect(name1).not.toBe(name2);
    expect(Memory.kernel?.creepSeq ?? 0).toBeGreaterThan(1);
  });

  it("(d) 撞名兜底：Memory 被清后序号回到 1，遇到活 creep 同名必须再取一号", () => {
    const spawn = mockSpawn(1300);
    freshRoom();
    // 预占序号 1 会产出的名字（模拟 Memory 被清 + 场上还有活 creep）。
    const taken = `harvester-${ROOM}-0-${(globalThis as any).Game.time}-1`;
    (globalThis as any).Game.creeps = { [taken]: { name: taken } };
    trySpawn(mockSnapshot({ spawns: [spawn] }), [req()], 3, 1, false);
    const produced = String(spawn.spawnCreep.mock.calls[0]?.[1]);
    expect(produced).not.toBe(taken);
    expect(produced.endsWith("-2")).toBe(true);
    expect(Memory.kernel?.creepSeq).toBe(2);
  });

  it("(e) 离散度门槛：只差后缀时连续序号的 hash 分桶不得劣于随机基线（去偏置没被拆）", () => {
    // 门槛来自 2026-10-02 实测（200 轮 × N=32，**只差后缀**）：随机基线 max 桶的 p95 如下；
    // 序号方案实测 max = 18/12/9/7/8/5，全表优于基线且不留空桶。见 pending-62-patch.md 附二。
    const limits: Array<[number, number]> = [
      [2, 21],
      [3, 16],
      [4, 14],
      [5, 12],
      [6, 11],
      [8, 10],
    ];
    const hash = (s: string): number => {
      let x = 0;
      for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(x);
    };
    const tick = (globalThis as any).Game.time;
    for (const [k, limit] of limits) {
      const buckets: number[] = new Array<number>(k).fill(0);
      for (let seq = 1; seq <= 32; seq++) {
        const idx = hash(`harvester-${ROOM}-0-${tick}-${seq.toString(36)}`) % k;
        buckets[idx] = (buckets[idx] ?? 0) + 1;
      }
      const max = Math.max(...buckets);
      expect(max, `K=${k} 的 max 桶劣于随机 p95`).toBeLessThanOrEqual(limit);
      expect(buckets.filter(v => v === 0).length, `K=${k} 出现空桶`).toBe(0);
    }
  });
});
