import { describe, expect, it } from "vitest";
import { buildProtectedLayoutPositions, isMinCutPositionBuildable } from "../../../src/systems/defense-planner";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";

/**
 * P1-2 min-cut 割集位置可建造性预校验单元测试。

 * 覆盖：
 *   - 出口格及紧邻出口格过滤（x/y ≤1 或 ≥48）
 *   - 已有 construction site 的位置过滤
 *   - 正常位置通过校验

 * 根因：min-cut 算法只看地形不验证可建造性，11 个 wall 站点因位置不可建造
 * 永久阻塞 22 万 tick。P1-2 在入队前预校验，避免注定 blocked 的任务入队。
 */
describe("isMinCutPositionBuildable — min-cut 割集位置可建造性预校验", () => {
  // ── 出口格过滤 ──

  it("x=0（出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 0, y: 25 }, false)).toBe(false);
  });

  it("y=0（出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 25, y: 0 }, false)).toBe(false);
  });

  it("x=49（出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 49, y: 25 }, false)).toBe(false);
  });

  it("y=49（出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 25, y: 49 }, false)).toBe(false);
  });

  it("x=1（紧邻出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 1, y: 25 }, false)).toBe(false);
  });

  it("x=48（紧邻出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 48, y: 25 }, false)).toBe(false);
  });

  it("y=1（紧邻出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 25, y: 1 }, false)).toBe(false);
  });

  it("y=48（紧邻出口格）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 25, y: 48 }, false)).toBe(false);
  });

  it("角落位置（0,0）不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 0, y: 0 }, false)).toBe(false);
  });

  // ── construction site 冲突 ──

  it("有 construction site 的位置不可建造", () => {
    expect(isMinCutPositionBuildable({ x: 25, y: 25 }, true)).toBe(false);
  });

  it("无 construction site 的正常位置可建造", () => {
    expect(isMinCutPositionBuildable({ x: 25, y: 25 }, false)).toBe(true);
  });

  // ── 正常位置 ──

  it("房间中心区域可建造", () => {
    expect(isMinCutPositionBuildable({ x: 20, y: 20 }, false)).toBe(true);
    expect(isMinCutPositionBuildable({ x: 30, y: 30 }, false)).toBe(true);
    expect(isMinCutPositionBuildable({ x: 25, y: 25 }, false)).toBe(true);
  });

  it("边界内位置（x=2, y=2 / x=47, y=47）可建造", () => {
    expect(isMinCutPositionBuildable({ x: 2, y: 2 }, false)).toBe(true);
    expect(isMinCutPositionBuildable({ x: 47, y: 47 }, false)).toBe(true);
  });
});

describe("未来蓝图 footprint 防护", () => {
  it("无 anchor 时不伪造保护区", () => {
    expect(buildProtectedLayoutPositions(undefined).size).toBe(0);
  });

  it("anchor 设置后保护所有 RCL 未来结构位置", () => {
    const anchor = 25 * 50 + 25;
    const protectedPositions = buildProtectedLayoutPositions({ anchor } as any);

    expect(protectedPositions.size).toBeGreaterThan(0);
    for (const cell of COMPACT_CORE_V2.cells) {
      const x = 25 + cell.dx;
      const y = 25 + cell.dy;
      if (x >= 1 && x <= 48 && y >= 1 && y <= 48) {
        expect(protectedPositions.has(x * 50 + y)).toBe(true);
      }
    }
  });
});
