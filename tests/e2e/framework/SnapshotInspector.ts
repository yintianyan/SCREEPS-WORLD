/** SnapshotInspector — 从 bot.memory 和 Game API 提取可断言的状态快照。 */
import type { BotHarness } from "./BotHarness";
import { C } from "../../support/constants";

/**
 * 运行时指标快照 — 从 Memory.kernel.stats 提取的关键遥测数据。
 * 用于 E2E 验收：CPU/bucket/skip/error/Memory 体积/spawn/RCL 等。
 */
export interface RuntimeMetrics {
  /** CPU 档位（healthy/guarded/conserve/recovery）。 */
  tier: string | undefined;
  /** 最近 10 个采样点 CPU 均值。 */
  cpuAvg10: number | undefined;
  /** 最近 10 个采样点 CPU 峰值。 */
  cpuMax10: number | undefined;
  /** 最近 10 个采样点 bucket 最低值。 */
  bucketMin10: number | undefined;
  /** 危机计数（tier 降级次数）。 */
  crisisCount: number | undefined;
  /** tier 转换次数。 */
  tierTransitions: number | undefined;
  /** 错误热点（最频繁报错的 label）。 */
  errorHotspot: string | undefined;
  /** 跳过热点（最频繁跳过的 reason）。 */
  skipHotspot: string | undefined;
  /** 最近一次错误现场快照（label/msg/tick）。 */
  lastError: { label: string; msg: string; tick: number } | undefined;
  /** 最近一次采样 tick。 */
  lastSample: number | undefined;
  /** Memory 序列化大小（字节，估算）。 */
  memorySize: number;
  /** Skip reason 计数表（从 Memory.kernel.skipReasons 读取）。 */
  skipReasons: Record<string, number> | undefined;
}

/**
 * Bot 状态快照。从 Memory 和 console 日志推导。
 */
export interface BotSnapshot {
  /** 游戏 tick（从 Memory.kernel.lastTick 或类似字段读取，fallback 到 server.gameTime） */
  tick: number;
  /** 按 role 分组的 creep 数量。从 Memory.creeps 推导。 */
  creepCountByRole: Record<string, number>;
  /** 总 creep 数量。 */
  totalCreeps: number;
  /** 原始 Memory 对象，用于自定义断言。 */
  rawMemory: any;
  /** 从上次快照以来的 console 日志。 */
  consoleLogs: string[];
  /** 从上次快照以来的通知。 */
  notifications: Array<{ message: string; date: number }>;
  /** 运行时指标（从 Memory.kernel.stats 提取）。 */
  metrics: RuntimeMetrics;
  /** 各房间的 colonyState。 */
  colonyStates: Record<string, string>;
  /** 各房间的 spawn queue 长度。 */
  spawnQueues: Record<string, number>;
  /** 各房间的 RCL。 */
  rclByRoom: Record<string, number>;
}

/** STRUCTURE_* 常量值集合（SSOT）—— driver DB 对象的 type 判别用。 */
const STRUCTURE_TYPE_VALUES = new Set(
  Object.entries(C)
    .filter(([k]) => k.startsWith("STRUCTURE_"))
    .map(([, v]) => v as string),
);

/**
 * 状态检查器。封装从 bot 提取状态的逻辑。
 */
export class SnapshotInspector {
  private _bot: BotHarness;
  private _lastTick: number = 0;

  constructor(bot: BotHarness) {
    this._bot = bot;
  }

  /**
   * 拍摄当前状态快照。
   * @param currentTick 当前游戏 tick（由 caller 从 server.gameTime 传入）
   */
  async snapshot(currentTick: number): Promise<BotSnapshot> {
    const mem = await this._bot.getMemory();

    // 从 Memory.creeps 推导 role 分布
    const creepCountByRole: Record<string, number> = {};
    let totalCreeps = 0;
    if (mem.creeps && typeof mem.creeps === "object") {
      for (const [creepName, creepMem] of Object.entries(mem.creeps)) {
        const role = (creepMem as any)?.role ?? "unknown";
        creepCountByRole[role] = (creepCountByRole[role] ?? 0) + 1;
        totalCreeps++;
      }
    }

    const metrics = this.extractMetrics(mem);
    const colonyStates = this.extractColonyStates(mem);
    const spawnQueues = this.extractSpawnQueues(mem);
    const rclByRoom = this.extractRCL(mem);

    return {
      tick: currentTick,
      creepCountByRole,
      totalCreeps,
      rawMemory: mem,
      consoleLogs: this._bot.drainConsole(),
      notifications: this._bot.drainNotifications(),
      metrics,
      colonyStates,
      spawnQueues,
      rclByRoom,
    };
  }

  /**
   * 从 Memory 提取运行时指标。
   */
  private extractMetrics(mem: any): RuntimeMetrics {
    const kernel = mem?.kernel ?? {};
    const stats = kernel?.stats ?? {};

    return {
      tier: kernel?.tier,
      cpuAvg10: stats?.cpuAvg10,
      cpuMax10: stats?.cpuMax10,
      bucketMin10: stats?.bucketMin10,
      crisisCount: stats?.crisisCount,
      tierTransitions: stats?.tierTransitions,
      errorHotspot: stats?.errorHotspot,
      skipHotspot: stats?.skipHotspot,
      lastError: stats?.lastError,
      lastSample: stats?.lastSample,
      memorySize: JSON.stringify(mem).length,
      skipReasons: kernel?.skipReasons,
    };
  }

  /**
   * 从 Memory 提取各房间的 colonyState。
   */
  private extractColonyStates(mem: any): Record<string, string> {
    const result: Record<string, string> = {};
    const rooms = mem?.rooms ?? {};
    for (const [roomName, roomMem] of Object.entries(rooms)) {
      const state = (roomMem as any)?.colonyState;
      if (typeof state === "string") result[roomName] = state;
    }
    return result;
  }

  /**
   * 从 Memory 提取各房间的 spawn queue 长度。
   */
  private extractSpawnQueues(mem: any): Record<string, number> {
    const result: Record<string, number> = {};
    const rooms = mem?.rooms ?? {};
    for (const [roomName, roomMem] of Object.entries(rooms)) {
      const queue = (roomMem as any)?.spawnQueue;
      if (Array.isArray(queue)) result[roomName] = queue.length;
    }
    return result;
  }

  /**
   * 从 Memory 提取各房间的 RCL。
   */
  private extractRCL(mem: any): Record<string, number> {
    const result: Record<string, number> = {};
    const rooms = mem?.rooms ?? {};
    for (const [roomName, roomMem] of Object.entries(rooms)) {
      const rcl = (roomMem as any)?.rcl;
      if (typeof rcl === "number") result[roomName] = rcl;
    }
    return result;
  }

  // getStorageEnergy / getControllerLevel / hasRole / hasErrorLogs /
  // hasRuntimeError / findLogs 已删除（R20⑤：审计确认场景零调用；
  // 结构/进度真值查询见下方 structureCensus / controllerProgress）。

  // ── 引擎真值查询（world.roomObjects，FREEZE R20①/T3）──────────────
  // 以下方法替代场景内联的 CENSUS console 探针：结构计数/role body 直方图/
  // controller 进度从 driver DB 读取，不再需要 bot 侧 console 字符串拼装与解析。

  private world(): any {
    // this._bot 是 BotHarness；mockup User 在其内层 _bot 字段，User._server 才是
    // ScreepsServer（world.js addBot: new User(this.server, user)）。
    const world = (this._bot as any)?._bot?._server?.world;
    if (!world) throw new Error("SnapshotInspector: bot 未注册到 server（registerTo 未调用）");
    return world;
  }

  /**
   * 结构普查（structureType → 数量）。
   * [Facts] world.roomObjects 返回 driver DB 原始对象——只有 `type` 字段，
   * 无 structureType（那是运行时视图字段，原 bot 侧探针经游戏内 getter 才有）。
   * 故按 type ∈ STRUCTURE_* 值集合判别，与 FIND_STRUCTURES 语义一致
   * （constructionSite/ruin/creep/资源不计数）。
   */
  async structureCensus(roomName?: string): Promise<Record<string, number>> {
    const objs = await this.world().roomObjects(roomName ?? this._bot.roomName);
    const census: Record<string, number> = {};
    for (const o of objs as any[]) {
      if (typeof o.type !== "string" || !STRUCTURE_TYPE_VALUES.has(o.type)) continue;
      census[o.type] = (census[o.type] ?? 0) + 1;
    }
    return census;
  }

  /**
   * 指定角色 creep 的 body 部件数列表（升序）。
   * 如 upW 证据 = roleBodyPartHistogram(room, "upgrader", "work")。
   */
  async roleBodyPartHistogram(
    roomName: string | undefined,
    role: string,
    part: string,
  ): Promise<number[]> {
    const objs = await this.world().roomObjects(roomName ?? this._bot.roomName);
    return (objs as any[])
      .filter((o) => o.type === "creep" && o.memory?.role === role)
      .map((o) => (o.body ?? []).filter((p: any) => p.type === part).length)
      .sort((a, b) => a - b);
  }

  /** 能量储量真值（storage/terminal/container 逐结构 store.energy 求和）。 */
  async energyReserves(roomName?: string): Promise<Record<string, number>> {
    const objs = await this.world().roomObjects(roomName ?? this._bot.roomName);
    const out: Record<string, number> = { storage: -1, terminal: -1, container: 0 };
    for (const o of objs as any[]) {
      const e = (o.store as any)?.energy ?? 0;
      if (o.type === "storage") out.storage = e;
      else if (o.type === "terminal") out.terminal = e;
      else if (o.type === "container") out.container += e;
    }
    return out;
  }

  /** 工地普查（structureType → 数量）——constructionSite 对象真值（R20/T6）。 */
  async siteCensus(roomName?: string): Promise<Record<string, number>> {
    const objs = await this.world().roomObjects(roomName ?? this._bot.roomName);
    const census: Record<string, number> = {};
    for (const o of objs as any[]) {
      if (o.type !== "constructionSite" || typeof o.structureType !== "string") continue;
      census[o.structureType] = (census[o.structureType] ?? 0) + 1;
    }
    return census;
  }

  /** 指定名称 creep 的血量真值；不存在（死亡/未生成）时 undefined（R20/T6）。 */
  async creepHitPoints(
    roomName: string | undefined,
    name: string,
  ): Promise<{ hits: number; hitsMax: number } | undefined> {
    const objs = await this.world().roomObjects(roomName ?? this._bot.roomName);
    const c = (objs as any[]).find((o) => o.type === "creep" && o.name === name);
    if (!c) return undefined;
    return { hits: c.hits ?? 0, hitsMax: c.hitsMax ?? 0 };
  }

  /** controller 进度真值（progress/progressTotal/level）。房间无 controller 时 undefined。
   * driver DB 的 controller 对象不存 progressTotal（引擎按 CONTROLLER_LEVELS 现算），
   * 此处从 SSOT 补算——与游戏内 getter 语义一致。 */
  async controllerProgress(
    roomName?: string,
  ): Promise<{ progress: number; progressTotal: number; level: number } | undefined> {
    const objs = await this.world().roomObjects(roomName ?? this._bot.roomName);
    const ctrl = (objs as any[]).find((o) => o.type === "controller");
    if (!ctrl) return undefined;
    const level = ctrl.level ?? 0;
    return {
      progress: ctrl.progress ?? 0,
      progressTotal: ctrl.progressTotal ?? C.CONTROLLER_LEVELS[level] ?? 0,
      level,
    };
  }
}
