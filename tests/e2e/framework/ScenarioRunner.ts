/**
 * ScenarioRunner — E2E 场景运行器。
 *
 * 职责：
 *   - 封装 server + bot 的一体化生命周期
 *   - 提供 tick 循环 + 谓词终止条件
 *   - 收集快照序列用于断言
 *
 * 设计原则：
 *   - 每个场景独立 ServerHarness 实例，避免状态污染
 *   - 谓词驱动终止：满足条件提前退出，不固定跑 N tick
 *   - 超时保护：最长 tick 数上限，防止死循环
 */
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
}

/**
 * 谓词函数：根据快照判断是否满足终止条件。
 * 返回 true 提前终止 tick 循环。
 */
export type TickPredicate = (snapshot: BotSnapshot, tick: number) => boolean;

/**
 * 场景运行器。
 *
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

    this._worldBuilder = new WorldBuilder(this._server.server.world);
    await this._worldBuilder.addRooms(opts.rooms);

    const spawnPos = opts.spawnPos ?? { x: 25, y: 25 };
    this._bot = new BotHarness(
      opts.botUsername ?? "bot",
      opts.roomName,
      spawnPos,
    );
    await this._bot.registerTo(this._server.server);

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
    const tick = await this._server.gameTime;
    return this._inspector.snapshot(tick);
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
   * 获取 server 句柄（用于高级操作，如注入 hostile creep）。
   *
   * 使用场景：
   *   - 在 setup() 之后、tick 之前注入 hostile creep 测试 tower 防御
   *   - 在运行中动态修改世界状态
   *
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
