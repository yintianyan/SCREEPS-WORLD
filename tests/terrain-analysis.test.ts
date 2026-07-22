import { describe, it, expect } from "vitest";
import {
  computeDistanceField,
  opennessAt,
  findOpenRegion,
  countBlockedCells,
} from "../src/domain/layout/terrain-analysis";

/** 全开放地形（无墙）。 */
const noWalls = (_x: number, _y: number): boolean => false;

/** 全墙地形。 */
const allWalls = (_x: number, _y: number): boolean => true;

/** 中心有 3×3 墙块的地形。 */
function centerWalls(cx: number, cy: number, radius: number) {
  return (x: number, y: number): boolean =>
    Math.abs(x - cx) <= radius && Math.abs(y - cy) <= radius;
}

/** 走廊地形：只有 y=25 一行是开放的，其余全墙。 */
function corridorTerrain(openY: number) {
  return (x: number, y: number): boolean => {
    if (x === 0 || x === 49 || y === 0 || y === 49) return false; // 边界由 DT 处理
    return y !== openY;
  };
}

describe("terrain-analysis — computeDistanceField", () => {
  it("全开放地形：中心格开放度最大（约 24）", () => {
    const field = computeDistanceField(noWalls);
    // 中心 (25,25) 到最近边界（x=0 或 y=0）距离 = 25，但边界格本身是 0
    // 所以 (25,25) 的距离 ≈ 24（到 x=0 边界格的距离）
    const center = opennessAt(field, 25, 25);
    expect(center).toBeGreaterThanOrEqual(20);
    expect(center).toBeLessThanOrEqual(25);
  });

  it("全开放地形：边界相邻格开放度 = 1", () => {
    const field = computeDistanceField(noWalls);
    // (1,1) 紧邻边界 (0,*) 和 (*,0)，距离 = 1
    expect(opennessAt(field, 1, 1)).toBe(1);
    // (1,25) 紧邻 x=0 边界，距离 = 1
    expect(opennessAt(field, 1, 25)).toBe(1);
  });

  it("全墙地形：所有格开放度 = 0", () => {
    const field = computeDistanceField(allWalls);
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        expect(opennessAt(field, x, y)).toBe(0);
      }
    }
  });

  it("墙块旁的格开放度 = 1", () => {
    const field = computeDistanceField(centerWalls(25, 25, 1));
    // (25,25) 是墙
    expect(opennessAt(field, 25, 25)).toBe(0);
    // (25,23) 紧邻墙块（25,24 是墙），距离 = 1
    expect(opennessAt(field, 25, 23)).toBe(1);
    // (25,22) 距墙 2 格
    expect(opennessAt(field, 25, 22)).toBe(2);
  });

  it("走廊地形：走廊中心开放度 = 1（上下都是墙）", () => {
    const field = computeDistanceField(corridorTerrain(25));
    // (25,25) 在走廊上，上下 (25,24) 和 (25,26) 都是墙
    expect(opennessAt(field, 25, 25)).toBe(1);
    // 墙格 = 0
    expect(opennessAt(field, 25, 24)).toBe(0);
  });

  it("距离场单调性：离墙越远值越大", () => {
    const field = computeDistanceField(centerWalls(25, 25, 2));
    // 从墙向外，距离应递增
    const d0 = opennessAt(field, 25, 25); // 墙
    const d1 = opennessAt(field, 25, 22); // 距墙 1
    const d2 = opennessAt(field, 25, 21); // 距墙 2
    const d3 = opennessAt(field, 25, 20); // 距墙 3
    expect(d0).toBe(0);
    expect(d1).toBeGreaterThanOrEqual(1);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });

  it("越界查询返回 0", () => {
    const field = computeDistanceField(noWalls);
    expect(opennessAt(field, -1, 25)).toBe(0);
    expect(opennessAt(field, 50, 25)).toBe(0);
    expect(opennessAt(field, 25, -1)).toBe(0);
    expect(opennessAt(field, 25, 50)).toBe(0);
  });
});

describe("terrain-analysis — findOpenRegion", () => {
  it("全开放地形 threshold=3 返回大量候选", () => {
    const field = computeDistanceField(noWalls);
    const region = findOpenRegion(field, 3);
    // 44×44 搜索范围内，大部分格 openness >= 3（除了靠近边界的 2 格）
    expect(region.length).toBeGreaterThan(1500);
  });

  it("全墙地形返回空", () => {
    const field = computeDistanceField(allWalls);
    const region = findOpenRegion(field, 1);
    expect(region.length).toBe(0);
  });

  it("走廊地形 threshold=1 只返回走廊格", () => {
    const field = computeDistanceField(corridorTerrain(25));
    const region = findOpenRegion(field, 1);
    // 只有 y=25 的格是开放的
    for (const r of region) {
      expect(r.y).toBe(25);
    }
    expect(region.length).toBeGreaterThan(0);
  });

  it("threshold 越高候选越少", () => {
    const field = computeDistanceField(noWalls);
    const r3 = findOpenRegion(field, 3);
    const r5 = findOpenRegion(field, 5);
    const r10 = findOpenRegion(field, 10);
    expect(r3.length).toBeGreaterThan(r5.length);
    expect(r5.length).toBeGreaterThan(r10.length);
  });
});

describe("terrain-analysis — countBlockedCells", () => {
  it("全开放地形：7×7 区域无阻挡", () => {
    const blocked = countBlockedCells(25, 25, 3, noWalls);
    expect(blocked).toBe(0);
  });

  it("中心有墙：blockedCells > 0", () => {
    const blocked = countBlockedCells(25, 25, 3, centerWalls(25, 25, 1));
    // 3×3 墙块在 7×7 区域内
    expect(blocked).toBe(9);
  });

  it("靠近边界：越界格算 blocked", () => {
    // (2,2) 的 7×7 区域：x 从 -1 到 5，y 从 -1 到 5
    // 越界条件：x<1 或 y<1
    // x∈{-1,0} → 2列×7行=14，y∈{-1,0} → 7列×2行=14，重叠 2×2=4
    // 总越界 = 14 + 14 - 4 = 24
    const blocked = countBlockedCells(2, 2, 3, noWalls);
    expect(blocked).toBe(24);
  });
});
