/**
 * resolveUnderSiege — 受袭姿态判定测试（R3 战时闭环 / 帝国姿态 → 防御投资升档）。
 *
 * 覆盖：
 *   - 本房真实受袭记忆（lastHostileAt 距今 < siegeMemoryTicks）恒触发升档，与姿态无关
 *   - 无局部威胁 + war 姿态 → 升档（全局备战）
 *   - 无局部威胁 + develop/expand/fortify/undefined → 不升档（fortify 不全局烧墙血）
 *   - 局部威胁已过期 + war → 仍升档；+ fortify → 不升档
 */
import { describe, expect, it } from "vitest";
import { resolveUnderSiege } from "../../../src/domain/defense/fortification";

const SIEGE_TICKS = 10000;
const TICK = 10000;

describe("resolveUnderSiege", () => {
  it("本房真实受袭（lastHostileAt 距今 < 窗口）→ 恒升档，与姿态无关", () => {
    expect(resolveUnderSiege("develop", 9990, TICK, SIEGE_TICKS)).toBe(true);
    expect(resolveUnderSiege("fortify", 9900, TICK, SIEGE_TICKS)).toBe(true);
    expect(resolveUnderSiege("war", 9000, TICK, SIEGE_TICKS)).toBe(true);
    expect(resolveUnderSiege(undefined, 1, TICK, SIEGE_TICKS)).toBe(true);
  });

  it("无局部威胁 + war 姿态 → 升档（全局备战）", () => {
    expect(resolveUnderSiege("war", undefined, TICK, SIEGE_TICKS)).toBe(true);
    expect(resolveUnderSiege("war", 0, TICK, SIEGE_TICKS)).toBe(true);
  });

  it("无局部威胁 + develop/expand/fortify/undefined → 不升档", () => {
    expect(resolveUnderSiege("develop", undefined, TICK, SIEGE_TICKS)).toBe(false);
    expect(resolveUnderSiege("expand", undefined, TICK, SIEGE_TICKS)).toBe(false);
    expect(resolveUnderSiege("fortify", undefined, TICK, SIEGE_TICKS)).toBe(false);
    expect(resolveUnderSiege(undefined, undefined, TICK, SIEGE_TICKS)).toBe(false);
  });

  it("局部威胁已过期（距今 ≥ 窗口）+ war → 仍升档；fortify → 不升档", () => {
    expect(resolveUnderSiege("war", 0, TICK, SIEGE_TICKS)).toBe(true);
    expect(resolveUnderSiege("fortify", 0, TICK, SIEGE_TICKS)).toBe(false);
  });
});