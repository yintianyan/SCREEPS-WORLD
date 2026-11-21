/** shouldProcessPower — powerSpawn processPower 调度门禁纯函数测试。 */
import { describe, expect, it } from "vitest";
import {
  PROCESS_POWER_ENERGY,
  shouldProcessPower,
} from "../../../src/domain/economy/power-processing";

/** 基准：库存充足 + storage 高于地板 → 放行。 */
const BASE = {
  powerStored: 50,
  energyStored: PROCESS_POWER_ENERGY,
  storageEnergy: 30000,
  energyFloor: 30000,
} as const;

describe("shouldProcessPower — processPower 调度门禁", () => {
  it("库存充足 + storage 达地板 → true（地板边界含等号）", () => {
    expect(shouldProcessPower({ ...BASE })).toBe(true);
  });

  // 语义变更（2026-11-21 批次 2）：删除 warActive → false 闸。单次成本仅 50 energy，
  // 收益是 PowerCreep 等级（ops 效率/防御加强）——战争期恰恰最需要 PC。
  // 原闸与 war 姿态长期化叠加后整条 power 链永久闲置。
  it("war 期（模拟：无姿态输入）也处理 —— 门禁只看库存三道真闸", () => {
    // ProcessPowerInput 已无 warActive 字段：编译期即证明 war 不再是闸输入。
    const r: Parameters<typeof shouldProcessPower>[0] = { ...BASE };
    expect(shouldProcessPower(r)).toBe(true);
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
