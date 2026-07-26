/**
 * 远矿需求评估测试。
 *
 * 覆盖：正常孵化、角色计数、替换逻辑、危机暂停、reserver body 门禁。
 */
import { describe, expect, it } from "vitest";
import { evaluateRemoteDemand, type RemoteCreepSummary } from "../../../src/domain/remote/demand";
import type { ColonyState } from "../../../src/kernel/contracts";

const tick = 100000;
const homeRoom = "W1N1";
const targetRoom = "W2N1";

function makeRemoteOps(state: "active" | "paused" = "active") {
  return {
    [targetRoom]: {
      state,
      sources: 2,
      createdAt: tick - 1000,
      lastSeen: tick,
    },
  };
}

function makeCreeps(role: string, count: number, ttl?: number): RemoteCreepSummary[] {
  const result: RemoteCreepSummary[] = [];
  for (let i = 0; i < count; i++) {
    result.push({
      name: `${role}-${i}`,
      role,
      remoteTarget: targetRoom,
      ticksToLive: ttl,
      bodyLength: 5,
    });
  }
  return result;
}

const baseInput = {
  homeRoom,
  colonyState: "normal" as ColonyState,
  energyCapacityAvailable: 800,
  tick,
  remoteOps: makeRemoteOps(),
  remoteCreeps: [] as RemoteCreepSummary[],
  spawnQueue: [] as SpawnRequest[],
};

describe("remote demand — evaluateRemoteDemand", () => {
  it("无远矿运营时不生成请求", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: {},
    });
    expect(requests).toHaveLength(0);
  });

  it("active 运营缺 harvester 时生成请求", () => {
    const { requests } = evaluateRemoteDemand(baseInput);
    expect(requests).toHaveLength(3); // harvester + hauler + reserver
    const roles = requests.map((r) => r.role);
    expect(roles).toContain("remoteHarvester");
    expect(roles).toContain("remoteHauler");
    expect(roles).toContain("reserver");
  });

  it("已有足够的 harvester 时不重复孵化", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: makeCreeps("remoteHarvester", 1),
    });
    const harvesterReqs = requests.filter((r) => r.role === "remoteHarvester");
    expect(harvesterReqs).toHaveLength(0);
  });

  it("已有足够的 hauler 时不重复孵化", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: makeCreeps("remoteHauler", 1),
    });
    const haulerReqs = requests.filter((r) => r.role === "remoteHauler");
    expect(haulerReqs).toHaveLength(0);
  });

  it("已有足够的 reserver 时不重复孵化", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: makeCreeps("reserver", 1),
    });
    const reserverReqs = requests.filter((r) => r.role === "reserver");
    expect(reserverReqs).toHaveLength(0);
  });

  it("crisis 状态时暂停远矿孵化", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      colonyState: "recovery",
    });
    expect(requests).toHaveLength(0);
  });

  it("bootstrap 状态时暂停远矿孵化", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      colonyState: "bootstrap",
    });
    expect(requests).toHaveLength(0);
  });

  it("paused 运营不生成请求", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: makeRemoteOps("paused"),
    });
    expect(requests).toHaveLength(0);
  });

  it("请求 memory 包含 remoteTarget", () => {
    const { requests } = evaluateRemoteDemand(baseInput);
    for (const req of requests) {
      expect(req.memory.remoteTarget).toBe(targetRoom);
    }
  });

  it("请求 home 为孵化房", () => {
    const { requests } = evaluateRemoteDemand(baseInput);
    for (const req of requests) {
      expect(req.home).toBe(homeRoom);
    }
  });

  it("reserver 在低容量时跳过（无 CLAIM body）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      energyCapacityAvailable: 300, // 不足以生成 CLAIM (650)
    });
    const reserverReqs = requests.filter((r) => r.role === "reserver");
    expect(reserverReqs).toHaveLength(0);
    // harvester 和 hauler 仍应生成（它们有低容量回退档）。
    expect(requests.length).toBeGreaterThanOrEqual(2);
  });

  it("pending 请求计入总数避免重复孵化", () => {
    const pendingReq: SpawnRequest = {
      key: `remoteHarvester:${homeRoom}:${targetRoom}:0`,
      role: "remoteHarvester",
      home: homeRoom,
      priority: 1,
      body: ["work", "carry", "move"],
      memory: { role: "remoteHarvester", home: homeRoom, mode: "acquire", remoteTarget: targetRoom },
      createdAt: tick,
      retries: 0,
    };
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      spawnQueue: [pendingReq],
    });
    const harvesterReqs = requests.filter((r) => r.role === "remoteHarvester");
    expect(harvesterReqs).toHaveLength(0);
  });

  it("creep 即将死亡时生成替换请求", () => {
    // bodyLength=5, threshold = 5*3 + 15 + 50 = 80
    const dyingCreep: RemoteCreepSummary = {
      name: "remoteHarvester-dying",
      role: "remoteHarvester",
      remoteTarget: targetRoom,
      ticksToLive: 50, // < 80, 需要替换
      bodyLength: 5,
    };
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [dyingCreep],
    });
    const harvesterReqs = requests.filter((r) => r.role === "remoteHarvester");
    expect(harvesterReqs).toHaveLength(1);
    expect(harvesterReqs[0]!.replaceBy).toBe(tick);
  });

  it("creep 寿命充足时不生成替换请求", () => {
    const healthyCreep: RemoteCreepSummary = {
      name: "remoteHarvester-healthy",
      role: "remoteHarvester",
      remoteTarget: targetRoom,
      ticksToLive: 1000, // >> 80
      bodyLength: 5,
    };
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [healthyCreep],
    });
    const harvesterReqs = requests.filter((r) => r.role === "remoteHarvester");
    expect(harvesterReqs).toHaveLength(0);
  });

  // ── 回归：替补 key 必须稳定，pending 累积不得产生新 key ──

  it("替补请求 key 绑定濒死 creep 名，pending 累积后 key 不漂移", () => {
    const dyingCreep: RemoteCreepSummary = {
      name: "remoteHarvester-dying",
      role: "remoteHarvester",
      remoteTarget: targetRoom,
      ticksToLive: 50,
      bodyLength: 5,
    };

    // 第一轮评估：生成替补请求。
    const first = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [dyingCreep],
    });
    const firstReq = first.requests.find((r) => r.role === "remoteHarvester");
    expect(firstReq).toBeDefined();

    // 第二轮评估：替补请求已 pending（total = 存活 1 + pending 1 = 2），
    // findReplacement 仍命中同一濒死 creep — 生成的请求 key 必须与第一轮一致，
    // 由 submitRequest 幂等合并，而非堆积新请求（旧 bug：index 漂移产生新 key）。
    const second = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [dyingCreep],
      spawnQueue: [firstReq!],
    });
    const secondReq = second.requests.find((r) => r.role === "remoteHarvester");
    expect(secondReq).toBeDefined();
    expect(secondReq!.key).toBe(firstReq!.key);
  });

  it("请求携带 expiresAt TTL", () => {
    const { requests } = evaluateRemoteDemand(baseInput);
    expect(requests.length).toBeGreaterThan(0);
    for (const req of requests) {
      expect(req.expiresAt).toBeGreaterThan(tick);
    }
  });
});

// ── 回归：remoteThreats → remoteDefender 孵化链 ──

describe("remote demand — remoteDefender 威胁响应", () => {
  const fullStaff = [
    ...makeCreeps("remoteHarvester", 1, 1000),
    ...makeCreeps("remoteHauler", 1, 1000),
    ...makeCreeps("reserver", 1, 1000),
  ];

  it("远矿房有威胁时生成 remoteDefender 请求", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: fullStaff,
      remoteThreats: { [targetRoom]: true },
    });
    const defenderReqs = requests.filter((r) => r.role === "remoteDefender");
    expect(defenderReqs).toHaveLength(1);
    expect(defenderReqs[0]!.memory.remoteTarget).toBe(targetRoom);
  });

  it("无威胁时不生成 remoteDefender", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: fullStaff,
      remoteThreats: { [targetRoom]: false },
    });
    expect(requests.filter((r) => r.role === "remoteDefender")).toHaveLength(0);
  });

  it("remoteThreats 未提供时不生成 remoteDefender（向后兼容）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: fullStaff,
    });
    expect(requests.filter((r) => r.role === "remoteDefender")).toHaveLength(0);
  });

  it("已有存活 defender 时不重复孵化", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [...fullStaff, ...makeCreeps("remoteDefender", 1, 1000)],
      remoteThreats: { [targetRoom]: true },
    });
    expect(requests.filter((r) => r.role === "remoteDefender")).toHaveLength(0);
  });
});
