/** Power Farm Manager 系统生命周期测试（多任务并行版）。 */
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
  globalCache().intelHandoff = [
    {
      subject: TARGET,
      home: HOME,
      source: "observer",
      payload: { kind: "highway", status: "normal", lastSeen: tick, powerBank: true } as never,
    },
  ];
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

describe("power-farm-manager — 任务生命周期（多任务并行）", () => {
  it("新鲜 intel PB → 建任务 + 提交 attacker/healer 编队请求", () => {
    seedIntel(1000);
    powerFarmManagerSystem.run(makeContext(1500));

    const missions = (globalThis as any).Memory.kernel.powerFarmMissions;
    expect(missions).toBeDefined();
    expect(missions).toHaveLength(1);
    const mission = missions[0];
    expect(mission.targetRoom).toBe(TARGET);
    expect(mission.sponsor).toBe(HOME);
    expect(mission.phase).toBe("strike");

    const queue = (globalThis as any).Memory.rooms[HOME].spawnQueue;
    const roles = queue.map((r: any) => r.role);
    expect(roles).toContain("attacker");
    expect(roles).toContain("healer");
    expect(queue.every((r: any) => r.memory.mission === "powerBank")).toBe(true);
  });

  it("warPlan 存续 → 既有任务立即收摊让路", () => {
    seedIntel(1000);
    powerFarmManagerSystem.run(makeContext(1500));
    expect((globalThis as any).Memory.kernel.powerFarmMissions).toHaveLength(1);

    // war 计划出现。
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W9N9",
      sponsor: HOME,
      squadSize: 3,
      since: 1500,
      towersSeen: 1,
    };
    (globalThis as any).Memory.kernel.strategy = { posture: "war" };
    syncSquadIndex();
    powerFarmManagerSystem.run(makeContext(1600));

    expect((globalThis as any).Memory.kernel.powerFarmMissions).toHaveLength(0);
    expect((globalThis as any).Memory.rooms[HOME].spawnQueue).toHaveLength(0);
  });

  it("编队提供视野 + PB 消失 → phase=collect + 回收编队 + 孵 collector", () => {
    (globalThis as any).Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        spawned: 6,
        phase: "strike",
      },
    ];
    syncSquadIndex();
    (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };
    (globalThis as any).Game.rooms[TARGET] = {
      name: TARGET,
      find: vi.fn(() => []),
    };
    syncSquadIndex();
    (globalThis as any).Game.creeps = {
      "attacker-HOME-0-1000-x": {
        memory: { role: "attacker", mission: "powerBank", home: HOME, remoteTarget: TARGET },
      },
    };
    syncSquadIndex();

    powerFarmManagerSystem.run(makeContext(2000));

    const missions = (globalThis as any).Memory.kernel.powerFarmMissions;
    expect(missions).toHaveLength(1);
    const mission = missions[0];
    expect(mission.phase).toBe("collect");
    const creep = (globalThis as any).Game.creeps["attacker-HOME-0-1000-x"];
    expect(creep.memory.recycle).toBe(true);
    const queue = (globalThis as any).Memory.rooms[HOME].spawnQueue;
    expect(queue.some((r: any) => r.role === "pbCollector")).toBe(true);
    expect(mission.collectorSpawnedAt).toBe(2000);
  });

  it("超时 → 收摊清任务", () => {
    (globalThis as any).Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        spawned: 0,
        phase: "strike",
      },
    ];
    syncSquadIndex();
    (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };

    powerFarmManagerSystem.run(makeContext(1000 + CONFIG.powerFarm.missionTimeout + 1));

    expect((globalThis as any).Memory.kernel.powerFarmMissions).toHaveLength(0);
  });

  it("止损：spawned 超编队 × 倍数 → 收摊清任务", () => {
    (globalThis as any).Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        spawned: 13,
        phase: "strike",
      },
    ];
    syncSquadIndex();
    (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };

    powerFarmManagerSystem.run(makeContext(1500));

    expect((globalThis as any).Memory.kernel.powerFarmMissions).toHaveLength(0);
  });
});
