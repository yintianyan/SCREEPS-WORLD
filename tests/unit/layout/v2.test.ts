/**
 * compact-core-v2 几何不变量测试 — 永久守卫。
 *
 * v1 的 P0 教训：实心块模板全建成后 29/68 个结构被完全密封
 * （spawn 无法孵化 / storage 无法存取 / 塔无法补能 / 22 个 extension 幽灵容量）。
 * 这些不变量保证任何未来的 cell 修改都不可能再制造建筑孤岛：
 *   1. 所有 cell 落在偶校验格（dx+dy 为偶数）—— 奇数格永远留作走道；
 *   2. 无任何密封结构（每个障碍结构 ≥1 个相邻空格）；
 *   3. 每个 spawn ≥2 个出生格；
 *   4. extension 各 RCL 批次数量与 CONTROLLER_STRUCTURES 上限一致；
 *   5. 模板占地 ≤±6（锚点适配性）。
 */
import { describe, expect, it } from "vitest";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";
import { OBSTACLE_TYPES } from "../../../src/domain/layout/validation";

/** 锚点 spawn 占用 (0,0)，与 cells 合并成完整占用图。 */
function buildOccupancy(): Map<string, string> {
  const grid = new Map<string, string>();
  grid.set("0,0", "spawn");
  for (const c of COMPACT_CORE_V2.cells) {
    grid.set(`${c.dx},${c.dy}`, c.structureType);
  }
  return grid;
}

describe("compact-core-v2 — 几何不变量", () => {
  it("所有 cell 落在偶校验格（dx+dy 为偶数）", () => {
    for (const c of COMPACT_CORE_V2.cells) {
      // 注意 JS 中 -2 % 2 === -0，用 Math.abs 归一。
      expect(Math.abs((c.dx + c.dy) % 2), `${c.key} @(${c.dx},${c.dy}) 落在奇校验格`).toBe(0);
    }
  });

  it("无任何密封结构（每个障碍结构 ≥1 个相邻空格）", () => {
    const grid = buildOccupancy();
    for (const [key, type] of grid) {
      if (!OBSTACLE_TYPES.has(type)) continue;
      const [x, y] = key.split(",").map(Number) as [number, number];
      let free = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (!grid.has(`${x + dx},${y + dy}`)) free++;
        }
      }
      expect(free, `${type} @(${x},${y}) 被完全密封`).toBeGreaterThan(0);
    }
  });

  it("每个 spawn ≥2 个出生格（spawnCreep 射程 1）", () => {
    const grid = buildOccupancy();
    const spawnOffsets: [number, number][] = [[0, 0]];
    for (const c of COMPACT_CORE_V2.cells) {
      if (c.structureType === "spawn") spawnOffsets.push([c.dx, c.dy]);
    }
    expect(spawnOffsets).toHaveLength(3);
    for (const [sx, sy] of spawnOffsets) {
      let free = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (!grid.has(`${sx + dx},${sy + dy}`)) free++;
        }
      }
      expect(free, `spawn @(${sx},${sy}) 出生格不足`).toBeGreaterThanOrEqual(2);
    }
  });

  it("extension 批次与 RCL 上限一致（5/10/20/30/40/50/60）", () => {
    const expected: Record<number, number> = { 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 };
    for (const [rclStr, total] of Object.entries(expected)) {
      const rcl = Number(rclStr);
      const count = COMPACT_CORE_V2.cells.filter(
        c => c.structureType === "extension" && c.minRcl <= rcl,
      ).length;
      expect(count, `RCL${rcl} 累计 extension 数`).toBe(total);
    }
  });

  it("关键结构数量：3 tower / 1 storage / 2 link / 2 额外 spawn", () => {
    const byType = (t: string) => COMPACT_CORE_V2.cells.filter(c => c.structureType === t);
    expect(byType("tower")).toHaveLength(3);
    expect(byType("storage")).toHaveLength(1);
    expect(byType("link")).toHaveLength(2);
    expect(byType("spawn")).toHaveLength(2); // 锚点外 2 个
  });

  it("模板占地 ≤±6（锚点适配性：中心房不会越界）", () => {
    for (const c of COMPACT_CORE_V2.cells) {
      expect(Math.abs(c.dx)).toBeLessThanOrEqual(6);
      expect(Math.abs(c.dy)).toBeLessThanOrEqual(6);
    }
  });

  it("tower/storage 为 priority 0（critical），RCL5+ extension 为 priority 2", () => {
    for (const c of COMPACT_CORE_V2.cells) {
      if (c.structureType === "tower" || c.structureType === "storage") {
        expect(c.priority, `${c.key} 应为 critical`).toBe(0);
      }
      if (c.structureType === "extension" && c.minRcl >= 5) {
        expect(c.priority, `${c.key} RCL5+ extension 应为 priority 2`).toBe(2);
      }
    }
  });
});
