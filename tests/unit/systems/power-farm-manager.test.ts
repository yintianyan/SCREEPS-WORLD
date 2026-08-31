/** Power Farm Manager 系统生命周期测试（审计缺口 2）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { powerFarmManagerSystem } from "../../../src/systems/power-farm-manager";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { CONFIG } from "../../../src/config";
import { resetGlobals, syncSquadIndex } from "../../support/factories";

const HOME = "W7N4";
const TARGET = "W2N1";

function makeContext(tick: number): any {
  const snapshot = { roomName: HOME, energyCapacityAvailable: 1300 };
  return {
    tick,
    budget: { tier: "healthy" },
    globalSiteCount: 0,
    getSnapshot: vi.fn(() => snapshot),
    snapshots: vi.fn(function* () {
      yield snapshot;
    }),
  };
}

/** intel 里登记一个 PB 房（观察交接播种 → intelligence 采用）。 */
function seedIntel(tick: number): void {
  (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };
  __resetIntelStateForTests();
  globalCache().intelHandoff = [{
    subject: TARGET,
    home: HOME,
    source: "observer",
    payload: { kind: "highway", status: "normal", lastSeen: tick, powerBank: true } as never,
  }];
  intelligenceSystem.run({ tick, snapshots: () => [], budget: { canStart: () => true } } as never);
}

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Game.creeps = {};
  (globalThis as any).Game.rooms = {};
  (globalThis as any).Memory = {
    rooms: {},
    kernel: {},
    creeps: {},
  };
});

describe("power-farm-manager — 任务生命周期", () => {
  it("新鲜 intel PB → 建任务 + 提交 attacker/healer 编队请求", () => {
    seedIntel(1000);
    powerFarmManagerSystem.run(makeContext(1500));

    const mission = (globalThis as any).Memory.kernel.powerFarm;
    expect(mission).toBeDefined();
    expect(mission.targetRoom).toBe(TARGET);
    expect(mission.sponsor).toBe(HOME);
    expect(mission.phase).toBe("strike");

    const queue = (globalThis as any).Memory.rooms[HOME].spawnQueue;
    const roles = queue.map((r: any) => r.role);
    expect(roles).toContain("attacker");
    expect(roles).toContain("healer");
    // mission 标记分流（attacker/healer 战斗件）。
    expect(queue.every((r: any) => r.memory.mission === "powerBank")).toBe(true);
  });

  it("warPlan 存续 → 既有任务立即收摊让路", () => {
    seedIntel(1000);
    powerFarmManagerSystem.run(makeContext(1500));
    expect((globalThis as any).Memory.kernel.powerFarm).toBeDefined();

    // war 计划出现。
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W9N9",
      sponsor: HOME,
      squadSize: 3,
      since: 1500,
      towersSeen: 1,
    };
    syncSquadIndex();
    powerFarmManagerSystem.run(makeContext(1600));

    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
    // PB 寄宿请求全撤（war 编队请求不受影响 — 队列应为空，本测试无 war 请求）。
    expect((globalThis as any).Memory.rooms[HOME].spawnQueue).toHaveLength(0);
  });

  it("编队提供视野 + PB 消失 → phase=collect + 回收编队 + 孵 collector", () => {
    (globalThis as any).Memory.kernel.powerFarm = {
      targetRoom: TARGET,
      sponsor: HOME,
      since: 1000,
      spawned: 6,
      phase: "strike",
    };
    syncSquadIndex();
    (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };
    // 编队到达提供视野，房内已无 PB（击破/自灭）。
    (globalThis as any).Game.rooms[TARGET] = {
      name: TARGET,
      find: vi.fn(() => []),
    };
    syncSquadIndex();
    // 一只在途 attacker（应被回收）。
    (globalThis as any).Game.creeps = {
      "attacker-HOME-0-1000-x": {
        memory: { role: "attacker", mission: "powerBank", home: HOME, remoteTarget: TARGET },
      },
    };
    syncSquadIndex();

    powerFarmManagerSystem.run(makeContext(2000));

    const mission = (globalThis as any).Memory.kernel.powerFarm;
    expect(mission.phase).toBe("collect");
    // 战斗编队回收标记。
    const creep = (globalThis as any).Game.creeps["attacker-HOME-0-1000-x"];
    expect(creep.memory.recycle).toBe(true);
    // collector 已派。
    const queue = (globalThis as any).Memory.rooms[HOME].spawnQueue;
    expect(queue.some((r: any) => r.role === "pbCollector")).toBe(true);
    expect(mission.collectorSpawnedAt).toBe(2000);
  });

  it("超时 → 收摊清任务", () => {
    (globalThis as any).Memory.kernel.powerFarm = {
      targetRoom: TARGET,
      sponsor: HOME,
      since: 1000,
      spawned: 0,
      phase: "strike",
    };
    syncSquadIndex();
    (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };

    powerFarmManagerSystem.run(makeContext(1000 + CONFIG.powerFarm.missionTimeout + 1));

    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
  });

  it("止损：spawned 超编队 × 倍数 → 收摊清任务", () => {
    (globalThis as any).Memory.kernel.powerFarm = {
      targetRoom: TARGET,
      sponsor: HOME,
      since: 1000,
      // 编队 4+2=6，×2 倍数 → 13 触发止损。
      spawned: 13,
      phase: "strike",
    };
    syncSquadIndex();
    (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };

    powerFarmManagerSystem.run(makeContext(1500));

    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
  });
});
