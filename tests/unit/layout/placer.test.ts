import { describe, it, expect } from "vitest";
import { computeDistanceField } from "../../../src/domain/layout/terrain-analysis";
import { placeStructures, placementsToCandidates, DEFAULT_PLACER_CONFIG } from "../../../src/domain/layout/constraint-placer";
import { packPos } from "../../../src/domain/layout/types";

const noWalls = (_x: number, _y: number): boolean => false;

/** 中心有 5×5 墙块的地形。 */
function centerBlock(cx: number, cy: number, r: number) {
  return (x: number, y: number): boolean =>
    Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;
}

describe("constraint-placer — placeStructures", () => {
  it("RCL2：放置 5 个 extension", () => {
    const field = computeDistanceField(noWalls);
    const occupied = new Set<number>();
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 2, occupied, new Map());

    const extensions = result.filter(p => p.structureType === STRUCTURE_EXTENSION);
    expect(extensions.length).toBe(5);
    // 所有 extension 都是 priority 1, phase rcl2
    for (const ext of extensions) {
      expect(ext.priority).toBe(1);
      expect(ext.phase).toBe("rcl2");
    }
  });

  it("RCL4：累计 20 extension + 1 storage + 1 tower", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 4, new Set(), new Map());

    const extensions = result.filter(p => p.structureType === STRUCTURE_EXTENSION);
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    const storages = result.filter(p => p.structureType === STRUCTURE_STORAGE);
    expect(extensions.length).toBe(20);
    expect(towers.length).toBe(1);
    expect(storages.length).toBe(1);
  });

  it("RCL8：完整结构集（60 ext + 3 tower + 3 spawn + 1 storage + 0 link + 1 terminal + 1 factory + 10 lab）", () => {
    // LINK 不再由 constraint-placer 放置 — 它的评分算法不理解 link 角色
    // （source/storage/controller），会导致 RCL5 仅有的 2 个 link 分配为 2 个
    // source link 或 2 个 storage link，link 网络失效。
    // 所有 link 由 task-factory 的 create*LinkTask 按角色优先级放置。
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    const count = (type: string) => result.filter(p => p.structureType === type).length;
    expect(count(STRUCTURE_EXTENSION)).toBe(60);
    expect(count(STRUCTURE_TOWER)).toBe(3);
    expect(count(STRUCTURE_SPAWN)).toBe(2); // RCL7+8 各 1（锚点 spawn 不计入）
    expect(count(STRUCTURE_STORAGE)).toBe(1);
    expect(count(STRUCTURE_LINK)).toBe(0); // link 由 task-factory 按角色放置
    expect(count(STRUCTURE_TERMINAL)).toBe(1);
    expect(count(STRUCTURE_FACTORY)).toBe(1);
    expect(count(STRUCTURE_LAB)).toBe(10);
  });

  it("无重叠：所有位置唯一", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    const positions = new Set<number>();
    for (const p of result) {
      const packed = packPos(p.pos.x, p.pos.y);
      expect(positions.has(packed)).toBe(false);
      positions.add(packed);
    }
  });

  it("偶校验：所有结构在偶校验格（dx+dy 偶数）", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const result = placeStructures(anchor, field, noWalls, 8, new Set(), new Map());

    for (const p of result) {
      const dx = p.pos.x - anchor.x;
      const dy = p.pos.y - anchor.y;
      expect(((dx + dy) % 2 + 2) % 2).toBe(0);
    }
  });

  it("边界内：所有结构在 [2,47] 范围", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    for (const p of result) {
      expect(p.pos.x).toBeGreaterThanOrEqual(2);
      expect(p.pos.x).toBeLessThanOrEqual(47);
      expect(p.pos.y).toBeGreaterThanOrEqual(2);
      expect(p.pos.y).toBeLessThanOrEqual(47);
    }
  });

  it("不占预占用格", () => {
    const field = computeDistanceField(noWalls);
    const preOccupied = new Set<number>();
    // 占用锚点周围大量格
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        preOccupied.add(packPos(25 + dx, 25 + dy));
      }
    }
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 4, preOccupied, new Map());

    for (const p of result) {
      expect(preOccupied.has(packPos(p.pos.x, p.pos.y))).toBe(false);
    }
  });

  it("不密封：每个障碍结构至少有 1 个正交可站邻居", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    // 构建最终占用集
    const occupied = new Set<number>();
    occupied.add(packPos(25, 25)); // anchor
    for (const p of result) occupied.add(packPos(p.pos.x, p.pos.y));

    const orthogonal: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const p of result) {
      // 检查至少有 1 个正交邻居不在占用集中（可站格）
      let hasFree = false;
      for (const [dx, dy] of orthogonal) {
        const nx = p.pos.x + dx;
        const ny = p.pos.y + dy;
        if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
        if (!occupied.has(packPos(nx, ny))) { hasFree = true; break; }
      }
      expect(hasFree).toBe(true);
    }
  });

  it("有墙地形：结构避开墙格", () => {
    const wallTerrain = centerBlock(25, 25, 2);
    const field = computeDistanceField(wallTerrain);
    // 锚点不在墙上
    const result = placeStructures({ x: 25, y: 20 }, field, wallTerrain, 4, new Set(), new Map());

    for (const p of result) {
      expect(wallTerrain(p.pos.x, p.pos.y)).toBe(false);
    }
  });

  it("Lab 集群：相互 Chebyshev <= 2", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 6, new Set(), new Map());

    const labs = result.filter(p => p.structureType === STRUCTURE_LAB);
    expect(labs.length).toBe(3);

    // 每个 lab 至少与另一个 lab Chebyshev <= 2
    for (const lab of labs) {
      const hasNeighbor = labs.some(
        other => other !== lab &&
          Math.max(Math.abs(other.pos.x - lab.pos.x), Math.abs(other.pos.y - lab.pos.y)) <= 2,
      );
      expect(hasNeighbor).toBe(true);
    }
  });

  it("key 唯一", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    const keys = new Set<string>();
    for (const p of result) {
      expect(keys.has(p.key)).toBe(false);
      keys.add(p.key);
    }
  });
});

describe("constraint-placer — placementsToCandidates", () => {
  it("转换格式正确", () => {
    const field = computeDistanceField(noWalls);
    const placements = placeStructures({ x: 25, y: 25 }, field, noWalls, 2, new Set(), new Map());
    const candidates = placementsToCandidates(placements, "W1N1");

    expect(candidates.length).toBe(placements.length);
    for (const c of candidates) {
      expect(c.pos.roomName).toBe("W1N1");
      expect(c.validation).toBe("ok");
      expect(c.key).toMatch(/^constraint\./);
    }
  });
});

describe("constraint-placer — 极端地形", () => {
  it("狭长走廊（5 格宽）：仍能放置 RCL2 结构", () => {
    // 只有 y=23..27 开放，其余全墙
    const corridor = (_x: number, y: number): boolean => y < 23 || y > 27;
    const field = computeDistanceField(corridor);
    const result = placeStructures({ x: 25, y: 25 }, field, corridor, 2, new Set(), new Map());

    // 走廊 5 格宽，偶校验格有限，但至少能放几个 extension
    const extensions = result.filter(p => p.structureType === STRUCTURE_EXTENSION);
    expect(extensions.length).toBeGreaterThanOrEqual(1);
    // 所有结构在走廊内
    for (const p of result) {
      expect(p.pos.y).toBeGreaterThanOrEqual(23);
      expect(p.pos.y).toBeLessThanOrEqual(27);
    }
  });

  it("锚点偏角（8,8）：结构不越界", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 8, y: 8 }, field, noWalls, 4, new Set(), new Map());

    for (const p of result) {
      expect(p.pos.x).toBeGreaterThanOrEqual(2);
      expect(p.pos.y).toBeGreaterThanOrEqual(2);
    }
    // 仍能放置大部分结构
    const extensions = result.filter(p => p.structureType === STRUCTURE_EXTENSION);
    expect(extensions.length).toBeGreaterThanOrEqual(15);
  });
});
