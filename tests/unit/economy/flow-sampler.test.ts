/** 跨 tick 房间流采样测试 — 官服 intent 延迟结算下唯一实测口径。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { economySystem } from "../../../src/systems/economy";
import {
  diffRoomFlows,
  type RoomFlowSample,
} from "../../../src/domain/economy/accounting";
import { mockContext, mockSnapshot, resetGlobals } from "../../support/factories";
import { globalCache } from "../../../src/kernel/global-cache";

function sample(overrides: Partial<RoomFlowSample> = {}): RoomFlowSample {
  return { sources: 3000, progress: 0, sites: {}, ...overrides };
}

describe("diffRoomFlows — 跨 tick 差分纯函数", () => {
  it("source 能量下降 → harvested = 差值", () => {
    const d = diffRoomFlows(sample({ sources: 3000 }), sample({ sources: 2940 }));
    expect(d).toEqual({ harvested: 60, upgraded: 0, built: 0 });
  });

  it("再生脉冲（energy 回升）→ clamp 0，不记假账", () => {
    const d = diffRoomFlows(sample({ sources: 200 }), sample({ sources: 3000 }));
    expect(d.harvested).toBe(0);
  });

  it("controller.progress 增长 → upgraded = 差值；升级清零 → clamp 0", () => {
    expect(diffRoomFlows(sample({ progress: 1000 }), sample({ progress: 1300 })).upgraded).toBe(300);
    expect(diffRoomFlows(sample({ progress: 1000 }), sample({ progress: 5 })).upgraded).toBe(0);
  });

  it("site.progress 增长 → built = 差值；完工离场 → 补记剩余量", () => {
    const d = diffRoomFlows(
      sample({ sites: { s1: [100, 500], s2: [200, 600] } }),
      sample({ sites: { s1: [350, 500] } }),
    );
    expect(d.built).toBe(250 + 400);
  });
});

describe("economy — sampleRoomFlows 跨 tick 入账", () => {
  beforeEach(() => {
    resetGlobals();
    // 采样基线在 economy 模块内（heap Map 不可达）— 各测试用唯一房名隔离。
    delete (globalThis as any).energyLedger;
  });

  /**
   * 可变世界 mock：source energy / controller.progress 经 getter 读活值。
   * sources 数组与 find(FIND_SOURCES) 返回一致，供 sampleRoomFlows 从快照或 room.find 读取。
   */
  function makeWorld(
    name: string,
    state: { srcEnergy: number; progress: number },
    owned = true,
  ): any {
    const sources = [{ get energy() { return state.srcEnergy; } }];
    return {
      name,
      controller: {
        my: owned,
        get progress() {
          return state.progress;
        },
      },
      find: vi.fn((type: number) =>
        type === FIND_SOURCES ? sources : []),
      // 暴露 sources 供 mockContext 快照引用同一动态对象。
      _sources: sources,
    };
  }

  /**
   * 运行 economy 系统 — mockContext 的 getSnapshot 返回包含动态 sources 的快照，
   * 使 sampleRoomFlows 从快照读取 sources 与从 room.find 读取结果一致。
   */
  function runEconomy(world: any): void {
    (globalThis as any).Game.time += 1;
    const snap = mockSnapshot({
      roomName: world.name,
      sources: world._sources,
      controller: world.controller,
    });
    economySystem.run(mockContext(snap));
  }

  function ledger(): any {
    return (globalThis as any).energyLedger?.rooms ?? {};
  }

  it("两 tick 之间 source 被采 60 → harvested 入账 60", () => {
    const state = { srcEnergy: 3000, progress: 0 };
    const world = makeWorld("W7N4", state);
    (globalThis as any).Game.rooms = { W7N4: world };
    (globalThis as any).Memory = { rooms: {}, kernel: {} };
    (globalThis as any).Game.creeps = {};

    runEconomy(world); // 播种基线，不入账
    expect(ledger().W7N4).toBeUndefined();

    state.srcEnergy = 2940; // 引擎在 tick 末结算 harvest
    runEconomy(world);

    expect(ledger().W7N4.harvested).toBe(60);
    expect(ledger().W7N4.upgraded).toBe(0);
  });

  it("controller.progress 前进 300 → upgraded 入账", () => {
    const state = { srcEnergy: 3000, progress: 1000 };
    const world = makeWorld("W7N5", state);
    (globalThis as any).Game.rooms = { W7N5: world };
    (globalThis as any).Memory = { rooms: {}, kernel: {} };
    (globalThis as any).Game.creeps = {};

    runEconomy(world);
    state.progress = 1300;
    runEconomy(world);

    expect(ledger().W7N5.upgraded).toBe(300);
  });

  it("外来房间不采样（source 下降不产生本帝国收入）", () => {
    const state = { srcEnergy: 3000, progress: 0 };
    const world = makeWorld("W9N9", state, false);
    (globalThis as any).Game.rooms = { W9N9: world };
    (globalThis as any).Memory = { rooms: {}, kernel: {} };
    (globalThis as any).Game.creeps = {};

    runEconomy(world);
    state.srcEnergy = 2000;
    runEconomy(world);

    expect(ledger().W9N9).toBeUndefined();
  });

  it("远矿目标房采样（remoteOps 登记）", () => {
    const state = { srcEnergy: 3000, progress: 0 };
    const world = makeWorld("W37S57", state, false);
    (globalThis as any).Game.rooms = { W37S57: world };
    (globalThis as any).Memory = {
      rooms: { W37S58: { remoteOps: { W37S57: { state: "active" } } } },
      kernel: {},
    };
    (globalThis as any).Game.creeps = {};
    // Kernel.buildSnapshots 预构建的远矿目标集合 — 测试不走 Kernel，手动注入。
    globalCache().remoteTargetRooms = new Set(["W37S57"]);

    runEconomy(world);
    state.srcEnergy = 2950;
    runEconomy(world);

    expect(ledger().W37S57.harvested).toBe(50);
  });
});
