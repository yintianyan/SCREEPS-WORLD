import { describe, it, expect } from "vitest";
import { computeDistanceField } from "../../../src/domain/layout/terrain-analysis";
import { placeStructures, placementsToCandidates, DEFAULT_PLACER_CONFIG, buildCandidateGrid } from "../../../src/domain/layout/constraint-placer";
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

  it("RCL8：完整结构集（60 ext + 6 tower + 3 spawn + 1 storage + 0 link + 1 terminal + 1 factory + 10 lab + 1 observer + 1 powerSpawn）", () => {
    // LINK 不再由 constraint-placer 放置 — 它的评分算法不理解 link 角色
    // （source/storage/controller），会导致 RCL5 仅有的 2 个 link 分配为 2 个
    // source link 或 2 个 storage link，link 网络失效。
    // 所有 link 由 task-factory 的 create*LinkTask 按角色优先级放置。
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    const count = (type: string) => result.filter(p => p.structureType === type).length;
    expect(count(STRUCTURE_EXTENSION)).toBe(60);
    expect(count(STRUCTURE_TOWER)).toBe(6); // 官方 RCL8 上限 6（旧表错写为 3）
    expect(count(STRUCTURE_SPAWN)).toBe(2); // RCL7+8 各 1（锚点 spawn 不计入）
    expect(count(STRUCTURE_STORAGE)).toBe(1);
    expect(count(STRUCTURE_LINK)).toBe(0); // link 由 task-factory 按角色放置
    expect(count(STRUCTURE_TERMINAL)).toBe(1);
    expect(count(STRUCTURE_FACTORY)).toBe(1);
    expect(count(STRUCTURE_LAB)).toBe(10);
    expect(count(STRUCTURE_OBSERVER)).toBe(1); // 旧手写 RCL_BATCHES 漏掉的类型
    expect(count(STRUCTURE_POWER_SPAWN)).toBe(1);
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

  it("sealTolerance=1：正交全堵但斜向可达的 extension 放行（默认严格守卫会拒绝）", () => {
    // 目标格 (25,25) 的 4 个正交邻居全部预占 → 正交可站数 = 0；
    // 斜向邻居（除锚点外）仍可站 — transfer 射程 1 含对角，可填充/维修。
    const field = computeDistanceField(noWalls);
    const anchor = { x: 24, y: 24 };
    const target = { x: 25, y: 25 };
    const preOccupied = new Set<number>([
      packPos(24, 25),
      packPos(26, 25),
      packPos(25, 24),
      packPos(25, 26),
    ]);

    // 严格守卫（显式 sealTolerance 为空 = 0）：目标格被拒绝。
    const strict = placeStructures(
      anchor, field, noWalls, 2, new Set(preOccupied), new Map(),
      { ...DEFAULT_PLACER_CONFIG, sealTolerance: {} },
    );
    expect(strict.some(p => p.pos.x === target.x && p.pos.y === target.y)).toBe(false);

    // 默认配置（extension tolerance=1）：目标格放行。
    const tolerant = placeStructures(
      anchor, field, noWalls, 2, new Set(preOccupied), new Map(), DEFAULT_PLACER_CONFIG,
    );
    const targetPlacement = tolerant.find(p => p.pos.x === target.x && p.pos.y === target.y);
    expect(targetPlacement).toBeDefined();
    expect(targetPlacement!.structureType).toBe(STRUCTURE_EXTENSION);
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

// P2-N：增量外扩与全量重算的等价性验证 — 红线：placeStructures 输出不得因增量改变。
describe("constraint-placer — P2-N 增量与全量等价", () => {
  it("无墙地形：增量 r=8 == 全量 r=8", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const config = { ...DEFAULT_PLACER_CONFIG, maxRadius: 8 };
    const eps = [{ x: 10, y: 10 }, { x: 40, y: 40 }];

    const full = buildCandidateGrid(anchor, field, noWalls, config, eps);
    const prev = buildCandidateGrid(anchor, field, noWalls, { ...config, maxRadius: 7 }, eps);
    const incr = buildCandidateGrid(anchor, field, noWalls, config, eps, prev, 7);

    expect(incr.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(incr[i]!.x).toBe(full[i]!.x);
      expect(incr[i]!.y).toBe(full[i]!.y);
      expect(incr[i]!.score).toBe(full[i]!.score);
    }
  });

  it("墙地形：增量 r=10 == 全量 r=10", () => {
    const walls = centerBlock(25, 25, 3);
    const field = computeDistanceField(walls);
    const anchor = { x: 25, y: 25 };
    const config = { ...DEFAULT_PLACER_CONFIG, maxRadius: 10 };

    const full = buildCandidateGrid(anchor, field, walls, config);
    const prev = buildCandidateGrid(anchor, field, walls, { ...config, maxRadius: 9 });
    const incr = buildCandidateGrid(anchor, field, walls, config, [], prev, 9);

    expect(incr.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(incr[i]!.x).toBe(full[i]!.x);
      expect(incr[i]!.y).toBe(full[i]!.y);
      expect(incr[i]!.score).toBe(full[i]!.score);
    }
  });

  it("不传 prev 时走全量路径（向后兼容）", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const config = { ...DEFAULT_PLACER_CONFIG, maxRadius: 7 };

    const a = buildCandidateGrid(anchor, field, noWalls, config);
    const b = buildCandidateGrid(anchor, field, noWalls, config);
    expect(a).toEqual(b);
  });

  it("maxRadius != prevRadius+1 时走全量路径（增量条件不满足）", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const config = { ...DEFAULT_PLACER_CONFIG, maxRadius: 8 };

    const full = buildCandidateGrid(anchor, field, noWalls, config);
    // prevRadius=5 但 maxRadius=8（不是 5+1=6）→ 走全量。
    const fallback = buildCandidateGrid(anchor, field, noWalls, config, [], [], 5);
    expect(fallback.length).toBe(full.length);
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

describe("constraint-placer — 自适应搜索半径（受限地形后期放置）", () => {
  // 病灶回归：多墙地形 + RCL7-8 高密度下，默认 maxRadius=7 的固定候选池被
  // wouldSealLocal 密封守卫收紧后耗尽 → 旧实现静默少放（关键建筑缺失）。
  // 修复：候选池不足时自动外扩搜索半径（上限 15）。

  it("环形墙地形 RCL8：自适应扩搜放满全套结构（旧实现会少放）", () => {
    // 墙环 8<=r<=10：内部 r<8 开阔（约 128 偶校验格），外部 r>10 开阔。
    // 默认半径 7 的候选池被墙环切割 + 密封守卫收紧后不足以容纳 RCL8 的
    // ~79 个结构；扩搜到半径 >10 后可用外环开放区，放满全套。
    const ring = (x: number, y: number): boolean => {
      const r = Math.sqrt((x - 25) ** 2 + (y - 25) ** 2);
      return r >= 8 && r <= 10;
    };
    const field = computeDistanceField(ring);
    const result = placeStructures({ x: 25, y: 25 }, field, ring, 8, new Set(), new Map());

    const count = (type: string) => result.filter(p => p.structureType === type).length;
    // 关键建筑全到位（旧实现这些会缺）。
    expect(count(STRUCTURE_EXTENSION)).toBe(60);
    expect(count(STRUCTURE_TOWER)).toBe(6);
    expect(count(STRUCTURE_SPAWN)).toBe(2);
    expect(count(STRUCTURE_LAB)).toBe(10);
    expect(count(STRUCTURE_TERMINAL)).toBe(1);
    expect(count(STRUCTURE_FACTORY)).toBe(1);

    // 核心不变量在扩搜后仍成立：偶校验 + 无重叠。
    const positions = new Set<number>();
    for (const p of result) {
      const dx = p.pos.x - 25;
      const dy = p.pos.y - 25;
      expect(((dx + dy) % 2 + 2) % 2).toBe(0);
      const packed = packPos(p.pos.x, p.pos.y);
      expect(positions.has(packed)).toBe(false);
      positions.add(packed);
    }
  });

  it("开阔地形 RCL8：不触发扩搜，行为与默认半径一致（无回归）", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    // 开阔地形半径 7 即满足，扩搜不触发 → 全部结构仍落在默认 [2,47] 范围。
    for (const p of result) {
      expect(p.pos.x).toBeGreaterThanOrEqual(2);
      expect(p.pos.x).toBeLessThanOrEqual(47);
      expect(p.pos.y).toBeGreaterThanOrEqual(2);
      expect(p.pos.y).toBeLessThanOrEqual(47);
    }
    expect(result.filter(p => p.structureType === STRUCTURE_EXTENSION).length).toBe(60);
  });

  it("扩搜条件：r7 池全被占但池大小 >= 需求 → 仍外扩找到开阔区（W7N3 病灶回归）", () => {
    // W7N3 实证病灶：破碎房 r7 候选池 53 格 >= 需求 31，但格全部被已有
    // 结构/密封守卫排除，开阔区在 r7 之外 → 旧实现（只看池大小）永不扩搜，
    // 每规划周期 0 放置，19 ext/6 lab/3 tower 缺口永远闭合不了。
    // 回归：预占全部 r7 偶数格（池大小 113 >= 需求 5），新实现必须外扩
    // 到 r7 之外放满 5 个 extension。
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const preOccupied = new Set<number>();
    for (let dx = -7; dx <= 7; dx++) {
      for (let dy = -7; dy <= 7; dy++) {
        if (((dx + dy) % 2 + 2) % 2 === 0) {
          preOccupied.add(packPos(25 + dx, 25 + dy));
        }
      }
    }
    const result = placeStructures(anchor, field, noWalls, 2, preOccupied, new Map());
    const extensions = result.filter(p => p.structureType === STRUCTURE_EXTENSION);
    expect(extensions.length).toBe(5);
    for (const p of extensions) {
      // 外扩后的放置必须落在 r7 之外（r7 内已全被占）。
      expect(Math.abs(p.pos.x - 25) > 7 || Math.abs(p.pos.y - 25) > 7).toBe(true);
    }
  });
});
