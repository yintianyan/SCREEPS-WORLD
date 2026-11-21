/**
 * EVALUATED 僵尸计划 TTL 作废（2026-11-18 立案①的状态卫生配套）。
 *
 * 起因：被执行闸（G6: CPU tier）长期挡住的计划永停 EVALUATED —— 线上 W39S56/
 * W39S57 分别滞留 40 万/13 万 tick：占 MAX_ACTIVE_PLANS(5) 名额、污染 dashboard、
 * 评估快照过时。cancelStaleEvaluatedPlans 按 createdAt 超期作废，
 * rebuildCooldown 挡「作废→下一轮立即重建」抖动。
 *
 * ⚠与 applyHysteresis 的分界：isReady 为真时 500 tick 即升 READY，所以 TTL 取
 * 50000 绝不会误杀"正在攒 ready"的计划 —— 本文件用边界用例钉住这一点。
 */
import { describe, expect, it } from "vitest";
import {
  cancelStaleEvaluatedPlans,
  isRebuildBlocked,
  DEFAULT_LIFECYCLE_OPTIONS,
} from "../../../src/domain/expansion/plan-lifecycle";
import type { ExpansionPlan, PlanStatus } from "../../../src/domain/expansion/plan";

const TTL = DEFAULT_LIFECYCLE_OPTIONS.evaluatedStaleTicks;

/** cancelStaleEvaluatedPlans 只读 status/createdAt，updatePlanStatus 只写 status/updatedAt/cancelReason。 */
function planWith(
  roomName: string,
  status: PlanStatus,
  createdAt: number,
  updatedAt = createdAt,
): ExpansionPlan {
  return {
    planId: `${roomName}#${createdAt}`,
    roomName,
    status,
    createdAt,
    updatedAt,
  } as ExpansionPlan;
}

describe("cancelStaleEvaluatedPlans", () => {
  it("EVALUATED 滞留 ≥ TTL ⇒ CANCELLED(stale-evaluated)，updatedAt 刷为作废拍", () => {
    const { plans, cancelled } = cancelStaleEvaluatedPlans(
      [planWith("W1N1", "EVALUATED", 1000)],
      1000 + TTL,
    );
    expect(cancelled).toBe(1);
    expect(plans[0]!.status).toBe("CANCELLED");
    expect(plans[0]!.cancelReason).toBe("stale-evaluated");
    expect(plans[0]!.updatedAt).toBe(1000 + TTL);
  });

  it("EVALUATED 滞留 < TTL ⇒ 原样保留（含差 1 拍的边界）", () => {
    const { plans, cancelled } = cancelStaleEvaluatedPlans(
      [planWith("W1N1", "EVALUATED", 1000)],
      1000 + TTL - 1,
    );
    expect(cancelled).toBe(0);
    expect(plans[0]!.status).toBe("EVALUATED");
    expect(plans[0]!.cancelReason).toBeUndefined();
  });

  it("只有 EVALUATED 受 TTL 约束：READY 等升档中的计划、EXECUTING 在途计划、终态计划一律不动", () => {
    const plans = [
      planWith("W1N1", "READY", 0),
      planWith("W1N2", "EXECUTING", 0),
      planWith("W1N3", "WAITING_EXECUTION", 0),
      planWith("W1N4", "CANCELLED", 0),
      planWith("W1N5", "COMPLETED", 0),
    ];
    const { plans: next, cancelled } = cancelStaleEvaluatedPlans(plans, TTL * 10);
    expect(cancelled).toBe(0);
    expect(next.map(p => p.status)).toEqual([
      "READY",
      "EXECUTING",
      "WAITING_EXECUTION",
      "CANCELLED",
      "COMPLETED",
    ]);
  });

  it("空列表 ⇒ 幂等返回，cancelled=0", () => {
    expect(cancelStaleEvaluatedPlans([], 12345)).toEqual({ plans: [], cancelled: 0 });
  });

  it("正在攒 ready 的年轻计划（readySince 已有进度 + createdAt 新）不被误杀", () => {
    // isReady 为真时 500 tick 即升 READY ⇒ "攒 ready"的计划 createdAt 必然远离
    // TTL（50000 ≫ 500），到不了作废路径。此用例钉住这条正常路径完好。
    const young = {
      ...planWith("W1N1", "EVALUATED", 9000),
      readySince: 9800,
    } as ExpansionPlan;
    const { plans, cancelled } = cancelStaleEvaluatedPlans([young], 10000);
    expect(cancelled).toBe(0);
    expect(plans[0]!.status).toBe("EVALUATED");
    expect(plans[0]!.readySince).toBe(9800);
  });

  it("作废后的计划在 rebuildCooldown 内挡同房重建，期满放行（防「作废→立即重建」抖动）", () => {
    const { plans } = cancelStaleEvaluatedPlans([planWith("W1N1", "EVALUATED", 1000)], 1000 + TTL);
    const cancelledAt = plans[0]!.updatedAt;
    expect(isRebuildBlocked(plans, "W1N1", cancelledAt + 1)).toBe(true);
    expect(
      isRebuildBlocked(plans, "W1N1", cancelledAt + DEFAULT_LIFECYCLE_OPTIONS.rebuildCooldown),
    ).toBe(false);
  });
});
