import { describe, expect, it, beforeEach } from "vitest";
import {
  sampleCpu,
  sampleEconomy,
  type CpuSample,
  type EconomySample,
} from "../src/kernel/timeseries";

// Mock Game object for sampleCpu
const mockGame = {
  time: 12345,
  cpu: {
    getUsed: () => 8.5,
    bucket: 8500,
    limit: 20,
    tickLimit: 20,
  },
};

const mockBudget = {
  tier: "healthy" as const,
  softLimit: 17.5,
  hardLimit: 19.2,
  canStart: () => true,
  isExhausted: () => false,
  spent: () => 8.5,
};

beforeEach(() => {
  Object.assign(globalThis, { Game: mockGame });
});

describe("Timeseries — sampleCpu", () => {
  it("captures core CPU metrics", () => {
    const sample = sampleCpu(12345, mockBudget, {
      systemCpu: { "spawn-manager": 2.1, "room-state": 1.5, "link-system": 0.8 },
      roleCpu: { harvester: 1.2, hauler: 0.9 },
      skipped: 2,
      errors: 0,
    });

    expect(sample.t).toBe(12345);
    expect(sample.cpu).toBe(8.5);
    expect(sample.bk).toBe(8500);
    expect(sample.ti).toBe(0); // healthy = 0
    expect(sample.sk).toBe(2);
    expect(sample.er).toBe(0);
  });

  it("ranks tier correctly", () => {
    const guarded = { ...mockBudget, tier: "guarded" as const };
    expect(sampleCpu(100, guarded, { systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 }).ti).toBe(1);

    const conserve = { ...mockBudget, tier: "conserve" as const };
    expect(sampleCpu(100, conserve, { systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 }).ti).toBe(2);

    const recovery = { ...mockBudget, tier: "recovery" as const };
    expect(sampleCpu(100, recovery, { systemCpu: {}, roleCpu: {}, skipped: 0, errors: 0 }).ti).toBe(3);
  });

  it("captures top-3 systems by CPU cost", () => {
    const sample = sampleCpu(100, mockBudget, {
      systemCpu: {
        "spawn-manager": 2.1,
        "room-state": 1.5,
        "link-system": 0.8,
        "construction-manager": 0.3,
      },
      roleCpu: {},
      skipped: 0,
      errors: 0,
    });

    // Top-3 should be spawn-manager, room-state, link-system
    expect(sample.s1).toBe("spawn-manager");
    expect(sample.v1).toBe(2.1);
    expect(sample.s2).toBe("room-state");
    expect(sample.v2).toBe(1.5);
    expect(sample.s3).toBe("link-system");
    expect(sample.v3).toBe(0.8);
  });

  it("handles empty telemetry gracefully", () => {
    const sample = sampleCpu(100, mockBudget, {
      systemCpu: {},
      roleCpu: {},
      skipped: 0,
      errors: 0,
    });

    expect(sample.s1).toBe("");
    expect(sample.v1).toBe(0);
    expect(sample.r1).toBe("");
    expect(sample.w1).toBe(0);
  });

  it("rounds CPU values to 1 decimal", () => {
    const sample = sampleCpu(100, mockBudget, {
      systemCpu: { "test": 2.123456 },
      roleCpu: {},
      skipped: 0,
      errors: 0,
    });

    expect(sample.v1).toBe(2.1);
  });
});

describe("Timeseries — sampleEconomy", () => {
  it("captures economy metrics correctly", () => {
    const sample = sampleEconomy(
      12345,
      "W1N1",
      {
        phase: "growth",
        reserve: 5000,
        reserveDelta: 200,
        drainScore: 0,
        harvesterCount: 2,
        sourceCount: 2,
        rcl: 4,
      },
      0.15,
      {
        energyAvailable: 300,
        energyCapacityAvailable: 1300,
        storageEnergy: 4500,
      },
    );

    expect(sample.t).toBe(12345);
    expect(sample.r).toBe("W1N1");
    expect(sample.rs).toBe(5000);
    expect(sample.d).toBe(200);
    expect(sample.ds).toBe(0);
    expect(sample.p).toBe(15); // 0.15 * 100
    expect(sample.ea).toBe(300);
    expect(sample.ec).toBe(1300);
    expect(sample.se).toBe(4500);
    expect(sample.hc).toBe(2);
    expect(sample.sc).toBe(2);
    expect(sample.ph).toBe(1); // growth = 1
  });

  it("ranks phases correctly", () => {
    const baseInput = {
      reserve: 1000,
      reserveDelta: 0,
      drainScore: 0,
      harvesterCount: 2,
      sourceCount: 2,
      rcl: 4,
    };
    const snap = { energyAvailable: 300, energyCapacityAvailable: 1300, storageEnergy: 0 };

    expect(sampleEconomy(1, "W1N1", { ...baseInput, phase: "bootstrap" }, 0, snap).ph).toBe(0);
    expect(sampleEconomy(1, "W1N1", { ...baseInput, phase: "growth" }, 0, snap).ph).toBe(1);
    expect(sampleEconomy(1, "W1N1", { ...baseInput, phase: "crisis" }, 0, snap).ph).toBe(2);
    expect(sampleEconomy(1, "W1N1", { ...baseInput, phase: "recovery" }, 0, snap).ph).toBe(3);
    expect(sampleEconomy(1, "W1N1", { ...baseInput, phase: "steady" }, 0, snap).ph).toBe(4);
  });

  it("rounds economyPressure to integer percentage", () => {
    const sample = sampleEconomy(
      1, "W1N1",
      { phase: "growth", reserve: 1000, reserveDelta: 0, drainScore: 0, harvesterCount: 2, sourceCount: 2, rcl: 4 },
      0.333,
      { energyAvailable: 300, energyCapacityAvailable: 1300, storageEnergy: 0 },
    );
    expect(sample.p).toBe(33);
  });
});
