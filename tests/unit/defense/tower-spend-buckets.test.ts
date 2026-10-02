/**
 * #80 —— 塔的耗能**用途分桶**（纯观测，不动任何门）。
 *
 * 立案读数（线上 YD1/YD2@83383931/83383942）：幼房 W38S56 两个 source 的收入物理上限 ≈20/t，
 * 实测 `ei=19.4/t` 已贴顶，而 `towerSpent≈10/t` —— **一半上限花在墙/盾上**；同窗
 * `nf=-5.31/t`、storage 70K→54.9K、`upgraded≈8/t`（爬满 RCL5 要 ~33 小时）。
 *
 * 问题不是"塔在花钱"（`tower-defense.ts:202` 已经有 `colonyState` 经济门），而是
 * **账上看不出花在哪**：attack、补被拆的结构、和平期把 rampart 维护到 RCL 分级血量，
 * 全挤进 `towerSpent` 一格，而 `ledgerP0P1Consumption` 把整格当**常供侧**消费
 * ⇒ "要不要为发展让路"这个决策只能靠"此刻没有敌人"去推断。
 *
 * 本文件钉住三件事：每个调用点各归各桶；三桶之和恒等于合计；**新键不改变任何消费口径**。
 * 门与阈值一个没动 —— 防御取向属人工排产（§3.5）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { towerDefenseSystem } from "../../../src/systems/military/tower-defense";
import {
  emptyLedger,
  ledgerConsumption,
  ledgerP0P1Consumption,
  type EnergyLedger,
} from "../../../src/domain/economy/accounting";
import {
  mockContext,
  mockSnapshot,
  mockStructure,
  registerObject,
  resetGlobals,
} from "../../support/factories";

const g = (): any => globalThis as any;
const ledgerOf = (room: string): any => g().energyLedger.rooms[room];

function makeTower(id: string, energy = 500): any {
  const tower = mockStructure("tower", { id, energy, capacity: 1000 });
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

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  // repairRooms 由 Kernel.buildSnapshots 预构建；这里显式清空 ⇒ 塔保留维修安全网。
  delete g().repairRooms;
});

describe("#80 塔耗能用途分桶", () => {
  it("开火只进 combat 桶，且三桶之和 == towerSpent", () => {
    const tower = makeTower("t1");
    const threat = makeThreat("threat_1");
    towerDefenseSystem.run(
      mockContext(
        mockSnapshot({ towers: [tower], threatCreeps: [threat], hostileCreeps: [threat] }),
      ),
    );
    expect(tower.attack).toHaveBeenCalledWith(threat);
    const l = ledgerOf("W7N4");
    expect(l.towerSpendCombat).toBe(TOWER_ENERGY_COST);
    expect(l.towerSpendStructures).toBe(0);
    expect(l.towerSpendWalls).toBe(0);
    expect(l.towerSpendCombat + l.towerSpendStructures + l.towerSpendWalls).toBe(l.towerSpent);
  });

  it("关键结构维修进 structures 桶，不污染 walls 桶", () => {
    const tower = makeTower("t1");
    const damagedSpawn = mockStructure("spawn", {
      id: "sp1",
      energy: 300,
      hits: 400,
      hitsMax: 1000,
    });
    towerDefenseSystem.run(mockContext(mockSnapshot({ towers: [tower], spawns: [damagedSpawn] })));
    expect(tower.repair).toHaveBeenCalledWith(damagedSpawn);
    const l = ledgerOf("W7N4");
    expect(l.towerSpendStructures).toBe(TOWER_ENERGY_COST);
    expect(l.towerSpendWalls).toBe(0);
    expect(l.towerSpendCombat).toBe(0);
    expect(l.towerSpendCombat + l.towerSpendStructures + l.towerSpendWalls).toBe(l.towerSpent);
  });

  it("和平期的墙/盾维护进 walls 桶（就是幼房那笔账的那一格）", () => {
    // 维护档另有能量门：tower 能量比 > 0.7 才允许把弹药花在墙/盾上（G-DF-08）。
    const tower = makeTower("t1", 900);
    const rampart = mockStructure("rampart", { id: "rp1", hits: 100, hitsMax: 1_000_000 });
    towerDefenseSystem.run(mockContext(mockSnapshot({ towers: [tower], ramparts: [rampart] })));
    expect(tower.repair).toHaveBeenCalledWith(rampart);
    const l = ledgerOf("W7N4");
    expect(l.towerSpendWalls).toBe(TOWER_ENERGY_COST);
    expect(l.towerSpendCombat).toBe(0);
    expect(l.towerSpendStructures).toBe(0);
    expect(l.towerSpendCombat + l.towerSpendStructures + l.towerSpendWalls).toBe(l.towerSpent);
  });

  it("新键是纯观测：不改消费合计与 P0/P1 配给分母（否则同一笔塔支出被记两次）", () => {
    const base: EnergyLedger = {
      ...emptyLedger(),
      towerSpent: 3 * TOWER_ENERGY_COST,
      harvested: 5000,
    };
    const bucketed: EnergyLedger = {
      ...base,
      towerSpendCombat: TOWER_ENERGY_COST,
      towerSpendStructures: TOWER_ENERGY_COST,
      towerSpendWalls: TOWER_ENERGY_COST,
    };
    expect(ledgerConsumption(bucketed)).toBe(ledgerConsumption(base));
    expect(ledgerP0P1Consumption(bucketed)).toBe(ledgerP0P1Consumption(base));
  });
});
