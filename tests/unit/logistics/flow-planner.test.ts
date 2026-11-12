/** FlowPlanner Phase 0 纯函数测试 — 能量流分配、link 容量、现金口径与 unmet。 */
import { describe, expect, it } from "vitest";
import {
  computeCarrierCount,
  computeCoreDemand,
  computeUpgradeDemand,
  estimateUpgradeFeed,
  findShortestLinkPath,
  linkPathRate,
  linkSendCapacity,
  planRoomFlows,
  shouldRebaseCarriers,
  smoothRate,
} from "../../../src/domain/logistics/flow-planner";
import type {
  FlowCarrierPool,
  FlowLinkNode,
  FlowPolicy,
  FlowSinkDemand,
} from "../../../src/domain/logistics/flow-types";

const p = (x: number, y: number) => ({ x, y });

const link = (id: string, x: number, y: number): FlowLinkNode => ({
  id,
  pos: p(x, y),
  capacity: 800,
  energy: 0,
});

const pool = (count: number, carry = 300, roundTripTicks = 16): FlowCarrierPool => ({
  count,
  carry,
  roundTripTicks,
});

const policy = (storageFloor = 0): FlowPolicy => ({
  storageFloor,
  linkCapacity: 800,
  linkLossRatio: 0.03,
  maxCarriersPerLane: Number.POSITIVE_INFINITY,
});

describe("link 容量 — cooldown = 距离，容量 = 800/(距离+1)", () => {
  it("距离 24 → 32 e/t；距离 5 → 133 e/t；距离 8 → 88 e/t", () => {
    expect(linkSendCapacity(24)).toBe(32);
    expect(linkSendCapacity(5)).toBe(133);
    expect(linkSendCapacity(8)).toBe(88);
  });

  it("路径速率取瓶颈边并按跳数扣 3% 损耗", () => {
    const links = [link("st", 22, 18), link("cl", 22, 42)];
    const path = findShortestLinkPath("st", "cl", links)!;
    expect(path).toEqual(["st", "cl"]);
    const info = linkPathRate(path, links)!;
    expect(info.sendRatePerTick).toBe(32);
    expect(info.deliveredRatePerTick).toBe(31); // floor(32 × 0.97)
    expect(info.hops).toBe(1);
  });

  it("两跳 relay：8/8/8，瓶颈 88，到达 floor(88×0.97³)=80", () => {
    const links = [link("st", 22, 18), link("r1", 23, 26), link("r2", 23, 34), link("cl", 22, 42)];
    // 引擎允许同房任意距离直连，BFS 最短跳数会直接返回 st→cl。
    expect(findShortestLinkPath("st", "cl", links)).toEqual(["st", "cl"]);
    // relay 只作为吞吐优化时的手工路径评估。
    const info = linkPathRate(["st", "r1", "r2", "cl"], links)!;
    expect(info.sendRatePerTick).toBe(88);
    expect(info.deliveredRatePerTick).toBe(80);
    expect(info.hops).toBe(3);
  });

  it("无路径 / 缺端点 → undefined", () => {
    expect(findShortestLinkPath("st", "missing", [link("st", 1, 1)])).toBeUndefined();
    expect(findShortestLinkPath("a", "a", [])).toEqual(["a"]);
  });
});

describe("需求口径 — 现金单一账本与真实 WORK", () => {
  it("core：目标水位 = cashCap - reserve；pending 只作急迫下限，不扣减目标", () => {
    const rate = computeCoreDemand({
      cashCap: 5600,
      spawnReserve: 1200,
      pendingHostedBodyCost: 1200,
      energyAvailable: 1000,
      horizonTicks: 50,
    });
    // band=min(4400, 3920)=3920，deficit 2920，2920/50 = 59
    expect(rate).toBe(59);
  });

  it("core：pending bodyCost 大于现金时提高补能速率下限", () => {
    const rate = computeCoreDemand({
      cashCap: 5600,
      spawnReserve: 1200,
      pendingHostedBodyCost: 4200,
      energyAvailable: 1000,
      horizonTicks: 30,
    });
    // base=(3920-1000)/30=98；pending=(4200-1000)/30=107 ⇒ 107
    expect(rate).toBe(107);
  });

  it("core：已达标时不产生额外需求", () => {
    expect(
      computeCoreDemand({
        cashCap: 5600,
        spawnReserve: 1200,
        pendingHostedBodyCost: 0,
        energyAvailable: 4400,
        horizonTicks: 50,
      }),
    ).toBe(0);
  });

  it("upgrade：0 只 upgrader → 0；受 policy/link 目标双重封顶", () => {
    expect(computeUpgradeDemand(0, 40)).toBe(0);
    expect(computeUpgradeDemand(40, 40, 800)).toBe(40);
    expect(computeUpgradeDemand(80, 40, 800)).toBe(40);
    expect(computeUpgradeDemand(40, 40, 30)).toBe(30);
  });

  it("feeder 数按速率缩放：40/t → 1 只，80/t → 2 只（300 载重、6 tick）", () => {
    expect(computeCarrierCount(40, 6, 300)).toBe(1);
    expect(computeCarrierCount(80, 6, 300)).toBe(2);
    expect(computeCarrierCount(0, 6, 300)).toBe(0);
  });

  it("可持续供给：link 到达 + source 直供 + 剩余承运人 creep 运力", () => {
    expect(
      estimateUpgradeFeed({
        linkDeliveredRate: 31,
        externalSupplyPerTick: 20,
        distributorCount: 4,
        feederCarrierCount: 2,
        carry: 300,
        creepRoundTripTicks: 56,
      }),
    ).toBeCloseTo(31 + 20 + 2 * (300 / 56), 2);
  });

  it("少 1 只 feeder 的损失 ≤ 释放承运人的 creep 运力 ⇒ 向下取整释放", () => {
    const links = [link("st", 22, 18), link("cl", 22, 42)];
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 878567,
      storageId: "stor",
      sinks: [
        {
          groupId: "upgrade",
          lane: "upgrade",
          priority: 2,
          demandPerTick: 50,
          externalSupplyPerTick: 20,
          linkFromId: "st",
          linkToId: "cl",
          linkFeederRoundTripTicks: 10, // 300/10 = 30；send 31/32 需要 2 只
          creepSourceId: "stor",
          creepRoundTripTicks: 56,
        },
      ],
      links,
      carrierPool: pool(4, 300, 56),
      policy: policy(),
    });
    const linkAlloc = plan.allocations.find(a => a.via === "link")!;
    expect(linkAlloc.rate).toBe(29); // sendRate 30 × 0.97
    expect(linkAlloc.carriersNeeded).toBe(1);
    const creepAlloc = plan.allocations.find(a => a.via === "creep")!;
    expect(creepAlloc.rate).toBe(1);
    expect(creepAlloc.carriersNeeded).toBe(1);
  });

  it("EMA 与编制 rebase 阈值", () => {
    expect(smoothRate(10, 40, 0.25)).toBe(17.5);
    expect(smoothRate(10, 40, 0)).toBe(10);
    expect(smoothRate(10, 40, 1)).toBe(40);
    expect(shouldRebaseCarriers(2, 3, 1)).toBe(true);
    expect(shouldRebaseCarriers(2, 2.5, 1)).toBe(false);
  });
});

describe("planRoomFlows — W8N3 直接链路", () => {
  const links = [link("st", 22, 18), link("cl", 22, 42)];
  const baseSinks: FlowSinkDemand[] = [
    {
      groupId: "core",
      lane: "core",
      priority: 0,
      demandPerTick: 20,
      creepSourceId: "stor",
      creepRoundTripTicks: 16,
    },
    {
      groupId: "upgrade",
      lane: "upgrade",
      priority: 2,
      demandPerTick: 40,
      externalSupplyPerTick: 20, // source link 直供
      linkFromId: "st",
      linkToId: "cl",
      linkFeederRoundTripTicks: 6,
      creepSourceId: "stor",
      creepRoundTripTicks: 56,
    },
  ];

  it("core 先分配；upgrade 走 ST→CL，feeder 1 只；source 补 20/t 后无 unmet", () => {
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 878567,
      storageId: "stor",
      sinks: baseSinks,
      links,
      carrierPool: pool(6),
      policy: policy(),
    });

    expect(plan.allocations).toHaveLength(2);
    const core = plan.allocations.find(a => a.lane === "core")!;
    expect(core.via).toBe("creep");
    expect(core.rate).toBe(20);
    expect(core.carriersNeeded).toBe(2);

    const upgrade = plan.allocations.find(a => a.lane === "upgrade")!;
    expect(upgrade.via).toBe("link");
    expect(upgrade.rate).toBe(20); // 需求 40 - source 直供 20
    expect(upgrade.carriersNeeded).toBe(1);

    expect(plan.linkTransfers).toHaveLength(1);
    expect(plan.linkTransfers[0]!.ratePerTick).toBe(21); // ceil(20/0.97)
    expect(plan.unmet).toEqual([]);
    expect(plan.spawnNeeds).toEqual([
      { role: "distributor", lane: "core", count: 2, carry: 300 },
      { role: "distributor", lane: "upgrade", count: 1, carry: 300 },
    ]);
    expect(plan.totalCreepRate).toBe(20);
  });

  it("没有 source 直供时：upgrade 仍优先由 link 补，剩余走 creep", () => {
    const sinks = baseSinks.map(s =>
      s.lane === "upgrade" ? { ...s, externalSupplyPerTick: 0 } : s,
    );
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 878567,
      storageId: "stor",
      sinks,
      links,
      carrierPool: pool(6),
      policy: policy(),
    });
    const upgrade = plan.allocations.find(a => a.lane === "upgrade")!;
    // link 上限 32 delivered 31；需求 40，剩余 9 由 creep 补
    expect(upgrade.via).toBe("link");
    expect(upgrade.rate).toBe(31);
    const creepUpgrade = plan.allocations.find(a => a.lane === "upgrade" && a.via === "creep");
    expect(creepUpgrade?.rate).toBe(9);
    expect(plan.unmet).toEqual([]);
  });

  it("核心优先级耗尽承运人 → upgrade unmet=no-carrier", () => {
    const sinks: FlowSinkDemand[] = [
      {
        groupId: "core",
        lane: "core",
        priority: 0,
        demandPerTick: 100,
        creepSourceId: "stor",
        creepRoundTripTicks: 16,
      },
      {
        groupId: "upgrade",
        lane: "upgrade",
        priority: 2,
        demandPerTick: 40,
        linkFromId: "st",
        linkToId: "cl",
        linkFeederRoundTripTicks: 6,
        creepSourceId: "stor",
        creepRoundTripTicks: 56,
      },
    ];
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 878567,
      storageId: "stor",
      sinks,
      links,
      carrierPool: pool(2),
      policy: policy(),
    });
    expect(plan.allocations.find(a => a.lane === "core")?.rate).toBe(37);
    expect(plan.allocations.find(a => a.lane === "upgrade")).toBeUndefined();
    expect(plan.unmet).toEqual([
      { lane: "core", groupId: "core", rate: 63, reason: "no-carrier" },
      { lane: "upgrade", groupId: "upgrade", rate: 40, reason: "no-carrier" },
    ]);
  });

  it("storage 低于 floor → unmet=no-source", () => {
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 0,
      storageId: "stor",
      sinks: [
        {
          groupId: "core",
          lane: "core",
          priority: 0,
          demandPerTick: 20,
          creepSourceId: "stor",
          creepRoundTripTicks: 16,
        },
      ],
      links: [],
      carrierPool: pool(6),
      policy: policy(),
    });
    expect(plan.allocations).toEqual([]);
    expect(plan.unmet).toEqual([{ lane: "core", groupId: "core", rate: 20, reason: "no-source" }]);
  });

  it("link 端点缺失且无 creep 源 → unmet=no-link", () => {
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 1000,
      storageId: "stor",
      sinks: [
        {
          groupId: "upgrade",
          lane: "upgrade",
          priority: 2,
          demandPerTick: 20,
          linkFromId: "st",
          linkToId: "missing",
        },
      ],
      links,
      carrierPool: pool(6),
      policy: policy(),
    });
    expect(plan.unmet).toEqual([
      { lane: "upgrade", groupId: "upgrade", rate: 20, reason: "no-link" },
    ]);
  });

  it("storage 地板扣除后才参与分配", () => {
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 100,
      storageId: "stor",
      sinks: [
        {
          groupId: "core",
          lane: "core",
          priority: 0,
          demandPerTick: 20,
          creepSourceId: "stor",
          creepRoundTripTicks: 16,
        },
      ],
      links: [],
      carrierPool: pool(6),
      policy: policy(90), // 只剩 10 可流出
    });
    const core = plan.allocations.find(a => a.lane === "core")!;
    expect(core.rate).toBe(10);
    expect(plan.unmet[0]).toMatchObject({ rate: 10, reason: "no-source" });
  });

  it("carrierCap=1：core 慢速回填只占 1 只承运人，剩余给 upgrade", () => {
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 878567,
      storageId: "stor",
      sinks: [
        {
          groupId: "core",
          lane: "core",
          priority: 0,
          demandPerTick: 100,
          creepSourceId: "stor",
          creepRoundTripTicks: 16,
          carrierCap: 1,
        },
      ],
      links: [],
      carrierPool: pool(4),
      policy: policy(),
    });
    const core = plan.allocations.find(a => a.lane === "core")!;
    expect(core.carriersNeeded).toBe(1);
    expect(core.rate).toBe(18); // floor(1 × 300/16)
    expect(plan.unmet[0]).toMatchObject({ lane: "core" });
  });

  it("maxCarriersPerLane 限制单条流的承运人数", () => {
    const plan = planRoomFlows({
      tick: 100,
      storageEnergy: 878567,
      storageId: "stor",
      sinks: [
        {
          groupId: "core",
          lane: "core",
          priority: 0,
          demandPerTick: 100,
          creepSourceId: "stor",
          creepRoundTripTicks: 16,
        },
      ],
      links: [],
      carrierPool: pool(6),
      policy: { ...policy(), maxCarriersPerLane: 1 },
    });
    expect(plan.allocations.find(a => a.lane === "core")?.carriersNeeded).toBe(1);
    expect(plan.unmet[0]).toMatchObject({ lane: "core" });
  });
});
