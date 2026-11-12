import { beforeEach, describe, expect, it } from "vitest";
import { labSystem } from "../../../src/systems/room/lab-system";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockSnapshot, mockStructure, resetGlobals } from "../../support/factories";

/**
 * P0-A：lab-system 休眠期必须持续发布「预装料」需求表。
 *
 * 线上 W8N3 的形状：反应缺 U 进入 waitingInput → idleUntil 分支直接 continue，
 * labDemands 随 TTL(20) 过期 → supplyLabs 无表可执行 → terminal 里的 O/X/H
 * 一直进不了 lab；缺料又被当成「无活可干」再次休眠 ⇒ 自锁。
 */
describe("P0-A lab-system 休眠期预装料需求表", () => {
  beforeEach(() => {
    resetGlobals();
    (globalThis as any).Memory.rooms.W7N4 = {};
    (globalThis as any).Game.rooms.W7N4 = {};
    globalCache().labDemands = undefined;
  });

  function runLabSystem(tick: number, industry: Record<string, unknown>): void {
    (globalThis as any).Memory.rooms.W7N4.industry = industry;
    const labs = [1, 2, 3].map(i => mockStructure("lab", { id: `lab${i}` }));
    const terminal = mockStructure("terminal", { id: "term1", energy: 10000, capacity: 300000 });
    const snap = mockSnapshot({ rcl: 7, labs: labs as never, terminal: terminal as never });
    labSystem.run({ tick, snapshots: () => [snap] } as never);
  }

  const reactionPlan = {
    target: "XGH2O",
    targetAmount: 300,
    steps: [{ input1: "U", input2: "L", output: "UL", amount: 300 }],
  };

  it("idle 分支有 reactionPlan ⇒ 每 tick 发布预装料 loads（空 lab 也能搬料）", () => {
    runLabSystem(1000, {
      idleUntil: 2000,
      reactionTarget: "XGH2O",
      reactionAmount: 300,
      reactionPlan,
    });

    const table = globalCache().labDemands?.byRoom.W7N4;
    expect(table).toBeDefined();
    expect(table!.loads.length).toBeGreaterThan(0);
    // 第一步 input1/input2 都应被预装（各 300，lab 全空）
    expect(table!.loads.some(l => l.resource === "U" && l.amount === 300)).toBe(true);
    expect(table!.loads.some(l => l.resource === "L" && l.amount === 300)).toBe(true);
  });

  it("idle 分支无 reactionPlan ⇒ 不发布空表（不制造幽灵搬运需求）", () => {
    runLabSystem(1000, { idleUntil: 2000 });
    expect(globalCache().labDemands?.byRoom.W7N4).toBeUndefined();
  });

  it("非 idle 分支且反应缺料 ⇒ 进入休眠前不丢已有表（表由后续 tick 补齐）", () => {
    // tick ≥ idleUntil = 500 → 走正常分支；缺料 → 设新 idleUntil 并 continue。
    // 本用例只断言不崩、不产生错误的预装表（预装表由下一 tick 的 idle 分支发布）。
    runLabSystem(1000, {
      idleUntil: 500,
      reactionTarget: "XGH2O",
      reactionAmount: 300,
      reactionPlan,
    });
    expect(globalCache().labDemands?.byRoom.W7N4).toBeUndefined();
  });
});
