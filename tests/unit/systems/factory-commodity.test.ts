/** Factory Manager commodity 集成测试（审计缺口 6 执行层）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { factoryManagerSystem } from "../../../src/systems/room/factory-manager";
import { mockBudget, mockSnapshot, resetGlobals } from "../../support/factories";

/** 多资源 store mock（键值映射 + 容量方法）。 */
function multiStore(resources: Record<string, number>): any {
  return {
    ...resources,
    getUsedCapacity: vi.fn((r?: string) => (r ? (resources[r] ?? 0) : 0)),
    getFreeCapacity: vi.fn(() => 50000),
  };
}

function factoryMock(resources: Record<string, number>, level = 0): any {
  return {
    cooldown: 0,
    level,
    store: multiStore(resources),
    produce: vi.fn(() => OK),
  };
}

function makeContext(snapshot: any): any {
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget("healthy"),
    globalSiteCount: 0,
    getSnapshot: vi.fn(() => snapshot),
    snapshots: vi.fn(function* () {
      yield snapshot;
    }),
  };
}

beforeEach(() => {
  resetGlobals();
  // T1 wire（U 10 + energy 30）+ T2 circuit（wire 10 + X 10 + energy 100，level 1）。
  (globalThis as any).COMMODITIES = {
    wire: { level: 0, components: { U: 10, energy: 30 } },
    circuit: { level: 1, components: { wire: 10, X: 10, energy: 100 } },
    battery: { level: 0, components: { energy: 600 } },
    // 原料类（无 components）应被跳过。
    U: { level: 0, amount: 1 },
  };
  (globalThis as any).Memory = { rooms: {}, kernel: {} };
});

describe("factory-manager — commodity 升级链", () => {
  it("factory 内原料齐 → produce 目标 + 写 globalCache 锚", () => {
    // energy 6000 - 储备地板 5000 = 1000 ≥ 配方 30。
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("wire");
  });

  it("T2 原料齐且 level 达标 → 优先产 T2", () => {
    const factory = factoryMock({ wire: 10, X: 10, energy: 6000 }, 1);
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("circuit");
  });

  // 本私服实测 `factory.level === undefined`（同拍 controller.level=8），旧实现 `?? 0`
  // 会把 r.level≥1 的配方全部静默筛光 —— 无豁免则该例必红。
  // 回退到 RCL 后等级判定交给引擎（真不够时 produce 自返 ERR、不产资源）。
  it("factory.level 缺失（私服形态）→ 按 RCL 判档，仍产 T2 并写锚", () => {
    const factory = Object.assign(factoryMock({ wire: 10, X: 10, energy: 6000 }, 1), {
      level: undefined,
    });
    const snap = mockSnapshot({ roomName: "W7N4", factory }); // 默认 rcl=3 ≥ circuit 的 1

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("circuit");
    expect((globalThis as any).factoryTargets?.["W7N4"]).toBe("circuit");
  });

  it("factory 原料不齐但 storage+factory 合计齐 → 不 produce（等 distributor 补料）但写锚", () => {
    const factory = factoryMock({ U: 5, energy: 6000 });
    const storage = { store: multiStore({ U: 5 }) } as any;
    const snap = mockSnapshot({ roomName: "W7N4", factory, storage });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalled();
  });

  it("无 COMMODITIES（私服/旧环境）→ 静默跳过不炸", () => {
    delete (globalThis as any).COMMODITIES;
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    expect(() => factoryManagerSystem.run(makeContext(snap))).not.toThrow();
    expect(factory.produce).not.toHaveBeenCalled();
  });

  it("battery 满仓压缩链无回归：storageNearFull + 能量足 → produce battery", () => {
    // commodity 链因 U 不足不产；满仓信号触发压缩链。
    (globalThis as any).Memory.rooms["W7N4"] = { storageNearFull: true };
    const factory = factoryMock({ energy: 600 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("battery");
  });
});

/**
 * 生产侧 ROI 闸 + 解压配方排除 —— 2026-10-18 线上跑出来的两件事。
 *
 * 现场账（官服 shard3 tick 83,725,692 行情 / 83,738,913 部署后首读）：
 *   oxidant = O 500 + energy 200 → GO 100；O buyMax 37.846、energy buyMax 32.186、
 *   GO buyMax 134.474 ⇒ 投入 25,360 对产出 13,447（回收 53%）＝深度倒挂。
 *   而 ROI 闸把 oxidant 拦下之后，selectCommodityTarget 顺梯度选中了引擎的解压配方
 *   `COMMODITIES[energy] = {battery:5} → energy 50`，factoryTargets 当场从 "oxidant"
 *   翻成 "energy"（部署后首读直读为证）—— 按买价算它 +61% 确实"划算"，但那是把有出口
 *   的资产（battery，卖出优先级 35）换成没出口的资产（energy，storage 只剩 118,842 空格
 *   且卖出优先级刚被降到 19）。ROI 闸只看市场价，看不见我们自己的出口能力。
 */
describe("factory-manager — 生产侧 ROI 闸与解压配方排除", () => {
  /** 官服当拍真值（不用编的：编出来的价格容易刚好落在闸的同一侧，用例永远绿、线上永远亏）。 */
  const LIVE = {
    O: { sellMin: 27.091, buyMax: 37.846 },
    GO: { sellMin: 224.853, buyMax: 134.474 },
    energy: { sellMin: 30.95, buyMax: 32.186 },
    battery: { sellMin: 339.114, buyMax: 200 },
  };

  function withCommodities(): void {
    (globalThis as any).COMMODITIES = {
      // 倒挂的那条（level 1，梯度最高）。
      GO: { level: 1, amount: 100, components: { O: 500, energy: 200 } },
      // 引擎的解压配方（level 0）—— 必须被排除在 commodity 链之外。
      energy: { level: 0, amount: 50, components: { battery: 5 } },
      battery: { level: 0, amount: 50, components: { energy: 600 } },
    };
  }

  it("料齐但行情倒挂 → 不 produce、锚被清（旧码这里照产不误）", () => {
    withCommodities();
    (globalThis as any).marketPrices = { tick: (globalThis as any).Game.time, prices: LIVE };
    const factory = factoryMock({ O: 500, energy: 50000 }, 1);
    const snap = mockSnapshot({
      roomName: "W7N4",
      factory,
      storage: { id: "st1", store: multiStore({ energy: 800000, O: 18676 }) } as any,
    });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalled();
    expect((globalThis as any).factoryTargets?.["W7N4"]).toBeUndefined();
  });

  it("同一份料、把产物买价抬到闸上 → produce（对照组：证明拦住的是 ROI 不是别的门）", () => {
    withCommodities();
    (globalThis as any).marketPrices = {
      tick: (globalThis as any).Game.time,
      prices: { ...LIVE, GO: { sellMin: 224.853, buyMax: 400 } },
    };
    const factory = factoryMock({ O: 500, energy: 50000 }, 1);
    const snap = mockSnapshot({
      roomName: "W7N4",
      factory,
      storage: { id: "st1", store: multiStore({ energy: 800000, O: 18676 }) } as any,
    });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("GO");
    expect((globalThis as any).factoryTargets?.["W7N4"]).toBe("GO");
  });

  it("行情表缺失（私服/测试无市场 API）→ 判不了 ⇒ 照常生产，不因闸而停产", () => {
    withCommodities();
    const factory = factoryMock({ O: 500, energy: 50000 }, 1);
    const snap = mockSnapshot({
      roomName: "W7N4",
      factory,
      storage: { id: "st1", store: multiStore({ energy: 800000, O: 18676 }) } as any,
    });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("GO");
  });

  it("倒挂配方被拦后不得回落到解压配方 energy（这条是线上真翻出来的）", () => {
    withCommodities();
    (globalThis as any).marketPrices = { tick: (globalThis as any).Game.time, prices: LIVE };
    // factory 里有 battery ⇒ 解压配方在原料上是可行的，且按 LIVE 价它 +61% "划算"；
    // storage 给足能量，确保危机解压通道（storage < energyBuyFloor）不会先触发，
    // 这样 produce 一旦被调用就只能来自 commodity 链。
    const factory = factoryMock({ O: 500, energy: 50000, battery: 500 }, 1);
    const snap = mockSnapshot({
      roomName: "W7N4",
      factory,
      storage: { id: "st1", store: multiStore({ energy: 800000, O: 18676 }) } as any,
    });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalledWith("energy");
    expect(factory.produce).not.toHaveBeenCalled();
    expect((globalThis as any).factoryTargets?.["W7N4"]).toBeUndefined();
  });

  it("危机解压通道不受影响：storage 跌破危机线时仍 produce(energy)", () => {
    withCommodities();
    (globalThis as any).marketPrices = { tick: (globalThis as any).Game.time, prices: LIVE };
    const factory = factoryMock({ battery: 500, energy: 0 }, 1);
    const snap = mockSnapshot({
      roomName: "W7N4",
      factory,
      storage: { id: "st1", store: multiStore({ energy: 1000 }) } as any,
    });

    factoryManagerSystem.run(makeContext(snap));

    // 排除的是 commodity 链挑中 energy，不是 tryDecompressBattery 那条专属危机通道。
    expect(factory.produce).toHaveBeenCalledWith("energy");
  });
});
