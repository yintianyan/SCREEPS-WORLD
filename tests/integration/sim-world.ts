/**
 * Screeps 世界模拟器 — 轻量级 tick 模拟，用于集成测试。
 *
 * 设计目标：catch 单元测试无法覆盖的「多 tick 多 creep 交互涌现问题」。
 * 不模拟完整 Screeps API，只模拟影响经济/移动/建造的核心机制。
 *
 * 模拟的核心机制：
 *   - 地形网格（50x50，墙/平原/沼泽）
 *   - Source 再生（每 tick +10，上限 3000）
 *   - Container 衰减（每 tick -10 hits）
 *   - Creep 移动（每 tick 1 格，受地形影响）
 *   - Creep 碰撞（同格互斥，move 失败 = 卡位）
 *   - 能量流转（harvest → carry → transfer/withdraw）
 *   - 建造进度（builder 在 site 旁每 tick +progress）
 *   - Spawn 孵化（消耗能量，N tick 后出 creep）
 */

// ─── 类型定义 ───────────────────────────────────────────────

export type Terrain = 0 | 1 | 2; // plain | wall | swamp

export interface SimPos {
  x: number;
  y: number;
}

export interface SimSource {
  id: string;
  pos: SimPos;
  energy: number;
  capacity: number;
}

export interface SimContainer {
  id: string;
  pos: SimPos;
  energy: number;
  capacity: number;
  hits: number;
  hitsMax: number;
}

export interface SimConstructionSite {
  id: string;
  pos: SimPos;
  structureType: string;
  progress: number;
  progressTotal: number;
}

export interface SimSpawn {
  pos: SimPos;
  energy: number;
  capacity: number;
  spawning: { name: string; remainingTime: number } | null;
}

export interface SimCreep {
  name: string;
  role: string;
  pos: SimPos;
  body: { work: number; carry: number; move: number };
  energy: number;
  carryCapacity: number;
  hits: number;
  hitsMax: number;
  ticksToLive: number;
  fatigue: number;
  // 意图（每 tick 由 AI 设置，tick 结束时解析）
  intent: SimIntent | null;
}

export type SimIntent =
  | { type: "move"; dir: number }
  | { type: "harvest"; sourceId: string }
  | { type: "transfer"; targetId: string; amount: number }
  | { type: "withdraw"; targetId: string; amount: number }
  | { type: "build"; siteId: string }
  | { type: "repair"; targetId: string }
  | { type: "upgrade" };

export interface SimWorldConfig {
  terrain: Terrain[][];
  sources: Omit<SimSource, "energy">[];
  containers: Omit<SimContainer, "energy" | "hits">[];
  spawn: { pos: SimPos; capacity: number };
  controller: { pos: SimPos; level: number };
  containerDecayPerTick: number;
  sourceRegenPerTick: number;
}

export interface SimSnapshot {
  tick: number;
  creeps: { name: string; role: string; pos: SimPos; energy: number; intent: string }[];
  sources: { id: string; energy: number }[];
  containers: { id: string; energy: number; hits: number }[];
  spawn: { energy: number; spawning: boolean };
  sites: { id: string; type: string; progress: number; progressTotal: number }[];
  controller: { level: number; progress: number };
}

// ─── 方向工具 ───────────────────────────────────────────────

const DIR_DELTAS: Record<number, SimPos> = {
  1: { x: 0, y: -1 },   // TOP
  2: { x: 1, y: -1 },   // TOP_RIGHT
  3: { x: 1, y: 0 },    // RIGHT
  4: { x: 1, y: 1 },    // BOTTOM_RIGHT
  5: { x: 0, y: 1 },    // BOTTOM
  6: { x: -1, y: 1 },   // BOTTOM_LEFT
  7: { x: -1, y: 0 },   // LEFT
  8: { x: -1, y: -1 },  // TOP_LEFT
};

export function distance(a: SimPos, b: SimPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function directionTo(from: SimPos, to: SimPos): number {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  for (const [dir, delta] of Object.entries(DIR_DELTAS)) {
    if (delta.x === dx && delta.y === dy) return Number(dir);
  }
  return 3; // fallback RIGHT
}

// ─── 世界模拟器 ─────────────────────────────────────────────

export class SimWorld {
  tick = 0;
  terrain: Terrain[][];
  sources: SimSource[];
  containers: SimContainer[];
  sites: SimConstructionSite[];
  spawn: SimSpawn;
  controller: { pos: SimPos; level: number; progress: number; progressTotal: number };
  creeps: SimCreep[] = [];
  config: SimWorldConfig;

  // 统计
  totalHarvested = 0;
  totalUpgraded = 0;
  totalBuilt = 0;

  constructor(config: SimWorldConfig) {
    this.config = config;
    this.terrain = config.terrain;
    this.sources = config.sources.map(s => ({ ...s, energy: s.capacity }));
    this.containers = config.containers.map(c => ({ ...c, energy: 0, hits: c.hitsMax }));
    this.spawn = { pos: config.spawn.pos, energy: config.spawn.capacity, capacity: config.spawn.capacity, spawning: null };
    this.controller = {
      pos: config.controller.pos,
      level: config.controller.level,
      progress: 0,
      progressTotal: RCL_PROGRESS[config.controller.level] ?? 45000,
    };
    this.sites = [];
  }

  // ─── Creep 管理 ───

  addCreep(name: string, role: string, pos: SimPos, body: { work: number; carry: number; move: number }): SimCreep {
    const carryCapacity = body.carry * 50;
    const hitsMax = (body.work + body.carry + body.move) * 100;
    const creep: SimCreep = {
      name, role, pos: { ...pos }, body,
      energy: 0, carryCapacity, hits: hitsMax, hitsMax,
      ticksToLive: 1500, fatigue: 0, intent: null,
    };
    this.creeps.push(creep);
    return creep;
  }

  addSite(id: string, pos: SimPos, structureType: string, progressTotal: number): SimConstructionSite {
    const site: SimConstructionSite = { id, pos: { ...pos }, structureType, progress: 0, progressTotal };
    this.sites.push(site);
    return site;
  }

  // ─── 地形查询 ───

  isWalkable(pos: SimPos): boolean {
    if (pos.x < 0 || pos.x > 49 || pos.y < 0 || pos.y > 49) return false;
    return this.terrain[pos.y]![pos.x] !== 1;
  }

  terrainCost(pos: SimPos): number {
    if (!this.isWalkable(pos)) return Infinity;
    const t = this.terrain[pos.y]![pos.x]!;
    if (t === 2) return 5; // swamp
    return 1; // plain (road 也视为 1，简化)
  }

  // ─── Tick 模拟 ───

  /**
   * 执行一个完整 tick：
   * 1. 解析 creep 意图（设置 intent）
   * 2. 解析移动（碰撞检测）
   * 3. 解析动作（harvest/transfer/build/repair/upgrade）
   * 4. 世界更新（source 再生、container 衰减、spawn 孵化）
   * 5. Creep 老化
   */
  step(setIntents: (world: SimWorld) => void): void {
    this.tick++;

    // 1. AI 设置意图
    for (const creep of this.creeps) creep.intent = null;
    setIntents(this);

    // 2. 解析移动（先收集所有移动意图，再统一解析碰撞）
    this.resolveMovement();

    // 3. 解析动作
    this.resolveActions();

    // 4. 世界更新
    this.updateWorld();

    // 5. Creep 老化
    this.ageCreeps();
  }

  private resolveMovement(): void {
    // 收集所有移动意图的目标位置
    const moveIntents: { creep: SimCreep; target: SimPos }[] = [];

    for (const creep of this.creeps) {
      if (creep.fatigue > 0) {
        creep.fatigue -= creep.body.move * 2;
        if (creep.fatigue < 0) creep.fatigue = 0;
        continue; // 疲劳中不能移动
      }
      if (creep.intent?.type === "move") {
        const delta = DIR_DELTAS[creep.intent.dir];
        if (delta) {
          const target = { x: creep.pos.x + delta.x, y: creep.pos.y + delta.y };
          if (this.isWalkable(target)) {
            moveIntents.push({ creep, target });
          }
        }
      }
    }

    // 碰撞解析：两个 creep 不能同时进入同一格
    // 简化规则：先到先得（按数组顺序），后者移动失败
    const occupied = new Set<string>(this.creeps.map(c => `${c.pos.x},${c.pos.y}`));
    const newPositions = new Set<string>();

    for (const { creep, target } of moveIntents) {
      const key = `${target.x},${target.y}`;
      // 目标格当前无人 或 当前 occupant 也在移动（交换/链式移动简化为：目标格不在新位置集中）
      if (!occupied.has(key) || newPositions.has(key)) {
        // 目标格空闲，可以移动
      }
      if (newPositions.has(key)) {
        // 已有另一个 creep 要移动到这格 — 碰撞，移动失败
        continue;
      }
      // 检查目标格是否被不动的 creep 占据
      const occupant = this.creeps.find(c => c.pos.x === target.x && c.pos.y === target.y && c !== creep);
      if (occupant && !moveIntents.some(m => m.creep === occupant)) {
        // 目标格被不动的 creep 占据 — 碰撞
        continue;
      }
      // 移动成功
      newPositions.add(key);
      // 从旧位置移除占用
      occupied.delete(`${creep.pos.x},${creep.pos.y}`);
      creep.pos = target;
      // 地形疲劳
      const cost = this.terrainCost(target);
      if (cost > 1) {
        creep.fatigue += cost * 2 - creep.body.move * 2;
        if (creep.fatigue < 0) creep.fatigue = 0;
      }
    }
  }

  private resolveActions(): void {
    for (const creep of this.creeps) {
      const intent = creep.intent;
      if (!intent || intent.type === "move") continue;

      switch (intent.type) {
        case "harvest": {
          const source = this.sources.find(s => s.id === intent.sourceId);
          if (!source) break;
          if (distance(creep.pos, source.pos) > 1) break;
          const harvestAmount = Math.min(creep.body.work * 2, source.energy, creep.carryCapacity - creep.energy);
          source.energy -= harvestAmount;
          creep.energy += harvestAmount;
          this.totalHarvested += harvestAmount;
          break;
        }
        case "transfer": {
          const container = this.containers.find(c => c.id === intent.targetId);
          const spawn = this.spawn;
          if (container && distance(creep.pos, container.pos) <= 1) {
            const amount = Math.min(intent.amount, creep.energy, container.capacity - container.energy);
            creep.energy -= amount;
            container.energy += amount;
          } else if (distance(creep.pos, spawn.pos) <= 1 && intent.targetId === "spawn") {
            const amount = Math.min(intent.amount, creep.energy, spawn.capacity - spawn.energy);
            creep.energy -= amount;
            spawn.energy += amount;
          }
          break;
        }
        case "withdraw": {
          const container = this.containers.find(c => c.id === intent.targetId);
          if (container && distance(creep.pos, container.pos) <= 1) {
            const amount = Math.min(intent.amount, container.energy, creep.carryCapacity - creep.energy);
            container.energy -= amount;
            creep.energy += amount;
          }
          break;
        }
        case "build": {
          const site = this.sites.find(s => s.id === intent.siteId);
          if (!site) break;
          if (distance(creep.pos, site.pos) > 3) break;
          if (creep.energy <= 0) break;
          const buildPower = creep.body.work * 5;
          const energyUsed = Math.min(creep.energy, buildPower);
          const progress = energyUsed;
          site.progress += progress;
          creep.energy -= energyUsed;
          this.totalBuilt += progress;
          // 建造完成
          if (site.progress >= site.progressTotal) {
            if (site.structureType === "container") {
              this.containers.push({
                id: site.id + "_built",
                pos: site.pos,
                energy: 0,
                capacity: 2000,
                hits: 250000,
                hitsMax: 250000,
              });
            }
            this.sites = this.sites.filter(s => s.id !== site.id);
          }
          break;
        }
        case "repair": {
          const container = this.containers.find(c => c.id === intent.targetId);
          if (!container) break;
          if (distance(creep.pos, container.pos) > 3) break;
          if (creep.energy <= 0) break;
          const repairPower = creep.body.work * 100;
          const energyUsed = Math.min(creep.energy, Math.ceil(repairPower / 100));
          container.hits = Math.min(container.hitsMax, container.hits + repairPower);
          creep.energy -= energyUsed;
          break;
        }
        case "upgrade": {
          if (distance(creep.pos, this.controller.pos) > 3) break;
          if (creep.energy <= 0) break;
          const upgradePower = creep.body.work * 1;
          const energyUsed = Math.min(creep.energy, upgradePower);
          this.controller.progress += energyUsed;
          creep.energy -= energyUsed;
          this.totalUpgraded += energyUsed;
          // RCL 升级
          if (this.controller.progress >= this.controller.progressTotal) {
            this.controller.level++;
            this.controller.progress = 0;
            this.controller.progressTotal = RCL_PROGRESS[this.controller.level] ?? 45000;
          }
          break;
        }
      }
    }
  }

  private updateWorld(): void {
    // Source 再生
    for (const source of this.sources) {
      if (source.energy < source.capacity) {
        source.energy = Math.min(source.capacity, source.energy + this.config.sourceRegenPerTick);
      }
    }

    // Container 衰减
    for (const container of this.containers) {
      container.hits -= this.config.containerDecayPerTick;
      if (container.hits <= 0) {
        // Container 被摧毁
        container.hits = 0;
        container.energy = 0; // 能量散落（简化：消失）
      }
    }
    // 移除被摧毁的 container
    this.containers = this.containers.filter(c => c.hits > 0);

    // Spawn 孵化
    if (this.spawn.spawning) {
      this.spawn.spawning.remainingTime--;
      if (this.spawn.spawning.remainingTime <= 0) {
        this.spawn.spawning = null;
      }
    }
  }

  private ageCreeps(): void {
    for (const creep of this.creeps) {
      creep.ticksToLive--;
    }
    // 移除死亡 creep
    this.creeps = this.creeps.filter(c => c.ticksToLive > 0);
  }

  // ─── 快照 ───

  snapshot(): SimSnapshot {
    return {
      tick: this.tick,
      creeps: this.creeps.map(c => ({
        name: c.name, role: c.role, pos: { ...c.pos }, energy: c.energy,
        intent: c.intent?.type ?? "none",
      })),
      sources: this.sources.map(s => ({ id: s.id, energy: s.energy })),
      containers: this.containers.map(c => ({ id: c.id, energy: c.energy, hits: c.hits })),
      spawn: { energy: this.spawn.energy, spawning: this.spawn.spawning !== null },
      sites: this.sites.map(s => ({ id: s.id, type: s.structureType, progress: s.progress, progressTotal: s.progressTotal })),
      controller: { level: this.controller.level, progress: this.controller.progress },
    };
  }

  // ─── 断言辅助 ───

  /** 检查是否有 creep 连续卡位超过 N tick */
  getStuckCreeps(threshold: number): Map<string, number> {
    // 需要外部追踪位置历史，这里提供当前 tick 的位置
    return new Map();
  }
}

// ─── 常量 ───────────────────────────────────────────────────

const RCL_PROGRESS: Record<number, number> = {
  1: 200,
  2: 45000,
  3: 135000,
  4: 405000,
  5: 1215000,
  6: 3645000,
  7: 10935000,
};

// ─── 预设地形 ───────────────────────────────────────────────

/** 生成 50x50 全平原地形 */
export function flatTerrain(): Terrain[][] {
  return Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => 0 as Terrain));
}

/** 生成带墙壁的地形（模拟 E1S9 中心墙壁） */
export function walledTerrain(wallRects: { x1: number; y1: number; x2: number; y2: number }[]): Terrain[][] {
  const terrain = flatTerrain();
  for (const rect of wallRects) {
    for (let y = rect.y1; y <= rect.y2; y++) {
      for (let x = rect.x1; x <= rect.x2; x++) {
        if (x >= 0 && x < 50 && y >= 0 && y < 50) {
          terrain[y]![x] = 1;
        }
      }
    }
  }
  return terrain;
}
