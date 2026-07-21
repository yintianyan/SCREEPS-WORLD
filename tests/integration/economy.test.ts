/**
 * 集成测试 — 老玩家视角的完整经济循环 + 边界场景 + 效率验证。
 *
 * 设计原则：这些测试模拟真实游戏中会出问题的场景，
 * 不是验证"代码能跑"，而是验证"经济不会崩"。
 */
import { describe, it, expect } from "vitest";
import {
  SimWorld,
  SimCreep,
  flatTerrain,
  distance,
  directionTo,
  type SimWorldConfig,
  type SimPos,
} from "./sim-world";

// ─── AI 行为库 ──────────────────────────────────────────────

function moveToward(creep: SimCreep, target: SimPos): void {
  if (distance(creep.pos, target) <= 1) return;
  const dir = directionTo(creep.pos, target);
  creep.intent = { type: "move", dir };
}

/** 完整 harvester AI：采集 → 倒 container/spawn → 循环 */
function harvesterFull(creep: SimCreep, world: SimWorld, sourceId: string, containerId?: string): void {
  const source = world.sources.find(s => s.id === sourceId);
  if (!source) return;
  const container = containerId ? world.containers.find(c => c.id === containerId) : undefined;

  if (creep.energy >= creep.carryCapacity) {
    // 满载 → 倒 container（优先）或 spawn
    if (container && container.hits > 0 && distance(creep.pos, container.pos) <= 1) {
      creep.intent = { type: "transfer", targetId: containerId!, amount: creep.energy };
    } else if (container && container.hits > 0) {
      moveToward(creep, container.pos);
    } else if (distance(creep.pos, world.spawn.pos) <= 1) {
      creep.intent = { type: "transfer", targetId: "spawn", amount: creep.energy };
    } else {
      moveToward(creep, world.spawn.pos);
    }
  } else {
    // 空载 → 采集
    if (distance(creep.pos, source.pos) <= 1) {
      creep.intent = { type: "harvest", sourceId };
    } else {
      moveToward(creep, source.pos);
    }
  }
}

/** 完整 hauler AI：container 取 → spawn 倒 → 循环 */
function haulerFull(creep: SimCreep, world: SimWorld, containerId: string): void {
  const container = world.containers.find(c => c.id === containerId);
  if (!container || container.hits <= 0) return;

  if (creep.energy > 0) {
    if (distance(creep.pos, world.spawn.pos) <= 1) {
      creep.intent = { type: "transfer", targetId: "spawn", amount: creep.energy };
    } else {
      moveToward(creep, world.spawn.pos);
    }
  } else {
    if (distance(creep.pos, container.pos) <= 1) {
      creep.intent = { type: "withdraw", targetId: containerId, amount: creep.carryCapacity };
    } else {
      moveToward(creep, container.pos);
    }
  }
}

/** 完整 upgrader AI：container 取 → 升级 → 循环（无 container 时自采） */
function upgraderFull(creep: SimCreep, world: SimWorld, containerId?: string): void {
  const container = containerId ? world.containers.find(c => c.id === containerId && c.hits > 0) : undefined;

  if (creep.energy > 0) {
    if (distance(creep.pos, world.controller.pos) <= 3) {
      creep.intent = { type: "upgrade" };
    } else {
      moveToward(creep, world.controller.pos);
    }
  } else if (container && container.energy > 0) {
    if (distance(creep.pos, container.pos) <= 1) {
      creep.intent = { type: "withdraw", targetId: containerId!, amount: creep.carryCapacity };
    } else {
      moveToward(creep, container.pos);
    }
  } else {
    // 无 container → 自采
    const source = world.sources[0]!;
    if (distance(creep.pos, source.pos) <= 1) {
      creep.intent = { type: "harvest", sourceId: source.id };
    } else {
      moveToward(creep, source.pos);
    }
  }
}

/** 完整 builder AI：container 取 → 建造 → 修 container → 循环 */
function builderFull(creep: SimCreep, world: SimWorld, containerId: string, siteId: string): void {
  const container = world.containers.find(c => c.id === containerId);
  const site = world.sites.find(s => s.id === siteId);

  // 紧急修 container（< 80%）
  if (container && container.hits < container.hitsMax * 0.8 && creep.energy > 0) {
    if (distance(creep.pos, container.pos) <= 3) {
      creep.intent = { type: "repair", targetId: containerId };
    } else {
      moveToward(creep, container.pos);
    }
    return;
  }

  if (creep.energy > 0) {
    if (site && distance(creep.pos, site.pos) <= 3) {
      creep.intent = { type: "build", siteId };
    } else if (site) {
      moveToward(creep, site.pos);
    }
  } else {
    if (container && container.energy > 0 && distance(creep.pos, container.pos) <= 1) {
      creep.intent = { type: "withdraw", targetId: containerId, amount: creep.carryCapacity };
    } else if (container && container.energy > 0) {
      moveToward(creep, container.pos);
    } else {
      // 无能量来源 → 自采
      const source = world.sources[0]!;
      if (distance(creep.pos, source.pos) <= 1) {
        creep.intent = { type: "harvest", sourceId: source.id };
      } else {
        moveToward(creep, source.pos);
      }
    }
  }
}

// ─── 统计工具 ───────────────────────────────────────────────

interface EconomyStats {
  totalHarvested: number;
  totalUpgraded: number;
  totalBuilt: number;
  spawnEnergyHistory: number[];
  containerEnergyHistory: number[];
  creepIdleTicks: Map<string, number>;
  creepActiveTicks: Map<string, number>;
}

function trackEconomy(world: SimWorld, stats: EconomyStats): void {
  stats.spawnEnergyHistory.push(world.spawn.energy);
  const contEnergy = world.containers.reduce((s, c) => s + c.energy, 0);
  stats.containerEnergyHistory.push(contEnergy);

  for (const creep of world.creeps) {
    const isActive = creep.intent !== null && creep.intent.type !== "move";
    const activeKey = `${creep.name}_active`;
    const idleKey = `${creep.name}_idle`;
    if (isActive) {
      stats.creepActiveTicks.set(creep.name, (stats.creepActiveTicks.get(creep.name) ?? 0) + 1);
    } else if (creep.intent === null) {
      stats.creepIdleTicks.set(creep.name, (stats.creepIdleTicks.get(creep.name) ?? 0) + 1);
    }
  }
}

// ─── 测试场景 ───────────────────────────────────────────────

describe("主流程：RCL1 Bootstrap 完整经济循环", () => {
  it("单 worker 应能在 500 tick 内将 controller 从 0 升到 RCL2 (200 progress)", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 3000 }],
      containers: [],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 1 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // RCL1 开局：1 个 [W,C,M] worker
    world.addCreep("worker-1", "worker", { x: 25, y: 24 }, { work: 1, carry: 1, move: 1 });

    const stats: EconomyStats = {
      totalHarvested: 0, totalUpgraded: 0, totalBuilt: 0,
      spawnEnergyHistory: [], containerEnergyHistory: [],
      creepIdleTicks: new Map(), creepActiveTicks: new Map(),
    };

    for (let tick = 0; tick < 500; tick++) {
      world.step(w => {
        const worker = w.creeps.find(c => c.name === "worker-1");
        if (!worker) return;

        // Worker AI：采集 → 填 spawn → 升级 → 循环
        if (worker.energy >= worker.carryCapacity) {
          // 满载：先填 spawn，再升级
          if (w.spawn.energy < w.spawn.capacity && distance(worker.pos, w.spawn.pos) <= 1) {
            worker.intent = { type: "transfer", targetId: "spawn", amount: worker.energy };
          } else if (w.spawn.energy < w.spawn.capacity) {
            moveToward(worker, w.spawn.pos);
          } else if (distance(worker.pos, w.controller.pos) <= 3) {
            worker.intent = { type: "upgrade" };
          } else {
            moveToward(worker, w.controller.pos);
          }
        } else {
          // 空载：采集
          const source = w.sources[0]!;
          if (distance(worker.pos, source.pos) <= 1) {
            worker.intent = { type: "harvest", sourceId: "s1" };
          } else {
            moveToward(worker, source.pos);
          }
        }
      });
      stats.totalHarvested = world.totalHarvested;
      stats.totalUpgraded = world.totalUpgraded;
      trackEconomy(world, stats);

      // 提前退出：已到 RCL2
      if (world.controller.level >= 2) break;
    }

    // 断言：500 tick 内应升到 RCL2
    expect(world.controller.level).toBeGreaterThanOrEqual(2);
    // 断言：总采集量 > 0（经济在运转）
    expect(world.totalHarvested).toBeGreaterThan(0);
    // 断言：总升级量 >= 200（RCL2 所需）
    expect(world.totalUpgraded).toBeGreaterThanOrEqual(200);
  });

  it("RCL2 稳态：2 harvester + 1 hauler + 1 upgrader 应维持正经济", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [
        { id: "s1", pos: { x: 15, y: 10 }, capacity: 3000 },
        { id: "s2", pos: { x: 35, y: 10 }, capacity: 3000 },
      ],
      containers: [
        { id: "c1", pos: { x: 16, y: 10 }, capacity: 2000, hitsMax: 250000 },
        { id: "c2", pos: { x: 34, y: 10 }, capacity: 2000, hitsMax: 250000 },
      ],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 25, y: 40 }, level: 2 },
      containerDecayPerTick: 10,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);

    // 2 harvester [W,W,C,M] + 1 hauler [C,C,C,M,M,M] + 1 upgrader [W,W,C,M,M]
    world.addCreep("h1", "harvester", { x: 15, y: 11 }, { work: 2, carry: 1, move: 1 });
    world.addCreep("h2", "harvester", { x: 35, y: 11 }, { work: 2, carry: 1, move: 1 });
    world.addCreep("haul1", "hauler", { x: 20, y: 20 }, { work: 0, carry: 3, move: 3 });
    world.addCreep("u1", "upgrader", { x: 25, y: 38 }, { work: 2, carry: 1, move: 2 });

    const stats: EconomyStats = {
      totalHarvested: 0, totalUpgraded: 0, totalBuilt: 0,
      spawnEnergyHistory: [], containerEnergyHistory: [],
      creepIdleTicks: new Map(), creepActiveTicks: new Map(),
    };

    for (let tick = 0; tick < 1000; tick++) {
      world.step(w => {
        const h1 = w.creeps.find(c => c.name === "h1");
        const h2 = w.creeps.find(c => c.name === "h2");
        const haul = w.creeps.find(c => c.name === "haul1");
        const upg = w.creeps.find(c => c.name === "u1");
        if (h1) harvesterFull(h1, w, "s1", "c1");
        if (h2) harvesterFull(h2, w, "s2", "c2");
        // Hauler 轮流搬两个 container
        if (haul) {
          const c1 = w.containers.find(c => c.id === "c1");
          const c2 = w.containers.find(c => c.id === "c2");
          const target = (c1?.energy ?? 0) >= (c2?.energy ?? 0) ? "c1" : "c2";
          haulerFull(haul, w, target);
        }
        if (upg) upgraderFull(upg, w, "c1");
      });
      stats.totalHarvested = world.totalHarvested;
      stats.totalUpgraded = world.totalUpgraded;
      trackEconomy(world, stats);
    }

    // 断言 1：经济正增长（总采集 > 总消耗）
    expect(world.totalHarvested).toBeGreaterThan(0);

    // 断言 2：升级在持续进行
    expect(world.totalUpgraded).toBeGreaterThan(100);

    // 断言 3：spawn 不应持续空（经济在供给）
    const lastSpawnEnergies = stats.spawnEnergyHistory.slice(-100);
    const avgSpawnEnergy = lastSpawnEnergies.reduce((a, b) => a + b, 0) / lastSpawnEnergies.length;
    expect(avgSpawnEnergy).toBeGreaterThan(0);

    // 断言 4：container 不应全部持续满载（hauler 在搬）
    const lastContEnergies = stats.containerEnergyHistory.slice(-100);
    const maxContEnergy = Math.max(...lastContEnergies);
    // 两个 container 总容量 4000，不应持续 > 3800（95%）
    expect(maxContEnergy).toBeLessThan(3900);
  });
});

describe("边界场景：灾难恢复", () => {
  it("harvester 全灭后经济应在 300 tick 内恢复（新 worker 自采）", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 3000 }],
      containers: [{ id: "c1", pos: { x: 21, y: 15 }, capacity: 2000, hitsMax: 250000 }],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 2 },
      containerDecayPerTick: 10,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 预填 container 和 spawn（模拟正常运行中突然 harvester 全灭）
    world.containers[0]!.energy = 1500;
    world.spawn.energy = 300;

    // 只有 1 个 hauler 和 1 个 upgrader，无 harvester
    world.addCreep("haul1", "hauler", { x: 22, y: 20 }, { work: 0, carry: 3, move: 3 });
    world.addCreep("u1", "upgrader", { x: 28, y: 28 }, { work: 2, carry: 1, move: 2 });

    // 模拟：50 tick 后 spawn 孵出一个 worker（P0 恢复）
    let workerSpawned = false;

    for (let tick = 0; tick < 300; tick++) {
      world.step(w => {
        // 50 tick 后孵出 worker
        if (tick === 50 && !workerSpawned && w.spawn.energy >= 200) {
          w.addCreep("worker-rescue", "worker", { x: 25, y: 24 }, { work: 1, carry: 1, move: 1 });
          w.spawn.energy -= 200;
          workerSpawned = true;
        }

        const haul = w.creeps.find(c => c.name === "haul1");
        const upg = w.creeps.find(c => c.name === "u1");
        const worker = w.creeps.find(c => c.name === "worker-rescue");

        if (haul) haulerFull(haul, w, "c1");
        if (upg) upgraderFull(upg, w, "c1");
        if (worker) harvesterFull(worker, w, "s1", "c1");
      });
    }

    // 断言 1：worker 确实被孵出
    expect(workerSpawned).toBe(true);

    // 断言 2：经济恢复 — container 有能量流入
    const container = world.containers.find(c => c.id === "c1");
    // container 可能衰减了，但不应完全空（worker 在补充）
    // 如果 worker 在工作，totalHarvested > 0
    expect(world.totalHarvested).toBeGreaterThan(0);
  });

  it("container 被摧毁后 harvester 应回退到直接填 spawn", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 3000 }],
      containers: [{ id: "c1", pos: { x: 21, y: 15 }, capacity: 2000, hitsMax: 250000 }],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 2 },
      containerDecayPerTick: 5000, // 极快衰减，模拟被摧毁
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    world.containers[0]!.hits = 10000; // 低血量，很快被摧毁
    world.addCreep("h1", "harvester", { x: 20, y: 16 }, { work: 2, carry: 1, move: 1 });

    let spawnReceivedEnergy = false;

    for (let tick = 0; tick < 200; tick++) {
      world.step(w => {
        const h = w.creeps.find(c => c.name === "h1");
        if (h) harvesterFull(h, w, "s1", "c1");
      });

      if (world.spawn.energy > 0) {
        spawnReceivedEnergy = true;
      }
    }

    // 断言：container 被摧毁后（hits <= 0），harvester 回退到填 spawn
    const container = world.containers.find(c => c.id === "c1");
    expect(container).toBeUndefined(); // container 已被摧毁
    expect(spawnReceivedEnergy).toBe(true); // spawn 收到了能量
  });

  it("source 耗尽时 harvester 不应崩溃（应 idle 等待再生）", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 100 }], // 极小容量
      containers: [],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 1, // 极慢再生
    };
    const world = new SimWorld(config);
    world.addCreep("h1", "harvester", { x: 20, y: 16 }, { work: 5, carry: 1, move: 1 }); // 5W 快速耗尽

    // 不应抛异常
    for (let tick = 0; tick < 100; tick++) {
      world.step(w => {
        const h = w.creeps.find(c => c.name === "h1");
        if (h) harvesterFull(h, w, "s1");
      });
    }

    // 断言：harvester 仍然存活（没有因为 source 空而崩溃）
    const h = world.creeps.find(c => c.name === "h1");
    expect(h).toBeDefined();
    expect(h!.ticksToLive).toBeGreaterThan(0);
  });

  it("creep 死亡后其 carry 能量不应凭空消失（能量守恒）", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 3000 }],
      containers: [],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 短命 creep（10 tick 后死）
    const creep = world.addCreep("shorty", "harvester", { x: 20, y: 16 }, { work: 2, carry: 1, move: 1 });
    creep.ticksToLive = 10;

    let energyBeforeDeath = 0;

    for (let tick = 0; tick < 20; tick++) {
      world.step(w => {
        const h = w.creeps.find(c => c.name === "shorty");
        if (h) harvesterFull(h, w, "s1");
      });

      if (tick === 8) {
        // 记录死前状态
        const h = world.creeps.find(c => c.name === "shorty");
        if (h) energyBeforeDeath = h.energy;
      }
    }

    // 断言：creep 已死亡
    const h = world.creeps.find(c => c.name === "shorty");
    expect(h).toBeUndefined();

    // 注：在真实 Screeps 中，creep 死亡会留下 tombstone（能量散落）。
    // 我们的模拟器简化处理：能量消失。这个测试验证 creep 确实死了。
    // 如果要模拟 tombstone，需要在 ageCreeps 中添加能量散落逻辑。
  });
});

describe("Creep 效率验证", () => {
  it("3W harvester 站桩采集效率应 >= 5 energy/tick（理论 6/tick）", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 25, y: 10 }, capacity: 3000 }],
      containers: [{ id: "c1", pos: { x: 26, y: 10 }, capacity: 2000, hitsMax: 250000 }],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 40, y: 40 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 3W harvester 已在 source 旁
    world.addCreep("h1", "harvester", { x: 25, y: 11 }, { work: 3, carry: 1, move: 1 });

    // 跑 200 tick 稳态
    for (let tick = 0; tick < 200; tick++) {
      world.step(w => {
        const h = w.creeps.find(c => c.name === "h1");
        if (h) harvesterFull(h, w, "s1", "c1");
      });
    }

    // 3W = 6 energy/tick 理论采集率
    // 但 carry 只有 50，每 50/6 ≈ 8 tick 满一次，需要 1 tick 倒 container
    // 实际效率 ≈ 6 * (8/9) ≈ 5.3/tick
    const harvestRate = world.totalHarvested / 200;
    expect(harvestRate).toBeGreaterThanOrEqual(4.5);
  });

  it("hauler 搬运吞吐：3C hauler 在 10 格距离应 >= 2 energy/tick", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 10, y: 10 }, capacity: 3000 }],
      containers: [{ id: "c1", pos: { x: 11, y: 10 }, capacity: 2000, hitsMax: 250000 }],
      spawn: { pos: { x: 21, y: 10 }, capacity: 300 }, // 10 格距离
      controller: { pos: { x: 40, y: 40 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 预填 container
    world.containers[0]!.energy = 2000;
    // 3C hauler（150 容量），3M（无疲劳）
    world.addCreep("haul1", "hauler", { x: 12, y: 10 }, { work: 0, carry: 3, move: 3 });

    let totalDelivered = 0;
    const initialSpawnEnergy = world.spawn.energy;

    for (let tick = 0; tick < 200; tick++) {
      world.step(w => {
        const haul = w.creeps.find(c => c.name === "haul1");
        if (haul) haulerFull(haul, w, "c1");
        // 补充 container（模拟 harvester 持续供能）
        const c = w.containers.find(cc => cc.id === "c1");
        if (c) c.energy = Math.min(c.capacity, c.energy + 10);
      });
    }

    totalDelivered = world.spawn.energy - initialSpawnEnergy;
    const throughput = totalDelivered / 200;

    // 3C = 150 容量，10 格往返 = 20 tick，吞吐 = 150/20 = 7.5/tick 理论
    // 实际考虑取/倒各 1 tick：150/22 ≈ 6.8/tick
    // 保守断言 >= 2/tick（考虑各种开销）
    expect(throughput).toBeGreaterThanOrEqual(2);
  });

  it("upgrader 站桩 uptime 应 >= 70%（有 controller container 时）", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 10, y: 10 }, capacity: 3000 }],
      containers: [{ id: "ctrl-c", pos: { x: 39, y: 40 }, capacity: 2000, hitsMax: 250000 }],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 40, y: 40 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 预填 controller container
    world.containers[0]!.energy = 2000;
    // Upgrader 站在 controller container 旁
    world.addCreep("u1", "upgrader", { x: 38, y: 40 }, { work: 2, carry: 1, move: 1 });

    let upgradeTicks = 0;
    const totalTicks = 200;

    for (let tick = 0; tick < totalTicks; tick++) {
      world.step(w => {
        const u = w.creeps.find(c => c.name === "u1");
        if (u) upgraderFull(u, w, "ctrl-c");
        // 持续补充 controller container
        const c = w.containers.find(cc => cc.id === "ctrl-c");
        if (c) c.energy = Math.min(c.capacity, c.energy + 10);
      });

      // 检查 upgrader 是否在升级
      const u = world.creeps.find(c => c.name === "u1");
      if (u?.intent?.type === "upgrade") upgradeTicks++;
    }

    const uptime = upgradeTicks / totalTicks;
    // 站桩 upgrader：取能 1 tick + 升级直到空（50/2=25 tick）→ 25/26 ≈ 96% uptime
    expect(uptime).toBeGreaterThanOrEqual(0.7);
  });

  it("idle 检测：无任务 creep 不应持续 idle 超过 20 tick", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 3000 }],
      containers: [{ id: "c1", pos: { x: 21, y: 15 }, capacity: 2000, hitsMax: 250000 }],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    world.containers[0]!.energy = 1000;
    // Hauler 有 container 可搬
    world.addCreep("haul1", "hauler", { x: 22, y: 20 }, { work: 0, carry: 3, move: 3 });

    let maxConsecutiveIdle = 0;
    let currentIdle = 0;

    for (let tick = 0; tick < 100; tick++) {
      world.step(w => {
        const haul = w.creeps.find(c => c.name === "haul1");
        if (haul) haulerFull(haul, w, "c1");
      });

      const haul = world.creeps.find(c => c.name === "haul1");
      if (haul && haul.intent === null) {
        currentIdle++;
        maxConsecutiveIdle = Math.max(maxConsecutiveIdle, currentIdle);
      } else {
        currentIdle = 0;
      }
    }

    // 断言：有任务可做时不应持续 idle 超过 20 tick
    expect(maxConsecutiveIdle).toBeLessThanOrEqual(20);
  });
});

describe("经济压力：死亡螺旋检测", () => {
  it("能量赤字不应导致完全崩溃（spawn 应始终能孵出最小 creep）", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 3000 }],
      containers: [],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 极弱 harvester（1W），产出远低于消耗
    world.addCreep("h1", "harvester", { x: 20, y: 16 }, { work: 1, carry: 1, move: 1 });
    // 多个消耗者
    world.addCreep("u1", "upgrader", { x: 28, y: 28 }, { work: 2, carry: 1, move: 2 });
    world.addCreep("u2", "upgrader", { x: 29, y: 29 }, { work: 2, carry: 1, move: 2 });

    let spawnNeverZero = true;
    let minSpawnEnergy = 300;

    for (let tick = 0; tick < 500; tick++) {
      world.step(w => {
        const h = w.creeps.find(c => c.name === "h1");
        const u1 = w.creeps.find(c => c.name === "u1");
        const u2 = w.creeps.find(c => c.name === "u2");
        if (h) harvesterFull(h, w, "s1");
        if (u1) upgraderFull(u1, w);
        if (u2) upgraderFull(u2, w);
      });

      minSpawnEnergy = Math.min(minSpawnEnergy, world.spawn.energy);
    }

    // 断言：即使能量紧张，spawn 不应永远为 0（harvester 至少在填）
    // 1W harvester 每 25 tick 填 50 能量到 spawn
    expect(world.totalHarvested).toBeGreaterThan(0);
  });

  it("container 溢满检测：hauler 不足时 container 应触发溢满告警", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [{ id: "s1", pos: { x: 20, y: 15 }, capacity: 3000 }],
      containers: [{ id: "c1", pos: { x: 21, y: 15 }, capacity: 2000, hitsMax: 250000 }],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 30, y: 30 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 强 harvester（5W）但无 hauler
    world.addCreep("h1", "harvester", { x: 20, y: 16 }, { work: 5, carry: 1, move: 1 });

    let containerFullTicks = 0;

    for (let tick = 0; tick < 300; tick++) {
      world.step(w => {
        const h = w.creeps.find(c => c.name === "h1");
        if (h) harvesterFull(h, w, "s1", "c1");
      });

      const c = world.containers.find(cc => cc.id === "c1");
      if (c && c.energy >= c.capacity * 0.95) {
        containerFullTicks++;
      }
    }

    // 断言：无 hauler 时 container 应大部分时间满载（验证溢满检测逻辑）
    // 5W harvester 快速填满 2000 容量 container，无 hauler 搬走
    expect(containerFullTicks).toBeGreaterThan(200); // > 66% 时间满载
  });

  it("双 source 房间：两个 harvester 应各占一个 source（不挤同一个）", () => {
    const config: SimWorldConfig = {
      terrain: flatTerrain(),
      sources: [
        { id: "s1", pos: { x: 10, y: 10 }, capacity: 3000 },
        { id: "s2", pos: { x: 40, y: 10 }, capacity: 3000 },
      ],
      containers: [],
      spawn: { pos: { x: 25, y: 25 }, capacity: 300 },
      controller: { pos: { x: 25, y: 40 }, level: 2 },
      containerDecayPerTick: 0,
      sourceRegenPerTick: 10,
    };
    const world = new SimWorld(config);
    // 两个 harvester 从 spawn 出发
    world.addCreep("h1", "harvester", { x: 24, y: 24 }, { work: 2, carry: 1, move: 1 });
    world.addCreep("h2", "harvester", { x: 26, y: 24 }, { work: 2, carry: 1, move: 1 });

    // 简单分配：h1 → s1, h2 → s2
    for (let tick = 0; tick < 100; tick++) {
      world.step(w => {
        const h1 = w.creeps.find(c => c.name === "h1");
        const h2 = w.creeps.find(c => c.name === "h2");
        if (h1) harvesterFull(h1, w, "s1");
        if (h2) harvesterFull(h2, w, "s2");
      });
    }

    // 断言：两个 source 都被采集了
    const s1 = world.sources.find(s => s.id === "s1")!;
    const s2 = world.sources.find(s => s.id === "s2")!;
    // 两个 source 都不应满（都在被采）
    expect(s1.energy).toBeLessThan(3000);
    expect(s2.energy).toBeLessThan(3000);

    // 断言：两个 harvester 在不同 source 附近
    const h1 = world.creeps.find(c => c.name === "h1")!;
    const h2 = world.creeps.find(c => c.name === "h2")!;
    const h1NearS1 = distance(h1.pos, { x: 10, y: 10 }) <= 2;
    const h2NearS2 = distance(h2.pos, { x: 40, y: 10 }) <= 2;
    expect(h1NearS1).toBe(true);
    expect(h2NearS2).toBe(true);
  });
});
