/** A3 — tower-defense 维修权收窄测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { towerDefenseSystem } from "../../../src/systems/tower-defense";
import {
  mockContext,
  mockSnapshot,
  mockStructure,
  registerObject,
  resetGlobals,
} from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  // P1-3：repairRooms 由 Kernel.buildSnapshots 预构建，测试中手动清除。
  delete (globalThis as any).repairRooms;
});

function makeTower(id: string): any {
  const tower = mockStructure("tower", { id, energy: 500, capacity: 1000 });
  tower.attack = vi.fn(() => 0);
  tower.repair = vi.fn(() => 0);
  return tower;
}

function makeThreat(id: string): any {
  const threat: any = {
    id,
    name: id,
    pos: { ...mockStructure("tower", { id: `${id}_ref` }).pos, getRangeTo: () => 3 },
    body: [{ type: "attack", hits: 100 }],
    hits: 1000,
    hitsMax: 1000,
    owner: { username: "enemy" },
  };
  registerObject(id, threat);
  return threat;
}

describe("A3 — tower-defense 维修权收窄", () => {
  it("有 builder 时塔不维修（让位 creep，省弹药）", () => {
    // P1-3：模拟 Kernel.buildSnapshots 预构建的 repairRooms。
    (globalThis as any).repairRooms = new Set(["W7N4"]);

    const tower = makeTower("t1");
    const damagedSpawn = mockStructure("spawn", { id: "sp1", energy: 300, hits: 400, hitsMax: 1000 });
    const snap = mockSnapshot({ towers: [tower], spawns: [damagedSpawn] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("有 worker 时塔同样不维修", () => {
    // P1-3：模拟 Kernel.buildSnapshots 预构建的 repairRooms。
    (globalThis as any).repairRooms = new Set(["W7N4"]);

    const tower = makeTower("t1");
    const damagedSpawn = mockStructure("spawn", { id: "sp1", energy: 300, hits: 400, hitsMax: 1000 });
    const snap = mockSnapshot({ towers: [tower], spawns: [damagedSpawn] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("无维修 creep 时塔保留维修安全网（灾后兜底）", () => {
    // repairRooms 未设置 → hasRepairCreep 返回 false。

    const tower = makeTower("t1");
    const damagedSpawn = mockStructure("spawn", { id: "sp1", energy: 300, hits: 400, hitsMax: 1000 });
    const snap = mockSnapshot({ towers: [tower], spawns: [damagedSpawn] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).toHaveBeenCalledWith(damagedSpawn);
  });

  it("他房的 builder 不算数（只认 home 归属）", () => {
    // P1-3：repairRooms 包含他房，不含本房 W7N4。
    (globalThis as any).repairRooms = new Set(["W8N4"]);

    const tower = makeTower("t1");
    const damagedSpawn = mockStructure("spawn", { id: "sp1", energy: 300, hits: 400, hitsMax: 1000 });
    const snap = mockSnapshot({ towers: [tower], spawns: [damagedSpawn] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.repair).toHaveBeenCalledWith(damagedSpawn);
  });

  it("威胁存在时：即使有 builder 也开火（开火职责不被让渡）", () => {
    // P1-3：模拟 Kernel.buildSnapshots 预构建的 repairRooms。
    (globalThis as any).repairRooms = new Set(["W7N4"]);

    const tower = makeTower("t1");
    const threat = makeThreat("threat_1");
    const snap = mockSnapshot({ towers: [tower], threatCreeps: [threat], hostileCreeps: [threat] });

    towerDefenseSystem.run(mockContext(snap));

    expect(tower.attack).toHaveBeenCalledWith(threat);
    expect(tower.repair).not.toHaveBeenCalled();
  });
});
