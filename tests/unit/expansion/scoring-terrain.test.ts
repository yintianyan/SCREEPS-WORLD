/** R651：terrainFit 因子与 center 加成进入候选总分。 */
import { describe, expect, it } from "vitest";
import { buildCandidate } from "../../../src/domain/expansion/candidate";
import { scoreCandidate } from "../../../src/domain/expansion/scoring";
import type { RoomIntel } from "../../../src/domain/intel";

function makeIntel(over: Partial<RoomIntel> = {}): RoomIntel {
  return { kind: "normal", status: "normal", sources: 3, lastSeen: 1000, ...over };
}

function score(over: Partial<RoomIntel>, kind?: "normal" | "center") {
  const c = buildCandidate(
    "W5N5",
    "W1N1",
    makeIntel({ ...over, kind: kind ?? "normal" }),
    [],
    1000,
    "me",
  );
  return scoreCandidate({ candidate: c });
}

describe("scoreCandidate — R651 地形因子", () => {
  it("好地形 > 差地形（其它条件相同）", () => {
    const good = score({ wallRatio: 0.05, anchorToController: 6, bestAnchorScore: 25 });
    const bad = score({ wallRatio: 0.39, anchorToController: 24, bestAnchorScore: 1 });
    expect(good.breakdown.terrainFit!).toBeGreaterThan(bad.breakdown.terrainFit!);
    expect(good.breakdown.total).toBeGreaterThan(bad.breakdown.total);
  });

  it("未侦察地形 ⇒ terrainFit 取保守 0.5（不制造假优势）", () => {
    const r = score({});
    expect(r.breakdown.terrainFit).toBe(0.5);
  });

  it("center 房获得加成（同地形下总分更高）", () => {
    const terrain = { wallRatio: 0.2, anchorToController: 15, bestAnchorScore: 10 };
    const normal = score(terrain, "normal");
    const center = score(terrain, "center");
    expect(center.breakdown.total).toBeGreaterThan(normal.breakdown.total);
  });
});
