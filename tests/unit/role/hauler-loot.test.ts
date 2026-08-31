/** Hauler 遗留能量回收链测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { haulerRole } from "../../../src/creeps/roles/hauler";
import { CONFIG } from "../../../src/config";
import {
  mockContext,
  mockCreep,
  mockPos,
  mockSnapshot,
  mockStore,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

/** 含能量的坟墓/废墟 mock（withdraw 目标，非 pickup）。 */
function mockRemains(id: string, energy: number): any {
  return { id, store: mockStore(energy, Math.max(energy, 1)), pos: mockPos() };
}

/** 地上掉落能量堆 mock。 */
function mockDropped(id: string, amount: number): any {
  return { id, amount, resourceType: "energy", pos: mockPos() };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("hauler — 遗留能量优先回收（衰减资源优先）", () => {
  it("大额掉落堆优先于 assignment 指定的 container（任务钉死不得绕过衰减优先）", () => {
    // 线上实测画像：矿位溢出堆 2500+ 每 tick 衰减 3，持有 haul 任务的 hauler
    // 却被钉死在同点位 container 上抽零头。大额遗留必须排在 assignment 之前。
    const c1 = mockStructure("container", { id: "c1", energy: 370, capacity: 2000 });
    const bigDrop = mockDropped("d1", 2500);
    const snap = mockSnapshot({ containers: [c1], droppedEnergy: [bigDrop] as any });
    const creep = mockCreep({
      name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire",
      assignment: { id: "t1", kind: "haul", sourceId: "c1", revision: 1, assignedAt: 900, leaseUntil: 2000 },
    });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.pickup).toHaveBeenCalledWith(bigDrop);
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("大额坟墓（≥ lootThreshold）优先于有能量的 container", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const tomb = mockRemains("tomb1", 300);
    const snap = mockSnapshot({ containers: [c1], tombstones: [tomb] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    haulerRole.run(creep, mockContext(snap));

    // 从坟墓 withdraw（限量 min(300, 100)），而非抽 container。
    expect(creep.withdraw).toHaveBeenCalledWith(tomb, "energy", 100);
  });

  it("大额废墟（如拆除建筑遗留库存）同样优先于 container", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const ruin = mockRemains("ruin1", 5000);
    const snap = mockSnapshot({ containers: [c1], ruins: [ruin] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(ruin, "energy", 100);
  });

  it("大堆掉落能量（≥ lootThreshold）优先于 container", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const drop = mockDropped("d1", CONFIG.economy.lootThreshold);
    const snap = mockSnapshot({ containers: [c1], droppedEnergy: [drop] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.pickup).toHaveBeenCalledWith(drop);
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("零头掉落（< lootThreshold）不插队 — 仍先抽最满 container（防溢出空转的既有取舍）", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const drop = mockDropped("d1", CONFIG.economy.lootThreshold - 1);
    const snap = mockSnapshot({ containers: [c1], droppedEnergy: [drop] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(c1, "energy", 100);
    expect(creep.pickup).not.toHaveBeenCalled();
  });

  it("container 全空时零头坟墓走链尾兜底（顺手清坟，不再直接 idle）", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 0, capacity: 2000 });
    const tomb = mockRemains("tomb1", 40);
    const snap = mockSnapshot({ containers: [c1], tombstones: [tomb] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(tomb, "energy", 40);
    expect(creep.memory.mode).toBe("acquire");
  });

  it("坟墓与废墟并存时选能量更多的（身边最大堆优先，减少衰减损耗）", () => {
    const tomb = mockRemains("tomb1", 150);
    const ruin = mockRemains("ruin1", 900);
    const snap = mockSnapshot({ tombstones: [tomb], ruins: [ruin] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(ruin, "energy", 100);
  });
});
