/** Fallback relocation（cell 落在墙/占用格时的替代位置搜索）测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  blueprintToTasks,
  relocateCandidate,
  type BuildTaskCandidate,
} from "../../../src/domain/layout/task-factory";
import { buildObstaclePositionSet, type ValidationOptions } from "../../../src/domain/layout/validation";
import { packPos } from "../../../src/domain/layout/types";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";
import { mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

const wallTerrain = (walls: [number, number][]) => {
  const set = new Set(walls.map(([x, y]) => `${x},${y}`));
  return { get: (x: number, y: number) => (set.has(`${x},${y}`) ? 1 : 0) } as unknown as RoomTerrain;
};

function roomWith(terrain: RoomTerrain): Room {
  return { getTerrain: () => terrain } as unknown as Room;
}

const extCell = COMPACT_CORE_V2.cells.find(c => c.key === "core.ext.04")!; // (2,0)

function candidateAt(x: number, y: number, validation: BuildTaskCandidate["validation"]): BuildTaskCandidate {
  return {
    key: extCell.key,
    pos: { x, y, roomName: "W7N4" },
    structureType: "extension",
    priority: 1,
    phase: "rcl2",
    validation,
  };
}

function options(snapshot: ReturnType<typeof mockSnapshot>): ValidationOptions {
  return {
    completedKeys: new Set(),
    globalSiteCount: 0,
    maxGlobalSites: 7,
    obstacleSet: buildObstaclePositionSet(snapshot),
  };
}

describe("layout — fallback relocation", () => {
  it("cell 落墙 → 重定位到同 parity 邻近格", () => {
    // (25,25) 是墙；所有 Chebyshev-2 fallback 位置开阔。
    const terrain = wallTerrain([[25, 25]]);
    const room = roomWith(terrain);
    // 注意：mockSnapshot 默认 source/controller 在 (25,25)，显式清空避免占用干扰。
    const snap = mockSnapshot({ rcl: 8, sources: [], controller: undefined });

    const result = relocateCandidate(
      candidateAt(25, 25, "terrain"),
      extCell,
      room,
      snap,
      options(snap),
      new Set(),
    );

    expect(result).toBeDefined();
    expect(result!.validation).toBe("ok");
    // 同 parity：(dx+dy) 偏移偶校验不变量。
    expect(Math.abs((result!.pos.x - 25 + result!.pos.y - 25) % 2)).toBe(0);
    expect(result!.key).toBe("core.ext.04");
  });

  it("fallback 位置撞上禁止落子集合 → 跳过该格选下一个", () => {
    const terrain = wallTerrain([[25, 25]]);
    const room = roomWith(terrain);
    const snap = mockSnapshot({ rcl: 8, sources: [], controller: undefined });

    // 第一个 fallback 偏移是 (+2,0) → (27,25)，禁掉它。
    const forbidden = new Set([packPos(27, 25)]);
    const result = relocateCandidate(
      candidateAt(25, 25, "terrain"),
      extCell,
      room,
      snap,
      options(snap),
      forbidden,
    );

    expect(result).toBeDefined();
    expect([result!.pos.x, result!.pos.y]).not.toEqual([27, 25]);
  });

  it("重定位目标不会制造密封（密封守卫在 fallback 中同样生效）", () => {
    const terrain = wallTerrain([[25, 25]]);
    const room = roomWith(terrain);
    // 把 (+2,0) fallback 位置 (27,25) 用 7 个障碍围到只剩 (27,25) 自身空格——
    // 等等，(27,25) 是候选自身；围它 8 邻居中的 8 个（不含 (25,25) 墙格也算障碍）。
    const ring = [
      { pos: mockPos(26, 24) }, { pos: mockPos(27, 24) }, { pos: mockPos(28, 24) },
      { pos: mockPos(26, 25) }, { pos: mockPos(28, 25) },
      { pos: mockPos(26, 26) }, { pos: mockPos(27, 26) }, { pos: mockPos(28, 26) },
    ].map((s, i) => ({ id: `e${i}`, structureType: "extension", ...s }));
    const snap = mockSnapshot({
      rcl: 8,
      sources: [],
      controller: undefined,
      extensions: ring as any,
    });

    const result = relocateCandidate(
      candidateAt(25, 25, "terrain"),
      extCell,
      room,
      snap,
      options(snap),
      new Set(),
    );

    // (27,25) 出生即密封应被拒绝，选择其他开阔 fallback。
    expect(result).toBeDefined();
    expect([result!.pos.x, result!.pos.y]).not.toEqual([27, 25]);
  });

  it("不可移动类型（spawn）不重定位", () => {
    const terrain = wallTerrain([[25, 25]]);
    const room = roomWith(terrain);
    const snap = mockSnapshot({ rcl: 8, sources: [], controller: undefined });
    const spawnCandidate: BuildTaskCandidate = {
      key: "core.spawn.02",
      pos: { x: 25, y: 25, roomName: "W7N4" },
      structureType: "spawn",
      priority: 1,
      phase: "late",
      validation: "terrain",
    };
    const spawnCell = { ...spawnCandidate, minRcl: 7, tags: ["core"] as const, requires: undefined, dx: -2, dy: 0 };

    const result = relocateCandidate(spawnCandidate, spawnCell as any, room, snap, options(snap), new Set());
    expect(result).toBeUndefined();
  });

  it("tower 可重定位（不规则地形不永久丢失结构）", () => {
    const towerCell = COMPACT_CORE_V2.cells.find(c => c.key === "core.tower.01")!;
    const terrain = wallTerrain([[27, 27]]);
    const room = roomWith(terrain);
    const snap = mockSnapshot({ rcl: 8, sources: [], controller: undefined });
    const towerCandidate: BuildTaskCandidate = {
      key: towerCell.key,
      pos: { x: 27, y: 27, roomName: "W7N4" },
      structureType: "tower",
      priority: 0,
      phase: "rcl3",
      validation: "terrain",
    };

    const result = relocateCandidate(towerCandidate, towerCell, room, snap, options(snap), new Set());
    expect(result).toBeDefined();
    expect(result!.validation).toBe("ok");
    // 重定位后不在原位置。
    expect([result!.pos.x, result!.pos.y]).not.toEqual([27, 27]);
  });

  it("全部 fallback 失败 → undefined（安全跳过，下周期再试）", () => {
    // 候选点 + 全部 8 个 fallback 位置都是墙。
    const terrain = wallTerrain([
      [25, 25],
      [27, 25], [23, 25], [25, 27], [25, 23],
      [27, 27], [23, 27], [27, 23], [23, 23],
    ]);
    const room = roomWith(terrain);
    const snap = mockSnapshot({ rcl: 8, sources: [], controller: undefined });

    const result = relocateCandidate(
      candidateAt(25, 25, "terrain"),
      extCell,
      room,
      snap,
      options(snap),
      new Set(),
    );
    expect(result).toBeUndefined();
  });

  it("blueprintToTasks 应用 overrides：替代坐标直接生效", () => {
    const terrain = wallTerrain([]); // 无墙
    const room = roomWith(terrain);
    const snap = mockSnapshot({ rcl: 8, sources: [], controller: undefined });
    const overrides = new Map<string, number>([["core.ext.04", packPos(30, 30)]]);

    const candidates = blueprintToTasks(
      COMPACT_CORE_V2,
      25, 25, "W7N4", room, snap, 8,
      options(snap),
      overrides,
    );

    const ext04 = candidates.find(c => c.key === "core.ext.04");
    expect([ext04!.pos.x, ext04!.pos.y]).toEqual([30, 30]);
    // 其他 cell 不受影响（ext.05 蓝图偏移 (3,1) → (28,26)）。
    const ext05 = candidates.find(c => c.key === "core.ext.05");
    expect([ext05!.pos.x, ext05!.pos.y]).toEqual([28, 26]);
  });
});
