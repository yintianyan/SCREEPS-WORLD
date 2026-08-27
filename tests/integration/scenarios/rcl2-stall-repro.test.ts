/**
 * Phase R2 — RCL2 stall repro：诊断采样 + 可判定回归断言。
 *
 * 双职责：
 *   1. 保留全维度采样（tick/rcl/progress/queue 分类/site/pressure/tier/
 *      claimSecure/P0 spawn/skip reason）——作为失败诊断与时间序列数据源；
 *   2. 硬断言（任务书二）：RCL2 期间不存在 queue>0 且 site=0 超过 100 tick 的
 *      窗口；RCL2 期间至少出现一个 extension/container site；失败时输出最后
 *      20 个采样点与 skip reason。
 * 不允许只断言「无 runtime error」和「spawn 存活」。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

interface Sample {
  tick: number;
  rcl: number;
  progress: number;
  energy: number;
  capacity: number;
  queueTotal: number;
  queueByType: Record<string, number>;
  queueByState: Record<string, number>;
  gameSites: number;
  siteTypes: Record<string, number>;
  siteProgress: number;
  roles: Record<string, number>;
  economyPressure: number;
  tier: string;
  claimSecure: boolean;
  spawnQueueP0: number;
  skipReasons: Record<string, number>;
}

function sampleWorld(world: TestWorld): Sample {
  const mem = (globalThis as any).Memory;
  const roomMem = mem?.rooms?.W1N1 ?? {};
  const queue: any[] = roomMem.buildQueue ?? [];
  const byType: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const t of queue) {
    byType[t.structureType] = (byType[t.structureType] ?? 0) + 1;
    byState[t.state] = (byState[t.state] ?? 0) + 1;
  }
  const spawnQueue: any[] = roomMem.spawnQueue ?? [];
  const g = globalThis as any;
  const skipStats = g.constructionSkips?.rooms?.W1N1 ?? {};
  const siteTypes: Record<string, number> = {};
  let siteProgress = 0;
  for (const s of world.sites) {
    const t = (s as any).structureType ?? "?";
    siteTypes[t] = (siteTypes[t] ?? 0) + 1;
    siteProgress += (s as any).progress ?? 0;
  }
  const roles: Record<string, number> = {};
  for (const c of world.creeps) {
    const r = (c.memory as any).role ?? "?";
    roles[r] = (roles[r] ?? 0) + 1;
  }
  return {
    tick: world.tick,
    rcl: world.controller?.level ?? 0,
    progress: Math.floor(world.controller?.progress ?? 0),
    energy: world.room.energyAvailable,
    capacity: world.room.energyCapacityAvailable,
    queueTotal: queue.length,
    queueByType: byType,
    queueByState: byState,
    gameSites: world.sites.length,
    siteTypes,
    siteProgress,
    roles,
    economyPressure: Math.round((roomMem.economyPressure ?? 0) * 100) / 100,
    tier: mem?.kernel?.tier ?? "?",
    claimSecure: roomMem.claimSecure ?? false,
    spawnQueueP0: spawnQueue.filter(r => r.priority === 0).length,
    skipReasons: { ...skipStats },
  };
}

function formatSample(s: Sample): string {
  return [
    `t=${s.tick}`,
    `rcl=${s.rcl}`,
    `prog=${s.progress}`,
    `energy=${s.energy}/${s.capacity}`,
    `queue=${s.queueTotal}`,
    `byTypeState=${JSON.stringify(s.queueByType)}/${JSON.stringify(s.queueByState)}`,
    `sites=${s.gameSites}`,
    `siteTypes=${JSON.stringify(s.siteTypes)}`,
    `siteProg=${s.siteProgress}`,
    `roles=${JSON.stringify(s.roles)}`,
    `pressure=${s.economyPressure}`,
    `tier=${s.tier}`,
    `claimSec=${s.claimSecure}`,
    `p0spawn=${s.spawnQueueP0}`,
    `skips=${JSON.stringify(s.skipReasons)}`,
  ].join(" ");
}

function dumpOnFailure(samples: Sample[], reason: string): void {
  console.log(`=== [stall-repro][FAIL] ${reason} — 最后 20 个采样点 ===`);
  for (const s of samples.slice(-20)) console.log(formatSample(s));
}

/** RCL2 精确窗口断言（采样间隔 50t → 窗口按采样数 × 50t 计）。
 * 全部断言仅在 rcl === 2 的采样上执行——禁止 rcl >= 2 把 RCL3+ 结果误算为 RCL2 成功。 */
function assertRcl2Closure(samples: Sample[]): void {
  const rcl2 = samples.filter(s => s.rcl === 2);
  expect(rcl2.length).toBeGreaterThan(0);

  // 1. 无「queue>0 且 site=0」超过 100t 的连续窗口（rcl === 2 精确窗口）。
  let stallRun = 0;
  let maxStall = 0;
  for (const s of rcl2) {
    if (s.queueTotal > 0 && s.gameSites === 0) {
      stallRun += 50;
      maxStall = Math.max(maxStall, stallRun);
    } else {
      stallRun = 0;
    }
  }
  if (maxStall > 100) {
    dumpOnFailure(samples, `RCL2 期间 queue>0 且 site=0 连续 ${maxStall}t（>100t）`);
  }
  expect(maxStall).toBeLessThanOrEqual(100);

  // 2. RCL2 期间至少出现一个 extension/container site。
  const withDevSite = rcl2.filter(
    s => (s.siteTypes["extension"] ?? 0) + (s.siteTypes["container"] ?? 0) > 0,
  );
  if (withDevSite.length === 0) {
    dumpOnFailure(samples, "RCL2 期间未出现任何 extension/container site");
  }
  expect(withDevSite.length).toBeGreaterThan(0);

  // 3. 首个 development site 的 tick 早于首次进入 RCL3 的 tick。
  //    如果 RCL2 阶段没有 site、但 RCL3 后出现 site，测试必须失败。
  const firstDevSiteInRcl2 = rcl2.find(
    s => (s.siteTypes["extension"] ?? 0) + (s.siteTypes["container"] ?? 0) > 0,
  );
  expect(firstDevSiteInRcl2).toBeDefined();
  const firstRcl3 = samples.find(s => s.rcl >= 3);
  if (firstRcl3 && firstDevSiteInRcl2) {
    expect(firstDevSiteInRcl2.tick).toBeLessThanOrEqual(firstRcl3.tick);
  }

  // 4. 如果 RCL2 阶段没有 dev site，但 RCL3+ 后出现了 dev site → 必须失败。
  const rcl3pHasDevSite = samples
    .filter(s => s.rcl >= 3)
    .some(s => (s.siteTypes["extension"] ?? 0) + (s.siteTypes["container"] ?? 0) > 0);
  if (withDevSite.length === 0 && rcl3pHasDevSite) {
    dumpOnFailure(samples, "RCL2 阶段无 dev site，但 RCL3+ 后才出现 — 验收失败");
    // 上面 withDevSite.length > 0 断言已经会失败，此处显式给出原因。
    expect(withDevSite.length).toBeGreaterThan(0);
  }
}

describe("Phase R2 — RCL2 stall repro（可判定）", () => {
  it("干净 RCL2 1500 tick：采样 + RCL2 建设闭环硬断言", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 100)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const samples: Sample[] = [];
    const result = runner.run(world, 1500, {
      recordInterval: 50,
      onTick: (w) => {
        if (w.tick % 50 === 0) samples.push(sampleWorld(w));
      },
    });

    // 基线：无 runtime error（非充分条件——下方为充分断言）。
    expect(result.runtimeErrors).toEqual([]);

    assertRcl2Closure(samples);
  });

  it("RCL1→RCL2 迁移 1500 tick：extension site 在 RCL2 窗口内出现", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(1, 190)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const samples: Sample[] = [];
    runner.run(world, 1500, {
      recordInterval: 50,
      onTick: (w) => {
        if (w.tick % 50 === 0) samples.push(sampleWorld(w));
      },
    });

    assertRcl2Closure(samples);

    // 额外验证：RCL2 期间队列不持续增长（不构成内存泄漏）。
    const rcl2 = samples.filter(s => s.rcl === 2);
    if (rcl2.length >= 4) {
      const first = rcl2[0]!.queueTotal;
      const last = rcl2[rcl2.length - 1]!.queueTotal;
      // 队列总量不应持续膨胀（允许波动，但末值不应远超首值）。
      expect(last).toBeLessThanOrEqual(first + 10);
    }
  });
});
