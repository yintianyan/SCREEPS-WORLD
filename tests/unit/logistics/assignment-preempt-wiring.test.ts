/** assignment-service 紧急抢占接线测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { assignmentSystem } from "../../../src/systems/assignment-system";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  resetGlobals,
} from "../../support/factories";

function upgradeAssignment(tick: number) {
  return {
    id: "upgrade:W7N4",
    kind: "upgrade",
    targetId: "controller_1",
    revision: 1,
    assignedAt: tick - 10,
    leaseUntil: tick + 40,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("assignment-service — 紧急抢占接线（invalidate 副作用落到 creep memory）", () => {
  it("正常 → 紧急上升沿：priority >= 1 的 assignment 被真实清除", () => {
    const tick = (globalThis as any).Game.time as number;
    const creep = mockCreep({ name: "upg1", role: "upgrader", assignment: upgradeAssignment(tick) });
    (globalThis as any).Game.creeps = { upg1: creep };
    (globalThis as any).Memory.rooms.W7N4.wasEmergency = false;

    // energyAvailable 100 < 动态阈值 min(800*0.4, 300)=300 → 紧急。
    const snapshot = mockSnapshot({ energyAvailable: 100, energyCapacityAvailable: 800 });
    assignmentSystem.run(mockContext(snapshot));

    // 接线断言：抢占必须穿透到 creep memory，而不只是纯函数返回 true。
    expect(creep.memory.assignment).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.wasEmergency).toBe(true);
  });

  it("非紧急：assignment 保留（抢占不误伤正常运转）", () => {
    const tick = (globalThis as any).Game.time as number;
    const creep = mockCreep({ name: "upg1", role: "upgrader", assignment: upgradeAssignment(tick) });
    (globalThis as any).Game.creeps = { upg1: creep };
    (globalThis as any).Memory.rooms.W7N4.wasEmergency = false;

    const snapshot = mockSnapshot({ energyAvailable: 500, energyCapacityAvailable: 800 });
    assignmentSystem.run(mockContext(snapshot));

    expect(creep.memory.assignment).toBeDefined();
  });

  it("持续紧急（非上升沿）：不重复清除，lease 机制保留", () => {
    const tick = (globalThis as any).Game.time as number;
    const creep = mockCreep({ name: "upg1", role: "upgrader", assignment: upgradeAssignment(tick) });
    (globalThis as any).Game.creeps = { upg1: creep };
    (globalThis as any).Memory.rooms.W7N4.wasEmergency = true; // 上一 tick 已紧急

    const snapshot = mockSnapshot({ energyAvailable: 100, energyCapacityAvailable: 800 });
    assignmentSystem.run(mockContext(snapshot));

    expect(creep.memory.assignment).toBeDefined();
  });

  it("敌袭上升沿同样触发抢占", () => {
    const tick = (globalThis as any).Game.time as number;
    const creep = mockCreep({ name: "upg1", role: "upgrader", assignment: upgradeAssignment(tick) });
    (globalThis as any).Game.creeps = { upg1: creep };
    (globalThis as any).Memory.rooms.W7N4.wasEmergency = false;

    const hostile = { id: "h1", name: "h1", pos: { x: 10, y: 10 }, owner: { username: "enemy" } };
    const snapshot = mockSnapshot({
      energyAvailable: 500,
      energyCapacityAvailable: 800,
      threatCreeps: [hostile as any],
    });
    assignmentSystem.run(mockContext(snapshot));

    expect(creep.memory.assignment).toBeUndefined();
  });
});
