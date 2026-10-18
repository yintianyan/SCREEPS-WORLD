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

/**
 * 终局步的完成判据 —— 2026-10-18 由「G 威慑抢占经济目标」用例跑出来的量纲错配。
 *
 * `step.amount` 是 planReactionChain 按 `deficit = need − have` 算出的**增量**，
 * 而旧判据拿它跟"在手总量"比：G 目标 5,000、在手 4,500 ⇒ 增量 500，`4,500 ≥ 500`
 * 成立 ⇒ 当场宣布 complete ⇒ lab-system 清掉 reactionTarget ⇒ 差的 500 单位永远补不上。
 * 本轮只收窄终局那一步（用 plan.targetAmount）；中间产物仍按 step.amount 比 —— 改成
 * 绝对口径要动 Memory 里已冻结的计划，属迁移风险，登记为已知窄化。
 */
describe("evaluateReactionPlan — 终局步按目标总量判完成，不按增量", () => {
  const G_PLAN: ReactionPlan = {
    steps: [{ input1: "ZK", input2: "UL", output: "G", amount: 500 }],
    target: "G",
    targetAmount: 5000,
  };

  it("在手量 ≥ 增量但 < 目标 ⇒ 仍未完成（旧口径在这里当场 complete 并清目标）", () => {
    const state = evaluateReactionPlan(G_PLAN, { G: 4500, ZK: 1000, UL: 1000 });
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.step.output).toBe("G");
  });

  it("在手量达目标总量 ⇒ 才是 complete", () => {
    expect(evaluateReactionPlan(G_PLAN, { G: 5000, ZK: 1000, UL: 1000 }).status).toBe("complete");
  });

  it("在手量超过目标 ⇒ complete（不因增量小而反向卡住）", () => {
    expect(evaluateReactionPlan(G_PLAN, { G: 9000, ZK: 1000, UL: 1000 }).status).toBe("complete");
  });

  it("中间产物那一步口径不变：在手 ≥ 增量即跳过，终局步仍按目标量判", () => {
    const multi: ReactionPlan = {
      steps: [
        { input1: "GH", input2: "OH", output: "GH2O", amount: 130 },
        { input1: "X", input2: "GH2O", output: "XGH2O", amount: 290 },
      ],
      target: "XGH2O",
      targetAmount: 300,
    };
    // GH2O 在手 200 ≥ 中间步增量 130 ⇒ 跳过（旧口径同）；终局步 XGH2O 在手 0 < 目标 300
    // ⇒ 停在终局步，且原料 X/GH2O 都在 ⇒ ready。
    const state = evaluateReactionPlan(multi, { GH2O: 200, X: 600 });
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.step.output).toBe("XGH2O");
  });
});
