/**
 * A1 门槛证据 — 自举链路收口：RCL2→RCL3 爬升后 tower site 由 AI 自然创建。
 *
 * EMPIRE_MVP §4 场景 1 的关键断言面：「RCL3+ 且 tower 在建」。既有覆盖中
 * e2e-002 验证 RCL1→RCL2 爬升、e2e-004/rcl3-economy 在**预设** RCL3+tower
 * 房间验证行为——缺的是「爬升到 RCL3 的瞬间，施工系统自己排队 tower site」
 * 这条结构层链路。本测试从 RCL2 进度 44,900/45,000（一次升级就到 RCL3）的
 * 最小人口起步，全程零预设 tower/site：
 *
 *   upgrader 自然推满进度 → RCL3 → 布局/施工系统解锁 tower 相位 →
 *   construction-manager 创建 tower site → builder 由 census 自然补位 →
 *   （能量允许时）tower 建成
 *
 * 断言（可观察指标）：
 *   1. 无运行时错误、帝国存活；
 *   2. RCL 达到 3（自然升级，非预设）；
 *   3. tower site 出现或 tower 建成（「tower 在建」判据）；
 *   4. builder 角色由系统自然孵化（零人工补位链证据）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

describe("A1 自举链路 — RCL2→RCL3 爬升与 tower 自然开建", () => {
  it("RCL3 到达后 construction-manager 自然创建 tower site，builder 自然补位", () => {
    // RCL2 进度 44,900/45,000：upgrader（5W）约 20 tick 内推满 → RCL3。
    // 无 tower、无任何预设 site——tower 必须由布局/施工系统自己排队。
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 44900)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 38)
      .source("s1", 12, 12)
      .source("s2", 38, 12)
      .container(13, 12, 1500)
      .container(37, 12, 1500)
      .container(29, 37, 1500)
      .extensions([
        { x: 23, y: 24 }, { x: 24, y: 23 }, { x: 25, y: 23 },
        { x: 26, y: 23 }, { x: 27, y: 24 },
      ])
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .build();

    // 最小人口：2 静态矿工 + 1 搬运 + 1 升级者。builder 不种——必须由
    // census→demand 管道在 site 出现后自然孵化（自举链的最后一环）。
    world.addCreep("h1", "harvester", 13, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" },
      { type: "carry" }, { type: "move" },
    ], { sourceId: "s1", mode: "work" });
    world.addCreep("h2", "harvester", 37, 13, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" },
      { type: "carry" }, { type: "move" },
    ], { sourceId: "s2", mode: "work" });
    world.addCreep("haul1", "hauler", 20, 20, [
      { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
      { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    world.addCreep("u1", "upgrader", 29, 38, [
      { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" }, { type: "work" },
      { type: "carry" }, { type: "move" },
    ], { mode: "acquire" });

    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 停止条件取「tower 建成」而非「site 创建」——强制整条链闭环：
    // site 创建即停会在 census 反应（孵化 builder）之前截断运行。
    // 6000 tick 窗口：RCL3 ~20t + 布局 cadence ~200t + builder 补位 + 建造供能。
    const towerBuilt = (w: typeof world) => w.towers.length >= 1;

    const result = runner.run(world, 6000, { stopWhen: towerBuilt });
    const assertions = new Assertions(world, result.records);

    assertions.assertNoRuntimeError("A1 tower bootstrap");
    assertions.assertEmpireAlive("A1 tower bootstrap");

    // 断言 2：RCL3 自然到达（tickLog 记录 rcl_up 事件）。
    const rclUp = world._stats.tickLog.find(e => e.event.startsWith("rcl_up:3"));
    expect(
      rclUp,
      `3000 tick 内未自然升到 RCL3。最终 level=${world.controller?.level}`,
    ).toBeDefined();

    // 断言 3：tower site 由 AI 创建（或已建成）——「tower 在建」门槛判据。
    const towerAppears = world.towers.length >= 1
      || world.sites.some(s => s.structureType === "tower");
    expect(
      towerAppears,
      `6000 tick 内无 tower site/结构。sites=${world.sites.map(s => s.structureType).join(",")}`,
    ).toBe(true);

    // 断言 4：builder 由 census 自然孵化（零人工补位链）。
    const builderSeen = result.records.some(r => (r.creepsByRole.builder ?? 0) >= 1);
    expect(
      builderSeen,
      "全程未出现 builder 角色——site 出现后 census 未自然补位",
    ).toBe(true);
  });
});
