/** Battery 解压回能决策 — 纯函数（无 Game API 依赖）。 */

/** shouldDecompressBattery 的输入 — 全部由执行层从引擎态采集。 */
export interface DecompressBatteryInput {
  /** 所在房 storage 能量（undefined = 无 storage 或无视野，保守不解压）。 */
  storageEnergy: number | undefined;
  /** factory 内 battery 存量（解压原料）。 */
  batteryInFactory: number;
  /** factory 冷却剩余 tick（>0 时不可 produce）。 */
  factoryCooldown: number;
  /** 解压触发的能量危机线（CONFIG.energy.energyBuyFloor）。 */
  energyCrisisFloor: number;
}

/**
 * 官方配方：factory.produce(RESOURCE_ENERGY) 消耗 5 battery → 50 energy。
 * 每 10 tick 冷却可执行一次 — 危机时每 10 tick 补 50 能量到 factory。
 * battery 由 distributor 的 reclaimFactoryOutput 从 terminal/storage 搬到 factory。
 */
export const DECOMPRESS_BATCH_BATTERY = 5;
export const DECOMPRESS_BATCH_ENERGY = 50;

/**
 * battery 解压判定：
 * - factory 冷却中 → false（引擎必返 ERR_TIRED）；
 * - factory 内 battery 不足 5 → false（原料不够一批）；
 * - storage 无视野或能量 ≥ 危机线 → false（不危机不解压——1/6 折损划不来）；
 * - 其余 → true。
 */
export function shouldDecompressBattery(input: DecompressBatteryInput): boolean {
  if (input.factoryCooldown > 0) return false;
  if (input.batteryInFactory < DECOMPRESS_BATCH_BATTERY) return false;
  if (input.storageEnergy === undefined) return false;
  if (input.storageEnergy >= input.energyCrisisFloor) return false;
  return true;
}
