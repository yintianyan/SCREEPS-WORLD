import { describe, it, expect } from "vitest";
import { computeMinCutDefense } from "../../../src/domain/layout/min-cut-defense";

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

  it("全开放地形单出口 maxRamparts=30：必须成功（断言 complete=true）", () => {
    // 评审修正要求：旧测试用 `if (result.complete)` 宽松断言，捕捉不到恒 fallback。
    // 修复 SUPER_SOURCE/SINK 冲突后必须强制断言 complete === true。
    const core = [{ x: 25, y: 25 }];
    const exits = [{ x: 0, y: 25 }]; // 单出口

    const result = computeMinCutDefense(noWalls, core, exits, 30);
    // 单出口方向，割集应该 <= 30，必须成功
    expect(result.complete).toBe(true);
    expect(result.cutSize).toBeLessThanOrEqual(30);
    expect(result.cutSize).toBeGreaterThanOrEqual(1);
    expect(result.rampartPositions.length).toBe(result.cutSize);
  });
});

/**
 * SUPER_SOURCE/SINK 与 (49,49) 拆点冲突的回归测试。
 *
 * 旧实现 SUPER_SOURCE=4998、SUPER_SINK=4999，而 nodeId(49,49,false)=4998、
 * nodeId(49,49,true)=4999，导致 (49,49) 非墙时拆点边变成 SUPER_SOURCE→SUPER_SINK
 * 退化直连边，maxFlow 错误或恒 complete=false。
 *
 * 这些测试在修复前会失败（complete=false 或 cutSize 异常），修复后必须通过。
 */
describe("min-cut-defense — SUPER_SOURCE/SINK 冲突回归", () => {
  it("(49,49) 非墙角落：全开地形 4 出口 maxRamparts=30 必须 complete=true", () => {
    // 全开放地形下 (49,49) 自然非墙。
    // 出口在四边中点（不含 (49,49) 本身），核心在中心。
    const core = [{ x: 25, y: 25 }];
    const exits = [
      { x: 0, y: 25 }, { x: 49, y: 25 },
      { x: 25, y: 0 }, { x: 25, y: 49 },
    ];

    const result = computeMinCutDefense(noWalls, core, exits, 30);
    expect(result.complete).toBe(true);
    expect(result.cutSize).toBeGreaterThan(0);
    expect(result.rampartPositions.length).toBe(result.cutSize);

    // rampart 不能落在核心格或出口格上
    for (const pos of result.rampartPositions) {
      const isCore = core.some(c => c.x === pos.x && c.y === pos.y);
      const isExit = exits.some(e => e.x === pos.x && e.y === pos.y);
      expect(isCore).toBe(false);
      expect(isExit).toBe(false);
    }
  });

  it("(49,49) 为出口格：不再恒 complete=false", () => {
    // 旧实现：(49,49) 为出口格时，addEdge(SUPER_SOURCE, vOut(=SUPER_SINK), INF)
    // 直接构造 SUPER_SOURCE→SUPER_SINK 的 INF 直连边 → maxFlow 爆炸 → 恒 fallback。
    // 修复后 SUPER_SINK=5001，vOut(49,49)=4999 不再与之冲突，应正常计算。
    const core = [{ x: 25, y: 25 }];
    const exits = [{ x: 49, y: 49 }]; // (49,49) 作为唯一出口

    const result = computeMinCutDefense(noWalls, core, exits, 30);
    expect(result.complete).toBe(true);
    expect(result.cutSize).toBeGreaterThanOrEqual(1);
    expect(result.cutSize).toBeLessThanOrEqual(30);
    expect(result.rampartPositions.length).toBe(result.cutSize);
  });

  it("(49,49) 非墙且非出口：割集不含 (49,49)", () => {
    // 即使 (49,49) 非墙，它也不应被选为割集格（除非必要）。
    // 这里构造一个 (49,49) 远离核心和出口的场景，验证它不被错误地包含。
    const core = [{ x: 25, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    const result = computeMinCutDefense(noWalls, core, exits, 30);
    expect(result.complete).toBe(true);
    // (49,49) 远离 (0,25)→(25,25) 的最短路径，正常割集不应包含它
    // （修复前可能因 SUPER_SOURCE/SINK 冲突而被错误选中）
    const has4949 = result.rampartPositions.some(p => p.x === 49 && p.y === 49);
    expect(has4949).toBe(false);
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

    // 预热：首次调用包含 V8 JIT 编译开销（可达 ~50ms），
    // 实际算法计算仅 ~5ms。预热后测量真实计算性能。
    computeMinCutDefense(noWalls, core, exits, 30);

    const start = performance.now();
    const result = computeMinCutDefense(noWalls, core, exits, 30);
    const elapsed = performance.now() - start;

    // 预热后在 50ms 内完成（实际 ~1-5ms，无 JIT 开销）
    expect(elapsed).toBeLessThan(50);
    // 结果有效（无论 complete 与否）
    expect(result.cutSize).toBeGreaterThanOrEqual(0);
  });
});

// ─── v3 对角线路径封锁验证 ───────────────────────────────────

/**
 * 独立验证割集是否真正阻断所有 8 邻接路径（含切角规则）。
 *
 * 从所有出口 BFS，不经过割集顶点和墙，检查是否能到达任一核心格。
 * 若不可达 → 割集有效；若可达 → 割集有漏洞（对角线未被封锁）。
 *
 * 此函数独立于 min-cut 算法实现，作为 v3 正确性的外部验证。
 */
function verifyCutBlocksAllPaths(
  getTerrain: (x: number, y: number) => boolean,
  corePositions: readonly { x: number; y: number }[],
  exitPositions: readonly { x: number; y: number }[],
  cutSet: readonly { x: number; y: number }[],
): boolean {
  const cutPacked = new Set(cutSet.map(p => p.x * 50 + p.y));
  const corePacked = new Set(corePositions.map(p => p.x * 50 + p.y));
  const visited = new Set<number>();
  const queue: { x: number; y: number }[] = [];

  // 从所有非墙、非割集出口出发
  for (const p of exitPositions) {
    if (getTerrain(p.x, p.y)) continue;
    const packed = p.x * 50 + p.y;
    if (cutPacked.has(packed)) continue;
    if (!visited.has(packed)) {
      visited.add(packed);
      queue.push(p);
    }
  }

  const orthogonal: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  const diagonals: ReadonlyArray<readonly [number, number]> = [
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    const packed = x * 50 + y;
    // 到达核心 → 割集失败
    if (corePacked.has(packed)) return false;

    // 正交 4 邻接（无切角限制）
    for (const [dx, dy] of orthogonal) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
      const np = nx * 50 + ny;
      if (visited.has(np)) continue;
      if (getTerrain(nx, ny)) continue;
      if (cutPacked.has(np)) continue;
      visited.add(np);
      queue.push({ x: nx, y: ny });
    }

    // 对角线 4 邻接（切角规则：两个角落格都非墙才连通）
    for (const [dx, dy] of diagonals) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
      const np = nx * 50 + ny;
      if (visited.has(np)) continue;
      if (getTerrain(nx, ny)) continue;
      // 切角检查：两个正交角落格都必须非墙
      if (getTerrain(x + dx, y)) continue;
      if (getTerrain(x, y + dy)) continue;
      if (cutPacked.has(np)) continue;
      visited.add(np);
      queue.push({ x: nx, y: ny });
    }
  }

  // BFS 完成未到达任何核心 → 割集有效
  return true;
}

describe("min-cut-defense — v3 对角线路径封锁", () => {
  it("开放地形单出口：v3 割集阻断所有 8 邻接路径", () => {
    const core = [{ x: 25, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    const result = computeMinCutDefense(noWalls, core, exits, 50);
    expect(result.complete).toBe(true);
    expect(verifyCutBlocksAllPaths(noWalls, core, exits, result.rampartPositions)).toBe(true);
  });

  it("开放地形 4 出口：v3 割集阻断所有方向（含对角线）", () => {
    const core = [{ x: 25, y: 25 }];
    const exits = [
      { x: 0, y: 25 }, { x: 49, y: 25 },
      { x: 25, y: 0 }, { x: 25, y: 49 },
    ];

    const result = computeMinCutDefense(noWalls, core, exits, 50);
    expect(result.complete).toBe(true);
    expect(verifyCutBlocksAllPaths(noWalls, core, exits, result.rampartPositions)).toBe(true);
  });

  it("走廊地形：v3 割集阻断含对角线的所有路径", () => {
    const terrain = corridorTerrain(25, 1); // 走廊 y=24,25,26
    const core = [{ x: 30, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    const result = computeMinCutDefense(terrain, core, exits, 50);
    expect(result.complete).toBe(true);
    expect(verifyCutBlocksAllPaths(terrain, core, exits, result.rampartPositions)).toBe(true);
  });

  it("瓶颈地形：v3 割集阻断对角线绕行", () => {
    const terrain = bottleneckTerrain(25);
    const core = [{ x: 30, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    const result = computeMinCutDefense(terrain, core, exits, 50);
    expect(result.complete).toBe(true);
    expect(verifyCutBlocksAllPaths(terrain, core, exits, result.rampartPositions)).toBe(true);
  });

  it("多核心格：v3 割集封锁所有核心的 8 邻接路径", () => {
    const core = [
      { x: 24, y: 25 }, { x: 25, y: 25 }, { x: 26, y: 25 },
      { x: 25, y: 24 }, { x: 25, y: 26 },
    ];
    const exits = [
      { x: 0, y: 25 }, { x: 49, y: 25 },
    ];

    const result = computeMinCutDefense(noWalls, core, exits, 50);
    expect(result.complete).toBe(true);
    expect(verifyCutBlocksAllPaths(noWalls, core, exits, result.rampartPositions)).toBe(true);
  });
});

// ── P2-1：blockedPositions 参数测试 ──
describe("P2-1 min-cut blockedPositions — 不可放置割集顶点排除", () => {
  it("blockedPositions 中的位置不出现在割集中", () => {
    // 走廊地形（宽 3），core 在右侧，出口在左侧
    const terrain = corridorTerrain(25, 1); // 走廊 y=24,25,26
    const core = [{ x: 40, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    // 先不加 blockedPositions，获取基准割集
    const baseline = computeMinCutDefense(terrain, core, exits, 30);
    expect(baseline.complete).toBe(true);

    // 把基准割集中的所有位置加入 blockedPositions
    const blocked = new Set<number>();
    for (const p of baseline.rampartPositions) {
      blocked.add(p.x * 50 + p.y);
    }

    // 重新计算：blockedPositions 中的位置不可切割，算法应选其他位置
    const result = computeMinCutDefense(terrain, core, exits, 30, blocked);
    if (result.complete) {
      // 割集中不应包含任何 blockedPositions
      for (const p of result.rampartPositions) {
        expect(blocked.has(p.x * 50 + p.y)).toBe(false);
      }
    }
    // 无论 complete 与否，blockedPositions 中的位置都不应出现在割集中
    for (const p of result.rampartPositions) {
      expect(blocked.has(p.x * 50 + p.y)).toBe(false);
    }
  });

  it("blockedPositions 为空时行为与不传一致", () => {
    const terrain = corridorTerrain(25, 1);
    const core = [{ x: 40, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    const withoutBlocked = computeMinCutDefense(terrain, core, exits, 30);
    const withEmptyBlocked = computeMinCutDefense(terrain, core, exits, 30, new Set());
    expect(withEmptyBlocked.complete).toBe(withoutBlocked.complete);
    expect(withEmptyBlocked.cutSize).toBe(withoutBlocked.cutSize);
  });

  it("blockedPositions 不影响出口格和核心格的不可切割性", () => {
    // 出口格和核心格本身已设为 INF（不可切割），blockedPositions 不改变此行为
    const terrain = corridorTerrain(25, 1);
    const core = [{ x: 40, y: 25 }];
    const exits = [{ x: 0, y: 25 }];

    // 把出口和核心位置加入 blockedPositions（冗余，应无副作用）
    const blocked = new Set<number>([0 * 50 + 25, 40 * 50 + 25]);
    const result = computeMinCutDefense(terrain, core, exits, 30, blocked);
    expect(result.complete).toBe(true);
    // 出口和核心位置不应出现在割集中（本来就不可切割）
    for (const p of result.rampartPositions) {
      expect(p.x * 50 + p.y).not.toBe(0 * 50 + 25);
      expect(p.x * 50 + p.y).not.toBe(40 * 50 + 25);
    }
  });
});
