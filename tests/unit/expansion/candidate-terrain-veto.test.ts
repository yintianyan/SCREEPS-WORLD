/** R651：claim 之前的地形/锚点否决（W38S58 反例）。 */
import { describe, expect, it } from "vitest";
import { buildCandidate } from "../../../src/domain/expansion/candidate";
import type { RoomIntel } from "../../../src/domain/intel";

function makeIntel(over: Partial<RoomIntel> = {}): RoomIntel {
  return { kind: "normal", status: "normal", sources: 2, lastSeen: 1000, ...over };
}

function build(over: Partial<RoomIntel>) {
  return buildCandidate("W38S58", "W37S58", makeIntel(over), ["W37S58"], 1000, "me");
}

describe("buildCandidate — R651 选点前置否决", () => {
  it("W38S58 实测参数（wallRatio 0.50 + anchorToController 28）⇒ REJECTED", () => {
    const c = build({ wallRatio: 0.5, anchorToController: 28, bestAnchorScore: -12 });
    expect(c.status).toBe("REJECTED");
    expect(c.vetoReason).toMatch(/terrain-walls|anchor-far-ctrl/);
  });

  it("墙占比 0.41 ⇒ 拒（阈值 0.4）", () => {
    const c = build({ wallRatio: 0.41, anchorToController: 10, bestAnchorScore: 15 });
    expect(c.status).toBe("REJECTED");
    expect(c.vetoReason).toContain("terrain-walls");
  });

  it("锚点到 controller 26 格 ⇒ 拒（阈值 25）", () => {
    const c = build({ wallRatio: 0.1, anchorToController: 26, bestAnchorScore: 15 });
    expect(c.status).toBe("REJECTED");
    expect(c.vetoReason).toContain("anchor-far-ctrl");
  });

  it("最佳锚点评分为负 ⇒ 拒（地板 0）", () => {
    const c = build({ wallRatio: 0.1, anchorToController: 10, bestAnchorScore: -0.5 });
    expect(c.status).toBe("REJECTED");
    expect(c.vetoReason).toContain("anchor-score");
  });

  it("健康地形（0.1 / 8 / +20）⇒ DISCOVERED", () => {
    const c = build({ wallRatio: 0.1, anchorToController: 8, bestAnchorScore: 20 });
    expect(c.status).toBe("DISCOVERED");
    expect(c.vetoReason).toBeUndefined();
    expect(c.terrain.wallRatio).toBe(0.1);
    expect(c.terrain.anchorToController).toBe(8);
  });

  it("未侦察地形（字段缺省）⇒ 不因地形否决（留给侦察后复核）", () => {
    const c = build({});
    expect(c.status).toBe("DISCOVERED");
  });
});
