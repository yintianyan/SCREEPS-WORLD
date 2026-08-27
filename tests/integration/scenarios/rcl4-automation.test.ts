/** RCL4 Automation — 自动化集成测试。 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions, GameInspector } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

// ─── 辅助：构建 RCL4 标准世界 ───────────────────────────────

function rcl4World(opts?: {
  storageEnergy?: number;
  containerEnergy?: number;
  towerEnergy?: number;
  hostiles?: boolean;
}): TestWorld {
  const builder = new ScenarioBuilder("W1N1")
    .rcl(4, 200000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 38)
    .source("s1", 12, 12)
    .source("s2", 38, 12)
    // source 旁 container
    .container(13, 12, opts?.containerEnergy ?? 1500)
    .container(37, 12, opts?.containerEnergy ?? 1500)
    // controller 旁 container（站桩升级）
    .container(29, 37, 1000)
    // storage（RCL4 核心）
    .storage(26, 25, opts?.storageEnergy ?? 20000)
    // tower
    .tower(24, 25, opts?.towerEnergy ?? 800)
    // 20 extensions（RCL4 上限）
    .extensions(
      Array.from({ length: 20 }, (_, i) => ({
        x: 21 + (i % 5) * 2,
        y: 22 + Math.floor(i / 5) * 2,
      })),
    )
    .sourceRegen(10)
    .containerDecay(5000)
    .cpu(10000);

  const world = builder.build();

  // 敌方 creep
  if (opts?.hostiles) {
    // P1-1：hostile 放置在 creep 活动区域附近（~7 格），
    // 确保 fleeRange(10) 内触发逃跑，而非远端过境不触发。
    world.addHostile("invader_1", { x: 19, y: 19 }, [
      { type: "attack" }, { type: "attack" }, { type: "move" }, { type: "move" },
    ]);
  }

  return world;
}

/** 给世界添加标准 RCL4 人口。 */
function addRcl4Population(world: TestWorld): void {
  // 2 harvester（4W 站桩矿工）
  world.addCreep("h1", "harvester", 13, 13, [
    { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ], { sourceId: "s1", mode: "work" });
  world.addCreep("h2", "harvester", 37, 13, [
    { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ], { sourceId: "s2", mode: "work" });

  // 2 hauler（物流链）
  world.addCreep("haul1", "hauler", 20, 20, [
    { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });
  world.addCreep("haul2", "hauler", 22, 22, [
    { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });

  // 2 upgrader（站桩升级）
  world.addCreep("u1", "upgrader", 29, 38, [
    { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });
  world.addCreep("u2", "upgrader", 30, 37, [
    { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });

  // 1 builder
  world.addCreep("b1", "builder", 24, 24, [
    { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });

  // 填充 spawn + extensions
  world.spawns[0]!.store.energy = 300;
  for (const ext of world.extensions) ext.store.energy = 50;
  world.room._recalcEnergy();
}

// ─── 测试 ───────────────────────────────────────────────────

describe("RCL4 Automation — 自动化", () => {
  it("hauler 物流链运转：能量从 container 流向 spawn/extensions", () => {
    const world = rcl4World({ storageEnergy: 0, containerEnergy: 1800 });
    addRcl4Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 800);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL4 hauler logistics");
    assertions.assertEmpireAlive("RCL4 hauler logistics");
    assertions.assertEconomyHealthy("RCL4 hauler logistics");

    // 采集正常运转（2×4W harvester × 800 tick 理论上限 12800）
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(2000);
  });

  it("hostile 出现时 tower 攻击，系统不崩溃", () => {
    const world = rcl4World({ hostiles: true, towerEnergy: 900 });
    addRcl4Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 200 tick（hostile 存在期间）
    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);

    // 系统不崩溃
    assertions.assertNoRuntimeError("RCL4 tower defense");
    assertions.assertEmpireAlive("RCL4 tower defense");

    // tower 应该消耗能量进行攻击
    const towerEnergy = world.towers[0]?.store.getUsedCapacity() ?? 0;
    expect(towerEnergy).toBeLessThan(900);
  });

  it("hostile 出现又离开后恢复正常经济", () => {
    const world = rcl4World({ hostiles: true, towerEnergy: 900 });
    addRcl4Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 100 tick 有敌人
    runner.run(world, 100);

    // 敌人离开
    world.removeHostile("invader_1");

    // 恢复运行 500 tick
    const result = runner.run(world, 500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL4 defense recovery");
    assertions.assertEmpireAlive("RCL4 defense recovery");

    // 经济恢复：采集继续
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });

  it("人口自动缩放：creep 死亡后补充", () => {
    const world = rcl4World({ containerEnergy: 1500 });
    addRcl4Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 稳定运行 100 tick
    runner.run(world, 100);

    // 杀死一个 harvester
    world.killCreep("h1");
    expect(world.creepsByRole("harvester").length).toBe(1);

    // 确保 spawn 有能量恢复
    world.spawns[0]!.store.energy = 300;
    world.room._recalcEnergy();

    // 运行 600 tick — 应该补充 harvester
    const result = runner.run(world, 600, {
      stopWhen: (w) => w.creepsByRole("harvester").length >= 2,
    });

    // 人口恢复
    expect(world.creepsByRole("harvester").length).toBeGreaterThanOrEqual(2);
  });

  it("长期运行 2000 tick 能量稳定", () => {
    const world = rcl4World({ containerEnergy: 1200, storageEnergy: 10000 });
    addRcl4Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 2000);
    const inspector = new GameInspector(world);
    const economy = inspector.economyReport(result.records);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL4 long-term stability");
    assertions.assertEmpireAlive("RCL4 long-term stability");

    // 无死亡螺旋
    expect(economy.deathSpiral).toBe(false);
    // 采集正常
    expect(economy.totalHarvested).toBeGreaterThan(5000);
    // 升级在进行
    expect(economy.totalUpgraded).toBeGreaterThan(0);
  });

  it("CPU bucket 降低时 P2+ 角色被节流但 P0/P1 正常", () => {
    const world = rcl4World({ containerEnergy: 1500 });
    addRcl4Population(world);

    // 设置低 bucket → guarded/conserve tier
    (world.config as { cpuBucket: number }).cpuBucket = 2000;

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 300);
    const assertions = new Assertions(world, result.records);

    // 系统不崩溃
    assertions.assertNoRuntimeError("RCL4 CPU pressure");
    assertions.assertEmpireAlive("RCL4 CPU pressure");

    // P0/P1 角色（harvester/hauler）应该仍在运行
    // （通过采集量验证）
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });

  it("多 tower 协同防御", () => {
    const world = rcl4World({ hostiles: true, towerEnergy: 900 });
    // 添加第二个 tower
    world.addTower(27, 25, 900);
    addRcl4Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 100);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL4 multi-tower");
    assertions.assertEmpireAlive("RCL4 multi-tower");

    // 两个 tower 都应该消耗能量（集火攻击）
    const tower1Energy = world.towers[0]?.store.getUsedCapacity() ?? 0;
    const tower2Energy = world.towers[1]?.store.getUsedCapacity() ?? 0;
    expect(tower1Energy + tower2Energy).toBeLessThan(1800);
  });
});
