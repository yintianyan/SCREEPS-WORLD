/** computeSealedExits 纯函数测试（v33 完整情报 — 入口封死判定）。 */
import { describe, expect, it } from "vitest";
import { computeSealedExits, type SealedExitInput } from "../../../src/domain/intel";

/** 全平地形的 getTerrain。 */
const openTerrain = (): number => 0;

/** 构造输入：默认 4 个出口全列出，地形全开。 */
function input(overrides: Partial<SealedExitInput> = {}): SealedExitInput {
  return {
    roomName: "W7N4",
    exits: { "1": "W7N3", "3": "W8N4", "5": "W7N5", "7": "W6N4" },
    artificialWalls: new Set<number>(),
    getTerrain: openTerrain,
    ...overrides,
  };
}

/** packed 坐标集合辅助。 */
function packed(xs: Array<[number, number]>): Set<number> {
  return new Set(xs.map(([x, y]) => x * 50 + y));
}

describe("intel — computeSealedExits 入口封死判定", () => {
  it("无人工墙：任何出口都不封死", () => {
    expect(computeSealedExits(input())).toEqual([]);
  });

  it("单方向边界带全墙封死：LEFT 出口（x=0,1 两列全封）被报告", () => {
    const walls: Array<[number, number]> = [];
    for (let y = 0; y < 50; y++) {
      walls.push([0, y], [1, y]);
    }
    expect(computeSealedExits(input({ artificialWalls: packed(walls) }))).toEqual([7]);
  });

  it("部分墙（如 W36S58 西侧 x=2 墙线）：不算封死 — 编队可绕行", () => {
    // 线上实证场景：墙线筑在 x=2（第三格），边界带 x∈{0,1} 仍可通行 —
    // 编队进房后由管线寻路绕行，不应判定为封死。
    const walls: Array<[number, number]> = [];
    for (let y = 26; y <= 32; y++) walls.push([2, y]);
    walls.push([1, 26]);
    expect(computeSealedExits(input({ artificialWalls: packed(walls) }))).toEqual([]);
  });

  it("边界带内全封但带外无关墙不算封死；四个方向独立判定", () => {
    const walls: Array<[number, number]> = [];
    for (let y = 0; y < 50; y++) walls.push([0, y], [1, y]); // LEFT 全封
    walls.push([30, 30], [31, 31]); // 房内散墙，不参与判定
    expect(computeSealedExits(input({ artificialWalls: packed(walls) }))).toEqual([7]);
  });

  it("地形墙不算人工封死：边界带地形已堵 + 可通行格无人墙 → 不封死", () => {
    // 地形墙天然阻断出口，describeExits 不会列出该方向；
    // 即便列出，可通行格无人工墙覆盖 → 不封死（防御性语义）。
    const terrain = (x: number, y: number): number => {
      void x; void y;
      return 1; // 全地形墙
    };
    expect(computeSealedExits(input({ getTerrain: terrain }))).toEqual([]);
  });

  it("地形半开 + 人工墙覆盖所有可通行格 → 封死（混合判定）", () => {
    // TOP 方向：y∈{0,1} 中仅 (24,0)/(25,0)/(26,0) 地形可走，其余地形墙；
    // 这三格全被人工墙覆盖 → TOP 封死。
    const terrain = (x: number, y: number): number => {
      if (y === 0 && x >= 24 && x <= 26) return 0;
      return 1;
    };
    expect(
      computeSealedExits(
        input({
          artificialWalls: packed([[24, 0], [25, 0], [26, 0]]),
          getTerrain: terrain,
        }),
      ),
    ).toEqual([1]);
  });

  it("describeExits 只列 TOP 与 LEFT：未列出的方向（如 BOTTOM）不判定", () => {
    const walls: Array<[number, number]> = [];
    for (let x = 0; x < 50; x++) walls.push([x, 48], [x, 49]); // BOTTOM 全封但未列出
    const exits = { "1": "W7N3", "7": "W6N4" };
    expect(computeSealedExits(input({ exits, artificialWalls: packed(walls) }))).toEqual([]);
  });

  it("全部四个出口封死 → 返回全部方向（消费方据此废弃 op）", () => {
    const walls: Array<[number, number]> = [];
    for (let y = 0; y < 50; y++) walls.push([0, y], [1, y], [48, y], [49, y]);
    for (let x = 0; x < 50; x++) walls.push([x, 0], [x, 1], [x, 48], [x, 49]);
    expect(computeSealedExits(input({ artificialWalls: packed(walls) })).sort()).toEqual([1, 3, 5, 7]);
  });
});
