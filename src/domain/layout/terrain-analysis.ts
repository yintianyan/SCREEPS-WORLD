/**
 * 地形分析 — Distance Transform 计算房间开放度。
 *
 * Distance Transform 为每个非墙格赋值"到最近墙/边界的距离"，
 * 值越大 = 周围越开阔 = 越适合放置核心建筑群。
 *
 * 算法：Chamfer 3-4 近似距离变换（两遍扫描）。
 *   - 正交方向代价 3，对角方向代价 4（近似欧氏距离 ×3）
 *   - 前向扫描（左上→右下）：传播上/左/左上/右上邻居
 *   - 后向扫描（右下→左上）：传播下/右/左下/右下邻居
 *   - 最终值 ÷3 归一化为整数格距离
 *
 * CPU 成本：O(50×50) = 2500 次比较/赋值 ≈ 0.01ms，可忽略。
 * 缓存策略：地形永不变，每房计算一次后存入 RawMemory segment。
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */

/** 50×50 距离场，index = x*50+y，值 = 到最近墙的格距离（0=墙，255=INF 截断）。 */
export type DistanceField = Uint8Array;

/** 墙/边界初始值（足够大，两遍扫描后会被正确距离替代）。 */
const INF = 200;

/**
 * 计算房间的 Chamfer 3-4 Distance Transform。
 *
 * @param getTerrain 地形查询函数 (x,y) → 是否墙。
 *   注入而非直接传 RoomTerrain，使模块可在 Vitest 中无 Screeps 全局运行。
 * @returns DistanceField (Uint8Array, length 2500)
 */
export function computeDistanceField(
  getTerrain: (x: number, y: number) => boolean,
): DistanceField {
  const field = new Uint8Array(2500);

  // 初始化：墙/边界 = 0，开放格 = INF
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const isWall = x === 0 || x === 49 || y === 0 || y === 49 || getTerrain(x, y);
      field[x * 50 + y] = isWall ? 0 : INF;
    }
  }

  // 前向扫描（左上→右下）
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      const i = x * 50 + y;
      if (field[i] === 0) continue;
      // 上（正交 +3）、左（正交 +3）、左上（对角 +4）、右上（对角 +4）
      const up = field[(x - 1) * 50 + y]! + 3;
      const left = field[x * 50 + (y - 1)]! + 3;
      const upLeft = field[(x - 1) * 50 + (y - 1)]! + 4;
      const upRight = field[(x + 1) * 50 + (y - 1)]! + 4;
      const min = Math.min(field[i]!, up, left, upLeft, upRight);
      field[i] = min;
    }
  }

  // 后向扫描（右下→左上）
  for (let x = 48; x >= 1; x--) {
    for (let y = 48; y >= 1; y--) {
      const i = x * 50 + y;
      if (field[i] === 0) continue;
      // 下（正交 +3）、右（正交 +3）、左下（对角 +4）、右下（对角 +4）
      const down = field[(x + 1) * 50 + y]! + 3;
      const right = field[x * 50 + (y + 1)]! + 3;
      const downLeft = field[(x - 1) * 50 + (y + 1)]! + 4;
      const downRight = field[(x + 1) * 50 + (y + 1)]! + 4;
      const min = Math.min(field[i]!, down, right, downLeft, downRight);
      field[i] = min;
    }
  }

  // 归一化：÷3（正交距离单位），截断到 [0, 255]
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
 * 找到开放度 >= threshold 的所有格。
 *
 * threshold 含义：
 *   3 → 3×3 区域无墙（最小核心）
 *   4 → 约 4 格半径无墙（标准核心）
 *   5 → 约 5 格半径无墙（宽松核心）
 *
 * @param field 距离场
 * @param threshold 最低开放度
 * @param bounds 搜索范围（默认 [3,46]，留出边界安全距离）
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

/**
 * 计算以 (cx,cy) 为中心、radius 为半径的方形区域内被墙/边界阻挡的格数。
 * 用于锚点评分 — blockedCells 越少 = 核心模板落地越顺利。
 */
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
