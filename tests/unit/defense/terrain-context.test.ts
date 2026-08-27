/** A5.2 G3 — TerrainContext 纯函数测试。 */
import { describe, expect, it } from "vitest";
import {
  buildTerrainContext,
  deriveCombatModifier,
  terrainCacheSignature,
  type TerrainSnapshot,
} from "../../../src/domain/defense/terrain-context";

// ─── 测试辅助 ────────────────────────────────────────────────

function makeOpenSnapshot(opts: Partial<TerrainSnapshot> = {}): TerrainSnapshot {
  // 50x50 房间，几乎没有墙（open room）
  const isWall = (x: number, y: number): boolean => {
    // 边界墙不算（出口）
    if (x === 0 || x === 49 || y === 0 || y === 49) return false;
    return false; // 全开放
  };

  return {
    roomName: opts.roomName ?? "W1N1",
    corePos: opts.corePos ?? 25 * 50 + 25,
    rcl: opts.rcl ?? 8,
    openTileCount: opts.openTileCount ?? 2500,
    wallCount: opts.wallCount ?? 0,
    totalTiles: opts.totalTiles ?? 2500,
    rampartPositions: opts.rampartPositions ?? [],
    towerPositions: opts.towerPositions ?? [],
    roadPositions: opts.roadPositions ?? [],
    exitPositions: opts.exitPositions ?? [0, 49, 2500, 2499], // 4 个方向出口
    isWall: opts.isWall ?? isWall,
    hasVision: opts.hasVision ?? true,
  };
}

function makeDenseWallSnapshot(opts: Partial<TerrainSnapshot> = {}): TerrainSnapshot {
  // 50% 墙
  const isWall = (x: number, y: number): boolean => {
    if (x === 0 || x === 49 || y === 0 || y === 49) return false;
    return (x + y) % 2 === 0; // 棋盘格墙
  };
  let wallCount = 0;
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      if (isWall(x, y)) wallCount++;
    }
  }

  return {
    roomName: opts.roomName ?? "W2N2",
    corePos: opts.corePos ?? 25 * 50 + 25,
    rcl: opts.rcl ?? 8,
    openTileCount: opts.openTileCount ?? 2500 - wallCount,
    wallCount: opts.wallCount ?? wallCount,
    totalTiles: opts.totalTiles ?? 2500,
    rampartPositions: opts.rampartPositions ?? [],
    towerPositions: opts.towerPositions ?? [],
    roadPositions: opts.roadPositions ?? [],
    exitPositions: opts.exitPositions ?? [0, 49, 2500, 2499],
    isWall: opts.isWall ?? isWall,
    hasVision: opts.hasVision ?? true,
  };
}

function makeFortifiedSnapshot(opts: Partial<TerrainSnapshot> = {}): TerrainSnapshot {
  const isWall = (x: number, y: number): boolean => false;
  // 核心区 5x5 范围内放 rampart
  const corePos = 25 * 50 + 25;
  const ramparts: number[] = [];
  for (let dx = -5; dx <= 5; dx++) {
    for (let dy = -5; dy <= 5; dy++) {
      ramparts.push((25 + dx) * 50 + (25 + dy));
    }
  }
  // 3 个塔在核心附近
  const towers = [
    (25 - 3) * 50 + 25,
    (25 + 3) * 50 + 25,
    25 * 50 + (25 + 3),
  ];

  return {
    roomName: opts.roomName ?? "W3N3",
    corePos: opts.corePos ?? corePos,
    rcl: opts.rcl ?? 8,
    openTileCount: opts.openTileCount ?? 2500,
    wallCount: opts.wallCount ?? 0,
    totalTiles: opts.totalTiles ?? 2500,
    rampartPositions: opts.rampartPositions ?? ramparts,
    towerPositions: opts.towerPositions ?? towers,
    roadPositions: opts.roadPositions ?? [],
    exitPositions: opts.exitPositions ?? [0, 49, 2500, 2499],
    isWall: opts.isWall ?? isWall,
    hasVision: opts.hasVision ?? true,
  };
}

// ─── 测试 ─────────────────────────────────────────────────

describe("G3 — buildTerrainContext", () => {
  it("T01: Open Room → terrainType=OPEN or OPEN_FIELD, walkability=FULL", () => {
    const ctx = buildTerrainContext(makeOpenSnapshot(), 1000000);
    expect(["OPEN", "OPEN_FIELD"]).toContain(ctx.terrainType);
    expect(ctx.walkability).toBe("FULL");
    expect(ctx.openTileRatio).toBeGreaterThan(0.75);
    expect(ctx.wallDensity).toBe(0);
    expect(ctx.rampartCoverage).toBe("NONE");
    expect(ctx.chokepoints).toHaveLength(0);
  });

  it("T02: Dense Walls → wallDensity high, walkability restricted", () => {
    const ctx = buildTerrainContext(makeDenseWallSnapshot(), 1000000);
    expect(ctx.wallDensity).toBeGreaterThan(0.4);
    expect(ctx.walkability).not.toBe("FULL");
  });

  it("T03: Chokepoint — narrow passage identified", () => {
    // 构造一个有 chokepoint 的地形：核心区到出口之间有窄通道
    const isWall = (x: number, y: number): boolean => {
      // 在 x=10 处留一个 2 格宽的通道
      if (x === 10) {
        return y < 20 || y > 22;
      }
      return false;
    };
    let wallCount = 0;
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (isWall(x, y) && x > 0 && x < 49 && y > 0 && y < 49) wallCount++;
      }
    }
    const snapshot: TerrainSnapshot = {
      roomName: "W4N4",
      corePos: 25 * 50 + 25,
      rcl: 8,
      openTileCount: 2500 - wallCount,
      wallCount,
      totalTiles: 2500,
      rampartPositions: [],
      towerPositions: [],
      roadPositions: [],
      exitPositions: [0], // 左侧出口
      isWall,
      hasVision: true,
    };
    const ctx = buildTerrainContext(snapshot, 1000000);
    // 应该识别到某种受限地形
    expect(ctx.terrainType).not.toBe("OPEN_FIELD");
  });

  it("T04: Corridor — confined passage", () => {
    // 类似 chokepoint 但更长的通道
    const isWall = (x: number, y: number): boolean => {
      // y=20-22 之间留通道
      return y < 20 || y > 22;
    };
    let wallCount = 0;
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (isWall(x, y) && x > 0 && x < 49 && y > 0 && y < 49) wallCount++;
      }
    }
    const snapshot: TerrainSnapshot = {
      roomName: "W5N5",
      corePos: 25 * 50 + 25,
      rcl: 8,
      openTileCount: 2500 - wallCount,
      wallCount,
      totalTiles: 2500,
      rampartPositions: [],
      towerPositions: [],
      roadPositions: [],
      exitPositions: [0, 49],
      isWall,
      hasVision: true,
    };
    const ctx = buildTerrainContext(snapshot, 1000000);
    expect(ctx.walkability).not.toBe("FULL");
  });

  it("T05: Fortified Core → rampartCoverage=CORE_FORTIFIED", () => {
    const ctx = buildTerrainContext(makeFortifiedSnapshot(), 1000000);
    expect(ctx.rampartCoverage).toBe("CORE_FORTIFIED");
    expect(ctx.terrainType).toBe("FORTIFIED");
  });

  it("T06: Partial Rampart → rampartCoverage=PARTIAL", () => {
    const snapshot = makeOpenSnapshot({
      rampartPositions: [10 * 50 + 10, 10 * 50 + 11], // 只有 2 个 rampart
    });
    const ctx = buildTerrainContext(snapshot, 1000000);
    expect(ctx.rampartCoverage).toBe("PARTIAL");
  });

  it("T07: High Tower Exposure → towerCoverage=HIGH/CRITICAL", () => {
    const snapshot = makeFortifiedSnapshot();
    const ctx = buildTerrainContext(snapshot, 1000000, 25 * 50 + 22); // hostile near core
    expect(["HIGH", "CRITICAL"]).toContain(ctx.towerCoverage);
  });

  it("T08: Poor Retreat → retreatQuality=POOR/CRITICAL", () => {
    // 只有 1 个出口 + 有 chokepoint
    const snapshot: TerrainSnapshot = {
      roomName: "W6N6",
      corePos: 25 * 50 + 25,
      rcl: 8,
      openTileCount: 2000,
      wallCount: 500,
      totalTiles: 2500,
      rampartPositions: [],
      towerPositions: [],
      roadPositions: [],
      exitPositions: [0], // 只有 1 个出口
      isWall: () => false,
      hasVision: true,
    };
    const ctx = buildTerrainContext(snapshot, 1000000);
    expect(["POOR", "CRITICAL"]).toContain(ctx.retreatQuality);
  });

  it("T09: Unknown Terrain → hasVision=false → all UNKNOWN", () => {
    const snapshot = makeOpenSnapshot({ hasVision: false });
    const ctx = buildTerrainContext(snapshot, 1000000);
    expect(ctx.terrainType).toBe("UNKNOWN");
    expect(ctx.walkability).toBe("UNKNOWN");
    expect(ctx.rampartCoverage).toBe("UNKNOWN");
    expect(ctx.towerCoverage).toBe("UNKNOWN");
    expect(ctx.retreatQuality).toBe("UNKNOWN");
    expect(ctx.mobilityModifier).toBe(1.0);
  });
});

describe("G3 — deriveCombatModifier", () => {
  it("modifier values are in valid range", () => {
    const ctx = buildTerrainContext(makeOpenSnapshot(), 1000000);
    const mod = deriveCombatModifier(ctx);
    expect(mod.mobilityModifier).toBeGreaterThan(0);
    expect(mod.mobilityModifier).toBeLessThanOrEqual(2);
    expect(mod.towerDamageFactor).toBeGreaterThanOrEqual(0);
    expect(mod.towerDamageFactor).toBeLessThanOrEqual(1);
    expect(mod.retreatDifficulty).toBeGreaterThan(0);
    expect(mod.approachFactor).toBeGreaterThan(0);
    expect(mod.approachFactor).toBeLessThanOrEqual(1);
  });

  it("fortified terrain has high tower damage factor", () => {
    const ctx = buildTerrainContext(makeFortifiedSnapshot(), 1000000);
    const mod = deriveCombatModifier(ctx);
    expect(mod.towerDamageFactor).toBeGreaterThan(0.5);
  });
});

describe("G3 — terrainCacheSignature", () => {
  it("same snapshot produces same signature", () => {
    const snap = makeOpenSnapshot();
    expect(terrainCacheSignature(snap)).toBe(terrainCacheSignature(snap));
  });

  it("different rampart count produces different signature", () => {
    const snap1 = makeOpenSnapshot({ rampartPositions: [1] });
    const snap2 = makeOpenSnapshot({ rampartPositions: [1, 2] });
    expect(terrainCacheSignature(snap1)).not.toBe(terrainCacheSignature(snap2));
  });
});
