/**
 * war-planner spawned 计数口径回归测试（churn 虚增修复）。
 *
 * 背景：spawned 原在「提交请求」时无条件 +1。sponsor 能量紧张时请求反复
 * TTL 过期 → 重提交，每次 churn 都虚增消耗战基数（spawned），提前误触
 * attrition 收摊 + standDown 休战——仗还没打就自行撤军。
 * 修复口径：首次提交计数；前任已实际孵化（markSquadMaterialized 置位）的
 * 同键重提交按替换计数（计数后旗标归位，替换者自身需重新兑现）；纯 churn
 * 不计数。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { markSquadMaterialized, submitSquadRequest } from "../../../src/systems/war-planner";
import { resetGlobals } from "../../role-helpers";

type Queue = NonNullable<RoomMemory["spawnQueue"]>;
type Plan = NonNullable<KernelMemory["warPlan"]>;

function makeQueue(): Queue {
  return [] as unknown as Queue;
}

function makePlan(): Plan {
  return {
    targetRoom: "W5N5",
    sponsor: "W7N4",
    squadSize: 2,
    since: 1000,
    towersSeen: 0,
    phase: "build",
    spawned: 0,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("war-planner spawned 计数 — churn 不虚增，替换才计数", () => {
  it("首次提交计入", () => {
    const queue = makeQueue();
    const plan = makePlan();
    submitSquadRequest(queue, plan, "W7N4", "attacker", 0, 3000, 1000);
    expect(plan.spawned).toBe(1);
    expect(queue).toHaveLength(1);
  });

  it("同键 TTL 过期后重提交（纯 churn）不重复计数", () => {
    const plan = makePlan();
    const q1 = makeQueue();
    submitSquadRequest(q1, plan, "W7N4", "attacker", 0, 3000, 1000);
    expect(plan.spawned).toBe(1);
    // 模拟 spawn-manager cleanQueue 清掉过期请求
    q1.length = 0;
    submitSquadRequest(q1, plan, "W7N4", "attacker", 0, 3000, 1100);
    expect(plan.spawned).toBe(1); // 修复前为 2
    expect(q1).toHaveLength(1);
  });

  it("前任已实际孵化 → 同键重提交按替换计数", () => {
    const plan = makePlan();
    const q1 = makeQueue();
    submitSquadRequest(q1, plan, "W7N4", "attacker", 0, 3000, 1000);
    // 孵化兑现：编队出现该槽位 creep（含 spawnIndex）
    (globalThis as { Game: { creeps: Record<string, unknown> } }).Game.creeps["atk-0"] = {
      memory: { role: "attacker", spawnIndex: 0 },
    };
    markSquadMaterialized(plan, [{ name: "atk-0", role: "attacker" }], "W7N4");
    // 战损：creep 消失，队列请求已随孵化消费
    q1.length = 0;
    submitSquadRequest(q1, plan, "W7N4", "attacker", 0, 3000, 1300);
    expect(plan.spawned).toBe(2);
  });

  it("多轮 churn 稳定不涨；替换后再 churn 也不涨（旗标归位）", () => {
    const plan = makePlan();
    const q = makeQueue();
    submitSquadRequest(q, plan, "W7N4", "attacker", 0, 3000, 1000);
    q.length = 0;
    submitSquadRequest(q, plan, "W7N4", "attacker", 0, 3000, 1100);
    q.length = 0;
    submitSquadRequest(q, plan, "W7N4", "attacker", 0, 3000, 1200);
    expect(plan.spawned).toBe(1);
    // 兑现后替换一次 → 2；替换请求自身 churn（未孵化）→ 不涨
    (globalThis as { Game: { creeps: Record<string, unknown> } }).Game.creeps["atk-0"] = {
      memory: { role: "attacker", spawnIndex: 0 },
    };
    markSquadMaterialized(plan, [{ name: "atk-0", role: "attacker" }], "W7N4");
    q.length = 0;
    submitSquadRequest(q, plan, "W7N4", "attacker", 0, 3000, 1300);
    expect(plan.spawned).toBe(2);
    q.length = 0;
    submitSquadRequest(q, plan, "W7N4", "attacker", 0, 3000, 1400);
    expect(plan.spawned).toBe(2);
  });

  it("healer 同口径", () => {
    const plan = makePlan();
    const q = makeQueue();
    submitSquadRequest(q, plan, "W7N4", "healer", 0, 3000, 1000);
    expect(plan.spawned).toBe(1);
    q.length = 0;
    submitSquadRequest(q, plan, "W7N4", "healer", 0, 3000, 1100);
    expect(plan.spawned).toBe(1);
  });

  it("计划内不存在于 log 的存量编队成员不误标（markSquadMaterialized 只更新已存在 key）", () => {
    const plan = makePlan();
    // 未提交任何请求 → spawnedKeys 未建
    (globalThis as { Game: { creeps: Record<string, unknown> } }).Game.creeps["atk-9"] = {
      memory: { role: "attacker", spawnIndex: 9 },
    };
    expect(() =>
      markSquadMaterialized(plan, [{ name: "atk-9", role: "attacker" }], "W7N4"),
    ).not.toThrow();
    expect(plan.spawnedKeys).toBeUndefined();
  });
});
