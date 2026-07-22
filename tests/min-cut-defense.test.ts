import { describe, it, expect } from "vitest";
import { computeMinCutDefense } from "../src/domain/layout/min-cut-defense";

/** 全开放地形。 */
const noWalls = (_x: number, _y: number): boolean => false;

/**
 * 走廊地形：只有一条宽 W 的水平走廊（y = corridorY ± halfW），其余全墙。
 * 出口在走廊两端（x=0 和 x=49）。
 */
function corridorTerrain(corridorY: number, halfWidth: number) {
  return (x: number, y: number): boolean => {
    if (x === 0 || x === 49) return false; // 出口边
    return Math.abs(y - corridorY) > halfWidth;
  };
}

/**
 * 瓶颈地形：中间有一堵墙，只留 1 格宽的通道。
 * 墙在 x=25，通道在 (25, corridorY)。
 */
function bottleneckTerrain(corridorY: number) {
  return (x: number, y: number): boolean => {
    if (x === 0 || x === 49) return false;
    if (x === 25 && y !== corridorY) return true; // 墙，只留 corridorY 通道
    return false;
  };
}

describe("min-cut-defense — 基本功能", () => {
  it("走廊地形（宽 3）：割集较小（<= 5 个 rampart 即可封锁）", () => {
    const terrain = corridorTerrain(25, 1); // 走廊 y=24,25,26
    const core = [{ x: 30, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    const result = computeMinCutDefense(terrain, core, exits, 30);
    expect(result.complete).toBe(true);
    // 走廊宽 3 格，割集应该很小（<= 5，考虑图邻接结构）
    expect(result.cutSize).toBeLessThanOrEqual(5);
    expect(result.cutSize).toBeGreaterThanOrEqual(1);
    expect(result.rampartPositions.length).toBe(result.cutSize);
  });

  it("瓶颈地形（1 格通道）：割集很小（<= 2）", () => {
    const terrain = bottleneckTerrain(25);
    const core = [{ x: 30, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    const result = computeMinCutDefense(terrain, core, exits, 30);
    expect(result.complete).toBe(true);
    // 瓶颈处割集应该非常小（1-2，取决于多路径汇聚）
    expect(result.cutSize).toBeLessThanOrEqual(2);
    expect(result.cutSize).toBeGreaterThanOrEqual(1);
  });

  it("割集位置不在 source/sink 上", () => {
    const terrain = corridorTerrain(25, 2);
    const core = [{ x: 35, y: 25 }];
    const exits = [{ x: 0, y: 25 }, { x: 0, y: 24 }, { x: 0, y: 26 }];

    const result = computeMinCutDefense(terrain, core, exits, 30);
    if (result.complete) {
      for (const pos of result.rampartPositions) {
        const isCore = core.some(c => c.x === pos.x && c.y === pos.y);
        const isExit = exits.some(e => e.x === pos.x && e.y === pos.y);
        expect(isCore).toBe(false);
        expect(isExit).toBe(false);
      }
    }
  });

  it("空输入返回 complete=false", () => {
    const r1 = computeMinCutDefense(noWalls, [], [{ x: 0, y: 25 }], 30);
    expect(r1.complete).toBe(false);

    const r2 = computeMinCutDefense(noWalls, [{ x: 25, y: 25 }], [], 30);
    expect(r2.complete).toBe(false);
  });
});

describe("min-cut-defense — 开放地形 fallback", () => {
  it("全开放地形 4 出口：割集过大，超过 maxRamparts 时 complete=false", () => {
    // 全开放 50×50，核心在中心，出口在四边
    // 4 方向出口 → 割集需要封锁核心周围（~8+ 格），设 maxRamparts=3 触发 fallback
    const core = [{ x: 25, y: 25 }];
    const exits = [
      { x: 0, y: 25 }, { x: 49, y: 25 },
      { x: 25, y: 0 }, { x: 25, y: 49 },
    ];

    const result = computeMinCutDefense(noWalls, core, exits, 3);
    // 全开放地形 4 方向出口，割集 > 3，应该返回 complete=false
    expect(result.complete).toBe(false);
  });

  it("全开放地形 maxRamparts=30：可能成功（割集 ~8-12）", () => {
    const core = [{ x: 25, y: 25 }];
    const exits = [{ x: 0, y: 25 }]; // 单出口

    const result = computeMinCutDefense(noWalls, core, exits, 30);
    // 单出口方向，割集应该 <= 30
    if (result.complete) {
      expect(result.cutSize).toBeLessThanOrEqual(30);
      expect(result.rampartPositions.length).toBe(result.cutSize);
    }
  });
});

describe("min-cut-defense — 多出口", () => {
  it("走廊双出口：割集覆盖两个方向", () => {
    // 走廊 y=24..26，出口在 x=0 和 x=49 两端
    const terrain = corridorTerrain(25, 1);
    const core = [{ x: 25, y: 25 }]; // 核心在走廊中间
    const exits = [{ x: 0, y: 25 }, { x: 49, y: 25 }];

    const result = computeMinCutDefense(terrain, core, exits, 30);
    expect(result.complete).toBe(true);
    // 需要封锁两个方向，割集应该 > 单方向的割集
    expect(result.cutSize).toBeGreaterThanOrEqual(2);
  });
});

describe("min-cut-defense — 性能", () => {
  it("50×50 全开放地形在合理时间内完成", () => {
    const core = [{ x: 25, y: 25 }, { x: 26, y: 25 }, { x: 24, y: 25 }];
    const exits = [
      { x: 0, y: 25 }, { x: 49, y: 25 },
      { x: 25, y: 0 }, { x: 25, y: 49 },
    ];

    const start = performance.now();
    const result = computeMinCutDefense(noWalls, core, exits, 30);
    const elapsed = performance.now() - start;

    // 应该在 50ms 内完成（实际 ~1-5ms）
    expect(elapsed).toBeLessThan(50);
    // 结果有效（无论 complete 与否）
    expect(result.cutSize).toBeGreaterThanOrEqual(0);
  });
});
