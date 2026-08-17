/**
 * powerSpawn processPower 调度决策 — 纯函数，执行层在 systems/factory-manager.ts。
 *
 * 战略定位：processPower 是 GPL 投资链（攒等级解锁 power creep），非生存刚需。
 * power 不会腐坏、暂停零损失，因此两项门禁都取保守侧：
 * - 能量地板：storage 低于地板 = 经济余裕不足，烧 50 energy/次等于与
 *   spawn/tower 抢血 — 投资让位生存；
 * - war 姿态：战时能量军事优先，GPL 增值等得起。暂停烧 → powerSpawn 库存
 *   涨满 → stockPowerSpawn 自然停搬（单一闸门管全链，无需逐环节加门禁）。
 */

/** processPower 单次消耗的能量（引擎常量 POWER_SPAWN_ENERGY_RATIO）。 */
export const PROCESS_POWER_ENERGY = 50;

/** shouldProcessPower 的输入 — 全部由执行层从引擎态采集，本函数不读 Game/Memory。 */
export interface ProcessPowerInput {
  /** powerSpawn 内 power 存量（引擎每次消耗 1）。 */
  powerStored: number;
  /** powerSpawn 内 energy 存量（引擎每次消耗 50）。 */
  energyStored: number;
  /** 所在房 storage 能量（RCL8 房必有 storage；undefined = 无视野，保守不烧）。 */
  storageEnergy: number | undefined;
  /** 能量地板（CONFIG.factory.processEnergyFloor）。 */
  energyFloor: number;
  /** 帝国 war 姿态（Memory.kernel.strategy.posture === "war"）。 */
  warActive: boolean;
}

/**
 * processPower 调度判定：
 * - war 姿态 → false（能量军事优先）；
 * - power/energy 存量不足 → false（引擎必返 ERR_NOT_ENOUGH_RESOURCES）；
 * - storage 无视野或低于地板 → false（投资让位生存）；
 * - 其余 → true。
 */
export function shouldProcessPower(input: ProcessPowerInput): boolean {
  if (input.warActive) return false;
  if (input.powerStored < 1) return false;
  if (input.energyStored < PROCESS_POWER_ENERGY) return false;
  if (input.storageEnergy === undefined || input.storageEnergy < input.energyFloor) return false;
  return true;
}
