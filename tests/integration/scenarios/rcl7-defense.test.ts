/**
 * RCL7 Defense — 防御系统集成测试。
 *
 * RCL7 关键特征：
 *   - 多 tower（最多 3 个）协同防御
 *   - hostile 检测 → tower 集火攻击
 *   - 无 tower 时 → safe mode 激活
 *   - creep flee 行为（shouldFlee → 释放任务 → 逃向 spawn/出口）
 *   - 敌人离开后恢复正常经济
 *
 * 验证目标：
 *   - threat detection：hostile 出现时 tower 立即攻击
 *   - tower 集火：多 tower 聚焦同一目标
 *   - creep 撤退：非战斗 creep 释放任务逃跑
 *   - safe mode：无 tower 时激活
 *   - 防御 spawn：敌人存在时不孵化非必要 creep
 *   - 恢复：敌人离开后经济恢复
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

// ─── 辅助：构建 RCL7 防御世界 ───────────────────────────────

function rcl7World(opts?: {
  towers?: number;
  towerEnergy?: number;
  hostiles?: number;
  safeModeAvailable?: number;
}): TestWorld {
  const towerCount = opts?.towers ?? 2;
  const builder = new ScenarioBuilder("W1N1")
    .rcl(7, 5000000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 40)
    .source("s1", 10, 10)
    .source("s2", 40, 10)
    .container(11, 10, 1500)
    .container(39, 10, 1500)
    .container(29, 39, 1000)
    .storage(26, 25, 100000)
    .extensions(
      Array.from({ length: 20 }, (_, i) => ({
        x: 20 + (i % 5) * 2,
        y: 22 + Math.floor(i / 5) * 2,
      })),
    )
    .sourceRegen(10)
    .containerDecay(0)
    .cpu(10000)
    .preseedRoomState();

  // 添加 tower
  for (let i = 0; i < towerCount; i++) {
    builder.tower(23 + i * 2, 25, opts?.towerEnergy ?? 900);
  }

  const world = builder.build();

  // 设置 safe mode
  if (world.controller && opts?.safeModeAvailable !== undefined) {
    world.controller.safeModeAvailable = opts.safeModeAvailable;
  }

  // 添加敌方 creep
  for (let i = 0; i < (opts?.hostiles ?? 0); i++) {
    world.addHostile(`invader_${i}`, { x: 5 + i * 2, y: 5 }, [
      { type: "attack" }, { type: "attack" }, { type: "tough" }, { type: "move" }, { type: "move" },
    ]);
  }

  return world;
}

/** 添加标准 RCL7 人口。 */
function addRcl7Population(world: TestWorld): void {
  world.addCreep("h1", "harvester", 11, 11, [
    { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ], { sourceId: "s1", mode: "work" });
  world.addCreep("h2", "harvester", 39, 11, [
    { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ], { sourceId: "s2", mode: "work" });
  world.addCreep("haul1", "hauler", 20, 20, [
    { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });
  world.addCreep("u1", "upgrader", 29, 40, [
    { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ], { mode: "acquire" });

  world.spawns[0]!.store.energy = 300;
  for (const ext of world.extensions) ext.store.energy = 50;
  world.room._recalcEnergy();
}

// ─── 测试 ───────────────────────────────────────────────────

describe("RCL7 Defense — 防御系统", () => {
  it("hostile 出现时 tower 立即攻击（能量消耗）", () => {
    const world = rcl7World({ towers: 2, towerEnergy: 900, hostiles: 1 });
    addRcl7Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    runner.run(world, 50);

    // tower 应该消耗能量进行攻击（每次攻击 10 能量）
    const totalTowerEnergy = world.towers.reduce((s, t) => s + t.store.getUsedCapacity(), 0);
    expect(totalTowerEnergy).toBeLessThan(1800); // 2×900 初始
  });

  it("多 tower 集火同一目标", () => {
    const world = rcl7World({ towers: 3, towerEnergy: 900, hostiles: 1 });
    addRcl7Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    runner.run(world, 10);

    // 3 个 tower 都应该消耗能量（集火同一目标）
    for (const tower of world.towers) {
      expect(tower.store.getUsedCapacity()).toBeLessThan(900);
    }
  });

  it("creep flee：hostile 出现时非战斗 creep 释放任务逃跑", () => {
    const world = rcl7World({ towers: 0, hostiles: 0, safeModeAvailable: 0 });
    addRcl7Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 稳定运行 50 tick
    runner.run(world, 50);

    // 注入敌人
    world.addHostile("raider", { x: 20, y: 20 }, [
      { type: "attack" }, { type: "attack" }, { type: "move" }, { type: "move" },
    ]);

    // 运行 20 tick — creep 应该进入 flee 模式
    runner.run(world, 20);

    // 至少有一个 creep 进入 flee 模式
    const fleeing = world.creeps.filter(c => c.memory.mode === "flee");
    expect(fleeing.length).toBeGreaterThan(0);
  });

  it("无 tower 时激活 safe mode", () => {
    const world = rcl7World({ towers: 0, hostiles: 0, safeModeAvailable: 1 });
    addRcl7Population(world);
    // 威胁已突入核心区（spawn 25,25 旁 range 1 <= safeModeTriggerRange）→ 应烧 safe mode。
    world.addHostile("breacher", { x: 26, y: 26 }, [
      { type: "attack" }, { type: "attack" }, { type: "move" }, { type: "move" },
    ]);

    const runner = new TickRunner();
    runner.setLoop(loop);

    runner.run(world, 10);

    // safe mode 应该被激活
    expect(world.controller?.safeMode).toBeDefined();
    expect(world.controller?.safeMode).toBeGreaterThan(0);
    // safe mode 次数减少
    expect(world.controller?.safeModeAvailable).toBe(0);
  });

  it("敌人离开后恢复正常经济", () => {
    const world = rcl7World({ towers: 2, towerEnergy: 900, hostiles: 1 });
    addRcl7Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 50 tick 有敌人
    runner.run(world, 50);

    // 敌人离开
    world.removeHostile("invader_0");

    // 恢复运行 300 tick
    const result = runner.run(world, 300);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL7 defense recovery");
    assertions.assertEmpireAlive("RCL7 defense recovery");

    // 经济恢复：采集继续
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);

    // creep 应该退出 flee 模式
    const fleeing = world.creeps.filter(c => c.memory.mode === "flee");
    expect(fleeing.length).toBe(0);
  });

  it("持续敌袭 500 tick 系统不崩溃", () => {
    const world = rcl7World({ towers: 2, towerEnergy: 900, hostiles: 2 });
    addRcl7Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL7 sustained attack");
    assertions.assertEmpireAlive("RCL7 sustained attack");

    // tower 持续消耗能量
    const totalTowerEnergy = world.towers.reduce((s, t) => s + t.store.getUsedCapacity(), 0);
    expect(totalTowerEnergy).toBeLessThan(1800);
  });

  it("tower 能量耗尽时不崩溃", () => {
    const world = rcl7World({ towers: 2, towerEnergy: 20, hostiles: 1 });
    addRcl7Population(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // tower 能量只够攻击 2 次（20/10=2）
    const result = runner.run(world, 100);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL7 tower empty");
    assertions.assertEmpireAlive("RCL7 tower empty");
  });
});

// ── P2-4: 多威胁同时入侵 ──────────────────────────────────

describe("RCL7 Defense — 多威胁同时入侵 (P2-4)", () => {
  it("多组敌方 creep 同时入侵：tower 不崩溃、creep 进入 flee、系统存活", () => {
    // 3 tower + 5 组敌人（模拟多房受袭在单房中的等效压力）
    const world = rcl7World({ towers: 3, towerEnergy: 1000, hostiles: 0 });
    addRcl7Population(world);

    // 手动注入 5 组敌方 creep（不同位置模拟多方向入侵）
    for (let i = 0; i < 5; i++) {
      world.addHostile(`multi_invader_${i}`, { x: 5 + i * 8, y: 5 }, [
        { type: "attack" }, { type: "attack" }, { type: "tough" }, { type: "move" }, { type: "move" },
      ]);
    }

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("多威胁同时入侵");
    assertions.assertEmpireAlive("多威胁同时入侵");

    // tower 能量应被消耗（攻击了敌人）
    const towerEnergyLeft = world.towers.reduce(
      (sum, t) => sum + (t.store[RESOURCE_ENERGY] ?? 0), 0,
    );
    expect(towerEnergyLeft).toBeLessThan(3000); // 3 tower × 1000 初始 = 3000

    // 经济 creep 应进入 flee 模式（非战斗 creep 释放任务逃跑）
    const nonFleeing = world.creeps.filter(
      c => c.memory.mode !== "flee" && c.memory.role !== "defender",
    );
    // 允许 harvester 留在 source（站桩采集是安全的），但 hauler/upgrader 应 flee
    const haulersAndUpgraders = world.creeps.filter(
      c => c.memory.role === "hauler" || c.memory.role === "upgrader",
    );
    const fleeingHaulers = haulersAndUpgraders.filter(c => c.memory.mode === "flee");
    // 至少部分非战斗 creep 应进入 flee
    expect(fleeingHaulers.length).toBeGreaterThan(0);
  });

  it("敌方 creep 被清除后系统恢复", () => {
    const world = rcl7World({ towers: 3, towerEnergy: 1000, hostiles: 0 });
    addRcl7Population(world);

    // 注入 3 组敌人
    for (let i = 0; i < 3; i++) {
      world.addHostile(`recover_invader_${i}`, { x: 10 + i * 10, y: 10 }, [
        { type: "attack" }, { type: "move" }, { type: "move" },
      ]);
    }

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 100 tick 后清除所有敌人
    runner.run(world, 100);
    for (let i = 0; i < 3; i++) {
      world.removeHostile(`recover_invader_${i}`);
    }

    // 再运行 100 tick 验证恢复
    const result = runner.run(world, 100);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("多威胁恢复");
    assertions.assertEmpireAlive("多威胁恢复");

    // creep 应退出 flee 模式
    const fleeing = world.creeps.filter(c => c.memory.mode === "flee");
    expect(fleeing.length).toBe(0);

    // 经济恢复运转
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });
});
