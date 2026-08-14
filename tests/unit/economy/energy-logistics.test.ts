/**
 * 帝国能量互济与能量市场 — 纯函数测试（R5 经济主线）。
 *
 * 覆盖：
 *   - planEnergyAid：最饿者先救 / 最富者先捐 / 三重约束封顶 /
 *     同房不互济 / 门槛过滤（canSend/canReceive/地板/minTransfer）/
 *     无候选返回 undefined
 *   - 结构性滞回：受助方被补到 recipientFloor 后仍低于 donorFloor，
 *     单笔救助不可能让受助方翻转为捐赠方
 *   - energySellAmount / energyBuyAmount 边界
 */
import { describe, expect, it } from "vitest";
import {
  energyBuyAmount,
  energySellAmount,
  planEnergyAid,
  type RoomEnergyState,
} from "../../../src/domain/economy/energy-logistics";

const OPTS = {
  recipientFloor: 20000,
  donorFloor: 50000,
  maxTransfer: 10000,
  minTransfer: 2000,
};

function room(overrides: Partial<RoomEnergyState> = {}): RoomEnergyState {
  return {
    roomName: "W7N4",
    storageEnergy: 0,
    canSend: true,
    canReceive: true,
    ...overrides,
  };
}

describe("planEnergyAid — 跨房能量互济决策", () => {
  it("无受助候选（全部高于救助地板）→ undefined", () => {
    expect(
      planEnergyAid(
        [room({ storageEnergy: 30000 }), room({ storageEnergy: 80000 })],
        OPTS,
      ),
    ).toBeUndefined();
  });

  it("无捐赠候选（全部低于捐赠地板）→ undefined", () => {
    expect(
      planEnergyAid(
        [room({ storageEnergy: 5000 }), room({ storageEnergy: 40000 })],
        OPTS,
      ),
    ).toBeUndefined();
  });

  it("最富者捐赠最饿者：量 = min(缺口, 盈余, 上限)", () => {
    const plan = planEnergyAid(
      [
        room({ roomName: "W1N1", storageEnergy: 5000 }),        // 缺口 15000
        room({ roomName: "W2N2", storageEnergy: 10000 }),       // 缺口 10000
        room({ roomName: "W3N3", storageEnergy: 60000 }),       // 盈余 10000
        room({ roomName: "W4N4", storageEnergy: 90000 }),       // 盈余 40000（最富）
      ],
      OPTS,
    );
    expect(plan).toEqual({ from: "W4N4", to: "W1N1", amount: 10000 }); // min(15000, 40000, 10000)
  });

  it("捐赠后捐赠方仍高于捐赠地板；受助方补到救助地板后仍低于捐赠地板（结构滞回）", () => {
    const plan = planEnergyAid(
      [
        room({ roomName: "poor", storageEnergy: 18000 }),  // 缺口 2000（≥ minTransfer）
        room({ roomName: "rich", storageEnergy: 55000 }),  // 盈余 5000
      ],
      OPTS,
    );
    expect(plan?.amount).toBe(2000);
    // 受助方 18000 + 2000 = 20000 < donorFloor 50000 → 不可能翻转为捐赠方。
    expect(plan ? 18000 + plan.amount : 0).toBeLessThan(OPTS.donorFloor);
  });

  it("低于 minTransfer 不送（运费不划算）", () => {
    expect(
      planEnergyAid(
        [
          room({ roomName: "poor", storageEnergy: 19500 }), // 缺口 500 < 2000
          room({ roomName: "rich", storageEnergy: 80000 }),
        ],
        OPTS,
      ),
    ).toBeUndefined();
  });

  it("无 terminal（canReceive=false）的房间不是受助候选", () => {
    expect(
      planEnergyAid(
        [
          room({ roomName: "poor", storageEnergy: 1000, canReceive: false }),
          room({ roomName: "rich", storageEnergy: 80000 }),
        ],
        OPTS,
      ),
    ).toBeUndefined();
  });

  it("canSend=false 的房间不是捐赠候选", () => {
    expect(
      planEnergyAid(
        [
          room({ roomName: "poor", storageEnergy: 1000 }),
          room({ roomName: "rich", storageEnergy: 80000, canSend: false }),
        ],
        OPTS,
      ),
    ).toBeUndefined();
  });

  it("同房不互济（房间既是候选又是捐赠候选时跳过）", () => {
    // 只有一间房低于地板且高于捐赠地板不可能同时成立 — 验证防御性跳过不误判。
    expect(planEnergyAid([room({ storageEnergy: 80000 })], OPTS)).toBeUndefined();
  });
});

describe("energySellAmount — 能量溢出卖", () => {
  it("高于卖线卖出溢出部分，受单笔上限", () => {
    expect(energySellAmount(120000, 100000, 1000)).toBe(1000);
    expect(energySellAmount(105000, 100000, 1000)).toBe(1000);
    expect(energySellAmount(100500, 100000, 1000)).toBe(500);
  });

  it("不高于卖线不卖", () => {
    expect(energySellAmount(100000, 100000, 1000)).toBe(0);
    expect(energySellAmount(30000, 100000, 1000)).toBe(0);
  });
});

describe("energyBuyAmount — 危机能量买", () => {
  it("低于买线买缺口，受单笔上限与可负担量", () => {
    expect(energyBuyAmount(3000, 5000, 1000, 500)).toBe(500);
    expect(energyBuyAmount(0, 5000, 1000, 10000)).toBe(1000);
    expect(energyBuyAmount(4900, 5000, 1000, 10000)).toBe(100);
  });

  it("不低于买线 / 无购买力 → 0", () => {
    expect(energyBuyAmount(5000, 5000, 1000, 10000)).toBe(0);
    expect(energyBuyAmount(1000, 5000, 1000, 0)).toBe(0);
  });
});
