/**
 * Upgrade action 移动 range 回归测试。
 *
 * 事故背景：controller 常嵌在地形墙中，range1 唯一落点（controller
 * container 格）被站桩静态阻挡标 255 时，按 runAction 默认 range1 求路
 * 无解 — 满载 upgrader 石化在 range5 永不开工。upgrade 动作必须按
 * 交互距离 range3 移动（走近到 range3 即可升级）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgraderRole } from "../../../src/creeps/roles/upgrader";
import { moveToTarget } from "../../../src/creeps/movement";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  resetGlobals,
} from "../../role-helpers";

vi.mock("../../../src/creeps/movement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/creeps/movement")>();
  return { ...actual, moveToTarget: vi.fn(() => 0), registerAnchor: vi.fn() };
});

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("upgrade action — 按交互距离 range3 移动", () => {
  it("work 模式不在射程内时，moveToTarget 以 range 3 求路（而非默认 1）", () => {
    const controller = { id: "ctrl", my: true, pos: { x: 34, y: 28, getRangeTo: () => 5 } } as any;
    const snap = mockSnapshot({ controller });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 50, capacity: 50, mode: "work" });
    creep.pos.getRangeTo = vi.fn(() => 5); // 距 controller range 5。
    creep.upgradeController = vi.fn(() => ERR_NOT_IN_RANGE);

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
    expect(moveToTarget).toHaveBeenCalledWith(creep, controller, 3);
  });
});
