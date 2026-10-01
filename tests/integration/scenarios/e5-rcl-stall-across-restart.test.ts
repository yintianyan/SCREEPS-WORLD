/**
 * E5 rclStale 的跨部署连续性 ——「换码不得把停滞计时清零」的回归锁。
 *
 * 现场动因：线上幼房 controller.progress 冻结数小时，E5 一次未报。旧实现的停滞时长
 * 存在 `globalCache().rclProgressTracker`（heap），而**会掐断升级道的改动本身就是一次部署**
 * —— 部署把计时器归零后，10000 拍的阈值在迭代期永远够不到：检测器专挑自己造成的停摆失明。
 *
 * TestWorld 的 `TickRunner.run()` 每次调用会 installGlobals() 重建 Memory（TickRunner 头注），
 * 单个 run 就是一个干净的新进程。所以这里用「第一拍之后把 Memory 锚点写成旧值」构造
 * **部署前就已停摆**的现场：heap 侧一无所知（旧实现据此判 stall=0），Memory 侧证据早已存在。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";
import { E5_STALE_TICKS } from "../../../src/kernel/expectations";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

const g = () => globalThis as any;

/** RCL3 房，controller 进度停在半程（不动，除非测试自己推它）。 */
function buildFrozenRoom(): TestWorld {
  return new ScenarioBuilder("W1N1")
    .rcl(3, 12345)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 35)
    .source("s1", 15, 15)
    .source("s2", 35, 15)
    .sourceRegen(10)
    .containerDecay(0)
    .cpu(10000)
    .preseedRoomState()
    .build();
}

/** 把停滞基准写成 k 拍之前，并把 bootTick 推老（构造"停摆早于本次换码"）。 */
function ageTheStall(world: TestWorld, stallTicks: number): void {
  const roomMem = g().Memory.rooms.W1N1;
  roomMem.controllerProgressSeen = world.controller?.progress ?? 0;
  roomMem.controllerProgressChangedAt = g().Game.time - stallTicks;
  g().Memory.kernel.bootTick = g().Game.time - 6000;
}

function violations(): string[] {
  return [...(g().Memory.kernel.expectations?.violations ?? [])];
}

describe("E5 rclStale — 停滞基准跨部署（Memory 锚点）", () => {
  it("新进程 + Memory 里早已陈旧的锚点 → 立即报 rclStale（旧实现读 heap 判 0，永远不报）", () => {
    const world = buildFrozenRoom();
    const runner = new TickRunner();
    runner.setLoop(loop);

    let seen: string[] = [];
    runner.run(world, 4, {
      onTick: (w, t) => {
        if (t === 1) ageTheStall(w, E5_STALE_TICKS + 1);
        seen = violations();
      },
    });

    expect(
      seen.some(v => v.startsWith("rclStale:W1N1")),
      `进度冻结 ${E5_STALE_TICKS + 1} 拍应报 rclStale，实际违例: ${JSON.stringify(seen)}`,
    ).toBe(true);
    // 违例明细里带上停滞时长与 upgrader 在场情况 —— 判"设计如此"还是"真停摆"要用。
    const detail = seen.find(v => v.startsWith("rclStale:W1N1")) ?? "";
    expect(detail, `违例应带 stall 时长: ${detail}`).toContain("stall=");
  });

  it("控制组：本进程内首次观测的房（锚点刚播种）不误报", () => {
    const world = buildFrozenRoom();
    const runner = new TickRunner();
    runner.setLoop(loop);

    let seen: string[] = [];
    runner.run(world, 4, {
      onTick: (_w, t) => {
        if (t === 1) g().Memory.kernel.bootTick = g().Game.time - 6000;
        seen = violations();
      },
    });

    expect(
      seen.some(v => v.startsWith("rclStale:")),
      `锚点新鲜时不应报停滞，实际违例: ${JSON.stringify(seen)}`,
    ).toBe(false);
  });

  it("进度每拍在动 → 锚点跟着刷新，陈旧锚点也不会被当成停摆（既有语义不变）", () => {
    const world = buildFrozenRoom();
    const runner = new TickRunner();
    runner.setLoop(loop);

    let seen: string[] = [];
    runner.run(world, 6, {
      onTick: (w, t) => {
        if (t === 1) ageTheStall(w, E5_STALE_TICKS + 1);
        // 下一拍推进度：room-state 见到 progress 变化就把 changedAt 归到当前拍。
        const ctrl = w.controller;
        if (ctrl) ctrl.progress += 100;
        seen = violations();
      },
    });

    expect(
      seen.some(v => v.startsWith("rclStale:")),
      `进度在动的房不应报停滞，实际违例: ${JSON.stringify(seen)}`,
    ).toBe(false);
    expect(
      g().Memory.rooms.W1N1.controllerProgressChangedAt,
      "进度变化应把锚点刷新到当前拍",
    ).toBeGreaterThanOrEqual(g().Game.time - 1);
  });
});
