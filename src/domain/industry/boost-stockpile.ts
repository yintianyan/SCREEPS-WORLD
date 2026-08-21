/**
 * Boost 化合物分级库存上限 — 纯函数（无 Game API 依赖）。
 *
 * 背景：旧实现所有 boost 化合物共用 CONFIG.war.boostStockpile(600) 作为卖出阈值。
 * 问题：war 编队化合物（XUH2O/XLHO2）与日常 boost 化合物（XGH2O/XUHO2/XLH2O）
 * 消费速率差异巨大——war 是一次性大批量消耗（满编 360+600），日常是持续涓流
 * （单个 creep 5 WORK × 30 = 150/次，但 boost 后存活 1500 tick，不频繁）。
 *
 * 分级策略：
 * - war 编队化合物：维持 war.boostStockpile(600) — 战略储备，平时不动。
 * - 日常 boost 化合物：独立上限 boostDailyStockpile(300) — 够 2 个 creep 全强化
 *   （150 × 2 = 300），超出即卖出变现。库存膨胀后 lab output 无处回收 → 反应链停摆。
 *
 * 纯函数层：不访问 Game/Memory，可 Vitest 测试。
 */

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
 *
 * - war 战略储备化合物 → warStockpile（600）
 * - 日常 boost 化合物 → dailyStockpile（300）
 * - 非 boost 化合物 → 0（不管理，由其他通道处理）
 *
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
 *
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
