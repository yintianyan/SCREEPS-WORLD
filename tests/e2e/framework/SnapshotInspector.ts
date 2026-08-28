/** SnapshotInspector — 从 bot.memory 和 Game API 提取可断言的状态快照。 */
import type { BotHarness } from "./BotHarness";

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

  /**
   * 提取指定房间的 storage 能量。
   */
  getStorageEnergy(snapshot: BotSnapshot, roomName: string): number | undefined {
    const roomMem = snapshot.rawMemory?.rooms?.[roomName];
    return roomMem?.storageEnergy ?? roomMem?.storage?.energy;
  }

  /**
   * 提取 controller 等级。
   */
  getControllerLevel(snapshot: BotSnapshot, roomName: string): number | undefined {
    const roomMem = snapshot.rawMemory?.rooms?.[roomName];
    return roomMem?.rcl ?? roomMem?.controller?.level;
  }

  /**
   * 检查快照中是否有指定角色的 creep。
   */
  hasRole(snapshot: BotSnapshot, role: string, minCount = 1): boolean {
    return (snapshot.creepCountByRole[role] ?? 0) >= minCount;
  }

  /**
   * 检查快照中是否有错误日志（匹配 "error" / "Error" / "ERR"）。
   */
  hasErrorLogs(snapshot: BotSnapshot): boolean {
    return snapshot.consoleLogs.some(
      (line) =>
        line.includes("error") ||
        line.includes("Error") ||
        line.includes("ERR") ||
        line.includes("TypeError") ||
        line.includes("undefined"),
    );
  }

  /**
   * 检查快照中是否有运行时错误（从 Memory.kernel.stats.lastError）。
   */
  hasRuntimeError(snapshot: BotSnapshot): boolean {
    return snapshot.metrics.lastError !== undefined;
  }

  /**
   * 查找包含指定关键字的日志。
   */
  findLogs(snapshot: BotSnapshot, keyword: string): string[] {
    return snapshot.consoleLogs.filter((line) => line.includes(keyword));
  }
}
