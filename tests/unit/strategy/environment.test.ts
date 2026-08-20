import { describe, expect, it } from "vitest";
import { evaluateEnvironment } from "../../../src/domain/strategy/environment";

describe("evaluateEnvironment — 环境画像 (P1-3)", () => {
  const baseMarket = { totalOrders: 0, buyOrders: 0, sellOrders: 0, credits: 0 };
  const baseDensity = { totalNeighbors: 0, ownedNeighbors: 0 };
  const baseGcl = { level: 1, progress: 0 };

  it("市场活跃度：>100 单 + credits>1M → active", () => {
    const result = evaluateEnvironment(1000, { ...baseMarket, totalOrders: 150, credits: 2_000_000 }, baseDensity, baseGcl);
    expect(result.marketActivity).toBe("active");
  });

  it("市场活跃度：>20 单 → moderate", () => {
    expect(evaluateEnvironment(1000, { ...baseMarket, totalOrders: 50, credits: 500 }, baseDensity, baseGcl).marketActivity).toBe("moderate");
    expect(evaluateEnvironment(1000, { ...baseMarket, totalOrders: 21, credits: 0 }, baseDensity, baseGcl).marketActivity).toBe("moderate");
  });

  it("市场活跃度：≤20 单 → thin", () => {
    expect(evaluateEnvironment(1000, { ...baseMarket, totalOrders: 20, credits: 0 }, baseDensity, baseGcl).marketActivity).toBe("thin");
    expect(evaluateEnvironment(1000, { ...baseMarket, totalOrders: 0, credits: 0 }, baseDensity, baseGcl).marketActivity).toBe("thin");
  });

  it("市场活跃度：>100 单但 credits<1M → moderate（credits 不足不算 active）", () => {
    expect(evaluateEnvironment(1000, { ...baseMarket, totalOrders: 200, credits: 500_000 }, baseDensity, baseGcl).marketActivity).toBe("moderate");
  });

  it("邻居压力：>50% 被占 → high", () => {
    const result = evaluateEnvironment(1000, baseMarket, { totalNeighbors: 10, ownedNeighbors: 6 }, baseGcl);
    expect(result.neighborPressure).toBe("high");
  });

  it("邻居压力：>20% 被占 → medium", () => {
    expect(evaluateEnvironment(1000, baseMarket, { totalNeighbors: 10, ownedNeighbors: 3 }, baseGcl).neighborPressure).toBe("medium");
    expect(evaluateEnvironment(1000, baseMarket, { totalNeighbors: 8, ownedNeighbors: 2 }, baseGcl).neighborPressure).toBe("medium");
  });

  it("邻居压力：≤20% → low", () => {
    expect(evaluateEnvironment(1000, baseMarket, { totalNeighbors: 10, ownedNeighbors: 2 }, baseGcl).neighborPressure).toBe("low");
    expect(evaluateEnvironment(1000, baseMarket, { totalNeighbors: 10, ownedNeighbors: 0 }, baseGcl).neighborPressure).toBe("low");
  });

  it("邻居压力：无邻房 → low（避免除零）", () => {
    expect(evaluateEnvironment(1000, baseMarket, { totalNeighbors: 0, ownedNeighbors: 0 }, baseGcl).neighborPressure).toBe("low");
  });

  it("GCL 速率：正常增长计算", () => {
    const result = evaluateEnvironment(2000, baseMarket, baseDensity, {
      level: 2,
      progress: 1000,
      prevTick: 1000,
      prevProgress: 500,
    });
    expect(result.gclProgressRate).toBe(0.5); // (1000-500)/(2000-1000)
  });

  it("GCL 速率：无历史数据 → 0", () => {
    expect(evaluateEnvironment(1000, baseMarket, baseDensity, { level: 1, progress: 0 }).gclProgressRate).toBe(0);
  });

  it("GCL 速率：负增长（降级）→ 0（不计入速率）", () => {
    const result = evaluateEnvironment(2000, baseMarket, baseDensity, {
      level: 1,
      progress: 100,
      prevTick: 1000,
      prevProgress: 500,
    });
    expect(result.gclProgressRate).toBe(0);
  });

  it("完整画像输出", () => {
    const result = evaluateEnvironment(5000, { totalOrders: 300, buyOrders: 150, sellOrders: 150, credits: 5_000_000 }, { totalNeighbors: 12, ownedNeighbors: 8 }, { level: 3, progress: 2000, prevTick: 4000, prevProgress: 1000 });
    expect(result).toEqual({
      marketActivity: "active",
      neighborPressure: "high",
      gclProgressRate: 1,
      tick: 5000,
    });
  });
});
