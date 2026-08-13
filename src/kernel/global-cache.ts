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
  /**
   * P0-A：per-tick 全局 site 创建计数器（construction-manager 与 remote-mining-manager 共享）。
   * 维度分离：normal = 普通槽位（每 tick 全局 1 个，自有房与远矿公平竞争）；
   * emergency = 紧急重建槽位（每 tick 1 个，独立计额）。远矿 site 永远让位 emergency。
   * 与 maxGlobalSites 总存量是两个维度，分开写清。
   */
  sitesCreatedThisTick?: { tick: number; normal: number; emergency: number };
  /**
   * P0-A：per-tick 远矿 site 总量缓存（Σ Memory.rooms[*].remoteOps[*].siteCount，非 abandoned）。
   * construction-manager 的全局上限判定读此值（与 ctx.globalSiteCount 相加 < maxGlobalSites）。
   * 由 site-quota.ts 的 getRemoteSiteTotal() 惰性构建。
   */
  remoteSiteTotal?: { tick: number; count: number };
  /**
   * P1-1 死资产检测（2026-08-02）：
   * source link 持续满足三重校验（role=source + energy=0 + !linkHasOutlet）时，
   * 记录首次检测 tick。持续 DEAD_ASSET_THRESHOLD(500) tick → 判定为死资产。
   * heap 存储 — global reset 丢失计数可接受（reset 极少，且死资产会快速重建）。
   * key = link.id，value = 首次检测 tick。
   */
  deadAssetSince?: Map<string, number>;
  /**
   * P1-3 link 几何受限标记（2026-08-02）：
   * controller link + storage link 都几何放不下时标记，避免每周期重复尝试空转。
   * key = roomName，value = 标记 tick。LINK_CONSTRAINED_RETRY_INTERVAL(1000t) 后
   * 自动过期重试（RCL 升级或拆改后可能解锁）。heap 存储 — global reset 丢失可接受
   *（重开后重新评估一次，开销可忽略）。
   */
  linkConstrained?: Map<string, number>;
  /**
   * P1-4 拆改计划跟踪（2026-08-02）：
   * 死资产 link 检测到替代位置后创建拆改计划，跟踪「先建替代 → 验证灌能 → 拆旧」
   * 的完整生命周期。key = deadLinkId（死资产 link 的 id），value = 拆改计划。
   *
   * heap 存储 — global reset 丢失可接受（reset 极少，且死资产会重新检测 +
   * 重新规划拆改）。不进 Memory 避免结构变更与 schema 升级。
   */
  dismantlePlans?: Map<string, DismantlePlan>;
  /**
   * P1-4 拆改冷却账本（2026-08-02）：
   * key = roomName，value = 最近一次拆改启动 tick。
   * DISMANTLE_COOLDOWN(1000t) 内不再启动新拆改 — 避免同一房频繁拆改空转。
   * heap 存储 — global reset 丢失可接受（冷却期短，重开后快速恢复）。
   */
  lastDismantleTick?: Map<string, number>;
  /**
   * 累计拆改次数（拆改可观测性）。
   * key = roomName，value = 该房累计启动的拆改计划数。
   * 由 link-system.createDismantlePlan 递增；layout-metrics 采集消费。
   * heap 存储 — global reset 丢失可接受（与 dismantlePlans 同策略），
   * 重开后从 0 重新计数，不影响死资产检测/拆改逻辑。
   */
  dismantleCount?: Map<string, number>;
  /**
   * 走廊路路径缓存（漏洞 #5/#8）。
   * key = roomName，value = 该房最高优先级走廊对的 PathFinder 路径结果。
   *
   * 失效条件（完整，修复漏洞 #5）：
   *   - pairKey 变化（端点 container/storage 消失或新建）
   *   - rcl 变化（解锁新结构，路径可能变化）
   *   - anchor 变化（spawn 重建在新位置）
   *   - 路径格被新建结构占用 → 由 planCorridorRoads 内部 occupied 过滤，不触发缓存失效
   *
   * heap 存储 — global reset 丢失可接受（与 linkConstrained 同策略），
   * 重开后首个规划周期重新计算，CPU 开销可忽略（单次 PathFinder 0.5-2ms）。
   * 不进 segment — 避免 schema 升级（漏洞 #8 修正：从 segment 改为 heap）。
   */
  corridorPathCache?: Map<string, CorridorPathCacheEntry>;
  /**
   * defense-planner 的 min-cut 结果缓存（跨 global reset 从 Memory 恢复）。
   * key = roomName，value = 该房 min-cut 计算结果 + 核心结构签名。
   * 核心结构变化时签名不匹配 → 重算；算法版本变更时签名前缀变化 → 旧缓存自然失效。
   */
  __minCutCache?: Record<string, MinCutCache>;
  /**
   * defense-planner 的出口位置缓存（room.find(FIND_EXIT) 结果）。
   * 出口位置在房间地形不变时固定，缓存 1000 tick 过期。heap 存储 —
   * global reset 丢失可接受（重开后首个 defense-planner 周期重建）。
   */
  __exitCache?: Record<string, ExitCache>;
}

/**
 * P1-4 拆改计划（完整 Plan 契约）。
 *
 * 生命周期状态机：
 *   waiting     → 替代 link 尚未建成（construction-manager 检查替代任务 state）
 *   validating  → 替代 link 已建成，等待 500t 验证灌能（energy > 0）
 *   终态（从 dismantlePlans 移除）：success / aborted / fallback
 *
 * 终态条件：
 *   success    → validating 期间替代 link energy > 0：destroy 旧 link + clearDeadAssetLink
 *   aborted    → ttl 到期（DISMANTLE_TTL=1500t）或替代任务被清理：放弃拆改，保留旧 link
 *   fallback   → validating 超时（DISMANTLE_VALIDATION_DELAY=500t）且替代 link energy=0：
 *                替代位置也是死资产 → markLinkConstrained + clearDeadAssetLink，避免重复空转
 *
 * 战时降级：房间 colonyState === "defense" 时暂停处理（不 destroy，保留计划），
 *          恢复 peace 后继续。
 */
export interface DismantlePlan {
  /** 死资产 link 的 id（待拆除）。 */
  deadLinkId: string;
  /** 死资产 link 所在房间名。 */
  roomName: string;
  /** 替代 link 的 build task key（用于在 buildQueue 中追踪替代 link 建造状态）。 */
  replacementKey: string;
  /** 替代 link 的位置（验证阶段查找结构用）。 */
  replacementPos: { x: number; y: number };
  /** 拆改计划启动 tick。 */
  startedAt: number;
  /** ttl 到期 tick（startedAt + DISMANTLE_TTL）。到期未完成 → abort。 */
  expiresAt: number;
  /** 当前状态：waiting（等替代建成） / validating（验证替代灌能）。 */
  state: "waiting" | "validating";
  /** 进入 validating 状态的 tick（用于计算验证超时）。state=waiting 时为 undefined。 */
  validatingSince?: number;
}

/**
 * 走廊路路径缓存条目（漏洞 #5/#8）。
 *
 * 缓存最高优先级走廊对的 PathFinder 结果，避免每 50 tick 重算。
 * 失效由 signature 比对完成：pairKey + rcl + anchor 任一变化即失效。
 */
export interface CorridorPathCacheEntry {
  /** 走廊对签名 "fromx,fromy→tox,toy"，端点变化即失效。 */
  pairKey: string;
  /** 缓存时的 RCL，RCL 升级即失效（解锁新结构，路径可能变化）。 */
  rcl: number;
  /** 缓存时的锚点位置，spawn 重建即失效。 */
  anchor: { x: number; y: number };
  /** PathFinder 计算的路径格列表（未过滤占用）。 */
  path: { x: number; y: number }[];
  /** 缓存创建 tick（诊断用）。 */
  tick: number;
}

/**
 * defense-planner 的 min-cut 结果缓存条目。
 *
 * 核心结构签名变化时签名不匹配 → 重算；
 * 算法版本戳（MINCUT_ALGO_VERSION）拼入 signature 前缀，旧版本缓存自然失效。
 */
export interface MinCutCache {
  /** 核心结构位置的签名（含算法版本前缀，用于检测是否需要重算）。 */
  signature: string;
  /** min-cut 计算结果。 */
  result: { rampartPositions: { x: number; y: number }[]; complete: boolean };
  /** 缓存创建的 tick。 */
  tick: number;
}

/** defense-planner 的出口位置缓存条目（room.find(FIND_EXIT) 结果，1000t 过期）。 */
export interface ExitCache {
  positions: { x: number; y: number }[];
  tick: number;
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
