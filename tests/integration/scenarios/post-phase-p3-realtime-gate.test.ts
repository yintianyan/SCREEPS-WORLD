/**
 * post 段 P3 的实时 softLimit 死锁 — 回归守卫。
 *
 * 线上实证（2026-09-21，shard3 tick 83099555→83129665）：解冻把常态 CPU 从 ~16.3
 * 抬到 17.5~18.1，恰好压上 healthy 档 softLimit（=20×0.875=17.5）。
 * telemetry-collector 注册为 phase:"post" ⇒ 排在所有 creep 之后，轮到它时 spent()
 * 已≈本 tick 终值，于是 `scheduler.ts` 的实时软上限闸对它**恒真**：CPU 采样间隔从
 * 10 tick 劣化到 1210~14500 tick，stats/事件环/经济环/Prometheus 全冻结；而当时
 * E2 饥饿旁路只解开前馈判据、解不开实时闸 ⇒ 逃生口对它要救的那个系统打不开。
 *
 * 夹具的关键是 setCpuFloor：mock 的 getUsed() 常态恒为 0，「tick 走到 post 段时
 * 已经花了多少」这个量在旧夹具里根本不存在 —— 死锁线上烂了几千 tick 而门禁全绿，
 * 就是这个表达能力的缺口。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";
import { globalCache } from "../../../src/kernel/global-cache";
import { CONFIG } from "../../../src/config";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

const g = () => globalThis as any;

describe("post 段 P3 实时 softLimit 死锁 — E2 旁路必须能救活遥测", () => {
  it("spent 压在 softLimit 之上：旁路打开后 telemetry-collector 恢复采样", () => {
    const interval = CONFIG.telemetry.cpuSampleInterval;
    expect(interval, "夹具前提：collector 的采样窗口 ≤10 tick").toBeLessThanOrEqual(10);

    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
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

    const WARM = 40;
    let beforeFloor: number | undefined;
    let bypassOpenedAt = 0;

    const runner = new TickRunner();
    runner.setLoop(loop);
    runner.run(world, WARM + 90, {
      onTick: (_w: TestWorld, t: number) => {
        if (t === 1) {
          g().Memory.schemaVersion = CONFIG.memory.schemaVersion;
          g().Memory.rooms.W1N1.lastRcl = g().Game.time;
        }
        const bypassOn =
          ((g().Memory.kernel.p3StarveBypassUntil as number) ?? 0) > (g().Game.time as number);
        if (bypassOn) bypassOpenedAt = t;

        if (t === WARM) {
          // 抬闸前的最后一次正常采样。
          beforeFloor = g().Memory.kernel.stats?.lastSample as number;
          expect(beforeFloor, "抬闸前遥测应正常采样").toBeGreaterThan(0);
          // spent 抬到 (softLimit 17.5, 近限 18.8) 之间：实时软上限从此恒拒非 P0，
          // 只有饥饿旁路能放行 P3。
          world.setCpuFloor(18.5);
          // 让 E2 立即认定遥测饥饿（grace = interval×3 + boot 宽限 1500）。
          g().Memory.kernel.bootTick = (g().Game.time as number) - 6000;
          const stale = globalCache().systemLastRun ?? {};
          stale["telemetry-collector"] = (g().Game.time as number) - 9999;
          globalCache().systemLastRun = stale;
        }
      },
    });

    // 注：不断言 runtimeErrors —— TestWorld 预置 legacy phase 字符串，
    // tick 1 的迁移链必然报错一次（同 p3-bypass-loop，t===1 里设 schemaVersion 止血）。
    expect(bypassOpenedAt, "E2 应检出遥测饥饿并置旁路").toBeGreaterThan(WARM);

    const lastSample = g().Memory.kernel.stats?.lastSample as number;
    expect(
      lastSample,
      `旁路打开后遥测应恢复采样（抬闸时停在 ${beforeFloor}，最终停在 ${lastSample}）`,
    ).toBeGreaterThan(beforeFloor! + interval);
  });
});
