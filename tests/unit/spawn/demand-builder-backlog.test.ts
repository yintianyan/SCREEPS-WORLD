/** P1-1：builder 编制纳入 buildQueue backlog 测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateDemand } from "../../../src/domain/spawn/demand";
import { mockSnapshot, resetGlobals } from "../../role-helpers";

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
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvesters(4), [], normalCtx(0, 6), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(3);
  });

  it("无 site + 仅 backlog → 条件已扩展，触发 builder 孵化", () => {
    // 4 harvester → economyCap = 5；0 site + 4 queued → backlogWeighted = 2
    // if 条件扩展后 backlogWeighted > 0 也触发；target = min(4, 5, max(1, 0, 2, 0)) = 2
    setBuildQueue(buildTasks(4, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvesters(4), [], normalCtx(0, 4), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(2);
  });

  it("backlog=1 → backlogWeighted=0（向下取整），不触发 builder 孵化", () => {
    // 0 site + 1 queued → backlogWeighted = floor(0.5) = 0
    // if 条件：sites>0 || roadRepair || backlogWeighted>0 → 全 false → 不进 builder 块
    setBuildQueue(buildTasks(1, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvesters(4), [], normalCtx(0, 1), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("economyCap 上限生效：backlog 极大时 target 不超过 harvester+worker+1", () => {
    // 1 harvester → economyCap = 2；20 queued → backlogWeighted = 10
    // dynamicBuilderTarget = min(maxCount=4, economyCap=2, max(1, 0, 10, 0)) = 2
    setBuildQueue(buildTasks(20, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvesters(1), [], normalCtx(0, 20), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(2);
  });

  it("maxCount 上限生效：backlog 极大 + economyCap 充足时 target 不超过 maxCount", () => {
    // 6 harvester → economyCap = 7（>maxCount=4）；40 queued → backlogWeighted = 20
    // dynamicBuilderTarget = min(maxCount=4, economyCap=7, max(1, 0, 20, 0)) = 4
    setBuildQueue(buildTasks(40, "queued"));
    const snap = mockSnapshot({ myConstructionSites: [] });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvesters(6), [], normalCtx(0, 40), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(4);
  });

  it("buildQueue undefined → backlogWeighted=0，不抛错（与无 backlog 等价）", () => {
    // 默认 Memory.rooms.W7N4 无 buildQueue 字段；1 site → 走原逻辑，target = 1
    setBuildQueue(undefined);
    const snap = mockSnapshot({
      myConstructionSites: [{ id: "site_1", structureType: "road" } as unknown as ConstructionSite],
    });
    expect(() => evaluateDemand(snap, [], "normal", livingHarvesters(1), [], normalCtx(0), 1000)).not.toThrow();
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvesters(1), [], normalCtx(0), 1000);
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
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvesters(4), [], normalCtx(0, 2), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(1);
  });
});
