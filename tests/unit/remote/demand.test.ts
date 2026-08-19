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

function makeRemoteOps(state: "active" | "paused" = "active", sources = 1) {
  return {
    [targetRoom]: {
      state,
      sources,
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

  it("2-source 房孵 2 个 harvester，单源房仍只孵 1（B-1）", () => {
    // 2-source：已有 1 只 → 仍补第 2 只（第二源否则白费）。
    const twoSource = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: makeRemoteOps("active", 2),
      remoteCreeps: makeCreeps("remoteHarvester", 1),
    });
    expect(twoSource.requests.filter((r) => r.role === "remoteHarvester")).toHaveLength(1);

    // 2-source：已有 2 只 → 满足，不再补。
    const twoSourceFull = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: makeRemoteOps("active", 2),
      remoteCreeps: makeCreeps("remoteHarvester", 2),
    });
    expect(twoSourceFull.requests.filter((r) => r.role === "remoteHarvester")).toHaveLength(0);

    // 单源：已有 1 只 → 满足，不再补。
    const oneSource = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: makeRemoteOps("active", 1),
      remoteCreeps: makeCreeps("remoteHarvester", 1),
    });
    expect(oneSource.requests.filter((r) => r.role === "remoteHarvester")).toHaveLength(0);
  });

  it("已有足够的 hauler 时不重复孵化", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: makeCreeps("remoteHauler", 1),
    });
    const haulerReqs = requests.filter((r) => r.role === "remoteHauler");
    expect(haulerReqs).toHaveLength(0);
  });

  it("op.haulerNeed=2 且采集满编时已有 1 只仍继续补第 2 只（动态编制放大目标）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: {
        [targetRoom]: { state: "active", sources: 2, haulerNeed: 2, lastSeen: tick },
      },
      remoteCreeps: [
        ...makeCreeps("remoteHauler", 1), // 已有 1 只。
        ...makeCreeps("remoteHarvester", 2), // 采集端满编（2 source 全就位）。
      ],
    });
    // 回退档（target=1）时这 1 只已满足、不再补；haulerNeed=2 且采集满编时仍补第 2 只。
    const haulerReqs = requests.filter((r) => r.role === "remoteHauler");
    expect(haulerReqs).toHaveLength(1);
  });

  it("采集端联动收缩（2026-08-19）：harvester 未满编时 hauler 编制等比收缩", () => {
    // 场景（线上实证 W36S58）：sources=2 + haulerNeed=2，但 harvester 0 就位（爬坡期）
    // → 旧逻辑全额配 2 只 hauler 扎堆 idle 等货；新逻辑收缩为 1 只保物流连通。
    const ramping = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: {
        [targetRoom]: { state: "active", sources: 2, haulerNeed: 2, lastSeen: tick },
      },
      remoteCreeps: makeCreeps("remoteHauler", 1), // 已有 1 只 hauler，0 harvester。
    });
    expect(ramping.requests.filter((r) => r.role === "remoteHauler")).toHaveLength(0); // 收缩后已满足。

    // 采集半编（2 source 只有 1 harvester）→ haulerNeed=2 收缩为 ceil(2×0.5)=1。
    const half = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: {
        [targetRoom]: { state: "active", sources: 2, haulerNeed: 2, lastSeen: tick },
      },
      remoteCreeps: makeCreeps("remoteHarvester", 1), // 半编，无 hauler。
    });
    const haulerReqs = half.requests.filter((r) => r.role === "remoteHauler");
    expect(haulerReqs).toHaveLength(1); // 只孵 1 只（收缩后目标）。

    // 采集满编 → 恢复全额 2 只。
    const full = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: {
        [targetRoom]: { state: "active", sources: 2, haulerNeed: 2, lastSeen: tick },
      },
      remoteCreeps: [
        ...makeCreeps("remoteHarvester", 2),
        ...makeCreeps("remoteHauler", 1), // 已有 1 只，应补第 2 只。
      ],
    });
    expect(full.requests.filter((r) => r.role === "remoteHauler")).toHaveLength(1);
  });

  it("op 无 haulerNeed 时回退 haulersPerTarget=1（存量运营兼容）", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: makeCreeps("remoteHauler", 1), // 已有 1 只。
    });
    // 回退 target=1，已满足 → 不再补。
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

  it("recovery 状态允许现役 op 补员（R3b 收入路径豁免），但不孵 reserver", () => {
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      colonyState: "recovery",
    });
    const roles = requests.map((r) => r.role);
    // 经济收入角色照常补员（W7 贫困陷阱实证：recovery 冻结远矿 = 收入归零）。
    expect(roles).toContain("remoteHarvester");
    expect(roles).toContain("remoteHauler");
    // reserver 是 P2 发展角色，recovery 下孵出会被 kernel 门禁跳过 → 不生成。
    expect(roles).not.toContain("reserver");
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

  it("远距离路径提前交接，近距离不沿用固定 50 tick 过早替补", () => {
    const dying: RemoteCreepSummary = {
      name: "remoteHarvester-dying", role: "remoteHarvester", remoteTarget: targetRoom,
      ticksToLive: 95, bodyLength: 5,
    };
    // 未取得路径成本时保留历史 50 tick 回退：阈值 15 + 15 + 50 = 80。
    const unknown = evaluateRemoteDemand({ ...baseInput, remoteCreeps: [dying] });
    expect(unknown.requests.filter(r => r.role === "remoteHarvester")).toHaveLength(0);

    // pathCost=80 时通勤预算=95，完整阈值=125，应在 95 TTL 时启动交接。
    const distant = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [dying],
      travelCosts: { [targetRoom]: 80 },
    });
    expect(distant.requests.filter(r => r.role === "remoteHarvester")).toHaveLength(1);
  });

  it("濒死者 + 已有健康替补并存时不再补（防替换风暴）", () => {
    // target=1（单源）。濒死者在窗口内，但已有 1 只健康替补 → 健康数达标，不补。
    const dying: RemoteCreepSummary = {
      name: "remoteHarvester-dying", role: "remoteHarvester",
      remoteTarget: targetRoom, ticksToLive: 50, bodyLength: 5, // <80 窗口内
    };
    const healthy: RemoteCreepSummary = {
      name: "remoteHarvester-fresh", role: "remoteHarvester",
      remoteTarget: targetRoom, ticksToLive: 1400, bodyLength: 5,
    };
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteOps: makeRemoteOps("active", 1), // 单源 → target 1
      remoteCreeps: [dying, healthy],
    });
    expect(requests.filter((r) => r.role === "remoteHarvester")).toHaveLength(0);
  });

  it("reserver 濒死者 + 孵化中替补（ttl 未定义）并存时不再补（防替换风暴根因）", () => {
    // 线上根因：单个 dying reserver 每周期反复触发替换，live 飙到 5。
    // 孵化中的替补 ttl 未定义 → 计为健康 → 健康数达标 → 不再重复补。
    const dying: RemoteCreepSummary = {
      name: "reserver-dying", role: "reserver",
      remoteTarget: targetRoom, ticksToLive: 30, bodyLength: 2,
    };
    const spawningRepl: RemoteCreepSummary = {
      name: "reserver-fresh", role: "reserver",
      remoteTarget: targetRoom, ticksToLive: undefined, bodyLength: 2,
    };
    const { requests } = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [dying, spawningRepl],
    });
    expect(requests.filter((r) => r.role === "reserver")).toHaveLength(0);
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

  it("替补请求 pending 后不再重复生成（防替换风暴：pending 计入健康数达标即止）", () => {
    const dyingCreep: RemoteCreepSummary = {
      name: "remoteHarvester-dying",
      role: "remoteHarvester",
      remoteTarget: targetRoom,
      ticksToLive: 50,
      bodyLength: 5,
    };

    // 第一轮评估：健康数 0 + pending 0 < target 1 → 生成替补请求。
    const first = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [dyingCreep],
    });
    const firstReq = first.requests.find((r) => r.role === "remoteHarvester");
    expect(firstReq).toBeDefined();

    // 第二轮评估：替补已 pending（健康 0 + pending 1 = target 1）→ 不再生成。
    // 修复前：findReplacement 仍命中濒死者 → 每周期重复生成替换（依赖队列内 key
    // 幂等，但请求孵出离队后失效）→ 替换风暴。守卫后 pending 达标即止。
    const second = evaluateRemoteDemand({
      ...baseInput,
      remoteCreeps: [dyingCreep],
      spawnQueue: [firstReq!],
    });
    expect(second.requests.find((r) => r.role === "remoteHarvester")).toBeUndefined();
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
