/**
 * 重占排除 —— 主动放弃的房不能被扩张管道立刻捡回来。
 * 立案依据：unclaim 之后这房是「无主 + 留着我们建的路与容器」，七因子评分恰恰会因为
 * 现成工事给它高分；而存量候选只在 Intel 刷新时才重算否决，光靠 buildCandidate 挡不住。
 */
import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  dropReleasedRooms,
  type ExpansionCandidateV2,
} from "../../../../src/domain/expansion/candidate";
import { discoverCandidates } from "../../../../src/domain/expansion/discovery";

/** 一间无主、有两源、无塔无墙的普通房 —— 扩张视角的「好目标」。 */
const goodIntel: any = {
  kind: "normal",
  status: "normal",
  sources: 2,
  lastSeen: 1000,
  sealedExits: [],
};

function candidate(roomName: string, overrides: Partial<ExpansionCandidateV2> = {}): any {
  return { roomName, status: "QUALIFIED", score: 80, ...overrides };
}

describe("expansion — 重占排除", () => {
  it("buildCandidate 对排除表内的房硬否决，理由可归因", () => {
    const c = buildCandidate("W37S55", "W37S58", goodIntel, ["W37S58"], 1000, "Me", ["W37S55"]);
    expect(c.status).toBe("REJECTED");
    expect(c.vetoReason).toBe("recently-released");
  });

  it("排除表外的房不受影响（同 intel 应正常进入 DISCOVERED）", () => {
    const c = buildCandidate("W37S56", "W37S58", goodIntel, ["W37S58"], 1000, "Me", ["W37S55"]);
    expect(c.vetoReason).toBeUndefined();
    expect(c.status).toBe("DISCOVERED");
  });

  it("discoverCandidates 把排除表透传给候选重建", () => {
    const result = discoverCandidates({
      ownedRoomNames: ["W37S58"],
      releasedRoomNames: ["W37S55"],
      intelBySponsor: { W37S58: { W37S55: goodIntel, W37S56: goodIntel } },
      tick: 1000,
      myUsername: "Me",
    });
    const released = result.candidates.find(c => c.roomName === "W37S55");
    const untouched = result.candidates.find(c => c.roomName === "W37S56");
    expect(released?.vetoReason).toBe("recently-released");
    expect(untouched?.vetoReason).toBeUndefined();
  });

  it("dropReleasedRooms 剔掉存量已评分的排除房内记录（不等 Intel 刷新）", () => {
    const pool = [candidate("W37S55"), candidate("W37S56")];
    const kept = dropReleasedRooms(pool, { W37S55: 900 });
    expect(kept.map(c => c.roomName)).toEqual(["W37S56"]);
  });

  it("排除表为空/缺失时不改写候选顺序与内容", () => {
    const pool = [candidate("W37S55"), candidate("W37S56")];
    expect(dropReleasedRooms(pool, undefined).map(c => c.roomName)).toEqual(["W37S55", "W37S56"]);
    expect(dropReleasedRooms(pool, {}).map(c => c.roomName)).toEqual(["W37S55", "W37S56"]);
  });
});
