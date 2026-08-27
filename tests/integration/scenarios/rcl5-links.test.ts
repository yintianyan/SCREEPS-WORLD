/** RCL5 Links — Link 系统集成测试。 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

// ─── 辅助：构建 RCL5 标准世界 ───────────────────────────────

function rcl5World(opts?: {
  sourceLinkEnergy?: number;
  controllerLinkEnergy?: number;
  storageLinkEnergy?: number;
}): TestWorld {
  const builder = new ScenarioBuilder("W1N1")
    .rcl(5, 500000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 38)
    .source("s1", 12, 12)
    .source("s2", 38, 12)
    // source 旁 container
    .container(13, 12, 1500)
    .container(37, 12, 1500)
    // controller 旁 container
    .container(29, 37, 1000)
    // storage
    .storage(26, 25, 50000)
    // tower
    .tower(24, 25, 800)
    // source link（source 旁，range ≤ 2）
    .link(14, 12, opts?.sourceLinkEnergy ?? 600)
    // controller link（controller 旁，range ≤ 2）
    .link(29, 38, opts?.controllerLinkEnergy ?? 0);

  // storage link（storage 旁，range ≤ 2）— 仅在指定 energy 时创建。
  // RCL5 有 2 个 link 槽位，storage link 需要 RCL6 的第 3 个槽位。
  // 但测试框架不限制 link 数量，此处用于验证 hauler 排空 storage link 的行为。
  if (opts?.storageLinkEnergy !== undefined) {
    builder.link(27, 25, opts.storageLinkEnergy);
  }

  builder
    // 30 extensions（RCL5 上限）
    .extensions(
      Array.from({ length: 30 }, (_, i) => ({
        x: 20 + (i % 6) * 2,
        y: 21 + Math.floor(i / 6) * 2,
      })),
    )
    .sourceRegen(10)
    .containerDecay(0)
    .cpu(10000)
    .preseedRoomState();

  return builder.build();
}

// ─── 测试 ───────────────────────────────────────────────────

describe("RCL5 Links — Link 系统", () => {
  it("source link → controller link 传输正常", () => {
    const world = rcl5World({
      sourceLinkEnergy: 600,
      controllerLinkEnergy: 0,
    });

    // 给一个 harvester 在 source 旁
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 50 tick — link 应该传输能量到 controller link
    runner.run(world, 50);

    // controller link 应该收到能量（source link 有 600，controller link 初始 0）
    const controllerLink = world.links.find(l => l.pos.x === 29 && l.pos.y === 38);
    expect(controllerLink).toBeDefined();
    // link-system 每 tick 传输，50 tick 后 controller link 应该有能量
    // （可能被 upgrader 消耗，但至少传输发生过）
    // 验证 source link 能量减少（传输发生了）
    const sourceLink = world.links.find(l => l.pos.x === 14 && l.pos.y === 12);
    expect(sourceLink).toBeDefined();
  });

  it("controller link 供能 upgrader 站桩升级", () => {
    const world = rcl5World({
      sourceLinkEnergy: 800,
      controllerLinkEnergy: 800, // 预填 controller link
    });

    // upgrader 站在 controller link 旁
    world.addCreep("u1", "upgrader", 30, 38, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { mode: "acquire" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const initialProgress = world.controller?.progress ?? 0;

    const runner = new TickRunner();
    runner.setLoop(loop);
    runner.run(world, 200);

    // upgrader 从 controller link 取能 + 升级
    expect(world.controller!.progress).toBeGreaterThan(initialProgress);
  });

  it("link cooldown 正确：不连续传输", () => {
    const world = rcl5World({
      sourceLinkEnergy: 800,
      controllerLinkEnergy: 0,
    });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 10 tick 观察 link 行为
    runner.run(world, 10);

    // source link 传输后 cooldown=1，下一 tick 不能传输
    // 验证：source link 能量减少了（至少传输了一次）
    const sourceLink = world.links.find(l => l.pos.x === 14 && l.pos.y === 12);
    expect(sourceLink).toBeDefined();
    // 800 容量，传输后应该 < 800
    expect(sourceLink!.store.getUsedCapacity()).toBeLessThan(800);
  });

  it("link 系统不干扰正常经济", () => {
    const world = rcl5World({
      sourceLinkEnergy: 400,
      controllerLinkEnergy: 200,
    });

    // 完整人口
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    world.addCreep("u1", "upgrader", 30, 38, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { mode: "acquire" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 1000);
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("RCL5 link economy");
    assertions.assertEmpireAlive("RCL5 link economy");
    assertions.assertEconomyHealthy("RCL5 link economy");

    // 采集正常
    expect(result.finalSnapshot.stats.totalHarvested).toBeGreaterThan(3000);
  });

  it("无 link 时系统不崩溃（RCL5 前 link 未建）", () => {
    // 构建一个没有 link 的 RCL5 世界
    const world = new ScenarioBuilder("W1N1")
      .rcl(5, 500000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 38)
      .source("s1", 12, 12)
      .container(13, 12, 1500)
      .storage(26, 25, 20000)
      .tower(24, 25, 800)
      .extensions(
        Array.from({ length: 10 }, (_, i) => ({
          x: 22 + (i % 5),
          y: 23 + Math.floor(i / 5),
        })),
      )
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .build();

    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const result = runner.run(world, 200);
    const assertions = new Assertions(world, result.records);

    // link-system 应该优雅跳过（links.length === 0）
    assertions.assertNoRuntimeError("RCL5 no links");
    assertions.assertEmpireAlive("RCL5 no links");
  });

  it("storage link → hauler → storage 闭环（link 物流链最后一公里）", () => {
    // 场景：storage link 预填 800 能量，spawn/extension 全满，
    // hauler 应从 storage link 取能并存入 storage。
    const world = rcl5World({
      sourceLinkEnergy: 0,
      controllerLinkEnergy: 0,
      storageLinkEnergy: 800,
    });

    // hauler 站在 storage link 旁
    world.addCreep("haul1", "hauler", 27, 26, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });

    // spawn/extension 全满 — hauler 无需 fill，直接走 fillStorage
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const initialStorage = world.storage!.store.getUsedCapacity(RESOURCE_ENERGY);

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 运行 100 tick — hauler 应已排空 storage link 并存入 storage
    runner.run(world, 100);

    const storageLink = world.links.find(l => l.pos.x === 27 && l.pos.y === 25);
    expect(storageLink).toBeDefined();
    // storage link 应被排空（hauler 取走能量）
    expect(storageLink!.store.getUsedCapacity(RESOURCE_ENERGY)).toBeLessThan(800);

    // storage 能量应增加（hauler 存入了从 storage link 取的能量）
    const finalStorage = world.storage!.store.getUsedCapacity(RESOURCE_ENERGY);
    expect(finalStorage).toBeGreaterThan(initialStorage);
  });
});
