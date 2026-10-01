/** P1-1：builder 编制纳入 buildQueue backlog 测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateDemand } from "../../../src/domain/spawn/demand";
import { mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

/** 造 n 个存活 harvester，控制 economyCap = n + 1（harvester + worker + 1）。 */
function livingHarvesters(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `harvester_${i}`,
    role: "harvester",
    home: "W7N4",
    ticksToLive: 1200,
    bodyLength: 7,
    sourceId: "source_1" as Id<Source>,
    spawnIndex: i,
  }));
}

/** 造 n 个指定 state 的 BuildTask（默认 queued）。 */
function buildTasks(n: number, state: BuildTask["state"] = "queued"): BuildTask[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `task_${state}_${i}`,
    pos: { x: 10 + (i % 30), y: 10 + Math.floor(i / 30), roomName: "W7N4" },
    structureType: "road" as BuildableStructureConstant,
    priority: 2 as 0 | 1 | 2 | 3,
    state,
    attempts: 0,
    retryAt: 0,
  }));
}

/**
 * 将 buildQueue 注入 Memory.rooms.W7N4（demand.ts 从 roomMem 读取，与 churnFreezeUntil 同源）。
 * 传 undefined 清除字段，模拟无 buildQueue 的房间（如全新 Memory）。
 */
function setBuildQueue(tasks: BuildTask[] | undefined) {
  const rooms = (globalThis as any).Memory.rooms;
  if (tasks === undefined) {
    delete rooms.W7N4.buildQueue;
  } else {
    rooms.W7N4.buildQueue = tasks;
  }
}

const normalCtx = (pressure = 0, buildQueueBacklog?: number) => ({
  colonyState: "normal" as const,
  controllerDowngradeRisk: false,
  energyAvailable: 2000,
  economyPressure: pressure,
  prevHysteresis: undefined,
  buildQueueBacklog,
});

describe("P1-1 — builder 编制纳入 buildQueue backlog", () => {
  it("site + backlog 同时存在 → backlog*0.5 大于 site 数时按 backlog 加码 builder", () => {
    // 4 harvester → economyCap = 5；1 site + 6 queued → backlogWeighted = 3
    // dynamicBuilderTarget = min(maxCount=4, economyCap=5, max(minCount=1, site=1, backlog=3, road=0)) = 3
    setBuildQueue(buildTasks(6, "queued"));
    const snap = mockSnapshot({
      myConstructionSites: [{ id: "site_1", structureType: "road" } as unknown as ConstructionSite],
    });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(4),
      [],
      normalCtx(0, 6),
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(3);
  });

  it("无 site + 仅 backlog → 条件已扩展，触发 builder 孵化", () => {
    // 4 harvester → economyCap = 5；0 site + 4 queued → backlogWeighted = 2
    // if 条件扩展后 backlogWeighted > 0 也触发；target = min(4, 5, max(1, 0, 2, 0)) = 2
    setBuildQueue(buildTasks(4, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(4),
      [],
      normalCtx(0, 4),
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(2);
  });

  it("backlog=1 → backlogWeighted=0（向下取整），不触发 builder 孵化", () => {
    // 0 site + 1 queued → backlogWeighted = floor(0.5) = 0
    // if 条件：sites>0 || roadRepair || backlogWeighted>0 → 全 false → 不进 builder 块
    setBuildQueue(buildTasks(1, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(4),
      [],
      normalCtx(0, 1),
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("economyCap 上限生效：backlog 极大时 target 不超过 harvester+worker+1", () => {
    // 1 harvester → economyCap = 2；20 queued → backlogWeighted = 10
    // dynamicBuilderTarget = min(maxCount=4, economyCap=2, max(1, 0, 10, 0)) = 2
    setBuildQueue(buildTasks(20, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(1),
      [],
      normalCtx(0, 20),
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(2);
  });

  it("maxCount 上限生效：backlog 极大 + economyCap 充足时 target 不超过 maxCount", () => {
    // 6 harvester → economyCap = 7（>maxCount=4）；40 queued → backlogWeighted = 20
    // dynamicBuilderTarget = min(maxCount=4, economyCap=7, max(1, 0, 20, 0)) = 4
    setBuildQueue(buildTasks(40, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(6),
      [],
      normalCtx(0, 40),
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(4);
  });

  it("buildQueue undefined → backlogWeighted=0，不抛错（与无 backlog 等价）", () => {
    // 默认 Memory.rooms.W7N4 无 buildQueue 字段；1 site → 走原逻辑，target = 1
    setBuildQueue(undefined);
    const snap = mockSnapshot({
      myConstructionSites: [{ id: "site_1", structureType: "road" } as unknown as ConstructionSite],
    });
    expect(() =>
      evaluateDemand(snap, [], "normal", livingHarvesters(1), [], normalCtx(0), 1000),
    ).not.toThrow();
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(1),
      [],
      normalCtx(0),
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(1);
  });

  it("只统计 queued 状态：site/done/blocked 任务不计入 backlog", () => {
    // 2 queued + 2 site + 2 done + 2 blocked → 仅 2 queued 计入 → backlogWeighted = 1
    // dynamicBuilderTarget = min(4, 5, max(1, 0, 1, 0)) = 1
    setBuildQueue([
      ...buildTasks(2, "queued"),
      ...buildTasks(2, "site"),
      ...buildTasks(2, "done"),
      ...buildTasks(2, "blocked"),
    ]);
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(4),
      [],
      normalCtx(0, 2),
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(1);
  });
});

describe("早期房不套 builder 价格弹性闸（#46）", () => {
  // 线上实证：幼房 energyPrice=0.2256 ⇒ demandElasticity=(0.2256−0.1)/0.4=0.314，
  // dynamicBuilderTarget = min(maxCount=4, economyCap=2+0+1=3, max(minCount=1, site=3)) = 3
  // ⇒ 旧口径 round(3×0.314)=1 只 builder（6 个工地、容器与 spawn 池全满时被砍到 1）。
  // 价格的分子就是净流：早期房唯一出口是建自己 ⇒ 缩 builder 压低消耗再压低读数 = 自锁。
  const sites3 = [
    { id: "s1", structureType: "extension" },
    { id: "s2", structureType: "extension" },
    { id: "s3", structureType: "road" },
  ] as unknown as ConstructionSite[];

  it("无 storage：价格再低也不砍 builder ⇒ 3 只（弹性闸对本房不适用）", () => {
    setBuildQueue(undefined);
    const snap = mockSnapshot({ myConstructionSites: sites3, storage: undefined });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(2),
      [],
      { ...normalCtx(0, 0), energyPrice: 0.2256 },
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(3);
  });

  it("有 storage：弹性闸照旧生效 ⇒ 同一价格下 3×0.314 缩到 1 只", () => {
    setBuildQueue(undefined);
    const snap = mockSnapshot({
      myConstructionSites: sites3,
      storage: {
        id: "st1",
        store: { getUsedCapacity: () => 1_000_000 },
      } as unknown as StructureStorage,
    });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(2),
      [],
      { ...normalCtx(0, 0), energyPrice: 0.2256 },
      1000,
    );
    expect(requests.filter(r => r.role === "builder")).toHaveLength(1);
  });
});

describe("早期房 upgrader 不套价格弹性闸（#47）", () => {
  // 与 #46 同一条自锁，只是落在升级道上（G0 的实际度量）。
  // 旧实现：压力阶梯给出 3 → 无条件 × elasticity(0.2256)=0.314 → round=1 → 再被 `!hasStorage`
  // 兜到 minCount=1 —— 那段注释写的本意是"早期房不因 economyPressure 失去整条升级道"，实现却把道收到只剩 1。
  it("无 storage 且有站桩 container：price=0.2256 仍给满 3 只 upgrader", () => {
    setBuildQueue(undefined);
    const cc = {
      id: "cc1",
      pos: { x: 12, y: 12, roomName: "W7N4" },
      store: { getUsedCapacity: () => 2000, getFreeCapacity: () => 3000 },
    } as unknown as StructureContainer;
    const snap = mockSnapshot({
      myConstructionSites: [],
      controllerContainer: cc,
      storage: undefined,
    });
    const { requests } = evaluateDemand(
      snap,
      [],
      "normal",
      livingHarvesters(2),
      [],
      { ...normalCtx(0, 0), energyPrice: 0.2256 },
      1000,
    );
    expect(requests.filter(r => r.role === "upgrader")).toHaveLength(3);
  });
});

describe("补员方向：在编已有 builder/upgrader 时，低价格下早期房仍补回满目标（#46/#47 的决定性签名）", () => {
  // 为什么必须测"补员"而不是"目标算得对不对"：线上那把闸**从不裁编**，只决定"死一只后补不补"
  // ⇒ 存活编制数在新旧两种代码下完全一样（goal 会话 22:30Z 的实测就是这个形状）。
  // 唯一有鉴别力的读数 = 已有 living 时队列里会不会再出现替换请求。
  // 价格取 0.116（demandElasticity=(0.116−0.1)/0.4=0.04）：旧口径 round(3×0.04)=**0** ⇒ 一只都不补。
  const px = 0.116;
  const sites3 = [
    { id: "b1", structureType: "extension" },
    { id: "b2", structureType: "extension" },
    { id: "b3", structureType: "road" },
  ] as unknown as ConstructionSite[];
  const storageFull = {
    id: "st1",
    store: { getUsedCapacity: () => 1_000_000 },
  } as unknown as StructureStorage;
  const controllerContainer = {
    id: "cc1",
    pos: { x: 12, y: 12, roomName: "W7N4" },
    store: {
      getUsedCapacity: () => 2000,
      getFreeCapacity: () => 3000,
      getCapacity: () => 5000,
    },
  } as unknown as StructureContainer;

  function living(role: string, n: number) {
    return [
      ...livingHarvesters(2),
      ...Array.from({ length: n }, (_, i) => ({
        name: `${role}_${i}`,
        role,
        home: "W7N4",
        ticksToLive: 1200,
        bodyLength: 7,
        spawnIndex: 10 + i,
      })),
    ];
  }

  function reqsFor(snap: any, creeps: any[]) {
    setBuildQueue(undefined);
    return evaluateDemand(
      snap,
      [],
      "normal",
      creeps as never,
      [],
      {
        ...normalCtx(0, 0),
        energyPrice: px,
      },
      1000,
    ).requests;
  }

  it("builder：无 storage 且已活着一只 ⇒ 仍补 2 只回满目标 3", () => {
    const snap = mockSnapshot({ myConstructionSites: sites3, storage: undefined });
    expect(reqsFor(snap, living("builder", 1)).filter(r => r.role === "builder")).toHaveLength(2);
  });

  it("builder：有 storage 同一价格 ⇒ 目标被弹性砍到 0 ⇒ 一只都不补（对照组）", () => {
    const snap = mockSnapshot({ myConstructionSites: sites3, storage: storageFull });
    expect(reqsFor(snap, living("builder", 1)).filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("upgrader：无 storage 且有站桩 container，已活着一只 ⇒ 仍补 2 只回 3", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      controllerContainer,
      storage: undefined,
    });
    expect(reqsFor(snap, living("upgrader", 1)).filter(r => r.role === "upgrader")).toHaveLength(2);
  });

  it("upgrader：有 storage 同一价格 ⇒ 弹性砍到 0 ⇒ 不补（对照组）", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      controllerContainer,
      storage: storageFull,
    });
    expect(reqsFor(snap, living("upgrader", 1)).filter(r => r.role === "upgrader")).toHaveLength(0);
  });

  // #55：recovery 掐掉的正是早期房唯一的消费出口。`allowUpgrader` 原先只看
  // `colonyState === "normal"`，而早期房（无 storage）没有库存可保 —— 它的 reserve 负值
  // 就是"正在建设自己"。相位机在 minBandTicks(=100) 带上每次抖动都会把这条道整段掐掉，
  // 并阻止满寿 upgrader 的替换（线上实证：幼房 ColonyStateChange 以 normal↔recovery 横跳）。
  const recoveryReqs = (snap: any, creeps: any[]) =>
    evaluateDemand(
      snap,
      [],
      "recovery",
      creeps as never,
      [],
      {
        ...normalCtx(0, 0),
        energyPrice: px,
      } as never,
      1000,
    ).requests;

  it("upgrader：早期房在 recovery 相位仍要补员（无 storage ⇒ 没有库存可保）", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      controllerContainer,
      storage: undefined,
    });
    const reqs = recoveryReqs(snap, living("upgrader", 1)).filter(r => r.role === "upgrader");
    expect(reqs).toHaveLength(2);
  });

  it("upgrader：成熟房（有 storage）在 recovery 仍不补员 —— 保库存语义不变（对照组）", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      controllerContainer,
      storage: storageFull,
    });
    const reqs = recoveryReqs(snap, living("upgrader", 1)).filter(r => r.role === "upgrader");
    expect(reqs).toHaveLength(0);
  });
});
