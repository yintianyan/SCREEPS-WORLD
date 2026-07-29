import { describe, expect, it, beforeEach, vi } from "vitest";
import { resetGlobals, mockCreep, mockSnapshot, mockContext } from "../../role-helpers";
import { selectDroppedEnergy, selectHaulSourceContainer } from "../../../src/creeps/support/targeting";
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

  it("身边无可拾取（range>1）时按 score=amount−dist×20 权衡，同量取近", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn((t: any) => t.__range);
    // 两堆能量相同，近者 score 更高（900−5×20=800 > 900−8×20=740）。
    const near = droppedRes("near", 900, 5);
    const far = droppedRes("far", 900, 8);
    const picked = selectDroppedEnergy(creep, [near, far]);
    expect(picked?.id).toBe("near");
  });

  it("远处大堆的抢救价值压过近处小堆（修复羊群效应：不再被近处小堆截胡）", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn((t: any) => t.__range);
    // 溢出大堆（远）：7000−16×20=6680；近处小堆：79−3×20=19。大堆胜。
    const overflowFar = droppedRes("overflow", 7000, 16);
    const scrapNear = droppedRes("scrap", 79, 3);
    const picked = selectDroppedEnergy(creep, [scrapNear, overflowFar]);
    expect(picked?.id).toBe("overflow");
  });

  it("近处大堆仍优先（距离权重不矫枉过正）", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn((t: any) => t.__range);
    // 近处大堆 2000−4×20=1920；远处中堆 500−10×20=300。近大堆胜。
    const bigNear = droppedRes("bigNear", 2000, 4);
    const midFar = droppedRes("midFar", 500, 10);
    const picked = selectDroppedEnergy(creep, [midFar, bigNear]);
    expect(picked?.id).toBe("bigNear");
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

/** 构造 container mock：__range 供 getRangeTo 读取，store 记能量。 */
function containerMock(id: string, energy: number, range: number): any {
  return {
    id, __range: range,
    store: { getUsedCapacity: () => energy },
  };
}

describe("selectHaulSourceContainer — 取能 container 选择（满溢 vs 距离 + 散布）", () => {
  beforeEach(() => resetGlobals());

  it("空列表返回 undefined", () => {
    const creep = mockCreep({ role: "hauler" });
    expect(selectHaulSourceContainer(creep, [])).toBeUndefined();
  });

  it("满溢程度差距明显时优先疏解更满者（距离项不足以翻转千级能量差）", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn((t: any) => t.__range);
    // 满仓远（2000−20×10=1800）vs 半仓近（1000−2×10=980）。满仓胜，优先疏解防溢出。
    const fullFar = containerMock("full", 2000, 20);
    const halfNear = containerMock("half", 1000, 2);
    const picked = selectHaulSourceContainer(creep, [fullFar, halfNear]);
    expect(picked?.id).toBe("full");
  });

  it("两侧同为满仓时按距离分流（近者优先，不再恒选数组首个）", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn((t: any) => t.__range);
    // 都 2000 满：东近（2000−14×10=1860）胜西远（2000−20×10=1800）。
    const westFull = containerMock("west", 2000, 20);
    const eastFull = containerMock("east", 2000, 14);
    const picked = selectHaulSourceContainer(creep, [westFull, eastFull]);
    expect(picked?.id).toBe("east");
  });

  it("跳过空 container", () => {
    const creep = mockCreep({ role: "hauler" });
    creep.pos.getRangeTo = vi.fn((t: any) => t.__range);
    const empty = containerMock("empty", 0, 1);
    const hasEnergy = containerMock("has", 500, 10);
    const picked = selectHaulSourceContainer(creep, [empty, hasEnergy]);
    expect(picked?.id).toBe("has");
  });
});
