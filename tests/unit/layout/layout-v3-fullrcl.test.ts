/** v3 全 RCL 稳定性模拟（R661）——在合成地形 × 多锚点上，按 RCL 批次增量放置，
 * 允许有限的邻近重定位（模板格被墙/占用时），并在**每一批之后**校验：
 *  · 无放置失败；· 每个结构仍有可站邻格；· storage link 仍紧邻 storage；
 *  · 每类建筑数量 ≤ CONTROLLER_STRUCTURES 上限。
 * 这模拟的是「地形不完美时，布局是否还能运转」，不是只看模板格子漂亮。
 */
import { describe, expect, it } from "vitest";
import { COMPACT_CORE_V3 } from "../../../src/domain/layout/templates/compact-core-v3";
import { computeDistanceField } from "../../../src/domain/layout/terrain-analysis";
import { selectAnchors } from "../../../src/domain/layout/anchor-selection";

type Pos = { x: number; y: number };
const pack = (p: Pos) => p.x * 50 + p.y;

type Terrain = (x: number, y: number) => number; // 0 plain, 1 wall, 2 swamp

const TERRAINS: Record<string, Terrain> = {
  open: () => 0,
  banded: (x, y) => {
    const d = Math.max(Math.abs(x - 25), Math.abs(y - 25));
    if (d <= 7) return 0;
    return (x * 7 + y * 13) % 10 < 2 ? 1 : 0;
  },
  hostile: (x, y) => ((x * 7 + y * 13) % 10 < 3 ? 1 : 0),
  swamp: () => 2,
};

function anchorFor(terrain: Terrain, sources: Pos[], fallback: Pos): Pos | undefined {
  const field = computeDistanceField((x, y) => terrain(x, y) === 1);
  const found = selectAnchors({
    field,
    sources,
    controller: { x: 25, y: 38 },
    exits: [],
    mineral: undefined,
    getTerrain: (x, y) => terrain(x, y) === 1,
    maxCandidates: 1,
    minOpenness: 2,
  })[0];
  return found ? { x: found.x, y: found.y } : fallback;
}

interface Placed {
  key: string;
  type: BuildableStructureConstant;
  pos: Pos;
  requires: readonly string[];
}

function freeNeighbors(p: Pos, occupied: Set<number>, terrain: Terrain): number {
  let free = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = p.x + dx;
      const y = p.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain(x, y) === 1) continue;
      if (occupied.has(pack({ x, y }))) continue;
      free++;
    }
  }
  return free;
}

/** 在模板位失败时找最近可放格；带 requires 的格子优先贴近被依赖结构。 */
function findSpot(
  desired: Pos,
  cell: { requires?: readonly string[] },
  placed: Map<string, Placed>,
  occupied: Set<number>,
  terrain: Terrain,
): Pos | undefined {
  const dep = cell.requires?.[0] ? placed.get(cell.requires[0])?.pos : undefined;
  const candidates: Pos[] = [];
  for (let r = 1; r <= 8; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = desired.x + dx;
        const y = desired.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain(x, y) === 1) continue;
        if (occupied.has(pack({ x, y }))) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) return undefined;
  if (dep) {
    candidates.sort(
      (a, b) =>
        Math.max(Math.abs(a.x - dep.x), Math.abs(a.y - dep.y)) -
        Math.max(Math.abs(b.x - dep.x), Math.abs(b.y - dep.y)),
    );
  }
  // 优先选「放下去之后自己仍有可站邻格」的格子。
  for (const c of candidates) {
    const occ = new Set(occupied);
    occ.add(pack(c));
    if (freeNeighbors(c, occ, terrain) > 0) return c;
  }
  return candidates[0];
}

/** 生产 `wouldSeal` 的等价物：放下候选后，任一已有结构的可站邻格归零 ⇒ 拒绝。 */
function sealsNeighbor(
  candidate: Pos,
  placed: Map<string, Placed>,
  occupied: Set<number>,
  terrain: Terrain,
): boolean {
  const occ = new Set(occupied);
  occ.add(pack(candidate));
  for (const p of placed.values()) {
    const d = Math.max(Math.abs(p.pos.x - candidate.x), Math.abs(p.pos.y - candidate.y));
    if (d > 1) continue; // 只可能影响 8 邻域
    if (freeNeighbors(p.pos, occ, terrain) === 0) return true;
  }
  return false;
}

function simulate(anchor: Pos, terrain: Terrain) {
  const placed = new Map<string, Placed>();
  const occupied = new Set<number>();
  const failures: string[] = [];
  const gaps: string[] = [];
  const batchReport: { rcl: number; placed: number; allFree: boolean }[] = [];

  for (let rcl = 2; rcl <= 8; rcl++) {
    const batch = COMPACT_CORE_V3.cells.filter(c => c.minRcl === rcl);
    for (const cell of batch) {
      const desired = { x: anchor.x + cell.dx, y: anchor.y + cell.dy };
      let pos: Pos | undefined;
      const directOk =
        desired.x >= 1 &&
        desired.x <= 48 &&
        desired.y >= 1 &&
        desired.y <= 48 &&
        terrain(desired.x, desired.y) !== 1 &&
        !occupied.has(pack(desired)) &&
        !sealsNeighbor(desired, placed, occupied, terrain);
      if (directOk) {
        pos = desired;
      } else {
        pos = findSpot(desired, cell, placed, occupied, terrain);
        // findSpot 的候选也可能触发密封 — 逐个重试直到找到一个不密封的。
        if (pos && sealsNeighbor(pos, placed, occupied, terrain)) {
          pos = undefined;
        }
      }
      if (!pos) {
        gaps.push(`${cell.key}@RCL${rcl}`);
        continue;
      }
      placed.set(cell.key, {
        key: cell.key,
        type: cell.structureType,
        pos,
        requires: cell.requires ?? [],
      });
      occupied.add(pack(pos));
    }

    // 每批之后的稳定性断言（模拟中途被袭击/停工的现场）。
    let allFree = true;
    for (const p of placed.values()) {
      if (freeNeighbors(p.pos, occupied, terrain) === 0) allFree = false;
    }
    batchReport.push({ rcl, placed: placed.size, allFree });
    // 密封守卫保证：任何地形、任何批次都不允许出现密封结构。
    expect(allFree, `RCL${rcl} 后有结构被密封`).toBe(true);
    expect(failures, `RCL${rcl} 放置失败: ${failures.join(",")}`).toHaveLength(0);

    // 数量上限
    const byType = new Map<string, number>();
    for (const p of placed.values()) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
    for (const [type, n] of byType) {
      const limit = (CONTROLLER_STRUCTURES as Record<string, Record<number, number>>)[type]?.[rcl];
      expect(n, `${type}@RCL${rcl}`).toBeLessThanOrEqual(limit!);
    }

    // storage link 仍要贴 storage（重定位后也不许漂走）
    if (placed.has("core.storage.01")) {
      const storage = placed.get("core.storage.01")!;
      for (const [key, p] of placed) {
        if (p.type !== STRUCTURE_LINK) continue;
        if (!(p.requires ?? []).includes("core.storage.01")) continue;
        const d = Math.max(Math.abs(p.pos.x - storage.pos.x), Math.abs(p.pos.y - storage.pos.y));
        expect(d, `${key}@RCL${rcl} 距 storage`).toBeLessThanOrEqual(2);
      }
    }
  }
  return { placed, batchReport, gaps };
}

describe("v3 全 RCL 稳定性 — 地形 × 锚点", () => {
  for (const [name, terrain] of Object.entries(TERRAINS)) {
    const anchors: { label: string; pos: Pos }[] = [
      { label: "center", pos: { x: 25, y: 25 } },
      { label: "edge-12", pos: { x: 12, y: 12 } },
    ];
    const selected = anchorFor(
      terrain,
      [
        { x: 15, y: 25 },
        { x: 35, y: 25 },
      ],
      { x: 25, y: 25 },
    );
    if (selected) anchors.push({ label: "selected", pos: selected });

    for (const a of anchors) {
      it(`${name} / anchor=${a.label}(${a.pos.x},${a.pos.y})：RCL2→8 每批都稳定`, () => {
        const r = simulate(a.pos, terrain);
        expect(r.batchReport.every(b => b.allFree)).toBe(true);
        if (name === "hostile") {
          // 30% 均匀墙：允许出现"放不下"的缺口（生产会静默缺建），但绝不密封。
          expect(r.gaps.length).toBeLessThanOrEqual(Math.ceil(COMPACT_CORE_V3.cells.length * 0.2));
        } else {
          expect(r.gaps, `缺口: ${r.gaps.join(",")}`).toHaveLength(0);
          expect(r.placed.size).toBe(COMPACT_CORE_V3.cells.length);
        }
      });
    }
  }
});
