/**
 * 扩张目标评估器测试。
 *
 * 覆盖：GCL 余量门禁、盲区拒选（无视野候选）、有主/非普通房/黑名单剔除、
 * source 数主导评分、情报过期剔除、跨 sponsor 择优。
 */
import { describe, expect, it } from "vitest";
import { selectExpansionTarget, type ExpansionInput } from "../../../src/domain/expansion/evaluator";
import type { RoomIntel } from "../../../src/domain/intel";

const tick = 50000;

function intel(overrides: Partial<RoomIntel>): RoomIntel {
  return {
    kind: "normal",
    status: "normal",
    sources: 2,
    lastSeen: tick - 100,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExpansionInput> = {}): ExpansionInput {
  return {
    ownedRoomNames: ["W1N1"],
    gclLevel: 2,
    intelBySponsor: { W1N1: { W2N1: intel({}) } },
    tick,
    ...overrides,
  };
}

describe("expansion — selectExpansionTarget", () => {
  it("GCL 无余量时不选目标", () => {
    expect(selectExpansionTarget(baseInput({ gclLevel: 1 }))).toBeUndefined();
  });

  it("有余量且候选合格时返回目标与 sponsor", () => {
    const target = selectExpansionTarget(baseInput());
    expect(target?.roomName).toBe("W2N1");
    expect(target?.sponsorRoom).toBe("W1N1");
    expect(target?.sources).toBe(2);
  });

  it("从未有过视野的房间不入选（claim 禁止盲选）", () => {
    const input = baseInput({
      intelBySponsor: { W1N1: { W2N1: intel({ sources: undefined }) } },
    });
    expect(selectExpansionTarget(input)).toBeUndefined();
  });

  it("有主房 / 非普通房 / 非 normal 状态被剔除", () => {
    const input = baseInput({
      intelBySponsor: {
        W1N1: {
          W2N1: intel({ owner: "enemy" }),
          W3N1: intel({ kind: "sk" }),
          W4N1: intel({ status: "novice" }),
        },
      },
    });
    expect(selectExpansionTarget(input)).toBeUndefined();
  });

  it("被他人预定的房被剔除，己方续期房仍可选", () => {
    const enemyReserved = baseInput({
      intelBySponsor: { W1N1: { W2N1: intel({ reservedBy: "enemy" }) } },
      myUsername: "me",
    });
    expect(selectExpansionTarget(enemyReserved)).toBeUndefined();

    const selfReserved = baseInput({
      intelBySponsor: { W1N1: { W2N1: intel({ reservedBy: "me" }) } },
      myUsername: "me",
    });
    expect(selectExpansionTarget(selfReserved)?.roomName).toBe("W2N1");
  });

  it("黑名单冷却期内的目标被剔除，到期后恢复", () => {
    const blacklisted = baseInput({ blacklist: { W2N1: tick + 1000 } });
    expect(selectExpansionTarget(blacklisted)).toBeUndefined();

    const expired = baseInput({ blacklist: { W2N1: tick - 1 } });
    expect(selectExpansionTarget(expired)?.roomName).toBe("W2N1");
  });

  it("source 数主导评分：双源房胜过更新鲜的单源房", () => {
    const input = baseInput({
      intelBySponsor: {
        W1N1: {
          W2N1: intel({ sources: 1, lastSeen: tick }), // 最新但单源
          W3N1: intel({ sources: 2, lastSeen: tick - 5000 }), // 较旧但双源
        },
      },
    });
    expect(selectExpansionTarget(input)?.roomName).toBe("W3N1");
  });

  it("情报超过陈旧上限不可信", () => {
    const input = baseInput({
      intelBySponsor: { W1N1: { W2N1: intel({ lastSeen: tick - 20000 }) } },
    });
    expect(selectExpansionTarget(input)).toBeUndefined();
  });

  it("已拥有的房间不会被再次选中", () => {
    const input = baseInput({
      ownedRoomNames: ["W1N1", "W2N1"],
      gclLevel: 3,
    });
    expect(selectExpansionTarget(input)).toBeUndefined();
  });
});

describe("selectExpansionTarget — R7b minSources 门禁", () => {
  it("minSources=2 时单源房被排除（节奏收紧）", () => {
    const input = baseInput({
      minSources: 2,
      intelBySponsor: {
        W1N1: {
          W2N1: intel({ sources: 1, lastSeen: tick }), // 单源 → 排除
          W3N1: intel({ sources: 2, lastSeen: tick }), // 双源 → 可选
        },
      },
    });
    expect(selectExpansionTarget(input)?.roomName).toBe("W3N1");
  });

  it("默认 minSources=1 保持既有行为（单源可选）", () => {
    const input = baseInput({
      intelBySponsor: { W1N1: { W2N1: intel({ sources: 1, lastSeen: tick }) } },
    });
    expect(selectExpansionTarget(input)?.roomName).toBe("W2N1");
  });
});
