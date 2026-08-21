/**
 * Battery 解压回能决策测试（纯函数）。
 *
 * 覆盖 shouldDecompressBattery 的所有判定路径：
 * - factory 冷却中 → false
 * - factory 内 battery 不足 5 → false
 * - storage 无视野 → false
 * - storage 能量 ≥ 危机线 → false（不危机不解压）
 * - 全部满足 → true
 */
import { describe, expect, it } from "vitest";
import {
  shouldDecompressBattery,
  DECOMPRESS_BATCH_BATTERY,
  DECOMPRESS_BATCH_ENERGY,
} from "../../../src/domain/economy/battery-decompression";

describe("shouldDecompressBattery — battery 解压回能判定", () => {
  it("全条件满足时返回 true", () => {
    expect(shouldDecompressBattery({
      storageEnergy: 3000,
      batteryInFactory: 10,
      factoryCooldown: 0,
      energyCrisisFloor: 5000,
    })).toBe(true);
  });

  it("factory 冷却中 → false", () => {
    expect(shouldDecompressBattery({
      storageEnergy: 3000,
      batteryInFactory: 10,
      factoryCooldown: 5,
      energyCrisisFloor: 5000,
    })).toBe(false);
  });

  it("factory 内 battery 不足一批（< 5）→ false", () => {
    expect(shouldDecompressBattery({
      storageEnergy: 3000,
      batteryInFactory: 4,
      factoryCooldown: 0,
      energyCrisisFloor: 5000,
    })).toBe(false);
  });

  it("恰好够一批（= 5）→ true", () => {
    expect(shouldDecompressBattery({
      storageEnergy: 3000,
      batteryInFactory: DECOMPRESS_BATCH_BATTERY,
      factoryCooldown: 0,
      energyCrisisFloor: 5000,
    })).toBe(true);
  });

  it("storage 无视野（undefined）→ false", () => {
    expect(shouldDecompressBattery({
      storageEnergy: undefined,
      batteryInFactory: 10,
      factoryCooldown: 0,
      energyCrisisFloor: 5000,
    })).toBe(false);
  });

  it("storage 能量 ≥ 危机线 → false（不危机不解压）", () => {
    expect(shouldDecompressBattery({
      storageEnergy: 5000,
      batteryInFactory: 10,
      factoryCooldown: 0,
      energyCrisisFloor: 5000,
    })).toBe(false);
  });

  it("storage 能量刚好低于危机线（4999）→ true", () => {
    expect(shouldDecompressBattery({
      storageEnergy: 4999,
      batteryInFactory: 10,
      factoryCooldown: 0,
      energyCrisisFloor: 5000,
    })).toBe(true);
  });

  it("energy=0 极端危机 + 大量 battery → true", () => {
    expect(shouldDecompressBattery({
      storageEnergy: 0,
      batteryInFactory: 500,
      factoryCooldown: 0,
      energyCrisisFloor: 5000,
    })).toBe(true);
  });
});

describe("DECOMPRESS_BATCH 常量", () => {
  it("解压一批消耗 5 battery", () => {
    expect(DECOMPRESS_BATCH_BATTERY).toBe(5);
  });

  it("解压一批产出 50 energy", () => {
    expect(DECOMPRESS_BATCH_ENERGY).toBe(50);
  });
});
