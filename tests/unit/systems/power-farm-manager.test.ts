/** Power Farm Manager 系统生命周期测试（多任务并行版）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { powerFarmManagerSystem } from "../../../src/systems/military/power-farm-manager";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { CONFIG } from "../../../src/config";
import { resetGlobals, syncSquadIndex } from "../../support/factories";

const HOME = "W7N4";
const TARGET = "W6N3";

function makeContext(tick: number): any {
  // RCL7+ 容量（3 spawn）：让 PB 规划器能选出 10A/8H 档。
  // storage 带 boost 化合物库存：killWindow 由 creep 寿命反推后（750），
  // 裸 body 满足不了窗口 — PB 任务事实上以 boost 口径开立（XUH2O/XLHO2 原子对）。
  const snapshot = {
    roomName: HOME,
    energyCapacityAvailable: 3900,
    spawns: [{}, {}, {}],
    labs: [],
    terminal: undefined,
    factory: undefined,
    storage: {
      store: {
        energy: 50000,
        XUH2O: 1200, // 3×10A×30 + reserve(100) = 1000
        XLHO2: 1600, // 6×8H×30 + reserve(100) = 1540
        getUsedCapacity (this: Record<string, number>, res?: string) {
          return res === undefined ? 0 : (this[res] ?? 0);
        },
      },
    },
  };
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
    // 战斗编队标 powerBank；预置 collector 标 powerCollect。
    expect(
      queue
        .filter((r: any) => r.role === "attacker" || r.role === "healer")
        .every((r: any) => r.memory.mission === "powerBank"),
    ).toBe(true);
    expect(
      queue
        .filter((r: any) => r.role === "pbCollector")
        .every((r: any) => r.memory.mission === "powerCollect"),
    ).toBe(true);
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

  it("boost 化合物库存 → 任务按 boost 口径开立（boostPlanned + boostNeed 落任务）", () => {
    seedIntel(1000);
    powerFarmManagerSystem.run(makeContext(1500));

    const mission = (globalThis as any).Memory.kernel.powerFarmMissions[0];
    expect(mission.boostPlanned).toBe(true);
    // 3×10A×30 = 900；6×8H×30 = 1440（RCL7 容量 3900 的 boosted 编队）。
    expect(mission.boostNeed).toEqual({ attackUnits: 900, healUnits: 1440 });
    // kill 装进寿命：boost 后 3 攻击手 × 1200 dps → kill 556 + 通勤 300 + 余量 300 ≤ 1500。
    expect(mission.attackers).toBe(3);
    expect(mission.healers).toBe(6);
  });

  it("boost 化合物缺料 → 不开任务（裸 body 口径满足不了寿命反推的击杀窗口）", () => {
    seedIntel(1000);
    const ctx = makeContext(1500);
    ctx.getSnapshot().storage.store.XUH2O = 0;
    ctx.getSnapshot().storage.store.XLHO2 = 0;
    powerFarmManagerSystem.run(ctx);

    expect((globalThis as any).Memory.kernel.powerFarmMissions ?? []).toHaveLength(0);
  });

  it("boost 孵化闸：任务按 boost 口径规划但库存中途耗尽 → 不再补员战斗编队", () => {
    const g = globalThis as any;
    g.Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        spawned: 0,
        phase: "strike",
        attackers: 3,
        healers: 6,
        collectors: 5,
        boostPlanned: true,
        boostNeed: { attackUnits: 900, healUnits: 1440 },
      },
    ];
    g.Memory.rooms[HOME] = { spawnQueue: [] };
    g.Game.creeps = {};
    syncSquadIndex();
    const ctx = makeContext(1500);
    ctx.getSnapshot().storage.store.XUH2O = 0; // 中途耗尽
    powerFarmManagerSystem.run(ctx);

    const roles = g.Memory.rooms[HOME].spawnQueue.map((r: any) => r.role);
    expect(roles).not.toContain("attacker");
    expect(roles).not.toContain("healer");
    // collector 无 boost 语义，不受闸影响（预置仍推进）。
    expect(roles).toContain("pbCollector");
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

  it("止损：非寿终损失超编队 × 倍数 → 收摊清任务", () => {
    (globalThis as any).Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        losses: 13,
        spawned: 0,
        phase: "strike",
      },
    ];
    syncSquadIndex();
    (globalThis as any).Memory.rooms[HOME] = { spawnQueue: [] };

    powerFarmManagerSystem.run(makeContext(1500));

    expect((globalThis as any).Memory.kernel.powerFarmMissions).toHaveLength(0);
  });

  it("recycle 标记的编队不算在编 → 任务重新补员（不再空转）", () => {
    const g = globalThis as any;
    g.Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        spawned: 6,
        phase: "strike",
        attackers: 3,
        healers: 6,
      },
    ];
    g.Memory.rooms[HOME] = { spawnQueue: [] };
    g.Game.creeps = {};
    for (let i = 0; i < 3; i++) {
      g.Game.creeps[`attacker-${i}`] = {
        memory: {
          role: "attacker",
          home: HOME,
          remoteTarget: TARGET,
          mission: "powerBank",
          recycle: true,
        },
        body: [{ type: "attack", hits: 100 }],
        spawning: false,
        ticksToLive: 1000,
        hits: 100,
        hitsMax: 100,
      };
    }
    syncSquadIndex();

    powerFarmManagerSystem.run(makeContext(1500));

    // 3 只全在回收中 → live=0，必须重新提交补员；不能把它们当在编。
    const queue = g.Memory.rooms[HOME].spawnQueue;
    expect(queue.some((r: any) => r.role === "attacker")).toBe(true);
    expect(queue.some((r: any) => r.role === "healer")).toBe(true);
  });

  it("健康 recycle 编队被同目标任务复用：清除 recycle，不整套重孵", () => {
    const g = globalThis as any;
    g.Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        spawned: 0,
        phase: "strike",
        attackers: 3,
        healers: 6,
      },
    ];
    g.Memory.rooms[HOME] = { spawnQueue: [] };
    g.Game.rooms = { [HOME]: { controller: { my: true } } };
    const creep = {
      memory: {
        role: "attacker",
        home: HOME,
        remoteTarget: TARGET,
        mission: "powerBank",
        recycle: true,
      },
      body: [{ type: "attack", hits: 100 }],
      spawning: false,
      ticksToLive: 1000,
      hits: 1000,
      hitsMax: 1000,
    };
    g.Game.creeps = { "attacker-a": creep };
    syncSquadIndex();

    powerFarmManagerSystem.run(makeContext(1500));

    expect(creep.memory.recycle).toBe(false);
    // 复用 1 只 attacker → 仍需补 2 只攻击手与 6 只治疗手（每轮各补 1）。
    const queue = g.Memory.rooms[HOME].spawnQueue;
    expect(queue.some((r: any) => r.role === "healer")).toBe(true);
    expect(queue.some((r: any) => r.role === "attacker")).toBe(true);
  });

  it("收摊只撤销本任务目标的请求，不误删并行 PB 任务", () => {
    const g = globalThis as any;
    const other = "W3N1";
    const tick = 1500;
    g.Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: tick - CONFIG.powerFarm.missionTimeout - 1, // 超时
        spawned: 0,
        phase: "strike",
      },
      {
        targetRoom: other,
        sponsor: HOME,
        since: tick - 100, // 存活
        spawned: 0,
        phase: "strike",
      },
    ];
    const queue: any[] = [];
    queue.push({
      key: `pf-attacker-${HOME}-0-${TARGET}`,
      role: "attacker",
      home: HOME,
      memory: { role: "attacker", home: HOME, remoteTarget: TARGET, mission: "powerBank" },
    });
    queue.push({
      key: `pf-attacker-${HOME}-0-${other}`,
      role: "attacker",
      home: HOME,
      memory: { role: "attacker", home: HOME, remoteTarget: other, mission: "powerBank" },
    });
    g.Memory.rooms[HOME] = { spawnQueue: queue };
    syncSquadIndex();

    powerFarmManagerSystem.run(makeContext(tick));

    expect(queue.some(r => r.memory?.remoteTarget === TARGET)).toBe(false);
    expect(queue.some(r => r.memory?.remoteTarget === other)).toBe(true);
  });

  it("路线经过已知塔房 → 不建任务（不把编队送进塔下）", () => {
    const g = globalThis as any;
    g.Memory.rooms[HOME] = { spawnQueue: [] };
    __resetIntelStateForTests();
    globalCache().intelHandoff = [
      {
        subject: TARGET,
        home: HOME,
        source: "observer",
        payload: {
          kind: "highway",
          status: "normal",
          lastSeen: 1000,
          powerBank: true,
          powerBankHits: 2_000_000,
          powerBankPower: 5000,
        } as never,
      },
      {
        subject: "W7N3", // W7N4 → W6N3 的盒内中间房
        home: HOME,
        source: "observer",
        payload: {
          kind: "normal",
          status: "normal",
          lastSeen: 1000,
          towers: 3,
          owner: "enemy",
        } as never,
      },
    ];
    intelligenceSystem.run({
      tick: 1000,
      snapshots: () => [],
      budget: { canStart: () => true },
    } as never);

    powerFarmManagerSystem.run(makeContext(1500));

    expect(g.Memory.kernel.powerFarmMissions ?? []).toHaveLength(0);
  });

  it("strike 任务路线出现已知塔房 → 立即收摊止损", () => {
    const g = globalThis as any;
    g.Memory.kernel.powerFarmMissions = [
      {
        targetRoom: TARGET,
        sponsor: HOME,
        since: 1000,
        spawned: 6,
        phase: "strike",
        attackers: 3,
        healers: 6,
      },
    ];
    g.Memory.rooms[HOME] = { spawnQueue: [] };
    __resetIntelStateForTests();
    globalCache().intelHandoff = [
      {
        subject: "W7N3",
        home: HOME,
        source: "observer",
        payload: {
          kind: "normal",
          status: "normal",
          lastSeen: 1000,
          towers: 3,
          owner: "enemy",
        } as never,
      },
    ];
    intelligenceSystem.run({
      tick: 1000,
      snapshots: () => [],
      budget: { canStart: () => true },
    } as never);
    syncSquadIndex();

    powerFarmManagerSystem.run(makeContext(1500));

    expect(g.Memory.kernel.powerFarmMissions).toHaveLength(0);
  });

  it("孤儿编队自愈：无任务标记回收，带 power 的 collector 留下卸货", () => {
    const g = globalThis as any;
    g.Memory.kernel.powerFarmMissions = [];
    g.Memory.rooms[HOME] = { spawnQueue: [] };
    g.Game.creeps = {
      "attacker-orphan": {
        memory: { role: "attacker", mission: "powerBank", home: HOME, remoteTarget: TARGET },
        body: [{ type: "attack", hits: 100 }],
        spawning: false,
        ticksToLive: 1000,
        hits: 1000,
        hitsMax: 1000,
      },
      "collector-empty": {
        memory: { role: "pbCollector", mission: "powerCollect", home: HOME, remoteTarget: TARGET },
        body: [{ type: "carry", hits: 100 }],
        spawning: false,
        ticksToLive: 1000,
        store: { getUsedCapacity: () => 0 },
      },
      "collector-loaded": {
        memory: { role: "pbCollector", mission: "powerCollect", home: HOME, remoteTarget: TARGET },
        body: [{ type: "carry", hits: 100 }],
        spawning: false,
        ticksToLive: 1000,
        store: { getUsedCapacity: (r: string) => (r === "power" ? 500 : 0) },
      },
    };
    syncSquadIndex();

    powerFarmManagerSystem.run(makeContext(1500));

    expect(g.Game.creeps["attacker-orphan"].memory.recycle).toBe(true);
    expect(g.Game.creeps["collector-empty"].memory.recycle).toBe(true);
    // 已经抢到 power 的 collector 不能被回收（recyclePass 会连货销毁）。
    expect(g.Game.creeps["collector-loaded"].memory.recycle).toBeUndefined();
  });
});
