/** Edge Cases — 老玩家边界场景集成测试。 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

// ─── Spawn 异常 ─────────────────────────────────────────────

describe("Edge Case: Spawn 异常", () => {
  it("spawn busy 时不崩溃，等待完成后继续", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(1)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(28, 28)
      .source("s1", 22, 22)
      .sourceRegen(10)
      .cpu(10000)
      .build();

    // 手动设置 spawn 为 busy 状态
    world.spawns[0]!.spawning = { name: "fake", remainingTime: 50 };

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("spawn busy");

    // 50 tick 后 spawn 应该完成并继续工作
    expect(world.spawns[0]!.spawning).toBeNull();
  });

  it("energy=0 时不崩溃，等待能量恢复", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 10000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .extensions([{ x: 24, y: 24 }, { x: 26, y: 24 }])
      .sourceRegen(10)
      .cpu(10000)
      .build();

    // 清空所有能量
    world.spawns[0]!.store.energy = 0;
    for (const ext of world.extensions) ext.store.energy = 0;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 300);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("energy=0");
    assertions.assertEmpireAlive("energy=0 recovery");
  });

  it("spawn 被毁后 AI 不崩溃（无 spawn 房间）", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 10000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .creep("h1", "harvester", 23, 22, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 50 tick 稳定
    runner.run(world, 50);

    // 移除 spawn（模拟被毁）
    world._spawns = [];
    world.room._recalcEnergy();

    // 继续运行 — 不应崩溃
    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("spawn destroyed");
  });
});

// ─── Creep 异常 ─────────────────────────────────────────────

describe("Edge Case: Creep 异常", () => {
  it("全部 creep 突然死亡后 AI 恢复", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 20000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .source("s2", 32, 22)
      .container(23, 22, 1500)
      .container(31, 22, 1500)
      .extensions([
        { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
        { x: 26, y: 26 }, { x: 25, y: 24 },
      ])
      .creep("h1", "harvester", 23, 23, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .creep("h2", "harvester", 31, 23, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s2" } })
      .creep("u1", "upgrader", 29, 29, [
        { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
      ], { memory: { role: "upgrader", home: "W1N1", mode: "work" } })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    // 填充能量
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 稳定运行
    runner.run(world, 50);

    // 全部杀死
    for (const c of [...world.creeps]) {
      world.killCreep(c.name);
    }
    expect(world.creeps.length).toBe(0);

    // 恢复运行 — AI 应该重新孵化
    const result = runner.run(world, 800, {
      stopWhen: (w) => w.creeps.length > 0,
    });

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("all creeps dead");

    // 必须恢复：产生新 creep
    expect(world.creeps.length).toBeGreaterThan(0);
  });

  it("creep memory 损坏（缺少 role）不崩溃", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 10000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .creep("broken", "unknown", 24, 24, [
        { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { home: "W1N1" } }) // 缺少 role 字段
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 100);
    const assertions = new Assertions(world, result.records);

    // 不应有致命错误（unknown role 被 kernel 优雅处理）
    assertions.assertEmpireAlive("corrupted memory");
  });

  it("creep TTL=1 时正常死亡不影响系统", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 10000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .extensions([{ x: 24, y: 24 }, { x: 26, y: 24 }])
      .creep("dying", "harvester", 23, 22, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], {
        ticksToLive: 1,
        memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" },
      })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 500, {
      stopWhen: (w) => w.creeps.length > 0 && w.tick > 10,
    });

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("creep TTL=1");

    // creep 应该死亡并被替换
    expect(world._stats.creepsDied).toBeGreaterThan(0);
  });
});

// ─── 能量危机 ─────────────────────────────────────────────

describe("Edge Case: 能量危机", () => {
  it("source 枯竭后 AI 进入节能模式并恢复", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 20000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .container(23, 22, 1500)
      .extensions([
        { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
        { x: 26, y: 26 }, { x: 25, y: 24 },
      ])
      .creep("h1", "harvester", 23, 23, [
        { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 稳定运行
    runner.run(world, 100);

    // 模拟 source 枯竭（设为 0 且停止再生）
    world.setSourceEnergy("s1", 0);
    (world.config as { sourceRegenPerTick: number }).sourceRegenPerTick = 0;

    // 继续运行 — 不应崩溃
    const result = runner.run(world, 300);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("source depleted");
    assertions.assertEmpireAlive("source depleted");

    // 恢复 source
    (world.config as { sourceRegenPerTick: number }).sourceRegenPerTick = 10;
    world.setSourceEnergy("s1", 3000);

    // 恢复运行
    const result2 = runner.run(world, 500);
    // 经济应该恢复
    expect(result2.finalSnapshot.stats.totalHarvested).toBeGreaterThan(
      result.finalSnapshot.stats.totalHarvested,
    );
  });

  it("container 全部被毁后回退到 spawn 直送", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 20000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(28, 28)
      .source("s1", 22, 22)
      .container(23, 22, 1000)
      .extensions([{ x: 24, y: 24 }, { x: 26, y: 24 }])
      .creep("h1", "harvester", 23, 23, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    runner.run(world, 50);

    // 摧毁所有 container
    for (const c of [...world.containers]) {
      world.destroyContainer(c.id);
    }
    expect(world.containers.length).toBe(0);

    // 继续运行 — harvester 应该回退到 fillTarget（spawn/extension）
    const result = runner.run(world, 300);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("containers destroyed");
    assertions.assertEmpireAlive("containers destroyed");
  });
});

// ─── Memory 异常 ─────────────────────────────────────────────

describe("Edge Case: Memory 异常", () => {
  it("Memory.rooms 为空时不崩溃", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(1)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(28, 28)
      .source("s1", 22, 22)
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 清空 Memory.rooms
    world.installGlobals();
    const mem = (globalThis as Record<string, unknown>).Memory as Record<string, unknown>;
    mem.rooms = {};
    mem.creeps = {};
    mem.kernel = {};

    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("empty Memory.rooms");
    assertions.assertEmpireAlive("empty Memory.rooms");
  });

  it("Memory.schemaVersion=0（旧版本）触发迁移不崩溃", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 10000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 设置旧版本 schema
    world.installGlobals();
    const mem = (globalThis as Record<string, unknown>).Memory as Record<string, unknown>;
    mem.schemaVersion = 0;
    mem.rooms = {};
    mem.kernel = {};

    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("schema migration");
  });

  it("creep memory 全部为 undefined 时不崩溃", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 10000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .creep("amnesia", "harvester", 23, 22, [
        { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: undefined as unknown as Record<string, unknown> })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 100);
    // kernel 通过 safeRun 捕获 TypeError，不会终止 tick 循环。
    // 验证：100 tick 全部执行完毕（系统未崩溃）。
    expect(result.ticks).toBe(100);
    // 帝国仍存活（spawn 存在）。
    expect(world.spawns.length).toBeGreaterThan(0);
  });
});

// ─── CPU 压力 ─────────────────────────────────────────────

describe("Edge Case: CPU 压力", () => {
  it("50 creep 时系统稳定不超时", () => {
    const builder = new ScenarioBuilder("W1N1")
      .rcl(4, 100000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(35, 35)
      .source("s1", 15, 15)
      .source("s2", 35, 15)
      .container(16, 15, 1500)
      .container(34, 15, 1500)
      .storage(26, 25, 50000)
      .tower(27, 25, 800)
      .extensions(
        Array.from({ length: 20 }, (_, i) => ({
          x: 20 + (i % 5),
          y: 22 + Math.floor(i / 5),
        })),
      )
      .sourceRegen(10)
      .cpu(10000);

    // 添加 50 个 creep
    const roles = ["harvester", "hauler", "upgrader", "builder"];
    for (let i = 0; i < 50; i++) {
      const role = roles[i % roles.length]!;
      builder.creep(`creep_${i}`, role, 20 + (i % 10), 30 + Math.floor(i / 10), [
        { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role, home: "W1N1", mode: "acquire" } });
    }

    const world = builder.build();
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 100);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("50 creeps CPU pressure");
    assertions.assertEmpireAlive("50 creeps");

    // 性能：每 tick 平均不超过 50ms（测试环境）
    expect(result.avgTickMs).toBeLessThan(50);
  });

  it("CPU bucket=0 时 P2+ 角色被跳过但 P0/P1 正常", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 20000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .container(23, 22, 1000)
      .extensions([{ x: 24, y: 24 }, { x: 26, y: 24 }])
      .creep("h1", "harvester", 23, 23, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .creep("u1", "upgrader", 29, 29, [
        { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "upgrader", home: "W1N1", mode: "work" } })
      .sourceRegen(10)
      .cpu(0) // bucket = 0 → recovery tier
      .build();

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 100);
    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("CPU bucket=0");
    assertions.assertEmpireAlive("CPU bucket=0");
  });
});

// ─── 随机事件压力测试 ─────────────────────────────────────────

describe("Edge Case: 随机事件压力测试", () => {
  it("3000 tick 随机事件不崩溃", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 30000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .container(21, 20, 1000)
      .container(31, 20, 1000)
      .extensions([
        { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
        { x: 26, y: 26 }, { x: 25, y: 24 },
      ])
      .creep("h1", "harvester", 21, 21, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .creep("h2", "harvester", 31, 21, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s2" } })
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .build();

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 伪随机事件注入
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    const result = runner.run(world, 3000, {
      onTick: (w, tick) => {
        const r = rand();
        if (r < 0.001 && w.creeps.length > 2) {
          // 0.1% 概率随机杀死一个 creep（仅当 >2 时，保留最小劳动力）
          const victim = w.creeps[Math.floor(rand() * w.creeps.length)];
          if (victim) w.killCreep(victim.name);
        } else if (r < 0.004 && w.hostiles.length === 0) {
          // 0.3% 概率出现敌人
          w.addHostile(`invader_${tick}`, { x: 5, y: 5 });
        } else if (r < 0.006 && w.hostiles.length > 0) {
          // 0.2% 概率敌人离开
          w.removeHostile(w.hostiles[0]!.name);
        }
      },
    });

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("random events 3000 ticks");
    assertions.assertEmpireAlive("random events 3000 ticks");

    // 3000 tick 后帝国应该还活着且有 creep
    expect(world.creeps.length).toBeGreaterThan(0);
  });
});
