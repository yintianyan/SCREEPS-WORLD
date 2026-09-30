import { describe, expect, it } from "vitest";
import {
  evaluateEconomicActivation,
  externalInflowPerTick,
  type EconomicActivationInput,
} from "../../../src/domain/expansion/economic-activation";

/**
 * 线上幼房 W38S56（83322668）的读数：账本 `ws` 的 ΣflowBalance = 3017/900t ≈ +3.35/t，
 * 房内 worker×2 + builder×5 且背包有能（`ce=[434,434]`），carrier 线路 0 条。
 * 旧口径按「每人 25/t」把那份**存量**折成 175/t 的"输血率"——比全房流量大两个数量级，
 * 于是 `selfSustaining` 在整个施工期恒假，CP5 的自然完成路径按构造走不到。
 */
describe("externalInflowPerTick — 外部输血是流量，不是背包存量", () => {
  it("没有 carrier 线路即为 0，与幼房里有多少带能先锋无关", () => {
    expect(externalInflowPerTick(0)).toBe(0);
  });

  it("carrier 线路按 50/t 计（唯一的持续外部流来源）", () => {
    expect(externalInflowPerTick(1)).toBe(50);
    expect(externalInflowPerTick(2)).toBe(100);
  });

  it("对照：同一无 carrier 的幼房，旧口径造出 175/t 假输血并永久否掉 selfSustaining", () => {
    const base = {
      energyProduction: 20,
      energyConsumption: 17, // 净流 +3/t，与账本实测同量级
      hasHarvester: true,
      hasTransporter: true,
      hasUpgrader: false,
      spawnActive: true,
      tick: 83322668,
    };
    const withOldFigure = (inflow: number): EconomicActivationInput => ({
      ...base,
      externalEnergyInflow: inflow,
      consecutivePositiveTicks: 600,
    });
    // 旧口径：7 只先锋 × 25 = 175/t ⇒ 即使净流为正、连续 600 拍，也永不激活
    expect(evaluateEconomicActivation(withOldFigure(175)).activated).toBe(false);
    // 新口径：0 条 carrier ⇒ 0/t ⇒ 激活
    expect(evaluateEconomicActivation(withOldFigure(externalInflowPerTick(0))).activated).toBe(
      true,
    );
  });

  it("真有 carrier 补给线时仍判'未自给'（不是把闸拆了）", () => {
    const input: EconomicActivationInput = {
      energyProduction: 20,
      energyConsumption: 17,
      externalEnergyInflow: externalInflowPerTick(1),
      consecutivePositiveTicks: 600,
      hasHarvester: true,
      hasTransporter: true,
      hasUpgrader: false,
      spawnActive: true,
      tick: 83322668,
    };
    expect(evaluateEconomicActivation(input).selfSustaining).toBe(false);
  });
});
