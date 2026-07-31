/**
 * P0-A 单测 — remote-mining-manager.fulfillContainerRequests。
 *
 * 覆盖：
 *   1. 正常路径：申请 creep + 无 site + 配额可用 → 创建 site + 清标记 + siteCount=1
 *   2. 幂等：已有 site → 清除申请标记，不创建
 *   3. ERR_FULL 失败 → 写冷却 + 清标记
 *   4. tick 配额耗尽（normal > 0）→ 跳过
 *   5. 让位 emergency（emergency > 0）→ 跳过
 *   6. siteCount 实测校正：记忆值与实际偏差 → 校正
 *   7. 总量超限（globalSiteCount + remoteTotal >= max）→ 跳过
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillContainerRequests } from "../../../src/systems/remote-mining-manager";
import { getTickSiteCounters } from "../../../src/systems/site-quota";
import { resetGlobals, mockContext, mockSource } from "../../role-helpers";
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
  createResult?: number;
}): any {
  const { name = "W8N4", existingSites = [], createResult = 0 } = opts;
  return {
    name,
    find: vi.fn((_flag: number, _opts?: any) => existingSites),
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
  // Game.getObjectById 不覆盖 — resetGlobals 已设置为读 role-helpers 的 objectRegistry，
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
    const room = mockRemoteRoom({ existingSites: [{ structureType: "container" }], createResult: 0 });
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
