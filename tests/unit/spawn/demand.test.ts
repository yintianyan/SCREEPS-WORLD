/**
 * Spawn 需求评估测试（A2 升级功率 + A4 替换路程项）。
 *
 * 覆盖：
 *   - storage 水位三档：冲刺（≥50k）/ 维持（≥10k）/ 低水位（<10k）
 *   - RCL8 升级功率显式封顶 15 WORK
 *   - 无 storage 时保留早期猛冲梯度
 *   - 替换阈值计入 spawn→source 通勤路程
 */
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateDemand, estimateTravelTicks, needsReplacement } from "../../../src/domain/spawn/demand";
import { mockController, mockCreep, mockSnapshot, mockSource, mockStructure, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 造一个有一台存活 harvester 的最小场景，避免触发 P0 恢复 worker 短路。 */
function livingHarvester() {
  return [
    {
      name: "harvester_1",
      role: "harvester",
      home: "W7N4",
      ticksToLive: 1200,
      bodyLength: 7,
      sourceId: "source_1" as Id<Source>,
      spawnIndex: 0,
    },
  ];
}

const normalCtx = (pressure = 0) => ({
  colonyState: "normal" as const,
  controllerDowngradeRisk: false,
  energyAvailable: 2000,
  economyPressure: pressure,
});

function stationSnapshot(overrides: Parameters<typeof mockSnapshot>[0]) {
  const ctrlContainer = mockStructure("container", { id: "cc", energy: 1000, capacity: 2000 });
  return mockSnapshot({
    controller: mockController({ level: 6 }),
    controllerContainer: ctrlContainer,
    ...overrides,
  });
}

describe("A2 — storage 水位驱动升级功率", () => {
  it("冲刺：storage ≥ 50k 且健康 → 2 个大 body upgrader（烧库存换 RCL）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 6, energyCapacityAvailable: 2300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const upgraders = requests.filter(r => r.role === "upgrader");
    expect(upgraders).toHaveLength(2);
    expect(upgraders[0]!.body.filter(p => p === "work")).toHaveLength(15);
  });

  it("维持：storage ≥ 10k → 1 个大 body upgrader（≈15/tick 吃满盈余）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 6, energyCapacityAvailable: 2300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const upgraders = requests.filter(r => r.role === "upgrader");
    expect(upgraders).toHaveLength(1);
    expect(upgraders[0]!.body.filter(p => p === "work")).toHaveLength(15);
  });

  it("低水位：storage < 10k 且 pressure > 0.5 → 停升级攒库存", () => {
    const storage = mockStructure("storage", { id: "st", energy: 5000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 6, energyCapacityAvailable: 2300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.6), 1000);

    expect(requests.filter(r => r.role === "upgrader")).toHaveLength(0);
  });

  it("无 storage（RCL3）：保留早期猛冲梯度，station 在线且健康 → maxCount", () => {
    const snap = stationSnapshot({ storage: undefined, rcl: 3, energyCapacityAvailable: 800 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    expect(requests.filter(r => r.role === "upgrader")).toHaveLength(3);
  });

  it("RCL8 显式限速：即使冲刺水位，upgrader 也封顶 15 WORK（1 个 15W body）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 8, energyCapacityAvailable: 12300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const upgraders = requests.filter(r => r.role === "upgrader");
    expect(upgraders).toHaveLength(1);
    expect(upgraders[0]!.body.filter(p => p === "work")).toHaveLength(15);
  });
});

describe("A4 — 替换阈值计入通勤路程", () => {
  it("needsReplacement：阈值 = bodyLength*3 + buffer + travelTicks", () => {
    // body 7 部件 → 孵化 21 tick；buffer 15；travel 30 → 阈值 66。
    expect(needsReplacement(66, 7, 30)).toBe(true);
    expect(needsReplacement(67, 7, 30)).toBe(false);
    // 无路程项时维持原阈值 36。
    expect(needsReplacement(36, 7)).toBe(true);
    expect(needsReplacement(37, 7)).toBe(false);
  });

  it("estimateTravelTicks：spawn→source Chebyshev 距离 × 1.5，无 source 为 0", () => {
    const spawn = mockStructure("spawn", { id: "sp", energy: 300 });
    const source = mockSource("s_far");
    spawn.pos.getRangeTo = () => 20;
    const snap = mockSnapshot({ spawns: [spawn], sources: [source] });

    expect(estimateTravelTicks(snap, "s_far" as Id<Source>)).toBe(30);
    expect(estimateTravelTicks(snap, undefined)).toBe(0);
    expect(estimateTravelTicks(snap, "nonexistent" as Id<Source>)).toBe(0);
  });

  it("远端矿工更早触发替换请求（路程计入阈值）", () => {
    const spawn = mockStructure("spawn", { id: "sp", energy: 300 });
    spawn.pos.getRangeTo = () => 20; // travel = 30
    const source = mockSource("source_1");
    const snap = mockSnapshot({ spawns: [spawn], sources: [source] });

    // ttl=60：无路程阈值(7*3+15=36)不触发；含路程(66)触发。
    const dyingMiner = {
      name: "harvester_old",
      role: "harvester",
      home: "W7N4",
      ticksToLive: 60,
      bodyLength: 7,
      sourceId: "source_1" as Id<Source>,
      spawnIndex: 0,
    };
    const { requests } = evaluateDemand(snap, [], "normal", [dyingMiner], [], normalCtx(0), 1000);

    expect(requests.some(r => r.role === "harvester" && r.replaceBy !== undefined)).toBe(true);
  });
});

describe("P3 — RCL5+ Link-aware hauler 需求", () => {
  /** 造一个 storage + storage link（紧邻 storage）的场景。 */
  function linkSnapshot(opts: {
    storageEnergy?: number;
    storageLinkEnergy?: number;
    storageLinkCapacity?: number;
    containers?: { energy: number; capacity: number }[];
    rcl?: number;
  }): ReturnType<typeof mockSnapshot> {
    const storage = mockStructure("storage", {
      id: "st",
      energy: opts.storageEnergy ?? 50000,
      capacity: 1000000,
    });
    // storage link 紧邻 storage（range <= 2）
    const storageLink = mockStructure("link", {
      id: "slink",
      energy: opts.storageLinkEnergy ?? 0,
      capacity: opts.storageLinkCapacity ?? 800,
    });
    storageLink.pos.getRangeTo = () => 1;
    storage.pos.getRangeTo = () => 1;

    const containers = (opts.containers ?? []).map((c, i) =>
      mockStructure("container", { id: `c${i}`, energy: c.energy, capacity: c.capacity }),
    );

    return mockSnapshot({
      storage,
      links: [storageLink],
      containers,
      rcl: opts.rcl ?? 5,
      energyCapacityAvailable: 2300,
      controller: mockController({ level: opts.rcl ?? 5 }),
    });
  }

  it("storage link > 80% 满 → 贡献 +2 hauler 需求（link 网络需要排空）", () => {
    const snap = linkSnapshot({ storageLinkEnergy: 700, storageLinkCapacity: 800 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    // 无 container 积压 + storage link > 80% → +2 → clamp to minCount=2
    expect(haulers).toHaveLength(2);
  });

  it("storage link 40-80% 满 → 贡献 +1 hauler 需求", () => {
    const snap = linkSnapshot({ storageLinkEnergy: 400, storageLinkCapacity: 800 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    // storage link 50% → +1 → clamp to minCount=2
    expect(haulers).toHaveLength(2);
  });

  it("storage link < 40% + 无 container 积压 → 仅 minCount 兜底（link 在线，工作量减少）", () => {
    const snap = linkSnapshot({ storageLinkEnergy: 100, storageLinkCapacity: 800 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    // storage link 12.5% → +0 → clamp to minCount=2
    expect(haulers).toHaveLength(2);
  });

  it("container 积压 + storage link 积压 → 信号叠加（两处都需要 hauler）", () => {
    const snap = linkSnapshot({
      storageLinkEnergy: 700, // > 80% → +2
      containers: [
        { energy: 1700, capacity: 2000 }, // > 80% → +2
      ],
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    // container +2 + storage link +2 = 4 → clamp to maxCount=6
    expect(haulers).toHaveLength(4);
  });

  it("无 storage link（RCL4 以下）→ 仅看 container 信号，行为不变", () => {
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    const snap = mockSnapshot({
      storage,
      links: [], // 无 link
      containers: [
        mockStructure("container", { id: "c0", energy: 1700, capacity: 2000 }),
      ],
      rcl: 4,
      energyCapacityAvailable: 1300,
      controller: mockController({ level: 4 }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    // 仅 container > 80% → +2 → clamp to minCount=2
    expect(haulers).toHaveLength(2);
  });

  it("storage link 不紧邻 storage（range > 2）→ 不计入信号（非 storage link）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    const farLink = mockStructure("link", { id: "farlink", energy: 700, capacity: 800 });
    farLink.pos.getRangeTo = () => 5; // 太远，不算 storage link
    storage.pos.getRangeTo = () => 5;

    const snap = mockSnapshot({
      storage,
      links: [farLink],
      containers: [],
      rcl: 5,
      energyCapacityAvailable: 2300,
      controller: mockController({ level: 5 }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    // 非 storage link → 不贡献 → clamp to minCount=2
    expect(haulers).toHaveLength(2);
  });
});

describe("防御响应 — 威胁触发 defender 孵化", () => {
  /** 造 n 个最小威胁 creep 摘要（demand 只消费 threatCreeps.length）。 */
  const threats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `hostile_${i}` }) as unknown as Creep);

  it("房内出现威胁时按威胁数生成 P1 defender 请求", () => {
    const snap = mockSnapshot({ threatCreeps: threats(1) });
    const { requests } = evaluateDemand(snap, [], "defense", livingHarvester(), [], normalCtx(0), 1000);

    const defenders = requests.filter(r => r.role === "defender");
    expect(defenders).toHaveLength(1);
    expect(defenders[0]!.priority).toBe(1);
    expect(defenders[0]!.body).toContain("attack");
  });

  it("defender 数量受 maxCount 封顶（威胁再多也不超编）", () => {
    const snap = mockSnapshot({ threatCreeps: threats(5) });
    const { requests } = evaluateDemand(snap, [], "defense", livingHarvester(), [], normalCtx(0), 1000);

    // CONFIG.roles.defender.maxCount = 2
    expect(requests.filter(r => r.role === "defender")).toHaveLength(2);
  });

  it("无威胁时不生成 defender", () => {
    const snap = mockSnapshot({});
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "defender")).toHaveLength(0);
  });

  it("存活 defender 计入总数，不重复孵化", () => {
    const snap = mockSnapshot({ threatCreeps: threats(1) });
    const living = [
      ...livingHarvester(),
      { name: "defender_1", role: "defender", home: "W7N4", ticksToLive: 1000, bodyLength: 4, spawnIndex: 0 },
    ];
    const { requests } = evaluateDemand(snap, [], "defense", living, [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "defender")).toHaveLength(0);
  });
});
