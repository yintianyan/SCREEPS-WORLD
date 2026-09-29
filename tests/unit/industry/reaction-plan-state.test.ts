/**
 * 反应计划的三态判定 —— 把"链已完成"与"链还缺料"从一个 null 里拆出来。
 * 立案理由（线上实证 09:0x）：`lab-system` 把 `getNextExecutableStep()===null` 一律当成完成并
 * 清掉 reactionTarget/amount/plan，于是"还在等买回来的 GH2O" 也被清 —— 计划没了，
 * 采购需求的发布判据（`if (reactionPlan)`）就不成立，反应永远凑不满下一批。
 * 这不是理论风险：_terminal 里 X/GH2O 早已到位、lab 也确实第一次产出了 XGH2O，
 * 说明缺的正是"等料期间不要自废计划"这一条。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateReactionPlan,
  getNextExecutableStep,
} from "../../../src/domain/industry/reactions";
import type { ReactionPlan } from "../../../src/domain/industry/types";

const plan = (steps: ReactionPlan["steps"]): ReactionPlan => ({
  steps,
  target: "XGH2O",
  targetAmount: 300,
});

const STEP = { input1: "X", input2: "GH2O", output: "XGH2O", amount: 300 } as const;

describe("evaluateReactionPlan — 三态而非一 null", () => {
  it("原料齐、产物未满 ⇒ ready，并交出这一步", () => {
    const state = evaluateReactionPlan(plan([STEP]), { X: 600, GH2O: 300, XGH2O: 5 });
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.step.output).toBe("XGH2O");
  });

  it("缺其中一种原料 ⇒ waitingInput（旧口径在这里与「完成」共用 null）", () => {
    const state = evaluateReactionPlan(plan([STEP]), { X: 600, GH2O: 2, XGH2O: 5 });
    expect(state.status).toBe("waitingInput");
    // 关键不变量：它与"完成"给出的两个可执行函数读数**必须**可区分
    expect(getNextExecutableStep(plan([STEP]), { X: 600, GH2O: 2, XGH2O: 5 })).toBeNull();
  });

  it("产物已达批量目标 ⇒ complete —— 这才是可以清计划的唯一情形", () => {
    const state = evaluateReactionPlan(plan([STEP]), { X: 600, GH2O: 300, XGH2O: 300 });
    expect(state.status).toBe("complete");
  });

  it("多步链：上游未满足 ⇒ 对下游是 waitingInput，而不是「这轮做完了」", () => {
    const multi = plan([
      { input1: "GH", input2: "OH", output: "GH2O", amount: 300 },
      { input1: "X", input2: "GH2O", output: "XGH2O", amount: 300 },
    ]);
    // GH2O 一点没有 ⇒ 第一步缺原料（GH/OH 也无）⇒ 整链在等，不是完成
    expect(evaluateReactionPlan(multi, { X: 600 }).status).toBe("waitingInput");
    // 第一步做完、第二步还没做 ⇒ ready（做第二步）
    expect(evaluateReactionPlan(multi, { X: 600, GH2O: 300 }).status).toBe("ready");
  });

  it("空步骤表 ⇒ complete（没有计划要做的事，本来就该重新评估目标）", () => {
    expect(evaluateReactionPlan(plan([]), {}).status).toBe("complete");
  });
});
