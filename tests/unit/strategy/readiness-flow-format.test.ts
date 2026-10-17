/** 决策面净流读数＝`fmtFlowTrunc`：向零截断 ⇒ 读数只会偏保守，且小额负流保住符号。
 * 立案起因（线上实证 10-17）：`gateNetFlow` 求和 = 5.0375 − 0.0811 = **4.9565**，
 * G4 判 `netFlow ≥ 5` 为红，而面板串把同一个数印成 `v=5.0`。 */
import { describe, expect, it } from "vitest";
import { fmtFlowTrunc } from "../../../src/domain/strategy/readiness";

describe("fmtFlowTrunc —— 净流读数不许跨阈值取整", () => {
  it("阈值下方 0.04 不许印成达标值；阈值上方照常", () => {
    expect(fmtFlowTrunc(4.9565)).toBe("4.9");
    expect(fmtFlowTrunc(5.0375)).toBe("5.0");
  });

  it("整值与零保持一位小数的稳定形状", () => {
    expect(fmtFlowTrunc(12)).toBe("12.0");
    expect(fmtFlowTrunc(0)).toBe("0.0");
  });

  it("小额负流必须保住符号（幼房实测 −0.0811/拍；印成 0.0 就看不出方向）", () => {
    expect(fmtFlowTrunc(-0.0811)).toBe("-0.0");
    expect(fmtFlowTrunc(-1.234)).toBe("-1.2");
  });
});
