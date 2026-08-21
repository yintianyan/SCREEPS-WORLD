/**
 * Battery 解压回能决策 — 纯函数（无 Game API 依赖）。
 *
 * 战略定位：battery 压缩是「满仓溢能止损」（600 能量 → 50 battery，1/6 折损）。
 * 解压是逆向链：factory.produce(RESOURCE_ENERGY) 消耗 battery 产出能量。
 * 官方配方（COMMODITIES[RESOURCE_ENERGY]）：5 battery → 50 energy（cooldown 10）。
 *
 * 触发条件：storage 能量低于危机线（energyBuyFloor 5k）且 factory 内有 battery。
 * 这是最后救助通道——比市场买入更优先（不消耗 credits、不付运费、无市场依赖）。
 *
 * 与压缩链的互斥关系：压缩在 storageNearFull 时触发，解压在 storage 危机时触发。
 * 两者水位区间不重叠（满仓 vs 危机），天然互斥，不需要显式互斥锁。
 *
 * 取舍：解压有 1/6 能量折损（600→50→500 循环），但危机时 credits 和市场
 * 都不可靠（私服无市场、官服行情空窗），battery 是已锁定的本地能量储备——
 * 折损回能比饿死 spawn 强。
 */

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
