/**
 * ServerHarness — 封装 screeps-server-mockup 的 ScreepsServer 生命周期。
 *
 * 职责：
 *   - 创建/启动/停止 server 实例
 *   - 提供 world 访问接口（reset/addRoom/addRoomObject/addBot）
 *   - 管理 server 进程清理（process.exit 替代方案）
 *
 * 关键约束 [Facts]：
 *   - screeps-server-mockup 的 server.stop() 无法优雅关闭 storage
 *   - 官方建议 process.exit()，但会杀掉 vitest 进程
 *   - 解法：用 afterAll 钩子清理，配合 vitest --forceExit
 */
import { ScreepsServer } from "screeps-server-mockup";

// terrain 辅助函数定义在 WorldBuilder.ts 中，避免重复
export { emptyTerrain, terrainWithWalls } from "./WorldBuilder";

/**
 * Server 生命周期管理器。
 * 每个测试文件创建一个实例，在 afterAll 中调用 dispose()。
 */
export class ServerHarness {
  readonly server: ScreepsServer;
  private _started = false;

  constructor() {
    this.server = new ScreepsServer();
  }

  /**
   * 重置世界并可选创建 stub 世界（9 房间，含 source 和 controller）。
   * @param stubWorld 是否创建 stub 世界（默认 false，由 WorldBuilder 精细控制）
   */
  async reset(stubWorld = false): Promise<void> {
    await this.server.world.reset();
    if (stubWorld) {
      await this.server.world.stubWorld();
    }
  }

  /** 启动 server。重复调用幂等。 */
  async start(): Promise<void> {
    if (this._started) return;
    await this.server.start();
    this._started = true;
  }

  /** 推进一个 tick。 */
  async tick(): Promise<void> {
    if (!this._started) {
      throw new Error("ServerHarness.tick() called before start()");
    }
    await this.server.tick();
  }

  /** 当前游戏时间（tick）。 */
  get gameTime(): Promise<number> {
    return this.server.world.gameTime;
  }

  /**
   * 清理资源。
   *
   * 注意：screeps-server-mockup 的 storage 无法优雅关闭。
   * vitest 配置 --forceExit 确保进程退出。
   * 不调用 process.exit() 以免影响 vitest。
   */
  dispose(): void {
    try {
      if (this._started) {
        this.server.stop();
      }
    } catch {
      // 忽略清理错误，vitest --forceExit 会处理进程退出
    }
    this._started = false;
  }
}

