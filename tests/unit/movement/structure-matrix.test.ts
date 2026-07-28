/**
 * CostMatrix 结构成本合并测试 — 同格多结构（rampart 叠盾）不得洗白障碍。
 *
 * 线上事故：rampart 叠在 spawn 上，遍历序靠后的 rampart（cost 2）覆盖
 * spawn 的 255 → 路径矩阵把 spawn 格标记为可走 → 全部核心区物流路径
 * 穿 spawn → move 被引擎逐 tick 拒绝 → 全房车队冻结。
 */
import { describe, expect, it } from "vitest";
import { buildStructurePositions } from "../../../src/creeps/movement/pathfinding";
import { mockPos } from "../../role-helpers";

function structure(type: string, x: number, y: number, my = true): any {
  return { structureType: type, my, pos: mockPos(x, y) };
}

/** 展平数组 → Map<packed, cost>，便于断言。 */
function toCostMap(positions: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < positions.length; i += 3) {
    m.set(positions[i]! * 50 + positions[i + 1]!, positions[i + 2]!);
  }
  return m;
}

describe("buildStructurePositions — 同格多结构合并", () => {
  it("rampart 叠盾在 spawn 上：整格保持 255（任意遍历序）", () => {
    // 两种顺序都必须得到 255 — 修复前 rampart 在后时会洗成 2。
    const a = toCostMap(buildStructurePositions(
      [structure("spawn", 25, 24), structure("rampart", 25, 24)], [],
    ).positions);
    const b = toCostMap(buildStructurePositions(
      [structure("rampart", 25, 24), structure("spawn", 25, 24)], [],
    ).positions);

    expect(a.get(25 * 50 + 24)).toBe(255);
    expect(b.get(25 * 50 + 24)).toBe(255);
  });

  it("rampart 叠在 road 上：取通行成本更优的 road（1）", () => {
    const m = toCostMap(buildStructurePositions(
      [structure("road", 10, 10), structure("rampart", 10, 10)], [],
    ).positions);
    expect(m.get(10 * 50 + 10)).toBe(1);
  });

  it("单结构语义不变：road 1 / container 2 / 己方 rampart 2 / 敌方 rampart 255 / spawn 255", () => {
    const m = toCostMap(buildStructurePositions(
      [
        structure("road", 1, 1),
        structure("container", 2, 2),
        structure("rampart", 3, 3),
        structure("rampart", 4, 4, false),
        structure("spawn", 5, 5),
      ], [],
    ).positions);
    expect(m.get(1 * 50 + 1)).toBe(1);
    expect(m.get(2 * 50 + 2)).toBe(2);
    expect(m.get(3 * 50 + 3)).toBe(2);
    expect(m.get(4 * 50 + 4)).toBe(255);
    expect(m.get(5 * 50 + 5)).toBe(255);
  });

  it("实体 site 与障碍结构同格：障碍 255 优先于 site 的强避 50", () => {
    const m = toCostMap(buildStructurePositions(
      [structure("spawn", 7, 7)],
      [structure("extension", 7, 7) as any],
    ).positions);
    expect(m.get(7 * 50 + 7)).toBe(255);
  });
});
