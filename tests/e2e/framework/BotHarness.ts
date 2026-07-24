/**
 * BotHarness — 封装 bot 加载 dist/main.js 真实构建产物。
 *
 * 职责：
 *   - 读取 dist/main.js 作为 bot 的 main 模块代码
 *   - 提供 bot.memory / bot.console / bot.newNotifications 访问
 *   - 收集 console 日志用于断言和调试
 *
 * 关键设计 [Facts]：
 *   - screeps-server-mockup 的 addBot({modules: {main: codeString}}) 需要代码字符串
 *   - dist/main.js 是 CJS 格式（exports.loop = loop），匹配 Screeps 运行时要求
 *   - 不直接 import 生产代码，只通过真实 Screeps 引擎交互
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIST_MAIN_PATH = resolve(process.cwd(), "dist/main.js");

/**
 * 读取 dist/main.js 构建产物作为 bot 代码。
 * @returns dist/main.js 文件内容字符串
 */
export function loadDistMain(): string {
  return readFileSync(DIST_MAIN_PATH, "utf8");
}

/**
 * Bot 句柄。封装 screeps-server-mockup 返回的 bot 对象。
 */
export class BotHarness {
  readonly username: string;
  readonly roomName: string;
  readonly spawnPos: { x: number; y: number };
  private _bot: any;
  private _consoleLogs: string[] = [];
  private _notifications: Array<{ message: string; date: number }> = [];

  constructor(username: string, roomName: string, spawnPos: { x: number; y: number }) {
    this.username = username;
    this.roomName = roomName;
    this.spawnPos = spawnPos;
  }

  /**
   * 将 bot 注册到 server。读取 dist/main.js 作为代码。
   * 必须在 server.start() 之前调用。
   */
  async registerTo(server: any): Promise<void> {
    const code = loadDistMain();
    this._bot = await server.world.addBot({
      username: this.username,
      room: this.roomName,
      x: this.spawnPos.x,
      y: this.spawnPos.y,
      modules: { main: code },
    });

    // 收集 console 日志
    this._bot.on("console", (logs: string[], _results: any, _userid: string, _username: string) => {
      for (const line of logs) {
        this._consoleLogs.push(line);
      }
    });

    // 收集通知
    this._bot.on("notification", (message: string, date: number) => {
      this._notifications.push({ message, date });
    });
  }

  /**
   * 获取 bot 的 Memory 快照（JSON 字符串）。
   * 每次调用都从 server 拉取最新值。
   */
  async getMemory(): Promise<any> {
    const memStr = await this._bot.memory;
    try {
      return JSON.parse(memStr);
    } catch {
      return {};
    }
  }

  /**
   * 获取从上次调用以来的新 console 日志。
   * 调用后清空缓冲区，避免重复读取。
   */
  drainConsole(): string[] {
    const logs = [...this._consoleLogs];
    this._consoleLogs = [];
    return logs;
  }

  /**
   * 获取所有 console 日志（不清空）。
   * 用于调试失败用例。
   */
  getAllConsole(): string[] {
    return [...this._consoleLogs];
  }

  /**
   * 获取新通知并清空缓冲区。
   */
  drainNotifications(): Array<{ message: string; date: number }> {
    const notifications = [...this._notifications];
    this._notifications = [];
    return notifications;
  }
}
