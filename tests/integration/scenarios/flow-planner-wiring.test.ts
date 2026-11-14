/**
 * FlowPlanner 接线集成测试。
 *
 * 钉住三件事：
 * 1. flow-planner 在真实 kernel 一 tick 内产出 deliver 任务；
 * 2. assignment-service 同 tick 把 flowTasks 合并进任务池；
 * 3. flowTasks 的 tick 过期时（flow-planner 被 CPU 预算跳过）不得复用旧任务。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";
import { buildRoomSnapshot } from "../../../src/systems/room-snapshot";
import { assignmentSystem } from "../../../src/systems/room/assignment-system";
import type { TickContext } from "../../../src/kernel/contracts";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

/** RCL6 标准房：storage + controller container + storage/controller link + 2 只 distributor。 */
function buildWorld(): TestWorld {
  return new ScenarioBuilder("W1N1")
    .rcl(6, 500000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 38)
    .source("s1", 12, 12)
    .source("s2", 38, 12)
    .container(29, 37, 1000)
    .storage(26, 25, 50000)
    .link(29, 38, 0)
    .link(27, 25, 0)
    .extensions(
      Array.from({ length: 30 }, (_, i) => ({
        x: 20 + (i % 6) * 2,
        y: 21 + Math.floor(i / 6) * 2,
      })),
    )
    .creep("up1", "upgrader", 29, 37, [{ type: "work" }, { type: "carry" }, { type: "move" }], {
      energy: 50,
    })
    .creep("dist1", "distributor", 27, 25, [{ type: "carry" }, { type: "move" }])
    .creep("dist2", "distributor", 28, 25, [{ type: "carry" }, { type: "move" }])
    .cpu(10000)
    .preseedRoomState()
    .build();
}

function runOneTick(world: TestWorld): void {
  const runner = new TickRunner();
  runner.setLoop(loop);
  runner.run(world, 1);
}

describe("FlowPlanner 接线 — flowTasks → assignment", () => {
  it("一 tick 内产出 deliver 任务并合并进任务池", () => {
    const world = buildWorld();
    runOneTick(world);

    const g = globalThis as any;
    expect(g.flowTasks?.tick).toBe(Game.time);

    const flowTasks = g.flowTasks.byRoom["W1N1"] ?? [];
    const deliver = flowTasks.find((t: any) => t.kind === "deliver");
    expect(deliver, "FlowPlanner 未产出 deliver 任务").toBeDefined();

    const pool = g.assignment?.pool;
    expect(pool?.findTask(deliver.id), "flowTask 未合并进 assignment 任务池").toBeDefined();
  });

  it("flowTasks 的 tick 过期时不进入任务池（CPU 预算跳过场景）", () => {
    const world = buildWorld();
    runOneTick(world);

    const g = globalThis as any;
    const deliver = (g.flowTasks?.byRoom["W1N1"] ?? []).find((t: any) => t.kind === "deliver");
    expect(deliver).toBeDefined();

    // 模拟 flow-planner 被预算闸跳过：缓存停在上一拍。
    g.flowTasks = { ...g.flowTasks, tick: Game.time - 1 };

    const snapshot = buildRoomSnapshot(Game.rooms["W1N1"]!);
    const ctx = {
      tick: Game.time,
      snapshots: () => [snapshot],
      getSnapshot: (name: string) => (name === snapshot.roomName ? snapshot : undefined),
    } as unknown as TickContext;

    assignmentSystem.run(ctx);

    const pool = (globalThis as any).assignment?.pool;
    expect(pool?.findTask(deliver.id), "过期 flowTask 不应进入任务池").toBeUndefined();
  });
});
