/**
 * buildOccupiedPositionSet 占用集完整性测试。
 *
 * 回归：此前占用集遗漏 terminal/lab/factory/extractor/observer/powerSpawn，
 * 导致约束放置器把新结构（spawn#2/tower#3/factory）选在这些已占格上 →
 * createConstructionSite 返 ERR_INVALID_TARGET → 反复失败进黑名单 →
 * 主房 RCL6-8 结构永久建不齐（线上 W7N4 实证：spawn 选在 terminal 格、
 * tower/factory 选在 lab 格）。占用集必须涵盖所有会阻挡放置的结构。
 */
import { describe, expect, it } from "vitest";
import { buildOccupiedPositionSet } from "../../../src/domain/layout/validation";
import { packPos } from "../../../src/domain/layout/types";
import { mockSnapshot, mockStructure } from "../../role-helpers";

/** 造一个落在指定坐标的结构。 */
function at(type: string, x: number, y: number) {
  const s = mockStructure(type);
  s.pos.x = x;
  s.pos.y = y;
  return s;
}

describe("buildOccupiedPositionSet — 占用集涵盖全部阻挡型结构", () => {
  it("terminal/lab/factory/extractor/observer/powerSpawn 的格子都算占用（防跨类型撞位）", () => {
    const snap = mockSnapshot({
      sources: [],
      controller: undefined,
      terminal: at("terminal", 35, 27),
      labs: [at("lab", 37, 25)],
      factory: at("factory", 38, 26),
      extractor: at("extractor", 40, 40),
      observer: at("observer", 41, 41),
      powerSpawn: at("powerSpawn", 42, 42),
    });

    const set = buildOccupiedPositionSet(snap);

    expect(set.has(packPos(35, 27))).toBe(true); // terminal
    expect(set.has(packPos(37, 25))).toBe(true); // lab
    expect(set.has(packPos(38, 26))).toBe(true); // factory
    expect(set.has(packPos(40, 40))).toBe(true); // extractor
    expect(set.has(packPos(41, 41))).toBe(true); // observer
    expect(set.has(packPos(42, 42))).toBe(true); // powerSpawn
  });

  it("仍涵盖既有类型 spawn/extension/tower/storage/link/container", () => {
    const snap = mockSnapshot({
      sources: [],
      controller: undefined,
      spawns: [at("spawn", 10, 10)],
      extensions: [at("extension", 11, 11)],
      towers: [at("tower", 12, 12)],
      storage: at("storage", 13, 13),
      links: [at("link", 14, 14)],
      containers: [at("container", 15, 15)],
    });

    const set = buildOccupiedPositionSet(snap);

    expect(set.has(packPos(10, 10))).toBe(true);
    expect(set.has(packPos(11, 11))).toBe(true);
    expect(set.has(packPos(12, 12))).toBe(true);
    expect(set.has(packPos(13, 13))).toBe(true);
    expect(set.has(packPos(14, 14))).toBe(true);
    expect(set.has(packPos(15, 15))).toBe(true);
  });
});
