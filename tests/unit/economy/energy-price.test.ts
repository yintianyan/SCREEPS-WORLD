/** energyPrice 供需平衡价格信号测试。 */
import { describe, expect, it } from "vitest";
import {
  computeEnergyPrice,
  supplyElasticity,
  demandElasticity,
  logisticsElasticity,
} from "../../../src/domain/economy/energy-price";

describe("computeEnergyPrice", () => {
  it("收支平衡时返回 0.5", () => {
    expect(computeEnergyPrice(0, 20)).toBe(0.5);
  });

  it("净流为正（供 > 需）时 > 0.5", () => {
    const price = computeEnergyPrice(5, 20);
    expect(price).toBeGreaterThan(0.5);
    expect(price).toBeLessThanOrEqual(1);
  });

  it("净流为负（需 > 供）时 < 0.5", () => {
    const price = computeEnergyPrice(-5, 20);
    expect(price).toBeLessThan(0.5);
    expect(price).toBeGreaterThanOrEqual(0);
  });

  it("净流远超收入 → 饱和到 1.0", () => {
    expect(computeEnergyPrice(100, 20)).toBe(1);
  });

  it("净流远低于收入 → 饱和到 0.0", () => {
    expect(computeEnergyPrice(-100, 20)).toBe(0);
  });

  it("无经济核算时返回中性 0.5", () => {
    expect(computeEnergyPrice(10, 0)).toBe(0.5);
    expect(computeEnergyPrice(-10, 0)).toBe(0.5);
  });

  it("sensitivity 越小越敏感（更快饱和）", () => {
    const lowSens = computeEnergyPrice(3, 20, 0.1);
    const highSens = computeEnergyPrice(3, 20, 0.5);
    expect(lowSens).toBeGreaterThan(highSens);
  });
});

describe("supplyElasticity", () => {
  it("恒返回 1.0（供给端不通过价格缩放编制）", () => {
    expect(supplyElasticity(0.0)).toBe(1.0);
    expect(supplyElasticity(0.1)).toBe(1.0);
    expect(supplyElasticity(0.5)).toBe(1.0);
    expect(supplyElasticity(1.0)).toBe(1.0);
  });
});

describe("demandElasticity", () => {
  it("价格充裕（>= 0.5）时为 1.0（满编消费）", () => {
    expect(demandElasticity(0.5)).toBe(1.0);
    expect(demandElasticity(1.0)).toBe(1.0);
  });

  it("价格极低（<= 0.1）时为 0（停止消费）", () => {
    expect(demandElasticity(0.0)).toBe(0);
    expect(demandElasticity(0.1)).toBe(0);
  });

  it("中间区间线性插值", () => {
    const mid = demandElasticity(0.3);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // 0.3 → (0.3-0.1)/0.4 = 0.5
    expect(mid).toBeCloseTo(0.5, 2);
  });
});

describe("logisticsElasticity", () => {
  it("价格充裕（>= 0.5）时为 1.0", () => {
    expect(logisticsElasticity(0.5)).toBe(1.0);
    expect(logisticsElasticity(1.0)).toBe(1.0);
  });

  it("价格极低（<= 0.1）时保留 0.5（保命力）", () => {
    expect(logisticsElasticity(0.0)).toBe(0.5);
    expect(logisticsElasticity(0.1)).toBe(0.5);
  });

  it("中间区间在 0.5..1.0 之间线性插值", () => {
    const mid = logisticsElasticity(0.3);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1.0);
    // 0.3 → 0.5 + 0.5 * (0.3-0.1)/0.4 = 0.5 + 0.25 = 0.75
    expect(mid).toBeCloseTo(0.75, 2);
  });
});
