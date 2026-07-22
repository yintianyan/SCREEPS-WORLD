import { describe, it, expect } from "vitest";
import { computeDistanceField } from "../src/domain/layout/terrain-analysis";
import {
  scoreAnchor,
  evaluateAnchorAt,
  selectAnchors,
  diagnoseAnchor,
  DEFAULT_WEIGHTS,
  type AnchorConstraint,
  type AnchorSelectionInput,
} from "../src/domain/layout/anchor-selection";

const noWalls = (_x: number, _y: number): boolean => false;

/** 标准房间：2 source + controller + mineral + 4 出口边。 */
function standardInput(): AnchorSelectionInput {
  const field = computeDistanceField(noWalls);
  return {
    field,
    sources: [{ x: 10, y: 10 }, { x: 40, y: 40 }],
    controller: { x: 35, y: 15 },
    exits: [
      { x: 0, y: 25 }, { x: 49, y: 25 },
      { x: 25, y: 0 }, { x: 25, y: 49 },
    ],
    mineral: { x: 15, y: 40 },
    getTerrain: noWalls,
  };
}

describe("anchor-selection — scoreAnchor", () => {
  it("高 openness + 低 blockedCells 得分高", () => {
    const good: AnchorConstraint = {
      openness: 8, avgSourceDist: 10, controllerDist: 10,
      exitDistance: 15, blockedCells: 0, mineralDist: 15,
    };
    const bad: AnchorConstraint = {
      openness: 3, avgSourceDist: 10, controllerDist: 10,
      exitDistance: 15, blockedCells: 10, mineralDist: 15,
    };
    expect(scoreAnchor(good)).toBeGreaterThan(scoreAnchor(bad));
  });

  it("靠近 source 得分更高（sourceDist 权重为负）", () => {
    const near: AnchorConstraint = {
      openness: 5, avgSourceDist: 5, controllerDist: 10,
      exitDistance: 15, blockedCells: 0, mineralDist: 15,
    };
    const far: AnchorConstraint = {
      openness: 5, avgSourceDist: 20, controllerDist: 10,
      exitDistance: 15, blockedCells: 0, mineralDist: 15,
    };
    expect(scoreAnchor(near)).toBeGreaterThan(scoreAnchor(far));
  });

  it("远离出口得分更高（exitDistance 权重为正）", () => {
    const safe: AnchorConstraint = {
      openness: 5, avgSourceDist: 10, controllerDist: 10,
      exitDistance: 25, blockedCells: 0, mineralDist: 15,
    };
    const exposed: AnchorConstraint = {
      openness: 5, avgSourceDist: 10, controllerDist: 10,
      exitDistance: 5, blockedCells: 0, mineralDist: 15,
    };
    expect(scoreAnchor(safe)).toBeGreaterThan(scoreAnchor(exposed));
  });

  it("自定义权重生效", () => {
    const c: AnchorConstraint = {
      openness: 5, avgSourceDist: 10, controllerDist: 10,
      exitDistance: 15, blockedCells: 0, mineralDist: 15,
    };
    const w1 = { ...DEFAULT_WEIGHTS, openness: 100 };
    const w2 = { ...DEFAULT_WEIGHTS, openness: 0 };
    expect(scoreAnchor(c, w1)).toBeGreaterThan(scoreAnchor(c, w2));
  });
});

describe("anchor-selection — evaluateAnchorAt", () => {
  it("全开放地形中心：openness 高、blockedCells = 0", () => {
    const input = standardInput();
    const result = evaluateAnchorAt(25, 25, input);
    expect(result.openness).toBeGreaterThanOrEqual(20);
    expect(result.blockedCells).toBe(0);
    expect(result.x).toBe(25);
    expect(result.y).toBe(25);
  });

  it("avgSourceDist 正确计算", () => {
    const input = standardInput();
    // sources at (10,10) and (40,40), point at (25,25)
    // dist to (10,10) = 15+15 = 30, dist to (40,40) = 15+15 = 30, avg = 30
    const result = evaluateAnchorAt(25, 25, input);
    expect(result.avgSourceDist).toBe(30);
  });

  it("exitDistance 取最近出口", () => {
    const input = standardInput();
    // exits at (0,25),(49,25),(25,0),(25,49); point (25,25)
    // nearest: (49,25) or (25,49) at dist 24
    const result = evaluateAnchorAt(25, 25, input);
    expect(result.exitDistance).toBe(24);
  });

  it("无 controller 时 controllerDist = 25（中性值）", () => {
    const input = { ...standardInput(), controller: undefined };
    const result = evaluateAnchorAt(25, 25, input);
    expect(result.controllerDist).toBe(25);
  });
});

describe("anchor-selection — selectAnchors", () => {
  it("返回按分数降序排列的候选", () => {
    const input = standardInput();
    const results = selectAnchors(input);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("不选 source/controller/mineral 所在格", () => {
    const input = standardInput();
    const results = selectAnchors({ ...input, maxCandidates: 100 });
    for (const r of results) {
      expect(r.x * 50 + r.y).not.toBe(10 * 50 + 10); // source 1
      expect(r.x * 50 + r.y).not.toBe(40 * 50 + 40); // source 2
      expect(r.x * 50 + r.y).not.toBe(35 * 50 + 15); // controller
      expect(r.x * 50 + r.y).not.toBe(15 * 50 + 40); // mineral
    }
  });

  it("全开放地形：最佳候选在房间中心附近", () => {
    const input = standardInput();
    const results = selectAnchors(input);
    const best = results[0]!;
    // 中心 (25,25) 附近（考虑 source 对称性，可能在 25±5 范围）
    expect(best.x).toBeGreaterThanOrEqual(15);
    expect(best.x).toBeLessThanOrEqual(35);
    expect(best.y).toBeGreaterThanOrEqual(15);
    expect(best.y).toBeLessThanOrEqual(35);
  });

  it("minOpenness 过滤生效", () => {
    const input = standardInput();
    const r4 = selectAnchors({ ...input, minOpenness: 4, maxCandidates: 1000 });
    const r10 = selectAnchors({ ...input, minOpenness: 10, maxCandidates: 1000 });
    expect(r4.length).toBeGreaterThan(r10.length);
  });

  it("有墙地形：候选避开墙区域", () => {
    const wallTerrain = (x: number, y: number): boolean =>
      x >= 20 && x <= 30 && y >= 20 && y <= 30;
    const field = computeDistanceField(wallTerrain);
    const input: AnchorSelectionInput = {
      field,
      sources: [{ x: 10, y: 10 }],
      controller: { x: 40, y: 40 },
      exits: [{ x: 0, y: 25 }, { x: 49, y: 25 }],
      mineral: undefined,
      getTerrain: wallTerrain,
      minOpenness: 4,
    };
    const results = selectAnchors(input);
    // 最佳候选不应在墙区域内
    for (const r of results) {
      const inWall = r.x >= 20 && r.x <= 30 && r.y >= 20 && r.y <= 30;
      expect(inWall).toBe(false);
    }
  });
});

describe("anchor-selection — diagnoseAnchor", () => {
  it("中心位置排名靠前", () => {
    const input = standardInput();
    const diag = diagnoseAnchor(25, 25, input);
    expect(diag.rank).toBeGreaterThanOrEqual(1);
    expect(diag.rank).toBeLessThanOrEqual(3); // 中心应该是 top-3
    expect(diag.total).toBeGreaterThan(0);
    expect(diag.candidate.blockedCells).toBe(0);
  });

  it("角落位置排名靠后", () => {
    const input = standardInput();
    const diag = diagnoseAnchor(6, 6, input);
    // 角落 openness 低 + exitDistance 小 → 排名靠后
    expect(diag.rank).toBeGreaterThan(3);
  });

  it("rank 不超过 total+1", () => {
    const input = standardInput();
    const diag = diagnoseAnchor(1, 1, input);
    expect(diag.rank).toBeLessThanOrEqual(diag.total + 1);
  });
});
