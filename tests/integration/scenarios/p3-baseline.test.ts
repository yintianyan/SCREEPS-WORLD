/** Baseline */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";
import fs from "node:fs";
import path from "node:path";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

const FULL = process.env.P3_BASELINE_FULL === "1";
const SOAK = process.env.P3_SOAK === "1";
// P3_SOAK=1：净流连续性长跑（冻结验收门槛「净流连续 5 万 tick 为正」的本地口径证据）
const TICKS = SOAK ? 50000 : FULL ? 10000 : 1500;
const SAMPLE_EVERY = 25;

// body 部件能量成本（引擎常量快照；mockup 环境不依赖全局 BODYPART_COST）
const PART_COST: Record<string, number> = {
  work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150,
  heal: 250, claim: 600, tough: 10,
};

interface Sample {
  tick: number;
  rcl: number;
  progress: number;
  energyAvailable: number;
  energyCapacity: number;
  storage: number;
  containers: number;
  reserve: number;
  creeps: number;
  roles: Record<string, number>;
  spawning: number;
  sites: number;
  harvested: number;
  upgraded: number;
  built: number;
  spawnedCount: number;
  spawnEnergy: number;
  died: number;
  /** economy 系统瘦快照（50tick 结算，可能缺采样点） */
  econ?: { t: number; nf: number; cr: number; rb: number; dr: number; ei: number; ef: number };
}

function sampleWorld(world: TestWorld, tick: number, known: Set<string>, spawnEnergy: number): Sample {
  const roles: Record<string, number> = {};
  for (const c of world.creeps) {
    const role = (c.memory.role as string) ?? "unknown";
    roles[role] = (roles[role] ?? 0) + 1;
    if (!known.has(c.name)) {
      known.add(c.name);
      for (const p of c.body) spawnEnergy += PART_COST[p.type] ?? 0;
    }
  }
  let containers = 0;
  for (const c of world.containers) containers += c.store.energy;
  const storage = world.storage ? world.storage.store.energy : 0;
  const memRoom = (globalThis as unknown as { Memory?: { rooms?: Record<string, { economy?: Sample["econ"] }> } }).Memory?.rooms?.[world.config.roomName];
  return {
    econ: memRoom?.economy,
    tick,
    rcl: world.controller?.level ?? 0,
    progress: world.controller?.progress ?? 0,
    energyAvailable: world.room.energyAvailable,
    energyCapacity: world.room.energyCapacityAvailable,
    storage,
    containers,
    reserve: world.totalEnergy(),
    creeps: world.creeps.length,
    roles,
    spawning: world.spawns.filter(s => s.spawning).length,
    sites: world.sites.length,
    harvested: world._stats.totalHarvested,
    upgraded: world._stats.totalUpgraded,
    built: world._stats.totalBuilt,
    spawnedCount: world._stats.totalSpawned,
    spawnEnergy,
    died: world._stats.creepsDied,
  };
}

interface WindowReport {
  range: [number, number];
  reserveStart: number;
  reserveEnd: number;
  netFlow: number;
  harvest: number;
  upgradeEnergy: number;
  buildEnergy: number;
  spawnEnergy: number;
  spawnedCount: number;
  died: number;
  avgCreeps: number;
  avgEnergyAvailable: number;
  avgEnergyCapacity: number;
  storageEnd: number;
  rclStart: number;
  rclEnd: number;
  progressDelta: number;
  spawnUtilization: number;
  avgSites: number;
}

function windowReport(samples: Sample[], from: number, to: number): WindowReport {
  const inWin = samples.filter(s => s.tick >= from && s.tick < to);
  const first = inWin[0]!;
  const last = inWin[inWin.length - 1]!;
  const avg = (f: (s: Sample) => number) =>
    inWin.length === 0 ? 0 : inWin.reduce((acc, s) => acc + f(s), 0) / inWin.length;
  return {
    range: [from, to],
    reserveStart: first.reserve,
    reserveEnd: last.reserve,
    netFlow: last.reserve - first.reserve,
    harvest: last.harvested - first.harvested,
    upgradeEnergy: last.upgraded - first.upgraded,
    buildEnergy: last.built - first.built,
    spawnEnergy: last.spawnEnergy - first.spawnEnergy,
    spawnedCount: last.spawnedCount - first.spawnedCount,
    died: last.died - first.died,
    avgCreeps: Math.round(avg(s => s.creeps) * 10) / 10,
    avgEnergyAvailable: Math.round(avg(s => s.energyAvailable)),
    avgEnergyCapacity: Math.round(avg(s => s.energyCapacity)),
    storageEnd: last.storage,
    rclStart: first.rcl,
    rclEnd: last.rcl,
    progressDelta: last.progress - first.progress,
    spawnUtilization: Math.round(avg(s => (s.spawning > 0 ? 1 : 0)) * 1000) / 10,
    avgSites: Math.round(avg(s => s.sites) * 10) / 10,
  };
}

function summarize(label: string, windows: WindowReport[]): void {
  console.log("\n[P3-BASELINE] === " + label + " ===");
  for (const w of windows) {
    const consumed = w.upgradeEnergy + w.buildEnergy + w.spawnEnergy;
    console.log(
      "[P3-BASELINE] t" + w.range[0] + "-" + w.range[1] + ": "
      + "reserve " + w.reserveStart + "->" + w.reserveEnd + " (net " + (w.netFlow >= 0 ? "+" : "") + w.netFlow + ") | "
      + "harvest " + w.harvest + " | upgE " + w.upgradeEnergy + " | buildE " + w.buildEnergy
      + " | spawnE " + w.spawnEnergy + "(" + w.spawnedCount + ") | died " + w.died
      + " | creeps~" + w.avgCreeps + " | E " + w.avgEnergyAvailable + "/" + w.avgEnergyCapacity
      + " | spawnUtil " + w.spawnUtilization + "% | RCL " + w.rclStart + "->" + w.rclEnd
      + " | sites~" + w.avgSites
      + (consumed > 0 ? " | measuredConsume=" + consumed : ""),
    );
  }
}

function runWorld(label: string, world: TestWorld): { samples: Sample[]; runtimeErrors: string[] } {
  void label;
  const known = new Set<string>();
  let spawnEnergy = 0;
  const samples: Sample[] = [];
  const runner = new TickRunner();
  runner.setLoop(loop);
  const result = runner.run(world, TICKS, {
    maxTicks: TICKS + 1,
    recordInterval: SAMPLE_EVERY * 4,
    onTick: (w, tick) => {
      if (tick % SAMPLE_EVERY === 0) {
        samples.push(sampleWorld(w, tick, known, spawnEnergy));
        spawnEnergy = samples[samples.length - 1]!.spawnEnergy;
      }
    },
  });
  if (samples.length === 0 || samples[samples.length - 1]!.tick !== result.ticks) {
    samples.push(sampleWorld(world, result.ticks, known, spawnEnergy));
  }
  return { samples, runtimeErrors: result.runtimeErrors };
}

const WINDOWS: Array<[number, number]> = SOAK
  ? [[0, 1000], [1000, 25000], [25000, 50000]]
  : FULL
    ? [[0, 1000], [1000, 5000], [5000, 10000]]
    : [[0, 500], [500, 1500]];

describe("P3 Baseline — 经济基线采集", () => {
  it("cold-start RCL1 冷启动轨迹（" + TICKS + " ticks）", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(1)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(28, 28)
      .source("s1", 22, 22)
      .source("s2", 30, 20)
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const { samples, runtimeErrors } = runWorld("cold-start", world);
    expect(runtimeErrors).toEqual([]);

    const windows = WINDOWS.map(([a, b]) => windowReport(samples, a, b));
    summarize("cold-start RCL1 (zero creeps)", windows);

    // 观测性底线断言（非验收门）：自举确实发生
    expect(samples[samples.length - 1]!.harvested).toBeGreaterThan(0);
    expect(samples[samples.length - 1]!.spawnedCount).toBeGreaterThan(0);

    if (FULL) persist("cold-start", samples, windows);
  });

  it("rcl4-storage RCL4 标准经济形态（" + TICKS + " ticks）", () => {
    const world = new ScenarioBuilder("W1N1")
      // B3 修正：progress 从 0 起——满值预置会压制 upgrade 观测（P3_BASELINE B3）
      .rcl(4, 0)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 38)
      .source("s1", 12, 12)
      .source("s2", 38, 12)
      .container(13, 12, 1500)
      .container(37, 12, 1500)
      .container(29, 37, 1000)
      .storage(26, 25, 20000)
      .tower(24, 25, 800)
      .extensions(
        Array.from({ length: 20 }, (_, i) => ({
          x: 21 + (i % 5) * 2,
          y: 22 + Math.floor(i / 5) * 2,
        })),
      )
      .sourceRegen(10)
      .cpu(10000)
      .build();

    // 标准人口（对齐 rcl4-automation 预设）
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
    world.addCreep("u2", "upgrader", 30, 37, [
      { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }, { type: "move" },
    ], { mode: "acquire" });
    world.spawns[0]!.store.energy = 300;
    for (const ext of world.extensions) ext.store.energy = 50;
    world.room._recalcEnergy();

    const { samples, runtimeErrors } = runWorld("rcl4-storage", world);
    expect(runtimeErrors).toEqual([]);

    const windows = WINDOWS.map(([a, b]) => windowReport(samples, a, b));
    summarize("rcl4-storage (established economy)", windows);

    // 观测性底线断言：采集与升级链路在运转
    const last = samples[samples.length - 1]!;
    expect(last.harvested).toBeGreaterThan(0);

    if (FULL) persist("rcl4-storage", samples, windows);
  });
});


describe("P3 Accounting 接线冒烟", () => {
  it("核算窗结算后 Memory.rooms[r].economy 产出三指标瘦快照", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(1)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(28, 28)
      .source("s1", 22, 22)
      .source("s2", 30, 20)
      .sourceRegen(10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);
    const seenEcon: unknown[] = [];
    runner.run(world, 600, {
      onTick: (_w, tick) => {
        const mem = (globalThis as { Memory?: { rooms?: Record<string, { economy?: unknown }> } }).Memory?.rooms?.["W1N1"];
        if (mem?.economy && (seenEcon.length === 0 || (seenEcon[seenEcon.length - 1] as { t?: number })?.t !== (mem.economy as { t?: number }).t)) {
          seenEcon.push(mem.economy);
          console.log("[SMOKE] tick=" + tick + " econ=" + JSON.stringify(mem.economy));
        }
      },
    });
    console.log("[SMOKE-HIST] settlements=" + seenEcon.length + " " + JSON.stringify(seenEcon));
    const led = (globalThis as unknown as { energyLedger?: { rooms: Record<string, unknown> } }).energyLedger;
    console.log("[SMOKE-LEDGER] " + JSON.stringify(led));
    const stats = world._stats;
    console.log("[SMOKE-STATS] harvested=" + stats.totalHarvested + " spawned=" + stats.totalSpawned);

    const econ = (globalThis as { Memory?: { rooms?: Record<string, { economy?: { t: number; nf: number; cr: number; rb: number; dr: number; ei: number; ef: number } }> } }).Memory?.rooms?.["W1N1"]?.economy;
    expect(econ).toBeDefined();
    expect(econ!.cr).toBeGreaterThanOrEqual(0); // 合同储备非负（RCL1 无 storage/link/terminal → 0）
    expect(typeof econ!.nf).toBe("number");
    expect(econ!.ef).toBeGreaterThan(0); // 效率系数已校准为正
    expect(econ!.ei).toBeGreaterThan(0); // 估计收入为正
  });
});

/** 将全量测试结果落盘为 JSON。 */
function persist(worldLabel: string, samples: Sample[], windows: WindowReport[]): void {
  const dir = path.resolve(__dirname, "../../../tmp/docs-moved/phase3/data");
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    ticks: TICKS,
    note: "TestWorld mockup 基线；income/consume 为物理层实测；netFlow 为储备窗口差分（非 EMA 三指标）",
    windows,
    samples,
  };
  fs.writeFileSync(path.join(dir, "p3-baseline-" + worldLabel + ".json"), JSON.stringify(payload));
  console.log("[P3-BASELINE] persisted -> tmp/docs-moved/phase3/data/p3-baseline-" + worldLabel + ".json");
}