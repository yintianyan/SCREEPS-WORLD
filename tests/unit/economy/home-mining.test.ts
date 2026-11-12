/** Phase C：home mineral 停采闩锁（10K 停 / 5K 复）。 */
import { describe, expect, it } from "vitest";
import {
  HOME_MINERAL_RESUME_STOCK,
  HOME_MINERAL_STOP_STOCK,
  nextHomeMineralMiningActive,
} from "../../../src/domain/economy/home-mining";

describe("nextHomeMineralMiningActive", () => {
  it("首次运行：低于恢复线才开采", () => {
    expect(nextHomeMineralMiningActive(undefined, 0, false)).toBe(true);
    expect(nextHomeMineralMiningActive(undefined, HOME_MINERAL_RESUME_STOCK - 1, false)).toBe(true);
    expect(nextHomeMineralMiningActive(undefined, HOME_MINERAL_RESUME_STOCK, false)).toBe(false);
    expect(nextHomeMineralMiningActive(undefined, 80000, false)).toBe(false);
  });

  it("已开启：库存达到停采线才关闭", () => {
    expect(nextHomeMineralMiningActive(true, HOME_MINERAL_STOP_STOCK - 1, false)).toBe(true);
    expect(nextHomeMineralMiningActive(true, HOME_MINERAL_STOP_STOCK, false)).toBe(false);
    expect(nextHomeMineralMiningActive(true, 80000, false)).toBe(false);
  });

  it("已关闭：必须跌破恢复线才重开（回差）", () => {
    expect(nextHomeMineralMiningActive(false, 6000, false)).toBe(false);
    expect(nextHomeMineralMiningActive(false, HOME_MINERAL_RESUME_STOCK, false)).toBe(false);
    expect(nextHomeMineralMiningActive(false, HOME_MINERAL_RESUME_STOCK - 1, false)).toBe(true);
  });

  it("有 ticket 时无视库存上限", () => {
    expect(nextHomeMineralMiningActive(undefined, 80000, true)).toBe(true);
    expect(nextHomeMineralMiningActive(false, 80000, true)).toBe(true);
    expect(nextHomeMineralMiningActive(true, 80000, true)).toBe(true);
  });

  it("自定义阈值生效", () => {
    expect(nextHomeMineralMiningActive(false, 7000, false, 8000, 7000)).toBe(false);
    expect(nextHomeMineralMiningActive(false, 6999, false, 8000, 7000)).toBe(true);
    expect(nextHomeMineralMiningActive(true, 7999, false, 8000, 7000)).toBe(true);
    expect(nextHomeMineralMiningActive(true, 8000, false, 8000, 7000)).toBe(false);
  });
});
