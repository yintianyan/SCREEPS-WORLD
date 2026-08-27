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
  /** P3 能量核算 L1 计数器（bumpEnergyCounter 写入；economy 系统每窗滚动消费）。 */
  energyLedger?: { tick: number; rooms: Record<string, RoomEnergyCounters> };
  /** P3 物流请求池槽位（logistics 系统每 tick 重导出；assignment-service 同 tick 合并）。 */
  transportPool?: { tick: number; rooms: Record<string, unknown[]> };
  // 【F-DEAD-1 已删除】logisticsCounters — L1 物流指标从未落地，全库零引用。
  // 物流空载率指标为纸面功能，若需重引入须同时接线生产者与消费者。
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
  /** R2：construction-manager 跳过原因 L1 计数（heap — 观测数据不上 Memory，
   * STATE_OWNERSHIP §3.10）。rooms 按窗口聚合，结构化日志输出后清零。 */
  constructionSkips?: {
    rooms: Record<string, Record<string, number>>;
    total: number;
    lastReportTick?: number;
  };
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
  /** P3 核算诊断：最近一次漂移事件的窗口分解（economy 写，观测/归因用）。
   * 【WO-4 修复】弱消费诊断字段 — 只能 console 手查。若要保留应挂到
   * decision-trace 或 Memory 短期快照；否则等于没记。保留在 heap 供 console 内省。 */
  lastDriftDiag?: unknown;
  // 【F-DEAD-2 已删除】empireTransportRequests — A3.0 帝国级跨房调拨请求池
  // 连生产者都不存在（agenda-manager 不写、logistics 不读），只有 cache 槽位和
  // 文档描述。若 A3.0 帝国调拨进入路线图，须重新设计完整链路而非留假装存在的槽位。
  /** A3.0：Agenda Manager 运行时指标快照（agenda-manager 每 100t 写入）。
   * 【WO-3 修复】标注为诊断观测字段 — 目前无代码消费者，但保留在 heap 上
   * 供 console 内省归因使用。若后续接入 decision-trace 应明确接线。 */
  agendaMetrics?: import("../domain/operation/metrics").OperationMetrics;
  /** A3.1：Resource Network Snapshot（agenda-manager 每 100t 写入）。
   * heap 存储 — global reset 丢失可接受。 */
  networkSnapshot?: import("../domain/operation/network-snapshot").NetworkSnapshot;
  /** A3.1：Network Health 指标（agenda-manager 每 100t 写入）。
   * heap 存储 — global reset 丢失可接受。 */
  networkHealth?: import("../domain/operation/network-health").NetworkHealthResult;
  /** A3.2：Expansion Dashboard（expansion-planner 每 interval tick 写入）。
   * heap 存储 — global reset 丢失可接受。 */
  expansionDashboard?: import("../domain/expansion/dashboard").ExpansionDashboard;
  /** A4.2：多资源帝国健康度（empire-economy 每 100t 写入）。
   * heap 存储 — global reset 丢失可接受（下个周期重建）。 */
  multiResourceHealth?: import("../domain/strategy/multi-resource-health").MultiResourceEmpireHealth;
  /** A4.2：资源瓶颈排序列表（empire-economy 每 100t 写入）。
   * 【WO-1 修复】标注为诊断观测字段 — 目前无代码消费者，但保留在 heap 上
   * 供 console 内省归因使用。若后续接入 decision-trace 应明确接线。 */
  resourceBottlenecks?: import("../domain/economy/bottleneck").BottleneckEntry[];
  /** A4.2：帝国级 Resource Ledger（empire-economy 每 100t 写入）。
   * 【WO-2 修复】标注为诊断观测字段 — 目前无代码消费者，但保留在 heap 上
   * 供 console 内省归因使用。若后续接入 decision-trace 应明确接线。 */
  empireResourceLedger?: import("../domain/economy/resource-ledger").ResourceLedger;
  /** A4.3：Empire Logistics Plan（logistics-planner 每 100t 写入）。
   * 包含 Transport Requests + Routes + 成本/时间/风险估算。
   * heap 存储 — global reset 丢失可接受（下个周期重建）。 */
  logisticsPlan?: { tick: number; plan: import("../domain/logistics/transport-plan").TransportPlan };
  /** A4.3：Empire Logistics Dashboard（logistics-planner 每 100t 写入）。
   * 【WO-5 修复】标注为观测仪表盘 — 目前无代码消费者（getLogisticsDashboard 零调用），
   * 保留在 heap 供 console 内省。若后续接入 decision-trace metrics 快照即可接线。 */
  logisticsDashboard?: import("../domain/logistics/dashboard").LogisticsDashboard;
  /** A4.3：Empire Logistics Health（logistics-planner 每 100t 写入）。
   * heap 存储 — global reset 丢失可接受。 */
  logisticsHealth?: import("../domain/logistics/logistics-health").LogisticsHealthResult;
  /** A4.3：Empire Logistics Capacity（logistics-planner 每 100t 写入）。
   * heap 存储 — global reset 丢失可接受。 */
  logisticsCapacity?: { tick: number; result: import("../domain/logistics/capacity-planning").EmpireCapacityResult };
  /** A4.3：Hauler 扩缩编决策（logistics-planner 每 100t 写入）。
   * key = roomName, value = ScalingDecision。
   * 【WO-7 修复】标注为观测字段 — getScalingDecision 零调用方，
   * 保留在 heap 供 console 内省。若后续接入 spawn-manager 扩缩编可接线。 */
  logisticsScaling?: { tick: number; decisions: Record<string, import("../domain/logistics/hauler-scaling").ScalingDecision> };
  /** A4.3：闲置 hauler 名称列表（logistics-planner 每 100t 写入）。
   * heap 存储 — global reset 丢失可接受。 */
  logisticsIdleHaulers?: { tick: number; names: string[] };
  /** A4.4：Transport Accounting 运行时追踪（logistics-planner 每 100t 写入）。
   * 包含 summary 统计 + entries 每条 Request 的会计明细。
   * 【WO-6 修复】标注为观测字段 — summary+entries 均无代码消费者，
   * 保留在 heap 供 console 内省。若后续接入 decision-trace metrics 快照即可接线。 */
  logisticsAccounting?: {
    tick: number;
    summary: {
      totalRequested: number;
      totalAssigned: number;
      totalLoaded: number;
      totalDelivered: number;
      totalLost: number;
      totalRemaining: number;
      totalCost: number;
      avgDeliveryRate: number;
      avgLossRate: number;
      completedCount: number;
      activeCount: number;
    };
    entries: import("../domain/logistics/transport-accounting").TransportAccounting[];
  };
  /** A4.5：Empire Health 综合评估结果（empire-health-system 每 100t 写入）。
   * 包含 8 维度健康度 + Hysteresis 等级 + 瓶颈维度 + 恢复中标记。
   * heap 存储 — global reset 丢失可接受（下个周期重建）。 */
  empireHealth?: import("../domain/strategy/empire-health").EmpireHealthResult;
  /** A4.5：Failure Propagation 失败传播图（empire-health-system 每 100t 写入）。
   * 包含活跃失败节点 + 传播边 + 根因/症状标记。
   * heap 存储 — global reset 丢失可接受。 */
  failureGraph?: import("../domain/strategy/failure-propagation").FailureGraph;
  /** A4.5：Recovery Priority 恢复优先级列表（empire-health-system 每 100t 写入）。
   * 排序后的恢复动作列表，供执行系统消费。
   * heap 存储 — global reset 丢失可接受。 */
  recoveryActions?: import("../domain/strategy/recovery-priority").RecoveryAction[];
  /** A4.5：Autonomy Status 自治状态（empire-health-system 每 100t 写入）。
   * 包含 Autonomy Score + No-Progress + Thrashing 检测结果。
   * heap 存储 — global reset 丢失可接受。 */
  autonomyStatus?: import("../domain/strategy/autonomy-metrics").AutonomyStatus;
  /** A4.5：Recovery Cooldown Table（empire-health-system 维护，跨 tick 持久）。
   * key = cooldownKey(domain, room)，value = cooldown entry。
   * heap 存储 — global reset 丢失可接受（冷却期短，重开后快速重建）。 */
  recoveryCooldowns?: import("../domain/strategy/recovery-priority").CooldownTable;
  /** A4.5：健康度历史（empire-health-system 追踪，用于 Thrashing 检测）。heap 存储。 */
  __healthHistory?: Array<{ tick: number; level: string; score: number }>;
  /** A4.5：姿态历史（empire-health-system 追踪，用于 Thrashing 检测）。heap 存储。 */
  __postureHistory?: Array<{ tick: number; posture: string }>;
  /** A4.5：净能量流历史（empire-health-system 追踪，用于 No-Progress 检测）。heap 存储。 */
  __netFlowHistory?: number[];
  /** A4.5：总储备历史（empire-health-system 追踪，用于 No-Progress 检测）。heap 存储。 */
  __reserveHistory?: number[];
  /** A4.5：总人口历史（empire-health-system 追踪，用于 No-Progress 检测）。heap 存储。 */
  __populationHistory?: number[];
  /** A4.5：失败计数历史（empire-health-system 追踪，用于 No-Progress 检测）。heap 存储。 */
  __failureCountHistory?: number[];
  /** A4.5：连续稳态 tick 数（empire-health-system 追踪，用于 Autonomy Score）。heap 存储。 */
  __consecutiveStableTicks?: number;
  /** A4.5：累计检测到的失败数（empire-health-system 追踪，用于 Autonomy Score）。heap 存储。 */
  __totalFailuresDetected?: number;
  /** A4.5：累计自动恢复的失败数（empire-health-system 追踪，用于 Autonomy Score）。heap 存储。 */
  __autoRecoveredFailures?: number;
  /** A4.5：累计扰动次数（empire-health-system 追踪，用于 Autonomy Score）。heap 存储。 */
  __perturbationCount?: number;
  /** A4.5：累计恢复总时间（empire-health-system 追踪，用于 Autonomy Score）。heap 存储。 */
  __totalRecoveryTime?: number;
  /** A4.5：失败领域循环计数（empire-health-system 追踪，用于 Thrashing 检测）。heap 存储。 */
  __failureDomainCycles?: Record<string, number>;
  /** A4.6：Recovery Action 追踪表（recovery-execution-system 维护，跨 tick 持久）。
   * key = idempotencyKey(domain:type:room)，value = RecoveryActionRecord。
   * heap 存储 — global reset 丢失可接受（冷却期短，重开后快速重建）。 */
  recoveryActionTable?: import("../domain/strategy/recovery-lifecycle").RecoveryActionTable;
  /** A4.6：Recovery 统计数据（recovery-execution-system 每 interval tick 写入）。heap 存储。 */
  recoveryStats?: import("../domain/strategy/recovery-lifecycle").RecoveryStats;
  /** A4.6：Recovery Before-State 快照（用于 Verification 的 Before/After 对比）。heap 存储。 */
  recoveryBeforeStates?: Map<string, import("../domain/strategy/recovery-lifecycle").RecoveryWorldSnapshot>;
  /** A4.7：Decision Trace 缓存（Ring Buffer + Snapshot Registry + seq）。
   * heap 存储 — global reset 丢失可接受（trace 是调试/可观测设施，非持久真相）。 */
  __decisionTraceCache?: unknown;
  /** A5.1：per-tick 威胁评估结果（room-state 每 tick 对有威胁的自有房写入）。
   * key = roomName，value = ThreatAssessment。tower-defense / war-planner 消费。
   * heap 存储 — global reset 丢失可接受（下 tick 重建）。仅 threatCount > 0 的房有条目。 */
  threatAssessments?: Map<string, import("../domain/defense/threat-assessment").ThreatAssessment>;
  /** A5.1：per-tick 远矿防御决策结果（remote-mining-manager 按 interval 写入）。
   * key = targetRoomName，value = RemoteDefenseDecision。供 decision-trace 消费。
   * heap 存储 — global reset 丢失可接受。 */
  remoteDefenseDecisions?: Map<string, import("../domain/defense/remote-defense").RemoteDefenseDecision>;
  /** A5.3：per-interval 军事行动计划结果（war-planning-system 按 interval 写入）。
   * 供 war-planner / decision-trace 消费。heap 存储 — global reset 丢失可接受。 */
  warPlanCache?: { tick: number; plan: import("../domain/military/war-planning").WarPlan | undefined };
  /** A5.3：战争物流需求（war-planning-system 从 WarPlan.logisticsRequirement 提取写入）。
   * 供 logistics-planner 消费作为额外 demand node。heap 存储 — global reset 丢失可接受。 */
  warLogisticsDemand?: {
    tick: number;
    sponsor: string;
    targetRoom: string;
    energy: number;
    boost: number;
    transport: number;
    replacement: number;
  };
  /** A6.1：Experience Collector 缓存（Ring Buffer + seq + processedIds）。
   * heap 存储 — global reset 丢失可接受（experience 是可观测设施，非持久真相）。 */
  __experienceCache?: unknown;
  /** A6.2：Strategy Evaluation 缓存（Ring Buffer + lastEvaluationTick）。
   * heap 存储 — global reset 丢失可接受（evaluation 是可观测设施，非持久真相）。 */
  __evaluationCache?: unknown;
  /** A5.3：战争止损信号（war-planner demobilize 时写入）。
   * 供 recovery-execution-system 消费，触发经济恢复动作。
   * A5.3.1 GAP-1 修复：recovery-execution-system 通过纯函数 mapAbortSignalsToRecoveryActions
   * 将信号转换为 RecoveryAction，复用 A4.6 lifecycle 幂等机制。
   * heap 存储 — global reset 丢失可接受。 */
  warAbortSignals?: {
    tick: number;
    reason: string;
    targetRoom: string;
    sponsor: string;
    spawned: number;
    outcome: string;
    /** A5.3 operationId（如果来自 A5.3 路径，供 Decision Trace 追踪）。 */
    operationId?: string;
  };

  /** AI-2 修复：最近一次扩张结果摘要（heap only）。
   * 由 recordExpansionOutcome 写入，供 experience-collector 的
   * buildOutcomeCollectionInput case "expansion" 通过 decisionId 匹配读取。
   * decisionId 是唯一稳定关联键：由 collectExpansionDecisions 分配，
   * 存储在 Memory.kernel.expansion.decisionId 中，整个扩张生命周期不变。
   * heap 存储 — global reset 丢失可接受（与 ring buffer 同生命周期）。 */
  lastExpansionOutcome?: {
    /** 目标房名。 */
    target: string;
    /** outcome code: 0=success, 1=stolen, 2=timeout, 3=lost, 4=aborted */
    outcomeCode: number;
    /** 扩张完成/终止 tick。 */
    completedTick: number;
    /** 扩张持续时间（tick）。 */
    duration: number;
    /** 扩张开始 tick（expansion.startedAt）— 最后一次状态转换的 tick。
     * 注意：startedAt 在状态机推进中被反复覆盖，不能作为唯一关联键。 */
    startedAt: number;
    /** 关联的 DecisionRecord.decisionId — 唯一稳定关联键。
     * 与 ExperienceRecord.decision.decisionId 直接匹配。 */
    decisionId?: string;
  };

  // ── A6.3 Prediction Layer ──────────────────────────────────

  /** A6.3：Prediction 缓存（PredictionRingBuffer + TimeSeries 集合 + seq）。
   * heap 存储 — global reset 丢失可接受（prediction 是可观测设施，非持久真相）。
   * PRED-001：预测层唯一可写的 globalCache 字段。 */
  __predictionCache?: unknown;

  /** A6.4：Calibration 缓存（CalibrationRingBuffer + profiles + failureStats）。
   * heap 存储 — global reset 丢失可接受（calibration 是可观测设施，非持久真相）。
   * CAL-001：校准层唯一可写的 globalCache 字段。 */
  __calibrationCache?: unknown;

  /** A6.3：CPU bucket 历史采样（寄生 empire-health-system 100t cadence）。
   * 用于 CPU 压力预测（#7）。heap 存储 — global reset 后从空重建。
   * 【WO-8 修复】采样器在跑但 prediction-system 不读此序列。待 A6.3 预测层
   * 接入 #7 目标时接线，或在不使用预测时删除采样省 CPU。 */
  __cpuBucketHistory?: import("../domain/intelligence/prediction/time-series").TimeSeries<number>;

  /** A6.3：Spawn 队列深度历史采样（寄生 empire-health-system 100t cadence）。
   * 用于孵化饥饿预测（#2）。heap 存储 — global reset 后从空重建。 */
  __spawnQueueDepthHistory?: import("../domain/intelligence/prediction/time-series").TimeSeries<number>;

  /** A6.3：物流健康度历史采样（寄生 empire-health-system 100t cadence）。
   * 用于物流瓶颈预测（#3）。heap 存储 — global reset 后从空重建。
   * 【WO-9 修复】采样器在跑但 prediction-system 不读此序列。待 A6.3 预测层
   * 接入 #3 目标时接线，或在不使用预测时删除采样省 CPU。 */
  __logisticsHealthHistory?: import("../domain/intelligence/prediction/time-series").TimeSeries<{
    score: number;
    deliveryRate: number;
    lossRate: number;
  }>;

  /** A6.3：房间健康度历史采样（寄生 empire-health-system 100t cadence）。
   * 用于房间崩溃预测（#4）。key = roomName, value = TimeSeries。
   * heap 存储 — global reset 后从空重建。
   * 【WO-10 修复】采样器在跑但 prediction-system 不读此序列。待 A6.3 预测层
   * 接入 #4 目标时接线，或在不使用预测时删除采样省 CPU。 */
  __roomHealthHistory?: Map<string, import("../domain/intelligence/prediction/time-series").TimeSeries<{
    score: number;
    level: string;
  }>>;

  /** A6.3：远矿收益历史采样（寄生 expansion-planner 100t cadence）。
   * 用于远矿失败预测（#5）。heap 存储 — global reset 后从空重建。
   * 【WO-11 修复】采样器在跑但 prediction-system 不读此序列。待 A6.3 预测层
   * 接入 #5 目标时接线，或在不使用预测时删除采样省 CPU。 */
  __remoteMiningHistory?: import("../domain/intelligence/prediction/time-series").TimeSeries<{
    netIncome: number;
    threatCount: number;
  }>;

  /** A6.6：Recommendation 缓存（RecommendationRingBuffer + lastRunTick）。
   * heap 存储 — global reset 丢失可接受（recommendation 是可观测设施，非持久真相）。
   * REC-001：Recommendation Engine 唯一可写的 globalCache 字段。 */
  __recommendationCache?: unknown;
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

/**
 * P3 能量核算 L1 计数器（平台 Metrics 设施，ENERGY_ACCOUNTING_MODEL §2）。
 * 结构镜像 domain/economy/accounting.EnergyLedger —— kernel 不 import 业务类型，
 * 两侧字段集必须保持一致（economy 系统按结构消费）。
 */
export interface RoomEnergyCounters {
  harvested: number;
  pickedUp: number;
  spawned: number;
  recycledRefund: number;
  upgraded: number;
  built: number;
  repaired: number;
  towerSpent: number;
  // 【审计修复 Phase 4-5】市场交易能量入 L1 账本 — 买入/卖出的能量量。
  // 消除 drift 恒等式的市场交易缺口（之前 market.deal 的能量买卖未入账，
  // pool 变化被 drift 捕获但不精确）。
  bought: number;
  sold: number;
}

export type EnergyCounterField = keyof RoomEnergyCounters;

/**
 * L1 计数累加（每 tick 近零成本，R6 声明：聚合档位=economy 50tick 窗）。
 * 计数在堆生命周期内**累计**（不按 tick 重置）——核算窗取前后两次累计差值，
 * 中间 tick 的账不丢。非法输入（非有限/非正）静默忽略，维持 ≥0 不变量。
 * global reset 清零可接受：economy 系统按「无基线/tick 断档」重新播种窗口起点。
 */
export function bumpEnergyCounter(roomName: string, field: EnergyCounterField, amount: number): void {
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  const g = globalCache();
  if (g.energyLedger === undefined) {
    g.energyLedger = { tick: (globalThis as { Game?: { time?: number } }).Game?.time ?? 0, rooms: {} };
  }
  const entry = g.energyLedger.rooms[roomName] ??= { harvested: 0, pickedUp: 0, spawned: 0, recycledRefund: 0, upgraded: 0, built: 0, repaired: 0, towerSpent: 0, bought: 0, sold: 0 };
  entry[field] += amount;
}
/** Screeps 沙箱 `global` 对象的类型安全访问器。
 * 用 `globalThis` 避免与 `@types/node` 的 `global` 类型冲突（沙箱中二者同一作用域）。
 * 所有字段可选，必须在 global reset 后可惰性重建。 */
export function globalCache(): GlobalCache {
  return globalThis as unknown as GlobalCache;
}
