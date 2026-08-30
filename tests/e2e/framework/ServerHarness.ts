/** ServerHarness — 封装 screeps-server-mockup 的 ScreepsServer 生命周期。 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  constructor(opts: { path?: string } = {}) {
    // 断点续跑：给定既有 server 目录（db.json 完整状态）则直接挂载；
    // 否则每实例独立 tmpdir + 随机端口（并发实例防冲突）。
    if (opts.path) {
      this.server = new ScreepsServer({
        path: opts.path,
        logdir: join(opts.path, "logs"),
        port: 21025 + 1000 + Math.floor(Math.random() * 8000),
      });
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "screeps-e2e-"));
    const port = 21025 + 1000 + Math.floor(Math.random() * 8000);
    this.server = new ScreepsServer({
      path: join(dir, "server"),
      logdir: join(dir, "server", "logs"),
      port,
    });
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

   * screeps-server-mockup 的 server.stop() 发 SIGTERM 但 storage 进程对 SIGTERM
   * 不完全退出（只停 queue fetching）。@screeps/common storage.js 的 socket
   * error/end handler 会 setTimeout(_connect, 1000) 无限重连，使 worker 事件
   * 循环永不空闲。此处对残留子进程发 SIGKILL 并 disconnect IPC 通道，尽量
   * 减少孤儿进程和重连 timer 对事件循环的 hold。最终进程退出由 setup.ts
   * 的 afterAll 中 process.exit(0)（被 vitest 拦截但保证 run 完整）兜底。
   */
  dispose(): void {
    try {
      if (this._started) {
        this.server.stop(); // SIGTERM all child processes
        // storage 对 SIGTERM 不完全退出；SIGKILL 确保进程死透
        for (const proc of Object.values((this.server as any).processes ?? {})) {
          try {
            (proc as any).kill("SIGKILL");
            // disconnect IPC channel，释放 worker 侧 handle
            (proc as any).disconnect?.();
          } catch {
            // 忽略：进程可能已退出
          }
        }
      }
    } catch {
      // 忽略清理错误
    }
    this._started = false;
  }
}

