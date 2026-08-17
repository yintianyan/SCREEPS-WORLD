/**
 * planMineralAid — 跨房矿物互济纯函数决策测试。
 *
 * 覆盖：
 *   正常路径：
 *   - 姐妹房 homeMineral 盈余 → 缺口房：量受 缺口/盈余/上限 三重约束
 *   - 缺口最大者优先（与市场买入同排序口径）
 *   边界条件：
 *   - 捐赠方存量 ≤ 保留量（sellReserve）→ 不捐
 *   - 可送量 < 起送门禁 → 不送
 *   - 同房不互济（自给自足的缺口不触发自送）
 *   - 买入的非本房矿物库存不算盈余（只认 homeMineral 供给）
 *   异常情况：
 *   - 无接收方 / 无捐赠方 / 捐赠方 terminal 冷却 → undefined
 */
import { describe, expect, it } from "vitest";
import { planMineralAid, type RoomMineralState } from "../../../src/domain/economy/mineral-logistics";

const OPTS = { donorReserve: 3000, maxTransfer: 1000, minTransfer: 100 };

/**
 * 全满库存基线（与 terminal-policy 的 MINERAL_RESERVE_TARGET 同口径）。
 * 缺口函数对 7 种基础矿物全量计算 — 造数时未列出的矿种按 0 计成 500 缺口，
 * 会把无关房间误变成最大缺口方。除被测矿种外一律从 FULL 起步。
 */
const FULL: Readonly<Record<string, number>> = { H: 500, O: 500, U: 500, L: 500, K: 500, Z: 500, X: 200 };

/** 基准房间：home U 存量由参数指定，其余矿物 0。 */
function room(
  roomName: string,
  overrides: Partial<RoomMineralState> = {},
): RoomMineralState {
  return {
    roomName,
    homeMineral: "U",
    homeStock: 0,
    inventory: {},
    canSend: true,
    canReceive: true,
    ...overrides,
  };
}

describe("planMineralAid — 正常路径", () => {
  it("姐妹房 homeMineral 盈余 → 缺口房，量受 缺口/盈余/上限 三重约束", () => {
    const donor = room("W1N1", { homeStock: 5000 }); // 盈余 2000
    const needy = room("W2N1", { homeMineral: "K", homeStock: 0, inventory: { U: 100 } }); // U 缺口 400
    const plan = planMineralAid([donor, needy], OPTS);
    expect(plan).toEqual({ from: "W1N1", to: "W2N1", mineral: "U", amount: 400 });
  });

  it("盈余小于缺口时按盈余封顶（不掏空捐赠方）", () => {
    const donor = room("W1N1", { homeStock: 3100 }); // 盈余 100
    const needy = room("W2N1", { homeMineral: "K", inventory: {} }); // U 缺口 500
    const plan = planMineralAid([donor, needy], OPTS);
    expect(plan).toEqual({ from: "W1N1", to: "W2N1", mineral: "U", amount: 100 });
  });

  it("缺口最大者优先 — 缺 U 500 的房先于缺 K 200 的房被服务", () => {
    const uDonor = room("W1N1", { homeStock: 4000, inventory: FULL });
    const kDonor = room("W3N1", { homeMineral: "K", homeStock: 4000, inventory: FULL });
    const uNeedy = room("W2N1", { homeMineral: "K", homeStock: 4000, inventory: { ...FULL, U: 0 } }); // 仅 U 缺 500
    const kNeedy = room("W4N1", { homeMineral: "Z", homeStock: 4000, inventory: { ...FULL, K: 300 } }); // 仅 K 缺 200
    const plan = planMineralAid([kDonor, uDonor, kNeedy, uNeedy], OPTS);
    // U 缺口 500 > K 缺口 200 → 先补 U。
    expect(plan).toEqual({ from: "W1N1", to: "W2N1", mineral: "U", amount: 500 });
  });
});

describe("planMineralAid — 边界条件", () => {
  it("捐赠方存量 ≤ 保留量 → 无捐赠（自用底线不可越）", () => {
    const donor = room("W1N1", { homeStock: 3000 }); // 恰等于 reserve
    const needy = room("W2N1", { homeMineral: "K", inventory: {} });
    expect(planMineralAid([donor, needy], OPTS)).toBeUndefined();
  });

  it("可送量 < 起送门禁 → 不送（不值得占一次 terminal 冷却）", () => {
    const donor = room("W1N1", { homeStock: 3050 }); // 盈余 50 < minTransfer 100
    const needy = room("W2N1", { homeMineral: "K", inventory: {} });
    expect(planMineralAid([donor, needy], OPTS)).toBeUndefined();
  });

  it("同房不互济 — 自家缺口不触发自家盈余外送再回购", () => {
    // W1N1 的 U 库存 100 < 目标 500 有缺口，同时它是 U 的 home 房但存量低于保留量。
    const only = room("W1N1", { homeStock: 100, inventory: {} });
    expect(planMineralAid([only], OPTS)).toBeUndefined();
  });

  it("买入的非本房矿物库存不算盈余 — 只认 homeMineral 供给", () => {
    // W1N1 home=U 无盈余，但囤了 4000 Z（为自家反应链买入）；W2N1 仅缺 Z。
    // 若 Z 库存被误认作盈余，holder 会向 needy 捐 Z — 那正是要防的回归。
    const holder = room("W1N1", { homeStock: 0, inventory: { ...FULL, Z: 4000 } });
    const needy = room("W2N1", { homeMineral: "K", homeStock: 3000, inventory: { ...FULL, Z: 0 } }); // 仅 Z 缺 500
    expect(planMineralAid([holder, needy], OPTS)).toBeUndefined();
  });
});

describe("planMineralAid — 异常情况", () => {
  it("无接收方（缺口全补齐）→ undefined", () => {
    // 两房库存全满无缺口；若 donor 的 inventory 留空，7 种矿物全按 0 计缺口，
    // donor 自己会变成需求方被 full 反向捐 K。
    const donor = room("W1N1", { homeStock: 5000, inventory: FULL });
    const full = room("W2N1", { homeMineral: "K", homeStock: 5000, inventory: FULL });
    expect(planMineralAid([donor, full], OPTS)).toBeUndefined();
  });

  it("无合格捐赠方（homeMineral 未知）→ undefined", () => {
    const noMineral = room("W1N1", { homeMineral: undefined, inventory: { U: 4000 } });
    const needy = room("W2N1", { homeMineral: "K", inventory: {} });
    expect(planMineralAid([noMineral, needy], OPTS)).toBeUndefined();
  });

  it("捐赠方 terminal 冷却（canSend=false）→ 不捐", () => {
    const donor = room("W1N1", { homeStock: 5000, canSend: false });
    const needy = room("W2N1", { homeMineral: "K", inventory: {} });
    expect(planMineralAid([donor, needy], OPTS)).toBeUndefined();
  });

  it("空房间列表 → undefined", () => {
    expect(planMineralAid([], OPTS)).toBeUndefined();
  });
});
