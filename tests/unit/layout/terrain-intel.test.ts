/** R651：选点前置的地形摘要（墙/沼泽占比 + 最佳锚点几何）。 */
import { describe, expect, it } from "vitest";
import { summarizeTerrain } from "../../../src/domain/layout/terrain-intel";

/** 平地（0）或棋盘墙（(x+y)%2）——后者正好 1,250 格墙。 */
function checker(): (x: number, y: number) => number {
  return (x, y) => ((x + y) % 2 === 0 ? 1 : 0);
}

function plain(): (x: number, y: number) => number {
  return () => 0;
}

describe("summarizeTerrain — 墙/沼泽比例", () => {
  it("棋盘墙 ⇒ wallRatio≈0.5（W38S58 级地形）", () => {
    const s = summarizeTerrain({
      getTerrainValue: checker(),
      sources: [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
      ],
      controller: { x: 25, y: 40 },
      exits: [],
    });
    expect(s.wallRatio).toBeCloseTo(0.5, 2);
    expect(s.swampRatio).toBeCloseTo(0, 5);
  });

  it("全沼泽 ⇒ swampRatio≈1、wallRatio 0", () => {
    const s = summarizeTerrain({
      getTerrainValue: () => 2,
      sources: [{ x: 10, y: 10 }],
      controller: { x: 20, y: 20 },
      exits: [],
    });
    expect(s.wallRatio).toBeCloseTo(0, 5);
    expect(s.swampRatio).toBeCloseTo(1, 5);
  });
});

describe("summarizeTerrain — 最佳锚点几何", () => {
  it("平地房 ⇒ 锚点可解、controller 距离有限", () => {
    const s = summarizeTerrain({
      getTerrainValue: plain(),
      sources: [
        { x: 12, y: 25 },
        { x: 38, y: 25 },
      ],
      controller: { x: 25, y: 40 },
      exits: [
        { x: 0, y: 25 },
        { x: 49, y: 25 },
        { x: 25, y: 0 },
        { x: 25, y: 49 },
      ],
    });
    expect(s.bestAnchorScore).toBeTypeOf("number");
    expect(s.anchorToController).toBeTypeOf("number");
    expect(s.anchorToController!).toBeLessThanOrEqual(30);
    expect(s.anchorToSources).toBeTypeOf("number");
  });

  it("R651b：遗留 spawn 远 ⇒ leftoverSpawnToAnchor 大（回 claim 布局校验）", () => {
    const s = summarizeTerrain({
      getTerrainValue: plain(),
      sources: [
        { x: 12, y: 25 },
        { x: 38, y: 25 },
      ],
      controller: { x: 25, y: 40 },
      exits: [{ x: 0, y: 25 }],
      spawns: [{ x: 45, y: 5 }],
    });
    expect(s.leftoverSpawnToAnchor).toBeTypeOf("number");
    expect(s.leftoverSpawnToAnchor!).toBeGreaterThan(12);
  });

  it("无 spawn ⇒ leftoverSpawnToAnchor 缺省", () => {
    const s = summarizeTerrain({
      getTerrainValue: plain(),
      sources: [{ x: 20, y: 25 }],
      controller: { x: 25, y: 30 },
      exits: [],
    });
    expect(s.leftoverSpawnToAnchor).toBeUndefined();
  });

  it("与 state-machine 同源：锚点评分由同一 selectAnchors 产出（平地应为正）", () => {
    const s = summarizeTerrain({
      getTerrainValue: plain(),
      sources: [
        { x: 20, y: 25 },
        { x: 30, y: 25 },
      ],
      controller: { x: 25, y: 30 },
      exits: [{ x: 0, y: 25 }],
    });
    expect(s.bestAnchorScore!).toBeGreaterThan(0);
  });
});

describe("summarizeTerrain — R662 锚点可放率", () => {
  it("开阔地形 ⇒ ratio = 1", () => {
    const s = summarizeTerrain({
      getTerrainValue: plain(),
      sources: [
        { x: 12, y: 25 },
        { x: 38, y: 25 },
      ],
      controller: { x: 25, y: 40 },
      exits: [{ x: 0, y: 25 }],
    });
    expect(s.anchorPlaceableRatio).toBeDefined();
    expect(s.anchorPlaceableRatio!).toBeGreaterThanOrEqual(0.999);
  });

  it("外围 20% 墙 + 核心开阔 ⇒ ratio ≥ 0.85", () => {
    const banded = (x: number, y: number) => {
      const d = Math.max(Math.abs(x - 25), Math.abs(y - 25));
      if (d <= 7) return 0;
      return (x * 7 + y * 13) % 10 < 2 ? 1 : 0;
    };
    const s = summarizeTerrain({
      getTerrainValue: banded,
      sources: [
        { x: 15, y: 25 },
        { x: 35, y: 25 },
      ],
      controller: { x: 25, y: 38 },
      exits: [],
    });
    expect(s.anchorPlaceableRatio!).toBeGreaterThanOrEqual(0.85);
  });

  it("30% 均匀墙 ⇒ ratio < 1（并通常低于 0.85）", () => {
    const hostile = (x: number, y: number) => ((x * 7 + y * 13) % 10 < 3 ? 1 : 0);
    const s = summarizeTerrain({
      getTerrainValue: hostile,
      sources: [{ x: 15, y: 25 }],
      controller: { x: 25, y: 38 },
      exits: [],
    });
    if (s.anchorPlaceableRatio !== undefined) {
      expect(s.anchorPlaceableRatio).toBeLessThan(1);
    }
  });
});
