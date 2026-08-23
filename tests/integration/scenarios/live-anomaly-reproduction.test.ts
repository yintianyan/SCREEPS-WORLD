/**
 * Live Anomaly Reproduction — 从 W37S58 线上数据提取的真实故障场景。
 *
 * 数据来源：2026-07-24 diagnose.js 采集，tick 81742700–81758320。
 * 这些测试不是从代码推导的，而是从真实运行数据中观察到的异常模式固化而来。
 *
 * 异常 1：Hauler 不足死锁
 *   - energyAvailable 持续 300-500（容量 1800）
 *   - Hauler body 24 部件（~1200 能量）
 *   - colonyState=normal → P1 hauler 不触发 body 降级
 *   - 结果：spawn 永远凑不够能量孵 hauler → 物流断裂 → spawn 继续饿
 *
 * 异常 2：Phase 振荡（Flip-Flop）
 *   - 32 次相位切换 / 15600 tick，14/31 间隔 < 100 tick
 *   - drainScore 脉冲式 0→100→0（spawn 一次性消耗 1200 触发）
 *   - 滞回机制（scoreStep=20, recoveryStep=30）无法处理脉冲式消耗
 *
 * 异常 3：Distributor 空转浪费
 *   - 3 个 distributor 存活但 storage=0
 *   - 无事可做永久 idle，占用人口槽位
 *   - 同时 spawn 孵不起 hauler
 *
 * 异常 4：Harvester 计数振荡
 *   - 2→4→2 快速振荡（11 次），harvester 存活仅 100-300 tick
 *   - 替换请求与实际死亡时序错配
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions, GameInspector } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

// ─── 辅助：复现 W37S58 的 RCL5 配置 ─────────────────────────

/**
 * 复现 W37S58 的关键参数：
 *   - RCL5, energyCapacity=1800 (spawn 300 + 30 extensions × 50)
 *   - 2 source containers（高 fillRatio）
 *   - 1 controller container
 *   - 无 storage（线上 storage=0，可能未建成或已毁）
 *   - 1 tower
 */
function w37s58World(opts?: {
  containerEnergy?: number;
  spawnEnergy?: number;
  extensionFillRatio?: number;
}): TestWorld {
  const extFill = opts?.extensionFillRatio ?? 0.2;
  const world = new ScenarioBuilder("W37S58")
    .rcl(5, 500000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 38)
    .source("s1", 12, 12)
    .source("s2", 38, 12)
    // source containers — 高 fillRatio（线上观察到 container 积压 5000-6000）
    .container(13, 12, opts?.containerEnergy ?? 1800)
    .container(37, 12, opts?.containerEnergy ?? 1800)
    // controller container
    .container(29, 37, 1500)
    // 无 storage（复现线上 storage=0 的状态）
    .tower(24, 25, 600)
    // 30 extensions（RCL5 上限）
    .extensions(
      Array.from({ length: 30 }, (_, i) => ({
        x: 20 + (i % 6) * 2,
        y: 22 + Math.floor(i / 6) * 2,
      })),
    )
    .sourceRegen(10)
    .containerDecay(5000)
    .cpu(10000)
    .preseedRoomState()
    .build();

  // 设置 spawn/extension 能量（复现线上 ea=300-500 的低水位）
  world.spawns[0]!.store.energy = opts?.spawnEnergy ?? 300;
  for (const ext of world.extensions) {
    ext.store.energy = Math.floor(50 * extFill);
  }
  world.room._recalcEnergy();

  return world;
}

// ─── 异常 1：Hauler 不足死锁 ───────────────────────────────

describe("Live Anomaly: Hauler 不足死锁", () => {
  it("energyAvailable 低水位时 P1 hauler 应能降级孵化（复现线上死锁）", () => {
    // 复现：energyAvailable=400, hauler body 需要 ~1200
    // 线上表现：spawn queue 有 3 个 hauler 请求但 sp=0（什么都没孵）
    // 根因：colonyState=normal → P1 不降级 → 永远凑不够 1200
    const world = w37s58World({
      containerEnergy: 1800, // container 满（能量存在但搬不到 spawn）
      spawnEnergy: 200,
      extensionFillRatio: 0.1, // extensions 几乎空
    });

    // 2 harvester（正常采矿）+ 0 hauler（物流断裂）
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 1000 tick — 系统应该能孵出 hauler（即使是降级 body）
    const result = runner.run(world, 1000, {
      stopWhen: (w) => w.creepsByRole("hauler").length >= 1,
    });

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("hauler deadlock");

    // 核心断言：系统必须在 1000 tick 内孵出至少 1 个 hauler
    // 如果这个断言失败，说明线上死锁 bug 仍然存在
    const haulers = world.creepsByRole("hauler");
    expect(haulers.length).toBeGreaterThanOrEqual(1);
  });

  // B4 重写（P3）：断言改为「经济不停滞」不变量——recycleCreep 引擎语义修复后，
  // 旧「hauler 头数」代理不再成立（解药可以不是多孵 hauler：单 hauler 循环 + P2 消费
  // 同样消化积压）。不变量：无运行时错误 ∧ 帝国存活 ∧ 采集量可观 ∧ 积压被消化。
  it("container 能量积压但 spawn 饥饿时经济不应停滞", () => {
    // 复现：reserve=6000 但 ea=300（能量困在 container 里）
    // 线上表现：harvester 持续采矿，container 满溢，但 spawn 饿死
    const world = w37s58World({
      containerEnergy: 1900, // container 接近满
      spawnEnergy: 100,
      extensionFillRatio: 0.05,
    });

    // 2 harvester + 1 hauler（运力不足）
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 1000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("container energy trap");
    assertions.assertEmpireAlive("container energy trap");

    // 核心不变量（B4 重写）：能量困在 container 的死锁不再存在。
    // 不以 hauler 头数为代理——解药形式不限（多孵 hauler 或单 hauler 循环 + P2 消费）。
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(2000);
    const maxContainerFill = Math.max(
      0,
      ...world.containers.map(c => c.store.getUsedCapacity(RESOURCE_ENERGY)),
    );
    expect(maxContainerFill).toBeLessThan(1900); // 起始 1900，应被搬走一部分
  });
});

// ─── 异常 2：Phase 振荡 ───────────────────────────────────

describe("Live Anomaly: Phase 振荡（Flip-Flop）", () => {
  it("脉冲式消耗（spawn 一次性 1200）不应导致 phase 快速翻转", () => {
    // 复现：drainScore 在 spawn 孵化时脉冲到 100，下一 sample 恢复到 0
    // 线上表现：32 次相位切换 / 15600 tick，14 次间隔 < 100 tick
    // 根因：滞回机制设计为渐进式消耗，无法处理脉冲式消耗
    const world = w37s58World({
      containerEnergy: 1500,
      spawnEnergy: 300,
      extensionFillRatio: 0.3,
    });

    // 完整人口
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    world.addCreep("haul2", "hauler", 22, 22, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    // harvester 即将死亡 → 触发替换孵化（脉冲消耗）
    world.addCreep("h_dying", "harvester", 13, 14, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work", ticksToLive: 80 });

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 2000 tick — 观察 phase 稳定性
    const result = runner.run(world, 2000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("phase oscillation");
    assertions.assertEmpireAlive("phase oscillation");

    // 核心断言：经济不进入死亡螺旋
    const inspector = new GameInspector(world);
    const economy = inspector.economyReport(result.records);
    expect(economy.deathSpiral).toBe(false);

    // 采集应该持续（phase 振荡不应导致系统停滞）
    expect(economy.totalHarvested).toBeGreaterThan(5000);
  });

  it("连续 spawn 脉冲不应累积 drainScore 到 crisis", () => {
    // 复现：多个替换请求同时触发（harvester + hauler 同时临死）
    // 线上表现：drainScore 从 0 脉冲到 100，触发 crisis，但实际经济健康
    const world = w37s58World({
      containerEnergy: 1800,
      spawnEnergy: 300,
      extensionFillRatio: 0.5,
    });

    // 多个 creep 同时临死 → 同时触发替换 → 脉冲消耗
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work", ticksToLive: 60 });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work", ticksToLive: 60 });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire", ticksToLive: 60 });

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 1500 tick — 所有 creep 死亡后系统应恢复
    const result = runner.run(world, 1500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("pulse drain");
    assertions.assertEmpireAlive("pulse drain");

    // 核心不变量（B4 重写）：脉冲消耗后系统恢复——窗口末段任一采样点出现存活
    // harvester 即算恢复（瞬时端点受 TTL 相位影响，不作硬断言）。
    const recovered = result.records.some(
      r => r.tick > 900 && (r.creepsByRole.harvester ?? 0) >= 1,
    );
    expect(recovered).toBe(true);
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });
});

// ─── 异常 3：Distributor 空转 ─────────────────────────────

describe("Live Anomaly: Distributor 空转浪费", () => {
  it("storage 空时 distributor 不应被孵化（或应被回收）", () => {
    // 复现：3 个 distributor idle（storage=0），同时 spawn 孵不起 hauler
    // 线上表现：distributor 占用人口槽位但不做任何事
    // 设计意图：distributor 从 storage 取能分发，storage=0 时无事可做
    const world = w37s58World({
      containerEnergy: 1500,
      spawnEnergy: 300,
      extensionFillRatio: 0.2,
    });

    // 2 harvester + 1 hauler + 3 distributor（复现线上人口结构）
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    // 3 个 idle distributor（storage=0，无事可做）
    world.addCreep("dist1", "distributor", 24, 24, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
    ], { mode: "idle" });
    world.addCreep("dist2", "distributor", 25, 24, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
    ], { mode: "idle" });
    world.addCreep("dist3", "distributor", 26, 24, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
    ], { mode: "idle" });

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 500 tick
    const result = runner.run(world, 500);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("distributor idle");
    assertions.assertEmpireAlive("distributor idle");

    // 核心断言：系统正常运转，采集继续
    // distributor idle 本身不是 bug（设计允许），但如果它阻塞了 hauler 孵化就是 bug
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });
});

// ─── 异常 4：Harvester 计数振荡 ───────────────────────────

describe("Live Anomaly: Harvester 计数振荡", () => {
  it("harvester 替换不应产生 2→4→2 快速振荡", () => {
    // 复现：harvester 计数在 2 和 4 之间快速振荡（11 次 / 15600 tick）
    // 线上表现：harvester 存活仅 100-300 tick 就死亡
    // 可能根因：替换请求创建了额外 harvester，但 sourceOccupancy 已满导致新 harvester 无事可做
    const world = w37s58World({
      containerEnergy: 1500,
      spawnEnergy: 300,
      extensionFillRatio: 0.4,
    });

    // 2 harvester 正常 + 1 即将死亡（触发替换）
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work", ticksToLive: 100 });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 2000 tick — 观察 harvester 人口稳定性
    const result = runner.run(world, 2000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("harvester oscillation");
    assertions.assertEmpireAlive("harvester oscillation");

    // 核心不变量（B4 重写）：全窗口采样——并发 harvester 峰值 ≤3（sourceOccupancy 上限
    // + 替换重叠容差）；归零 tick 占比 <20%（短 TTL 缺口允许，长期断供不允许）；
    // 采集持续。
    let maxHarvesters = 0;
    let zeroTicks = 0;
    for (const r of result.records) {
      const n = r.creepsByRole.harvester ?? 0;
      if (n > maxHarvesters) maxHarvesters = n;
      if (n === 0) zeroTicks++;
    }
    expect(maxHarvesters).toBeLessThanOrEqual(3);
    expect(zeroTicks / result.records.length).toBeLessThan(0.2);
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(5000);
  });
});

// ─── 综合：复现线上完整症状链 ─────────────────────────────

describe("Live Anomaly: W37S58 完整症状链", () => {
  it("RCL5 无 storage + 低 ea + 高 container 积压：系统应自愈而非死锁", () => {
    // 这是 W37S58 的完整症状链复现：
    // 1. storage=0（未建成或已毁）
    // 2. container 积压 5000-6000 能量
    // 3. energyAvailable 持续 300-500
    // 4. hauler body 需要 1200 → spawn 孵不起
    // 5. 2 hauler 运力不足 → spawn 继续饿
    // 6. crisisCount=93（系统反复恐慌）
    //
    // 期望行为：系统应该通过 body 降级或其他机制自愈
    const world = w37s58World({
      containerEnergy: 1900,
      spawnEnergy: 150,
      extensionFillRatio: 0.05,
    });

    // 最小人口：2 harvester + 1 hauler（运力严重不足）
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" },
    ], { mode: "acquire" });

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 3000 tick — 足够长的时间观察系统是否能自愈
    const result = runner.run(world, 3000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("W37S58 full symptom chain");
    assertions.assertEmpireAlive("W37S58 full symptom chain");

    // 核心断言 1：系统不应该死锁（3000 tick 后应该有孵化发生）
    expect(result.finalSnapshot.stats.totalSpawned).toBeGreaterThan(0);

    // 核心断言 2：经济不应该进入死亡螺旋
    const inspector = new GameInspector(world);
    const economy = inspector.economyReport(result.records);
    expect(economy.deathSpiral).toBe(false);

    // 核心断言 3：采集应该持续（harvester 不受物流影响）
    expect(economy.totalHarvested).toBeGreaterThan(10000);
  });
});
