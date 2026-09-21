/**
 * 观测层必须活过 tick 预算耗尽 — 回归守卫。
 *
 * 线上实证两幕（shard3）：
 * ① 解冻把常态 CPU 抬到 healthy 档 softLimit(20×0.875=17.5) 之上，而 telemetry-collector
 *    当时是 post 段 P3 ⇒ 轮到它时 spent() 已≈tick 终值，实时软上限闸对它恒真：
 *    采样间隔从 10 tick 劣化到 1210~14500 tick，stats/事件环/经济环/Prometheus 全冻结。
 * ② 只把 E2 饥饿旁路接到实时闸上（commit b8d99ea）仍不够：旁路的开启条件就是"观测饥饿"，
 *    观测一恢复采样 E2 违例就清空、旁路随即撤销 ⇒ 占空比退化成约 1 样本 / grace(1530t)，
 *    线上唯一那条新样本记的正是 cpu=18.5 > softLimit 17.5。
 * 结论：观测不能挂在让位闸上（kernel.runObservabilitySystems / System.budgetExempt）。
 *
 * 夹具侧：TestWorld 的 getUsed() 常态恒为 0，"tick 走到某阶段已经花了多少"这个量
 * 在旧夹具里根本不可表达 —— 这坑线上烂了几千 tick 而门禁全绿，缺的就是这个旋钮。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";
import { CONFIG } from "../../../src/config";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

const g = () => globalThis as any;

describe("观测层 — tick 预算耗尽时采样不得停", () => {
  it("spent 抬过 hardLimit（全部系统被拒）后，遥测仍按 cadence 推进且不再报饥饿", () => {
    const interval = CONFIG.telemetry.cpuSampleInterval;
    expect(interval, "夹具前提：采样窗口 ≤10 tick").toBeLessThanOrEqual(10);

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
    const HOT = 80;
    let hotStartSample = 0;
    let hotStartCreeps = 0;

    const runner = new TickRunner();
    runner.setLoop(loop);
    runner.run(world, WARM + HOT, {
      onTick: (_w: TestWorld, t: number) => {
        if (t === 1) {
          g().Memory.schemaVersion = CONFIG.memory.schemaVersion;
          g().Memory.rooms.W1N1.lastRcl = g().Game.time;
        }
        if (t === WARM) {
          // 抬到 hardLimit(19.2) 之上：isExhausted() 恒真 → 连 P0 系统都被拒。
          world.setCpuFloor(19.6);
          hotStartSample = g().Memory.kernel.stats.lastSample as number;
          hotStartCreeps = Object.keys(g().Game.creeps).length;
          expect(hotStartSample, "抬闸前遥测应已在采样").toBeGreaterThan(0);
        }
      },
    });

    const stats = g().Memory.kernel.stats;
    const now = g().Game.time as number;

    // ① 前提钉：这 80 tick 里 bot 确实被锁死了 —— spawn-manager 是 P0 系统，
    //    它也被拒 ⇒ 队列不动、creep 数不涨（只可能因寿命下降）。
    expect(
      Object.keys(g().Game.creeps).length,
      `夹具前提未成立：耗尽期 creep 数仍在涨（${hotStartCreeps} → 现在），说明世界没真被锁`,
    ).toBeLessThanOrEqual(hotStartCreeps);

    // ② 判据按密度而非单 tick 快照：耗尽期最后一条样本应贴着 tick 走，
    //    最多错过两个采样窗口（相位门 tick % interval !== phase 的容许）。
    const sampleAge = now - (stats.lastSample as number);
    expect(
      stats.lastSample,
      `耗尽期遥测停在 ${hotStartSample}，现已到 tick ${now}（age=${sampleAge}）`,
    ).toBeGreaterThan(hotStartSample);
    expect(sampleAge, `耗尽期采样应跟上 cadence，允许错过两个窗口`).toBeLessThanOrEqual(
      interval * 2,
    );

    // ③ 观测不再受预算闸，就不该被 E2 当饥饿系统报（那是自败旁路的误触发源）。
    const violations: string[] = g().Memory.kernel.expectations?.violations ?? [];
    expect(
      violations.filter(v => v.startsWith("p3Starved:telemetry-collector")),
      `观测系统不该出现在 P3 饥饿违例里: ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });
});
