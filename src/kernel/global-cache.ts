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
   * 本 tick 拥有存活 hauler 的房间名集合（Kernel.buildSnapshots 预构建）。
   * isLogisticsContainer 消费：source container 的「物流源」身份以本房确有
   * hauler 为前提 — 拓荒爬坡期编制里还没有 hauler 时，container 能量没有
   * 任何物流消费者，builder/upgrader 礼让的对象不存在，应可直取
   * （withdraw 满载 1 tick vs harvest 慢采 25 tick，差一个量级）。
   */
  haulerRooms?: ReadonlySet<string>;
  /**
   * 上 tick 各 creep 的最后已知位置（Kernel.buildSnapshots 预构建，
   * key = creep 名，value = { r: 房名, x, y }）。
   * 战斗黑匣子（M9）消费：maintainMemory 清理死者 memory 时，死者已不在
   * Game.creeps — 本缓存是死亡位置的唯一来源（maintainMemory 先于
   * buildSnapshots 运行，读到的恰是死者生前最后一 tick 的位置）。
   * global reset 后首 tick 为空 — 死亡事件降级为无位置记录，可接受。
   */
  creepLastSeen?: ReadonlyMap<string, { r: string; x: number; y: number }>;
  /**
   * 近期战损记录（recordCreepDeath 对 natural=0 的死亡追加，惰性清理）。
   * safe mode 舰队伤亡熔断（M11）消费：窗口内本房战损数达阈值且威胁
   * 在场即触发。heap 存储 — global reset 丢失计数可接受（reset 极少，
   * 且威胁持续在场时计数会快速重建）。
   */
  recentCombatDeaths?: { t: number; r: string }[];
  /**
   * 本 tick 拥有存活 distributor 的房间名集合（Kernel.buildSnapshots 预构建）。
   * hauler 的 fillStorage 消费：分发泵断供（本房不在集合中）且 spawn/extension
   * 有填充缺口时跳过囤积 storage，直送核心 sink — 否则能量被锁进无人能取的
   * 仓库，energyAvailable 卡死在 spawn 自充值，全舰队孵化饥饿降级。
   */
  distributorRooms?: ReadonlySet<string>;
  /**
   * 本 tick 的 boost 报到分配表（lab-system 每 tick 写入）。
   * key = creep 名；ready 表示 lab 内化合物已备足（≥ 单次 boost 用量）—
   * 报到拦截仅在 ready 时生效，避免 creep 在 lab 旁罚站等 supplyLabs 搬运
   *（对 defender 这类威胁窗口角色，等待就是战力真空）。
   */
  boostAssignments?: { tick: number; byCreep: Record<string, { labId: string; ready: boolean }> };
  /**
   * 本 tick 的 lab 搬运需求表（lab-system 每 tick 写入，supplyLabs 消费）。
   * lab 角色分配只有 lab-system 知道 — 此表把「哪个 lab 缺哪种资源多少量 /
   * 哪个 lab 该清空什么」告诉搬运 creep，是供料链的唯一化合物-lab 绑定通道。
   */
  labDemands?: { tick: number; byRoom: Record<string, import("../domain/industry/types").LabDemandTable> };
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
  /** Traffic Manager 的 per-tick 移动意图/锚定账本（intent.ts 构建，traffic-manager 消费）。 */
  __moveIntents?: import("../creeps/movement/intent").IntentLedger;
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
