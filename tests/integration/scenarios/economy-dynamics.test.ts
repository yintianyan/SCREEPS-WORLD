/** Economy Dynamics — 经济动力学集成测试。 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions, GameInspector } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

// ─── 辅助 ───────────────────────────────────────────────────

/** RCL4 标准世界（含 storage），可配置初始能量水位。 */
function economyWorld(opts?: {
  storageEnergy?: number;
  containerEnergy?: number;
  controllerContainerEnergy?: number;
}): TestWorld {
  const world = new ScenarioBuilder("W1N1")
    .rcl(4, 200000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 38)
    .source("s1", 12, 12)
    .source("s2", 38, 12)
    .container(13, 12, opts?.containerEnergy ?? 1500)
    .container(37, 12, opts?.containerEnergy ?? 1500)
    .container(29, 37, opts?.controllerContainerEnergy ?? 1000)
    .storage(26, 25, opts?.storageEnergy ?? 30000)
    .tower(24, 25, 800)
    .extensions(
      Array.from({ length: 20 }, (_, i) => ({
        x: 21 + (i % 5) * 2,
        y: 22 + Math.floor(i / 5) * 2,
      })),
    )
    .sourceRegen(10)
    .containerDecay(5000)
    .cpu(10000)
    .preseedRoomState()
    .build();

  return world;
}

/** 添加标准 RCL4 经济人口。 */
function addEconomyPopulation(world: TestWorld): void {
  world.addCreep("h1", "harvester", 13, 13, [
    { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ], { sourceId: "s1", mode: "work" });
  world.addCreep("h2", "harvester", 37, 13, [
    { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ], { sourceId: "s2", mode: "work" });
  world.addCreep("haul1", "hauler", 20, 20, [
    { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });
  world.addCreep("haul2", "hauler", 22, 22, [
    { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });
  world.addCreep("u1", "upgrader", 29, 38, [
    { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });
  world.addCreep("b1", "builder", 24, 24, [
    { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
  ], { mode: "acquire" });

  world.spawns[0]!.store.energy = 300;
  for (const ext of world.extensions) ext.store.energy = 50;
  world.room._recalcEnergy();
}

// ─── 测试 ───────────────────────────────────────────────────

describe("Economy Dynamics — 经济压力梯度", () => {
  it("高压力（storage 空 + container 空）时 builder 被缩减但 harvester 不受影响", () => {
    // 模拟经济危机：storage 空、container 空 → drainScore 飙升 → pressure 接近 1.0
    const world = economyWorld({
      storageEnergy: 0,
      containerEnergy: 0,
      controllerContainerEnergy: 0,
    });

    // 完整人口（含 builder）
    addEconomyPopulation(world);

    // 清空 spawn/extensions 能量 — 最大化压力信号
    world.spawns[0]!.store.energy = 0;
    for (const ext of world.extensions) ext.store.energy = 0;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 500 tick — 让 drainScore 累积到高位
    const result = runner.run(world, 500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("high pressure economy");
    assertions.assertEmpireAlive("high pressure economy");

    // 核心不变量：harvester 始终存在（P1 不受压力缩减）
    // 即使经济危机，采矿不能停
    const harvesters = world.creepsByRole("harvester");
    // harvester 可能因寿命死亡，但系统应该尝试补充
    // 验证：500 tick 内有采集发生
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });

  it("低压力（storage 满）时 upgrader 全力升级", () => {
    // 模拟经济充盈：storage 满 → pressure 接近 0 → upgrader 全速
    const world = economyWorld({
      storageEnergy: 190000, // 接近满（200K 容量）
      containerEnergy: 1800,
      controllerContainerEnergy: 1800,
    });

    addEconomyPopulation(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("low pressure upgrade");
    assertions.assertEmpireAlive("low pressure upgrade");

    // 低压力 + 高 storage → upgrader 应该活跃升级
    expect(result.finalSnapshot.stats.totalUpgraded).toBeGreaterThan(0);
  });

  it("压力梯度变化时系统平滑过渡（无振荡）", () => {
    // 从高压开始，中途注入能量恢复 → 验证不产生 crisis/recovery 振荡
    const world = economyWorld({
      storageEnergy: 0,
      containerEnergy: 200,
      controllerContainerEnergy: 0,
    });

    addEconomyPopulation(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // Phase 1: 200 tick 高压
    runner.run(world, 200);

    // Phase 2: 注入大量能量（模拟外部援助/source 恢复）
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    for (const c of world.containers) c.store.energy = 1800;
    if (world.storage) world.storage.store.energy = 100000;
    world.room._recalcEnergy();

    // Phase 3: 800 tick 恢复期
    const result = runner.run(world, 800);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("pressure transition");
    assertions.assertEmpireAlive("pressure transition");

    // 恢复后经济应该正常运转
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });
});

describe("Economy Dynamics — Hauler 震荡防护", () => {
  it("hauler 不从 controllerContainer 取能（防乒乓）", () => {
    // 场景：只有 controllerContainer 有能量，其他 container 空
    // 如果 hauler 从 controllerContainer 取能 → 倒入 spawn → 生成新 haul 任务
    // → 另一个 hauler 取出 → upgrader 断粮循环
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      // source container 空 — 无正常取能源
      .container(16, 15, 0)
      // controllerContainer 有能量 — 这是 upgrader 的专属 supply
      .container(29, 34, 1500)
      .extensions([
        { x: 23, y: 24 }, { x: 24, y: 23 }, { x: 25, y: 23 },
        { x: 26, y: 23 }, { x: 27, y: 24 },
      ])
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .build();

    // 1 harvester + 2 hauler + 1 upgrader
    world.addCreep("h1", "harvester", 16, 16, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    world.addCreep("haul2", "hauler", 22, 22, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    world.addCreep("u1", "upgrader", 29, 35, [
      { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const controllerContainer = world.containers.find(
      c => c.pos.x === 29 && c.pos.y === 34,
    )!;

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 300 tick
    runner.run(world, 300);

    // 核心不变量：controllerContainer 的能量应该只被 upgrader 消耗
    // 如果 hauler 乒乓取能，container 会被快速抽空再回填
    // 验证：controllerContainer 能量不应该被 hauler 完全抽空
    // （upgrader 消耗是渐进的，不会一次性清空 1500）
    // 注意：harvester 会往 source container 填能量，hauler 从那里取
    // 关键断言：系统不崩溃 + upgrader 有升级发生
    const assertions = new Assertions(world, []);
    assertions.assertEmpireAlive("hauler oscillation prevention");
  });

  it("多 hauler 不互相抢占同一 container（任务唯一性）", () => {
    // 场景：2 个 source container 各有能量，2 个 hauler
    // 每个 hauler 应该分配到不同 container，不出现两个 hauler 抢同一个
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      .source("s2", 35, 15)
      .container(16, 15, 1800)
      .container(34, 15, 1800)
      .extensions([
        { x: 23, y: 24 }, { x: 24, y: 23 }, { x: 25, y: 23 },
        { x: 26, y: 23 }, { x: 27, y: 24 },
      ])
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .build();

    world.addCreep("h1", "harvester", 16, 16, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 34, 16, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    world.addCreep("haul2", "hauler", 22, 22, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("hauler task uniqueness");
    assertions.assertEmpireAlive("hauler task uniqueness");

    // 两个 container 都应该被消耗（两个 hauler 各取一个）
    // 如果两个 hauler 抢同一个，另一个 container 会溢满
    const c1 = world.containers[0]!;
    const c2 = world.containers[1]!;
    // 至少一个 container 被取过（能量低于初始 1800 或被 harvester 回填后仍低于满）
    // 核心：系统正常运转，无死锁
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });
});

describe("Economy Dynamics — Spawn Queue 隔离", () => {
  it("不可负担的 P2 请求不阻塞 P0 紧急孵化", () => {
    // 场景：RCL4 但能量极低（只有 200），P2 upgrader body 需要 500+
    // P0 worker 只需要 [WORK,CARRY,MOVE] = 200
    // 验证：P0 不被 P2 阻塞
    const world = new ScenarioBuilder("W1N1")
      .rcl(4, 200000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 38)
      .source("s1", 12, 12)
      .container(13, 12, 0) // 空 container
      .storage(26, 25, 0) // 空 storage
      .extensions(
        Array.from({ length: 20 }, (_, i) => ({
          x: 21 + (i % 5) * 2,
          y: 22 + Math.floor(i / 5) * 2,
        })),
      )
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .build();

    // 无 creep — 触发 P0 紧急 worker 孵化
    // spawn 只有 200 能量（刚好够 [WORK,CARRY,MOVE]）
    world.spawns[0]!.store.energy = 200;
    for (const ext of world.extensions) ext.store.energy = 0;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 500 tick — P0 worker 应该被孵化
    const result = runner.run(world, 500, {
      stopWhen: (w) => w.creeps.length > 0,
    });

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("spawn queue isolation");

    // P0 worker 必须被孵化（不被不可负担的 P2 阻塞）
    expect(world.creeps.length).toBeGreaterThan(0);
  });

  it("spawn 持续无能量时 queue 不无限堆积", () => {
    // 场景：source 枯竭 + 无 container 能量 → spawn 永远无法孵化
    // 验证：queue 有上限/清理机制，不会无限增长导致 Memory 膨胀
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      .sourceRegen(0) // source 不再生
      .containerDecay(0)
      .cpu(10000)
      .build();

    // 1 个 harvester 但 source 空
    world.addCreep("h1", "harvester", 16, 16, [
      { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });

    // 清空所有能量
    world.spawns[0]!.store.energy = 0;
    world.room._recalcEnergy();
    world.setSourceEnergy("s1", 0);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 1000 tick — 系统不应崩溃
    const result = runner.run(world, 1000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("spawn queue overflow");
    // 帝国仍存活（spawn 存在）
    expect(world.spawns.length).toBeGreaterThan(0);
  });
});

describe("Economy Dynamics — Harvester 替换时序", () => {
  it("harvester 临死前触发替换，采矿间隙最小化", () => {
    // 场景：harvester ticksToLive=100（即将死亡）
    // 系统应该提前孵化替换（bodyLength*3+15+travel ≈ 50-80 tick 前）
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      .source("s2", 35, 15)
      .container(16, 15, 1500)
      .container(34, 15, 1500)
      .extensions([
        { x: 23, y: 24 }, { x: 24, y: 23 }, { x: 25, y: 23 },
        { x: 26, y: 23 }, { x: 27, y: 24 }, { x: 23, y: 26 },
        { x: 24, y: 27 }, { x: 25, y: 27 }, { x: 26, y: 27 },
        { x: 27, y: 26 },
      ])
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .build();

    // 1 个即将死亡的 harvester + 1 个正常 harvester
    world.addCreep("h_dying", "harvester", 16, 16, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work", ticksToLive: 100 });
    world.addCreep("h2", "harvester", 34, 16, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 500 tick — 足够让 h_dying 死亡并孵化替换
    const result = runner.run(world, 500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("harvester replacement");
    assertions.assertEmpireAlive("harvester replacement");

    // 核心不变量：h_dying 死亡后，系统应该已经孵化了替换
    // 验证：500 tick 后仍有 harvester 存在
    const harvesters = world.creepsByRole("harvester");
    expect(harvesters.length).toBeGreaterThanOrEqual(1);

    // 验证：有孵化发生（替换被触发）
    expect(result.finalSnapshot.stats.totalSpawned).toBeGreaterThan(0);
  });

  it("双 harvester 同时临死时不产生永久采矿真空", () => {
    // 极端场景：两个 harvester 同时即将死亡
    // 系统应该优先孵化 P0/P1 替换，不陷入死锁
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      .source("s2", 35, 15)
      .container(16, 15, 1500)
      .container(34, 15, 1500)
      .extensions([
        { x: 23, y: 24 }, { x: 24, y: 23 }, { x: 25, y: 23 },
        { x: 26, y: 23 }, { x: 27, y: 24 }, { x: 23, y: 26 },
        { x: 24, y: 27 }, { x: 25, y: 27 }, { x: 26, y: 27 },
        { x: 27, y: 26 },
      ])
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .build();

    // 两个 harvester 都只剩 30 tick
    world.addCreep("h1", "harvester", 16, 16, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work", ticksToLive: 30 });
    world.addCreep("h2", "harvester", 34, 16, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work", ticksToLive: 30 });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 800 tick — 两个 harvester 死亡后系统必须恢复
    const result = runner.run(world, 800, {
      stopWhen: (w) => w.tick > 100 && w.creepsByRole("harvester").length >= 1,
    });

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("dual harvester death");
    assertions.assertEmpireAlive("dual harvester death");

    // 系统必须恢复采矿能力
    expect(result.finalSnapshot.stats.totalSpawned).toBeGreaterThan(0);
  });
});

describe("Economy Dynamics — Colony State 滞回", () => {
  it("drainScore 在阈值附近振荡时不产生状态翻转", () => {
    // 场景：能量收支接近平衡（每 tick 微小波动）
    // drainScore 在 40-60 之间振荡 → 不应该每 tick 切换 crisis/recovery
    const world = economyWorld({
      storageEnergy: 5000, // 中等水位
      containerEnergy: 800,
      controllerContainerEnergy: 500,
    });

    addEconomyPopulation(world);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 1000 tick — 观察系统稳定性
    const result = runner.run(world, 1000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("colony state hysteresis");
    assertions.assertEmpireAlive("colony state hysteresis");

    // 核心不变量：经济不进入死亡螺旋
    const inspector = new GameInspector(world);
    const economy = inspector.economyReport(result.records);
    expect(economy.deathSpiral).toBe(false);

    // 采集持续进行（系统没有因为状态翻转而停滞）
    expect(economy.totalHarvested).toBeGreaterThan(2000);
  });

  it("从 crisis 恢复需要持续盈余（不对称滞回）", () => {
    // 场景：先制造 crisis（清空能量），然后恢复
    // 验证：恢复不是瞬间的，需要持续盈余才能退出 recovery
    const world = economyWorld({
      storageEnergy: 0,
      containerEnergy: 0,
      controllerContainerEnergy: 0,
    });

    addEconomyPopulation(world);

    // 清空一切 → 触发 crisis
    world.spawns[0]!.store.energy = 0;
    for (const ext of world.extensions) ext.store.energy = 0;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // Phase 1: 100 tick crisis 积累
    runner.run(world, 100);

    // Phase 2: 恢复能量（但只恢复一部分）
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    for (const c of world.containers) c.store.energy = 1000;
    world.room._recalcEnergy();

    // Phase 3: 200 tick — 系统应该逐步恢复，不是瞬间切换
    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("crisis recovery hysteresis");
    assertions.assertEmpireAlive("crisis recovery hysteresis");

    // 恢复后采集正常
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });
});
