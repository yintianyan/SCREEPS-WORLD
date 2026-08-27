/** Boost 化合物分级库存上限 — 纯函数（无 Game API 依赖）。 */

import type { Compound } from "./types";

/** war 编队化合物集合（战时才消耗的战略储备）。 */
export const WAR_BOOST_COMPOUNDS: ReadonlySet<string> = new Set([
  "XUH2O", // attacker — attack ×4
  "XLHO2", // healer — heal ×4
]);

/** defender 使用的化合物（威胁期短窗口角色，与 war 编队同档储备）。 */
export const DEFENDER_BOOST_COMPOUNDS: ReadonlySet<string> = new Set([
  "XUH2O", // defender — attack ×4
]);

/**
 * 判断化合物是否为 war/defender 战略储备。
 * war 编队 + defender 共用 XUH2O，XLHO2 为 healer 专用。
 */
export function isWarStrategicCompound(compound: string): boolean {
  return WAR_BOOST_COMPOUNDS.has(compound);
}

/**
 * 获取化合物的库存上限。

 * - war 战略储备化合物 → warStockpile（600）
 * - 日常 boost 化合物 → dailyStockpile（300）
 * - 非 boost 化合物 → 0（不管理，由其他通道处理）

 * @param compound 化合物类型。
 * @param warStockpile war 编队储备目标（CONFIG.war.boostStockpile）。
 * @param dailyStockpile 日常 boost 储备目标（CONFIG.boost.dailyStockpile）。
 * @returns 库存上限。0 = 此化合物不由此函数管理。
 */
export function getBoostStockpileLimit(
  compound: string,
  warStockpile: number,
  dailyStockpile: number,
): number {
  if (isWarStrategicCompound(compound)) return warStockpile;
  // 其他 boost 化合物（XGH2O/XUHO2/XLH2O/XZH2O/XZHO2/XKH2O/XKHO2/XGHO2 等）
  // 均为日常 boost — 非战时消耗，库存上限用 dailyStockpile。
  // 验证是否为已知 boost 化合物（有 REACTIONS 配方且以 X 开头的 T3）。
  if (compound.startsWith("X") && compound.length >= 4) return dailyStockpile;
  return 0;
}

/**
 * 计算库存盈余量（超过上限的部分需卖出变现）。

 * @param compound 化合物类型。
 * @param inventory 合计库存量。
 * @param warStockpile war 编队储备目标。
 * @param dailyStockpile 日常 boost 储备目标。
 * @returns 盈余量（>0 = 超出上限应卖出；0 = 未超或非管理化合物）。
 */
export function computeBoostSurplus(
  compound: string,
  inventory: number,
  warStockpile: number,
  dailyStockpile: number,
): number {
  const limit = getBoostStockpileLimit(compound, warStockpile, dailyStockpile);
  if (limit <= 0) return 0;
  return Math.max(0, inventory - limit);
}
