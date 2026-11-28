import { describe, expect, it } from "vitest";
import {
  getEnergyPolicy,
  getEnergyPolicyForStorage,
  getStorageCapacity,
} from "../../../src/domain/economy/energy-policy";

describe("getEnergyPolicy — 战略能量闸容量刻度", () => {
  it("按 1M storage 容量生成战略水位", () => {
    expect(getEnergyPolicy(1_000_000)).toEqual({
      crisisBuyFloor: 100_000,
      aidRecipientFloor: 250_000,
      aidDonorFloor: 400_000,
      emergencyDonorFloor: 300_000,
      saleFloor: 400_000,
      terminalStorageFloor: 250_000,
      terminalEnergyTarget: 25_000,
      terminalReserveFloor: 5_000,
      nukerStorageFloor: 700_000,
    });
  });

  it("按真实容量缩放，而不是写死 1M", () => {
    const policy = getEnergyPolicy(500_000);
    expect(policy.saleFloor).toBe(200_000);
    expect(policy.aidDonorFloor).toBe(200_000);
    expect(policy.terminalEnergyTarget).toBe(12_500);
  });

  it("容量缺失时回退引擎 storage 常量", () => {
    expect(getEnergyPolicy()).toEqual(getEnergyPolicy(1_000_000));
    expect(getEnergyPolicy(0)).toEqual(getEnergyPolicy(1_000_000));
  });

  it("从 store 安全读取容量，缺 getCapacity 时回退 1M", () => {
    expect(getStorageCapacity({ getCapacity: () => 500_000 })).toBe(500_000);
    expect(getStorageCapacity({ getUsedCapacity: () => 100 })).toBe(1_000_000);
    expect(getEnergyPolicyForStorage({ getCapacity: () => 500_000 }).saleFloor).toBe(200_000);
  });
});
