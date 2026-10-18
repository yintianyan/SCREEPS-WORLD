/**
 * commodityConvertRoi + selectCommodityTarget 的生产侧 ROI 闸。
 *
 * 用例里的价格不是编的 —— 全部取自官服 shard3 tick 83,725,692 的当拍行情快照
 * （`globalThis.marketPrices.prices`，见 EVOLUTION-ROADMAP 该轮记录）。用真值的目的：
 * 这一族闸的判据是"两把尺差多少"，编出来的价格很容易刚好落在闸的同一侧，
 * 于是用例永远绿、线上永远亏。
 */
import { describe, expect, it } from "vitest";
import { commodityConvertRoi } from "../../../src/domain/industry/market-pricing";
import {
  selectCommodityTarget,
  type CommodityRecipe,
} from "../../../src/domain/industry/commodity";

const MARGIN = 0.35;

/** 官服 shard3 实测行情（tick 83,725,692）。注意 O 与 K 是**交叉报价**：buyMax > sellMin。 */
const LIVE_PRICES = {
  O: { sellMin: 27.091, buyMax: 37.846 },
  H: { sellMin: 206, buyMax: 127.578 },
  Z: { sellMin: 13.158, buyMax: 12.541 },
  K: { sellMin: 9.06, buyMax: 13.62 },
  GO: { sellMin: 224.853, buyMax: 134.474 },
  UL: { sellMin: 186.093, buyMax: 102.899 },
  G: { sellMin: 685.482, buyMax: 422.92 },
  energy: { sellMin: 30.95, buyMax: 32.186 },
  battery: { sellMin: 339.114, buyMax: 200 },
};

/** 引擎 COMMODITIES 实读（同一发探针）：oxidant/reductant 都是 500 矿 + 200 能量 → 100。 */
const OXIDANT: CommodityRecipe = {
  resourceType: "GO",
  level: 1,
  amount: 100,
  components: { O: 500, energy: 200 },
};
const REDUCTANT: CommodityRecipe = {
  resourceType: "UL",
  level: 1,
  amount: 100,
  components: { H: 500, energy: 200 },
};

describe("commodityConvertRoi — 自有库存转换的机会成本闸", () => {
  it("官服现场：oxidant 深度倒挂 ⇒ 不划算（判得了）", () => {
    // 投入 500 O(37.846) + 200 energy(32.186) = 25,360.2；产出 100 GO(134.474) = 13,447.4。
    const roi = commodityConvertRoi(OXIDANT.components, LIVE_PRICES, "GO", 100, MARGIN);
    expect(roi.judgeable).toBe(true);
    expect(roi.cost).toBeCloseTo(25360.2, 1);
    expect(roi.revenue).toBeCloseTo(13447.4, 1);
    expect(roi.profitable).toBe(false);
  });

  it("官服现场：reductant 更狠（回收率 15%）⇒ 不划算", () => {
    const roi = commodityConvertRoi(REDUCTANT.components, LIVE_PRICES, "UL", 100, MARGIN);
    expect(roi.judgeable).toBe(true);
    expect(roi.profitable).toBe(false);
    // 回收率 = revenue/cost，写进断言免得日后被人当成"差不多打平"。
    expect(roi.revenue / roi.cost).toBeLessThan(0.2);
  });

  it("机会成本按 buyMax 估，不按 sellMin —— 两把尺在交叉市场里差 40%", () => {
    // O 的 sellMin 27.091 而 buyMax 37.846。按 sellMin 算：成本 13,545.5 + 能量 6,190
    // = 19,735.5，门槛 ×1.35 = 26,643 ⇒ 仍不划算，但回收率会被读成 68% 而不是 53%。
    // 这条用例钉的是"用了哪把尺"，不是"结论翻不翻"——所以直接断成本数值。
    const roi = commodityConvertRoi(OXIDANT.components, LIVE_PRICES, "GO", 100, MARGIN);
    expect(roi.cost).toBeCloseTo(500 * 37.846 + 200 * 32.186, 1);
  });

  it("能量计入机会成本（与 commodityBatchRoi 的取舍相反）", () => {
    // battery: 600 energy → 50 battery。能量若不计，成本为 0 ⇒ 任何正收益都放行；
    // 计入后 600×32.186 = 19,311.6 对 50×200 = 10,000 ⇒ 拦下。
    const roi = commodityConvertRoi({ energy: 600 }, LIVE_PRICES, "battery", 50, MARGIN);
    expect(roi.judgeable).toBe(true);
    expect(roi.profitable).toBe(false);
  });

  it("行情表整个为空 ⇒ 判不了（不是不划算），调用方不得据此停产", () => {
    const roi = commodityConvertRoi(OXIDANT.components, {}, "GO", 100, MARGIN);
    expect(roi.judgeable).toBe(false);
    expect(roi.profitable).toBe(false);
  });

  it("单个组件两价都缺 ⇒ 判不了（无法估值就不动手）", () => {
    const prices = { ...LIVE_PRICES, O: { sellMin: 0, buyMax: 0 } };
    expect(commodityConvertRoi(OXIDANT.components, prices, "GO", 100, MARGIN).judgeable).toBe(
      false,
    );
  });

  it("产物无买盘 ⇒ 判得了且不划算（卖了等于砸在手里）", () => {
    const prices = { ...LIVE_PRICES, GO: { sellMin: 224.853, buyMax: 0 } };
    const roi = commodityConvertRoi(OXIDANT.components, prices, "GO", 100, MARGIN);
    expect(roi.judgeable).toBe(true);
    expect(roi.profitable).toBe(false);
  });

  it("margin 两侧各给明确余量 ⇒ 分别放行/拦下（不拿浮点边界当判据）", () => {
    // 成本固定 1,000（O 500 × 2.0）⇒ 门槛 1,350。产物买价 14.2 → 收益 1,420 放行；
    // 12.0 → 1,200 拦下。
    const prices = { O: { sellMin: 0, buyMax: 2 }, GO: { sellMin: 0, buyMax: 14.2 } };
    expect(commodityConvertRoi({ O: 500 }, prices, "GO", 100, MARGIN).profitable).toBe(true);
    const cheap = { O: { sellMin: 0, buyMax: 2 }, GO: { sellMin: 0, buyMax: 12 } };
    expect(commodityConvertRoi({ O: 500 }, cheap, "GO", 100, MARGIN).profitable).toBe(false);
  });

  it("amount 缺省按 1 ⇒ 收益被低估两个数量级（钉住 collectRecipes 必须带 amount）", () => {
    // 同一份行情，batchUnits=1 时收益 134.474 对成本 25,360 ⇒ 不划算；
    // batchUnits=100 时才有可比性。这条用例的作用是防回归：collectRecipes 若漏传
    // COMMODITIES[x].amount，闸会把**一切**配方误拦，症状和"行情倒挂"一模一样。
    const one = commodityConvertRoi(OXIDANT.components, LIVE_PRICES, "GO", 1, MARGIN);
    expect(one.revenue).toBeCloseTo(134.474, 3);
    expect(one.profitable).toBe(false);
  });
});

describe("selectCommodityTarget — 生产侧 ROI 闸接线", () => {
  // 原料齐备（factory+storage 合计够一批），梯度也允许 ⇒ 旧行为下必产。
  const FACTORY = { O: 500, energy: 50000 };
  const STORAGE = { H: 500 };

  it("不传 roiGate ⇒ 完全按旧行为（梯度 + 原料），零行为改动", () => {
    expect(selectCommodityTarget(FACTORY, STORAGE, 1, [OXIDANT], 5000)?.resourceType).toBe("GO");
  });

  it("传了 roiGate 且行情判得了倒挂 ⇒ 拦下（这是线上真正会亏钱的那一格）", () => {
    const got = selectCommodityTarget(FACTORY, STORAGE, 1, [OXIDANT], 5000, {
      prices: LIVE_PRICES,
      margin: MARGIN,
    });
    expect(got).toBeUndefined();
  });

  it("行情表为空（私服/测试无市场 API）⇒ 判不了 ⇒ 不拦，保持可产", () => {
    const got = selectCommodityTarget(FACTORY, STORAGE, 1, [OXIDANT], 5000, {
      prices: {},
      margin: MARGIN,
    });
    expect(got?.resourceType).toBe("GO");
  });

  it("多配方时只跳过倒挂的那条，梯度次高的划算配方仍能当选", () => {
    // reductant 倒挂（回收 15%）；造一条划算的 T1：投入 O 500(37.846)=18,923，
    // 产物买价拉到 400 ⇒ 收益 40,000 ≥ 18,923×1.35 ⇒ 放行。
    const profitable: CommodityRecipe = {
      resourceType: "GO",
      level: 1,
      amount: 100,
      components: { O: 500 },
    };
    const richPrices = { ...LIVE_PRICES, GO: { sellMin: 0, buyMax: 400 } };
    const got = selectCommodityTarget(FACTORY, STORAGE, 1, [REDUCTANT, profitable], 5000, {
      prices: richPrices,
      margin: MARGIN,
    });
    // REDUCTANT 需要 H，storage 有 500 ⇒ 原料也齐，纯粹是被 ROI 闸拦下。
    expect(got?.components).toEqual({ O: 500 });
  });
});
