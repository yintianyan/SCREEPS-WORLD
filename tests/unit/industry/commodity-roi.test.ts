/** commodityBatchRoi —— factory 采购需求的正 ROI 闸（#51 后半支）。 */
import { describe, expect, it } from "vitest";
import { commodityBatchRoi } from "../../../src/domain/industry/market-pricing";

const MARGIN = 0.35;

describe("commodityBatchRoi — 买中间品产商品的价格闸", () => {
  it("线上实测的倒挂行情 ⇒ 不发布需求", () => {
    // @00:51Z 实测：utrium_bar 最低卖 279.7、silicon 最低卖 2973.639、wire 最高买 253.16、一批产 20。
    // 一批买料代价 = 20×279.7 + 100×2973.639 = 302,958 credits，卖出额仅 5,063 ⇒ 回收率 1.7%。
    const prices = {
      utrium_bar: { sellMin: 279.7, buyMax: 0 },
      silicon: { sellMin: 2973.639, buyMax: 0 },
      wire: { sellMin: 0, buyMax: 253.16 },
    };
    const roi = commodityBatchRoi({ utrium_bar: 20, silicon: 100 }, prices, "wire", 20, MARGIN);
    expect(roi.cost).toBeCloseTo(302957.9, 1);
    expect(roi.revenue).toBeCloseTo(5063.2, 1);
    expect(roi.profitable).toBe(false);
  });

  it("料价低于产物收益 × (1+margin) ⇒ 发布需求", () => {
    // 买齐 120 单位料花 1,000，卖 20 个收 2,000 ⇒ 2,000 ≥ 1,000×1.35。
    const prices = {
      utrium_bar: { sellMin: 5, buyMax: 0 },
      silicon: { sellMin: 4, buyMax: 0 },
      wire: { sellMin: 0, buyMax: 100 },
    };
    const roi = commodityBatchRoi({ utrium_bar: 20, silicon: 100 }, prices, "wire", 20, MARGIN);
    // cost = 100 + 400 = 500（能量不计入买入成本）。
    expect(roi.cost).toBe(500);
    expect(roi.revenue).toBe(2000);
    expect(roi.profitable).toBe(true);
  });

  it("margin 两侧各给明确余量 ⇒ 分别放行/拦下（不拿浮点边界当判据）", () => {
    // cost 1000 ⇒ 门槛 1350。revenue 1420 > 1350 ⇒ 放行；1200 < 1350 ⇒ 拦下。
    const above = commodityBatchRoi(
      { silicon: 100 },
      { silicon: { sellMin: 10, buyMax: 0 }, wire: { sellMin: 0, buyMax: 14.2 } },
      "wire",
      100,
      MARGIN,
    );
    expect(above.profitable).toBe(true);
    const below = commodityBatchRoi(
      { silicon: 100 },
      { silicon: { sellMin: 10, buyMax: 0 }, wire: { sellMin: 0, buyMax: 12 } },
      "wire",
      100,
      MARGIN,
    );
    expect(below.profitable).toBe(false);
  });

  it("缺料没有卖单 ⇒ 不可行（买不到，别把需求发出去空转）", () => {
    const prices = { silicon: { sellMin: 0, buyMax: 0 }, wire: { sellMin: 0, buyMax: 1000 } };
    const roi = commodityBatchRoi({ silicon: 10 }, prices, "wire", 1, MARGIN);
    expect(roi.profitable).toBe(false);
  });

  it("产物没有买单 ⇒ 不可行（产了卖不掉就是压在库里的死料）", () => {
    const prices = { silicon: { sellMin: 1, buyMax: 0 }, wire: { sellMin: 0, buyMax: 0 } };
    const roi = commodityBatchRoi({ silicon: 10 }, prices, "wire", 1, MARGIN);
    expect(roi.profitable).toBe(false);
  });

  it("能量缺口不计入买入成本（自有产能，按市价计会把净流判成亏损）", () => {
    const prices = { energy: { sellMin: 500, buyMax: 0 }, wire: { sellMin: 0, buyMax: 100 } };
    const roi = commodityBatchRoi({ energy: 1000 }, prices, "wire", 1, MARGIN);
    expect(roi.cost).toBe(0);
    expect(roi.profitable).toBe(true);
  });
});
