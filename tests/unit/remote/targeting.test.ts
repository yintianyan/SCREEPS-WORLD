/**
 * 远矿目标选择测试。
 *
 * 覆盖：候选筛选（kind/owner/status）、排序优先级、去重、过期暂停。
 */
import { describe, expect, it } from "vitest";
import { selectRemoteTargets, shouldPauseOperation } from "../../../src/domain/remote/targeting";
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
  it("无 intel 时返回空列表", () => {
    const result = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: undefined,
      existingOps: undefined,
      tick,
      staleThreshold,
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
