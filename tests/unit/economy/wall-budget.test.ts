/** 和平期修墙速率预算（2026-11-21 批次 4，立案 #5）— 纯函数 + 接线行为测试。
 *
 * 病灶：fortifyActive 是开关闸非预算闸 —— 开启后 RCL8 10M hits 墙目标无速率上限，
 * W37S58 实测灌墙 6.3 e/t ≈ 全房净流 5.3 e/t。修法：每房能量累积池（进水 rate 2、
 * cap 10K），塔（整笔 10/笔）与 builder（按实际 intent 能量）和平期共用扣账；
 * liveThreat / defense / war 豁免；应急路径（新生 rampart 急救 / critical repair /
 * 塔威胁路径）本就不走本预算。
 */
import { describe, expect, it } from "vitest";
import {
  accrueWallBudget,
  isWallBudgetExempt,
  isWallBudgetTracked,
  spendWallBudget,
  WALL_BUDGET_CAP,
  WALL_BUDGET_RATE,
} from "../../../src/domain/economy/wall-budget";

describe("wallBudget 纯函数", () => {
  it("进水速率与上限：未立账从 0 起，rate 累加，cap 封顶", () => {
    expect(accrueWallBudget(undefined, 1)).toBe(WALL_BUDGET_RATE);
    expect(accrueWallBudget(0, 1)).toBe(WALL_BUDGET_RATE);
    expect(accrueWallBudget(WALL_BUDGET_CAP - 1, 1)).toBe(WALL_BUDGET_CAP);
    expect(accrueWallBudget(WALL_BUDGET_CAP, 1)).toBe(WALL_BUDGET_CAP); // 满池不溢出
    expect(accrueWallBudget(0, 3)).toBe(WALL_BUDGET_RATE * 3); // 节律对齐用
  });

  it("扣账：granted = min(want, 水位)，池不允许透支", () => {
    expect(spendWallBudget(100, 30)).toEqual({ granted: 30, pool: 70 });
    expect(spendWallBudget(5, 30)).toEqual({ granted: 5, pool: 0 });
    expect(spendWallBudget(undefined, 10)).toEqual({ granted: 0, pool: 0 });
  });

  it("立账判别：undefined = 无预算区（闸开、不扣账），0 = 立账且耗尽（闸关）", () => {
    expect(isWallBudgetTracked(undefined, "W1N1")).toBe(false);
    expect(isWallBudgetTracked({}, "W1N1")).toBe(false);
    expect(isWallBudgetTracked({ W1N1: 0 }, "W1N1")).toBe(true);
    expect(isWallBudgetTracked({ W1N1: 5000 }, "W1N1")).toBe(true);
  });

  it("豁免矩阵：liveThreat / defense / war 任一即豁免；受袭记忆窗不豁免", () => {
    // 备战三通道
    expect(isWallBudgetExempt(true, "normal", "develop")).toBe(true);
    expect(isWallBudgetExempt(false, "defense", "develop")).toBe(true);
    expect(isWallBudgetExempt(false, "normal", "war")).toBe(true);
    // 和平：正常受闸
    expect(isWallBudgetExempt(false, "normal", "develop")).toBe(false);
    expect(isWallBudgetExempt(false, "recovery", "expand")).toBe(false);
    // ⚠️ 受袭记忆窗（siegeMemoryTicks 10K 拍）不在豁免列 —— W8N3 教训：
    // 「记住挨过打」≠「正在挨打」，记忆窗豁免会让预算闸形同虚设。
    expect(isWallBudgetExempt(false, "normal", "fortify")).toBe(false);
  });
});

describe("wallBudget 速率语义（池的宏观行为）", () => {
  it("持续超速率灌墙被池拖到平均 rate：10W builder 10 e/t 灌墙，缓冲耗尽后稳态 ≈ 2 e/t", () => {
    let pool: number | undefined = 0;
    // 蓄水 5000 拍（无消费）——闲时蓄水到 cap
    for (let t = 0; t < 5000; t++) pool = accrueWallBudget(pool, 1);
    expect(pool).toBe(WALL_BUDGET_CAP);

    // builder 每拍灌 10（10 WORK），塔不修，room-state 每拍进水。
    // 缓冲 10K 以净 8/t（10 花 - 2 进）耗尽 ⇒ ~1250 拍后进入稳态。
    let spent = 0;
    let steadyWindowSpent = 0;
    for (let t = 1; t <= 3000; t++) {
      pool = accrueWallBudget(pool, 1);
      const s = spendWallBudget(pool, 10);
      pool = s.pool;
      spent += s.granted;
      if (t > 2000) steadyWindowSpent += s.granted; // 缓冲早已耗尽的稳态窗
    }
    // 总消耗 = 缓冲 + 全程进水（末拍残留在池内的 ≤1 拍进水除外）
    expect(spent).toBeLessThanOrEqual(WALL_BUDGET_CAP + WALL_BUDGET_RATE * 3000);
    expect(spent).toBeGreaterThan(WALL_BUDGET_CAP);
    // 稳态窗（1000 拍）的平均速率收敛到 rate —— 预算闸语义成立，且永不透支
    expect(steadyWindowSpent / 1000).toBeCloseTo(WALL_BUDGET_RATE, 1);
    expect(steadyWindowSpent).toBeLessThanOrEqual(WALL_BUDGET_RATE * 1000);
  });
});
