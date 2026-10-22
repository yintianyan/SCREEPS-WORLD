import { describe, expect, it } from "vitest";
import { selectBody } from "../../../src/config/bodies";
import { capSupplyToCarrier } from "../../../src/domain/operation/supply-sizing";

function carrierCarry(energyCapacityAvailable: number): number {
  return selectBody("carrier", energyCapacityAvailable).filter(p => p === CARRY).length * 50;
}

describe("capSupplyToCarrier — 单趟容量上限", () => {
  it("RCL8 档：1,800 请求夹到 24C/12M 的 1,200", () => {
    expect(carrierCarry(12900)).toBe(1200);
    expect(capSupplyToCarrier(1800, 12900)).toBe(1200);
  });

  it("请求低于容量时原样返回", () => {
    expect(capSupplyToCarrier(600, 12900)).toBe(600);
  });

  it("小房按实际 carrier 模板夹，不写死 1,200", () => {
    const cap = carrierCarry(300);
    expect(capSupplyToCarrier(1800, 300)).toBe(cap);
    expect(cap).toBeLessThan(1200);
  });
});
