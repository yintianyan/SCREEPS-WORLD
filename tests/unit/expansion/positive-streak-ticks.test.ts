import { describe, expect, it } from "vitest";
import {
  advancePositiveStreak,
  evaluateEconomicActivation,
  type EconomicActivationInput,
} from "../../../src/domain/expansion/economic-activation";

/** interval=100 的系统里"每次评估 +1"与"按拍累计"的差别（旧语义用 +1 复现）。 */
const INTERVAL = 100;

function activate(streak: number, netFlow: number): boolean {
  const input: EconomicActivationInput = {
    energyProduction: 10,
    energyConsumption: 10 - netFlow,
    externalEnergyInflow: 0,
    consecutivePositiveTicks: streak,
    hasHarvester: true,
    hasTransporter: true,
    hasUpgrader: true,
    spawnActive: true,
    tick: 83322500,
  };
  return evaluateEconomicActivation(input).activated;
}

describe("advancePositiveStreak — streak 的单位是拍，不是采样次数", () => {
  it("5 次连续为正的评估（interval=100）累计到 500 拍 ⇒ 自然激活可达", () => {
    let streak = 0;
    for (let i = 0; i < 5; i++) streak = advancePositiveStreak(streak, INTERVAL, true);
    expect(streak).toBe(500);
    expect(activate(streak, 1)).toBe(true);
  });

  it("对照：旧的「每次 +1」语义下同样 5 次只有 5，激活判据差 495", () => {
    // 旧语义 = 每评估一次 +1 ⇒ SELF_SUSTAINING_TICKS=500 需要 500 次不间断采样 = 50,000 拍，
    // 而 integrating 的预算是 pioneerTimeout×3 = 60,000 拍 —— 中间一次落到孵化谷值就清零。
    let legacy = 0;
    for (let i = 0; i < 5; i++) legacy += 1;
    expect(legacy).toBe(5);
    expect(activate(legacy, 1)).toBe(false);
    expect(advancePositiveStreak(legacy, INTERVAL, true)).toBe(105); // 新语义同一批采样给 105
  });

  it("一次非正即清零（不论经过多少拍）", () => {
    expect(advancePositiveStreak(400, 100, false)).toBe(0);
    expect(advancePositiveStreak(400, 0, false)).toBe(0);
  });

  it("首次评估（elapsed=0）不虚增，重启/同拍重入也不倒退", () => {
    expect(advancePositiveStreak(0, 0, true)).toBe(0);
    expect(advancePositiveStreak(300, 0, true)).toBe(300);
  });

  it("孵化谷值把 streak 打回 0 后，5 次采样同样能重新攒到 500（不需要 500 次）", () => {
    let streak = advancePositiveStreak(0, INTERVAL, true);
    streak = advancePositiveStreak(streak, INTERVAL, false); // 谷值
    expect(streak).toBe(0);
    for (let i = 0; i < 5; i++) streak = advancePositiveStreak(streak, INTERVAL, true);
    expect(streak).toBe(500);
  });
});
