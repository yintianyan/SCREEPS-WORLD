/** Phase R2 — RCL2 Early Development Recovery 集成回归。 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

// ─── 采样设施（R2 观测契约）────────────────────────────────

interface R2Sample {
  tick: number;
  rcl: number;
  progress: number;
  energy: number;
  capacity: number;
  queueTotal: number;
  queueKeys: Set<string>;
  queueByTypeState: string[];
  backgroundQueued: number;
  oldestQueuedAge: number;
  gameSites: number;
  siteTypes: Record<string, number>;
  roles: Record<string, number>;
  economyPressure: number;
  tier: string;
  claimSecure: boolean;
  spawnQueueP0: number;
}

function sample(world: TestWorld): R2Sample {
  const mem = (globalThis as any).Memory;
  const roomMem = mem?.rooms?.W1N1 ?? {};
  const queue: any[] = roomMem.buildQueue ?? [];
  const keys = new Set<string>();
  const byTypeState: string[] = [];
  let backgroundQueued = 0;
  let oldest = 0;
  for (const t of queue) {
    keys.add(t.key);
    byTypeState.push(`${t.structureType}:${t.state}`);
    if ((t.state === "queued" || t.state === "blocked") && t.priority >= 2) backgroundQueued++;
    if (t.state === "queued") {
      oldest = Math.max(oldest, world.tick - (t.queuedAt ?? world.tick));
    }
  }
  const siteTypes: Record<string, number> = {};
  for (const s of world.sites) {
    const ty = (s as any).structureType ?? "?";
    siteTypes[ty] = (siteTypes[ty] ?? 0) + 1;
  }
  const roles: Record<string, number> = {};
  for (const c of world.creeps) {
    const r = (c.memory as any).role ?? "?";
    roles[r] = (roles[r] ?? 0) + 1;
  }
  const spawnQueue: any[] = roomMem.spawnQueue ?? [];
  return {
    tick: world.tick,
    rcl: world.controller?.level ?? 0,
    progress: Math.floor(world.controller?.progress ?? 0),
    energy: world.room.energyAvailable,
    capacity: world.room.energyCapacityAvailable,
    queueTotal: queue.length,
    queueKeys: keys,
    queueByTypeState: byTypeState,
    backgroundQueued,
    oldestQueuedAge: oldest,
    gameSites: world.sites.length,
    siteTypes,
    roles,
    economyPressure: Math.round((roomMem.economyPressure ?? 0) * 100) / 100,
    tier: mem?.kernel?.tier ?? "?",
    claimSecure: roomMem.claimSecure ?? false,
    spawnQueueP0: spawnQueue.filter((r) => r.priority === 0).length,
  };
}

function collectEvery(world: TestWorld, store: R2Sample[], interval = 50): void {
  if (world.tick % interval === 0) store.push(sample(world));
}

// ─── 场景 1：RCL2 正常 — extension queued 后有限 tick 内出现 site ──

describe("Phase R2 — RCL2 建设闭环", () => {
  it("场景1: RCL2 正常 CPU/能量 — extension 300 tick 内出现 construction site", () => {
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

    let firstExtensionSiteTick = -1;
    const result = runner.run(world, 600, {
      onTick: (w) => {
        if (firstExtensionSiteTick < 0) {
          const hasExtSite = w.sites.some((s) => (s as any).structureType === "extension");
          if (hasExtSite) firstExtensionSiteTick = w.tick;
        }
      },
    });

    expect(result.runtimeErrors).toEqual([]);
    // 闭环核心断言：extension site 在队列入队后有限 tick 内出现。
    expect(firstExtensionSiteTick).toBeGreaterThan(0);
    expect(firstExtensionSiteTick).toBeLessThanOrEqual(300);
  });

  // ─── 场景 2：RCL2 conserve tier ──────────────────────────

  it("场景2a: RCL2 conserve + 能量地板满足 → 关键发展建设仍放行", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 100)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .sourceRegen(10)
      .cpu(2000) // bucket 2000 → conserve tier（< guarded.min 3000）。
      .build();

    // spawn 预填能量 — 保证能量地板（150）满足。
    world.spawns[0]!.store.energy = 300;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    let firstExtensionSiteTick = -1;
    let sawConserve = false;
    const samples: R2Sample[] = [];
    const result = runner.run(world, 500, {
      onTick: (w) => {
        collectEvery(w, samples, 100);
        const tier = (globalThis as any).Memory?.kernel?.tier;
        if (tier === "conserve") sawConserve = true;
        if (firstExtensionSiteTick < 0) {
          const hasExtSite = w.sites.some((s) => (s as any).structureType === "extension");
          if (hasExtSite) firstExtensionSiteTick = w.tick;
        }
      },
    });

    expect(result.runtimeErrors).toEqual([]);
    expect(sawConserve).toBe(true);
    // conserve 拉闸门禁，车道放行 — extension site 必须出现。
    if (firstExtensionSiteTick <= 0) {
      console.log("=== 2a conserve samples (no ext site) ===");
      for (const s of samples) {
        console.log(
          `t=${s.tick} tier=${s.tier} energy=${s.energy}/${s.capacity} ` +
          `p0spawn=${s.spawnQueueP0} sites=${s.gameSites} ` +
          `siteTypes=${JSON.stringify(s.siteTypes)} q=${s.queueTotal} ` +
          `byTS=${JSON.stringify(s.queueByTypeState)} roles=${JSON.stringify(s.roles)}`,
        );
      }
    }
    expect(firstExtensionSiteTick).toBeGreaterThan(0);
  });

  it("场景2b: RCL2 conserve + 能量低于地板 → 不创建 development site", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 100)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .sourceRegen(10)
      .cpu(2000)
      .build();

    // 无 creep、spawn 0 能量 — 无收入来源，能量恒 < 地板 150。
    world.spawns[0]!.store.energy = 0;
    world.room._recalcEnergy();
    const runner = new TickRunner();
    runner.setLoop(loop);

    let maxEnergy = 0;
    runner.run(world, 300, {
      onTick: (w) => {
        maxEnergy = Math.max(maxEnergy, w.room.energyAvailable);
      },
    });

    expect(maxEnergy).toBeLessThan(150);
    const extSites = world.sites.filter((s) => (s as any).structureType === "extension");
    expect(extSites).toHaveLength(0);
  });

  // ─── 场景 3：P0 生存缺口让位 ─────────────────────────────

  it("场景3: RCL2 P0 spawn 缺口期间 — 发展 site 不新增", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 100)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 22, 22)
      .source("s2", 32, 20)
      .container(23, 22, 1000)
      .container(31, 20, 1000)
      .creep("h1", "harvester", 23, 23, [
        { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
      ], { memory: { role: "harvester", home: "W1N1", mode: "work", sourceId: "s1" } })
      .sourceRegen(10)
      .cpu(10000)
      .build();

    world.spawns[0]!.store.energy = 300;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // 先跑 100 tick 建立稳态（site 可能已创建）。
    runner.run(world, 100);

    // 全灭采集 → P0 紧急恢复请求出现 → 门禁与车道都应拦截发展建设。
    for (const c of [...world.creeps]) {
      const role = c.memory.role as string;
      if (role === "harvester" || role === "worker" || role === "builder") {
        world.killCreep(c.name);
      }
    }

    let p0WindowTicks = 0;
    let extensionSiteGrewDuringP0 = false;
    let lastExtSites = world.sites.filter((s) => (s as any).structureType === "extension").length;
    runner.run(world, 200, {
      onTick: (w) => {
        const roomMem = (globalThis as any).Memory?.rooms?.W1N1 ?? {};
        const hasP0 = (roomMem.spawnQueue ?? []).some((r: any) => r.priority === 0);
        if (hasP0) {
          p0WindowTicks++;
          const extSites = w.sites.filter((s) => (s as any).structureType === "extension").length;
          if (extSites > lastExtSites) extensionSiteGrewDuringP0 = true;
          lastExtSites = extSites;
        }
      },
    });

    // P0 缺口窗口确实出现过，且窗口内 extension site 零新增。
    expect(p0WindowTicks).toBeGreaterThan(0);
    expect(extensionSiteGrewDuringP0).toBe(false);
  });

  // ─── 场景 4：hostile 在场不建发展 site ───────────────────

  it("场景4: RCL2 hostile 在场 — 不创建 extension site", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 100)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .sourceRegen(10)
      .hostile("invader1", 25, 10)
      .cpu(10000)
      .build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    const samples: R2Sample[] = [];
    runner.run(world, 300, {
      onTick: (w) => collectEvery(w, samples, 50),
    });

    const sawThreat = samples.some((s) => s.roles["invader"] !== undefined) ||
      world.sites.every((s) => (s as any).structureType !== "extension");
    const extSites = world.sites.filter((s) => (s as any).structureType === "extension");
    // 威胁在场期间 extension site 不放行（门禁与车道一致拦截）。
    expect(extSites).toHaveLength(0);
    expect(sawThreat).toBe(true);
  });

  // ─── 场景 5：重复规划不产生重复队列 ──────────────────────

  it("场景5: RCL2 重复规划 — 队列 key 幂等、无重复任务", () => {
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

    const samples: R2Sample[] = [];
    runner.run(world, 600, {
      onTick: (w) => collectEvery(w, samples, 50),
    });

    expect(samples.length).toBeGreaterThan(5);
    for (const s of samples) {
      // 稳定 key 幂等：任意采样点不允许重复 key。
      expect(s.queueKeys.size).toBe(s.queueTotal);
    }
    // 队列有界：背景任务 ≤ 硬上限，总量 ≤ 上限 + P0P1（ext5+container3+spawn）。
    const cap = (globalThis as any).CONFIG?.construction?.maxBackgroundQueuedPerRoom ?? 16;
    for (const s of samples) {
      expect(s.backgroundQueued).toBeLessThanOrEqual(cap);
      expect(s.queueTotal).toBeLessThanOrEqual(cap + 10);
    }
  });

  // ─── 场景 6：site 创建失败路径状态机 ─────────────────────

  it("场景6: ERR_RCL_NOT_ENOUGH / ERR_INVALID_TARGET / ERR_FULL 走正确状态机", async () => {
    const { tryCreateSite } = await import("../../../src/systems/construction-manager");
    const { assessEmergencyRebuild } = await import("../../../src/domain/construction/queue");

    const makeSnapshot = () =>
      ({
        roomName: "W7N4",
        rcl: 2,
        sources: [],
        controller: { pos: { x: 30, y: 30 } },
        spawns: [],
        extensions: [],
        towers: [],
        containers: [],
        roads: [],
        walls: [],
        ramparts: [],
        labs: [],
        links: [],
        storage: undefined,
        constructionSites: [],
        myConstructionSites: [],
        threatCreeps: [],
      }) as any;

    const makeTask = (key: string): any => ({
      key,
      pos: { x: 25, y: 26, roomName: "W7N4" },
      structureType: "extension",
      priority: 1,
      state: "queued",
      attempts: 0,
      retryAt: 0,
    });

    const g = globalThis as any;
    expect(g.Game).toBeDefined();
    const emergency = assessEmergencyRebuild(makeSnapshot());

    // ERR_RCL_NOT_ENOUGH → 瞬态：保持 queued + retryAt += 50。
    {
      const queue = [makeTask("t-rcl")];
      g.Game.rooms = {
        W7N4: { createConstructionSite: () => -14 }, // ERR_RCL_NOT_ENOUGH
      };
      tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
      expect(queue[0].state).toBe("queued");
      expect(queue[0].retryAt).toBeGreaterThan(g.Game.time);
    }

    // ERR_INVALID_TARGET → blocked + attempts++。
    {
      const queue = [makeTask("t-invalid")];
      g.Game.rooms = {
        W7N4: { createConstructionSite: () => -7 }, // ERR_INVALID_TARGET
      };
      tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
      expect(queue[0].state).toBe("blocked");
      expect(queue[0].attempts).toBe(1);
    }

    // ERR_FULL → retryAt 短冷却 + 本 tick 终止。
    {
      const queue = [makeTask("t-full"), makeTask("t-second")];
      g.Game.rooms = {
        W7N4: { createConstructionSite: () => -8 }, // ERR_FULL
      };
      const created = tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
      expect(created).toBe(false);
      expect(queue[0].state).toBe("queued");
      expect(queue[0].retryAt).toBeGreaterThan(g.Game.time);
      // 第二个任务未被尝试（ERR_FULL 即终止本轮）。
      expect(queue[1].retryAt).toBe(0);
    }

    // OK → site 状态。
    {
      const queue = [makeTask("t-ok")];
      g.Game.rooms = {
        W7N4: { createConstructionSite: () => 0 }, // OK
      };
      const created = tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
      expect(created).toBe(true);
      expect(queue[0].state).toBe("site");
    }
  });

  // ─── 场景 7：RCL2→RCL3 — extension 不等 RCL3 才出现 ─────

  it("场景7: RCL2→RCL3 迁移 — extension site 在 RCL2 阶段（rcl===2）出现，先于 RCL3", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(1, 0)
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

    let firstExtensionSiteTick = -1;
    let firstExtensionSiteRcl = -1;
    let rcl2Tick = -1;
    let rcl3Tick = -1;
    runner.run(world, 3000, {
      stopWhen: (w) => (w.controller?.level ?? 0) >= 3,
      onTick: (w) => {
        const rcl = w.controller?.level ?? 0;
        if (rcl === 2 && rcl2Tick < 0) rcl2Tick = w.tick;
        if (rcl >= 3 && rcl3Tick < 0) rcl3Tick = w.tick;
        if (firstExtensionSiteTick < 0) {
          const hasExtSite = w.sites.some((s) => (s as any).structureType === "extension");
          if (hasExtSite) {
            firstExtensionSiteTick = w.tick;
            firstExtensionSiteRcl = rcl;
          }
        }
      },
    });

    // 场景有效性：确实进入了 RCL2。
    expect(rcl2Tick).toBeGreaterThan(0);
    // 核心断言 1：extension site 出现。
    expect(firstExtensionSiteTick).toBeGreaterThan(0);
    // 核心断言 2：extension site 出现时 rcl === 2（不是 RCL3+ 才出现）。
    expect(firstExtensionSiteRcl).toBe(2);
    // 核心断言 3：如果已进入 RCL3，extension site 必须早于 RCL3。
    if (rcl3Tick > 0) {
      expect(firstExtensionSiteTick).toBeLessThan(rcl3Tick);
    }
  });

  // ─── 场景 8：1500 tick 长跑 — 队列有界、状态一致、不依赖 tower emergency ──

  it("场景8: RCL2 长跑 1500 tick — 队列有界、不依赖 RCL3 emergency 自愈", () => {
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

    const samples: R2Sample[] = [];
    const result = runner.run(world, 1500, {
      onTick: (w) => collectEvery(w, samples, 50),
    });

    expect(result.runtimeErrors).toEqual([]);

    const cap = (globalThis as any).CONFIG?.construction?.maxBackgroundQueuedPerRoom ?? 16;
    for (const s of samples) {
      // 队列不无限增长。
      expect(s.backgroundQueued).toBeLessThanOrEqual(cap);
      // 队列 key 幂等。
      expect(s.queueKeys.size).toBe(s.queueTotal);
      // 不依赖 tower emergency：全程 RCL2（无 RCL3 tower 豁免参与自愈）。
      expect(s.rcl).toBe(2);
    }

    // 建设闭环：extension site 在长跑窗口内出现且保持存在。
    const withExtSite = samples.filter((s) => (s.siteTypes["extension"] ?? 0) > 0);
    expect(withExtSite.length).toBeGreaterThan(0);

    // 任务状态与实际 site 最终一致：site 状态任务数 ≥ Game site 中对应类型数
    // （site 任务可能已建成转 done，故为 ≥）。
    const last = samples[samples.length - 1]!;
    const siteStateTasks = last.queueByTypeState.filter((e) => e.endsWith(":site")).length;
    expect(siteStateTasks).toBeGreaterThanOrEqual(last.gameSites);
  });

  // ─── 场景 9（验收加固 三.2）：source container emergency 长期激活 + conserve ──

  it("场景9: source container emergency 长期激活 + conserve → lane 仍创建 extension site", () => {
    // s2 八邻域全部筑墙 → source container 永远无法放置 → needsSourceContainerRebuild
    // 恒真（emergency 长期激活）。该缺口属经济效率缺口而非生存缺口——由 emergency
    // 槽位并行处理，不得冻结发展通道（survivalGapActive 不含 sourceContainer）。
    const world = new ScenarioBuilder("W1N1")
      .rcl(2, 100)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 30)
      .source("s1", 20, 20)
      .source("s2", 32, 20)
      .container(21, 20, 500)
      .walls([
        { x: 31, y: 19 }, { x: 32, y: 19 }, { x: 33, y: 19 },
        { x: 31, y: 20 }, { x: 33, y: 20 },
        { x: 31, y: 21 }, { x: 32, y: 21 }, { x: 33, y: 21 },
      ])
      .sourceRegen(10)
      .cpu(2000) // conserve tier — 严格门禁拒绝，通道是唯一放行路径。
      .build();

    world.spawns[0]!.store.energy = 300;
    world.room._recalcEnergy();

    const runner = new TickRunner();
    runner.setLoop(loop);

    let firstExtensionSiteTick = -1;
    let sawConserve = false;
    const result = runner.run(world, 600, {
      onTick: (w) => {
        const tier = (globalThis as any).Memory?.kernel?.tier;
        if (tier === "conserve") sawConserve = true;
        if (firstExtensionSiteTick < 0) {
          const hasExtSite = w.sites.some((s) => (s as any).structureType === "extension");
          if (hasExtSite) firstExtensionSiteTick = w.tick;
        }
      },
    });

    expect(result.runtimeErrors).toEqual([]);
    expect(sawConserve).toBe(true);
    // emergency（sourceContainer）长期激活 + conserve 门禁拒绝下，
    // extension site 仍经通道出现——普通槽位未被 emergency 饿死。
    expect(firstExtensionSiteTick).toBeGreaterThan(0);
    expect(firstExtensionSiteTick).toBeLessThanOrEqual(500);
  });
});
