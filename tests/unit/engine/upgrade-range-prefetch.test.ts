/**
 * upgrade 系 action 的射程预判契约 —— 与 runAction 预判同源，钉住「不为注定被拒的
 * 签发付钱」这条不变量（实测发育房每 tick 约 1 次 range>3 的 upgrade 空签发）。
 *
 * 三个都必须钉住的行为：
 *   1. 射程外：不签发 upgradeController，但 creep 必须开始靠拢（不能原地不动）。
 *   2. 射程内：正常签发，不产生移动。
 *   3. 射程内却被引擎拒绝（跨房 getRangeTo 不作保证）：仍按原契约移动 —— 预判是
 *      加上的快路径，不是替换掉的兜底。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  upgradeController,
  upgradeControllerGated,
} from "../../../src/creeps/engine/actions/upgrade";
import {
  mockBudget,
  mockContext,
  mockController,
  mockCreep,
  mockSnapshot,
  resetGlobals,
} from "../../support/factories";

/** 控制器放到 (cx,cy)，creep 固定在 (25,25) —— mockPos 按坐标真实算切比雪夫距离。 */
function makeAc(opts: { ctrlX: number; ctrlY: number; energyAvailable?: number }): any {
  const ctrl = mockController();
  ctrl.pos.x = opts.ctrlX;
  ctrl.pos.y = opts.ctrlY;
  const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 50, capacity: 50 });
  const snapshot = mockSnapshot({
    controller: ctrl,
    energyAvailable: opts.energyAvailable ?? 500,
  });
  return {
    creep,
    ctrl,
    snapshot,
    assignment: undefined,
    budget: mockBudget(),
    ctx: mockContext(snapshot),
  };
}

/** 靠拢意图是否发出：move/moveTo 哪一条是出口取决于 traffic 开关，两者任一即算。 */
function moveIssued(creep: any): boolean {
  return creep.move.mock.calls.length + creep.moveTo.mock.calls.length > 0;
}

describe("upgrade 射程预判", () => {
  beforeEach(() => {
    resetGlobals();
  });

  it("upgradeController：射程外不签发，直接改为靠拢", () => {
    const ac = makeAc({ ctrlX: 35, ctrlY: 25 }); // 距离 10 > UPGRADE_RANGE

    upgradeController().execute(ac, ac.ctrl);

    expect(ac.creep.upgradeController).not.toHaveBeenCalled();
    expect(moveIssued(ac.creep)).toBe(true);
  });

  it("upgradeController：射程内照常签发，不发移动", () => {
    const ac = makeAc({ ctrlX: 27, ctrlY: 25 }); // 距离 2 <= UPGRADE_RANGE

    upgradeController().execute(ac, ac.ctrl);

    expect(ac.creep.upgradeController).toHaveBeenCalledWith(ac.ctrl);
    expect(moveIssued(ac.creep)).toBe(false);
  });

  it("upgradeController：射程内仍被引擎拒绝时，兜底移动不改", () => {
    const ac = makeAc({ ctrlX: 27, ctrlY: 25 });
    ac.creep.upgradeController.mockReturnValue(ERR_NOT_IN_RANGE);

    upgradeController().execute(ac, ac.ctrl);

    expect(ac.creep.upgradeController).toHaveBeenCalledTimes(1);
    expect(moveIssued(ac.creep)).toBe(true);
  });

  it("upgradeControllerGated：门禁放行也不改变射程预判", () => {
    const ac = makeAc({ ctrlX: 35, ctrlY: 25, energyAvailable: 500 });

    upgradeControllerGated().execute(ac, ac.ctrl);

    expect(ac.creep.upgradeController).not.toHaveBeenCalled();
    expect(moveIssued(ac.creep)).toBe(true);
  });

  it("upgradeControllerGated：能量门禁拦在射程判断之前", () => {
    // 门禁不看距离 —— 能量不足时连候选都不解析，射程预判与移动都不会发生。
    const ac = makeAc({ ctrlX: 25, ctrlY: 25, energyAvailable: 0 });
    expect(upgradeControllerGated().resolve(ac)).toBeUndefined();

    const funded = makeAc({ ctrlX: 25, ctrlY: 25 });
    expect(upgradeControllerGated().resolve(funded)).toBe(funded.ctrl);
  });
});
