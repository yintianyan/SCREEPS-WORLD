import { describe, expect, it } from "vitest";
import { selectReactionTrio, type LabPos } from "../../../src/domain/industry/reactions";

function lab(id: string, x: number, y: number): LabPos {
  return { id, x, y };
}

describe("Lab 相邻校验 — selectReactionTrio（P2-8）", () => {
  it("lab 数量不足 3 时返回 undefined", () => {
    expect(selectReactionTrio([])).toBeUndefined();
    expect(selectReactionTrio([lab("a", 10, 10)])).toBeUndefined();
    expect(selectReactionTrio([lab("a", 10, 10), lab("b", 11, 10)])).toBeUndefined();
  });

  it("紧凑布局（三 lab 互相 range≤2）正确选出三元组", () => {
    const labs = [lab("out", 10, 10), lab("in1", 11, 10), lab("in2", 10, 11)];
    const trio = selectReactionTrio(labs);
    expect(trio).toBeDefined();
    // output 旁两个 input 都在 range≤2 内。
    expect(new Set([trio!.output, trio!.input1, trio!.input2])).toEqual(
      new Set(["out", "in1", "in2"]),
    );
  });

  it("分散布局（任意两 lab 间距 >2）选不出三元组，返回 undefined", () => {
    const labs = [lab("a", 5, 5), lab("b", 20, 20), lab("c", 40, 40)];
    expect(selectReactionTrio(labs)).toBeUndefined();
  });

  it("range 边界：恰好 range=2 视为相邻", () => {
    const labs = [lab("out", 10, 10), lab("in1", 12, 10), lab("in2", 10, 12)];
    const trio = selectReactionTrio(labs);
    expect(trio).toBeDefined();
  });

  it("range 边界：range=3 不算相邻", () => {
    // out 与两个 input 均相距 3 → 无合法 output。
    const labs = [lab("out", 10, 10), lab("in1", 13, 10), lab("in2", 10, 13)];
    expect(selectReactionTrio(labs)).toBeUndefined();
  });

  it("部分相邻：只有一个 lab 能当 output 凑齐两个相邻 input", () => {
    // hub 在中央，与 a、b 均 range≤2；a、b 彼此相距 >2。
    const labs = [lab("a", 8, 10), lab("hub", 10, 10), lab("b", 12, 10)];
    const trio = selectReactionTrio(labs);
    expect(trio).toBeDefined();
    // 唯一能凑齐两个相邻 input 的 output 是 hub。
    expect(trio!.output).toBe("hub");
    expect(new Set([trio!.input1, trio!.input2])).toEqual(new Set(["a", "b"]));
  });
});
