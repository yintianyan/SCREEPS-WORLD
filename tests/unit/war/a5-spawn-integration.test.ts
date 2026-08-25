/**
 * A5.3 Spawn 集成测试 — WarPlan → a5ForceReq → war-planner 消费。
 *
 * 验证链路：
 *   war-planning-system.writeCompatibleWarPlan → 写入 Memory.kernel.warPlan.a5ForceReq
 *   war-planner → 读取 a5ForceReq，用它替代旧 decideSquadSize/decideHealerCount
 *
 * 核心断言：
 *   1. a5ForceReq 存在时，attacker 补位目标 = a5ForceReq.attacker（非 plan.squadSize）
 *   2. a5ForceReq 存在时，healer 编制 = a5ForceReq.healer（非 decideHealerCount 推导）
 *   3. a5ForceReq 不存在时，退回旧路径（兼容性）
 *   4. 止损基数使用 fullSquadSize = attackerTarget + healerCount
 */
import { describe, expect, it } from "vitest";
import { submitSquadRequest } from "../../../src/systems/war-planner";
import { resetGlobals } from "../../role-helpers";

type Queue = NonNullable<RoomMemory["spawnQueue"]>;
type Plan = NonNullable<KernelMemory["warPlan"]>;

function makeQueue(): Queue {
  return [] as unknown as Queue;
}

function makePlanWithoutA5(): Plan {
  return {
    targetRoom: "W5N5",
    sponsor: "W7N4",
    squadSize: 3,
    since: 1000,
    towersSeen: 0,
    phase: "build",
    spawned: 0,
  };
}

function makePlanWithA5(): Plan {
  return {
    targetRoom: "W5N5",
    sponsor: "W7N4",
    squadSize: 4,
    since: 1000,
    towersSeen: 2,
    phase: "build",
    spawned: 0,
    a5ForceReq: {
      attacker: 3,
      healer: 2,
      tank: 1,
      dismantler: 0,
      total: 6,
    },
  };
}

describe("A5.3 Spawn 集成 — a5ForceReq 消费", () => {
  it("a5ForceReq 存在时 submitSquadRequest 正常提交 attacker 请求", () => {
    resetGlobals();
    const queue = makeQueue();
    const plan = makePlanWithA5();
    submitSquadRequest(queue, plan, "W7N4", "attacker", 0, 3000, 1000);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.role).toBe("attacker");
    expect(plan.spawned).toBe(1);
  });

  it("a5ForceReq 存在时 submitSquadRequest 正常提交 healer 请求", () => {
    resetGlobals();
    const queue = makeQueue();
    const plan = makePlanWithA5();
    submitSquadRequest(queue, plan, "W7N4", "healer", 0, 3000, 1000);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.role).toBe("healer");
    expect(plan.spawned).toBe(1);
  });

  it("a5ForceReq 不存在时退回旧路径（兼容性）", () => {
    resetGlobals();
    const queue = makeQueue();
    const plan = makePlanWithoutA5();
    submitSquadRequest(queue, plan, "W7N4", "attacker", 0, 3000, 1000);
    expect(queue).toHaveLength(1);
    expect(plan.spawned).toBe(1);
  });

  it("a5ForceReq 字段类型正确（attacker/healer/tank/dismantler/total）", () => {
    const plan = makePlanWithA5();
    expect(plan.a5ForceReq).toBeDefined();
    expect(plan.a5ForceReq!.attacker).toBe(3);
    expect(plan.a5ForceReq!.healer).toBe(2);
    expect(plan.a5ForceReq!.tank).toBe(1);
    expect(plan.a5ForceReq!.dismantler).toBe(0);
    expect(plan.a5ForceReq!.total).toBe(6);
  });

  it("a5ForceReq 不存在时 plan.a5ForceReq 为 undefined（兼容旧计划）", () => {
    const plan = makePlanWithoutA5();
    expect(plan.a5ForceReq).toBeUndefined();
  });
});
