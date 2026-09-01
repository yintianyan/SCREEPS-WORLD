/** P0-A 单测 — remote-mining-manager.fulfillContainerRequests。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillContainerRequests } from "../../../src/systems/remote-mining-manager";
import { getTickSiteCounters } from "../../../src/systems/site-quota";
import { resetGlobals, mockContext, mockSource, syncSquadIndex } from "../../support/factories";
import { CONFIG } from "../../../src/config";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

/** 创建类型正确的 active RemoteOp（避免 state 被推断为 string）。 */
function activeOp(opts: { siteCount?: number; state?: "active" | "abandoned" } = {}): RemoteOp {
  return {
    state: opts.state ?? "active",
    createdAt: 0,
    lastSeen: 1000,
    ...(opts.siteCount !== undefined ? { siteCount: opts.siteCount } : {}),
  };
}

/** 构造一个申请 container 的 remoteHarvester mock。 */
function requestingCreep(opts: {
  name?: string;
  sourceId?: string;
  remoteTarget?: string;
  home?: string;
  atRange?: number;
}): any {
  const {
    name = "rh_1",
    sourceId = "src_W8N4_a",
    remoteTarget = "W8N4",
    home = "W7N4",
    atRange = 1,
  } = opts;
  mockSource(sourceId);
  return {
    name,
    memory: {
      role: "remoteHarvester",
      home,
      sourceId,
      remoteTarget,
      needContainer: true,
    },
    pos: {
      x: 25, y: 25, roomName: remoteTarget,
      getRangeTo: vi.fn(() => atRange),
    },
    room: { name: remoteTarget },
  };
}

/** 构造有视野的远矿房 mock（支持 find + createConstructionSite）。 */
function mockRemoteRoom(opts: {
  name?: string;
  existingSites?: any[];
  sources?: any[];
  createResult?: number;
}): any {
  const { name = "W8N4", existingSites = [], sources = [], createResult = 0 } = opts;
  // R2：被测代码同时 find(FIND_CONSTRUCTION_SITES) 与 find(FIND_SOURCES)。
  //   旧 mock 对所有 flag 返回同一数组，R2 后 site.pos.getRangeTo(src) 炸裂（site 无 pos）。
  //   现按 flag 分发：sites 走 existingSites（补 pos stub，默认邻接=1），
  //   sources 走 sources 参数。不传 sources 时 find(FIND_SOURCES) 返回 []，
  //   sourcesWithSite 为空 — 不影响"无 site"或"仅校正 siteCount"的测试。
  const sites = existingSites.map((s, i) => s.pos
    ? s
    : { ...s, pos: { x: 25 + i, y: 25 + i, roomName: name, getRangeTo: vi.fn(() => 1) } });
  return {
    name,
    find: vi.fn((flag: number, _opts?: any) =>
      flag === FIND_SOURCES ? sources : sites),
    createConstructionSite: vi.fn(() => createResult),
  };
}

/** 设置 Game.creeps + Game.rooms + Memory 上下文。 */
function setupWorld(opts: {
  creeps?: any[];
  rooms?: Record<string, any>;
  remoteOps?: Record<string, RemoteOp>;
  globalSiteCount?: number;
}): { ctx: any } {
  const { creeps = [], rooms = {}, remoteOps = {}, globalSiteCount = 0 } = opts;

  const creepMap: Record<string, any> = {};
  for (const c of creeps) creepMap[c.name] = c;
  (globalThis as any).Game.creeps = creepMap;
  syncSquadIndex();
  // Game.getObjectById 不覆盖 — resetGlobals 已设置为读 factories 的 objectRegistry，
  // mockSource 调用 registerObject 注册 source，默认 mock 自动找到。

  const roomMap: Record<string, any> = {};
  for (const [name, room] of Object.entries(rooms)) roomMap[name] = room;
  (globalThis as any).Game.rooms = roomMap;

  (globalThis as any).Memory.rooms = {
    W7N4: { remoteOps },
  };

  const ctx = mockContext();
  Object.defineProperty(ctx, "globalSiteCount", { value: globalSiteCount, configurable: true });
  return { ctx };
}

describe("fulfillContainerRequests — 正常路径", () => {
  it("申请 creep + 无 site + 配额可用 → 创建 site + 清标记 + siteCount=1", () => {
    const creep = requestingCreep({});
    const room = mockRemoteRoom({ existingSites: [], createResult: 0 });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp() };

    const { ctx } = setupWorld({
      creeps: [creep],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(room.createConstructionSite).toHaveBeenCalledWith(creep.pos, "container");
    expect(creep.memory.needContainer).toBe(false);
    expect(remoteOps.W8N4!.siteCount).toBe(1);
  });
});

describe("fulfillContainerRequests — 幂等", () => {
  it("已有 site → 清除申请标记，不创建", () => {
    const creep = requestingCreep({});
    // R2：sourcesWithSite 由 site.pos.getRangeTo(source) <= 1 计算。
    //   传 sources=[{id:sourceId}]，site 默认邻接（pos stub getRangeTo=1），
    //   sourcesWithSite 含 sourceId → 该组申请标记被清，走 continue 不创建。
    const room = mockRemoteRoom({
      existingSites: [{ structureType: "container" }],
      sources: [{ id: "src_W8N4_a" }],
      createResult: 0,
    });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp({ siteCount: 1 }) };

    const { ctx } = setupWorld({
      creeps: [creep],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(room.createConstructionSite).not.toHaveBeenCalled();
    expect(creep.memory.needContainer).toBe(false);
    expect(remoteOps.W8N4!.siteCount).toBe(1);
  });
});

describe("fulfillContainerRequests — ERR_FULL 失败", () => {
  it("createConstructionSite 返回 ERR_FULL → 写冷却 + 清标记", () => {
    const creep = requestingCreep({});
    const room = mockRemoteRoom({ existingSites: [], createResult: -8 }); // ERR_FULL
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp() };

    const { ctx } = setupWorld({
      creeps: [creep],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(room.createConstructionSite).toHaveBeenCalled();
    expect(creep.memory.needContainer).toBe(false);
    expect(creep.memory.containerSiteCooldown).toBe(1000 + 100);
  });
});

describe("fulfillContainerRequests — tick 配额", () => {
  it("normal 槽位已用 → 跳过（不创建、不清标记）", () => {
    const creep = requestingCreep({});
    const room = mockRemoteRoom({ existingSites: [], createResult: 0 });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp() };

    const { ctx } = setupWorld({
      creeps: [creep],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    getTickSiteCounters().markNormal();

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(room.createConstructionSite).not.toHaveBeenCalled();
    expect(creep.memory.needContainer).toBe(true);
  });

  it("emergency > 0 → 远矿让位（不创建）", () => {
    const creep = requestingCreep({});
    const room = mockRemoteRoom({ existingSites: [], createResult: 0 });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp() };

    const { ctx } = setupWorld({
      creeps: [creep],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    getTickSiteCounters().markEmergency();

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(room.createConstructionSite).not.toHaveBeenCalled();
    expect(creep.memory.needContainer).toBe(true);
  });
});

describe("fulfillContainerRequests — 总量判定", () => {
  it("globalSiteCount + remoteTotal >= maxGlobalSites → 跳过", () => {
    const creep = requestingCreep({});
    const room = mockRemoteRoom({ existingSites: [], createResult: 0 });
    // siteCount 会被函数校正为实测值（existingSites=[] → 0），
    // 因此用 globalSiteCount = maxGlobalSites 触发总量超限。
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp() };

    const { ctx } = setupWorld({
      creeps: [creep],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: CONFIG.construction.maxGlobalSites,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(room.createConstructionSite).not.toHaveBeenCalled();
    expect(creep.memory.needContainer).toBe(true);
  });
});

describe("fulfillContainerRequests — siteCount 实测校正", () => {
  it("记忆 siteCount=5 但实际 0 → 校正为 0", () => {
    const room = mockRemoteRoom({ existingSites: [] });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp({ siteCount: 5 }) };

    const { ctx } = setupWorld({
      creeps: [],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(remoteOps.W8N4!.siteCount).toBe(0);
    expect(room.createConstructionSite).not.toHaveBeenCalled();
  });

  it("记忆 siteCount=0 但实际 2 → 校正为 2", () => {
    const room = mockRemoteRoom({
      existingSites: [
        { structureType: "container" },
        { structureType: "container" },
      ],
    });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp({ siteCount: 0 }) };

    const { ctx } = setupWorld({
      creeps: [],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(remoteOps.W8N4!.siteCount).toBe(2);
  });
});

// R2：多源远矿房的核心价值测试 — A 源建成不得阻塞 B 源申请。
//   旧实现 actualSites > 0 即清所有 source 组申请标记，B 源 creep 被一并清掉
//   （needContainer=false），B 源 site 永远建不出。新实现 sourcesWithSite
//   仅含 A 源，B 源组保留走创建路径。
describe("fulfillContainerRequests — R2 多源房隔离", () => {
  it("A 源已有 site，B 源申请不被阻塞 → 为 B 源创建 site", () => {
    // src_A 已有 container site（site 邻接 src_A），src_B 无 site 有申请 creep。
    // site.pos.getRangeTo 仅对 src_A 返回 1（邻接），对 src_B 返回 99（非邻接）。
    const creepB = requestingCreep({ name: "rh_B", sourceId: "src_B" });
    const site = {
      structureType: "container",
      pos: {
        x: 10, y: 10, roomName: "W8N4",
        getRangeTo: vi.fn((target: any) => target?.id === "src_A" ? 1 : 99),
      },
    };
    const room = mockRemoteRoom({
      existingSites: [site],
      sources: [{ id: "src_A" }, { id: "src_B" }],
      createResult: 0,
    });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp({ siteCount: 1 }) };

    const { ctx } = setupWorld({
      creeps: [creepB],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    // siteCount 校正为实测值 1（仅 src_A 的 site）。
    expect(remoteOps.W8N4!.siteCount).toBe(1);
    // B 源申请未被 A 源的 site 阻塞 — 走创建路径，site 已建。
    expect(room.createConstructionSite).toHaveBeenCalledWith(creepB.pos, "container");
    // 创建成功后清 B 源申请标记。
    expect(creepB.memory.needContainer).toBe(false);
  });

  it("A 源有 site 但非邻接 B 源 → sourcesWithSite 不含 B 源", () => {
    // 验证 sourcesWithSite 的精确性：site 邻接 src_A（getRangeTo=1）但不邻接 src_B。
    // 用自定义 pos stub 让 site.pos.getRangeTo(src_A)=1, getRangeTo(src_B)=99。
    const creepB = requestingCreep({ name: "rh_B", sourceId: "src_B" });
    const site = {
      structureType: "container",
      pos: {
        x: 10, y: 10, roomName: "W8N4",
        getRangeTo: vi.fn((target: any) => target?.id === "src_A" ? 1 : 99),
      },
    };
    const room = mockRemoteRoom({
      existingSites: [site],
      sources: [{ id: "src_A" }, { id: "src_B" }],
      createResult: 0,
    });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp({ siteCount: 1 }) };

    const { ctx } = setupWorld({
      creeps: [creepB],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    // sourcesWithSite 仅含 src_A — B 源组保留，走创建路径。
    expect(room.createConstructionSite).toHaveBeenCalled();
    expect(creepB.memory.needContainer).toBe(false);
  });
});

describe("fulfillContainerRequests — 边界条件", () => {
  it("远矿房无视野（Game.rooms 无此房）→ 跳过", () => {
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp({ siteCount: 0 }) };
    const { ctx } = setupWorld({
      creeps: [],
      rooms: {},
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");
    expect(remoteOps.W8N4!.siteCount).toBe(0);
  });

  it("非 active 状态的 op → 跳过", () => {
    const room = mockRemoteRoom({ existingSites: [] });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp({ state: "abandoned" }) };
    const { ctx } = setupWorld({
      creeps: [],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");
    expect(room.find).not.toHaveBeenCalled();
  });

  it("creep 不在 source 旁（range > 1）→ 跳过该 source 组", () => {
    const creep = requestingCreep({ atRange: 5 });
    const room = mockRemoteRoom({ existingSites: [], createResult: 0 });
    const remoteOps: Record<string, RemoteOp> = { W8N4: activeOp() };

    const { ctx } = setupWorld({
      creeps: [creep],
      rooms: { W8N4: room },
      remoteOps,
      globalSiteCount: 0,
    });

    fulfillContainerRequests(remoteOps, ctx, "W7N4");

    expect(room.createConstructionSite).not.toHaveBeenCalled();
    expect(creep.memory.needContainer).toBe(true);
  });
});
