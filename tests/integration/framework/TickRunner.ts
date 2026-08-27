/** TickRunner — 驱动真实 kernel.run() 运行 N tick 并收集遥测。 */
import type { TestWorld } from "./TestWorld";

export interface TickRecord {
  tick: number;
  rcl: number;
  progress: number;
  energyAvailable: number;
  totalEnergy: number;
  creepCount: number;
  creepsByRole: Record<string, number>;
  containerCount: number;
  extensionCount: number;
  siteCount: number;
  spawning: string[];
  errors: string[];
}

export interface RunResult {
  ticks: number;
  records: TickRecord[];
  finalSnapshot: ReturnType<TestWorld["snapshot"]>;
  runtimeErrors: string[];
  /** 每 tick 平均耗时（ms）— 用于检测性能退化 */
  avgTickMs: number;
}

export interface TickRunnerOptions {
  /** 每 N tick 记录一次详细状态（默认每 tick） */
  recordInterval?: number;
  /** 最大运行 tick 数（安全阀，默认 20000） */
  maxTicks?: number;
  /** 每 tick 后的回调（用于注入事件：杀 creep、加敌人等） */
  onTick?: (world: TestWorld, tick: number) => void;
  /** 提前终止条件 */
  stopWhen?: (world: TestWorld, tick: number) => boolean;
  /** 是否静默 console.log（默认 true） */
  silent?: boolean;
}

export class TickRunner {
  private _loop: (() => void) | null = null;

  /**
   * 设置生产代码的 loop 函数。
   * 必须在 run() 之前调用。通常通过 dynamic import 获取：
   *   const { loop } = await import("../../../src/main");
   */
  setLoop(loop: () => void): void {
    this._loop = loop;
  }

  /**
   * 运行 N tick。

   * @param world  已配置好的 TestWorld
   * @param ticks  运行 tick 数
   * @param opts   运行选项
   */
  run(world: TestWorld, ticks: number, opts: TickRunnerOptions = {}): RunResult {
    if (!this._loop) {
      throw new Error("TickRunner: loop not set. Call setLoop() first.");
    }

    const {
      recordInterval = 1,
      maxTicks = 20000,
      onTick,
      stopWhen,
      silent = true,
    } = opts;

    const actualTicks = Math.min(ticks, maxTicks);
    const records: TickRecord[] = [];
    const errors: string[] = [];
    const startTime = Date.now();

    // 静默 console.log
    const originalLog = console.log;
    if (silent) {
      console.log = (...args: unknown[]) => {
        const msg = args.map(String).join(" ");
        // 跳过遥测输出行（@TELEMETRY / @ALERT 前缀）
        if (msg.startsWith("@TELEMETRY") || msg.startsWith("@ALERT")) return;
        if (msg.includes("Error") || msg.includes("error") || msg.includes("TypeError")) {
          errors.push(msg);
        }
      };
    }

    try {
      // 安装全局对象
      world.installGlobals();

      for (let i = 0; i < actualTicks; i++) {
        // 1. 推进物理
        world.advancePhysics();

        // 2. 刷新 Game 全局
        world.refreshGameGlobals();

        // 3. 运行生产代码
        try {
          this._loop();
        } catch (err) {
          const msg = `[tick ${world.tick}] RUNTIME ERROR: ${err instanceof Error ? err.stack : String(err)}`;
          errors.push(msg);
          world._stats.runtimeErrors.push(msg);
        }

        // 4. 回调
        if (onTick) onTick(world, world.tick);

        // 5. 记录
        if (world.tick % recordInterval === 0) {
          records.push(this._recordTick(world));
        }

        // 6. 提前终止
        if (stopWhen && stopWhen(world, world.tick)) break;
      }
    } finally {
      if (silent) {
        console.log = originalLog;
      }
    }

    const elapsed = Date.now() - startTime;
    return {
      ticks: world.tick,
      records,
      finalSnapshot: world.snapshot(),
      runtimeErrors: errors,
      avgTickMs: elapsed / world.tick,
    };
  }

  private _recordTick(world: TestWorld): TickRecord {
    const byRole: Record<string, number> = {};
    for (const c of world.creeps) {
      const role = (c.memory.role as string) ?? "unknown";
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    const spawning: string[] = [];
    for (const s of world.spawns) {
      if (s.spawning) spawning.push(s.spawning.name);
    }
    return {
      tick: world.tick,
      rcl: world.controller?.level ?? 0,
      progress: world.controller?.progress ?? 0,
      energyAvailable: world.room.energyAvailable,
      totalEnergy: world.totalEnergy(),
      creepCount: world.creeps.length,
      creepsByRole: byRole,
      containerCount: world.containers.length,
      extensionCount: world.extensions.length,
      siteCount: world.sites.length,
      spawning,
      errors: [...world._stats.runtimeErrors],
    };
  }
}

/** 全局单例 TickRunner — 测试间共享。 */
export const tickRunner = new TickRunner();
