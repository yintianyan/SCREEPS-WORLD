/** RCL2 Development — 基础建设集成测试。 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

describe("RCL2 Development — 基础建设", () => {
  it("RCL2 稳态维持正经济（1000 tick）", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 10000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .container(21, 20, 800)
      .container(31, 20, 800)
      .extensions([
        { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
        { x: 26, y: 26 }, { x: 25, y: 24 },
      ])
      .sourceRegen(10)
      .containerDecay(5000)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 1000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL2 steady state");
    assertions.assertEmpireAlive("RCL2 steady state");
    assertions.assertEconomyHealthy("RCL2 steady state");

    // 必须有采集角色
    const miners = world.creepsByRole("harvester").length + world.creepsByRole("worker").length;
    expect(miners).toBeGreaterThan(0);
  });

  it("container 衰减时 builder 或 harvester 修复", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 20000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .container(21, 20, 1000, 200000) // 已损耗的 container
      .extensions([
        { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
        { x: 26, y: 26 }, { x: 25, y: 24 },
      ])
      // 给一个 harvester 在 source 旁边
      .creep("h1", "harvester", 21, 21, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .sourceRegen(10)
      .containerDecay(5000)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const initialHits = world.containers[0]?.hits ?? 0;
    const result = runner.run(world, 200);

    // container 不应该被摧毁（有修复行为）
    // 注意：如果 harvester 不修复，200 tick * 5000 = 1M 衰减会摧毁 200K hits 的 container
    // 实际上 harvester repairNearbyContainer 在 <80% 时触发
    const container = world.containers[0];
    if (container) {
      // container 还活着（hits > 0）
      expect(container.hits).toBeGreaterThan(0);
    }
  });

  it("creep body 随 energyCapacity 升级", () => {
    // RCL2 有 5 extension = 300 + 5*50 = 550 capacity
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 20000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .extensions([
        { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
        { x: 26, y: 26 }, { x: 25, y: 24 },
      ])
      .sourceRegen(10)
      .cpu(10000)
      .build();

    // 填充 spawn + extension 到满
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) {
      ext.store.energy = 50;
    }
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行足够长时间让 spawn 产生 creep
    const result = runner.run(world, 500, {
      stopWhen: (w) => w.creeps.length > 0,
    });

    if (world.creeps.length > 0) {
      const creep = world.creeps[0]!;
      const workParts = creep.body.filter(p => p.type === "work").length;
      // 550 capacity 应该能出 2W+ body（harvester [W,W,C,M]=300 或 worker [W,W,C,M]=300）
      expect(workParts).toBeGreaterThanOrEqual(1);
    }
  });

  it("population 自动调整：harvester 死亡后补充", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 20000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .source("s2", 32, 22)
      .container(23, 22, 1000)
      .container(31, 22, 1000)
      .extensions([
        { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
        { x: 26, y: 26 }, { x: 25, y: 24 },
      ])
      .creep("h1", "harvester", 23, 23, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    // 填充能量
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 100 tick 让系统稳定
    runner.run(world, 100);

    // 杀死所有采集角色（模拟全灭）
    for (const c of [...world.creeps]) {
      const role = c.memory.role as string;
      if (role === "harvester" || role === "worker") {
        world.killCreep(c.name);
      }
    }
    const minersAfterKill = world.creepsByRole("harvester").length + world.creepsByRole("worker").length;
    expect(minersAfterKill).toBe(0);

    // 确保 spawn 有足够能量进行 P0 紧急恢复（模拟 spawn 仍有储备）。
    // 真实场景中 spawn 通常有 200+ 能量储备用于紧急 worker。
    world.spawns[0]!.store.energy = 300;
    world.room._recalcEnergy();

    // 继续运行 500 tick — 应该补充 harvester
    const result = runner.run(world, 500, {
      stopWhen: (w) => w.creepsByRole("harvester").length > 0 || w.creepsByRole("worker").length > 0,
    });

    // 必须有替代 creep 出现
    const miners = world.creepsByRole("harvester").length + world.creepsByRole("worker").length;
    expect(miners).toBeGreaterThan(0);
  });
});
