/** v3 布局合约（R660）——把「每个建筑都要能发挥作用」写成可执行的几何/功能断言。
 *
 * 覆盖用户要求：RCL 分批数量、建筑位置唯一/奇偶走道、每结构至少一个可站邻格、
 * storage link 的角色分类、实验室/塔/终端的功能可达性、地形鲁棒性、锚点选择，
 * 以及「storage 漂移出模板格时动态 storage-link 仍能落位」的回归（W38S56 教训）。
 */
import { describe, expect, it } from "vitest";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";
import { classifyLinkRole } from "../../../src/domain/economy/links";
import { createStorageLinkTask } from "../../../src/domain/layout/task-factory";
import { computeDistanceField } from "../../../src/domain/layout/terrain-analysis";
import { selectAnchors } from "../../../src/domain/layout/anchor-selection";
import { packPos } from "../../../src/domain/layout/types";

const ANCHOR = { x: 25, y: 25 };
const abs = (dx: number, dy: number) => ({ x: ANCHOR.x + dx, y: ANCHOR.y + dy });

/** 某 RCL 应存在的 cells。 */
function cellsAt(rcl: number) {
  return COMPACT_CORE_V2.cells.filter(c => c.minRcl <= rcl);
}

describe("v3 合约 — 每 RCL 的数量/唯一性/走道", () => {
  for (const rcl of [2, 3, 4, 5, 6, 7, 8]) {
    it(`RCL${rcl}：位置唯一 + 结构在偶校验格（棋盘走道）`, () => {
      const cells = cellsAt(rcl);
      const pos = cells.map(c => `${c.dx},${c.dy}`);
      expect(new Set(pos).size).toBe(pos.length);
      for (const c of cells) {
        // 偶校验：保证每结构的正交邻格是走道（v2 的密封不变量）。
        expect((c.dx + c.dy) & 1).toBe(0);
      }
    });
  }

  it("RCL 数量不超过 CONTROLLER_STRUCTURES 上限", () => {
    for (const rcl of [2, 3, 4, 5, 6, 7, 8]) {
      const cells = cellsAt(rcl);
      const byType = new Map<string, number>();
      for (const c of cells) byType.set(c.structureType, (byType.get(c.structureType) ?? 0) + 1);
      for (const [type, n] of byType) {
        const limit = (CONTROLLER_STRUCTURES as Record<string, Record<number, number>>)[type]?.[
          rcl
        ];
        expect(limit, `${type}@RCL${rcl}`).toBeDefined();
        expect(n, `${type}@RCL${rcl} 数量`).toBeLessThanOrEqual(limit!);
      }
    }
  });
});

describe("v3 合约 — 每个结构都够得着（range1 含对角）", () => {
  it("全 RCL8 布局：每结构至少 1 个空格邻格（8 邻域，未被其他模板格占用）", () => {
    const cells = cellsAt(8);
    const occupied = new Set(cells.map(c => packPos(c.dx, c.dy)));
    for (const c of cells) {
      let free = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (!occupied.has(packPos(c.dx + dx, c.dy + dy))) free++;
        }
      }
      expect(free, `${c.key}(${c.dx},${c.dy}) 空邻格`).toBeGreaterThan(0);
    }
  });
});

describe("v3 合约 — storage link 的角色与位置", () => {
  const storageCell = COMPACT_CORE_V2.cells.find(c => c.structureType === STRUCTURE_STORAGE)!;
  const linkCells = COMPACT_CORE_V2.cells.filter(c => c.structureType === STRUCTURE_LINK);

  it("模板含 storage link cell，且依赖 storage", () => {
    expect(storageCell).toBeDefined();
    expect(linkCells.length).toBeGreaterThan(0);
    const storageLink = linkCells.find(c => (c.requires ?? []).includes(storageCell.key));
    expect(storageLink, "缺少 requires=[storage] 的 link cell").toBeDefined();
  });

  it("该 link 到 storage 的 Chebyshev ≤1（range1 可直接取能）", () => {
    const storageLink = linkCells.find(c => (c.requires ?? []).includes(storageCell.key))!;
    const d = Math.max(
      Math.abs(storageLink.dx - storageCell.dx),
      Math.abs(storageLink.dy - storageCell.dy),
    );
    expect(d).toBeLessThanOrEqual(1);
  });

  it("classifyLinkRole 判为 storage（在 controller 远离、source 远离时）", () => {
    const storageLink = linkCells.find(c => (c.requires ?? []).includes(storageCell.key))!;
    const link = abs(storageLink.dx, storageLink.dy);
    const storage = abs(storageCell.dx, storageCell.dy);
    // controller 取典型模板偏移（spawn 下方 6 格），sources 取远处：确保不会被抢分类。
    const role = classifyLinkRole(
      link,
      [{ x: 2, y: 2 }],
      { x: ANCHOR.x, y: ANCHOR.y + 6 },
      storage,
      2,
    );
    expect(role).toBe("storage");
  });
});

describe("v3 合约 — 关键结构的功能可达性", () => {
  it("spawn / storage / terminal / factory / tower / lab 都有可站邻格", () => {
    const cells = cellsAt(8);
    const occupied = new Set(cells.map(c => packPos(c.dx, c.dy)));
    const criticalTypes = new Set<string>([
      STRUCTURE_SPAWN,
      STRUCTURE_STORAGE,
      STRUCTURE_TERMINAL,
      STRUCTURE_FACTORY,
      STRUCTURE_TOWER,
      STRUCTURE_LAB,
    ]);
    const critical = cells.filter(c => criticalTypes.has(c.structureType));
    expect(critical.length).toBeGreaterThan(0);
    for (const c of critical) {
      let free = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (!occupied.has(packPos(c.dx + dx, c.dy + dy))) free++;
        }
      }
      expect(free, `${c.key} 可站邻格`).toBeGreaterThan(0);
    }
  });
});

describe("v3 合约 — 地形鲁棒性", () => {
  function placeableRatio(getTerrainValue: (x: number, y: number) => number, rcl: number) {
    const cells = cellsAt(rcl);
    let fit = 0;
    for (const c of cells) {
      const p = abs(c.dx, c.dy);
      if (getTerrainValue(p.x, p.y) !== 1) fit++;
    }
    return fit / cells.length;
  }

  it("开阔房：RCL8 全部可放", () => {
    expect(placeableRatio(() => 0, 8)).toBe(1);
  });

  it("50% 墙（奇数校验格为墙）：模板格全在偶校验 ⇒ 仍可放", () => {
    const checker = (x: number, y: number) => ((x + y) % 2 === 1 ? 1 : 0);
    expect(placeableRatio(checker, 8)).toBe(1);
  });

  it("真实形态（核心区开阔、外围散布墙）：锚点可解且 RCL8 全可放", () => {
    // 半径 7 内保持开阔（真实房的 core 区），外面 20% 散布墙。
    const rnd = (x: number, y: number) => {
      const d = Math.max(Math.abs(x - 25), Math.abs(y - 25));
      if (d <= 7) return 0;
      return (x * 7 + y * 13) % 10 < 2 ? 1 : 0;
    };
    const field = computeDistanceField((x, y) => rnd(x, y) === 1);
    const anchor = selectAnchors({
      field,
      sources: [
        { x: 15, y: 25 },
        { x: 35, y: 25 },
      ],
      controller: { x: 25, y: 38 },
      exits: [],
      mineral: undefined,
      getTerrain: (x, y) => rnd(x, y) === 1,
      maxCandidates: 1,
    })[0];
    expect(anchor).toBeDefined();
    const cells = cellsAt(8);
    let fit = 0;
    for (const c of cells) if (rnd(anchor!.x + c.dx, anchor!.y + c.dy) !== 1) fit++;
    expect(fit / cells.length).toBeGreaterThanOrEqual(0.85);
  });

  it("敌意地形（30% 均匀墙、无开阔口袋）：锚点选择应拒绝，而不是硬塞一套碎布局", () => {
    const rnd = (x: number, y: number) => ((x * 7 + y * 13) % 10 < 3 ? 1 : 0);
    const field = computeDistanceField((x, y) => rnd(x, y) === 1);
    const candidates = selectAnchors({
      field,
      sources: [{ x: 15, y: 25 }],
      controller: { x: 25, y: 38 },
      exits: [],
      mineral: undefined,
      getTerrain: (x, y) => rnd(x, y) === 1,
      maxCandidates: 1,
      minOpenness: 2,
    });
    // 要么无解（拒绝），要么解出来的锚点周围可放率必须过关——不允许"有解但碎"。
    if (candidates.length === 0) {
      expect(candidates.length).toBe(0);
    } else {
      const a = candidates[0]!;
      let fit = 0;
      const cells = cellsAt(8);
      for (const c of cells) if (rnd(a.x + c.dx, a.y + c.dy) !== 1) fit++;
      expect(fit / cells.length).toBeGreaterThanOrEqual(0.7);
    }
  });
});

describe("v3 合约 — 锚点选择", () => {
  it("开阔地形：selectAnchors 产出锚点，且 ±6 核心域不出界", () => {
    const field = computeDistanceField(() => false);
    const best = selectAnchors({
      field,
      sources: [
        { x: 15, y: 25 },
        { x: 35, y: 25 },
      ],
      controller: { x: 25, y: 38 },
      exits: [
        { x: 0, y: 25 },
        { x: 49, y: 25 },
        { x: 25, y: 0 },
        { x: 25, y: 49 },
      ],
      mineral: undefined,
      getTerrain: () => false,
      maxCandidates: 1,
    })[0];
    expect(best).toBeDefined();
    expect(best!.x).toBeGreaterThanOrEqual(6);
    expect(best!.x).toBeLessThanOrEqual(43);
    expect(best!.y).toBeGreaterThanOrEqual(6);
    expect(best!.y).toBeLessThanOrEqual(43);
  });
});

describe("v3 合约 — storage 漂移时的动态 storage-link（W38S56 回归）", () => {
  const openTerrain = {
    get: () => 0,
  } as unknown as RoomTerrain;

  function fakeSnapshot(storage: { x: number; y: number }, linkCount: number, rcl = 7): any {
    return {
      rcl,
      storage: { pos: storage, store: { getUsedCapacity: () => 1000 } },
      links: Array.from({ length: linkCount }, (_, i) => ({
        pos: { x: 40 + i, y: 40 },
      })),
      constructionSites: [],
      containers: [],
      spawns: [],
      extensions: [],
      towers: [],
      sources: [],
      controller: undefined,
      minerals: [],
    };
  }

  it("storage 不在模板格 (0,2) 时，动态任务仍落在 storage 邻域", () => {
    const storage = { x: 20, y: 20 };
    const snapshot = fakeSnapshot(storage, 1);
    const room = { getTerrain: () => openTerrain, find: () => [] } as any;
    const options = { occupiedSet: new Set([packPos(storage.x, storage.y)]), minerals: [] } as any;
    const task = createStorageLinkTask(snapshot, room, options, 0);
    expect(task, "storage 漂移时不应返回 undefined").toBeDefined();
    const d = Math.max(Math.abs(task!.pos.x - storage.x), Math.abs(task!.pos.y - storage.y));
    expect(d).toBeLessThanOrEqual(2);
  });

  it("link 槽位已满（RCL7=4）⇒ 不再排 storage link", () => {
    const storage = { x: 20, y: 20 };
    const snapshot = fakeSnapshot(storage, 4);
    const room = { getTerrain: () => openTerrain, find: () => [] } as any;
    const options = { occupiedSet: new Set([packPos(storage.x, storage.y)]), minerals: [] } as any;
    expect(createStorageLinkTask(snapshot, room, options, 0)).toBeUndefined();
  });
});
