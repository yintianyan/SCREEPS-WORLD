/**
 * #156：builder 价格弹性的"帝国盈余"豁免（人已授权：强房供养弱房发展）。
 *
 * 立案现场＝弱房 W38S56 本地净流因开发支出转负（ws −6,311/550＝−11.5/拍）而被本房价格信号
 * 砍掉 builder 编制，同时兄弟房 W37S58 闲置 868K 能量（phase="steady"）。
 */
import { describe, expect, it } from "vitest";
import {
  EMPIRE_DEVELOPMENT_SURPLUS,
  isBuilderElasticityExempt,
} from "../../../src/domain/spawn/demand";

describe("builder 弹性豁免（帝国盈余）", () => {
  it("帝国储量达标 且 本房有待建 backlog ⇒ 豁免收缩（弱房按既有目标编制）", () => {
    expect(isBuilderElasticityExempt(EMPIRE_DEVELOPMENT_SURPLUS, 1)).toBe(true);
    expect(isBuilderElasticityExempt(868_000, 17)).toBe(true);
  });

  it("没有 backlog ⇒ 不豁免（没工地就不该为'发展'打开这条路）", () => {
    expect(isBuilderElasticityExempt(900_000, 0)).toBe(false);
  });

  it("帝国储量不达标 ⇒ 不豁免（价格弹性照旧收缩，保留原防浪费语义）", () => {
    expect(isBuilderElasticityExempt(EMPIRE_DEVELOPMENT_SURPLUS - 1, 5)).toBe(false);
    expect(isBuilderElasticityExempt(0, 5)).toBe(false);
  });

  it("边界＝门槛本身算达标（>= 不是 >，别把阈值读成开区间）", () => {
    expect(isBuilderElasticityExempt(EMPIRE_DEVELOPMENT_SURPLUS, 1)).toBe(true);
    expect(EMPIRE_DEVELOPMENT_SURPLUS).toBeGreaterThanOrEqual(100_000);
  });
});
