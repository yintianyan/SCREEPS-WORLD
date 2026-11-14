/** 物流延迟均值与健康度判定。 */
import { describe, expect, it } from "vitest";
import {
  averageLatency,
  computeLogisticsHealth,
} from "../../../src/domain/logistics/logistics-health";

describe("averageLatency", () => {
  it("空样本返回 0（无数据 ≠ 拥堵）", () => {
    expect(averageLatency([])).toBe(0);
  });

  it("取整数均值，负样本按 0 计", () => {
    expect(averageLatency([100, 200, 300])).toBe(200);
    expect(averageLatency([100, -50, 250])).toBe(117);
  });
});

describe("computeLogisticsHealth — congested 分支可达", () => {
  it("延迟 > 500 且分数落在 0.5–0.7 → congested", () => {
    const health = computeLogisticsHealth(
      [{ requested: 1000, delivered: 800, lost: 0 } as any],
      [],
      600,
      1000,
    );
    expect(health.avgLatency).toBe(600);
    expect(health.level).toBe("congested");
  });
});
