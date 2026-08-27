/** Tower 交战盈亏判定测试。 */
import { describe, expect, it } from "vitest";
import {
  towerDamageAt,
  assessEngagement,
  type TowerSummary,
} from "../../../src/domain/defense/tower-engagement";

describe("tower-engagement — towerDamageAt 距离衰减", () => {
  it("range ≤ 5 满伤 600", () => {
    expect(towerDamageAt(1)).toBe(600);
    expect(towerDamageAt(5)).toBe(600);
  });

  it("range ≥ 20 最低伤 150", () => {
    expect(towerDamageAt(20)).toBe(150);
    expect(towerDamageAt(49)).toBe(150);
  });

  it("中段线性衰减（range 12.5 恰为中点 375）", () => {
    // (12.5-5)/15 = 0.5 → 600 × (1 - 0.75×0.5) = 375
    expect(towerDamageAt(12.5)).toBe(375);
    // range 10：600 × (1 - 0.75×(5/15)) = 450
    expect(towerDamageAt(10)).toBe(450);
  });
});

describe("tower-engagement — assessEngagement 开火判定", () => {
  const towerAt = (range: number, energy = 1000): TowerSummary => ({
    energy,
    rangeToTarget: range,
  });

  it("伤害超过编队治疗 → 开火", () => {
    // 单塔近距 600 vs 10 HEAL × 12 = 120。
    const d = assessEngagement([towerAt(3)], { totalHealParts: 10, breachingCore: false });
    expect(d.engage).toBe(true);
    expect(d.expectedDamage).toBe(600);
    expect(d.expectedHeal).toBe(120);
  });

  it("远距被治疗抵消 → 停火蓄能（heal-tank 骗塔场景）", () => {
    // 单塔 range 20 仅 150 伤 vs 15 HEAL × 12 = 180 治疗 → 打不动。
    const d = assessEngagement([towerAt(20)], { totalHealParts: 15, breachingCore: false });
    expect(d.engage).toBe(false);
  });

  it("敌人突入核心区 → 无条件开火（结构损失 > 能量损失）", () => {
    const d = assessEngagement([towerAt(20)], { totalHealParts: 15, breachingCore: true });
    expect(d.engage).toBe(true);
  });

  it("空能塔不计入火力", () => {
    // 两塔近距但其一无能量：600 vs 55 HEAL × 12 = 660 → 停火。
    const d = assessEngagement(
      [towerAt(3), towerAt(3, 0)],
      { totalHealParts: 55, breachingCore: false },
    );
    expect(d.expectedDamage).toBe(600);
    expect(d.engage).toBe(false);
  });

  it("多塔合力跨过盈亏线 → 开火", () => {
    // 三塔 range 10 各 450 = 1350 vs 100 HEAL × 12 = 1200。
    const d = assessEngagement(
      [towerAt(10), towerAt(10), towerAt(10)],
      { totalHealParts: 100, breachingCore: false },
    );
    expect(d.engage).toBe(true);
  });

  it("全塔耗尽且未突破核心 → 停火", () => {
    const d = assessEngagement([towerAt(3, 0)], { totalHealParts: 0, breachingCore: false });
    expect(d.engage).toBe(false);
  });
});
