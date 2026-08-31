/** buildOccupiedPositionSet 占用集完整性测试。 */
import { describe, expect, it } from "vitest";
import { buildOccupiedPositionSet } from "../../../src/domain/layout/validation";
import { packPos } from "../../../src/domain/layout/types";
import { mockSnapshot, mockStructure } from "../../support/factories";

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
      nuker: at("nuker", 43, 43),
      roads: [at("road", 44, 44)],
    });

    const set = buildOccupiedPositionSet(snap);

    expect(set.has(packPos(35, 27))).toBe(true); // terminal
    expect(set.has(packPos(37, 25))).toBe(true); // lab
    expect(set.has(packPos(38, 26))).toBe(true); // factory
    expect(set.has(packPos(40, 40))).toBe(true); // extractor
    expect(set.has(packPos(41, 41))).toBe(true); // observer
    expect(set.has(packPos(42, 42))).toBe(true); // powerSpawn
    expect(set.has(packPos(43, 43))).toBe(true); // nuker
    // 道路是结构：可通行但不可在其上建造 — 必须计入占用集（防放置撞路）。
    expect(set.has(packPos(44, 44))).toBe(true); // road
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
