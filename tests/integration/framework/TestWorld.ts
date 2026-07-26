/**
 * TestWorld — 完整 Screeps Runtime 模拟器。
 *
 * 设计原则：
 *   - 模拟 Screeps 引擎（Game/Room/Creep/Structure/Source），不 mock AI 内部逻辑。
 *   - 生产代码（kernel.run()）读取 Game/Memory/RawMemory 全局对象，写入意图。
 *   - TestWorld 每 tick 推进物理（能量再生、container 衰减、孵化倒计时、creep 老化）。
 *   - 操作（harvest/transfer/withdraw/build/repair/upgrade）立即生效（与真实引擎一致）。
 *   - 移动立即生效（简化碰撞，足够测试 AI 决策逻辑）。
 */

// ─── 类型定义 ───────────────────────────────────────────────

export interface WorldPos {
  x: number;
  y: number;
}

export interface WorldConfig {
  roomName: string;
  /** 50x50 地形：0=plain, 1=wall, 2=swamp */
  terrain: number[][];
  sources: Array<{ id: string; pos: WorldPos; capacity?: number }>;
  minerals?: Array<{ id: string; pos: WorldPos; type?: string }>;
  controller: { pos: WorldPos; level: number; progress?: number };
  spawns: Array<{ id?: string; name: string; pos: WorldPos }>;
  extensions?: Array<{ id?: string; pos: WorldPos }>;
  containers?: Array<{ id?: string; pos: WorldPos; energy?: number; hits?: number }>;
  towers?: Array<{ id?: string; pos: WorldPos; energy?: number }>;
  storages?: Array<{ id?: string; pos: WorldPos; energy?: number }>;
  links?: Array<{ id?: string; pos: WorldPos; energy?: number }>;
  roads?: Array<{ pos: WorldPos }>;
  walls?: Array<{ pos: WorldPos; hits?: number }>;
  ramparts?: Array<{ pos: WorldPos; hits?: number }>;
  constructionSites?: Array<{ id?: string; pos: WorldPos; structureType: string; progress?: number; progressTotal?: number }>;
  /** 初始 creep 列表 */
  creeps?: Array<{
    name: string;
    role: string;
    pos: WorldPos;
    body: Array<{ type: string }>;
    energy?: number;
    ticksToLive?: number;
    memory?: Record<string, unknown>;
  }>;
  /** 敌方 creep */
  hostiles?: Array<{
    name: string;
    pos: WorldPos;
    body: Array<{ type: string }>;
    owner?: string;
  }>;
  /** 地上掉落的能量资源（测试 hauler 捡 drop vs 抽 container 优先级用） */
  droppedResources?: Array<{ pos: WorldPos; amount: number }>;
  /** 每 tick source 再生量（默认 10 = 3000/300） */
  sourceRegenPerTick?: number;
  /** 每 tick container 衰减 hits（默认 0 = 不衰减） */
  containerDecayPerTick?: number;
  /** CPU bucket（默认 10000 = 满载） */
  cpuBucket?: number;
  /** CPU limit（默认 20） */
  cpuLimit?: number;
  /** 预设房间 Memory 为 normal/steady 状态（防止 room-state 首 tick 计算 bootstrap 阻塞 P2 角色） */
  preseedRoomState?: boolean;
}

// ─── 内部实体类 ─────────────────────────────────────────────

let nextId = 1;
function genId(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

/**
 * 全局递增的 Game.time 基准 — 每个 TestWorld 实例分配唯一基准（100000 的倍数）。
 *
 * 根因：per-tick 缓存（objCache/structCache/pathShare/assignment 池/remoteThreats 等）
 * 以 Game.time 为 key。若每个 TestWorld 都从 Game.time=0 起，跨测试文件会撞值，
 * 后一个 TestWorld 在 installGlobals 前会读到前一个测试残留的缓存（如 tick=3 的
 * assignment 池），导致 creep 看到陈旧状态而"什么都不做"的跨测试污染。
 * 唯一基准让 per-tick 缓存永不撞值。_tick 仍从 0 计（相对 tick），tick getter 返回相对值，
 * 故依赖 w.tick 的测试断言（如 stopWhen w.tick>100）不受影响。
 */
let nextTickBase = 0;
function allocateTickBase(): number {
  nextTickBase += 100000;
  return nextTickBase;
}

/** 模拟 Store — 支持 getUsedCapacity/getFreeCapacity/getCapacity */
class MockStore {
  private _energy: number;
  readonly _capacity: number;

  constructor(energy: number, capacity: number) {
    this._energy = energy;
    this._capacity = capacity;
  }

  getUsedCapacity(_resource?: string): number {
    return this._energy;
  }
  getFreeCapacity(_resource?: string): number {
    return Math.max(0, this._capacity - this._energy);
  }
  getCapacity(_resource?: string): number {
    return this._capacity;
  }

  get energy(): number { return this._energy; }
  set energy(v: number) { this._energy = Math.max(0, Math.min(v, this._capacity)); }
}

/** 模拟 RoomPosition */
class MockRoomPosition {
  readonly x: number;
  readonly y: number;
  readonly roomName: string;
  private _world: TestWorld;

  constructor(x: number, y: number, roomName: string, world: TestWorld) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
    this._world = world;
  }

  getRangeTo(target: { pos?: MockRoomPosition } | MockRoomPosition | { x: number; y: number }): number {
    const t = "x" in target ? target : (target as { pos: MockRoomPosition }).pos;
    return Math.max(Math.abs(this.x - t.x), Math.abs(this.y - t.y));
  }

  getDirectionTo(target: { pos?: MockRoomPosition } | MockRoomPosition | { x: number; y: number }): number {
    const t = "x" in target ? target : (target as { pos: MockRoomPosition }).pos;
    const dx = Math.sign(t.x - this.x);
    const dy = Math.sign(t.y - this.y);
    // 方向映射：TOP=1, TOP_RIGHT=2, RIGHT=3, BOTTOM_RIGHT=4, BOTTOM=5, BOTTOM_LEFT=6, LEFT=7, TOP_LEFT=8
    const dirMap: Record<string, number> = {
      "0,-1": 1, "1,-1": 2, "1,0": 3, "1,1": 4,
      "0,1": 5, "-1,1": 6, "-1,0": 7, "-1,-1": 8,
    };
    return dirMap[`${dx},${dy}`] ?? 0;
  }

  findClosestByRange<T extends { pos: MockRoomPosition }>(targets: T[]): T | null {
    if (targets.length === 0) return null;
    let best: T | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const d = this.getRangeTo(t);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }

  isEqualTo(target: { x: number; y: number }): boolean {
    return this.x === target.x && this.y === target.y;
  }
}

/** 模拟 RoomTerrain */
class MockRoomTerrain {
  private _grid: number[][];

  constructor(grid: number[][]) {
    this._grid = grid;
  }

  get(x: number, y: number): number {
    if (x < 0 || x > 49 || y < 0 || y > 49) return 1; // wall
    return this._grid[y]?.[x] ?? 0;
  }
}

// ─── 结构体实体 ─────────────────────────────────────────────

interface MockStructureBase {
  id: string;
  structureType: string;
  pos: MockRoomPosition;
  hits: number;
  hitsMax: number;
  room: MockRoom;
  my?: boolean;
}

class MockSource {
  id: string;
  pos: MockRoomPosition;
  energy: number;
  energyCapacity: number;
  room: MockRoom;

  constructor(id: string, pos: MockRoomPosition, capacity: number, room: MockRoom) {
    this.id = id;
    this.pos = pos;
    this.energy = capacity;
    this.energyCapacity = capacity;
    this.room = room;
  }
}

class MockMineral {
  id: string;
  pos: MockRoomPosition;
  mineralType: string;
  mineralAmount: number;
  room: MockRoom;

  constructor(id: string, pos: MockRoomPosition, type: string, room: MockRoom) {
    this.id = id;
    this.pos = pos;
    this.mineralType = type;
    this.mineralAmount = 100000;
    this.room = room;
  }
}

/** 掉落的能量资源 — hauler pickupDroppedEnergy 的回收目标。 */
class MockDroppedResource {
  id: string;
  pos: MockRoomPosition;
  resourceType = "energy";
  amount: number;
  room: MockRoom;

  constructor(id: string, pos: MockRoomPosition, amount: number, room: MockRoom) {
    this.id = id;
    this.pos = pos;
    this.amount = amount;
    this.room = room;
  }
}

class MockController {
  id: string;
  structureType = "controller" as const;
  pos: MockRoomPosition;
  level: number;
  progress: number;
  progressTotal: number;
  my = true;
  ticksToDowngrade: number;
  safeMode: number | undefined = undefined;
  safeModeCooldown: number | undefined = undefined;
  safeModeAvailable = 0;
  room: MockRoom;

  constructor(pos: MockRoomPosition, level: number, progress: number, room: MockRoom) {
    this.id = genId("ctrl");
    this.pos = pos;
    this.level = level;
    this.progress = progress;
    this.progressTotal = RCL_PROGRESS[level] ?? 45000;
    this.ticksToDowngrade = 20000;
    this.room = room;
  }

  activateSafeMode(): number {
    if (this.safeModeAvailable <= 0) return -11; // ERR_TIRED
    this.safeModeAvailable--;
    this.safeMode = 20000;
    return 0;
  }
}

class MockSpawn implements MockStructureBase {
  id: string;
  structureType = "spawn" as const;
  pos: MockRoomPosition;
  hits = 5000;
  hitsMax = 5000;
  my = true;
  room: MockRoom;
  name: string;
  store: MockStore;
  spawning: { name: string; remainingTime: number } | null = null;

  private _world: TestWorld;

  constructor(id: string, name: string, pos: MockRoomPosition, room: MockRoom, world: TestWorld) {
    this.id = id;
    this.name = name;
    this.pos = pos;
    this.room = room;
    this._world = world;
    this.store = new MockStore(300, 300);
  }

  spawnCreep(body: string[], name: string, opts?: { memory?: Record<string, unknown> }): number {
    if (this.spawning) return -4; // ERR_BUSY
    const cost = body.reduce((sum, p) => sum + (PART_COST[p] ?? 0), 0);
    const available = this.room.energyAvailable;
    if (cost > available) return -6; // ERR_NOT_ENOUGH_ENERGY
    if (body.length > 50) return -10; // ERR_INVALID_ARGS

    // 扣除能量
    this.room._consumeEnergy(cost);
    this.spawning = { name, remainingTime: body.length * 3 };

    // 注册待孵化 creep
    this._world._pendingSpawns.push({
      name,
      body: body.map(t => ({ type: t })),
      memory: opts?.memory ?? {},
      spawnPos: { x: this.pos.x, y: this.pos.y },
      roomName: this.room.name,
    });
    return 0;
  }
}

class MockExtension implements MockStructureBase {
  id: string;
  structureType = "extension" as const;
  pos: MockRoomPosition;
  hits = 1000;
  hitsMax = 1000;
  my = true;
  room: MockRoom;
  store: MockStore;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom) {
    this.id = id;
    this.pos = pos;
    this.room = room;
    this.store = new MockStore(0, 50);
  }
}

class MockContainer implements MockStructureBase {
  id: string;
  structureType = "container" as const;
  pos: MockRoomPosition;
  hits: number;
  hitsMax = 250000;
  room: MockRoom;
  store: MockStore;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom, energy = 0, hits = 250000) {
    this.id = id;
    this.pos = pos;
    this.room = room;
    this.hits = hits;
    this.store = new MockStore(energy, 2000);
  }
}

class MockTower implements MockStructureBase {
  id: string;
  structureType = "tower" as const;
  pos: MockRoomPosition;
  hits = 3000;
  hitsMax = 3000;
  my = true;
  room: MockRoom;
  store: MockStore;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom, energy = 0) {
    this.id = id;
    this.pos = pos;
    this.room = room;
    this.store = new MockStore(energy, 1000);
  }

  attack(_target: unknown): number {
    if (this.store.getUsedCapacity() < 10) return -6;
    this.store.energy -= 10;
    return 0;
  }

  repair(target: MockStructureBase): number {
    if (this.store.getUsedCapacity() < 10) return -6;
    this.store.energy -= 10;
    target.hits = Math.min(target.hitsMax, target.hits + 200);
    return 0;
  }
}

class MockStorage implements MockStructureBase {
  id: string;
  structureType = "storage" as const;
  pos: MockRoomPosition;
  hits = 10000;
  hitsMax = 10000;
  my = true;
  room: MockRoom;
  store: MockStore;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom, energy = 0) {
    this.id = id;
    this.pos = pos;
    this.room = room;
    this.store = new MockStore(energy, 1000000);
  }
}

class MockLink implements MockStructureBase {
  id: string;
  structureType = "link" as const;
  pos: MockRoomPosition;
  hits = 1000;
  hitsMax = 1000;
  my = true;
  room: MockRoom;
  store: MockStore;
  cooldown = 0;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom, energy = 0) {
    this.id = id;
    this.pos = pos;
    this.room = room;
    this.store = new MockStore(energy, 800);
  }

  transferEnergy(target: MockLink, amount?: number): number {
    if (this.cooldown > 0) return -11; // ERR_TIRED
    const amt = amount ?? this.store.getUsedCapacity();
    if (amt <= 0) return -6;
    if (target.store.getFreeCapacity() < amt) return -8; // ERR_FULL
    this.store.energy -= amt;
    target.store.energy += amt;
    this.cooldown = 1;
    return 0;
  }
}

class MockRoad implements MockStructureBase {
  id: string;
  structureType = "road" as const;
  pos: MockRoomPosition;
  hits = 5000;
  hitsMax = 5000;
  room: MockRoom;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom) {
    this.id = id;
    this.pos = pos;
    this.room = room;
  }
}

class MockWall implements MockStructureBase {
  id: string;
  structureType = "constructedWall" as const;
  pos: MockRoomPosition;
  hits: number;
  hitsMax = 300000000;
  room: MockRoom;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom, hits = 1) {
    this.id = id;
    this.pos = pos;
    this.room = room;
    this.hits = hits;
  }
}

class MockRampart implements MockStructureBase {
  id: string;
  structureType = "rampart" as const;
  pos: MockRoomPosition;
  hits: number;
  hitsMax = 300000000;
  my = true;
  room: MockRoom;

  constructor(id: string, pos: MockRoomPosition, room: MockRoom, hits = 1) {
    this.id = id;
    this.pos = pos;
    this.room = room;
    this.hits = hits;
  }
}

class MockConstructionSite {
  id: string;
  structureType: string;
  pos: MockRoomPosition;
  progress: number;
  progressTotal: number;
  my = true;
  room: MockRoom;

  constructor(id: string, pos: MockRoomPosition, structureType: string, room: MockRoom, progress = 0) {
    this.id = id;
    this.pos = pos;
    this.structureType = structureType;
    this.room = room;
    this.progress = progress;
    this.progressTotal = BUILD_COST[structureType] ?? 100;
  }
}

class MockHostileCreep {
  id: string;
  name: string;
  pos: MockRoomPosition;
  body: Array<{ type: string }>;
  owner: { username: string };
  room: MockRoom;
  my = false;
  hits: number;
  hitsMax: number;

  constructor(name: string, pos: MockRoomPosition, body: Array<{ type: string }>, room: MockRoom, owner = "Enemy") {
    this.id = genId("hostile");
    this.name = name;
    this.pos = pos;
    this.body = body;
    this.room = room;
    this.owner = { username: owner };
    // 每个部件 100 血（引擎常量），供 tower 目标选择的有效血量评估使用。
    this.hitsMax = body.length * 100;
    this.hits = this.hitsMax;
  }
}

// ─── Creep 实体 ─────────────────────────────────────────────

class MockCreep {
  id: string;
  name: string;
  pos: MockRoomPosition;
  body: Array<{ type: string }>;
  memory: Record<string, unknown>;
  room: MockRoom;
  ticksToLive: number;
  store: MockStore;
  my = true;
  fatigue = 0;

  private _world: TestWorld;

  constructor(
    name: string,
    pos: MockRoomPosition,
    body: Array<{ type: string }>,
    room: MockRoom,
    world: TestWorld,
    energy = 0,
    ticksToLive = 1500,
    memory?: Record<string, unknown>,
  ) {
    this.id = genId("creep");
    this.name = name;
    this.pos = pos;
    this.body = body;
    this.room = room;
    this._world = world;
    const carryParts = body.filter(p => p.type === "carry").length;
    this.store = new MockStore(energy, carryParts * 50);
    this.ticksToLive = ticksToLive;
    this.memory = memory ?? {};
  }

  get carryCapacity(): number {
    return this.store.getCapacity();
  }

  // ─── 操作 ───

  harvest(source: MockSource): number {
    const workParts = this.body.filter(p => p.type === "work").length;
    if (workParts === 0) return -12; // ERR_NO_BODYPART
    if (this.pos.getRangeTo(source) > 1) return -9; // ERR_NOT_IN_RANGE
    const free = this.store.getFreeCapacity();
    if (free <= 0) return -8; // ERR_FULL
    const amount = Math.min(workParts * 2, source.energy, free);
    source.energy -= amount;
    this.store.energy += amount;
    this._world._stats.totalHarvested += amount;
    return 0;
  }

  withdraw(target: MockContainer | MockStorage | MockLink | MockSpawn | MockTower, _resource?: string, amount?: number): number {
    if (this.pos.getRangeTo(target) > 1) return -9;
    const available = target.store.getUsedCapacity();
    if (available <= 0) return -6;
    const free = this.store.getFreeCapacity();
    if (free <= 0) return -8;
    const amt = Math.min(amount ?? Infinity, available, free);
    target.store.energy -= amt;
    this.store.energy += amt;
    return 0;
  }

  transfer(target: MockSpawn | MockExtension | MockTower | MockStorage | MockContainer | MockLink | MockController, _resource?: string, amount?: number): number {
    if (this.pos.getRangeTo(target) > 1) return -9;
    const carried = this.store.getUsedCapacity();
    if (carried <= 0) return -6;
    const free = (target as { store: MockStore }).store.getFreeCapacity();
    if (free <= 0) return -8;
    const amt = Math.min(amount ?? Infinity, carried, free);
    this.store.energy -= amt;
    (target as { store: MockStore }).store.energy += amt;
    return 0;
  }

  drop(_resource?: string, amount?: number): number {
    const carried = this.store.getUsedCapacity();
    if (carried <= 0) return -6; // ERR_NOT_ENOUGH_RESOURCES
    const amt = Math.min(amount ?? carried, carried);
    this.store.energy -= amt;
    return 0;
  }

  pickup(resource: MockDroppedResource): number {
    if (this.pos.getRangeTo(resource.pos) > 1) return -9; // ERR_NOT_IN_RANGE
    const free = this.store.getFreeCapacity();
    if (free <= 0) return -8; // ERR_FULL
    const amt = Math.min(resource.amount, free);
    resource.amount -= amt;
    this.store.energy += amt;
    // 资源被捡空 → 从世界移除。
    if (resource.amount <= 0) {
      this._world._dropped = this._world._dropped.filter(d => d !== resource);
    }
    return 0;
  }

  build(site: MockConstructionSite): number {
    const workParts = this.body.filter(p => p.type === "work").length;
    if (workParts === 0) return -12;
    if (this.pos.getRangeTo(site) > 3) return -9;
    const carried = this.store.getUsedCapacity();
    if (carried <= 0) return -6;
    const buildPower = workParts * 5;
    const energyUsed = Math.min(buildPower, carried, site.progressTotal - site.progress);
    site.progress += energyUsed;
    this.store.energy -= energyUsed;
    this._world._stats.totalBuilt += energyUsed;

    // 建造完成 → 转化为结构
    if (site.progress >= site.progressTotal) {
      this._world._completeConstructionSite(site);
    }
    return 0;
  }

  repair(target: MockStructureBase): number {
    const workParts = this.body.filter(p => p.type === "work").length;
    if (workParts === 0) return -12;
    if (this.pos.getRangeTo(target) > 3) return -9;
    const carried = this.store.getUsedCapacity();
    if (carried <= 0) return -6;
    const repairPower = workParts * 100;
    const energyUsed = Math.min(workParts, carried);
    const hitsGained = Math.min(energyUsed * 100, target.hitsMax - target.hits);
    target.hits += hitsGained;
    this.store.energy -= energyUsed;
    return 0;
  }

  upgradeController(controller: MockController): number {
    const workParts = this.body.filter(p => p.type === "work").length;
    if (workParts === 0) return -12;
    if (this.pos.getRangeTo(controller) > 3) return -9;
    const carried = this.store.getUsedCapacity();
    if (carried <= 0) return -6;
    const upgradePower = Math.min(workParts, carried);
    controller.progress += upgradePower;
    this.store.energy -= upgradePower;
    this._world._stats.totalUpgraded += upgradePower;

    // RCL 升级
    if (controller.progress >= controller.progressTotal) {
      controller.level++;
      controller.progress = 0;
      controller.progressTotal = RCL_PROGRESS[controller.level] ?? 45000;
      this._world._onRclUp(controller);
    }
    return 0;
  }

  // ─── 移动 ───

  moveTo(target: MockRoomPosition | { pos: MockRoomPosition }, _opts?: unknown): number {
    const dest = "x" in target ? target : target.pos;
    return this._moveStep(dest);
  }

  move(direction: number): number {
    const deltas: Record<number, [number, number]> = {
      1: [0, -1], 2: [1, -1], 3: [1, 0], 4: [1, 1],
      5: [0, 1], 6: [-1, 1], 7: [-1, 0], 8: [-1, -1],
    };
    const d = deltas[direction];
    if (!d) return -10;
    const nx = this.pos.x + d[0];
    const ny = this.pos.y + d[1];
    if (nx < 0 || nx > 49 || ny < 0 || ny > 49) return -2;
    if (this._world._isWall(nx, ny, this.room.name)) return -2;
    this.pos = this.room._pos(nx, ny);
    return 0;
  }

  moveByPath(_path: unknown): number {
    return -11; // ERR_NOT_FOUND — 强制走 moveTo 路径
  }

  private _moveStep(dest: MockRoomPosition): number {
    const dx = Math.sign(dest.x - this.pos.x);
    const dy = Math.sign(dest.y - this.pos.y);
    if (dx === 0 && dy === 0) return 0;
    const nx = this.pos.x + dx;
    const ny = this.pos.y + dy;
    if (this._world._isWall(nx, ny, this.room.name)) {
      // 尝试绕行（简单贪心）
      const alt1x = this.pos.x + dx;
      const alt1y = this.pos.y;
      if (dx !== 0 && !this._world._isWall(alt1x, alt1y, this.room.name)) {
        this.pos = this.room._pos(alt1x, alt1y);
        return 0;
      }
      const alt2x = this.pos.x;
      const alt2y = this.pos.y + dy;
      if (dy !== 0 && !this._world._isWall(alt2x, alt2y, this.room.name)) {
        this.pos = this.room._pos(alt2x, alt2y);
        return 0;
      }
      return -2; // ERR_NO_PATH
    }
    this.pos = this.room._pos(nx, ny);
    return 0;
  }
}

// ─── Room 实体 ──────────────────────────────────────────────

class MockRoom {
  name: string;
  controller: MockController | null = null;
  storage: MockStorage | null = null;
  energyAvailable = 0;
  energyCapacityAvailable = 0;

  private _world: TestWorld;
  private _terrain: MockRoomTerrain;
  private _posCache = new Map<string, MockRoomPosition>();

  constructor(name: string, terrain: number[][], world: TestWorld) {
    this.name = name;
    this._world = world;
    this._terrain = new MockRoomTerrain(terrain);
  }

  _pos(x: number, y: number): MockRoomPosition {
    const key = `${x},${y}`;
    let p = this._posCache.get(key);
    if (!p) {
      p = new MockRoomPosition(x, y, this.name, this._world);
      this._posCache.set(key, p);
    }
    return p;
  }

  getTerrain(): MockRoomTerrain {
    return this._terrain;
  }

  _recalcEnergy(): void {
    let available = 0;
    let capacity = 0;
    for (const s of this._world._spawns) {
      if (s.room === this) {
        available += s.store.getUsedCapacity();
        capacity += s.store.getCapacity();
      }
    }
    for (const e of this._world._extensions) {
      if (e.room === this) {
        available += e.store.getUsedCapacity();
        capacity += e.store.getCapacity();
      }
    }
    this.energyAvailable = available;
    this.energyCapacityAvailable = capacity;
  }

  _consumeEnergy(amount: number): void {
    // 先扣 spawn，再扣 extension
    let remaining = amount;
    for (const s of this._world._spawns) {
      if (s.room !== this || remaining <= 0) continue;
      const take = Math.min(s.store.getUsedCapacity(), remaining);
      s.store.energy -= take;
      remaining -= take;
    }
    for (const e of this._world._extensions) {
      if (e.room !== this || remaining <= 0) continue;
      const take = Math.min(e.store.getUsedCapacity(), remaining);
      e.store.energy -= take;
      remaining -= take;
    }
    this._recalcEnergy();
  }

  find(type: number): unknown[] {
    const w = this._world;
    switch (type) {
      case FIND_SOURCES:
        return w._sources.filter(s => s.room === this);
      case FIND_MINERALS:
        return w._minerals.filter(m => m.room === this);
      case FIND_MY_STRUCTURES: {
        const structs: unknown[] = [];
        for (const s of w._spawns) if (s.room === this) structs.push(s);
        for (const e of w._extensions) if (e.room === this) structs.push(e);
        for (const c of w._containers) if (c.room === this) structs.push(c);
        for (const t of w._towers) if (t.room === this) structs.push(t);
        if (w._storage && w._storage.room === this) structs.push(w._storage);
        for (const l of w._links) if (l.room === this) structs.push(l);
        for (const r of w._roads) if (r.room === this) structs.push(r);
        for (const wall of w._walls) if (wall.room === this) structs.push(wall);
        for (const ramp of w._ramparts) if (ramp.room === this) structs.push(ramp);
        if (this.controller) structs.push(this.controller);
        return structs;
      }
      case FIND_STRUCTURES: {
        return this.find(FIND_MY_STRUCTURES);
      }
      case FIND_CONSTRUCTION_SITES:
      case FIND_MY_CONSTRUCTION_SITES:
        return w._sites.filter(s => s.room === this);
      case FIND_HOSTILE_CREEPS:
        return w._hostiles.filter(h => h.room === this);
      case FIND_DROPPED_RESOURCES:
        return w._dropped.filter(d => d.room === this);
      case FIND_EXIT: {
        const exits: MockRoomPosition[] = [];
        for (let i = 0; i < 50; i++) {
          exits.push(this._pos(i, 0), this._pos(i, 49), this._pos(0, i), this._pos(49, i));
        }
        return exits;
      }
      default:
        return [];
    }
  }

  createConstructionSite(x: number, y: number, structureType: string): number {
    // 检查是否已有 site
    for (const s of this._world._sites) {
      if (s.pos.x === x && s.pos.y === y) return -10; // ERR_INVALID_ARGS (已有)
    }
    const site = new MockConstructionSite(genId("site"), this._pos(x, y), structureType, this);
    this._world._sites.push(site);
    this._world._registerObject(site.id, site);
    return 0;
  }

  lookForAt(_type: string, x: number, y: number): unknown[] {
    // 返回该位置的 creep
    const creeps = this._world._creeps.filter(
      c => c.room === this && c.pos.x === x && c.pos.y === y,
    );
    return creeps;
  }

  findExitTo(_roomName: string): number {
    return 3; // RIGHT — 简化
  }

  getPositionAt(x: number, y: number): MockRoomPosition {
    return this._pos(x, y);
  }
}

// ─── 常量 ───────────────────────────────────────────────────

const RCL_PROGRESS: Record<number, number> = {
  1: 200, 2: 45000, 3: 135000, 4: 405000,
  5: 1215000, 6: 3645000, 7: 10935000,
};

const PART_COST: Record<string, number> = {
  move: 50, work: 100, carry: 50, attack: 80,
  ranged_attack: 150, heal: 250, claim: 600, tough: 10,
};

const BUILD_COST: Record<string, number> = {
  spawn: 30000, extension: 3000, road: 300, container: 5000,
  tower: 5000, storage: 30000, link: 5000, constructedWall: 1,
  rampart: 1, lab: 50000, terminal: 100000, factory: 100000,
};

// find 常量（与 setup.ts 一致）
const FIND_SOURCES = 1;
const FIND_MY_STRUCTURES = 6;
const FIND_STRUCTURES = 5;
const FIND_CONSTRUCTION_SITES = 7;
const FIND_MY_CONSTRUCTION_SITES = 11;
const FIND_HOSTILE_CREEPS = 4;
const FIND_MINERALS = 116;
const FIND_EXIT = 10;

// ─── 统计 ───────────────────────────────────────────────────

export interface WorldStats {
  totalHarvested: number;
  totalUpgraded: number;
  totalBuilt: number;
  totalSpawned: number;
  creepsDied: number;
  runtimeErrors: string[];
  tickLog: Array<{ tick: number; event: string }>;
}

// ─── TestWorld 主类 ─────────────────────────────────────────

export class TestWorld {
  readonly config: WorldConfig;
  readonly _stats: WorldStats = {
    totalHarvested: 0, totalUpgraded: 0, totalBuilt: 0,
    totalSpawned: 0, creepsDied: 0, runtimeErrors: [], tickLog: [],
  };

  // 实体集合
  _sources: MockSource[] = [];
  _minerals: MockMineral[] = [];
  _spawns: MockSpawn[] = [];
  _extensions: MockExtension[] = [];
  _containers: MockContainer[] = [];
  _towers: MockTower[] = [];
  _storage: MockStorage | null = null;
  _links: MockLink[] = [];
  _roads: MockRoad[] = [];
  _walls: MockWall[] = [];
  _ramparts: MockRampart[] = [];
  _sites: MockConstructionSite[] = [];
  _creeps: MockCreep[] = [];
  _hostiles: MockHostileCreep[] = [];
  _dropped: MockDroppedResource[] = [];
  _pendingSpawns: Array<{
    name: string;
    body: Array<{ type: string }>;
    memory: Record<string, unknown>;
    spawnPos: WorldPos;
    roomName: string;
  }> = [];

  private _room: MockRoom;
  private _objectRegistry = new Map<string, unknown>();
  private _tickBase = allocateTickBase();
  private _tick = 0;
  private _cpuUsed = 0;

  constructor(config: WorldConfig) {
    this.config = config;
    this._room = new MockRoom(config.roomName, config.terrain, this);
    this._buildWorld();
  }

  private _buildWorld(): void {
    const cfg = this.config;
    const room = this._room;

    // Sources
    for (const s of cfg.sources) {
      const source = new MockSource(s.id, room._pos(s.pos.x, s.pos.y), s.capacity ?? 3000, room);
      this._sources.push(source);
      this._registerObject(s.id, source);
    }

    // Minerals
    for (const m of cfg.minerals ?? []) {
      const mineral = new MockMineral(m.id, room._pos(m.pos.x, m.pos.y), m.type ?? "U", room);
      this._minerals.push(mineral);
      this._registerObject(m.id, mineral);
    }

    // Controller
    const ctrl = new MockController(
      room._pos(cfg.controller.pos.x, cfg.controller.pos.y),
      cfg.controller.level,
      cfg.controller.progress ?? 0,
      room,
    );
    room.controller = ctrl;
    this._registerObject(ctrl.id, ctrl);

    // Spawns
    for (const s of cfg.spawns) {
      const spawn = new MockSpawn(s.id ?? genId("spawn"), s.name, room._pos(s.pos.x, s.pos.y), room, this);
      this._spawns.push(spawn);
      this._registerObject(spawn.id, spawn);
    }

    // Extensions
    for (const e of cfg.extensions ?? []) {
      const ext = new MockExtension(e.id ?? genId("ext"), room._pos(e.pos.x, e.pos.y), room);
      this._extensions.push(ext);
      this._registerObject(ext.id, ext);
    }

    // Containers
    for (const c of cfg.containers ?? []) {
      const cont = new MockContainer(c.id ?? genId("cont"), room._pos(c.pos.x, c.pos.y), room, c.energy ?? 0, c.hits ?? 250000);
      this._containers.push(cont);
      this._registerObject(cont.id, cont);
    }

    // Towers
    for (const t of cfg.towers ?? []) {
      const tower = new MockTower(t.id ?? genId("tower"), room._pos(t.pos.x, t.pos.y), room, t.energy ?? 0);
      this._towers.push(tower);
      this._registerObject(tower.id, tower);
    }

    // Storage
    for (const s of cfg.storages ?? []) {
      const storage = new MockStorage(s.id ?? genId("storage"), room._pos(s.pos.x, s.pos.y), room, s.energy ?? 0);
      this._storage = storage;
      room.storage = storage;
      this._registerObject(storage.id, storage);
    }

    // Links
    for (const l of cfg.links ?? []) {
      const link = new MockLink(l.id ?? genId("link"), room._pos(l.pos.x, l.pos.y), room, l.energy ?? 0);
      this._links.push(link);
      this._registerObject(link.id, link);
    }

    // Roads
    for (const r of cfg.roads ?? []) {
      const road = new MockRoad(genId("road"), room._pos(r.pos.x, r.pos.y), room);
      this._roads.push(road);
      this._registerObject(road.id, road);
    }

    // Walls
    for (const w of cfg.walls ?? []) {
      const wall = new MockWall(genId("wall"), room._pos(w.pos.x, w.pos.y), room, w.hits ?? 1);
      this._walls.push(wall);
      this._registerObject(wall.id, wall);
    }

    // Ramparts
    for (const r of cfg.ramparts ?? []) {
      const ramp = new MockRampart(genId("rampart"), room._pos(r.pos.x, r.pos.y), room, r.hits ?? 1);
      this._ramparts.push(ramp);
      this._registerObject(ramp.id, ramp);
    }

    // Construction sites
    for (const s of cfg.constructionSites ?? []) {
      const site = new MockConstructionSite(s.id ?? genId("site"), room._pos(s.pos.x, s.pos.y), s.structureType, room, s.progress ?? 0);
      if (s.progressTotal) site.progressTotal = s.progressTotal;
      this._sites.push(site);
      this._registerObject(site.id, site);
    }

    // Creeps
    for (const c of cfg.creeps ?? []) {
      const creep = new MockCreep(
        c.name,
        room._pos(c.pos.x, c.pos.y),
        c.body,
        room,
        this,
        c.energy ?? 0,
        c.ticksToLive ?? 1500,
        c.memory ?? { role: c.role, home: cfg.roomName },
      );
      this._creeps.push(creep);
      this._registerObject(creep.id, creep);
    }

    // Hostiles
    for (const h of cfg.hostiles ?? []) {
      const hostile = new MockHostileCreep(h.name, room._pos(h.pos.x, h.pos.y), h.body, room, h.owner);
      this._hostiles.push(hostile);
      this._registerObject(hostile.id, hostile);
    }

    // Dropped resources
    for (const d of cfg.droppedResources ?? []) {
      const dropped = new MockDroppedResource(genId("dropped"), room._pos(d.pos.x, d.pos.y), d.amount, room);
      this._dropped.push(dropped);
      this._registerObject(dropped.id, dropped);
    }

    room._recalcEnergy();
  }

  _registerObject(id: string, obj: unknown): void {
    this._objectRegistry.set(id, obj);
  }

  _isWall(x: number, y: number, _roomName: string): boolean {
    if (x < 0 || x > 49 || y < 0 || y > 49) return true;
    return this.config.terrain[y]?.[x] === 1;
  }

  _completeConstructionSite(site: MockConstructionSite): void {
    // 移除 site
    this._sites = this._sites.filter(s => s !== site);

    // 创建对应结构
    const room = this._room;
    switch (site.structureType) {
      case "container": {
        const c = new MockContainer(genId("cont"), site.pos, room);
        this._containers.push(c);
        this._registerObject(c.id, c);
        break;
      }
      case "extension": {
        const e = new MockExtension(genId("ext"), site.pos, room);
        this._extensions.push(e);
        this._registerObject(e.id, e);
        room._recalcEnergy();
        break;
      }
      case "spawn": {
        const s = new MockSpawn(genId("spawn"), `Spawn_${this._spawns.length + 1}`, site.pos, room, this);
        this._spawns.push(s);
        this._registerObject(s.id, s);
        room._recalcEnergy();
        break;
      }
      case "tower": {
        const t = new MockTower(genId("tower"), site.pos, room);
        this._towers.push(t);
        this._registerObject(t.id, t);
        break;
      }
      case "storage": {
        const s = new MockStorage(genId("storage"), site.pos, room);
        this._storage = s;
        room.storage = s;
        this._registerObject(s.id, s);
        break;
      }
      case "link": {
        const l = new MockLink(genId("link"), site.pos, room);
        this._links.push(l);
        this._registerObject(l.id, l);
        break;
      }
      case "road": {
        const r = new MockRoad(genId("road"), site.pos, room);
        this._roads.push(r);
        this._registerObject(r.id, r);
        break;
      }
      case "rampart": {
        const r = new MockRampart(genId("rampart"), site.pos, room, 1);
        this._ramparts.push(r);
        this._registerObject(r.id, r);
        break;
      }
      case "constructedWall": {
        const w = new MockWall(genId("wall"), site.pos, room, 1);
        this._walls.push(w);
        this._registerObject(w.id, w);
        break;
      }
    }
    this._stats.tickLog.push({ tick: this._tick, event: `built:${site.structureType}@${site.pos.x},${site.pos.y}` });
  }

  _onRclUp(controller: MockController): void {
    this._stats.tickLog.push({ tick: this._tick, event: `rcl_up:${controller.level}` });
  }

  // ─── Tick 推进 ───

  /** 推进一个 tick 的物理模拟（在 AI 代码运行之前调用）。 */
  advancePhysics(): void {
    this._tick++;
    this._cpuUsed = 0;

    // Source 再生
    const regen = this.config.sourceRegenPerTick ?? 10;
    for (const s of this._sources) {
      s.energy = Math.min(s.energyCapacity, s.energy + regen);
    }

    // Container 衰减
    const decay = this.config.containerDecayPerTick ?? 0;
    if (decay > 0) {
      for (const c of this._containers) {
        c.hits -= decay;
        if (c.hits <= 0) {
          // Container 被毁
          this._containers = this._containers.filter(x => x !== c);
          this._stats.tickLog.push({ tick: this._tick, event: `container_destroyed:${c.id}` });
        }
      }
    }

    // 孵化倒计时
    for (const spawn of this._spawns) {
      if (spawn.spawning) {
        spawn.spawning.remainingTime--;
        if (spawn.spawning.remainingTime <= 0) {
          const pending = this._pendingSpawns.find(p => p.name === spawn.spawning!.name);
          spawn.spawning = null;
          if (pending) {
            this._pendingSpawns = this._pendingSpawns.filter(p => p !== pending);
            const creep = new MockCreep(
              pending.name,
              this._room._pos(pending.spawnPos.x, pending.spawnPos.y + 1),
              pending.body,
              this._room,
              this,
              0,
              1500,
              pending.memory,
            );
            this._creeps.push(creep);
            this._registerObject(creep.id, creep);
            this._stats.totalSpawned++;
            this._stats.tickLog.push({ tick: this._tick, event: `spawned:${pending.name}` });
          }
        }
      }
    }

    // Creep 老化
    const dead: MockCreep[] = [];
    for (const creep of this._creeps) {
      creep.ticksToLive--;
      if (creep.ticksToLive <= 0) {
        dead.push(creep);
      }
    }
    for (const d of dead) {
      this._creeps = this._creeps.filter(c => c !== d);
      this._stats.creepsDied++;
      this._stats.tickLog.push({ tick: this._tick, event: `died:${d.name}` });
    }

    // Link cooldown
    for (const link of this._links) {
      if (link.cooldown > 0) link.cooldown--;
    }

    // Controller downgrade
    if (this._room.controller) {
      this._room.controller.ticksToDowngrade--;
      if (this._room.controller.safeMode) {
        this._room.controller.safeMode--;
        if (this._room.controller.safeMode <= 0) {
          this._room.controller.safeMode = undefined;
        }
      }
    }

    // 重算能量
    this._room._recalcEnergy();
  }

  // ─── 安装全局对象 ───

  /** 将模拟的 Screeps 全局对象安装到 globalThis。 */
  installGlobals(): void {
    const world = this;
    const room = this._room;

    // Game 对象
    (globalThis as Record<string, unknown>).Game = {
      time: this._tickBase + this._tick,
      rooms: { [room.name]: room },
      creeps: this._buildCreepMap(),
      spawns: this._buildSpawnMap(),
      cpu: {
        limit: this.config.cpuLimit ?? 20,
        tickLimit: (this.config.cpuLimit ?? 20) + 500,
        bucket: this.config.cpuBucket ?? 10000,
        getUsed: () => world._cpuUsed,
        generatePixel: undefined, // 私服不存在
      },
      getObjectById: (id: string) => world._objectRegistry.get(id) ?? null,
      map: {
        describeExits: (_name: string) => ({ "1": null, "3": null, "5": null, "7": null }),
      },
    };

    // Memory — 每个新 TestWorld 强制重置，防止测试间状态泄漏。
    (globalThis as Record<string, unknown>).Memory = {
      creeps: {},
      rooms: {},
      kernel: {},
      schemaVersion: 4,
    };
    // 同步 creep memory
    const mem = (globalThis as Record<string, unknown>).Memory as Record<string, unknown>;
    const creepMem = (mem.creeps ?? {}) as Record<string, unknown>;
    for (const creep of this._creeps) {
      creepMem[creep.name] = creep.memory;
    }
    mem.creeps = creepMem;

    // 预设房间 Memory（可选）— 避免 room-state 首 tick 计算 "bootstrap" 阻塞 P2 角色。
    // 仅在 config.preseedRoomState 为 true 时启用，默认让 room-state 自然计算。
    const roomMem = (mem.rooms ?? {}) as Record<string, unknown>;
    if (this.config.preseedRoomState) {
      roomMem[this._room.name] = {
        colonyState: "normal",
        phase: "steady",
        spawnQueue: [],
        buildQueue: [],
        layout: { version: 1, state: "idle", revision: 1 },
        lastRcl: this._room.controller?.level ?? 1,
      };
    }
    mem.rooms = roomMem;

    // 清除 global cache（kernel 单例跨测试持久化，必须清理瞬态状态）。
    const g = globalThis as Record<string, unknown>;
    delete g.errorLog;
    delete g.errorCounts;
    delete g.pluginCooldowns;
    delete g.telemetry;
    delete g.snapshots;
    delete g.roomTraffic;
    delete g.prevRoomTraffic;
    delete g.skipBuffer;
    delete g.assignment;
    delete g.fillReservations;
    delete g.fillReservationTick;
    delete g.__parkRoomData;
    delete g.__parkReservations;
    delete g.__parkReservationsTick;
    // per-tick 移动/对象缓存（Game.time 跨测试文件可能撞值，必须清理防陈旧对象泄漏，
    // 与 role-helpers.resetGlobals 覆盖对齐）：
    delete g.__objCache;
    delete g.__objCacheTick;
    delete g.__structCache;
    delete g.__staticBlockersCache;
    delete g.__pathShare;
    delete g.__pathShareTick;
    delete g.__coreCenter;
    delete g.__creepPathCache;
    delete g.__yieldRequests;
    delete g.__remoteThreats;
    delete g.__remoteDropped;

    // RawMemory
    (globalThis as Record<string, unknown>).RawMemory = {
      segments: {},
      setActiveSegments: (_ids: number[]) => {},
    };

    // PathFinder
    (globalThis as Record<string, unknown>).PathFinder = {
      search: (origin: MockRoomPosition, goal: { pos: MockRoomPosition; range?: number }, _opts?: unknown) => {
        // 简单 A* 模拟：返回直线路径
        const path: MockRoomPosition[] = [];
        let cx = origin.x;
        let cy = origin.y;
        const tx = goal.pos.x;
        const ty = goal.pos.y;
        const range = goal.range ?? 1;
        let steps = 0;
        while (Math.max(Math.abs(cx - tx), Math.abs(cy - ty)) > range && steps < 100) {
          cx += Math.sign(tx - cx);
          cy += Math.sign(ty - cy);
          if (!world._isWall(cx, cy, room.name)) {
            path.push(room._pos(cx, cy));
          }
          steps++;
        }
        return { path, incomplete: false, cost: path.length * 2, ops: path.length };
      },
      CostMatrix: class {
        private _data = new Uint8Array(2500);
        set(x: number, y: number, cost: number) { this._data[y * 50 + x] = cost; }
        get(x: number, y: number) { return this._data[y * 50 + x]; }
        clone() { const m = new (this.constructor as new () => { _data: Uint8Array })(); m._data = new Uint8Array(this._data); return m; }
      },
    };

    // RoomPosition 构造器
    (globalThis as Record<string, unknown>).RoomPosition = class {
      x: number; y: number; roomName: string;
      constructor(x: number, y: number, roomName: string) {
        this.x = x; this.y = y; this.roomName = roomName;
      }
      getRangeTo(target: { x: number; y: number }) {
        return Math.max(Math.abs(this.x - target.x), Math.abs(this.y - target.y));
      }
    };
  }

  /** 每 tick 更新 Game 对象的可变状态。 */
  refreshGameGlobals(): void {
    const game = (globalThis as Record<string, unknown>).Game as Record<string, unknown>;
    game.time = this._tickBase + this._tick;
    game.creeps = this._buildCreepMap();
    game.spawns = this._buildSpawnMap();
    game.rooms = { [this._room.name]: this._room };
  }

  private _buildCreepMap(): Record<string, MockCreep> {
    const map: Record<string, MockCreep> = {};
    for (const c of this._creeps) map[c.name] = c;
    return map;
  }

  private _buildSpawnMap(): Record<string, MockSpawn> {
    const map: Record<string, MockSpawn> = {};
    for (const s of this._spawns) map[s.name] = s;
    return map;
  }

  // ─── 查询 API ───

  get tick(): number { return this._tick; }
  get room(): MockRoom { return this._room; }
  get creeps(): MockCreep[] { return this._creeps; }
  get spawns(): MockSpawn[] { return this._spawns; }
  get containers(): MockContainer[] { return this._containers; }
  get sources(): MockSource[] { return this._sources; }
  get sites(): MockConstructionSite[] { return this._sites; }
  get extensions(): MockExtension[] { return this._extensions; }
  get towers(): MockTower[] { return this._towers; }
  get links(): MockLink[] { return this._links; }
  get storage(): MockStorage | null { return this._storage; }
  get hostiles(): MockHostileCreep[] { return this._hostiles; }
  get droppedResources(): MockDroppedResource[] { return this._dropped; }
  get controller(): MockController | null { return this._room.controller; }

  creepsByRole(role: string): MockCreep[] {
    return this._creeps.filter(c => c.memory.role === role);
  }

  totalEnergy(): number {
    let total = 0;
    for (const s of this._spawns) total += s.store.getUsedCapacity();
    for (const e of this._extensions) total += e.store.getUsedCapacity();
    for (const c of this._containers) total += c.store.getUsedCapacity();
    for (const t of this._towers) total += t.store.getUsedCapacity();
    if (this._storage) total += this._storage.store.getUsedCapacity();
    for (const l of this._links) total += l.store.getUsedCapacity();
    for (const c of this._creeps) total += c.store.getUsedCapacity();
    return total;
  }

  /** 注入敌方 creep（用于防御测试）。 */
  addHostile(name: string, pos: WorldPos, body: Array<{ type: string }> = [{ type: "attack" }]): void {
    const hostile = new MockHostileCreep(name, this._room._pos(pos.x, pos.y), body, this._room);
    this._hostiles.push(hostile);
    this._registerObject(hostile.id, hostile);
  }

  /** 注入我方 creep（用于预设人口）。 */
  addCreep(
    name: string,
    role: string,
    x: number,
    y: number,
    body: Array<{ type: string }>,
    memoryOverrides?: Record<string, unknown>,
  ): void {
    const memory = { role, home: this._room.name, ...memoryOverrides };
    const creep = new MockCreep(name, this._room._pos(x, y), body, this._room, this, 0, 1500, memory);
    this._creeps.push(creep);
    this._registerObject(creep.id, creep);
  }

  /** 注入 tower（用于多 tower 防御测试）。 */
  addTower(x: number, y: number, energy = 0): void {
    const tower = new MockTower(genId("tower"), this._room._pos(x, y), this._room, energy);
    this._towers.push(tower);
    this._registerObject(tower.id, tower);
  }

  /** 移除敌方 creep。 */
  removeHostile(name: string): void {
    this._hostiles = this._hostiles.filter(h => h.name !== name);
  }

  /** 杀死指定 creep（模拟意外死亡）。 */
  killCreep(name: string): void {
    const creep = this._creeps.find(c => c.name === name);
    if (creep) {
      this._creeps = this._creeps.filter(c => c !== creep);
      this._stats.creepsDied++;
      this._stats.tickLog.push({ tick: this._tick, event: `killed:${name}` });
    }
  }

  /** 摧毁指定 container。 */
  destroyContainer(id: string): void {
    this._containers = this._containers.filter(c => c.id !== id);
    this._stats.tickLog.push({ tick: this._tick, event: `container_destroyed:${id}` });
  }

  /** 设置 source 能量（模拟枯竭）。 */
  setSourceEnergy(id: string, energy: number): void {
    const source = this._sources.find(s => s.id === id);
    if (source) source.energy = energy;
  }

  /** 获取完整快照用于断言。 */
  snapshot(): {
    tick: number;
    rcl: number;
    progress: number;
    progressTotal: number;
    energyAvailable: number;
    energyCapacityAvailable: number;
    totalEnergy: number;
    creeps: Record<string, number>;
    containers: number;
    extensions: number;
    sites: number;
    stats: WorldStats;
  } {
    const byRole: Record<string, number> = {};
    for (const c of this._creeps) {
      const role = (c.memory.role as string) ?? "unknown";
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    return {
      tick: this._tick,
      rcl: this._room.controller?.level ?? 0,
      progress: this._room.controller?.progress ?? 0,
      progressTotal: this._room.controller?.progressTotal ?? 0,
      energyAvailable: this._room.energyAvailable,
      energyCapacityAvailable: this._room.energyCapacityAvailable,
      totalEnergy: this.totalEnergy(),
      creeps: byRole,
      containers: this._containers.length,
      extensions: this._extensions.length,
      sites: this._sites.length,
      stats: { ...this._stats },
    };
  }
}

// ─── 地形工具 ───────────────────────────────────────────────

/** 生成全平地地形。 */
export function flatTerrain(): number[][] {
  return Array.from({ length: 50 }, () => Array(50).fill(0));
}

/** 生成带墙壁的地形。 */
export function terrainWithWalls(walls: WorldPos[]): number[][] {
  const grid = flatTerrain();
  for (const w of walls) {
    if (w.x >= 0 && w.x < 50 && w.y >= 0 && w.y < 50) {
      grid[w.y]![w.x] = 1;
    }
  }
  return grid;
}

/** 生成带沼泽的地形。 */
export function terrainWithSwamps(swamps: WorldPos[]): number[][] {
  const grid = flatTerrain();
  for (const s of swamps) {
    if (s.x >= 0 && s.x < 50 && s.y >= 0 && s.y < 50) {
      grid[s.y]![s.x] = 2;
    }
  }
  return grid;
}
