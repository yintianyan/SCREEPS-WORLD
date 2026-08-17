/**
 * PB 野采决策纯函数测试（审计缺口 2）。
 *
 * 覆盖：
 *   selectPowerBankTarget：
 *   - 新鲜 intel + 距离内 + 未占用 → 最近者优先
 *   - 过期 intel / 超距 / 占用房 / 无 PB → 排除
 *   isPowerFarmTimedOut / isPowerFarmAttritionLost：边界含等号语义
 */
import { describe, expect, it } from "vitest";
import {
  isPowerFarmAttritionLost,
  isPowerFarmTimedOut,
  selectPowerBankTarget,
  type PowerBankCandidate,
} from "../../../src/domain/war/power-farm";

function pb(opts: Partial<PowerBankCandidate> & { roomName: string }): PowerBankCandidate {
  return {
    home: "W7N4",
    lastSeen: 1000,
    powerBank: true,
    linearDistance: 3,
    occupied: false,
    ...opts,
  };
}

describe("selectPowerBankTarget — PB 野采目标选择", () => {
  const opts = { freshness: 2000, maxRange: 7 };

  it("新鲜 intel + 距离内 → 最近者优先", () => {
    const result = selectPowerBankTarget(
      [pb({ roomName: "A", linearDistance: 5 }), pb({ roomName: "B", linearDistance: 2 })],
      1500,
      opts,
    );
    expect(result?.roomName).toBe("B");
  });

  it("过期 intel（PB 可能已自灭）→ 排除", () => {
    const result = selectPowerBankTarget(
      [pb({ roomName: "A", lastSeen: 100 })],
      5000,
      opts,
    );
    expect(result).toBeUndefined();
  });

  it("超最大距离 → 排除", () => {
    const result = selectPowerBankTarget(
      [pb({ roomName: "A", linearDistance: 8 })],
      1500,
      opts,
    );
    expect(result).toBeUndefined();
  });

  it("占用房（远矿 op/扩张目标）→ 排除", () => {
    const result = selectPowerBankTarget(
      [pb({ roomName: "A", occupied: true })],
      1500,
      opts,
    );
    expect(result).toBeUndefined();
  });

  it("intel 无 PB 标记 → 排除", () => {
    const result = selectPowerBankTarget(
      [pb({ roomName: "A", powerBank: false })],
      1500,
      opts,
    );
    expect(result).toBeUndefined();
  });

  it("无候选 → undefined", () => {
    expect(selectPowerBankTarget([], 1500, opts)).toBeUndefined();
  });
});

describe("野采任务边界判定", () => {
  it("超时判定：恰好等于 timeout 不算超（宽限含等号）", () => {
    expect(isPowerFarmTimedOut(1000, 9000, 8000)).toBe(false);
    expect(isPowerFarmTimedOut(1000, 9001, 8000)).toBe(true);
  });

  it("止损判定：spawned 恰等于编队 × 倍数不算失败（含等号宽限）", () => {
    // 6 编制 × 2 = 12：12 不触发，13 触发。
    expect(isPowerFarmAttritionLost(12, 6, 2)).toBe(false);
    expect(isPowerFarmAttritionLost(13, 6, 2)).toBe(true);
  });
});
