/**
 * Spawn 需求评估测试（A2 升级功率 + A4 替换路程项）。
 *
 * 覆盖：
 *   - storage 水位三档：冲刺（≥50k）/ 维持（≥10k）/ 低水位（<10k）
 *   - RCL8 升级功率显式封顶 15 WORK
 *   - 无 storage 时保留早期猛冲梯度
 *   - 替换阈值计入 spawn→source 通勤路程
 */
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateDemand, estimateTravelTicks, needsReplacement } from "../src/domain/spawn/demand";
import { mockController, mockCreep, mockSnapshot, mockSource, mockStructure, resetGlobals } from "./role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 造一个有一台存活 harvester 的最小场景，避免触发 P0 恢复 worker 短路。 */
function livingHarvester() {
  return [
    {
      name: "harvester_1",
      role: "harvester",
      home: "W7N4",
      ticksToLive: 1200,
      bodyLength: 7,
      sourceId: "source_1" as Id<Source>,
      spawnIndex: 0,
    },
  ];
}

const normalCtx = (pressure = 0) => ({
  colonyState: "normal" as const,
  controllerDowngradeRisk: false,
  energyAvailable: 2000,
  economyPressure: pressure,
});

function stationSnapshot(overrides: Parameters<typeof mockSnapshot>[0]) {
  const ctrlContainer = mockStructure("container", { id: "cc", energy: 1000, capacity: 2000 });
  return mockSnapshot({
    controller: mockController({ level: 6 }),
    controllerContainer: ctrlContainer,
    ...overrides,
  });
}

describe("A2 — storage 水位驱动升级功率", () => {
  it("冲刺：storage ≥ 50k 且健康 → 2 个大 body upgrader（烧库存换 RCL）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 6, energyCapacityAvailable: 2300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const upgraders = requests.filter(r => r.role === "upgrader");
    expect(upgraders).toHaveLength(2);
    expect(upgraders[0]!.body.filter(p => p === "work")).toHaveLength(15);
  });

  it("维持：storage ≥ 10k → 1 个大 body upgrader（≈15/tick 吃满盈余）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 6, energyCapacityAvailable: 2300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const upgraders = requests.filter(r => r.role === "upgrader");
    expect(upgraders).toHaveLength(1);
    expect(upgraders[0]!.body.filter(p => p === "work")).toHaveLength(15);
  });

  it("低水位：storage < 10k 且 pressure > 0.5 → 停升级攒库存", () => {
    const storage = mockStructure("storage", { id: "st", energy: 5000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 6, energyCapacityAvailable: 2300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0.6), 1000);

    expect(requests.filter(r => r.role === "upgrader")).toHaveLength(0);
  });

  it("无 storage（RCL3）：保留早期猛冲梯度，station 在线且健康 → maxCount", () => {
    const snap = stationSnapshot({ storage: undefined, rcl: 3, energyCapacityAvailable: 800 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    expect(requests.filter(r => r.role === "upgrader")).toHaveLength(3);
  });

  it("RCL8 显式限速：即使冲刺水位，upgrader 也封顶 15 WORK（1 个 15W body）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
    const snap = stationSnapshot({ storage, rcl: 8, energyCapacityAvailable: 12300 });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0), 1000);

    const upgraders = requests.filter(r => r.role === "upgrader");
    expect(upgraders).toHaveLength(1);
    expect(upgraders[0]!.body.filter(p => p === "work")).toHaveLength(15);
  });
});

describe("A4 — 替换阈值计入通勤路程", () => {
  it("needsReplacement：阈值 = bodyLength*3 + buffer + travelTicks", () => {
    // body 7 部件 → 孵化 21 tick；buffer 15；travel 30 → 阈值 66。
    expect(needsReplacement(66, 7, 30)).toBe(true);
    expect(needsReplacement(67, 7, 30)).toBe(false);
    // 无路程项时维持原阈值 36。
    expect(needsReplacement(36, 7)).toBe(true);
    expect(needsReplacement(37, 7)).toBe(false);
  });

  it("estimateTravelTicks：spawn→source Chebyshev 距离 × 1.5，无 source 为 0", () => {
    const spawn = mockStructure("spawn", { id: "sp", energy: 300 });
    const source = mockSource("s_far");
    spawn.pos.getRangeTo = () => 20;
    const snap = mockSnapshot({ spawns: [spawn], sources: [source] });

    expect(estimateTravelTicks(snap, "s_far" as Id<Source>)).toBe(30);
    expect(estimateTravelTicks(snap, undefined)).toBe(0);
    expect(estimateTravelTicks(snap, "nonexistent" as Id<Source>)).toBe(0);
  });

  it("远端矿工更早触发替换请求（路程计入阈值）", () => {
    const spawn = mockStructure("spawn", { id: "sp", energy: 300 });
    spawn.pos.getRangeTo = () => 20; // travel = 30
    const source = mockSource("source_1");
    const snap = mockSnapshot({ spawns: [spawn], sources: [source] });

    // ttl=60：无路程阈值(7*3+15=36)不触发；含路程(66)触发。
    const dyingMiner = {
      name: "harvester_old",
      role: "harvester",
      home: "W7N4",
      ticksToLive: 60,
      bodyLength: 7,
      sourceId: "source_1" as Id<Source>,
      spawnIndex: 0,
    };
    const { requests } = evaluateDemand(snap, [], "normal", [dyingMiner], [], normalCtx(0), 1000);

    expect(requests.some(r => r.role === "harvester" && r.replaceBy !== undefined)).toBe(true);
  });
});
