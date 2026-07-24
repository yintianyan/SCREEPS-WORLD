import { describe, expect, it, beforeEach, vi } from "vitest";
import { resetGlobals, mockCreep, mockSnapshot, mockContext } from "../../role-helpers";
import { selectDroppedEnergy } from "../../../src/creeps/support/targeting";
import { haulerRole } from "../../../src/creeps/roles/hauler";

/** 构造掉落能量 mock：__range 供 creep.pos.getRangeTo 读取距该堆的距离。 */
function droppedRes(id: string, amount: number, range: number): any {
  return { id, amount, resourceType: "energy", pos: { x: 25, y: 25 }, __range: range };
}

describe("selectDroppedEnergy — 拾取目标选择（范围 + 衰减）", () => {
  beforeEach(() => resetGlobals());

  it("空列表返回 undefined", () => {
    const creep = mockCreep({ role: "hauler" });
    expect(selectDroppedEnergy(creep, [])).toBeUndefined();
  });

  it("身边（range≤1）多堆时优先拾取能量最多的一堆（衰减更快，先拿大堆）", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn((t: any) => t.__range);
    const small = droppedRes("small", 10, 1);
    const big = droppedRes("big", 500, 1);
    const onTile = droppedRes("onTile", 50, 0);
    const picked = selectDroppedEnergy(creep, [small, big, onTile]);
    expect(picked?.id).toBe("big");
  });

  it("身边无可拾取（range>1）时走向最近的一堆", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn(() => 5); // 均不相邻
    const far1 = droppedRes("f1", 300, 5);
    const far2 = droppedRes("f2", 900, 8);
    // findClosestByRange 返回数组首元素（mock 约定）。
    creep.pos.findClosestByRange = vi.fn((arr: any[]) => arr[0]);
    const picked = selectDroppedEnergy(creep, [far1, far2]);
    expect(picked?.id).toBe("f1");
    expect(creep.pos.findClosestByRange).toHaveBeenCalled();
  });

  it("身边有可拾取时不触发 findClosestByRange（省一次寻路）", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn(() => 1);
    creep.pos.findClosestByRange = vi.fn((arr: any[]) => arr[0]);
    selectDroppedEnergy(creep, [droppedRes("a", 100, 1)]);
    expect(creep.pos.findClosestByRange).not.toHaveBeenCalled();
  });
});

describe("pickupDroppedEnergy — 装满前持续拾取", () => {
  beforeEach(() => resetGlobals());

  it("拾取后未装满则保持 acquire 模式（下 tick 继续拾取不同的堆）", () => {
    const snap = mockSnapshot({ droppedEnergy: [droppedRes("d1", 100, 1)] });
    const creep = mockCreep({ role: "hauler", mode: "acquire", used: 10, capacity: 100 });
    creep.pos.getRangeTo = vi.fn(() => 1);
    haulerRole.run(creep, mockContext(snap));
    expect(creep.pickup).toHaveBeenCalled();
    expect(creep.memory.mode).toBe("acquire"); // 未满 → 继续拾取
  });

  it("拾取返回 ERR_FULL（背包满）时切换到 work 模式", () => {
    const snap = mockSnapshot({ droppedEnergy: [droppedRes("d1", 100, 1)] });
    const creep = mockCreep({ role: "hauler", mode: "acquire", used: 50, capacity: 100 });
    creep.pos.getRangeTo = vi.fn(() => 1);
    creep.pickup = vi.fn(() => -8); // ERR_FULL
    haulerRole.run(creep, mockContext(snap));
    expect(creep.memory.mode).toBe("work");
  });
});
