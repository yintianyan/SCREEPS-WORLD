/**
 * reclaimFactoryOutput / stockPowerSpawn — factory 产物回收与 powerSpawn 供料动作测试。
 *
 * 背景：审计确认 factory battery 无搬运出路（50k 容量必堵死压缩链）、powerSpawn
 * 的 power/能量无供给通道（结构建成即死链，GPL 恒 0）。本文件锁定两个动作的
 * 相位解析正确性（执行层是通用 transfer/withdraw，由 runAction 覆盖）。
 *
 * 覆盖：
 *   reclaimFactoryOutput：
 *   - battery 达阈值 + 空载 → withdraw 相（source=factory）
 *   - battery 低于阈值 / 无 factory → undefined
 *   - 携 battery + 有市场 + terminal 有空位 → deposit terminal（交易变现入口）
 *   - 携 battery + 无市场 → deposit storage（W7 死资本教训）
 *   - 携 battery + terminal 满 → deposit storage 兜底
 *   - 满载他物（非 battery）→ undefined（放行后续候选）
 *   stockPowerSpawn：
 *   - 能量低于目标 + storage 高于水位地板 → withdraw energy
 *   - storage 低于水位地板 → 不抽能量
 *   - power 低于目标 + storage 有 → storage 优先；无则 terminal 回退
 *   - 携 power + 缺 power → deposit；携能量 + 能量已满 → undefined（不劫持经济能量）
 *   stockNuker：
 *   - 能量空弹 + storage 高于储备地板 → withdraw energy（50k 大额抽血有地板门禁）
 *   - storage 低于储备地板且 G 不缺 → undefined（不与 spawn/tower 抢血）
 *   - 能量已满 + G 缺 + storage 有 G → withdraw G（矿物不抢生存能量，无地板）
 *   - storage 无 G + terminal 有 G → terminal 回退（市场买入落地点）
 *   - 携 G + nuker 缺 G → deposit；携能量 + 能量已满 → undefined（不劫持经济能量）
 *   - 备弹全满（energy 50k + G 5k）→ undefined；无 nuker → undefined
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  reclaimFactoryOutput,
  stockPowerSpawn,
  stockNuker,
} from "../../../src/creeps/engine/actions/industry";
import { NUKE_ENERGY_COST, NUKE_GHODIUM_COST } from "../../../src/domain/war/planning";
import { CONFIG } from "../../../src/config";
import { mockContext, mockCreep, mockSnapshot, resetGlobals } from "../../role-helpers";

/**
 * 资源感知 store mock — Object.keys 只暴露资源键（方法不可枚举），
 * 与引擎 store 语义一致（collectMineralInventory 等按资源键遍历）。
 */
function resStore(resources: Record<string, number>, capacity = 100000): any {
  const store: Record<string, number> = { ...resources };
  const total = Object.values(resources).reduce((a, b) => a + b, 0);
  Object.defineProperty(store, "getUsedCapacity", {
    enumerable: false,
    value: (r?: string) => (r ? (resources[r] ?? 0) : total),
  });
  Object.defineProperty(store, "getFreeCapacity", {
    enumerable: false,
    value: (r?: string) => Math.max(0, capacity - (r ? (resources[r] ?? 0) : total)),
  });
  return store;
}

function makeAc(overrides: {
  factoryStore?: Record<string, number>;
  terminalStore?: Record<string, number>;
  storageStore?: Record<string, number>;
  powerSpawnStore?: Record<string, number>;
  nukerStore?: Record<string, number>;
  creepStore?: Record<string, number>;
  creepCapacity?: number;
  withMarket?: boolean;
}) {
  const factory = overrides.factoryStore
    ? ({ id: "fac1", store: resStore(overrides.factoryStore, 50000) } as any)
    : undefined;
  const terminal = overrides.terminalStore
    ? ({ id: "tm1", store: resStore(overrides.terminalStore, 300000), cooldown: 0 } as any)
    : undefined;
  const storage = overrides.storageStore
    ? ({ id: "st1", store: resStore(overrides.storageStore, 1000000) } as any)
    : undefined;
  const powerSpawn = overrides.powerSpawnStore
    ? ({ id: "ps1", store: resStore(overrides.powerSpawnStore, 5000) } as any)
    : undefined;
  // nuker 容量按引擎语义：energy 300k + G 5k 独立通道（resStore 共享容量仅影响
  // getFreeCapacity，deposit 相断言只用「有剩余」这一事实，不失真）。
  const nuker = overrides.nukerStore
    ? ({ id: "nk1", store: resStore(overrides.nukerStore, 300000), cooldown: 0 } as any)
    : undefined;
  const snap = mockSnapshot({ factory, terminal, storage, powerSpawn, nuker });
  const creep = mockCreep({ role: "distributor", capacity: overrides.creepCapacity ?? 300 });
  if (overrides.creepStore) {
    creep.store = resStore(overrides.creepStore, overrides.creepCapacity ?? 300);
  }
  if (overrides.withMarket) {
    (globalThis as any).Game.market = { getAllOrders: () => [], credits: 0 };
  }
  const ctx = mockContext(snap);
  return { ac: { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx }, creep };
}

beforeEach(() => {
  resetGlobals();
});

describe("reclaimFactoryOutput — factory battery 回收", () => {
  it("battery 达阈值 + 空载 → withdraw 相（去 factory 取料）", () => {
    const { ac } = makeAc({ factoryStore: { battery: CONFIG.factory.batteryReclaimThreshold } });
    const t = reclaimFactoryOutput().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("withdraw");
    expect((t as any).source).toBe(ac.snapshot.factory);
  });

  it("battery 低于阈值 → undefined（攒批减少往返）", () => {
    const { ac } = makeAc({ factoryStore: { battery: CONFIG.factory.batteryReclaimThreshold - 1 } });
    expect(reclaimFactoryOutput().resolve!(ac as any)).toBeUndefined();
  });

  it("无 factory → undefined", () => {
    const { ac } = makeAc({});
    expect(reclaimFactoryOutput().resolve!(ac as any)).toBeUndefined();
  });

  it("携 battery + 有市场 + terminal 有空位 → deposit terminal", () => {
    const { ac } = makeAc({
      factoryStore: { battery: 500 },
      terminalStore: { energy: 10000 },
      creepStore: { battery: 150 },
      withMarket: true,
    });
    const t = reclaimFactoryOutput().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("deposit");
    expect((t as any).dest).toBe(ac.snapshot.terminal);
  });

  it("携 battery + 无市场 → deposit storage（死资本不进 terminal）", () => {
    const { ac } = makeAc({
      factoryStore: { battery: 500 },
      storageStore: { energy: 50000 },
      terminalStore: { energy: 10000 },
      creepStore: { battery: 150 },
    });
    const t = reclaimFactoryOutput().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("deposit");
    expect((t as any).dest).toBe(ac.snapshot.storage);
  });

  it("携 battery + terminal battery 满仓 → deposit storage 兜底", () => {
    const { ac } = makeAc({
      factoryStore: { battery: 500 },
      terminalStore: { battery: 300000 },
      storageStore: { energy: 50000 },
      creepStore: { battery: 150 },
      withMarket: true,
    });
    const t = reclaimFactoryOutput().resolve!(ac as any);
    expect(t).toBeDefined();
    expect((t as any).dest).toBe(ac.snapshot.storage);
  });

  it("满载他物（能量）且 factory 达阈值 → undefined（放行后续候选先卸货）", () => {
    const { ac } = makeAc({
      factoryStore: { battery: 500 },
      storageStore: { energy: 50000 },
      creepStore: { energy: 300 },
    });
    expect(reclaimFactoryOutput().resolve!(ac as any)).toBeUndefined();
  });
});

describe("stockPowerSpawn — powerSpawn 原料补给", () => {
  it("能量低于目标 + storage 高于水位地板 → withdraw energy from storage", () => {
    const { ac } = makeAc({
      powerSpawnStore: { energy: 0, power: 50 },
      storageStore: { energy: CONFIG.economy.distributorTiers.low + 1000 },
    });
    const t = stockPowerSpawn().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("withdraw");
    expect(t!.resource).toBe("energy");
    expect((t as any).source).toBe(ac.snapshot.storage);
  });

  it("storage 低于水位地板且 power 不缺 → undefined（不与 spawn/tower 抢血）", () => {
    const { ac } = makeAc({
      powerSpawnStore: { energy: 0, power: 50 },
      storageStore: { energy: CONFIG.economy.distributorTiers.low - 1 },
    });
    expect(stockPowerSpawn().resolve!(ac as any)).toBeUndefined();
  });

  it("能量已足 + power 缺 + storage 有 power → withdraw power from storage（优先）", () => {
    const { ac } = makeAc({
      powerSpawnStore: { energy: CONFIG.factory.powerSpawnEnergyTarget, power: 0 },
      storageStore: { energy: 50000, power: 30 },
      terminalStore: { power: 50 },
    });
    const t = stockPowerSpawn().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.resource).toBe("power");
    expect((t as any).source).toBe(ac.snapshot.storage);
  });

  it("能量已足 + power 缺 + storage 无 power → terminal 回退（市场买入落地点）", () => {
    const { ac } = makeAc({
      powerSpawnStore: { energy: CONFIG.factory.powerSpawnEnergyTarget, power: 0 },
      storageStore: { energy: 50000 },
      terminalStore: { power: 50 },
    });
    const t = stockPowerSpawn().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.resource).toBe("power");
    expect((t as any).source).toBe(ac.snapshot.terminal);
  });

  it("携 power + powerSpawn 缺 power → deposit", () => {
    const { ac } = makeAc({
      powerSpawnStore: { energy: 1000, power: 0 },
      storageStore: { energy: 50000 },
      creepStore: { power: 20 },
    });
    const t = stockPowerSpawn().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("deposit");
    expect(t!.resource).toBe("power");
    expect((t as any).dest).toBe(ac.snapshot.powerSpawn);
  });

  it("携能量 + powerSpawn 能量已满 → undefined（不劫持 spawn 填充能量）", () => {
    const { ac } = makeAc({
      powerSpawnStore: { energy: CONFIG.factory.powerSpawnEnergyTarget, power: 50 },
      storageStore: { energy: 50000 },
      creepStore: { energy: 300 },
    });
    expect(stockPowerSpawn().resolve!(ac as any)).toBeUndefined();
  });

  it("无 powerSpawn → undefined", () => {
    const { ac } = makeAc({ storageStore: { energy: 50000 } });
    expect(stockPowerSpawn().resolve!(ac as any)).toBeUndefined();
  });
});

describe("stockNuker — nuker 威慑备弹装填", () => {
  it("能量空弹 + storage 高于储备地板 → withdraw energy from storage", () => {
    const { ac } = makeAc({
      nukerStore: { energy: 0, G: NUKE_GHODIUM_COST },
      storageStore: { energy: CONFIG.market.storageEnergyFloor + 1000 },
    });
    const t = stockNuker().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("withdraw");
    expect(t!.resource).toBe("energy");
    expect((t as any).source).toBe(ac.snapshot.storage);
  });

  it("storage 低于储备地板且 G 不缺 → undefined（50k 大额抽血不与 spawn/tower 抢）", () => {
    const { ac } = makeAc({
      nukerStore: { energy: 0, G: NUKE_GHODIUM_COST },
      storageStore: { energy: CONFIG.market.storageEnergyFloor - 1 },
    });
    expect(stockNuker().resolve!(ac as any)).toBeUndefined();
  });

  it("能量已满 + G 缺 + storage 有 G → withdraw G from storage（矿物无地板门禁）", () => {
    const { ac } = makeAc({
      nukerStore: { energy: NUKE_ENERGY_COST, G: 0 },
      storageStore: { energy: 50000, G: 2000 },
    });
    const t = stockNuker().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("withdraw");
    expect(t!.resource).toBe("G");
    expect((t as any).source).toBe(ac.snapshot.storage);
  });

  it("storage 无 G + terminal 有 G → terminal 回退（市场买入落地点）", () => {
    const { ac } = makeAc({
      nukerStore: { energy: NUKE_ENERGY_COST, G: 0 },
      storageStore: { energy: 50000 },
      terminalStore: { energy: 10000, G: 3000 },
    });
    const t = stockNuker().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.resource).toBe("G");
    expect((t as any).source).toBe(ac.snapshot.terminal);
  });

  it("携 G + nuker 缺 G → deposit", () => {
    const { ac } = makeAc({
      nukerStore: { energy: NUKE_ENERGY_COST, G: 0 },
      storageStore: { energy: 50000 },
      creepStore: { G: 500 },
    });
    const t = stockNuker().resolve!(ac as any);
    expect(t).toBeDefined();
    expect(t!.phase).toBe("deposit");
    expect(t!.resource).toBe("G");
    expect((t as any).dest).toBe(ac.snapshot.nuker);
  });

  it("携能量 + nuker 能量已满 → undefined（不劫持经济能量）", () => {
    const { ac } = makeAc({
      nukerStore: { energy: NUKE_ENERGY_COST, G: NUKE_GHODIUM_COST },
      storageStore: { energy: 50000 },
      creepStore: { energy: 300 },
    });
    expect(stockNuker().resolve!(ac as any)).toBeUndefined();
  });

  it("备弹全满（energy 50k + G 5k）+ 空载 → undefined（装满即停放）", () => {
    const { ac } = makeAc({
      nukerStore: { energy: NUKE_ENERGY_COST, G: NUKE_GHODIUM_COST },
      storageStore: { energy: 50000, G: 5000 },
    });
    expect(stockNuker().resolve!(ac as any)).toBeUndefined();
  });

  it("无 nuker → undefined", () => {
    const { ac } = makeAc({ storageStore: { energy: 50000 } });
    expect(stockNuker().resolve!(ac as any)).toBeUndefined();
  });
});
