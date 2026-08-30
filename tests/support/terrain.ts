/**
 * 共享地形网格工具（FREEZE R20①）— 纯 50×50 网格，0=plain / 1=wall / 2=swamp。
 * 全仓唯一实现；integration TestWorld（网格语义）直接消费。
 * e2e 侧引擎绑定的 TerrainMatrix 构造（WorldBuilder.emptyTerrain 等）依赖
 * screeps-server-mockup 类，不属本层——只消灭纯网格版的同名重复。
 */
export type TerrainGrid = number[][];

export type TerrainCell = { x: number; y: number };

/** 生成全平地地形。 */
export function flatTerrain(): TerrainGrid {
  return Array.from({ length: 50 }, () => Array(50).fill(0));
}

/** 生成带墙壁的地形。 */
export function terrainWithWalls(walls: TerrainCell[]): TerrainGrid {
  const grid = flatTerrain();
  for (const w of walls) {
    if (w.x >= 0 && w.x < 50 && w.y >= 0 && w.y < 50) {
      grid[w.y]![w.x] = 1;
    }
  }
  return grid;
}

/** 生成带沼泽的地形。 */
export function terrainWithSwamps(swamps: TerrainCell[]): TerrainGrid {
  const grid = flatTerrain();
  for (const s of swamps) {
    if (s.x >= 0 && s.x < 50 && s.y >= 0 && s.y < 50) {
      grid[s.y]![s.x] = 2;
    }
  }
  return grid;
}
