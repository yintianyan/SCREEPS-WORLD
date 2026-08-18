/**
 * 远矿目标选择测试。
 *
 * 覆盖：候选筛选（kind/owner/status）、排序优先级、去重、过期暂停。
 */
import { describe, expect, it } from "vitest";
import { selectRemoteTargets, shouldPauseOperation, scoreRemoteCandidate, effectiveMaxOperations, roomLinearDistance } from "../../../src/domain/remote/targeting";
import type { RoomIntel } from "../../../src/domain/intel";

const tick = 100000;
const staleThreshold = 5000;

function makeIntel(overrides: Partial<RoomIntel> = {}): RoomIntel {
  return {
    kind: "normal",
    status: "normal",
    lastSeen: tick,
    ...overrides,
  };
}

describe("remote targeting — selectRemoteTargets", () => {
  it("跨房去重：兄弟房已运营的目标不入选（双编队抢矿是纯亏损）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W38S58",
      intel: {
        W37S57: makeIntel(), // 主房 W37S58 正在运营。
        W36S58: makeIntel(),
      },
      existingOps: undefined, // 本房无运营 — 修复前 W37S57 会被选中。
      tick,
      staleThreshold,
      haulerCapacity: 800,
      globalActiveTargets: new Set(["W37S57"]),
    });
    expect(result.map(c => c.roomName)).toEqual(["W36S58"]);
  });

  it("跨房去重：兄弟房已 abandoned 的目标可入选（调用方只汇总非 abandoned）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W38S58",
      intel: { W36S58: makeIntel() },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
      globalActiveTargets: new Set(), // abandoned 不入集合。
    });
    expect(result.map(c => c.roomName)).toEqual(["W36S58"]);
  });

  it("无 intel 时返回空列表", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: undefined,
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result).toEqual([]);
  });

  it("只选普通房（排除 highway/sk/center）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W0N1: makeIntel({ kind: "highway" }),
        W1N0: makeIntel({ kind: "highway" }),
        W4N5: makeIntel({ kind: "sk" }),
        W5N5: makeIntel({ kind: "center" }),
        W2N1: makeIntel({ kind: "normal" }),
        W1N2: makeIntel({ kind: "normal" }),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    const names = result.map((c) => c.roomName);
    expect(names).toContain("W2N1");
    expect(names).toContain("W1N2");
    expect(names).not.toContain("W0N1");
    expect(names).not.toContain("W4N5");
    expect(names).not.toContain("W5N5");
  });

  it("排除有主的房间", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ owner: "enemy" }),
        W1N2: makeIntel({ owner: undefined }),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result.map((c) => c.roomName)).toEqual(["W1N2"]);
  });

  it("排除我方殖民地（权威 controller.my）— intel.owner 滞后为空也硬排除，防己方邻居房被误选 churn", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ owner: undefined }), // 我方新占殖民地，但 intel 滞后未记 owner
        W1N2: makeIntel({ owner: undefined }), // 真·无主，可选
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
      ownedRooms: new Set(["W2N1"]), // 权威集合：W2N1 是我方殖民地
    });
    // W2N1 被 ownedRooms 硬排除（不依赖 intel.owner），只剩 W1N2 —
    // 否则己方房被当远矿目标反复开→self-claim 废弃→重选，形成 churn。
    expect(result.map((c) => c.roomName)).toEqual(["W1N2"]);
  });

  it("排除被他人预定的房，己方续期中的房仍可选", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ reservedBy: "enemy" }), // 敌方预定 → 排除。
        W1N2: makeIntel({ reservedBy: "me" }),    // 己方续期 → 保留。
        W2N2: makeIntel({ reservedBy: undefined }), // 无预定 → 保留。
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
      myUsername: "me",
    });
    expect(result.map((c) => c.roomName).sort()).toEqual(["W1N2", "W2N2"]);
  });

  it("Invader 预定不是玩家争矿 — 仍可选（Core 占坑由 coreClearer 拆，不能永久锁死远矿）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ reservedBy: "Invader", sources: 2, pathCost: 36 }),
        W1N2: makeIntel({ reservedBy: "enemy", sources: 2, pathCost: 35 }),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
      myUsername: "me",
    });
    expect(result.map((c) => c.roomName)).toEqual(["W2N1"]);
  });

  it("无 myUsername 时 Invader 预定仍可选（NPC 与未知玩家预定必须分流）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ reservedBy: "Invader", sources: 2, pathCost: 36 }),
        W1N2: makeIntel({ reservedBy: "someone", sources: 2, pathCost: 35 }),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result.map((c) => c.roomName)).toEqual(["W2N1"]);
  });

  it("无 myUsername 时任何 reservedBy 都视为他人预定（保守排除）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ reservedBy: "someone" }),
        W1N2: makeIntel({ reservedBy: undefined }),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result.map((c) => c.roomName)).toEqual(["W1N2"]);
  });

  it("排除非正常状态房间（novice/respawn/closed）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ status: "novice" }),
        W1N2: makeIntel({ status: "respawn" }),
        W2N2: makeIntel({ status: "normal" }),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result.map((c) => c.roomName)).toEqual(["W2N2"]);
  });

  it("排除自身房间", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W1N1: makeIntel(),
        W2N1: makeIntel(),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result.map((c) => c.roomName)).toEqual(["W2N1"]);
  });

  it("排除已有运营的房间（非 abandoned）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel(),
        W1N2: makeIntel(),
      },
      existingOps: {
        W2N1: { state: "active" },
      },
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    // W2N1 已有 active 运营，不应被再次选中
    expect(result.map((c) => c.roomName)).toEqual(["W1N2"]);
  });

  it("近期视野排名靠前", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ lastSeen: tick - 100 }), // 近期
        W1N2: makeIntel({ lastSeen: tick - 10000 }), // 过期
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result[0]!.roomName).toBe("W2N1");
    expect(result[0]!.hasRecentVision).toBe(true);
    expect(result[1]!.roomName).toBe("W1N2");
    expect(result[1]!.hasRecentVision).toBe(false);
  });

  it("source 数多的排名靠前", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ sources: 1 }),
        W1N2: makeIntel({ sources: 2 }),
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result[0]!.roomName).toBe("W1N2");
    expect(result[1]!.roomName).toBe("W2N1");
  });

  it("abandoned 状态的运营不阻止重新选择", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel(),
      },
      existingOps: {
        W2N1: { state: "abandoned" },
      },
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result.map((c) => c.roomName)).toEqual(["W2N1"]);
  });
});

describe("remote targeting — shouldPauseOperation", () => {
  it("abandoned 状态永远暂停", () => {
    expect(shouldPauseOperation({ state: "abandoned", lastSeen: tick }, tick, staleThreshold)).toBe(true);
  });

  it("lastSeen 超过阈值时暂停", () => {
    expect(
      shouldPauseOperation({ state: "active", lastSeen: tick - staleThreshold - 1 }, tick, staleThreshold),
    ).toBe(true);
  });

  it("lastSeen 在阈值内不暂停", () => {
    expect(
      shouldPauseOperation({ state: "active", lastSeen: tick - 100 }, tick, staleThreshold),
    ).toBe(false);
  });
});

describe("remote targeting — 净收益评分与剔除", () => {
  // W1N1 的邻房，pathCost 显式给定隔离线性估算，聚焦评分逻辑。
  it("超近房 2-source（pathCost 20）：入选，haulerNeed=1", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: { W2N1: makeIntel({ sources: 2, pathCost: 20 }) },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.haulerNeed).toBe(1); // 800/(2×20)=20 e/tick 单只够 2 source。
    expect(result[0]!.netScore).toBeGreaterThan(3);
  });

  it("沼泽远房 1-source（pathCost 400）：netScore < 门槛被剔除", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: { W2N1: makeIntel({ sources: 1, pathCost: 400 }) },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result).toHaveLength(0);
  });

  it("中距 2-source（pathCost 150）：haulerNeed≥2 且排序低于近房", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: makeIntel({ sources: 2, pathCost: 150 }), // 中距
        W1N2: makeIntel({ sources: 2, pathCost: 50 }),  // 近房
      },
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result[0]!.roomName).toBe("W1N2"); // 近房评分高，排前。
    const mid = result.find(c => c.roomName === "W2N1")!;
    expect(mid.haulerNeed).toBeGreaterThanOrEqual(2);
  });

  it("pathCost 缺失时回退线性估算，近邻房仍可入选（不抛错）", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: { W2N1: makeIntel({ sources: 2 }) }, // 无 pathCost。
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(result).toHaveLength(1); // linear=1 → pathCost≈70，仍过门槛。
  });

  it("无视野候选按 sources=1 保守评分", () => {
    const { netScore } = scoreRemoteCandidate({
      pathCost: 50, linearDistance: 1, sources: undefined, haulerCapacity: 800,
    });
    const known = scoreRemoteCandidate({
      pathCost: 50, linearDistance: 1, sources: 1, haulerCapacity: 800,
    });
    expect(netScore).toBe(known.netScore); // undefined 等价于 1。
  });

  it("A-2 账本：计入 defender 后 netScore 下降", () => {
    const withDefender = scoreRemoteCandidate({
      pathCost: 50, linearDistance: 1, sources: 2, haulerCapacity: 800, withDefender: true,
    });
    const noDefender = scoreRemoteCandidate({
      pathCost: 50, linearDistance: 1, sources: 2, haulerCapacity: 800, withDefender: false,
    });
    expect(withDefender.netScore).toBeLessThan(noDefender.netScore);
  });

  it("A-2 账本：道路维护随 pathCost 增长（远房 netScore 更低）", () => {
    const near = scoreRemoteCandidate({
      pathCost: 50, linearDistance: 1, sources: 2, haulerCapacity: 800,
    });
    const far = scoreRemoteCandidate({
      pathCost: 300, linearDistance: 5, sources: 2, haulerCapacity: 800,
    });
    expect(far.netScore).toBeLessThan(near.netScore);
  });

  it("B-3 未预定：收益减半且不计 reserver 摊销", () => {
    const reserved = scoreRemoteCandidate({
      pathCost: 50, linearDistance: 1, sources: 2, haulerCapacity: 800, reserved: true,
    });
    const unreserved = scoreRemoteCandidate({
      pathCost: 50, linearDistance: 1, sources: 2, haulerCapacity: 800, reserved: false,
    });
    // 未预定单源收益 5 vs 10 → 吞吐减半，即便省了 reserver 摊销，净分仍更低。
    expect(unreserved.netScore).toBeLessThan(reserved.netScore);
  });
});

describe("remote targeting — effectiveMaxOperations", () => {
  it("有 storage + 双 spawn：放开到 maxOperations(2)", () => {
    expect(effectiveMaxOperations(true, 2)).toBe(2);
  });
  it("无 storage + 双 spawn：收缩到 maxOperationsNoStorage(1)", () => {
    expect(effectiveMaxOperations(false, 2)).toBe(1);
  });
  it("有 storage 但单 spawn：生产能力约束到 1（防远程编制挤占唯一孵化位）", () => {
    expect(effectiveMaxOperations(true, 1)).toBe(1);
  });
  it("三 spawn（RCL8）：仍受消化侧 maxOperations(2) 封顶", () => {
    expect(effectiveMaxOperations(true, 3)).toBe(2);
  });
  it("零 spawn（灾后无孵化能力）：上限为 0", () => {
    expect(effectiveMaxOperations(true, 0)).toBe(0);
  });
});

describe("remote targeting — roomLinearDistance", () => {
  it("相邻房距离 1", () => {
    expect(roomLinearDistance("W1N1", "W2N1")).toBe(1);
    expect(roomLinearDistance("W1N1", "W1N2")).toBe(1);
  });
});
