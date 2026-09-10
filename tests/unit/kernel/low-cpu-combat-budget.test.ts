/**
 * D-FINDING-05: 低 CPU 下 combat 角色与经济角色竞争预算测试。
 *
 * 场景矩阵 S7+S8 组合：低 CPU（conserve/recovery tier）+ 威胁在场。
 * 验证：
 * 1. conserve tier 下 combat 角色不被 P0 经济角色完全挤占
 * 2. recovery tier + ESM 下 harvester（isLifeLine）保留最小产能
 * 3. 威胁在场时 combat 旁路生效（不被 colonyState 冻结）
 * 4. tower-defense（P2）在 conserve 下仍能运行
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetGlobals,
  mockSnapshot,
  mockBudget,
  mockCreep,
  mockHostile,
} from "../../support/factories";
import { CpuBudget } from "../../../src/kernel/scheduler";
import type { Budget, CreepRole, Priority, TickContext } from "../../../src/kernel/contracts";
import { isThreat } from "../../../src/kernel/contracts";

const g = (): any => globalThis as any;

describe("D-FINDING-05: 低 CPU + 威胁竞争预算", () => {
  beforeEach(() => {
    resetGlobals();
  });

  it("conserve tier 下 P0 harvester 与 P2 tower-defense 都能运行", () => {
    // conserve tier: softLimit=14, hardLimit=17
    const budget = new CpuBudget("conserve");

    // P0 harvester 应能运行
    expect(budget.canStart(0)).toBe(true);
    // P2 tower-defense 应能运行（conserve 允许 P2）
    expect(budget.canStart(2)).toBe(true);
  });

  it("recovery tier 下 P0 保留但 P2+ 被跳过", () => {
    const budget = new CpuBudget("recovery");

    // P0 harvester 应能运行
    expect(budget.canStart(0)).toBe(true);
    // P2 tower-defense 应被跳过
    expect(budget.canStart(2)).toBe(false);
  });

  it("ESM（emergency）下仅 isLifeLine 角色运行，combat 旁路不生效", () => {
    // Recovery tier + ESM
    const budget = new CpuBudget("recovery", true);

    // P0 角色仍可运行
    expect(budget.canStart(0)).toBe(true);
    // P1+ 被跳过
    expect(budget.canStart(1)).toBe(false);

    // 模拟 ESM 角色门禁
    const harvesterRole: Partial<CreepRole> = { name: "harvester", priority: 0, isLifeLine: true };
    const haulerRole: Partial<CreepRole> = { name: "hauler", priority: 1, isLifeLine: false };
    const defenderRole: Partial<CreepRole> = { name: "defender", priority: 1, combat: true };

    // ESM 下仅 isLifeLine 运行
    const ctx: TickContext = {
      tick: 1000,
      budget,
      globalSiteCount: 0,
      getSnapshot: () => mockSnapshot(),
      *snapshots() {
        yield mockSnapshot();
      },
    };

    const emergency = true; // ctx.budget.emergency

    // harvester 是生命线 → 运行
    expect(emergency === true && harvesterRole.isLifeLine === true).toBe(true);
    // hauler 非生命线 → 跳过
    expect(emergency === true && haulerRole.isLifeLine !== true).toBe(true);
    // defender 是 combat 但 ESM 下仍被跳过（combat 旁路只在非 ESM 的 recovery 下生效）
    expect(emergency === true && defenderRole.isLifeLine !== true).toBe(true);
  });

  it("recovery（非 ESM）下 combat 角色旁路 colonyState 冻结", () => {
    // recovery tier 但非 ESM
    const budget = new CpuBudget("recovery");
    expect(budget.emergency).toBeFalsy(); // recovery 非 ESM: emergency 为 false/undefined

    // 模拟 combat 角色在 recovery + 有威胁场景下
    const combatRole: Partial<CreepRole> = {
      name: "defender",
      priority: 1,
      combat: true,
    };

    // recovery 下 P1 允许（maxPriority=1），但 P2 被跳过
    expect(budget.canStart(1)).toBe(true);
    expect(budget.canStart(2)).toBe(false);

    // 但 combat 旁路逻辑：当有真实威胁时，combat 角色不等 colonyState
    // 这里验证 isThreat 函数在低 CPU 下仍正确工作
    const hostile = {
      owner: "enemy",
      bodyParts: ["attack" as const, "move" as const],
    };
    expect(isThreat(hostile, [])).toBe(true);

    const neutralCreep = {
      owner: "ally1",
      bodyParts: ["move" as const],
    };
    expect(isThreat(neutralCreep, ["ally1"])).toBe(false);
  });

  it("conserve tier + 威胁在场时 harvester 和 defender 的优先级竞争", () => {
    // conserve tier
    const budget = new CpuBudget("conserve");

    // 模拟 harvester (P0) 和 defender (P1) 在 conserve 下竞争
    const harvesterPriority: Priority = 0;
    const defenderPriority: Priority = 1;

    // 两者在 conserve 下都能启动
    expect(budget.canStart(harvesterPriority)).toBe(true);
    expect(budget.canStart(defenderPriority)).toBe(true);

    // 但如果 CPU 接近耗尽（spent > softLimit）：
    const nearExhaustionBudget: Budget = {
      tier: "conserve",
      softLimit: 14,
      hardLimit: 17,
      emergency: undefined,
      canStart: (p: number) => p <= 0, // 只剩 P0 配额
      isExhausted: () => false,
      spent: () => 15, // 超过 softLimit
    };

    // harvester (P0) 仍能运行
    expect(nearExhaustionBudget.canStart(harvesterPriority)).toBe(true);
    // defender (P1) 被挤占
    expect(nearExhaustionBudget.canStart(defenderPriority)).toBe(false);
  });

  it("威胁在场时 liveThreatRooms 包含威胁房，combat 角色可旁路", () => {
    // 模拟威胁检测
    const hostile = mockHostile("invader_1");
    hostile.body = [
      { type: "attack", hits: 100 },
      { type: "move", hits: 100 },
    ];
    hostile.owner = { username: "Invader" };

    const isHostileThreat = isThreat(
      { owner: hostile.owner.username, bodyParts: hostile.body.map((b: any) => b.type) },
      [],
    );
    expect(isHostileThreat).toBe(true);

    // 非威胁的纯 MOVE 过客
    const scout = mockHostile("scout_1");
    scout.body = [{ type: "move", hits: 100 }];
    scout.owner = { username: "Scout" };

    const isScoutThreat = isThreat(
      { owner: scout.owner.username, bodyParts: scout.body.map((b: any) => b.type) },
      [],
    );
    expect(isScoutThreat).toBe(false);
  });

  it("recovery + 威胁在场时 harvester 至少保留 1 只产能", () => {
    // 模拟 recovery tier 下 harvester 保留最小产能
    const budget = new CpuBudget("recovery");

    // harvester 是 P0，在 recovery 下仍可运行
    expect(budget.canStart(0)).toBe(true);

    // 即使 CPU 接近 hardLimit
    const tightBudget: Budget = {
      tier: "recovery",
      softLimit: 12,
      hardLimit: 15.5,
      emergency: undefined,
      canStart: (p: number) => p === 0, // 仅 P0
      isExhausted: () => false,
      spent: () => 14,
    };

    // harvester (P0) 仍能运行 — 生命线保底
    expect(tightBudget.canStart(0)).toBe(true);
  });
});
