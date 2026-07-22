/**
 * 密封守卫（wouldSeal / validateBuildCell "seal"）测试。
 *
 * 覆盖：
 *   - 候选位置出生即密封 → 拒绝
 *   - 候选夺走邻居最后一个可站格 → 拒绝
 *   - 开阔位置 → 放行
 *   - 可通行结构（road/container/rampart）不做密封检查
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildObstaclePositionSet,
  validateBuildCell,
  wouldSeal,
  type ValidationOptions,
} from "../src/domain/layout/validation";
import { packPos } from "../src/domain/layout/types";
import { mockPos, mockSnapshot, mockStructure, resetGlobals } from "./role-helpers";

beforeEach(() => {
  resetGlobals();
});

const flatTerrain = { get: () => 0 } as unknown as RoomTerrain;
const room = { getTerrain: () => flatTerrain } as unknown as Room;

function obstacleAt(x: number, y: number, type = "extension"): any {
  return { structureType: type, pos: mockPos(x, y) };
}

function options(obstacleSet: ReadonlySet<number>): ValidationOptions {
  return {
    completedKeys: new Set(),
    globalSiteCount: 0,
    maxGlobalSites: 7,
    obstacleSet,
  };
}

const extCell = {
  key: "core.ext.99",
  dx: 0,
  dy: 0,
  structureType: "extension" as BuildableStructureConstant,
  minRcl: 2,
  phase: "rcl2" as const,
  priority: 1 as const,
  tags: ["core" as const],
};

describe("seal-guard — wouldSeal", () => {
  it("自身 8 邻居全是障碍 → 出生即密封，拒绝", () => {
    // 围绕 (25,25) 的 8 个障碍。
    const obstacles = [
      obstacleAt(24, 24), obstacleAt(25, 24), obstacleAt(26, 24),
      obstacleAt(24, 25), obstacleAt(26, 25),
      obstacleAt(24, 26), obstacleAt(25, 26), obstacleAt(26, 26),
    ];
    const snap = mockSnapshot({ extensions: obstacles });
    const set = buildObstaclePositionSet(snap);

    expect(wouldSeal(25, 25, flatTerrain, set)).toBe(true);
  });

  it("夺走邻居最后一个可站格 → 把邻居封死，拒绝", () => {
    // (26,25) 是已有 extension，其 8 邻居除 (25,25) 外全是障碍。
    // 候选 (25,25) 自身有 (24,25) 可站，但会封死 (26,25)。
    const obstacles = [
      obstacleAt(26, 25), // 邻居
      obstacleAt(25, 24), obstacleAt(26, 24), obstacleAt(27, 24),
      obstacleAt(27, 25),
      obstacleAt(25, 26), obstacleAt(26, 26), obstacleAt(27, 26),
    ];
    const snap = mockSnapshot({ extensions: obstacles });
    const set = buildObstaclePositionSet(snap);

    expect(wouldSeal(25, 25, flatTerrain, set)).toBe(true);
  });

  it("开阔位置 → 放行", () => {
    const obstacles = [obstacleAt(26, 25)];
    const snap = mockSnapshot({ extensions: obstacles });
    const set = buildObstaclePositionSet(snap);

    expect(wouldSeal(25, 25, flatTerrain, set)).toBe(false);
  });

  it("障碍工地（site）同样计入障碍集合", () => {
    const site: any = { structureType: "tower", pos: mockPos(26, 25), my: true };
    const snap = mockSnapshot({ constructionSites: [site] });
    const set = buildObstaclePositionSet(snap);

    expect(set.has(packPos(26, 25))).toBe(true);
  });

  it("container/road 不计入障碍（可通行）", () => {
    const container = obstacleAt(26, 25, "container");
    const road = obstacleAt(27, 25, "road");
    const snap = mockSnapshot({ containers: [container], roads: [road] });
    const set = buildObstaclePositionSet(snap);

    expect(set.has(packPos(26, 25))).toBe(false);
    expect(set.has(packPos(27, 25))).toBe(false);
  });
});

describe("seal-guard — validateBuildCell 接入", () => {
  // 注意：mockSnapshot 默认 source/controller 放在 (25,25)，本组测试须显式清空。
  it("密封候选返回 seal；开阔候选返回 ok；非障碍类型不检查", () => {
    const obstacles = [
      obstacleAt(24, 24), obstacleAt(25, 24), obstacleAt(26, 24),
      obstacleAt(24, 25), obstacleAt(26, 25),
      obstacleAt(24, 26), obstacleAt(25, 26), obstacleAt(26, 26),
    ];
    const snap = mockSnapshot({ rcl: 8, extensions: obstacles, sources: [], controller: undefined });
    const set = buildObstaclePositionSet(snap);

    // 密封 → "seal"
    expect(validateBuildCell(room, extCell, { x: 25, y: 25 }, snap, options(set))).toBe("seal");
    // 开阔 → "ok"
    expect(validateBuildCell(room, extCell, { x: 30, y: 30 }, snap, options(set))).toBe("ok");
    // road（非障碍）即使在"密封"位置也不检查
    const roadCell = { ...extCell, structureType: "road" as BuildableStructureConstant };
    expect(validateBuildCell(room, roadCell, { x: 25, y: 25 }, snap, options(set))).toBe("ok");
  });

  it("未提供 obstacleSet 时跳过密封检查（向后兼容）", () => {
    const obstacles = [
      obstacleAt(24, 24), obstacleAt(25, 24), obstacleAt(26, 24),
      obstacleAt(24, 25), obstacleAt(26, 25),
      obstacleAt(24, 26), obstacleAt(25, 26), obstacleAt(26, 26),
    ];
    const snap = mockSnapshot({ rcl: 8, extensions: obstacles, sources: [], controller: undefined });
    const opts: ValidationOptions = { completedKeys: new Set(), globalSiteCount: 0, maxGlobalSites: 7 };

    expect(validateBuildCell(room, extCell, { x: 25, y: 25 }, snap, opts)).toBe("ok");
  });
});
