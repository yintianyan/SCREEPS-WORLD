import { TaskPool } from "../domain/assignment/task-pool";
import type { TraceState } from "./decision-trace";

/** assignment-service 的单 tick 缓存。 */
export interface AssignmentCache {
  tick: number;
  pool: TaskPool;
}

/** Action 级 CPU profiling 单条记录。 */
export interface ActionCpuEntry {
  count: number;
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
  assignment?: AssignmentCache;
  /** 本 tick 已被 hauler 预约的填充目标结构 id 集合（防多 hauler 抢同一目标拥堵）。 */
  fillReservations?: Set<string>;
  /** fillReservations 上次重置所在的 tick（用于惰性按 tick 重置）。 */
  fillReservationTick?: number;
  /** 本 tick 拥有 builder/worker creep 的房间名集合（Kernel.buildSnapshots 预构建，P1-3）；
   * tower-defense 消费，避免独立全量 Game.creeps 扫描。 */
  repairRooms?: ReadonlySet<string>;
  /** 本 tick 拥有存活 hauler 的房间名集合（Kernel.buildSnapshots 预构建）。
   * isLogisticsContainer 消费：container 的「物流源」身份以本房确有 hauler 为前提 —
   * 拓荒爬坡期无 hauler 时无物流消费者，builder/upgrader 应可直取
   * （withdraw 满载 1 tick vs harvest 慢采 25 tick，差一个量级）。 */
  haulerRooms?: ReadonlySet<string>;
  /** 上 tick 各 creep 的最后已知位置（Kernel.buildSnapshots 预构建）。
   * 战斗黑匣子（M9）消费：maintainMemory 清理死者 memory 时死者已不在 Game.creeps —
   * 本缓存是死亡位置的唯一来源（maintainMemory 先于 buildSnapshots 运行）。
   * global reset 后首 tick 为空 — 死亡事件降级为无位置记录，可接受。 */
  creepLastSeen?: ReadonlyMap<string, { r: string; x: number; y: number }>;
  /** 近期战损记录（recordCreepDeath 对 natural=0 的死亡追加，惰性清理）。
   * safe mode 舰队伤亡熔断（M11）消费：窗口内本房战损达阈值且威胁在场即触发。
   * heap 存储 — global reset 丢失可接受（reset 极少，威胁持续在场时计数快速重建）。 */
  recentCombatDeaths?: { t: number; r: string }[];
  /** 本 tick 拥有存活 distributor 的房间名集合（Kernel.buildSnapshots 预构建）。
   * hauler 的 fillStorage 消费：泵断供且 spawn/extension 有缺口时跳过囤积 storage，
   * 直送核心 sink — 否则能量锁进无人能取的仓库，energyAvailable 卡死在 spawn 自充值，
   * 全舰队孵化饥饿降级。 */
  distributorRooms?: ReadonlySet<string>;
  /** 【G-H】DecisionTrace 分层 ring（volatile 调试设施）。 */
  decisionTrace?: TraceState;
  /** 【F1/G-B】各系统 CPU 消耗 EMA（budgetCap 局部截断判据）。heap 存储，reset 后从零重建（EMA 快速收敛可接受）。 */
  systemBudgetEma?: Map<string, number>;
  /** 本 tick 的 boost 报到分配表（lab-system 每 tick 写入）。
   * key = creep 名；ready = lab 内化合物已备足（≥ 单次 boost 用量）—
   * 报到拦截仅在 ready 时生效，避免 creep 罚站等 supplyLabs 搬运
   *（对 defender 这类威胁窗口角色，等待就是战力真空）。 */
  boostAssignments?: { tick: number; byCreep: Record<string, { labId: string; ready: boolean }> };
  /** 本 tick 的 lab 搬运需求表（lab-system 写入，supplyLabs 消费）。
   * lab 角色分配只有 lab-system 知道 — 此表是供料链的唯一化合物-lab 绑定通道。 */
  labDemands?: { tick: number; byRoom: Record<string, import("../domain/industry/types").LabDemandTable> };
  /** 归位：每房每 tick 推导的关键格/道路/阻挡格集合（parking.ts 构建）。 */
  __parkRoomData?: Record<string, { tick: number; data: unknown }>;
  /** 归位：本 tick 已被预约的停车位（packed pos 集合，防聚堆）。 */
  __parkReservations?: Set<number>;
  /** 归位：__parkReservations 上次重置所在的 tick（惰性按 tick 重置）。 */
  __parkReservationsTick?: number;
  /** Action 级 CPU profiling 数据（仅当 CONFIG.debug.actionProfiling 为 true 时写入）。
   * key = "roleName/actionName/resolve|execute" | "roleName/onFlee"。按 tick 惰性重置。 */
  actionCpu?: Map<string, ActionCpuEntry>;
  /** actionCpu 上次重置所在的 tick（惰性按 tick 重置）。 */
  actionCpuTick?: number;
  /** Traffic Manager 的 per-tick 移动意图/锚定账本（intent.ts 构建，traffic-manager 消费）。 */
  __moveIntents?: import("../creeps/movement/intent").IntentLedger;
  /** P0-A：per-tick 全局 site 创建计数器（construction-manager 与 remote-mining-manager 共享）。
   * normal = 普通槽位（每 tick 全局 1 个，自有房与远矿公平竞争）；emergency = 紧急重建槽位
   * （每 tick 1 个，独立计额）。远矿 site 永远让位 emergency。与 maxGlobalSites 是两个维度。 */
  sitesCreatedThisTick?: { tick: number; normal: number; emergency: number };
  /** P0-A：per-tick 远矿 site 总量缓存（Σ remoteOps[*].siteCount，非 abandoned）。
   * construction-manager 全局上限判定读此值（与 ctx.globalSiteCount 相加 < maxGlobalSites）。
   * 由 site-quota.ts 的 getRemoteSiteTotal() 惰性构建。 */
  remoteSiteTotal?: { tick: number; count: number };
  /** P1-1 死资产检测：source link 持续满足三重校验（role=source + energy=0 + !linkHasOutlet）
   * 达 DEAD_ASSET_THRESHOLD(500) tick → 判定死资产。key = link.id，value = 首次检测 tick。
   * heap 存储 — global reset 丢失可接受（reset 极少，且死资产会快速重建）。 */
  deadAssetSince?: Map<string, number>;
  /** P1-3 link 几何受限标记：controller link + storage link 都放不下时标记，避免重复空转。
   * key = roomName，value = 标记 tick；LINK_CONSTRAINED_RETRY_INTERVAL(1000t) 后过期重试
   *（RCL 升级或拆改后可能解锁）。heap 存储 — global reset 丢失可接受。 */
  linkConstrained?: Map<string, number>;
  /** P1-4 拆改计划跟踪：死资产 link 检测到替代位置后创建拆改计划，跟踪
   * 「先建替代 → 验证灌能 → 拆旧」完整生命周期。key = deadLinkId，value = 拆改计划。
   * heap 存储 — global reset 丢失可接受；不进 Memory 避免结构变更与 schema 升级。 */
  dismantlePlans?: Map<string, DismantlePlan>;
  /** P1-4 拆改冷却账本：key = roomName，value = 最近一次拆改启动 tick。
   * DISMANTLE_COOLDOWN(1000t) 内不再启动新拆改 — 避免同房频繁拆改空转。
   * heap 存储 — global reset 丢失可接受（冷却期短，重开后快速恢复）。 */
  lastDismantleTick?: Map<string, number>;
  /** 累计拆改次数（拆改可观测性）：key = roomName，value = 累计启动的拆改计划数。
   * link-system.createDismantlePlan 递增，layout-metrics 采集消费。
   * heap 存储 — global reset 丢失可接受，重开后从 0 重计，不影响死资产检测/拆改逻辑。 */
  dismantleCount?: Map<string, number>;
  /** 走廊路路径缓存（漏洞 #5/#8）：key = roomName，value = 最高优先级走廊对的 PathFinder 路径。
   * 失效条件：pairKey 变化（端点 container/storage 消失或新建）/ rcl 变化（解锁新结构）/
   * anchor 变化（spawn 重建）。路径格被新建结构占用由 planCorridorRoads 内部过滤，不触发失效。
   * heap 存储 — global reset 丢失可接受（重开后首个规划周期重算，单次 PathFinder 0.5-2ms）。
   * 不进 segment — 避免 schema 升级（漏洞 #8 修正：从 segment 改为 heap）。 */
  corridorPathCache?: Map<string, CorridorPathCacheEntry>;
  /** defense-planner 的 min-cut 结果缓存（跨 global reset 从 Memory 恢复）。
   * key = roomName，value = min-cut 结果 + 核心结构签名；签名不匹配 → 重算，
   * 算法版本变更时签名前缀变化 → 旧缓存自然失效。 */
  __minCutCache?: Record<string, MinCutCache>;
  /** defense-planner 的出口位置缓存（room.find(FIND_EXIT) 结果，1000t 过期）。
   * heap 存储 — global reset 丢失可接受（重开后首个周期重建）。 */
  __exitCache?: Record<string, ExitCache>;
  /** P0-1 全局编队索引：Kernel.buildSnapshots 预构建，按 (home, remoteTarget,
   * mission) 归组的编队 creep 摘要。war-planner / power-farm-manager /
   * prospect-manager / expansion-manager 从中取子集，避免各系统独立全量遍历
   * Game.creeps（4 系统 × O(creeps) → 1 次遍历 O(creeps)）。
   * heap 存储 — global reset 丢失可接受（next tick 重建）。 */
  squadIndex?: SquadIndexEntry[];
  /** 阶段 1 采购需求表（publishProcurementDemands 是唯一写入口）。
   * 信道契约（审计修复）：条目持久存在直到各自 deadline —— 旧实现的 tick 守卫
   * 使整表单 tick 存活，生产者/消费者相位错开时需求静默丢失。
   * heap 存储 — global reset 丢失可接受（生产者按自身 cadence 重发）。无 schema 变更。 */
  procurementDemands?: { tick: number; byRoom: Record<string, ProcurementDemand[]> };
  /** factory commodity 目标缓存（factory-manager 写，distributor 的
   * stockFactoryComponents 读 — 补料锚点）。heap 存储，可丢。 */
  factoryTargets?: Record<string, string>;
  /** 阶段 4 盈余化合物卖出信号（lab-system 发布，terminal-manager 消费）。
   * lab 产出的 T3 化合物在 boost 库存已满后写入此表，供 terminal-manager 卖出变现。
   * key = 资源类型，value = 盈余量（库存 - boost 储备目标）。
   * heap 存储 — global reset 丢失可接受（下 tick 重建）。无 schema 变更。 */
  surplusCompounds?: { tick: number; items: Record<string, number> };
  /** 市场行情快照（terminal-manager 每 interval 采集写入）。
   * key = 资源类型，value = { sellMin, buyMax } — 当前市场最低卖价与最高买价。
   * 所有买/卖决策以行情快照为基准计算动态价格门禁，替代 CONFIG 中的死价格。
   * heap 存储 — global reset 后首 tick 重建，无 schema 变更。 */
  marketPrices?: { tick: number; prices: Record<string, MarketPriceSnapshot> };
  /** Per-room CPU 记账：kernel.runCreeps 中每只 creep 执行后按 memory.home
   * 归集 CPU 消耗。telemetry-collector 采样写入 Memory.kernel.stats.cpuByHome，
   * 供 empire-strategy / capacity 模型评估每房真实 CPU 成本。
   * heap 存储 — global reset 丢失可接受（下 tick 重建）。 */
  cpuByHome?: Map<string, number>;
  /** 各系统最近一次实际执行 tick（kernel.runSystems 记录）—— 期望自检的 P3 存活判据输入。heap 存储。 */
  systemLastRun?: Record<string, number>;
}

/**
 * 采购需求 — 消费方向采购方（terminal-manager）传递的结构化需求信号。
 * resource 可是基础矿 / 中间产物 / 化合物 / power / G — 任何可在市场交易的资源。
 */
export interface ProcurementDemand {
  /** 资源类型（基础矿/中间产物/化合物/power/G）。 */
  resource: string;
  /** 缺口量（目标量 - 当前库存）。 */
  amount: number;
  /** 优先级（0-100，越高越急）：反应原料 20-30 / boost 30-40 / commodity 10-15。 */
  priority: number;
  /** 截止 tick（超过则降级/放弃，防僵尸需求）。 */
  deadline: number;
  /** 来源标记（诊断用，如 "lab-reaction" / "factory-commodity" / "boost"）。 */
  reason: string;
}
/**
 * 发布房间采购需求 — 全表唯一写入口（多生产者合并语义）。
 *
 * 历史：lab-system（两处）与 factory-manager 曾各自整表覆写 byRoom[room]，
 * 且 tick 守卫使容器单 tick 存活 —— 后写者覆盖先写者、跨 tick 需求静默蒸发，
 * 终端 200t 相位几乎永远看不到完整需求（lab 基础矿买入通道长期半死）。
 * 合并规则：同资源新发布覆盖旧条目；其他资源条目保留；写入时顺手丢弃已过期项。
 */
export function publishProcurementDemands(
  roomName: string,
  demands: readonly ProcurementDemand[],
  tick: number,
): void {
  const g = globalCache();
  if (!g.procurementDemands) g.procurementDemands = { tick, byRoom: {} };
  g.procurementDemands.tick = tick;
  const merged = new Map<string, ProcurementDemand>();
  for (const d of g.procurementDemands.byRoom[roomName] ?? []) {
    if (d.deadline > tick) merged.set(d.resource, d);
  }
  for (const d of demands) merged.set(d.resource, { ...d });
  g.procurementDemands.byRoom[roomName] = Array.from(merged.values());
}

/** 市场行情快照 — 单种资源在采集时刻的最低卖价与最高买价。 */
export interface MarketPriceSnapshot {
  /** 市场最低卖单价格（买入基准）。0 = 无卖单。 */
  sellMin: number;
  /** 市场最高买单价格（卖出基准）。0 = 无买单。 */
  buyMax: number;
}

/** 编队索引条目 — 仅记录编队判定所需的最小字段集（不持有 Creep 引用）。 */
export interface SquadIndexEntry {
  /** creep 名（用于 recycle 标记等操作）。 */
  name: string;
  /** 角色（attacker / healer / scout / claimer / pbCollector / worker / builder 等）。 */
  role: string;
  /** memory.home — 编队归属房。 */
  home: string;
  /** memory.remoteTarget — 远程目标房（war/PB/远矿/扩张目标）。 */
  remoteTarget?: string;
  /** memory.mission — 任务标记（powerBank / powerCollect）。 */
  mission?: string;
  /** body 中是否有 boost 部件（war-planner boost 门禁判定）。 */
  boosted: boolean;
  /** 是否正在孵化（spawning=true — war-planner 编队统计计入 live 而非 pending）。 */
  spawning: boolean;
}

/**
 * P1-4 拆改计划（完整 Plan 契约）。
 * 生命周期：waiting（替代 link 未建成，construction-manager 检查替代任务 state）→
 * validating（替代建成，等 500t 验证灌能 energy > 0）→ 终态。
 * 终态：success（验证灌能成功 → destroy 旧 link + clearDeadAssetLink）；
 * aborted（ttl 到期 DISMANTLE_TTL=1500t 或替代任务被清理，保留旧 link）；
 * fallback（验证超时且替代 energy=0 → markLinkConstrained + clearDeadAssetLink，避免重复空转）。
 * 战时降级：colonyState === "defense" 时暂停处理（不 destroy，保留计划），恢复 peace 后继续。
 */
export interface DismantlePlan {
  /** 死资产 link 的 id（待拆除）。 */
  deadLinkId: string;
  roomName: string;
  /** 替代 link 的 build task key（用于在 buildQueue 中追踪替代 link 建造状态）。 */
  replacementKey: string;
  /** 替代 link 的位置（验证阶段查找结构用）。 */
  replacementPos: { x: number; y: number };
  startedAt: number;
  /** ttl 到期 tick（startedAt + DISMANTLE_TTL）。到期未完成 → abort。 */
  expiresAt: number;
  /** 当前状态：waiting（等替代建成） / validating（验证替代灌能）。 */
  state: "waiting" | "validating";
  /** 进入 validating 状态的 tick（用于计算验证超时）。state=waiting 时为 undefined。 */
  validatingSince?: number;
}

/** 走廊路路径缓存条目（漏洞 #5/#8）：缓存最高优先级走廊对的 PathFinder 结果，
 * 避免每 50 tick 重算。失效由 signature 比对完成：pairKey + rcl + anchor 任一变化即失效。 */
export interface CorridorPathCacheEntry {
  /** 走廊对签名 "fromx,fromy→tox,toy"，端点变化即失效。 */
  pairKey: string;
  /** 缓存时的 RCL，RCL 升级即失效（解锁新结构，路径可能变化）。 */
  rcl: number;
  /** 缓存时的锚点位置，spawn 重建即失效。 */
  anchor: { x: number; y: number };
  /** PathFinder 计算的路径格列表（未过滤占用）。 */
  path: { x: number; y: number }[];
  tick: number;
}

/** defense-planner 的 min-cut 结果缓存条目：核心结构签名变化 → 重算；
 * 算法版本戳（MINCUT_ALGO_VERSION）拼入 signature 前缀，旧版本缓存自然失效。 */
export interface MinCutCache {
  /** 核心结构位置的签名（含算法版本前缀，用于检测是否需要重算）。 */
  signature: string;
  result: { rampartPositions: { x: number; y: number }[]; complete: boolean };
  tick: number;
}

/** defense-planner 的出口位置缓存条目（room.find(FIND_EXIT) 结果，1000t 过期）。 */
export interface ExitCache {
  positions: { x: number; y: number }[];
  tick: number;
}

/**
 * P0-1：从 squadIndex 中查询编队成员 — 供 war-planner / power-farm-manager /
 * prospect-manager / expansion-manager 复用，替代各自独立遍历 Game.creeps。
 *
 * 过滤维度均为可选：undefined = 不过滤该维度。
 * 返回的条目可直接用于统计计数；如需对 Creep 对象操作（如标记 recycle），
 * 调用方按 name 从 Game.creeps 取 — 这比全量遍历廉价得多（通常 ≤ 十几条）。
 */
export function querySquad(filter: {
  home?: string;
  remoteTarget?: string;
  role?: string;
  mission?: string;
}): readonly SquadIndexEntry[] {
  const idx = globalCache().squadIndex;
  if (!idx) return [];
  return idx.filter(e =>
    (filter.home === undefined || e.home === filter.home) &&
    (filter.remoteTarget === undefined || e.remoteTarget === filter.remoteTarget) &&
    (filter.role === undefined || e.role === filter.role) &&
    (filter.mission === undefined || e.mission === filter.mission),
  );
}

/** Screeps 沙箱 `global` 对象的类型安全访问器。
 * 用 `globalThis` 避免与 `@types/node` 的 `global` 类型冲突（沙箱中二者同一作用域）。
 * 所有字段可选，必须在 global reset 后可惰性重建。 */
export function globalCache(): GlobalCache {
  return globalThis as unknown as GlobalCache;
}
