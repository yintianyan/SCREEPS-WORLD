/** RCL8 GCL 升级：开关开启时继续孵化 upgrader，关闭时回到旧行为（0 只）。 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateDemand, type RoomDemandContext } from "../../../src/domain/spawn/demand";
import { mockController, mockSnapshot, mockStructure, resetGlobals } from "../../support/factories";
import { CONFIG } from "../../../src/config";

const ORIGINAL_GCL = CONFIG.economy.upgrade.gclUpgrade;

/** CONFIG 为 readonly 声明，测试需临时覆盖开关（用断言绕开只读修饰）。 */
function setGclUpgrade(enabled: boolean): void {
  (CONFIG.economy.upgrade as unknown as { gclUpgrade: boolean }).gclUpgrade = enabled;
}

beforeEach(() => {
  resetGlobals();
});

afterEach(() => {
  setGclUpgrade(ORIGINAL_GCL);
});

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

function ctx(overrides: Partial<RoomDemandContext> = {}): RoomDemandContext {
  return {
    colonyState: "normal",
    controllerDowngradeRisk: false,
    energyAvailable: 6000,
    economyPressure: 0,
    richStorageActive: true,
    ...overrides,
  };
}

function rcl8Snapshot(storageEnergy: number) {
  return mockSnapshot({
    rcl: 8,
    energyCapacityAvailable: 12300,
    controller: mockController({ level: 8 }),
    controllerContainer: mockStructure("container", { id: "cc", energy: 1000, capacity: 2000 }),
    storage: mockStructure("storage", {
      id: "st",
      energy: storageEnergy,
      capacity: 1000000,
    }),
  });
}

function upgraderRequests(snapshot: ReturnType<typeof rcl8Snapshot>, ctxOverrides = {}) {
  return evaluateDemand(
    snapshot,
    [],
    "normal",
    livingHarvester(),
    [],
    ctx(ctxOverrides),
    1000,
  ).requests.filter(r => r.role === "upgrader");
}

describe("RCL8 GCL 升级开关", () => {
  it("开启 + storage 充足 → 继续孵化 upgrader（累计 GCL）", () => {
    setGclUpgrade(true);
    expect(upgraderRequests(rcl8Snapshot(120000)).length).toBeGreaterThan(0);
  });

  it("开启 + 闩锁关闭（低储）→ 仍不孵（低储节流优先）", () => {
    setGclUpgrade(true);
    expect(upgraderRequests(rcl8Snapshot(60000), { richStorageActive: false })).toHaveLength(0);
  });

  it("关闭 → 不孵（旧行为对照）", () => {
    setGclUpgrade(false);
    expect(upgraderRequests(rcl8Snapshot(120000))).toHaveLength(0);
  });

  it("开启 + 有降级风险 → 保级路径不受开关影响", () => {
    setGclUpgrade(false);
    const requests = upgraderRequests(rcl8Snapshot(120000), {
      controllerDowngradeRisk: true,
    });
    expect(requests.length).toBeGreaterThan(0);
  });
});
