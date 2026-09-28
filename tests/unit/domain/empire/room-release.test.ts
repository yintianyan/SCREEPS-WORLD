/**
 * 释放阶段判据 — 排空/断手/收场的先后顺序必须是单点可证的。
 * 立案依据：unclaim 之后该房从 ctx.snapshots() 消失，而 snapshots 是自有房的唯一遍历
 * 口径；先 unclaim 后排空 = 留下一间在所有全局账本里仍是自有房的幽灵房。
 */
import { describe, expect, it } from "vitest";
import { CONFIG } from "../../../../src/config";
import { planReleaseStep, type ReleaseStepInput } from "../../../../src/domain/empire/room-release";

function input(overrides: Partial<ReleaseStepInput> = {}): ReleaseStepInput {
  return {
    stillOwned: true,
    activeOps: 0,
    creepsHomedHere: 0,
    pendingRequests: 0,
    drainingFor: 10,
    unclaimAttempts: 0,
    ...overrides,
  };
}

describe("room-release — planReleaseStep", () => {
  it("排空完成（op 弃尽 + 无本房 creep + 队列空）才允许 unclaim", () => {
    expect(planReleaseStep(input()).action).toBe("unclaim");
  });

  it("仍有在途 op 时只排空，不 unclaim", () => {
    expect(planReleaseStep(input({ activeOps: 2 })).action).toBe("keep-draining");
  });

  it("仍有 home 指向本房的 creep 时只排空（回收通道还在工作，房还在手里）", () => {
    expect(planReleaseStep(input({ creepsHomedHere: 3 })).action).toBe("keep-draining");
  });

  it("孵化队列非空时只排空（下一拍 spawn-manager 会清空，不孵进要放弃的房）", () => {
    expect(planReleaseStep(input({ pendingRequests: 1 })).action).toBe("keep-draining");
  });

  it("房已不在手里 → finalize，且标记为非自愿（被抢 / unclaim 已成交两条出口同构）", () => {
    const step = planReleaseStep(input({ stillOwned: false, activeOps: 5, creepsHomedHere: 9 }));
    expect(step.action).toBe("finalize");
    if (step.action === "finalize") expect(step.involuntary).toBe(true);
  });

  it("「不在手里」优先于一切排空判据 —— 不给别人的房继续排空", () => {
    expect(planReleaseStep(input({ stillOwned: false, pendingRequests: 7 })).action).toBe(
      "finalize",
    );
  });

  it("排空超截止时刻 → 强行 unclaim（残余 creep 交事后清扫，比让整间房挂着便宜）", () => {
    const step = planReleaseStep({
      ...input({ creepsHomedHere: 4, activeOps: 1 }),
      drainingFor: CONFIG.territory.drainDeadlineTicks,
    });
    expect(step.action).toBe("unclaim");
  });

  it("unclaim 反复未成交 → abort，不再烧轮次", () => {
    const step = planReleaseStep({
      ...input(),
      unclaimAttempts: CONFIG.territory.maxUnclaimAttempts,
    });
    expect(step.action).toBe("abort");
  });

  it("未到截止时刻的最后一拍仍给排空留机会", () => {
    expect(
      planReleaseStep({
        ...input({ creepsHomedHere: 1 }),
        drainingFor: CONFIG.territory.drainDeadlineTicks - 1,
      }).action,
    ).toBe("keep-draining");
  });
});
