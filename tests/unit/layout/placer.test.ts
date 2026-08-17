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

  it("RCL8：完整结构集（60 ext + 6 tower + 3 spawn + 1 storage + 0 link + 1 terminal + 1 factory + 10 lab + 1 observer + 1 powerSpawn + 1 nuker）", () => {
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
    expect(count(STRUCTURE_NUKER)).toBe(1);
    expect(count(STRUCTURE_LAB)).toBe(10);
    expect(count(STRUCTURE_OBSERVER)).toBe(1); // 旧手写 RCL_BATCHES 漏掉的类型
    expect(count(STRUCTURE_POWER_SPAWN)).toBe(1);
    expect(count(STRUCTURE_NUKER)).toBe(1);
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

  it("tower 覆盖加权：RCL5+ 批次塔优先落在 controller 侧，RCL8 强制 anchor 硬约束", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 45 };
    const result = placeStructures(
      anchor, field, noWalls, 8, new Set(), new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", controller,
    );
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.length).toBe(6);
    const nearController = towers.filter(
      t => Math.abs(t.pos.x - controller.x) + Math.abs(t.pos.y - controller.y) <= 15,
    );
    // 累计 3 塔 controller 侧（RCL5/7 各 1 + RCL8 批次 1），3 塔 anchor 侧
    // （RCL3 通用池 + RCL8 批次 2 硬约束）。
    expect(nearController.length).toBeGreaterThanOrEqual(3);
    // RCL8 硬约束：至少 2 塔 anchor Chebyshev ≤ 5。
    const nearAnchor = towers.filter(
      t => Math.max(Math.abs(t.pos.x - anchor.x), Math.abs(t.pos.y - anchor.y)) <= 5,
    );
    expect(nearAnchor.length).toBeGreaterThanOrEqual(2);
    // 分桶后 tower 平均距 controller 应小于 extension（对照组）。
    const towerDist = towers.reduce(
      (a, t) => a + Math.abs(t.pos.x - controller.x) + Math.abs(t.pos.y - controller.y), 0,
    ) / towers.length;
    const exts = result.filter(p => p.structureType === STRUCTURE_EXTENSION);
    const extDist = exts.reduce(
      (a, t) => a + Math.abs(t.pos.x - controller.x) + Math.abs(t.pos.y - controller.y), 0,
    ) / exts.length;
    expect(towerDist).toBeLessThan(extDist);
  });

  it("批次份额：RCL8 各批次按自身 priority/phase 放置（重构回归）", () => {
    // 病灶：批次 need 误用「类型总缺口 - 已放」→ 每类型只有第一个批次
    // 在放置，后续批次 priority/phase 全部丢失（tower 全变 rcl3 相位、
    // extension 全变 priority 1）。
    const field = computeDistanceField(noWalls);
    const result = placeStructures({ x: 25, y: 25 }, field, noWalls, 8, new Set(), new Map());

    const exts = result.filter(p => p.structureType === STRUCTURE_EXTENSION);
    expect(exts.length).toBe(60);
    expect(exts.filter(e => e.priority === 1).length).toBe(20); // rcl2-4 批次
    expect(exts.filter(e => e.priority === 2).length).toBe(40); // rcl5-8 批次

    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.filter(t => t.phase === "rcl3").length).toBe(1);
    expect(towers.filter(t => t.phase === "late").length).toBe(1);
    expect(towers.filter(t => t.phase === "rcl7").length).toBe(1);
    expect(towers.filter(t => t.phase === "rcl8").length).toBe(3);
  });

  it("lab 降级：既有集群 2 格内全被占时，按 ≤3 宽松续接补放（W7N3 lab 断层回归）", () => {
    // 既有 lab 在 (25,25)；预占其 Chebyshev<=2 的全部偶数格 → 严格续接
    // （level 0）无位 → 降级到 ≤3 续接（level 1）仍可放。
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const preOccupied = new Set<number>();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (((dx + dy) % 2 + 2) % 2 === 0) preOccupied.add(packPos(25 + dx, 25 + dy));
      }
    }
    // 已建 1 lab（anchored at 25,25），RCL7 需补 5 个（累计 6）。
    const committed = new Map([[STRUCTURE_LAB, 1]]);
    const result = placeStructures(
      anchor, field, noWalls, 7, preOccupied, committed,
      DEFAULT_PLACER_CONFIG, [], [{ x: 25, y: 25 }],
    );
    const newLabs = result.filter(p => p.structureType === STRUCTURE_LAB);
    // 降级路径必须补出 lab（旧实现：0）。
    expect(newLabs.length).toBeGreaterThan(0);
    // 严格续接（≤2）已不可能 → 所有新 lab 距既有 lab 至少 3（level 1 放行）。
    for (const lab of newLabs) {
      expect(Math.max(Math.abs(lab.pos.x - 25), Math.abs(lab.pos.y - 25))).toBeGreaterThan(2);
    }
  });

  it("lab 首批锚定 terminal：无既有 lab 时，RCL6 第一批 lab 落在 terminal 邻域（W8N3 lab 距离病灶回归）", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 10, y: 10 }; // anchor 远离 terminal — 通用评分会倾向 anchor 侧
    const terminal = { x: 17, y: 10 }; // r7 池内边缘：邻域有候选，但通用评分低于 anchor 侧
    const result = placeStructures(
      anchor, field, noWalls, 6, new Set(), new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", undefined, terminal,
    );
    const labs = result.filter(p => p.structureType === STRUCTURE_LAB);
    expect(labs.length).toBe(3); // RCL6 首批 3 lab
    // 首个 lab 必须落在 terminal 3 格内（锚定生效）。
    const first = labs[0]!;
    expect(
      Math.abs(first.pos.x - terminal.x) + Math.abs(first.pos.y - terminal.y),
    ).toBeLessThanOrEqual(3);
    // 集群均值应显著优于对照组（锚定后整体向 terminal 收拢）。
    const meanToTerminal = (ls: typeof labs) =>
      ls.reduce((a, l) => a + Math.abs(l.pos.x - terminal.x) + Math.abs(l.pos.y - terminal.y), 0) / ls.length;
    // 对照组：不传 terminalPos 时 lab 靠近 anchor（旧行为，验证规则开关）。
    const baseline = placeStructures(
      anchor, field, noWalls, 6, new Set(), new Map(),
    );
    const baselineLabs = baseline.filter(p => p.structureType === STRUCTURE_LAB);
    expect(meanToTerminal(labs)).toBeLessThan(meanToTerminal(baselineLabs));
  });
});

// P1-2：tower RCL5+ controller 分桶 + anchor 硬约束（设计文档 §3.7）
describe("constraint-placer — P1-2 tower 分桶 + anchor 硬约束", () => {
  /** 计算 Chebyshev 距离。 */
  const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  /** 计算 Manhattan 距离。 */
  const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  it("RCL5：late 批次塔落在 controller 侧（≤15），rcl3 塔守 anchor", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 45 };
    const result = placeStructures(
      anchor, field, noWalls, 5, new Set(), new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", controller,
    );
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.length).toBe(2); // RCL3 +1 + RCL5 +1
    // late 批次塔应在 controller 侧（≤15）
    const lateTower = towers.find(t => t.phase === "late");
    expect(lateTower).toBeDefined();
    expect(manhattan(lateTower!.pos, controller)).toBeLessThanOrEqual(15);
    // rcl3 批次塔应守 anchor（通用池，openness 评分倾向 anchor 侧）
    const rcl3Tower = towers.find(t => t.phase === "rcl3");
    expect(rcl3Tower).toBeDefined();
    expect(chebyshev(rcl3Tower!.pos, anchor)).toBeLessThanOrEqual(5);
  });

  it("RCL7：rcl7 批次塔落在 controller 侧（≤15）", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 45 };
    const result = placeStructures(
      anchor, field, noWalls, 7, new Set(), new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", controller,
    );
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.length).toBe(3); // RCL3 +1 + RCL5 +1 + RCL7 +1
    const rcl7Tower = towers.find(t => t.phase === "rcl7");
    expect(rcl7Tower).toBeDefined();
    expect(manhattan(rcl7Tower!.pos, controller)).toBeLessThanOrEqual(15);
  });

  it("RCL8 硬约束：至少 2 塔 anchor Chebyshev ≤ 5", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 45 };
    const result = placeStructures(
      anchor, field, noWalls, 8, new Set(), new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", controller,
    );
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.length).toBe(6);
    // RCL8 硬约束：至少 2 塔 anchor ≤ 5
    const nearAnchor = towers.filter(t => chebyshev(t.pos, anchor) <= 5);
    expect(nearAnchor.length).toBeGreaterThanOrEqual(2);
  });

  it("RCL8 累计分布：3 塔 controller 侧 + 3 塔 anchor 侧", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 45 };
    const result = placeStructures(
      anchor, field, noWalls, 8, new Set(), new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", controller,
    );
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.length).toBe(6);
    // 累计 3 塔 controller 侧（RCL5 + RCL7 + RCL8 批次 1）
    const nearController = towers.filter(t => manhattan(t.pos, controller) <= 15);
    expect(nearController.length).toBe(3);
    // 累计 3 塔 anchor 侧（RCL3 通用池 + RCL8 批次 2 硬约束）
    const nearAnchor = towers.filter(t => chebyshev(t.pos, anchor) <= 5);
    expect(nearAnchor.length).toBe(3);
  });

  it("RCL8 批次份额：1 controller + 2 anchor（phase=rcl8）", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 45 };
    const result = placeStructures(
      anchor, field, noWalls, 8, new Set(), new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", controller,
    );
    const rcl8Towers = result.filter(
      p => p.structureType === STRUCTURE_TOWER && p.phase === "rcl8",
    );
    expect(rcl8Towers.length).toBe(3);
    // RCL8 批次 3 塔中 1 塔 controller 侧
    const rcl8Controller = rcl8Towers.filter(t => manhattan(t.pos, controller) <= 15);
    expect(rcl8Controller.length).toBe(1);
    // RCL8 批次 3 塔中 2 塔 anchor 侧（≤5）
    const rcl8Anchor = rcl8Towers.filter(t => chebyshev(t.pos, anchor) <= 5);
    expect(rcl8Anchor.length).toBe(2);
  });

  it("anchor 硬约束降级：≤5 候选不足时放宽到 ≤7", () => {
    // 预占 anchor 周围全部 ≤5 的偶校验格 → RCL8 批次 2 anchor 塔必须降级到 ≤7
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 45 };
    const preOccupied = new Set<number>();
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -5; dy <= 5; dy++) {
        if (((dx + dy) % 2 + 2) % 2 === 0) {
          preOccupied.add(packPos(25 + dx, 25 + dy));
        }
      }
    }
    const result = placeStructures(
      anchor, field, noWalls, 8, preOccupied, new Map(),
      DEFAULT_PLACER_CONFIG, [], [], "W1N1", controller,
    );
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.length).toBe(6);
    // ≤5 全被预占 → 无塔落在 ≤5，但 ≤7 内应有 ≥2 塔（降级放行）
    const near5 = towers.filter(t => chebyshev(t.pos, anchor) <= 5);
    expect(near5.length).toBe(0);
    const near7 = towers.filter(t => chebyshev(t.pos, anchor) <= 7);
    expect(near7.length).toBeGreaterThanOrEqual(2);
  });

  it("无 controllerPos 时退化为通用池（向后兼容）", () => {
    const field = computeDistanceField(noWalls);
    const anchor = { x: 25, y: 25 };
    // 不传 controllerPos（第 11 个参数）
    const result = placeStructures(
      anchor, field, noWalls, 8, new Set(), new Map(),
    );
    const towers = result.filter(p => p.structureType === STRUCTURE_TOWER);
    expect(towers.length).toBe(6);
    // 无分桶 → 全部走通用池，openness 评分倾向 anchor 侧
    // 不强制 controller 侧分布（与传 controllerPos 的对照组区分）
    const controller = { x: 25, y: 45 };
    const nearController = towers.filter(t => manhattan(t.pos, controller) <= 15);
    // 通用池下 controller 侧塔数 < 3（对照组传 controllerPos 时 = 3）
    expect(nearController.length).toBeLessThan(3);
  });
});
