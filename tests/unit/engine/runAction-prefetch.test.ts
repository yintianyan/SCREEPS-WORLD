/**
 * runAction 射程预判的契约测试。
 *
 * 依据实测：一次引擎意图签发 ≈0.2 CPU，而 getRangeTo ≈16 uCPU；射程外的调用必然被引擎
 * 拒绝且不产生 intent，因此提前返回 ERR_NOT_IN_RANGE 与"调用后被拒"行为等价，只省下签发。
 * 这里钉住两分支 + handlers 分派，防止未来把省掉的调用改回去。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_RANGE_FAR,
  ACTION_RANGE_NEAR,
  runAction,
} from "../../../src/creeps/engine/actions/helpers";
import { mockCreep, mockStructure, resetGlobals } from "../../support/factories";

/** 把目标放到距 creep(25,25) 指定切比雪夫距离处。 */
function structureAt(x: number, y: number): any {
  const s = mockStructure("container", { id: `c_${x}_${y}` });
  s.pos.x = x;
  s.pos.y = y;
  return s;
}

describe("runAction — 射程预判", () => {
  beforeEach(() => {
    resetGlobals();
  });

  it("目标在射程内（<=3）时正常执行动作并返回其结果", () => {
    const creep = mockCreep({ name: "b_1", role: "builder" });
    const target = structureAt(26, 26); // 距离 1
    const action = vi.fn(() => OK);

    const result = runAction(creep, target, ACTION_RANGE_FAR, action);

    expect(action).toHaveBeenCalledTimes(1);
    expect(result).toBe(OK);
  });

  it("目标在射程外时不签发引擎调用，直接返回 ERR_NOT_IN_RANGE", () => {
    const creep = mockCreep({ name: "b_2", role: "builder" });
    const target = structureAt(35, 35); // 距离 10 > ACTION_RANGE_FAR
    const action = vi.fn(() => OK);

    const result = runAction(creep, target, ACTION_RANGE_FAR, action);

    // 省下的正是这一次注定被拒的签发（走向目标的路径由 moveToTarget 负责，
    // 其内部出口随 traffic 开关不同，不在本契约范围内）。
    expect(action).not.toHaveBeenCalled();
    expect(result).toBe(ERR_NOT_IN_RANGE);
  });

  it("射程档位由调用方决定：同一距离 2，邻接档拦下、远档放行", () => {
    // 钉住 workRange 不是装饰参数：引擎对 harvest/transfer/withdraw/pickup 的判定是
    // isNearTo（射程 1），对 build/repair 是 inRangeTo 3 —— 统一按 3 预判时，邻接动作
    // 在距离 2~3 的每一 tick 都白付一次签发（实测 1.31 次/tick）。
    const creep = mockCreep({ name: "b_3", role: "hauler" });
    const target = structureAt(27, 25); // 距离 2
    const action = vi.fn(() => OK);

    expect(runAction(creep, target, ACTION_RANGE_NEAR, action)).toBe(ERR_NOT_IN_RANGE);
    expect(action).not.toHaveBeenCalled();

    expect(runAction(creep, target, ACTION_RANGE_FAR, action)).toBe(OK);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("动作自身返回 ERR_NOT_IN_RANGE 时仍按原契约触发移动", () => {
    const creep = mockCreep({ name: "b_4", role: "builder" });
    const target = structureAt(26, 26); // 射程内，交给动作自己判定

    const result = runAction(creep, target, ACTION_RANGE_FAR, () => ERR_NOT_IN_RANGE);

    expect(result).toBe(ERR_NOT_IN_RANGE);
    // 两条路径（预判拦下 / 引擎拒绝）都必须让 creep 走向目标，不得原地不动。
    expect(creep.move).toHaveBeenCalled();
  });

  it("其他错误码走 handlers 分派表", () => {
    const creep = mockCreep({ name: "b_5", role: "builder" });
    const target = structureAt(26, 26);
    const onFull = vi.fn();

    runAction(creep, target, ACTION_RANGE_FAR, () => ERR_FULL, { [ERR_FULL]: onFull });

    expect(onFull).toHaveBeenCalledTimes(1);
  });
});
