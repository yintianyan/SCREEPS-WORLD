import { describe, expect, it } from "vitest";
import {
  isReactionLocallyFeasible,
  selectLocallyFeasibleTarget,
  shouldAbandonReaction,
} from "../../../src/domain/industry/feasibility";

/**
 * P0-B：私服 market.orders=0 时的目标可达性判定。
 * 现场：storage 有 L/H/O/G，缺 U/X；XGH2O 链第一步 U+L 无法本地闭环。
 */
describe("工业目标本地可达性", () => {
  it("XGH2O 缺 U（无自有 U 矿）⇒ 不可本地闭环", () => {
    expect(isReactionLocallyFeasible("XGH2O", { L: 400, H: 218, O: 0, X: 600 }, [])).toBe(false);
  });

  it("XGH2O 的 U 已在库存 ⇒ 可本地闭环", () => {
    expect(isReactionLocallyFeasible("XGH2O", { U: 25, L: 400, H: 218 }, [])).toBe(true);
  });

  it("自有矿类型可替代库存（U 矿房已占领时）", () => {
    expect(isReactionLocallyFeasible("XGH2O", { L: 400, H: 218 }, ["U"])).toBe(true);
  });

  it("GH2O 有 G+H+O 库存 ⇒ 可本地闭环", () => {
    expect(isReactionLocallyFeasible("GH2O", { G: 300, H: 218, O: 285 }, [])).toBe(true);
  });

  it("降级顺序：XGH2O 不可行时落到 OH（O+H 都在手）", () => {
    expect(selectLocallyFeasibleTarget({ L: 400, H: 218, O: 285 }, [])).toBe("OH");
  });

  it("全部不可行 ⇒ undefined（交给 blocked 路径）", () => {
    expect(selectLocallyFeasibleTarget({ H: 218 }, [])).toBeUndefined();
  });
});

describe("市场不可用时的放弃判定", () => {
  it("等待超过 3 个市场周期且无市场 ⇒ 放弃", () => {
    expect(shouldAbandonReaction(1000, 1700, false, 200)).toBe(true);
  });

  it("边界：恰好 3 个周期不放弃（严格大于）", () => {
    expect(shouldAbandonReaction(1000, 1600, false, 200)).toBe(false);
  });

  it("市场可用 ⇒ 永远不放弃（买入只是延迟）", () => {
    expect(shouldAbandonReaction(1000, 1700, true, 200)).toBe(false);
  });

  it("尚无 waitingInput 起点 ⇒ 不放弃", () => {
    expect(shouldAbandonReaction(undefined, 1700, false, 200)).toBe(false);
  });
});
