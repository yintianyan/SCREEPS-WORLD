/** ScenarioRunner — E2E 场景运行器。 */
import { ServerHarness } from "./ServerHarness";
import { BotHarness } from "./BotHarness";
import { WorldBuilder, type RoomSetup } from "./WorldBuilder";
import { SnapshotInspector, type BotSnapshot } from "./SnapshotInspector";

export interface ScenarioOptions {
  /** bot 用户名（默认 "bot"） */
  botUsername?: string;
  /** bot 初始房间名 */
  roomName: string;
  /** spawn 位置（默认 25,25） */
  spawnPos?: { x: number; y: number };
  /** 房间列表（WorldBuilder 用） */
  rooms: RoomSetup[];
  /** 最大 tick 数（防死循环，默认 2000） */
  maxTicks?: number;
  /** 是否使用 stubWorld（默认 false，精细控制） */
  stubWorld?: boolean;
  /**
   * 强制设置 controller RCL（在 addBot 之后应用）。

   * [Facts] mockup 的 world.addBot() 会强制把 controller 重置为
   * level=1, progress=0（world.js:216）。fixture 中预设的 controller
   * level 会被覆盖。此选项在 bot 注册后、server 启动前通过 DB 直
   * 接修正，绕过 addBot 的重置行为。

   * runtime 中 controller.level 是 getter-only 属性，通过 sendConsole
   * 赋值无效（严格模式抛 TypeError，非严格模式静默失败），只能用 DB
   * 更新。
   */
  controllerLevel?: number;
  /**
   * bot CPU 上限（mockup 默认 100）。低 CPU soak 设为低于实际用量（如 2–4）
   * 以触发 bucket 消耗与四档 tier 降级链（CANARY §5.3）。
   */
  cpuLimit?: number;
  /** bot bucket 容量（mockup 默认 10000）。 */
  cpuBucket?: number;
  /**
   * 额外自有房：预置 controller 归属 bot（user = bot id）+ 等级 + 房间激活。
   * 多房 soak 用——第二房的 spawn 由夹具提供（addBot 只建主房 spawn）。
   */
  ownedRooms?: { name: string; level: number }[];
}

/**
 * 谓词函数：根据快照判断是否满足终止条件。
 * 返回 true 提前终止 tick 循环。
 */
export type TickPredicate = (snapshot: BotSnapshot, tick: number) => boolean;

/**
 * 场景运行器。

 * 使用模式：
 * ```typescript
 * const runner = new ScenarioRunner();
 * await runner.setup({
 *   roomName: "W0N1",
 *   rooms: [standardRoom("W0N1")],
 * });
 * const snapshots = await runner.runUntil(
 *   (snap) => snap.totalCreeps > 0,
 *   500,
 * );
 * expect(snapshots.at(-1)!.totalCreeps).toBeGreaterThan(0);
 * await runner.teardown();
 * ```
 */
export class ScenarioRunner {
  private _server: ServerHarness | null = null;
  private _bot: BotHarness | null = null;
  private _inspector: SnapshotInspector | null = null;
  private _worldBuilder: WorldBuilder | null = null;

  /**
   * 初始化场景：创建 server，构建世界，注册 bot。
   */
  async setup(opts: ScenarioOptions): Promise<void> {
    this._server = new ServerHarness();
    await this._server.reset(opts.stubWorld ?? false);

    // 【Phase3A 修复】双 spawn 去重：mockup 的 addBot() 会自动在目标房创建一个
    // store 制式 spawn；若夹具再放一个 legacy 制式（energy 字段）spawn，两者能量
    // 计费口径分裂 —— transfer 只写 store、引擎容量检查读 legacy → 孵化容量恒 0，
    
    // 因此 bot 所在房间的夹具 spawn 一律移除，由 addBot 统一提供。
    const roomsForWorld = opts.rooms.map((r) => ({
      ...r,
      objects: (r.objects ?? []).filter(
        (o) => !(o.type === "spawn" && r.name === opts.roomName),
      ),
    }));

    this._worldBuilder = new WorldBuilder(this._server.server.world);
    await this._worldBuilder.addRooms(roomsForWorld);

    const spawnPos = opts.spawnPos ?? { x: 25, y: 25 };
    this._bot = new BotHarness(
      opts.botUsername ?? "bot",
      opts.roomName,
      spawnPos,
      { cpu: opts.cpuLimit, cpuBucket: opts.cpuBucket },
    );
    await this._bot.registerTo(this._server.server);

    // addBot 会把 controller 重置为 level=1；如有 controllerLevel 选项，
    // 在 server 启动前通过 DB 直接修正。
    const { db } = this._server.server.common.storage;
    if (opts.controllerLevel !== undefined) {
      await db["rooms.objects"].update(
        { room: opts.roomName, type: "controller" },
        { $set: { level: opts.controllerLevel, progress: 0, downgradeTime: null } },
      );
    }
    // 额外自有房：完整复刻 addBot 的房间初始化——controller 归属 + ACTIVE_ROOMS
    // 注册 + store 制式 spawn（引擎只认 store 形态；legacy energy 形态计费分裂）。
    if (opts.ownedRooms) {
      const { env } = await (this._server.server as any).world.load();
      const [user] = await db.users.find({ username: opts.botUsername ?? "bot" });
      for (const r of opts.ownedRooms) {
        await env.sadd(env.keys.ACTIVE_ROOMS, r.name);
        await db.rooms.update({ _id: r.name }, { $set: { active: true } });
        await db["rooms.objects"].update(
          { room: r.name, type: "controller" },
          { $set: { user: user._id, level: r.level, progress: 0, downgradeTime: null } },
        );
        await db["rooms.objects"].insert({
          room: r.name, type: "spawn", x: 25, y: 25, user: user._id,
          name: `Spawn2_${r.name}`, store: { energy: 300 },
          storeCapacityResource: { energy: 300 }, hits: 5000, hitsMax: 5000,
          spawning: null, notifyWhenAttacked: true,
        });
      }
    }

    await this._server.start();
    this._inspector = new SnapshotInspector(this._bot);
  }

  /**
   * 推进一个 tick 并返回快照。
   */
  async tick(): Promise<BotSnapshot> {
    if (!this._server || !this._inspector) {
      throw new Error("ScenarioRunner.tick() called before setup()");
    }
    await this._server.tick();
    // 【Phase3A 环境垫片】screeps-server-mockup/driver 分裂脑缺陷：creep transfer 意图
    // 只写 spawn.store，而引擎的 room.energyAvailable / spawnCreep 容量检查读 legacy
    // .energy 字段 —— 后者从不被 transfer 更新，导致孵化容量恒 0、经济死亡螺旋。
    // 官方服务器无此问题（两处由引擎同步）。此处将 legacy 对齐到 store 真值。
    await this.syncSpawnEnergyLegacy();
    const tick = await this._server.gameTime;
    return this._inspector.snapshot(tick);
  }

  /**
   * 【环境垫片】把 W0N1 spawn 的 legacy energy 字段对齐到 store.energy。
   * 仅测试基础设施使用；生产代码不得依赖。
   */
  private async syncSpawnEnergyLegacy(): Promise<void> {
    try {
      const world = (this._server as any).server.world;
      const objs = await world.roomObjects(this._bot?.roomName ?? "W0N1");
      for (const o of objs) {
        if (o.type === "spawn" && o.store && typeof o.store.energy === "number" && o.energy !== o.store.energy) {
          o.energy = o.store.energy;
        }
      }
    } catch {
      // 垫片失败不阻塞 tick（仅影响孵化容量判定的真实性）
    }
  }

  /**
   * 运行直到谓词满足或达到 maxTicks。
   * @param predicate 终止条件
   * @param maxTicks 最大 tick 数（默认 2000）
   * @returns 快照序列（含最后一个满足条件的快照）
   */
  async runUntil(
    predicate: TickPredicate,
    maxTicks = 2000,
  ): Promise<BotSnapshot[]> {
    const snapshots: BotSnapshot[] = [];
    const limit = Math.min(maxTicks, 5000); // 硬上限保护

    for (let i = 0; i < limit; i++) {
      const snap = await this.tick();
      snapshots.push(snap);

      if (predicate(snap, snap.tick)) {
        return snapshots;
      }
    }

    return snapshots;
  }

  /**
   * 运行固定 tick 数。
   */
  async runTicks(count: number): Promise<BotSnapshot[]> {
    return this.runUntil(() => false, count);
  }

  /**
   * 获取 bot 句柄（用于高级操作）。
   */
  get bot(): BotHarness {
    if (!this._bot) throw new Error("bot not initialized");
    return this._bot;
  }

  /**
   * 直接更新 bot 用户的引擎 CPU 账户（cpu = 每 tick 上限，cpuAvailable = bucket）。
   * 低 CPU soak 用它做确定性档位注入：driver 每 tick 从 db 重读用户账户，
   * 净收支 = cpu − 实际用量；cpu≈实际用量时注入的 bucket 稳定保持。
   */
  /** 敌对玩家房预置：创建敌对用户并占有指定房间的 controller（war 目标场景）。 */
  async addEnemyOwnedRoom(roomName: string, username = "Enemy", level = 1): Promise<void> {
    if (!this._server) throw new Error("setup() not called");
    const { db, env } = await (this._server.server as any).world.load();
    let [user] = await db.users.find({ username });
    if (!user) {
      user = await db.users.insert({ username, cpu: 100, cpuAvailable: 10000, gcl: 1, active: 10000, badge: "enemy" });
    }
    await env.sadd(env.keys.ACTIVE_ROOMS, roomName);
    await db.rooms.update({ _id: roomName }, { $set: { active: true } });
    await db["rooms.objects"].update(
      { room: roomName, type: "controller" },
      { $set: { user: user._id, level, progress: 0, downgradeTime: null } },
    );
  }

  /** GCL 注入：设置 bot 用户的 GCL 等级（扩张 claim 的余量门使用）。 */
  async setUserGcl(level: number): Promise<void> {
    if (!this._server) throw new Error("setup() not called");
    const { db } = this._server.server.common.storage;
    const username = "bot";
    await db.users.update({ username }, { $set: { gcl: level === 1 ? 1 : 1000000 * (level - 1) + 1 } });
  }

  /** 故障注入：移除指定房间的全部 creep（引擎侧删除，下一 tick 从 Game.creeps 消失）。 */
  async removeCreeps(roomName: string): Promise<void> {
    if (!this._server) throw new Error("setup() not called");
    const { db } = this._server.server.common.storage;
    await db["rooms.objects"].removeWhere({ type: "creep", room: roomName });
  }

  async setUserCpu(opts: { cpu?: number; cpuAvailable?: number }): Promise<void> {
    if (!this._server || !this._bot) throw new Error("setup() not called");
    const { db } = this._server.server.common.storage;
    const $set: Record<string, number> = {};
    if (opts.cpu !== undefined) $set.cpu = opts.cpu;
    if (opts.cpuAvailable !== undefined) $set.cpuAvailable = opts.cpuAvailable;
    await db.users.update({ username: this._bot.username }, { $set });
  }

  /**
   * 获取 server 句柄（用于高级操作，如注入 hostile creep）。

   * 使用场景：
   *   - 在 setup() 之后、tick 之前注入 hostile creep 测试 tower 防御
   *   - 在运行中动态修改世界状态

   * 注意：直接操作 server.world 是高级用法，可能破坏场景隔离。
   * 优先使用 WorldBuilder 的高层 API。
   */
  get server(): ServerHarness {
    if (!this._server) throw new Error("server not initialized");
    return this._server;
  }

  /**
   * 获取 WorldBuilder（用于在 setup 后注入对象，如 hostile creep）。
   */
  get worldBuilder(): WorldBuilder {
    if (!this._worldBuilder) throw new Error("worldBuilder not initialized");
    return this._worldBuilder;
  }

  /**
   * 获取 inspector（用于自定义快照查询）。
   */
  get inspector(): SnapshotInspector {
    if (!this._inspector) throw new Error("inspector not initialized");
    return this._inspector;
  }

  /**
   * 清理资源。必须在 afterAll 中调用。
   */
  async teardown(): Promise<void> {
    if (this._server) {
      this._server.dispose();
      this._server = null;
    }
    this._bot = null;
    this._inspector = null;
    this._worldBuilder = null;
  }
}
