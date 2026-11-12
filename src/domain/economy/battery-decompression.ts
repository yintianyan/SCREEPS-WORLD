/** Battery 解压回能决策 — 纯函数（无 Game API 依赖）。 */

/** shouldDecompressBattery 的输入 — 全部由执行层从引擎态采集。 */
export interface DecompressBatteryInput {
  /** 所在房 storage 能量（undefined = 无 storage 或无视野，保守不解压）。 */
  storageEnergy: number | undefined;
  /** factory 内 battery 存量（解压原料）。 */
  batteryInFactory: number;
  /** factory 冷却剩余 tick（>0 时不可 produce）。 */
  factoryCooldown: number;
  /**
   * 解压目标水位：storage 低于此值时把 battery 还原成能量。
   *
   * 语义来自 battery 的定位 —— 它**不是**常规能源储备，而是「storage 满仓时
   * 防止采集溢出被浪费」的容器：
   * - 压缩 600 energy → 50 battery（12:1）
   * - 解压 50 battery → 500 energy（10:1）
   * - 往返损耗 **16.7%**，存储密度 10 倍
   *
   * 所以：storage 满仓 ⇒ 压缩是止损；storage 不满 ⇒ battery 应还原成能量参与
   * 升级/维修/lab，否则它既占空间又只能亏损耗回收。
   */
  storageTarget: number;
}

/**
 * 官方配方（私服 `@screeps/common/lib/constants.js` 原文）：
 *   battery: { amount: 50, cooldown: 10, components: { energy: 600 } }
 *   energy:  { amount: 500, cooldown: 10, components: { battery: 50 } }
 *
 * 即一次解压消耗 **50 battery 产出 500 energy**（1:10）。
 * 旧实现写的是 5 → 50（小了 10 倍）：`batteryInFactory >= 5` 时判定可解压，
 * 但引擎要求 50，`produce` 必返 ERR_NOT_ENOUGH_RESOURCES —— 解压链从未真正跑通过。
 */
export const DECOMPRESS_BATCH_BATTERY = 50;
export const DECOMPRESS_BATCH_ENERGY = 500;

/**
 * battery 解压判定：
 * - factory 冷却中 → false（引擎必返 ERR_TIRED）；
 * - factory 内 battery 不足一批（50）→ false；
 * - storage 无视野或已达目标水位 → false（库房有余时不值得付 16.7% 折损）；
 * - 其余 → true。
 */
export function shouldDecompressBattery(input: DecompressBatteryInput): boolean {
  if (input.factoryCooldown > 0) return false;
  if (input.batteryInFactory < DECOMPRESS_BATCH_BATTERY) return false;
  if (input.storageEnergy === undefined) return false;
  if (input.storageEnergy >= input.storageTarget) return false;
  return true;
}
