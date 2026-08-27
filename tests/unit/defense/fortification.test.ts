/** 防御工事分层维护测试。 */
import { describe, expect, it } from "vitest";
import {
  buildFortificationContext,
  classifyFortification,
  packFortXY,
} from "../../../src/domain/defense/fortification";
import { CONFIG, getWallTargetHits } from "../../../src/config";

/** 手工构建分类上下文（绕过快照，直接控制三个集合）。 */
function ctx(opts: { minCut?: [number, number][]; core?: [number, number][]; utility?: [number, number][] }) {
  return {
    minCutSet: new Set((opts.minCut ?? []).map(([x, y]) => packFortXY(x, y))),
    coreSet: new Set((opts.core ?? []).map(([x, y]) => packFortXY(x, y))),
    utilitySet: new Set((opts.utility ?? []).map(([x, y]) => packFortXY(x, y))),
  };
}

describe("classifyFortification — 分类优先级", () => {
  it("constructedWall 恒为 perimeter（即使坐标落在 core 集合）", () => {
    const c = ctx({ core: [[10, 10]] });
    expect(classifyFortification(10, 10, true, c)).toBe("perimeter");
  });

  it("min-cut 割集位置 → perimeter（优先于 core 归类）", () => {
    const c = ctx({ minCut: [[20, 20]], core: [[20, 20]] });
    expect(classifyFortification(20, 20, false, c)).toBe("perimeter");
  });

  it("核心结构位置 → core；container 位置 → utility", () => {
    const c = ctx({ minCut: [[1, 1]], core: [[10, 10]], utility: [[30, 30]] });
    expect(classifyFortification(10, 10, false, c)).toBe("core");
    expect(classifyFortification(30, 30, false, c)).toBe("utility");
  });

  it("未知位置：有 min-cut 情报 → utility（割集外散盾无防线价值）", () => {
    const c = ctx({ minCut: [[1, 1]] });
    expect(classifyFortification(40, 40, false, c)).toBe("utility");
  });

  it("未知位置：无 min-cut 情报 → perimeter（扇区防御房出口封锁盾不降档）", () => {
    const c = ctx({ core: [[10, 10]] });
    expect(classifyFortification(40, 40, false, c)).toBe("perimeter");
  });

  it("buildFortificationContext：从快照结构位置与扁平 min-cut 数组构建集合", () => {
    const snapshot = {
      spawns: [{ pos: { x: 5, y: 5 } }],
      extensions: [{ pos: { x: 6, y: 6 } }],
      towers: [{ pos: { x: 7, y: 7 } }],
      links: [{ pos: { x: 8, y: 8 } }],
      storage: { pos: { x: 9, y: 9 } },
      containers: [{ pos: { x: 15, y: 15 } }],
    } as any;
    const c = buildFortificationContext(snapshot, [2, 3, 4, 5]);
    expect(c.minCutSet.has(packFortXY(2, 3))).toBe(true);
    expect(c.minCutSet.has(packFortXY(4, 5))).toBe(true);
    expect(c.coreSet.has(packFortXY(5, 5))).toBe(true);
    expect(c.coreSet.has(packFortXY(9, 9))).toBe(true);
    // container 归 utility 集合，不进 core — 低值资产不按核心档维护。
    expect(c.coreSet.has(packFortXY(15, 15))).toBe(false);
    expect(c.utilitySet.has(packFortXY(15, 15))).toBe(true);
  });
});

describe("getWallTargetHits — 分层目标血量", () => {
  it("perimeter 全额：RCL 分级不变（100k / 1M / 10M）", () => {
    expect(getWallTargetHits(3, false, "perimeter")).toBe(100_000);
    expect(getWallTargetHits(5, false, "perimeter")).toBe(1_000_000);
    expect(getWallTargetHits(8, false, "perimeter")).toBe(10_000_000);
  });

  it("core 折扣：全额 × coreRampartFactor（RCL6 = 30 万）", () => {
    expect(getWallTargetHits(6, false, "core")).toBe(
      Math.round(1_000_000 * CONFIG.defense.coreRampartFactor),
    );
  });

  it("utility 地板：任何 RCL 都只维持新生急救线", () => {
    expect(getWallTargetHits(3, false, "utility")).toBe(CONFIG.defense.rampartBootstrapHits);
    expect(getWallTargetHits(8, false, "utility")).toBe(CONFIG.defense.rampartBootstrapHits);
  });

  it("受袭升档作用于 perimeter/core，utility 恒为地板", () => {
    expect(getWallTargetHits(5, true, "perimeter")).toBe(5_000_000);
    expect(getWallTargetHits(5, true, "core")).toBe(
      Math.round(1_000_000 * CONFIG.defense.coreRampartFactor) * CONFIG.defense.siegeWallMultiplier,
    );
    // utility 受袭不升档：该格塌了损失有限，能量留给周界。
    expect(getWallTargetHits(5, true, "utility")).toBe(CONFIG.defense.rampartBootstrapHits);
  });

  it("默认角色为 perimeter（向后兼容旧调用）", () => {
    expect(getWallTargetHits(5)).toBe(1_000_000);
    expect(getWallTargetHits(5, true)).toBe(5_000_000);
  });
});
