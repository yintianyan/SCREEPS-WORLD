/**
 * market-pricing 纯函数单元测试 — 动态定价门禁。
 *
 * 验证 computeDynamicBuyPrice / computeDynamicSellPrice / collectMarketPrices /
 * computeOrderPrice 在行情存在/缺失/空窗期三种场景下的行为。
 */
import { describe, it, expect } from "vitest";
import {
  computeDynamicBuyPrice,
  computeDynamicSellPrice,
  collectMarketPrices,
  computeOrderPrice,
  type PriceTable,
} from "../../../src/domain/industry/market-pricing";
import type { MarketPriceSnapshot } from "../../../src/kernel/global-cache";

describe("market-pricing", () => {
  // ── computeDynamicBuyPrice ──────────────────────────────

  describe("computeDynamicBuyPrice", () => {
    it("行情存在 → 返回最低卖价 × buyPremium", () => {
      const prices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0.3 },
      };
      const result = computeDynamicBuyPrice("H", prices, 1.1, 10);
      expect(result).toBeCloseTo(0.55, 10);
    });

    it("行情缺失 → 回退 fallback", () => {
      const prices: PriceTable = {};
      const result = computeDynamicBuyPrice("H", prices, 1.1, 10);
      expect(result).toBe(10);
    });

    it("行情存在但 sellMin=0（无卖单） → 回退 fallback", () => {
      const prices: PriceTable = {
        H: { sellMin: 0, buyMax: 0.3 },
      };
      const result = computeDynamicBuyPrice("H", prices, 1.1, 10);
      expect(result).toBe(10);
    });

    it("buyPremium=1.0 → 买入上限 = 最低卖价", () => {
      const prices: PriceTable = {
        O: { sellMin: 2.0, buyMax: 1.5 },
      };
      const result = computeDynamicBuyPrice("O", prices, 1.0, 100);
      expect(result).toBe(2.0);
    });

    it("buyPremium=2.0 → 买入上限 = 最低卖价 × 2", () => {
      const prices: PriceTable = {
        U: { sellMin: 1.0, buyMax: 0.5 },
      };
      const result = computeDynamicBuyPrice("U", prices, 2.0, 100);
      expect(result).toBe(2.0);
    });
  });

  // ── computeDynamicSellPrice ─────────────────────────────

  describe("computeDynamicSellPrice", () => {
    it("行情存在 → 返回最高买价 × sellDiscount", () => {
      const prices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0.3 },
      };
      const result = computeDynamicSellPrice("H", prices, 0.9, 0.01);
      expect(result).toBeCloseTo(0.27, 10);
    });

    it("行情存在但 buyMax×sellDiscount < absoluteFloor → 返回 absoluteFloor", () => {
      const prices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0.01 },
      };
      // 0.01 × 0.9 = 0.009 < 0.05（absoluteFloor）
      const result = computeDynamicSellPrice("H", prices, 0.9, 0.05);
      expect(result).toBe(0.05);
    });

    it("行情缺失 → 回退 absoluteFloor", () => {
      const prices: PriceTable = {};
      const result = computeDynamicSellPrice("H", prices, 0.9, 0.01);
      expect(result).toBe(0.01);
    });

    it("行情存在但 buyMax=0（无买单） → 回退 absoluteFloor", () => {
      const prices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0 },
      };
      const result = computeDynamicSellPrice("H", prices, 0.9, 0.01);
      expect(result).toBe(0.01);
    });

    it("sellDiscount=1.0 → 卖出下限 = 最高买价", () => {
      const prices: PriceTable = {
        O: { sellMin: 2.0, buyMax: 1.5 },
      };
      const result = computeDynamicSellPrice("O", prices, 1.0, 0.01);
      expect(result).toBe(1.5);
    });
  });

  // ── collectMarketPrices ─────────────────────────────────

  describe("collectMarketPrices", () => {
    it("正常采集 → 最低卖价 + 最高买价", () => {
      const resources = ["H", "O"];
      const sellOrders = {
        H: [{ price: 0.5 }, { price: 0.6 }, { price: 0.4 }],
        O: [{ price: 2.0 }],
      };
      const buyOrders = {
        H: [{ price: 0.3 }, { price: 0.35 }],
        O: [{ price: 1.5 }, { price: 1.8 }],
      };
      const result = collectMarketPrices(resources, sellOrders, buyOrders);
      expect(result.H).toEqual({ sellMin: 0.4, buyMax: 0.35 });
      expect(result.O).toEqual({ sellMin: 2.0, buyMax: 1.8 });
    });

    it("无卖单 → sellMin=0", () => {
      const resources = ["H"];
      const sellOrders = { H: [] };
      const buyOrders = { H: [{ price: 0.3 }] };
      const result = collectMarketPrices(resources, sellOrders, buyOrders);
      expect(result.H).toEqual({ sellMin: 0, buyMax: 0.3 });
    });

    it("无买单 → buyMax=0", () => {
      const resources = ["H"];
      const sellOrders = { H: [{ price: 0.5 }] };
      const buyOrders = { H: [] };
      const result = collectMarketPrices(resources, sellOrders, buyOrders);
      expect(result.H).toEqual({ sellMin: 0.5, buyMax: 0 });
    });

    it("资源在订单表中不存在 → sellMin=0, buyMax=0", () => {
      const resources = ["X"];
      const result = collectMarketPrices(resources, {}, {});
      expect(result.X).toEqual({ sellMin: 0, buyMax: 0 });
    });

    it("空资源列表 → 空结果", () => {
      const result = collectMarketPrices([], {}, {});
      expect(result).toEqual({});
    });
  });

  // ── computeOrderPrice ──────────────────────────────────

  describe("computeOrderPrice", () => {
    it("行情存在 → 返回最高买价 × markup（两位小数）", () => {
      const prices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0.3 },
      };
      const result = computeOrderPrice("H", prices, 1.15, 0.01);
      // 0.3 × 1.15 = 0.345 → 两位小数 = 0.35
      expect(result).toBe(0.35);
    });

    it("行情缺失但 fallback > 0 → 返回 fallback", () => {
      const prices: PriceTable = {};
      const result = computeOrderPrice("H", prices, 1.15, 0.5);
      expect(result).toBe(0.5);
    });

    it("行情缺失且 fallback = 0 → 返回 undefined", () => {
      const prices: PriceTable = {};
      const result = computeOrderPrice("H", prices, 1.15, 0);
      expect(result).toBeUndefined();
    });

    it("行情存在但 buyMax = 0 → 回退 fallback", () => {
      const prices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0 },
      };
      const result = computeOrderPrice("H", prices, 1.15, 0.3);
      expect(result).toBe(0.3);
    });

    it("markup=1.0 → 挂单价 = 最高买价", () => {
      const prices: PriceTable = {
        O: { sellMin: 2.0, buyMax: 1.5 },
      };
      const result = computeOrderPrice("O", prices, 1.0, 0.01);
      // 1.5 × 1.0 = 1.5 → 两位小数 = 1.5
      expect(result).toBe(1.5);
    });
  });

  // ── 通胀/通缩场景 ───────────────────────────────────────

  describe("通胀/通缩自适应", () => {
    it("通胀时 sellMin 上涨 → 买入上限自动上浮", () => {
      const beforePrices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0.3 },
      };
      const afterPrices: PriceTable = {
        H: { sellMin: 5.0, buyMax: 3.0 },
      };
      const before = computeDynamicBuyPrice("H", beforePrices, 1.1, 10);
      const after = computeDynamicBuyPrice("H", afterPrices, 1.1, 10);
      expect(after).toBeGreaterThan(before * 5);
      // 通胀 10 倍 → 买入上限也约 10 倍
      expect(after).toBeCloseTo(5.5, 10);
    });

    it("通缩时 buyMax 下降 → 卖出下限自动下降", () => {
      const beforePrices: PriceTable = {
        H: { sellMin: 5.0, buyMax: 3.0 },
      };
      const afterPrices: PriceTable = {
        H: { sellMin: 0.5, buyMax: 0.3 },
      };
      const before = computeDynamicSellPrice("H", beforePrices, 0.9, 0.01);
      const after = computeDynamicSellPrice("H", afterPrices, 0.9, 0.01);
      expect(after).toBeLessThan(before / 5);
      // 通缩 10 倍 → 卖出下限也约 10 倍下降
      expect(after).toBeCloseTo(0.27, 10);
    });

    it("行情空窗期 → fallback 兜底，不因缺失行情而停摆", () => {
      const emptyPrices: PriceTable = {};
      const buyMax = computeDynamicBuyPrice("H", emptyPrices, 1.1, 0.5);
      const sellMin = computeDynamicSellPrice("H", emptyPrices, 0.9, 0.01);
      expect(buyMax).toBe(0.5);
      expect(sellMin).toBe(0.01);
    });
  });
});
