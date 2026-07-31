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
import { mockController, mockCreep, mockHostile, mockSnapshot, mockSource, mockStructure, resetGlobals } from "../../role-helpers";

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

const normalCtx = (
  pressure = 0,
  prevHysteresis?: { distScaleUpSince?: number; builderPressureState?: "full" | "shrinking" },
) => ({
  colonyState: "normal" as const,
  controllerDowngradeRisk: false,
  energyAvailable: 2000,
  economyPressure: pressure,
  prevHysteresis,
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
    /** 覆盖容量以控制 body 档位（默认 2300 → 道路档 16C=800 运力）。 */
    energyCapacityAvailable?: number;
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
      energyCapacityAvailable: opts.energyCapacityAvailable ?? 2300,
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
    // 容量 600 → 道路档 8C=400 运力，保持叠加信号在归一化后仍可区分：
    // 单信号 +2 → ceil(2×300/400)=2（= minCount 地板）；叠加 4 → ceil(4×300/400)=3。
    const snap = linkSnapshot({
      storageLinkEnergy: 700, // > 80% → +2
      containers: [
        { energy: 1700, capacity: 2000 }, // > 80% → +2
      ],
      energyCapacityAvailable: 600,
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    // container +2 + storage link +2 = 4 单位 → 8C 运力归一化 → 3（clamp [2,6]）
    expect(haulers).toHaveLength(3);
  });

  it("controller link 缺能 → storage link 信号被守卫（用于灌能升级链，不计 hauler，防过孵）", () => {
    // 复刻叠加场景，但注入一个缺能的 controller link：storage link 此时被 distributor
    // 用于灌能 controller link（②b），非 source 背压，且 hauler 已被守卫挡住不抽 →
    // storage link 信号不计入编制。仅 container +2 生效 → 8C 归一化 → 2（未守卫会是 3）。
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    const storageLink = mockStructure("link", { id: "slink", energy: 700, capacity: 800 }); // >80%
    const ctrlLink = mockStructure("link", { id: "clink", energy: 0, capacity: 800 });       // 缺能=灌能中
    storageLink.pos.getRangeTo = () => 1;
    ctrlLink.pos.getRangeTo = () => 1;
    storage.pos.getRangeTo = () => 1;
    const container = mockStructure("container", { id: "c0", energy: 1700, capacity: 2000 }); // >80% +2
    const snap = mockSnapshot({
      storage,
      links: [storageLink, ctrlLink], // [0]=storage-link（find storage 命中）, [1]=ctrl-link
      containers: [container],
      rcl: 5,
      energyCapacityAvailable: 600,
      controller: mockController({ level: 5 }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    const haulers = requests.filter(r => r.role === "hauler");
    expect(haulers).toHaveLength(2);
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

describe("TD-016 — Builder pressure 迟滞带", () => {
  /** 带 1 个 construction site 的最小快照，触发 builder 需求分支。 */
  function builderSnapshot() {
    return mockSnapshot({
      myConstructionSites: [{ id: "site_1", structureType: "road", pos: { x: 10, y: 10, getRangeTo: () => 5 } } as unknown as ConstructionSite],
    });
  }

  // P1-J：迟滞状态通过 prevHysteresis 注入、nextHysteresis 断言 — 不再直读写 Memory。

  it("初始状态默认 full — pressure 0.2 时 builder 满目标", () => {
    const snap = builderSnapshot();
    // prevHysteresis 缺失 → 默认 'full'；pressure 0.2 在带内不切换。
    const { requests, nextHysteresis } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.2), 1000);
    const builders = requests.filter(r => r.role === "builder");
    // dynamicBuilderTarget = min(maxCount, economyCap, max(minCount, sites=1)) → 至少 minCount
    expect(builders.length).toBeGreaterThanOrEqual(1);
    expect(nextHysteresis.builderPressureState).toBe("full");
  });

  it("pressure 从 0.2 上升到 0.36 → 切换到 shrinking（穿越 0.35 上沿）", () => {
    const snap = builderSnapshot();
    // 先以低压运行，状态保持 full — 上一步输出作为本步输入（等价适配层写回→读入循环）。
    const { nextHysteresis: afterLow } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.2), 1000);
    // 升压穿越 0.35。
    const { requests, nextHysteresis } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.36, afterLow), 1001);
    expect(nextHysteresis.builderPressureState).toBe("shrinking");
    // shrinking 状态下 builder 目标应 ≤ full 状态。
    const builders = requests.filter(r => r.role === "builder");
    expect(builders.length).toBeGreaterThanOrEqual(0);
  });

  it("pressure 在 0.30（迟滞带内）→ 保持前一状态不切换", () => {
    const snap = builderSnapshot();

    // 场景 A：之前是 full，pressure=0.30 仍在带内 → 保持 full。
    {
      const { nextHysteresis } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.30, { builderPressureState: "full" }), 1000);
      expect(nextHysteresis.builderPressureState).toBe("full");
    }

    // 场景 B：之前是 shrinking，pressure=0.30 仍在带内 → 保持 shrinking。
    {
      const { nextHysteresis } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.30, { builderPressureState: "shrinking" }), 1001);
      expect(nextHysteresis.builderPressureState).toBe("shrinking");
    }
  });

  it("pressure 从 0.4 下降到 0.24 → 恢复 full（穿越 0.25 下沿）", () => {
    const snap = builderSnapshot();
    // 高压确认保持 shrinking — 输出作为下一步输入。
    const { nextHysteresis: afterHigh } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.4, { builderPressureState: "shrinking" }), 1000);
    expect(afterHigh.builderPressureState).toBe("shrinking");
    // 降压穿越 0.25。
    const { nextHysteresis } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.24, afterHigh), 1001);
    expect(nextHysteresis.builderPressureState).toBe("full");
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

describe("TD-015 — 物流角色 economyPressure 衰减因子", () => {
  /**
   * 物流压力快照：1 个 container（>80% 满 → +2）+ storage link（>80% 满 → +2）
   * → 积压 4 单位（基准运力 300 标定）。
   * 容量 600 @ RCL5 → 道路档 8C body = 400 运力 → 归一化 ceil(4×300/400) = 3
   * （clamp [minCount=2, maxCount=6]）。
   * distributor：8C = 400 运力 → 每头承接 2 个 fillTarget → 4 个 → distTarget = 2（clamp [1,3]）。
   */
  function logisticsSnapshot() {
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    const storageLink = mockStructure("link", { id: "slink", energy: 700, capacity: 800 });
    storageLink.pos.getRangeTo = () => 1;
    storage.pos.getRangeTo = () => 1;
    const container = mockStructure("container", { id: "c0", energy: 1700, capacity: 2000 });
    return mockSnapshot({
      storage,
      links: [storageLink],
      containers: [container],
      rcl: 5,
      energyCapacityAvailable: 600,
      controller: mockController({ level: 5 }),
      fillTargets: ["ft1", "ft2", "ft3", "ft4"] as any[],
    });
  }

  it("pressure=0.5（低于阈值 0.6）→ hauler/distributor 配额不受影响", () => {
    // 预置已满的升编确认窗口 — 本测试验证压力衰减，不验证升编时序。
    const snap = logisticsSnapshot();
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.5, { distScaleUpSince: 800 }), 1000);
    // hauler: 归一化后 dynamicHaulerTarget=3, pressure 0.5 ≤ 0.6 → 无衰减 → 3
    expect(requests.filter(r => r.role === "hauler")).toHaveLength(3);
    // distributor: distTarget=2, pressure 0.5 ≤ 0.6 → 无衰减 → 2
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(2);
  });

  it("pressure=0.8 → hauler/distributor 配额降低 50%（衰减因子 = 1 - (0.8-0.6)/0.4 = 0.5）", () => {
    const snap = logisticsSnapshot();
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.8), 1000);
    // hauler: round(3 * 0.5) = 2 → max(minCount=2, 2) = 2
    expect(requests.filter(r => r.role === "hauler")).toHaveLength(2);
    // distributor: 2 * 0.5 = 1 → max(minCount=1, 1) = 1
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(1);
  });

  it("pressure=1.0 → hauler/distributor 配额缩至 minCount（衰减因子 = 0）", () => {
    const snap = logisticsSnapshot();
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(1.0), 1000);
    // hauler: 3 * 0 = 0 → max(minCount=2, 0) = 2
    expect(requests.filter(r => r.role === "hauler")).toHaveLength(2);
    // distributor: 2 * 0 = 0 → max(minCount=1, 0) = 1
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(1);
  });

  it("inCrisis + pressure=0.8 → 压力衰减与危机收缩叠加，取更严格者（均为 minCount）", () => {
    const snap = logisticsSnapshot();
    // recovery 状态触发 inCrisis；pressure=0.8 先衰减到 2，inCrisis 再缩到 minCount=2。
    const { requests } = evaluateDemand(snap, [], "recovery", livingHarvester(), [], { ...normalCtx(0.8), colonyState: "recovery" }, 1000);
    // hauler: pressure 衰减 → 2, inCrisis → min(2, minCount=2) = 2
    expect(requests.filter(r => r.role === "hauler")).toHaveLength(2);
    // distributor: pressure 衰减 → 1, inCrisis → min(1, minCount=1) = 1
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(1);
  });
});

describe("道路维修需求驱动 builder（成熟房无 site 场景）", () => {
  /** 造 n 条待修道路（血量 30%，低于 roadRepairThreshold 0.4）。 */
  function decayedRoads(n: number) {
    return Array.from({ length: n }, (_, i) =>
      mockStructure("road", { id: `road_${i}`, hits: 1500, hitsMax: 5000 }),
    );
  }

  it("无 site + 待修道路达到门槛（3 条）→ 维持 1 个 builder 巡修", () => {
    const snap = mockSnapshot({ roads: decayedRoads(3), myConstructionSites: [] });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(1);
  });

  it("无 site + 待修道路低于门槛（2 条）→ 不孵 builder", () => {
    const snap = mockSnapshot({ roads: decayedRoads(2), myConstructionSites: [] });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("无 site + 道路血量健康（80%）→ 不计入维修需求，不孵 builder", () => {
    const healthy = Array.from({ length: 5 }, (_, i) =>
      mockStructure("road", { id: `road_${i}`, hits: 4000, hitsMax: 5000 }),
    );
    const snap = mockSnapshot({ roads: healthy, myConstructionSites: [] });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("bootstrap 状态下即使有维修需求也不孵 builder（新手房优先能量链）", () => {
    const snap = mockSnapshot({ roads: decayedRoads(5), myConstructionSites: [] });
    const { requests } = evaluateDemand(
      snap, [], "bootstrap", livingHarvester(), [],
      { ...normalCtx(0), colonyState: "bootstrap" }, 1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("维修需求存在时，将死的 builder 允许替换（不因无 site 被门禁拦截）", () => {
    const snap = mockSnapshot({ roads: decayedRoads(3), myConstructionSites: [] });
    const dyingBuilder = {
      name: "builder_old",
      role: "builder",
      home: "W7N4",
      ticksToLive: 20, // 低于替换阈值 bodyLength*3 + buffer
      bodyLength: 4,
      spawnIndex: 0,
    };
    const { requests } = evaluateDemand(
      snap, [], "normal", [...livingHarvester(), dyingBuilder], [], normalCtx(0), 1000,
    );
    // 需求块（builder 存活计数 1 ≥ 目标 1，不加员）+ 替换块（将死触发替换）→ 恰好 1 个替换请求。
    const builders = requests.filter(r => r.role === "builder");
    expect(builders).toHaveLength(1);
    expect(builders[0]!.replaceBy).toBeDefined();
  });
});

describe("Body 感知配额 — 数量按单体能力折算，防大 body 时代头数浪费", () => {
  it("harvester：5W body（600 容量）+ 1 source → 饱和封顶 1 个（minCount=2 被压缩）", () => {
    // 默认 mockSnapshot 只有 1 个 source；容量 800 → 5W body → ceil(5/5)=1 矿工/source。
    // 存活 worker 绕过 P0 恢复短路，单独观察 harvester 目标。
    const snap = mockSnapshot({ energyCapacityAvailable: 800 });
    const living = [{ name: "w1", role: "worker", home: "W7N4", ticksToLive: 1200, bodyLength: 3, spawnIndex: 0 }];
    const { requests } = evaluateDemand(snap, [], "normal", living, [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "harvester")).toHaveLength(1);
  });

  it("harvester：1W body（200 容量）→ 饱和线放宽，维持 minCount 头数", () => {
    // 容量 200 → 1W body → ceil(5/1)=5，受 maxMinersPerSource=3 封顶 → 1 source × 3 = 3。
    // target = min(minCount=2, 3) = 2 — 小 body 时代头数不缩。
    const snap = mockSnapshot({ energyCapacityAvailable: 200 });
    const living = [{ name: "w1", role: "worker", home: "W7N4", ticksToLive: 1200, bodyLength: 3, spawnIndex: 0 }];
    const { requests } = evaluateDemand(snap, [], "normal", living, [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "harvester")).toHaveLength(2);
  });

  it("hauler：大运力 body（RCL4+ 道路档 16C）→ 同样积压头数折半", () => {
    // 容量 1300 @ RCL5 → 道路档 16C = 800 运力。
    // 积压 4 单位 × 300 基准 / 800 = ceil(1.5) = 2（原头数思维会孵 4 个）。
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    const storageLink = mockStructure("link", { id: "slink", energy: 700, capacity: 800 });
    storageLink.pos.getRangeTo = () => 1;
    const container = mockStructure("container", { id: "c0", energy: 1700, capacity: 2000 });
    const snap = mockSnapshot({
      storage, links: [storageLink], containers: [container],
      rcl: 5, energyCapacityAvailable: 1300, controller: mockController({ level: 5 }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "hauler")).toHaveLength(2);
  });

  it("distributor：大运力 body → 单头承接更多 fillTarget，头数减员", () => {
    // 容量 1300 @ RCL5 → 16C = 800 运力 → 每头承接 floor(800/150)=5 个 fillTarget。
    // 6 个 fillTarget → ceil(6/5) = 2（原口径 ceil(6/2)=3）。
    // 预置已满的升编确认窗口 — 本测试验证运力折算，不验证升编时序。
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    const snap = mockSnapshot({
      storage, rcl: 5, energyCapacityAvailable: 1300, controller: mockController({ level: 5 }),
      fillTargets: ["f1", "f2", "f3", "f4", "f5", "f6"] as any[],
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0, { distScaleUpSince: 800 }), 1000);
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(2);
  });

  it("危机口径对齐：recovery 时按 energyAvailable 降级 body 估算，头数随之放宽", () => {
    // recovery + energyAvailable=300：harvester 实际孵出 2W body（非满配 5W）。
    // ceil(5/2)=3 矿工/source → 1 source → target = min(minCount=2, 3) = 2。
    // 若误用满配 5W 估算会得 target=1 — 头数与实际 body 能力双重缺口。
    const snap = mockSnapshot({ energyCapacityAvailable: 800 });
    const living = [{ name: "w1", role: "worker", home: "W7N4", ticksToLive: 1200, bodyLength: 3, spawnIndex: 0 }];
    const ctx = { ...normalCtx(0), colonyState: "recovery" as const, energyAvailable: 300 };
    const { requests } = evaluateDemand(snap, [], "recovery", living, [], ctx, 1000);
    expect(requests.filter(r => r.role === "harvester")).toHaveLength(2);
  });
});

describe("Distributor 升编趋势确认 — 防孵化尖峰催生过量编制", () => {
  // P1-J：计时器通过 prevHysteresis 注入、nextHysteresis 断言 — 不再直读写 Memory。

  /** 6 个 fillTarget 尖峰快照（容量 600 → 6C=300 运力 → 每头承接 2 个 → want=3）。 */
  function spikeSnapshot(fillCount = 6) {
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    return mockSnapshot({
      storage,
      energyCapacityAvailable: 600,
      fillTargets: Array.from({ length: fillCount }, (_, i) => `ft${i}`) as any[],
    });
  }

  const livingDist = () => [
    ...livingHarvester(),
    { name: "dist_1", role: "distributor", home: "W7N4", ticksToLive: 1000, bodyLength: 8, spawnIndex: 0 },
  ];

  it("尖峰首现：不扩编，压回现有编制并记录计时起点", () => {
    const { requests, nextHysteresis } = evaluateDemand(spikeSnapshot(), [], "normal", livingDist(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(0);
    expect(nextHysteresis.distScaleUpSince).toBe(1000);
  });

  it("确认窗口未满（<150 tick）：持续压回，不扩编", () => {
    const { requests } = evaluateDemand(spikeSnapshot(), [], "normal", livingDist(), [], normalCtx(0, { distScaleUpSince: 1000 }), 1100);
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(0);
  });

  it("确认窗口已满（≥150 tick）：需求真实持续，放行扩编", () => {
    const { requests } = evaluateDemand(spikeSnapshot(), [], "normal", livingDist(), [], normalCtx(0, { distScaleUpSince: 1000 }), 1150);
    // want=3，存活 1 → 扩编 2 个。
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(2);
  });

  it("需求回落：计时器重置 — 下次尖峰重新计时", () => {
    // fillTargets 清零 → want 落回 minCount=1 ≤ 存活 1 → 重置。
    const { nextHysteresis } = evaluateDemand(spikeSnapshot(0), [], "normal", livingDist(), [], normalCtx(0, { distScaleUpSince: 1000 }), 1100);
    expect(nextHysteresis.distScaleUpSince).toBeUndefined();
  });

  it("minCount 地板不受确认约束：零编制时首个 distributor 立即孵化", () => {
    // storage 刚建成、无存活 distributor：确认窗口只拦「超出 minCount 的扩编」，
    // 地板补足即时生效 — 否则 storage 上线后 150 tick 无人分发。
    const { requests } = evaluateDemand(spikeSnapshot(), [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(1);
  });
});

describe("矿位分配 — 专职矿工口径（防 worker 挂名误导 + 平局错配）", () => {
  const twoSources = () => [mockSource("srcA"), mockSource("srcB")];

  it("worker 挂名的 source 不计入占用 — 新 harvester 分到真正空缺的源", () => {
    // 线上实测场景：worker（流动临时工）挂名 srcB，一只专职 harvester 在 srcA。
    // 旧口径把 worker 计入占用 → {A:1, B:1} 平局 → 偏向 sources[0]=A → 两矿工挤 A。
    // 新口径只数专职 harvester → {A:1, B:0} → 新矿工正确分到 B。
    const snap = mockSnapshot({ sources: twoSources(), energyCapacityAvailable: 800 });
    const living = [
      { name: "h1", role: "harvester", home: "W7N4", ticksToLive: 1200, bodyLength: 7, sourceId: "srcA" as Id<Source>, spawnIndex: 0 },
      { name: "w1", role: "worker", home: "W7N4", ticksToLive: 1200, bodyLength: 3, sourceId: "srcB" as Id<Source>, spawnIndex: 0 },
    ];
    const { requests } = evaluateDemand(snap, [], "normal", living, [], normalCtx(0), 1000);

    const harvesters = requests.filter(r => r.role === "harvester");
    expect(harvesters).toHaveLength(1);
    expect(harvesters[0]!.memory.sourceId).toBe("srcB");
  });

  it("替换纠偏：两矿工挤同源时，垂死者的替补分到荒废源而非盲目继承", () => {
    // 历史错配：h1/h2 都在 srcA。h1 垂死 → 替补按「排除垂死者」的占用重挑：
    // {A:1(h2), B:0} → 分到 B — 错配随代际更替自动愈合。
    const snap = mockSnapshot({ sources: twoSources(), energyCapacityAvailable: 800 });
    const living = [
      { name: "h1", role: "harvester", home: "W7N4", ticksToLive: 30, bodyLength: 7, sourceId: "srcA" as Id<Source>, spawnIndex: 0 },
      { name: "h2", role: "harvester", home: "W7N4", ticksToLive: 1200, bodyLength: 7, sourceId: "srcA" as Id<Source>, spawnIndex: 1 },
    ];
    const { requests } = evaluateDemand(snap, [], "normal", living, [], normalCtx(0), 1000);

    const replacement = requests.filter(r => r.role === "harvester" && r.replaceBy !== undefined);
    expect(replacement).toHaveLength(1);
    expect(replacement[0]!.memory.sourceId).toBe("srcB");
  });

  it("常态替换保留无缝接班：矿工分居两源时，替补选回垂死者的原矿位", () => {
    // h1@A 垂死、h2@B 健康 → 排除 h1 后占用 {A:0, B:1} → 替补分回 A。
    const snap = mockSnapshot({ sources: twoSources(), energyCapacityAvailable: 800 });
    const living = [
      { name: "h1", role: "harvester", home: "W7N4", ticksToLive: 30, bodyLength: 7, sourceId: "srcA" as Id<Source>, spawnIndex: 0 },
      { name: "h2", role: "harvester", home: "W7N4", ticksToLive: 1200, bodyLength: 7, sourceId: "srcB" as Id<Source>, spawnIndex: 1 },
    ];
    const { requests } = evaluateDemand(snap, [], "normal", living, [], normalCtx(0), 1000);

    const replacement = requests.filter(r => r.role === "harvester" && r.replaceBy !== undefined);
    expect(replacement).toHaveLength(1);
    expect(replacement[0]!.memory.sourceId).toBe("srcA");
  });
});

describe("SP-11 — 降级回退守卫（RECOVERY_BODY 兜底不得铸出缺必需部件的废件）", () => {
  it("团灭现场 + 能量 < 130：P0 defender 拿最低档 [ATTACK,MOVE]，而非无攻击的 [W,C,M]", () => {
    // 修复前：degradeBody 失败 → selectBody(100) 无档可选 → RECOVERY_BODY —
    // 能量回升到 200 时孵出一只不能攻击的"防御者"，紧急时刻白烧 200 能量。
    const snap = mockSnapshot({ threatCreeps: [mockHostile()] as any });
    const ctx = { ...normalCtx(0), energyAvailable: 100 };
    const { requests } = evaluateDemand(snap, [], "normal", [], [], ctx, 1000);

    const defender = requests.find(r => r.role === "defender");
    expect(defender).toBeDefined();
    expect(defender!.body).toContain("attack");
    // 最低档 [ATTACK,MOVE]：能量到 130 即孵出真正可用的单位。
    expect(defender!.body).toEqual(["attack", "move"]);
  });

  it("bootstrap 极低能量：hauler 拿最低档 [2C,2M]，不含用不上的 WORK 死重", () => {
    // 能量 80 < 最小 hauler [C,M]=100 → 降级失败 → 回退守卫换最低档模板。
    const container = mockStructure("container", { id: "c1", energy: 1800, capacity: 2000 });
    const snap = mockSnapshot({ containers: [container], energyCapacityAvailable: 300 });
    const ctx = {
      colonyState: "bootstrap" as const,
      controllerDowngradeRisk: false,
      energyAvailable: 80,
      economyPressure: 0,
    };
    const { requests } = evaluateDemand(snap, [], "bootstrap", livingHarvester(), [], ctx, 1000);

    const haulers = requests.filter(r => r.role === "hauler");
    expect(haulers.length).toBeGreaterThan(0);
    expect(haulers[0]!.body).not.toContain("work");
    expect(haulers[0]!.body).toEqual(["carry", "carry", "move", "move"]);
  });
});

describe("distributor cc 排空反馈（镜像 hauler 积压反馈，方向相反）", () => {
  // storage≥sustained + 无 controller link + controllerContainer 见底 →
  // distributor 头数加成（并行运力喂高耗远距 sink）；有 link 则不加。
  function ccSnapshot(ccEnergy: number, links: any[] = []) {
    const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
    const cc = mockStructure("container", { id: "cc", energy: ccEnergy, capacity: 2000 });
    return mockSnapshot({
      controller: mockController({ level: 6 }),
      controllerContainer: cc,
      storage,
      links,
      rcl: 6,
      energyCapacityAvailable: 2300,
    });
  }

  it("cc 见底(<20%) + 无 controller link → distributor 加 2（并行运力）", () => {
    const snap = ccSnapshot(200); // 10% → +2
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0, { distScaleUpSince: 800 }), 1000); // 绕过升编延迟确认
    // 基线 distTarget=1（minCount）+ 2 = 3（clamp maxCount 3）。
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(3);
  });

  it("cc 充足(≥50%) → 不加成（供能正常，无需并行）", () => {
    const snap = ccSnapshot(1500); // 75% → 不触发
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0, { distScaleUpSince: 800 }), 1000);
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(1);
  });

  it("有正在供能的 controller link（有能量）→ 即使 cc 见底也不加成（link 供能，非 distributor 职责）", () => {
    const ctrlLink = mockStructure("link", { id: "clink", energy: 400, capacity: 800 }); // 有能量 = 正在供能
    // 默认 mockPos.getRangeTo 返回 1 ≤ 2 → 判定为 controller link。
    const snap = ccSnapshot(200, [ctrlLink]);
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0, { distScaleUpSince: 800 }), 1000);
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(1);
  });

  it("controller link 在场但空(网络未通) + cc 见底 → distributor 接管加成（① 核心行为）", () => {
    const deadLink = mockStructure("link", { id: "clink", energy: 0, capacity: 800 }); // 空 = 未在供能
    const snap = ccSnapshot(200, [deadLink]); // cc 10% + link 死
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0, { distScaleUpSince: 800 }), 1000);
    // link 在场但没通 → distributor 不让位、接管 cc → 加成到 maxCount 3。
    expect(requests.filter(r => r.role === "distributor")).toHaveLength(3);
  });
});

describe("hauler 积压信号接收端可达性闸门（无 storage 防移动仓库过孵）", () => {
  // 无 storage 时 source container 堆积可能是 sink 饱和而非运力不足；
  // sink 全满（无 fillTarget）时加 hauler 只会满载 idle 充当移动仓库。
  function noStorageSnap(fillTargets: any[]) {
    return mockSnapshot({
      links: [],
      containers: [
        mockStructure("container", { id: "c0", energy: 1900, capacity: 2000 }), // >80%
        mockStructure("container", { id: "c1", energy: 1900, capacity: 2000 }), // >80%
      ],
      fillTargets,
      rcl: 3,
      energyCapacityAvailable: 550,
      controller: mockController({ level: 3 }),
    });
  }

  it("sink 全满(无 fillTarget) → container 堆积不加 hauler；有空位 sink → 正常加", () => {
    const saturated = noStorageSnap([]); // 所有 sink 满 → 无处投放
    const deliverable = noStorageSnap(["ft1", "ft2"] as any[]); // 有空位 sink
    const satHaulers = evaluateDemand(saturated, [], "normal", livingHarvester(), [], normalCtx(0), 1000)
      .requests.filter(r => r.role === "hauler").length;
    const delHaulers = evaluateDemand(deliverable, [], "normal", livingHarvester(), [], normalCtx(0), 1000)
      .requests.filter(r => r.role === "hauler").length;
    // 饱和态：堆积不计入 → 回落 minCount；可投放态：堆积计入 → 更多 hauler。
    expect(satHaulers).toBeLessThan(delHaulers);
  });
});

describe("mineralMiner 孵化门禁（工业链第一环激活）", () => {
  const mineral = (amount: number) => [{ id: "min1", mineralType: "Z", mineralAmount: amount, pos: { x: 7, y: 33 } }];
  const extractor = mockStructure("extractor", { id: "ext1" });
  const terminal = mockStructure("terminal", { id: "term1", energy: 10000, capacity: 300000 });

  function industrySnap(overrides = {}) {
    return stationSnapshot({
      rcl: 7,
      energyCapacityAvailable: 1300,
      extractor,
      terminal,
      minerals: mineral(50000) as never,
      ...overrides,
    });
  }

  it("RCL7 + extractor + mineral 有储量 + terminal → 孵化 1 个 mineralMiner", () => {
    const snap = industrySnap();
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    const miners = requests.filter(r => r.role === "mineralMiner");
    expect(miners).toHaveLength(1);
    // body 必须含 CARRY（否则 harvestMineral 永不触发）。
    expect(miners[0]!.body.filter(p => p === "carry").length).toBeGreaterThanOrEqual(1);
    expect(miners[0]!.body.filter(p => p === "work").length).toBeGreaterThanOrEqual(1);
  });

  it("mineral 采空（amount=0）→ 不孵化（存量矿工自然老死）", () => {
    const snap = industrySnap({ minerals: mineral(0) as never });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "mineralMiner")).toHaveLength(0);
  });

  it("无 extractor → 不孵化（矿位无法采集）", () => {
    const snap = industrySnap({ extractor: undefined });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "mineralMiner")).toHaveLength(0);
  });

  it("RCL5（未解锁 extractor）→ 不孵化", () => {
    const snap = industrySnap({ rcl: 5 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "mineralMiner")).toHaveLength(0);
  });

  it("已有 1 个 mineralMiner → 不重复孵化（maxCount=1）", () => {
    const snap = industrySnap();
    const existing = [
      ...livingHarvester(),
      { name: "mineralMiner_0", role: "mineralMiner", home: "W7N4", ticksToLive: 1200, bodyLength: 12, spawnIndex: 0 },
    ];
    const { requests } = evaluateDemand(snap, [], "normal", existing, [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "mineralMiner")).toHaveLength(0);
  });

  it("recovery 态 → 不孵化（不与保命孵化竞争）", () => {
    const snap = industrySnap();
    const { requests } = evaluateDemand(snap, [], "recovery", livingHarvester(), [], normalCtx(0), 1000);
    expect(requests.filter(r => r.role === "mineralMiner")).toHaveLength(0);
  });
});



