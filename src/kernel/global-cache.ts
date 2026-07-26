import { TaskPool } from "../domain/assignment/task-pool";

/** assignment-service 的单 tick 缓存。 */
export interface AssignmentCache {
  tick: number;
  /** 封装的任务池 — 提供索引查找和原子操作。 */
  pool: TaskPool;
}

/** Action 级 CPU profiling 单条记录。 */
export interface ActionCpuEntry {
  /** 调用次数。 */
  count: number;
  /** 累计 CPU 开销。 */
  totalCpu: number;
  /** 单次最大 CPU 开销（离群值检测）。 */
  maxCpu: number;
}

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
  roomTraffic?: Record<string, Record<string, number>>;
  /** 上一个采样窗口的交通数据（用于道路策略的双窗口检查）。 */
  prevRoomTraffic?: Record<string, Record<string, number>>;
  /** 单 tick 内累加的跳过原因计数，tick 末尾低频刷入 Memory。 */
  skipBuffer?: Record<string, number>;
  /** per-tick 事件缓冲区 — 任意系统可通过 recordEvent() 写入，telemetry-collector flush。 */
  eventBuffer?: { events: import("./event-log").GameEvent[] };
  /** assignment-service 的单 tick 任务缓存。 */
  assignment?: AssignmentCache;
  /** 本 tick 已被 hauler 预约的填充目标结构 id 集合（防多 hauler 抢同一目标拥堵）。 */
  fillReservations?: Set<string>;
  /** fillReservations 上次重置所在的 tick（用于惰性按 tick 重置）。 */
  fillReservationTick?: number;
  /**
   * 本 tick 拥有 builder/worker creep 的房间名集合（P1-3：由 Kernel.buildSnapshots 预构建）。
   * tower-defense 消费此集合判断本房是否有维修 creep，避免独立全量 Game.creeps 扫描。
   */
  repairRooms?: ReadonlySet<string>;
  /**
   * 本 tick 的 boost 报到分配表（lab-system 每 tick 写入）。
   * key = creep 名，value = 该 creep 应报到的 boost lab id。
   * role-runner 据此把报到窗口内的新生 creep 引导到 lab 旁，
   * lab-system 在相邻时执行 boostCreep — 缺此环节则 boost 决策永远无法落地。
   */
  boostAssignments?: { tick: number; byCreep: Record<string, string> };
  /** 归位：每房每 tick 推导的关键格/道路/阻挡格集合（parking.ts 构建）。 */
  __parkRoomData?: Record<string, { tick: number; data: unknown }>;
  /** 归位：本 tick 已被预约的停车位（packed pos 集合，防聚堆）。 */
  __parkReservations?: Set<number>;
  /** 归位：__parkReservations 上次重置所在的 tick（惰性按 tick 重置）。 */
  __parkReservationsTick?: number;
  /** Action 级 CPU profiling 数据（仅当 CONFIG.debug.actionProfiling 为 true 时写入）。
   * key = "roleName/actionName/resolve" | "roleName/actionName/execute" | "roleName/onFlee"。
   * 按 tick 惰性重置。 */
  actionCpu?: Map<string, ActionCpuEntry>;
  /** actionCpu 上次重置所在的 tick（惰性按 tick 重置）。 */
  actionCpuTick?: number;
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
