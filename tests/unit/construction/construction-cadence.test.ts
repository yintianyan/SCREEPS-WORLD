/** R603：建造管理器常态降频判据（紧急豁免必须每拍跑）。 */
import { describe, expect, it } from "vitest";
import { shouldRunConstruction } from "../../../src/domain/construction/cadence";

describe("shouldRunConstruction — 常态降频 / 紧急豁免", () => {
  it("紧急重建：无论间隔与上次运行，恒为 true", () => {
    expect(shouldRunConstruction(true, 1000, 999, 3)).toBe(true);
    expect(shouldRunConstruction(true, 1000, 1000, 30)).toBe(true);
  });

  it("常态：首轮（无上次记录）立即跑", () => {
    expect(shouldRunConstruction(false, 1000, undefined, 3)).toBe(true);
  });

  it("常态：间隔未满跳过、满了放行", () => {
    expect(shouldRunConstruction(false, 1001, 1000, 3)).toBe(false);
    expect(shouldRunConstruction(false, 1002, 1000, 3)).toBe(false);
    expect(shouldRunConstruction(false, 1003, 1000, 3)).toBe(true);
  });

  it("间隔非法（0/NaN）时按 1 处理：同拍不重跑、下一拍放行", () => {
    expect(shouldRunConstruction(false, 1000, 1000, 0)).toBe(false);
    expect(shouldRunConstruction(false, 1001, 1000, 0)).toBe(true);
    expect(shouldRunConstruction(false, 1000, 1000, Number.NaN)).toBe(false);
    expect(shouldRunConstruction(false, 1001, 1000, Number.NaN)).toBe(true);
  });
});
