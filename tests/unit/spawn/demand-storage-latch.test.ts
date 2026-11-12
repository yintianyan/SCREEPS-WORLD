/** Phase 2.5：低储闩锁贯穿 demand —— 关闭时停升级/工业孵化、builder 收编到 1。 */
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateDemand, type RoomDemandContext } from "../../../src/domain/spawn/demand";
import {
  mockController,
  mockConstructionSite,
  mockSnapshot,
  mockSource,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

/** 一台存活 harvester，避免触发 P0 恢复 worker 短路。 */
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

function ctx(overrides: Partial<RoomDemandContext> = {}): RoomDemandContext {
  return {
    colonyState: "normal",
    controllerDowngradeRisk: false,
    energyAvailable: 2000,
    economyPressure: 0,
    ...overrides,
  };
}

const STORAGE_60K = () => mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });

function stationSnapshot(overrides: Parameters<typeof mockSnapshot>[0]) {
  return mockSnapshot({
    rcl: 7,
    energyCapacityAvailable: 5300,
    controller: mockController({ level: 7 }),
    controllerContainer: mockStructure("container", { id: "cc", energy: 1000, capacity: 2000 }),
    ...overrides,
  });
}

describe("storage 闩锁关闭（storage 曾跌破 50K、尚未回到 100K）", () => {
  it("storage 60K 但闩锁关闭 ⇒ 不孵 upgrader（控制组：闩锁开启 → 3 只冲刺）", () => {
    const snap = stationSnapshot({ storage: STORAGE_60K() });
    const closed = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false }),
      1000,
    ).requests.filter(r => r.role === "upgrader");
    expect(closed).toHaveLength(0);

    const open = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: true }),
      1000,
    ).requests.filter(r => r.role === "upgrader");
    // 冲刺档非满仓封顶 3；rich 豁免价格弹性。
    expect(open).toHaveLength(3);
  });

  it("闩锁关闭但 controller 有降级风险 ⇒ 保级路径仍孵 upgrader", () => {
    const snap = stationSnapshot({ storage: STORAGE_60K() });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false, controllerDowngradeRisk: true }),
      1000,
    );
    const upgraders = requests.filter(r => r.role === "upgrader");
    expect(upgraders.length).toBeGreaterThan(0);
  });

  it("闩锁关闭 ⇒ 不孵 mineralMiner（控制组：闩锁开启 → 1 只）", () => {
    const base = {
      rcl: 6,
      storage: STORAGE_60K(),
      extractor: mockStructure("extractor", { id: "ex" }),
      terminal: mockStructure("terminal", { id: "term" }),
      minerals: [{ mineralType: "H", mineralAmount: 5000 } as any],
    };
    const snap = mockSnapshot(base);
    const closed = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false }),
      1000,
    ).requests.filter(r => r.role === "mineralMiner");
    expect(closed).toHaveLength(0);

    const open = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: true }),
      1000,
    ).requests.filter(r => r.role === "mineralMiner");
    expect(open).toHaveLength(1);
  });

  it("Phase C：homeMiningActive=false ⇒ 不孵 mineralMiner（控制组 true → 1 只）", () => {
    const base = {
      rcl: 6,
      storage: STORAGE_60K(),
      extractor: mockStructure("extractor", { id: "ex" }),
      terminal: mockStructure("terminal", { id: "term" }),
      minerals: [{ mineralType: "H", mineralAmount: 5000 } as any],
    };
    const snap = mockSnapshot(base);
    const stopped = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: true, homeMiningActive: false }),
      1000,
    ).requests.filter(r => r.role === "mineralMiner");
    expect(stopped).toHaveLength(0);

    const mining = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: true, homeMiningActive: true }),
      1000,
    ).requests.filter(r => r.role === "mineralMiner");
    expect(mining).toHaveLength(1);
  });

  it("闩锁关闭 ⇒ 不孵 labTender（控制组：闩锁开启 → 2 只）", () => {
    const base = {
      rcl: 6,
      storage: STORAGE_60K(),
      labs: [
        mockStructure("lab", { id: "lab1" }),
        mockStructure("lab", { id: "lab2" }),
        mockStructure("lab", { id: "lab3" }),
      ],
      terminal: mockStructure("terminal", { id: "term" }),
    };
    const snap = mockSnapshot(base);
    const closed = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false, labSupplyNeeded: true }),
      1000,
    ).requests.filter(r => r.role === "labTender");
    expect(closed).toHaveLength(0);

    const open = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: true, labSupplyNeeded: true }),
      1000,
    ).requests.filter(r => r.role === "labTender");
    expect(open).toHaveLength(2);
  });

  it("storage < 20K ⇒ builder 编制封顶 1（控制组：storage 60K → 2）", () => {
    const sites = [
      mockConstructionSite("extension"),
      mockConstructionSite("extension"),
      mockConstructionSite("extension"),
    ];
    // Phase D：缩编线从 100K 降到 20K（生存线×2）—— 40–60K 的房不再被永久压到 1 只。
    const lowStorage = () =>
      mockStructure("storage", { id: "st", energy: 15000, capacity: 1000000 });
    const lowSnap = mockSnapshot({
      rcl: 6,
      storage: lowStorage(),
      myConstructionSites: sites,
      sources: [mockSource()],
    });
    const closed = evaluateDemand(
      lowSnap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false }),
      1000,
    ).requests.filter(r => r.role === "builder");
    expect(closed).toHaveLength(1);

    const normalSnap = mockSnapshot({
      rcl: 6,
      storage: STORAGE_60K(),
      myConstructionSites: sites,
      sources: [mockSource()],
    });
    const open = evaluateDemand(
      normalSnap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false }),
      1000,
    ).requests.filter(r => r.role === "builder");
    expect(open).toHaveLength(2);
  });
});

describe("Phase D：低血工事驱动 builder 编制", () => {
  function snapNoSites() {
    return mockSnapshot({
      rcl: 6,
      storage: STORAGE_60K(),
      myConstructionSites: [],
      sources: [mockSource()],
    });
  }

  it("无工地/无道路 + 低血工事 1 个 ⇒ 孵 1 只 builder（旧行为 0 只）", () => {
    const requests = evaluateDemand(
      snapNoSites(),
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ lowFortificationCount: 1 }),
      1000,
    ).requests.filter(r => r.role === "builder");
    expect(requests).toHaveLength(1);
  });

  it("低血工事 ≥20 个 ⇒ 扩编到 2 只", () => {
    const requests = evaluateDemand(
      snapNoSites(),
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ lowFortificationCount: 25 }),
      1000,
    ).requests.filter(r => r.role === "builder");
    expect(requests).toHaveLength(2);
  });

  it("低血工事 0 个 + 无工地 ⇒ 不孵 builder（保持旧语义）", () => {
    const requests = evaluateDemand(
      snapNoSites(),
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ lowFortificationCount: 0 }),
      1000,
    ).requests.filter(r => r.role === "builder");
    expect(requests).toHaveLength(0);
  });

  it("storage < 20K 时缩编优先：低血工事 25 个也只孵 1 只", () => {
    const snap = mockSnapshot({
      rcl: 6,
      storage: mockStructure("storage", { id: "st", energy: 15000, capacity: 1000000 }),
      myConstructionSites: [],
      sources: [mockSource()],
    });
    const requests = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ lowFortificationCount: 25 }),
      1000,
    ).requests.filter(r => r.role === "builder");
    expect(requests).toHaveLength(1);
  });
});

describe("Phase D：factory 回收积压驱动 distributor 编制", () => {
  function snapNoFill() {
    return mockSnapshot({
      rcl: 7,
      storage: STORAGE_60K(),
      fillTargets: [],
      sources: [mockSource()],
    });
  }

  it("无填充需求 + 无回收积压 ⇒ distributor 只有 minCount", () => {
    const requests = evaluateDemand(
      snapNoFill(),
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ factoryReclaimBacklog: 0 }),
      1000,
    ).requests.filter(r => r.role === "distributor");
    expect(requests).toHaveLength(1);
  });

  it("无填充需求 + 回收积压 50 个等效目标 ⇒ distributor 扩编（>1，需过升编确认窗）", () => {
    // 升编确认：扩编须需求持续 distributorScaleUpDelay(150) tick 才放行 ——
    // 这里模拟「积压已持续超过确认窗」。
    const requests = evaluateDemand(
      snapNoFill(),
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ factoryReclaimBacklog: 50, prevHysteresis: { distScaleUpSince: 800 } }),
      1000,
    ).requests.filter(r => r.role === "distributor");
    expect(requests.length).toBeGreaterThan(1);
  });

  it("积压越多编制越大（封顶 maxCount）", () => {
    const small = evaluateDemand(
      snapNoFill(),
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ factoryReclaimBacklog: 4, prevHysteresis: { distScaleUpSince: 800 } }),
      1000,
    ).requests.filter(r => r.role === "distributor").length;
    const large = evaluateDemand(
      snapNoFill(),
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ factoryReclaimBacklog: 200, prevHysteresis: { distScaleUpSince: 800 } }),
      1000,
    ).requests.filter(r => r.role === "distributor").length;
    expect(large).toBeGreaterThanOrEqual(small);
  });
});

describe("Phase D：分级消费闸 —— 三档独立", () => {
  it("升级闸独立：rich=false 但 upgradeActive=true ⇒ 仍孵 3 只 upgrader（60K 恢复线已过）", () => {
    const snap = stationSnapshot({ storage: STORAGE_60K() });
    const requests = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false, upgradeActive: true }),
      1000,
    ).requests.filter(r => r.role === "upgrader");
    expect(requests).toHaveLength(3);
  });

  it("升级闸可更严：rich=true 但 upgradeActive=false ⇒ 不孵 upgrader", () => {
    const snap = stationSnapshot({ storage: STORAGE_60K() });
    const requests = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: true, upgradeActive: false }),
      1000,
    ).requests.filter(r => r.role === "upgrader");
    expect(requests).toHaveLength(0);
  });

  it("工业闸独立：rich=true 但 labActive=false ⇒ 不孵 mineralMiner / labTender", () => {
    const snap = mockSnapshot({
      rcl: 6,
      storage: STORAGE_60K(),
      extractor: mockStructure("extractor", { id: "ex" }),
      terminal: mockStructure("terminal", { id: "term" }),
      minerals: [{ mineralType: "H", mineralAmount: 5000 } as any],
      labs: [
        mockStructure("lab", { id: "lab1" }),
        mockStructure("lab", { id: "lab2" }),
        mockStructure("lab", { id: "lab3" }),
      ],
    });
    const requests = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: true, labActive: false, labSupplyNeeded: true }),
      1000,
    ).requests;
    expect(requests.filter(r => r.role === "mineralMiner")).toHaveLength(0);
    expect(requests.filter(r => r.role === "labTender")).toHaveLength(0);
  });

  it("工业闸独立：rich=false 但 labActive=true ⇒ 仍孵 mineralMiner 1 / labTender 2", () => {
    const snap = mockSnapshot({
      rcl: 6,
      storage: STORAGE_60K(),
      extractor: mockStructure("extractor", { id: "ex" }),
      terminal: mockStructure("terminal", { id: "term" }),
      minerals: [{ mineralType: "H", mineralAmount: 5000 } as any],
      labs: [
        mockStructure("lab", { id: "lab1" }),
        mockStructure("lab", { id: "lab2" }),
        mockStructure("lab", { id: "lab3" }),
      ],
    });
    const requests = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvester(),
      [],
      ctx({ richStorageActive: false, labActive: true, labSupplyNeeded: true }),
      1000,
    ).requests;
    expect(requests.filter(r => r.role === "mineralMiner")).toHaveLength(1);
    expect(requests.filter(r => r.role === "labTender")).toHaveLength(2);
  });
});
