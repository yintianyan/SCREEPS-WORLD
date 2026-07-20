import type { RoomSnapshot } from "./contracts";

/** Screeps 沙箱 `global` 对象的形态 — 所有字段可选且可重建。 */
export interface GlobalCache {
  errorLog?: Map<string, number>;
  /** 每个 label 的连续错误计数（用于冷却跟踪）。 */
  errorCounts?: Map<string, number>;
  /** 每个 label 的冷却到期 tick（非关键插件在反复报错后暂停）。 */
  pluginCooldowns?: Map<string, number>;
  telemetry?: {
    tick: number;
    systemCpu: Record<string, number>;
    roleCpu: Record<string, number>;
    skipped: number;
    errors: number;
  };
  snapshots?: Map<string, RoomSnapshot>;
  roomTraffic?: Record<string, Record<string, number>>;
  /** 单 tick 内累加的跳过原因计数，tick 末尾低频刷入 Memory。 */
  skipBuffer?: Record<string, number>;
}

/**
 * Screeps 沙箱 `global` 对象的类型安全访问器。
 *
 * 在 Screeps 运行时中 `global` 和 `globalThis` 是同一个沙箱作用域。
 * 使用 `globalThis` 以避免与 `@types/node` 的 `global` 类型冲突。
 * 所有字段可选，必须在 global reset 后可惰性重建。
 */
export function globalCache(): GlobalCache {
  return globalThis as unknown as GlobalCache;
}
