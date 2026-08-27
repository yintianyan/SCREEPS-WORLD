/** RCL2 Early Development Recovery — 私服 canary（隔离世界）。 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";

interface Row {
  tick: number;
  rcl: number;
  progress: number;
  queueTotal: number;
  backgroundQueued: number;
  byTypeState: Record<string, number>;
  /** extension/container 任务的 per-key 状态轨迹（queued→site 转移证明用）。 */
  devQueuedKeys: string[];
  devSiteKeys: string[];
  siteCount: number;
  siteTypes: Record<string, number>;
  creeps: number;
  economyPressure: number;
  tier: string;
  claimSecure: boolean;
}

const RUN_TICKS = 5200;

const isDevSiteType = (t: string): boolean => t === "extension" || t === "container";

describe("Phase R2 — RCL2 私服 canary（隔离世界，严格 rcl===2 窗口）", () => {
  const runner = new ScenarioRunner();
  const rows: Row[] = [];

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 1)],
      maxTicks: RUN_TICKS + 500,
    });
  }, 120000);

  afterAll(async () => {
    writeFileSync("/tmp/rcl2-canary.json", JSON.stringify(rows));
    await runner.teardown();
  });

  it(`${RUN_TICKS}t 长跑采样（每 50t，rcl 三分区记录）`, async () => {
    let last = -100;
    for (let i = 0; i < RUN_TICKS; i++) {
      await runner.server.tick();
      const gameTime = await runner.server.gameTime;
      if (gameTime - last < 50) continue;
      last = gameTime;

      const mem = await runner.bot.getMemory();
      const roomMem = mem.rooms?.W0N1 ?? {};
      const queue: any[] = roomMem.buildQueue ?? [];
      const byTypeState: Record<string, number> = {};
      const devQueuedKeys: string[] = [];
      const devSiteKeys: string[] = [];
      let backgroundQueued = 0;
      for (const t of queue) {
        const k = `${t.structureType}:${t.state}`;
        byTypeState[k] = (byTypeState[k] ?? 0) + 1;
        if ((t.state === "queued" || t.state === "blocked") && t.priority >= 2) backgroundQueued++;
        if (isDevSiteType(t.structureType)) {
          if (t.state === "queued" || t.state === "blocked") devQueuedKeys.push(t.key);
          if (t.state === "site") devSiteKeys.push(t.key);
        }
      }

      const siteTypes: Record<string, number> = {};
      let siteCount = 0;
      let rcl = 0;
      let progress = 0;
      const objs = await runner.server.server.world.roomObjects("W0N1");
      for (const o of objs) {
        if (o.type === "constructionSite") {
          siteCount++;
          const st = (o as any).structureType ?? "?";
          siteTypes[st] = (siteTypes[st] ?? 0) + 1;
        }
        if (o.type === "controller") {
          rcl = (o as any).level ?? 0;
          progress = (o as any).progress ?? 0;
        }
      }

      let creeps = 0;
      for (const _c of Object.values(mem.creeps ?? {})) creeps++;

      rows.push({
        tick: gameTime,
        rcl,
        progress,
        queueTotal: queue.length,
        backgroundQueued,
        byTypeState,
        devQueuedKeys,
        devSiteKeys,
        siteCount,
        siteTypes,
        creeps,
        economyPressure: Math.round((roomMem.economyPressure ?? 0) * 100) / 100,
        tier: mem.kernel?.tier ?? "?",
        claimSecure: roomMem.claimSecure ?? false,
      });
    }

    expect(rows.length).toBeGreaterThan(80);
    writeFileSync("/tmp/rcl2-canary.json", JSON.stringify(rows, null, 1));
  }, 900000);

  it("分区记账: rcl===1 / rcl===2 / rcl>=3 三分区样本数", () => {
    const rcl1 = rows.filter((r) => r.rcl === 1).length;
    const rcl2 = rows.filter((r) => r.rcl === 2).length;
    const rcl3p = rows.filter((r) => r.rcl >= 3).length;
    console.log(
      `[canary] partition rcl1=${rcl1} rcl2=${rcl2} rcl>=3=${rcl3p} total=${rows.length}`,
    );
    // RCL2 精确窗口必须存在且不少于 1500 tick（≥30 个 50t 采样）。
    expect(rcl2).toBeGreaterThanOrEqual(30);
  }, 10000);

  it("验收: rcl===2 窗口内 extension/container site 出现", () => {
    const rcl2 = rows.filter((r) => r.rcl === 2);
    expect(rcl2.length).toBeGreaterThan(0);
    const withDev = rcl2.filter(
      (r) => (r.siteTypes["extension"] ?? 0) + (r.siteTypes["container"] ?? 0) > 0,
    );
    if (withDev.length === 0) {
      const rcl3pHad = rows.filter((r) => r.rcl >= 3 && (
        (r.siteTypes["extension"] ?? 0) + (r.siteTypes["container"] ?? 0) > 0
      ));
      console.log(
        `[canary][FAIL] RCL2 窗口无 development site；RCL3+ 后才出现: ${rcl3pHad.length > 0} ` +
        `(rcl3+ 有 site 的样本 ${rcl3pHad.length})`,
      );
    }
    // RCL2 阶段必须出现 site——RCL3 后才出现不算数（上面的分支会先打印诊断）。
    expect(withDev.length).toBeGreaterThan(0);
  }, 10000);

  it("验收: 首个 development site tick 早于首次进入 RCL3 的 tick", () => {
    const firstDevSite = rows.find(
      (r) => (r.siteTypes["extension"] ?? 0) + (r.siteTypes["container"] ?? 0) > 0,
    );
    expect(firstDevSite).toBeDefined();
    const firstRcl3 = rows.find((r) => r.rcl >= 3);
    if (firstRcl3) {
      expect(firstDevSite!.tick).toBeLessThan(firstRcl3.tick);
    }
    // 首个 development site 必须出现在 rcl === 2 窗口内（RCL1 的 container 不算数）。
    const firstDevSiteInRcl2 = rows.find(
      (r) => r.rcl === 2 &&
        (r.siteTypes["extension"] ?? 0) + (r.siteTypes["container"] ?? 0) > 0,
    );
    expect(firstDevSiteInRcl2).toBeDefined();
  }, 10000);

  it("验收: rcl===2 窗口内 queued>0 且 site=0 连续 ≤100 tick", () => {
    const rcl2 = rows.filter((r) => r.rcl === 2);
    let stallRun = 0;
    let maxStall = 0;
    for (const r of rcl2) {
      if (r.queueTotal > 0 && r.siteCount === 0) {
        stallRun += 50;
        maxStall = Math.max(maxStall, stallRun);
      } else {
        stallRun = 0;
      }
    }
    if (maxStall > 100) {
      console.log(`[canary][FAIL] stall window ${maxStall}t — 最后 20 个采样:`);
      for (const r of rows.slice(-20)) {
        console.log(JSON.stringify(r));
      }
    }
    expect(maxStall).toBeLessThanOrEqual(100);
  }, 10000);

  it("验收: extension/container 任务实际发生 queued → site 转移", () => {
    // 全程追踪 per-key 状态：某 key 先出现在 queued 采样、后出现在 site 采样。
    const queuedAt = new Map<string, number>();
    let transitioned: { key: string; queuedTick: number; siteTick: number } | undefined;
    for (const r of rows) {
      for (const k of r.devQueuedKeys) {
        if (!queuedAt.has(k)) queuedAt.set(k, r.tick);
      }
      for (const k of r.devSiteKeys) {
        const q = queuedAt.get(k);
        if (q !== undefined && !transitioned) {
          transitioned = { key: k, queuedTick: q, siteTick: r.tick };
        }
      }
      if (transitioned) break;
    }
    if (!transitioned) {
      console.log("[canary][FAIL] 无任何 extension/container key 完成 queued→site 转移 — 最后 20 个采样:");
      for (const r of rows.slice(-20)) {
        console.log(JSON.stringify({ tick: r.tick, rcl: r.rcl, devQueued: r.devQueuedKeys, devSite: r.devSiteKeys, sites: r.siteTypes }));
      }
    }
    expect(transitioned).toBeDefined();
    expect(transitioned!.siteTick).toBeGreaterThan(transitioned!.queuedTick);
  }, 10000);

  it("验收: buildQueue 有硬上限（背景 ≤16，总量 ≤26）", () => {
    for (const r of rows) {
      expect(r.backgroundQueued).toBeLessThanOrEqual(16);
      expect(r.queueTotal).toBeLessThanOrEqual(26);
    }
  }, 10000);

  it("验收: 经济未进入死亡螺旋（末段人口与 spawn 存活）", () => {
    const tail = rows.slice(-10);
    expect(tail.length).toBeGreaterThan(0);
    const aliveCreep = tail.every((r) => r.creeps >= 1);
    const avgCreeps = tail.reduce((s, r) => s + r.creeps, 0) / tail.length;
    expect(aliveCreep || avgCreeps >= 2).toBe(true);
  }, 10000);

  it("回归: ≥5000 tick 连续运行完成", () => {
    expect(rows.length).toBeGreaterThan(0);
    const lastTick = rows[rows.length - 1]!.tick;
    expect(lastTick).toBeGreaterThanOrEqual(5000);
  }, 10000);
});
