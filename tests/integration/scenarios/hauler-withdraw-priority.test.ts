/**
 * Hauler 取能优先级复现测试 — 修复「追逐溢出、来回空转」bug。
 *
 * 修复前：hauler acquire 链 pickupDroppedEnergy 排第一。container 满溢时 harvester drop
 * 溢出能量，hauler 先捡那小堆 drop（背包没装满）→ 转 work 去卸货 → 回来时 harvester 又 drop
 * → 再捡零头……满 container 始终没被抽干，溢出根源未除，hauler 来回空转。
 *
 * 修复后：withdrawRichestCapped 排在 pickupDroppedEnergy 之前。container 满溢时 hauler
 * 优先抽干最满 container（满载搬运 + 从源头止住溢出），drop 仅作残余清理。
 *
 * 验证：满 container 与小堆 drop 共存且 hauler 与两者都相邻时，hauler 第一动作抽 container
 * （container 能量下降），而非捡 drop（drop 原封不动）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

describe("Hauler 取能优先级 — 抽 container 优先于捡溢出 drop", () => {
  it("满 container 与小堆 drop 共存时，hauler 优先抽 container（不捡零头）", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      // 满 source container（2000，harvester 持续溢出）
      .container(16, 15, 2000)
      // harvester 溢出的零头 drop（99 < lootThreshold=100），紧贴 container。
      // 注意必须严格小于阈值 — 达到阈值的堆属于「大额遗留」，
      // 按衰减资源优先原则合法插队（含 assignment 之前），不属本用例语义。
      .droppedResource(17, 15, 99)
      .extensions([
        { x: 23, y: 24 }, { x: 24, y: 23 }, { x: 25, y: 23 },
        { x: 26, y: 23 }, { x: 27, y: 24 },
      ])
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      // hauler 站在 (16,16)：与 container(16,15) 和 drop(17,15) 都相邻（range 1）
      .creep("haul1", "hauler", 16, 16, [
        { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
        { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
        { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
      ], { memory: { mode: "acquire" } })
      .build();

    const container = world.containers[0]!;
    const containerBefore = container.store.getUsedCapacity("energy");
    const dropBefore = world.droppedResources[0]?.amount ?? 0;
    expect(containerBefore).toBe(2000);
    expect(dropBefore).toBe(99);

    const runner = new TickRunner();
    runner.setLoop(loop);
    // 单 tick：hauler 与 container/drop 都相邻，第一动作即暴露优先级。
    const result = runner.run(world, 1);

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("hauler withdraw priority");

    const containerAfter = container.store.getUsedCapacity("energy");
    const dropAfter = world.droppedResources[0]?.amount ?? 0;

    // 修复后：hauler 抽 container（能量下降），drop 原封不动（未被捡）。
    expect(containerAfter).toBeLessThan(containerBefore);
    expect(dropAfter).toBe(dropBefore);
  });

  it("无 container 可抽时，hauler 仍会捡 drop（残余清理不丢失）", () => {
    // 验证降级路径：没有 container（被毁/无物流）时，pickupDroppedEnergy 仍触发，
    // drop 不会被永久忽略。
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      // 无 container，只有 drop
      .droppedResource(16, 15, 100)
      .extensions([
        { x: 23, y: 24 }, { x: 24, y: 23 }, { x: 25, y: 23 },
      ])
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .creep("haul1", "hauler", 16, 16, [
        { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" }, { type: "carry" },
        { type: "move" }, { type: "move" }, { type: "move" },
      ], { memory: { mode: "acquire" } })
      .build();

    const dropBefore = world.droppedResources[0]?.amount ?? 0;
    expect(dropBefore).toBe(100);

    const runner = new TickRunner();
    runner.setLoop(loop);
    const result = runner.run(world, 1);

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("hauler pickup fallback");

    // 无 container 可抽 → pickupDroppedEnergy 触发 → drop 被捡（amount 下降或被移除）。
    const dropAfter = world.droppedResources[0]?.amount ?? 0;
    expect(dropAfter).toBeLessThan(dropBefore);
  });
});
