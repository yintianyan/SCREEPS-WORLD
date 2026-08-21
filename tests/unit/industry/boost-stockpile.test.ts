/**
 * Boost 化合物分级库存上限测试（纯函数）。
 *
 * 覆盖：
 *   getBoostStockpileLimit — war vs 日常分级判定
 *   computeBoostSurplus — 盈余量计算
 *   isWarStrategicCompound — war 编队化合物识别
 */
import { describe, expect, it } from "vitest";
import {
  getBoostStockpileLimit,
  computeBoostSurplus,
  isWarStrategicCompound,
  WAR_BOOST_COMPOUNDS,
} from "../../../src/domain/industry/boost-stockpile";

const WAR_STOCKPILE = 600;
const DAILY_STOCKPILE = 300;

describe("isWarStrategicCompound — war 编队化合物识别", () => {
  it("XUH2O (attacker) → true", () => {
    expect(isWarStrategicCompound("XUH2O")).toBe(true);
  });

  it("XLHO2 (healer) → true", () => {
    expect(isWarStrategicCompound("XLHO2")).toBe(true);
  });

  it("XGH2O (upgrader, 日常 boost) → false", () => {
    expect(isWarStrategicCompound("XGH2O")).toBe(false);
  });

  it("XUHO2 (harvester, 日常 boost) → false", () => {
    expect(isWarStrategicCompound("XUHO2")).toBe(false);
  });

  it("基础矿 H → false", () => {
    expect(isWarStrategicCompound("H")).toBe(false);
  });
});

describe("getBoostStockpileLimit — 分级库存上限", () => {
  it("war 编队化合物 XUH2O → warStockpile(600)", () => {
    expect(getBoostStockpileLimit("XUH2O", WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(600);
  });

  it("war 编队化合物 XLHO2 → warStockpile(600)", () => {
    expect(getBoostStockpileLimit("XLHO2", WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(600);
  });

  it("日常 boost XGH2O → dailyStockpile(300)", () => {
    expect(getBoostStockpileLimit("XGH2O", WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(300);
  });

  it("日常 boost XUHO2 → dailyStockpile(300)", () => {
    expect(getBoostStockpileLimit("XUHO2", WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(300);
  });

  it("日常 boost XLH2O → dailyStockpile(300)", () => {
    expect(getBoostStockpileLimit("XLH2O", WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(300);
  });

  it("非 boost 化合物（基础矿 H）→ 0", () => {
    expect(getBoostStockpileLimit("H", WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });

  it("非 boost 化合物（能量）→ 0", () => {
    expect(getBoostStockpileLimit("energy", WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });
});

describe("computeBoostSurplus — 盈余量计算", () => {
  it("war 化合物超过 600 → 盈余 100", () => {
    expect(computeBoostSurplus("XUH2O", 700, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(100);
  });

  it("war 化合物恰好 600 → 无盈余", () => {
    expect(computeBoostSurplus("XUH2O", 600, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });

  it("war 化合物低于 600 → 无盈余", () => {
    expect(computeBoostSurplus("XUH2O", 500, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });

  it("日常 boost 超过 300 → 盈余 200", () => {
    expect(computeBoostSurplus("XGH2O", 500, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(200);
  });

  it("日常 boost 恰好 300 → 无盈余", () => {
    expect(computeBoostSurplus("XGH2O", 300, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });

  it("日常 boost 低于 300 → 无盈余", () => {
    expect(computeBoostSurplus("XGH2O", 200, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });

  it("非 boost 化合物 → 无盈余（不管理）", () => {
    expect(computeBoostSurplus("H", 5000, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });

  it("日常 boost 库存 0 → 无盈余", () => {
    expect(computeBoostSurplus("XGH2O", 0, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(0);
  });

  it("日常 boost 库存远超上限（1000）→ 盈余 700", () => {
    expect(computeBoostSurplus("XGH2O", 1000, WAR_STOCKPILE, DAILY_STOCKPILE)).toBe(700);
  });
});

describe("WAR_BOOST_COMPOUNDS 集合", () => {
  it("包含 XUH2O 和 XLHO2", () => {
    expect(WAR_BOOST_COMPOUNDS.has("XUH2O")).toBe(true);
    expect(WAR_BOOST_COMPOUNDS.has("XLHO2")).toBe(true);
  });

  it("不包含日常 boost 化合物", () => {
    expect(WAR_BOOST_COMPOUNDS.has("XGH2O")).toBe(false);
    expect(WAR_BOOST_COMPOUNDS.has("XUHO2")).toBe(false);
    expect(WAR_BOOST_COMPOUNDS.has("XLH2O")).toBe(false);
  });
});
