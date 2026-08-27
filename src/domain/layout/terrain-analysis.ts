/** 地形分析 — Chamfer 3-4 Distance Transform 计算房间开放度： */

/** 50×50 距离场，index = x*50+y，值 = 到最近墙的格距离（0=墙，255=INF 截断）。 */
export type DistanceField = Uint8Array;

/** 墙/边界初始值（足够大，两遍扫描后会被正确距离替代）。 */
const INF = 200;

/** 计算 Chamfer 3-4 Distance Transform；getTerrain 注入以便 Vitest 无 Screeps 全局运行。 */
export function computeDistanceField(
  getTerrain: (x: number, y: number) => boolean,
): DistanceField {
  const field = new Uint8Array(2500);

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const isWall = x === 0 || x === 49 || y === 0 || y === 49 || getTerrain(x, y);
      field[x * 50 + y] = isWall ? 0 : INF;
    }
  }

  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      const i = x * 50 + y;
      if (field[i] === 0) continue;
      const up = field[(x - 1) * 50 + y]! + 3;
      const left = field[x * 50 + (y - 1)]! + 3;
      const upLeft = field[(x - 1) * 50 + (y - 1)]! + 4;
      const upRight = field[(x + 1) * 50 + (y - 1)]! + 4;
      const min = Math.min(field[i]!, up, left, upLeft, upRight);
      field[i] = min;
    }
  }

  for (let x = 48; x >= 1; x--) {
    for (let y = 48; y >= 1; y--) {
      const i = x * 50 + y;
      if (field[i] === 0) continue;
      const down = field[(x + 1) * 50 + y]! + 3;
      const right = field[x * 50 + (y + 1)]! + 3;
      const downLeft = field[(x - 1) * 50 + (y + 1)]! + 4;
      const downRight = field[(x + 1) * 50 + (y + 1)]! + 4;
      const min = Math.min(field[i]!, down, right, downLeft, downRight);
      field[i] = min;
    }
  }

  for (let i = 0; i < 2500; i++) {
    field[i] = Math.min(Math.floor(field[i]! / 3), 255);
  }

  return field;
}

/** 查询某格的开放度（到最近墙的格距离）。越界返回 0。 */
export function opennessAt(field: DistanceField, x: number, y: number): number {
  if (x < 0 || x >= 50 || y < 0 || y >= 50) return 0;
  return field[x * 50 + y] ?? 0;
}

/**
 * 找到开放度 >= threshold 的所有格。threshold 含义：3 → 3×3 无墙
 * （最小核心）、4 → 约 4 格半径无墙（标准核心）、5 → 约 5 格半径
 * （宽松核心）。bounds 默认 [3,46]，留出边界安全距离。
 */
export function findOpenRegion(
  field: DistanceField,
  threshold: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number } = { minX: 3, maxX: 46, minY: 3, maxY: 46 },
): { x: number; y: number; openness: number }[] {
  const results: { x: number; y: number; openness: number }[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      const v = field[x * 50 + y]!;
      if (v >= threshold) results.push({ x, y, openness: v });
    }
  }
  return results;
}

/** 计算 (cx,cy) 为中心、radius 方形区域内被墙/边界阻挡的格数；blockedCells 越少 = 核心模板落地越顺利。 */
export function countBlockedCells(
  cx: number,
  cy: number,
  radius: number,
  getTerrain: (x: number, y: number) => boolean,
): number {
  let blocked = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) { blocked++; continue; }
      if (getTerrain(x, y)) blocked++;
    }
  }
  return blocked;
}
