/**
 * Battery 解压回能判定。
 *
 * 官方配方（私服 `@screeps/common/lib/constants.js`）：
 *   battery: { amount: 50, cooldown: 10, components: { energy: 600 } }  → 600 energy → 50 battery
 *   energy:  { amount: 500, cooldown: 10, components: { battery: 50 } } → 50 battery → 500 energy
 * 往返损耗 16.7%，存储密度 10 倍。
 *
 * 语义修正：battery 不是常规能源储备，而是「storage 满仓时的溢出容器」。
 * storage 未达目标水位就应解压，而不是等到 5K 危机线。
 */
import { describe, expect, it } from "vitest";
import {
  shouldDecompressBattery,
  DECOMPRESS_BATCH_BATTERY,
  DECOMPRESS_BATCH_ENERGY,
} from "../../../src/domain/economy/battery-decompression";

const TARGET = 300_000;

describe("shouldDecompressBattery — battery 解压回能判定", () => {
  it("storage 未达目标水位 + battery 够一批 → true", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: 55_000,
        batteryInFactory: 50,
        factoryCooldown: 0,
        storageTarget: TARGET,
      }),
    ).toBe(true);
  });

  it("factory 冷却中 → false", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: 55_000,
        batteryInFactory: 50,
        factoryCooldown: 5,
        storageTarget: TARGET,
      }),
    ).toBe(false);
  });

  it("battery 不足一批（49）→ false", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: 55_000,
        batteryInFactory: 49,
        factoryCooldown: 0,
        storageTarget: TARGET,
      }),
    ).toBe(false);
  });

  it("恰好够一批（50）→ true", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: 55_000,
        batteryInFactory: DECOMPRESS_BATCH_BATTERY,
        factoryCooldown: 0,
        storageTarget: TARGET,
      }),
    ).toBe(true);
  });

  it("storage 无视野（undefined）→ false", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: undefined,
        batteryInFactory: 50,
        factoryCooldown: 0,
        storageTarget: TARGET,
      }),
    ).toBe(false);
  });

  it("storage 已达目标（300K）→ false（有余时不付 16.7% 折损）", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: TARGET,
        batteryInFactory: 50,
        factoryCooldown: 0,
        storageTarget: TARGET,
      }),
    ).toBe(false);
  });

  it("storage 差 1 到目标（299,999）→ true", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: TARGET - 1,
        batteryInFactory: 50,
        factoryCooldown: 0,
        storageTarget: TARGET,
      }),
    ).toBe(true);
  });

  it("storage=0 + 大量 battery → true", () => {
    expect(
      shouldDecompressBattery({
        storageEnergy: 0,
        batteryInFactory: 500,
        factoryCooldown: 0,
        storageTarget: TARGET,
      }),
    ).toBe(true);
  });

  it("回归：storage 55K（W8N3 实际水位）在旧危机线（5K）下不触发，新语义下触发", () => {
    const input = {
      storageEnergy: 55_000,
      batteryInFactory: 50,
      factoryCooldown: 0,
    };
    expect(shouldDecompressBattery({ ...input, storageTarget: 5_000 })).toBe(false);
    expect(shouldDecompressBattery({ ...input, storageTarget: TARGET })).toBe(true);
  });
});

describe("DECOMPRESS_BATCH 常量（官方配方）", () => {
  it("解压一批消耗 50 battery", () => {
    expect(DECOMPRESS_BATCH_BATTERY).toBe(50);
  });

  it("解压一批产出 500 energy", () => {
    expect(DECOMPRESS_BATCH_ENERGY).toBe(500);
  });
});
