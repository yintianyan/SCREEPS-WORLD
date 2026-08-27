/** constraint-placer 代际稳定性测试。 */
import { describe, expect, it } from "vitest";
import { computeDistanceField } from "../../../src/domain/layout/terrain-analysis";
import { placeStructures } from "../../../src/domain/layout/constraint-placer";
import { computeCommittedCounts } from "../../../src/domain/layout/validation";
import { packPos } from "../../../src/domain/layout/types";
import { mockSnapshot } from "../../role-helpers";

const noWalls = (_x: number, _y: number): boolean => false;
const ANCHOR = { x: 25, y: 25 };

/** 把首代 placements 的前 K 个视为「已建成」，构造二代推导的输入。 */
function simulateBuilt(placements: readonly { pos: { x: number; y: number }; structureType: string }[], k: number) {
  const preOccupied = new Set<number>();
  const committed = new Map<string, number>();
  for (const p of placements.slice(0, k)) {
    preOccupied.add(packPos(p.pos.x, p.pos.y));
    committed.set(p.structureType, (committed.get(p.structureType) ?? 0) + 1);
  }
  return { preOccupied, committed };
}

describe("constraint-placer — 代际稳定性（TD-012）", () => {
  it("已建 = 首代前缀时，重推导输出与首代剩余部分完全一致（key/pos 全等）", () => {
    const field = computeDistanceField(noWalls);
    const gen1 = placeStructures(ANCHOR, field, noWalls, 4, new Set(), new Map());

    // 模拟建成前 7 个（覆盖 storage/tower/部分 extension，按放置序）。
    const K = 7;
    const { preOccupied, committed } = simulateBuilt(gen1, K);
    const gen2 = placeStructures(ANCHOR, field, noWalls, 4, preOccupied, committed);

    // 核心断言：二代输出 = 首代去掉已建前缀 — 零漂移。
    expect(gen2.map(p => ({ key: p.key, pos: p.pos }))).toEqual(
      gen1.slice(K).map(p => ({ key: p.key, pos: p.pos })),
    );
  });

  it("全部建成后重推导输出为空（不再产生幽灵任务）", () => {
    const field = computeDistanceField(noWalls);
    const gen1 = placeStructures(ANCHOR, field, noWalls, 4, new Set(), new Map());
    const { preOccupied, committed } = simulateBuilt(gen1, gen1.length);

    const gen2 = placeStructures(ANCHOR, field, noWalls, 4, preOccupied, committed);
    expect(gen2).toHaveLength(0);
  });

  it("key 坐标绑定：constraint.<type>.<x>.<y> 与 pos 一致", () => {
    const field = computeDistanceField(noWalls);
    const result = placeStructures(ANCHOR, field, noWalls, 8, new Set(), new Map());
    for (const p of result) {
      expect(p.key).toBe(`constraint.${p.structureType}.${p.pos.x}.${p.pos.y}`);
    }
  });

  it("spawn 锚点豁免：锚点 spawn 不抵扣批次 spawn（RCL8 满建时放 0，仅锚点时放 2）", () => {
    const field = computeDistanceField(noWalls);
    const countSpawns = (committed: Map<string, number>) =>
      placeStructures(ANCHOR, field, noWalls, 8, new Set(), committed)
        .filter(p => p.structureType === STRUCTURE_SPAWN).length;

    // 只有锚点 spawn（committed=1）→ RCL7/8 批次的 2 个仍需放置。
    expect(countSpawns(new Map([[STRUCTURE_SPAWN, 1]]))).toBe(2);
    // 3 个 spawn 全建成 → 放 0。
    expect(countSpawns(new Map([[STRUCTURE_SPAWN, 3]]))).toBe(0);
    // spawn 全毁（committed=0）→ 批次 2 个照常放（锚点位由紧急重建路径单独补）。
    expect(countSpawns(new Map())).toBe(2);
  });

  it("lab 集群续接：新增 lab 落在既有集群 range<=2 内", () => {
    const field = computeDistanceField(noWalls);
    // 首代 RCL6 放出 3 lab trio 作为「已建集群」。
    const gen1 = placeStructures(ANCHOR, field, noWalls, 6, new Set(), new Map());
    const builtLabs = gen1.filter(p => p.structureType === STRUCTURE_LAB).map(p => p.pos);
    expect(builtLabs).toHaveLength(3);

    const preOccupied = new Set<number>(builtLabs.map(p => packPos(p.x, p.y)));
    const committed = new Map<string, number>([[STRUCTURE_LAB, 3]]);
    // RCL7 批次 +3 lab（累计 6，抵扣 3 → 放 3），必须续接既有 trio。
    const gen2 = placeStructures(ANCHOR, field, noWalls, 7, preOccupied, committed, undefined, [], builtLabs);
    const newLabs = gen2.filter(p => p.structureType === STRUCTURE_LAB);
    expect(newLabs).toHaveLength(3);
    // 链式续接契约（与 placeLabCluster 一致）：每个新 lab 与「既有集群 ∪ 更早
    // 放置的新 lab」中至少一个 Chebyshev <= 2 — 集群连通，不会另起孤立 trio。
    const cluster = [...builtLabs];
    for (const lab of newLabs) {
      const nearCluster = cluster.some(
        b => Math.max(Math.abs(b.x - lab.pos.x), Math.abs(b.y - lab.pos.y)) <= 2,
      );
      expect(nearCluster).toBe(true);
      cluster.push(lab.pos);
    }
  });
});

describe("validation — computeCommittedCounts（承诺口径）", () => {
  const st = (type: string, x: number, y: number): any => ({
    structureType: type,
    pos: { x, y },
  });
  const task = (type: string, state: string): any => ({
    key: `constraint.${type}.1.1`,
    pos: { x: 1, y: 1, roomName: "W7N4" },
    structureType: type,
    priority: 2,
    state,
    attempts: 0,
    retryAt: 0,
  });

  it("已建结构 + 我方 site + queued/blocked 任务全部计入", () => {
    const snapshot = mockSnapshot({
      spawns: [st("spawn", 25, 25)] as any,
      extensions: [st("extension", 24, 24), st("extension", 26, 26)] as any,
      towers: [st("tower", 23, 25)] as any,
      labs: [st("lab", 30, 30)] as any,
      storage: st("storage", 27, 25),
      terminal: st("terminal", 28, 26),
      factory: st("factory", 29, 27),
      observer: st("observer", 31, 31),
      powerSpawn: st("powerSpawn", 32, 32),
      nuker: st("nuker", 33, 33),
      myConstructionSites: [st("extension", 22, 24)] as any,
    });
    const queue = [task("extension", "queued"), task("tower", "blocked")];

    const counts = computeCommittedCounts(snapshot, queue);
    expect(counts.get("spawn")).toBe(1);
    expect(counts.get("extension")).toBe(4); // 2 built + 1 site + 1 queued
    expect(counts.get("tower")).toBe(2); // 1 built + 1 blocked
    expect(counts.get("lab")).toBe(1);
    expect(counts.get("storage")).toBe(1);
    expect(counts.get("terminal")).toBe(1);
    expect(counts.get("factory")).toBe(1);
    // 2026-08-01 类型覆盖补齐：observer/powerSpawn 不再从承诺口径漏计
    // （旧 RCL_BATCHES 遗漏同源问题 — 漏计会生成重复放置任务）。
    expect(counts.get("observer")).toBe(1);
    expect(counts.get("powerSpawn")).toBe(1);
    expect(counts.get("nuker")).toBe(1);
  });

  it("site/done 状态的队列任务不计入（实体 site/结构已覆盖，防双计）", () => {
    const snapshot = mockSnapshot({
      myConstructionSites: [st("extension", 22, 24)] as any,
    });
    const queue = [task("extension", "site"), task("extension", "done")];

    const counts = computeCommittedCounts(snapshot, queue);
    // 仅 site 实体计 1；site 状态任务与 done 任务均不重复计。
    expect(counts.get("extension")).toBe(1);
  });
});
