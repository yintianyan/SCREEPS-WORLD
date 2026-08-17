/**
 * shouldProcessPower — powerSpawn processPower 调度门禁纯函数测试。
 *
 * 战略定位：GPL 是投资不是生存，门禁全取保守侧 —
 *   - war 姿态 → 暂停（能量军事优先；power 不腐坏，暂停零损失）
 *   - power/energy 存量不足 → 暂停（引擎必返错）
 *   - storage 无视野/低于地板 → 暂停（投资让位 spawn/tower）
 *   - 余裕充足 → 烧
 */
import { describe, expect, it } from "vitest";
import {
  PROCESS_POWER_ENERGY,
  shouldProcessPower,
} from "../../../src/domain/economy/power-processing";

/** 基准：库存充足 + storage 高于地板 + 和平 → 放行。 */
const BASE = {
  powerStored: 50,
  energyStored: PROCESS_POWER_ENERGY,
  storageEnergy: 30000,
  energyFloor: 30000,
  warActive: false,
} as const;

describe("shouldProcessPower — processPower 调度门禁", () => {
  it("库存充足 + storage 达地板 + 和平 → true（地板边界含等号）", () => {
    expect(shouldProcessPower({ ...BASE })).toBe(true);
  });

  it("war 姿态 → false（能量军事优先，GPL 等得起）", () => {
    expect(shouldProcessPower({ ...BASE, warActive: true })).toBe(false);
  });

  it("power 存量不足（< 1）→ false（引擎必返 ERR_NOT_ENOUGH_RESOURCES）", () => {
    expect(shouldProcessPower({ ...BASE, powerStored: 0 })).toBe(false);
  });

  it("energy 存量不足（< 50）→ false", () => {
    expect(shouldProcessPower({ ...BASE, energyStored: PROCESS_POWER_ENERGY - 1 })).toBe(false);
  });

  it("storage 低于地板 → false（投资让位生存）", () => {
    expect(shouldProcessPower({ ...BASE, storageEnergy: BASE.energyFloor - 1 })).toBe(false);
  });

  it("storage 无视野（undefined）→ false（保守侧：无余裕证据不烧）", () => {
    expect(shouldProcessPower({ ...BASE, storageEnergy: undefined })).toBe(false);
  });
});
