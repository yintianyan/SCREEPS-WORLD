/**
 * ScenarioBuilder — 流式 API 构建测试世界初始状态。
 *
 * 用法：
 *   const world = new ScenarioBuilder("W1N1")
 *     .rcl(1)
 *     .spawn("Spawn1", 25, 25)
 *     .source("s1", 20, 20)
 *     .source("s2", 30, 30)
 *     .flat()
 *     .build();
 */
import { TestWorld, flatTerrain, terrainWithWalls, type WorldConfig, type WorldPos } from "./TestWorld";

export class ScenarioBuilder {
  private _roomName: string;
  private _terrain: number[][] = flatTerrain();
  private _sources: WorldConfig["sources"] = [];
  private _minerals: NonNullable<WorldConfig["minerals"]> = [];
  private _controller: WorldConfig["controller"] = { pos: { x: 25, y: 40 }, level: 1 };
  private _spawns: WorldConfig["spawns"] = [];
  private _extensions: NonNullable<WorldConfig["extensions"]> = [];
  private _containers: NonNullable<WorldConfig["containers"]> = [];
  private _towers: NonNullable<WorldConfig["towers"]> = [];
  private _storages: NonNullable<WorldConfig["storages"]> = [];
  private _links: NonNullable<WorldConfig["links"]> = [];
  private _roads: NonNullable<WorldConfig["roads"]> = [];
  private _walls: NonNullable<WorldConfig["walls"]> = [];
  private _ramparts: NonNullable<WorldConfig["ramparts"]> = [];
  private _constructionSites: NonNullable<WorldConfig["constructionSites"]> = [];
  private _creeps: NonNullable<WorldConfig["creeps"]> = [];
  private _hostiles: NonNullable<WorldConfig["hostiles"]> = [];
  private _sourceRegen = 10;
  private _containerDecay = 0;
  private _cpuBucket = 10000;
  private _cpuLimit = 20;

  constructor(roomName = "W1N1") {
    this._roomName = roomName;
  }

  /** 设置 RCL 等级和进度。 */
  rcl(level: number, progress = 0): this {
    this._controller.level = level;
    this._controller.progress = progress;
    return this;
  }

  /** 设置 controller 位置。 */
  controllerAt(x: number, y: number): this {
    this._controller.pos = { x, y };
    return this;
  }

  /** 添加 source。 */
  source(id: string, x: number, y: number, capacity = 3000): this {
    this._sources.push({ id, pos: { x, y }, capacity });
    return this;
  }

  /** 添加 mineral。 */
  mineral(id: string, x: number, y: number, type = "U"): this {
    this._minerals.push({ id, pos: { x, y }, type });
    return this;
  }

  /** 添加 spawn。 */
  spawn(name: string, x: number, y: number): this {
    this._spawns.push({ name, pos: { x, y } });
    return this;
  }

  /** 添加 N 个 extension。 */
  extensions(positions: WorldPos[]): this {
    for (const p of positions) {
      this._extensions.push({ pos: p });
    }
    return this;
  }

  /** 添加 container。 */
  container(x: number, y: number, energy = 0, hits = 250000, id?: string): this {
    this._containers.push({ pos: { x, y }, energy, hits, id });
    return this;
  }

  /** 添加 tower。 */
  tower(x: number, y: number, energy = 0): this {
    this._towers.push({ pos: { x, y }, energy });
    return this;
  }

  /** 添加 storage。 */
  storage(x: number, y: number, energy = 0): this {
    this._storages.push({ pos: { x, y }, energy });
    return this;
  }

  /** 添加 link。 */
  link(x: number, y: number, energy = 0): this {
    this._links.push({ pos: { x, y }, energy });
    return this;
  }

  /** 添加 road。 */
  road(x: number, y: number): this {
    this._roads.push({ pos: { x, y } });
    return this;
  }

  /** 添加 wall。 */
  wall(x: number, y: number, hits = 300000000): this {
    this._walls.push({ pos: { x, y }, hits });
    return this;
  }

  /** 添加 rampart。 */
  rampart(x: number, y: number, hits = 1): this {
    this._ramparts.push({ pos: { x, y }, hits });
    return this;
  }

  /** 添加 construction site。 */
  site(x: number, y: number, structureType: string, progress = 0): this {
    this._constructionSites.push({ pos: { x, y }, structureType, progress });
    return this;
  }

  /** 添加 creep。 */
  creep(
    name: string,
    role: string,
    x: number,
    y: number,
    body: Array<{ type: string }>,
    opts?: { energy?: number; ticksToLive?: number; memory?: Record<string, unknown> },
  ): this {
    this._creeps.push({
      name,
      role,
      pos: { x, y },
      body,
      energy: opts?.energy ?? 0,
      ticksToLive: opts?.ticksToLive ?? 1500,
      memory: opts?.memory ?? { role, home: this._roomName },
    });
    return this;
  }

  /** 添加敌方 creep。 */
  hostile(name: string, x: number, y: number, body: Array<{ type: string }> = [{ type: "attack" }]): this {
    this._hostiles.push({ name, pos: { x, y }, body });
    return this;
  }

  /** 使用全平地地形。 */
  flat(): this {
    this._terrain = flatTerrain();
    return this;
  }

  /** 设置墙壁位置。 */
  walls(positions: WorldPos[]): this {
    this._terrain = terrainWithWalls(positions);
    return this;
  }

  /** 设置自定义地形。 */
  terrain(grid: number[][]): this {
    this._terrain = grid;
    return this;
  }

  /** 设置 source 再生速率。 */
  sourceRegen(rate: number): this {
    this._sourceRegen = rate;
    return this;
  }

  /** 设置 container 衰减速率。 */
  containerDecay(rate: number): this {
    this._containerDecay = rate;
    return this;
  }

  /** 设置 CPU bucket。 */
  cpu(bucket: number, limit = 20): this {
    this._cpuBucket = bucket;
    this._cpuLimit = limit;
    return this;
  }

  /** 构建 TestWorld。 */
  build(): TestWorld {
    return new TestWorld({
      roomName: this._roomName,
      terrain: this._terrain,
      sources: this._sources,
      minerals: this._minerals,
      controller: this._controller,
      spawns: this._spawns,
      extensions: this._extensions,
      containers: this._containers,
      towers: this._towers,
      storages: this._storages,
      links: this._links,
      roads: this._roads,
      walls: this._walls,
      ramparts: this._ramparts,
      constructionSites: this._constructionSites,
      creeps: this._creeps,
      hostiles: this._hostiles,
      sourceRegenPerTick: this._sourceRegen,
      containerDecayPerTick: this._containerDecay,
      cpuBucket: this._cpuBucket,
      cpuLimit: this._cpuLimit,
    });
  }
}

// ─── 预设场景 ───────────────────────────────────────────────

/** RCL1 开局：1 spawn, 2 source, 0 creep, 300 能量。 */
export function rcl1Bootstrap(roomName = "W1N1"): ScenarioBuilder {
  return new ScenarioBuilder(roomName)
    .rcl(1)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 30)
    .source("s1", 20, 20)
    .source("s2", 35, 15)
    .sourceRegen(10)
    .cpu(10000);
}

/** RCL2 稳态：1 spawn + 5 extension, 2 source container, 基础人口。 */
export function rcl2Steady(roomName = "W1N1"): ScenarioBuilder {
  return new ScenarioBuilder(roomName)
    .rcl(2, 10000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 35)
    .source("s1", 15, 15)
    .source("s2", 35, 15)
    .container(16, 15, 500)
    .container(34, 15, 500)
    .extensions([
      { x: 24, y: 24 }, { x: 26, y: 24 }, { x: 24, y: 26 },
      { x: 26, y: 26 }, { x: 25, y: 24 },
    ])
    .sourceRegen(10)
    .containerDecay(5000)
    .cpu(10000);
}

/** RCL3 经济：spawn + 10 ext + tower + storage site。 */
export function rcl3Economy(roomName = "W1N1"): ScenarioBuilder {
  return new ScenarioBuilder(roomName)
    .rcl(3, 50000)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 35)
    .source("s1", 15, 15)
    .source("s2", 35, 15)
    .container(16, 15, 1000)
    .container(34, 15, 1000)
    .container(29, 34, 500)
    .tower(26, 25, 500)
    .extensions(
      Array.from({ length: 10 }, (_, i) => ({
        x: 22 + (i % 5),
        y: 23 + Math.floor(i / 5),
      })),
    )
    .sourceRegen(10)
    .containerDecay(5000)
    .cpu(10000);
}
