/** SnapshotInspector — 从 bot.memory 和 Game API 提取可断言的状态快照。 */
import type { BotHarness } from "./BotHarness";

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
    // 生产代码的 creep memory 应该有 role 字段（Screeps 惯例）
    const creepCountByRole: Record<string, number> = {};
    let totalCreeps = 0;
    if (mem.creeps && typeof mem.creeps === "object") {
      for (const [creepName, creepMem] of Object.entries(mem.creeps)) {
        const role = (creepMem as any)?.role ?? "unknown";
        creepCountByRole[role] = (creepCountByRole[role] ?? 0) + 1;
        totalCreeps++;
      }
    }

    return {
      tick: currentTick,
      creepCountByRole,
      totalCreeps,
      rawMemory: mem,
      consoleLogs: this._bot.drainConsole(),
      notifications: this._bot.drainNotifications(),
    };
  }

  /**
   * 提取指定房间的 storage 能量。
   * 从 Memory.rooms[roomName].storage 或类似字段读取。
   * 注意：生产代码可能不存这个字段，需要通过其他方式观察。
   */
  getStorageEnergy(snapshot: BotSnapshot, roomName: string): number | undefined {
    const roomMem = snapshot.rawMemory?.rooms?.[roomName];
    return roomMem?.storageEnergy ?? roomMem?.storage?.energy;
  }

  /**
   * 提取 controller 等级。
   * 从 Memory.rooms[roomName].controller.level 或类似字段读取。
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
   * 查找包含指定关键字的日志。
   */
  findLogs(snapshot: BotSnapshot, keyword: string): string[] {
    return snapshot.consoleLogs.filter((line) => line.includes(keyword));
  }
}
