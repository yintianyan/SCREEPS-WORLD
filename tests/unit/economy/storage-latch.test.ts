/** 富 storage 闩锁：50K 停 / 100K 复的回差语义。 */
import { describe, expect, it } from "vitest";
import {
  nextStorageRichActive,
  nextUpgradeActive,
} from "../../../src/domain/economy/storage-latch";

const ENTER = 50000;
const RESUME = 100000;

describe("nextStorageRichActive", () => {
  it("首次运行：未达恢复水位（100K）保持关闭，即使高于进入水位", () => {
    expect(nextStorageRichActive(undefined, 0, ENTER, RESUME)).toBe(false);
    expect(nextStorageRichActive(undefined, ENTER - 1, ENTER, RESUME)).toBe(false);
    // 60K：在 50K–100K 区间，但此前从未激活 ⇒ 仍关闭（必须回血到 100K）。
    expect(nextStorageRichActive(undefined, 60000, ENTER, RESUME)).toBe(false);
    expect(nextStorageRichActive(undefined, RESUME, ENTER, RESUME)).toBe(true);
  });

  it("已激活：跌破进入水位（50K）才关闭", () => {
    expect(nextStorageRichActive(true, RESUME, ENTER, RESUME)).toBe(true);
    expect(nextStorageRichActive(true, 60000, ENTER, RESUME)).toBe(true);
    expect(nextStorageRichActive(true, ENTER, ENTER, RESUME)).toBe(true);
    expect(nextStorageRichActive(true, ENTER - 1, ENTER, RESUME)).toBe(false);
  });

  it("关闭后：50K–100K 区间保持关闭（消除阈值振荡）", () => {
    expect(nextStorageRichActive(false, ENTER, ENTER, RESUME)).toBe(false);
    expect(nextStorageRichActive(false, 60000, ENTER, RESUME)).toBe(false);
    expect(nextStorageRichActive(false, 99999, ENTER, RESUME)).toBe(false);
    expect(nextStorageRichActive(false, RESUME, ENTER, RESUME)).toBe(true);
  });
});

describe("nextUpgradeActive — 按 RCL 分档", () => {
  const RCL8_RESUME = 60000;

  it("RCL<8：50K 单门槛，无回差（57.9K 直接开，不要求 60K）", () => {
    expect(nextUpgradeActive(undefined, 7, 57942, ENTER, RCL8_RESUME)).toBe(true);
    expect(nextUpgradeActive(false, 7, 57942, ENTER, RCL8_RESUME)).toBe(true);
    expect(nextUpgradeActive(true, 6, 50000, ENTER, RCL8_RESUME)).toBe(true);
  });

  it("RCL<8：低于 50K 停（边界 49,999 停 / 50,000 开）", () => {
    expect(nextUpgradeActive(undefined, 7, 49999, ENTER, RCL8_RESUME)).toBe(false);
    expect(nextUpgradeActive(true, 7, 49999, ENTER, RCL8_RESUME)).toBe(false);
    expect(nextUpgradeActive(undefined, 6, 50000, ENTER, RCL8_RESUME)).toBe(true);
  });

  it("RCL8：回差未达 60K 且此前关闭 ⇒ 保持关闭（57.9K 不开）", () => {
    expect(nextUpgradeActive(undefined, 8, 57942, ENTER, RCL8_RESUME)).toBe(false);
    expect(nextUpgradeActive(false, 8, 59999, ENTER, RCL8_RESUME)).toBe(false);
    expect(nextUpgradeActive(false, 8, 60000, ENTER, RCL8_RESUME)).toBe(true);
  });

  it("RCL8：此前开启 ⇒ 只要 ≥50K 就保持开启", () => {
    expect(nextUpgradeActive(true, 8, 57942, ENTER, RCL8_RESUME)).toBe(true);
    expect(nextUpgradeActive(true, 8, 50000, ENTER, RCL8_RESUME)).toBe(true);
    expect(nextUpgradeActive(true, 8, 49999, ENTER, RCL8_RESUME)).toBe(false);
  });

  it("回归：RCL7 与 RCL8 在同一水位得到不同结论（死区的直接证据）", () => {
    expect(nextUpgradeActive(false, 7, 57942, ENTER, RCL8_RESUME)).toBe(true);
    expect(nextUpgradeActive(false, 8, 57942, ENTER, RCL8_RESUME)).toBe(false);
  });
});
