import type { CpuTier, Priority } from "../kernel/contracts";

/**
 * 根据 RCL 返回每个 source 的目标 work parts 总数（约束 X-02）。
 * RCL1-3: 5 / RCL4-6: 6 / RCL7-8: 8。
 */
export function getSourceTargetWorkParts(rcl: number): number {
  if (rcl >= 7) return CONFIG.assignment.sourceTargetWorkPartsByRcl.high;
  if (rcl >= 4) return CONFIG.assignment.sourceTargetWorkPartsByRcl.mid;
  return CONFIG.assignment.sourceTargetWorkPartsByRcl.low;
}

/**
 * 根据 RCL 返回 wall/rampart 的目标维护血量（约束 G-DF-08）。
 * RCL3-4: 100K / RCL5-6: 1M / RCL7-8: 10M。
 */
export function getWallTargetHits(rcl: number, underSiege = false): number {
  const base = rcl >= 7
    ? CONFIG.defense.wallTargetHits.rcl7_8
    : rcl >= 5
      ? CONFIG.defense.wallTargetHits.rcl5_6
      : CONFIG.defense.wallTargetHits.rcl3_4;
  if (!underSiege) return base;
  // 受袭姿态：近期有真实敌对活动时抬高目标 — 防御深度用实际威胁校准，
  // 和平期不为假想敌过度投资墙体（修墙能量 = 少升的 RCL）。
  // 官方墙体血量上限 300M，封顶防溢出。
  return Math.min(base * CONFIG.defense.siegeWallMultiplier, 300_000_000);
}

export const CONFIG = {
  memory: { schemaVersion: 13 },

  kernel: {
    /** 硬上限以下保留的安全 CPU 余量。 */
    cpuReserve: 0.8,
    logErrors: true,
    /** 相同错误日志的最小重复间隔 tick 数。 */
    errorLogInterval: 25,
    /** creep 被判定为卡位后重新寻路前的 tick 数。 */
    stuckThreshold: 2,
    /** 释放目标前的最大重新寻路次数。 */
    repathLimit: 2,
  },

  telemetry: {
    /** CPU 时序采样间隔（tick）。10 tick 一次 → 500 条 = 5000 tick 窗口。 */
    cpuSampleInterval: 10,
    /** 经济时序采样间隔（tick）。50 tick 一次 → 300 条 = 15000 tick 窗口。 */
    economySampleInterval: 50,
    /** 人口普查间隔（tick）。100 tick 一次，仅保留最新快照。 */
    populationInterval: 100,
    /** 差分事件检测间隔（tick）。与 cpuSampleInterval 对齐。 */
    eventDetectionInterval: 10,
  },

  tuning: {
    /** 调优引擎评估间隔（tick）。500 tick = 10 次 economy 采样窗口。 */
    evalInterval: 500,
  },

  cpu: {
    /** 各档位 bucket 阈值（降级立即生效）。 */
    tiers: {
      healthy: { min: 7000, recoveryHysteresis: 500, recoveryTicks: 20 },
      guarded: { min: 3000, recoveryHysteresis: 500, recoveryTicks: 20 },
      conserve: { min: 1000, recoveryHysteresis: 500, recoveryTicks: 20 },
      recovery: { min: 0, recoveryHysteresis: 500, recoveryTicks: 20 },
    },
    /** 各档位软/硬 CPU 上限（为 20 CPU 服务器设计）。 */
    limits: {
      healthy: { soft: 17.5, hard: 19.2 },
      guarded: { soft: 16, hard: 18.5 },
      conserve: { soft: 14, hard: 17 },
      recovery: { soft: 12, hard: 15.5 },
    },
    /** 各档位允许的最大优先级。 */
    maxPriority: {
      healthy: 4 as Priority,
      guarded: 3 as Priority,
      conserve: 2 as Priority,
      recovery: 1 as Priority,
    },
  },

  spawn: {
    /** body 替换窗口：ticksToLive <= body.length * 3 + 15（+ 路程项，见 demand.needsReplacement）。 */
    replaceBuffer: 15,
    /** 孵化请求被隔离前的最大重试次数。 */
    maxRetries: 5,
    /** 为 P0 恢复 body 预留的最低能量。 */
    recoveryEnergyReserve: 200,
    /**
     * 孵化请求 TTL：cleanQueue 按 expiresAt 清除超期请求，
     * 防止需求消失后的 stale 请求永久排队直至孵化（过量 creep 浪费能量）。
     * 需求仍在时 demand 下一 tick 会以同 key 重建请求（hasKey 守卫解除）。
     *
     * 硬约束：必须大于 trySpawn 的饥饿降级窗口——
     *   P1 饥饿 = 2 × 孵化时长（≈100 tick @ 16 部件），
     *   P2 饥饿 = 10 × 孵化时长（≈540 tick @ 18 部件 upgrader）。
     * 若 TTL 小于该窗口，请求在降级触发前被清除重建、createdAt 重置，
     * 饥饿计时器永远归零 → 重新引入「等满配 → 永远凑不够」死锁（W37S58）。
     */
    requestTtl: 1000,
  },

  movement: {
    /** 本地寻路的 maxRooms。remote 角色未来通过 route/waypoint 跨房，本地任务始终为 1。 */
    localMaxRooms: 1,
  },

  construction: {
    /** 每房最大活跃建造 site 数（普通）。
     * 3：让 priority-1 的 controller container 无需等待 extension 完工即可插队入场，
     * 加速 RCL2→RCL3 站桩升级链路成型。 */
    maxNormalSitesPerRoom: 3,
    /** 每房道路专用 site 名额 — 独立于普通名额，保证走廊路能与 extension 并行建造，
     * 不被 priority 3 饥饿永久挤占。 */
    maxRoadSitesPerRoom: 2,
    /** 每房额外允许的关键 site 数。 */
    maxCriticalSitesPerRoom: 1,
    /** 全局活跃 site 上限。
     * 7：容纳 3 extension + 2 road + 关键 container（source/controller）并行，
     * 避免被毁的 source container 重建被道路/extension 占满名额而阻塞。 */
    maxGlobalSites: 7,
    /** 永久位置冲突任务的黑名单冷却（tick）。
     * blocked 任务连续 3 次 ERR_INVALID_TARGET 被清除后，其 key 进入黑名单，
     * 冷却期内规划器不得重新入队 — 否则「入队 → blocked → 删除 → 再入队」
     * 无限空转。冷却给足 10000 tick：冲突源（如玩家手工建筑）可能被移除。 */
    blockedRetryDelay: 10000,
  },

  layout: {
    /** 布局模式：constraint = 约束推导放置（默认），template = 固定模板（compact-core-v2，fallback）。
     * Phase 6 切换默认值为 constraint；template 保留为极端地形下的回退选项。 */
    mode: "constraint" as "template" | "constraint",
    /** 布局规划器的运行间隔（tick）。 */
    planInterval: 50,
    road: {
      /** 采样窗口内位置被判定为高频的最小通行次数。 */
      minTraffic: 10,
      /** 每房最多返回的道路候选数。 */
      maxCandidates: 5,
      /** 道路采样窗口间隔。 */
      sampleInterval: 50,
    },
  },

  assignment: {
    /** 本地任务租约时长（tick）。
     * 50 tick：builder 从 storage 取能走到工地可能需要 20+ tick，
     * 20 tick 的 lease 会在通勤途中过期，导致每 tick 重新分配任务 — creep 在"摇摆"。
     * 50 tick 给足单趟通勤 + 工作的时间，仅在条件真正变化时（site 消失/container 空）才重分配。 */
    leaseDuration: 50,
    /** 每个 source 的目标 work parts 总数（向后兼容，优先使用分级配置）。 */
    sourceTargetWorkParts: 5,
    /** 每个 source 的目标 work parts 总数，按 RCL 分级（约束 X-02）。 */
    sourceTargetWorkPartsByRcl: {
      low: 5, // RCL1-3
      mid: 6, // RCL4-6
      high: 8, // RCL7-8
    },
    /** 能量低于此阈值时触发紧急抢占 — 释放普通任务转为 fill。 */
    emergencyFillThreshold: 300,
    /** 单个 source 最多可同时分配的矿工数（P2-6：maxWorkers 语义 = creep 数而非目标 WORK 数）。
     * 近似「可站矿位」上限：一个饱和矿工即可采空 source（10/tick），3 为安全上限，
     * 既容纳早期小矿工多开，又杜绝 RCL7-8 时 5-8 个大矿工挤一个 source 过采/堵位。 */
    maxMinersPerSource: 3,
  },

  economy: {
    harvestWorkingParts: 5,
    /** upgrader 允许工作前的最低 extension 能量（RCL1-3）。 */
    upgradeEnergyFloor: 300,
    /** upgrader 允许工作前的最低 storage 能量（RCL4+，约束 G-EN-03/U-02）。 */
    upgradeEnergyFloorStorage: 1000,
    /** builder 允许工作前的最低能量盈余。 */
    buildEnergySurplus: 200,
    /** 触发紧急升级的控制器 ticksToDowngrade 阈值。 */
    controllerDowngradeThreshold: 10000,
    /** 升级功率控制（A2：storage 水位驱动 + RCL8 显式限速）。 */
    upgrade: {
      /** storage 能量 ≥ 此值且 pressure ≤ 0.3 时进入升级冲刺（燃烧库存换 RCL 复利）。 */
      sprintStorage: 50000,
      /** storage 能量 ≥ 此值时维持大 body 满功率升级（≈ 盈余全喂 controller）。 */
      sustainedStorage: 10000,
      /** RCL8 官方升级功率上限（energy/tick），换算为 WORK 部件数。 */
      rcl8MaxWorkParts: 15,
      /** upgrader 单次从 storage 取能上限（防止 storage 突降触发 economyPressure）。 */
      perTickWithdrawLimit: 500,
    },
    /** 能量危机检测与响应参数。 */
    crisis: {
      /** source 能量高于此比例视为采集不足（harvester 失效）。 */
      sourceFullRatio: 0.85,
      /** energyAvailable 低于 capacity×此比例视为储备低。 */
      energyThresholdRatio: 0.4,
      /** 储备阈值固定上限。 */
      energyThresholdCap: 400,
      /** 危机分数达到此值进入危机（scoreStep 10 → 需持续 ~50 tick）。 */
      enterScore: 100,
      /** 危机分数降到此值退出危机（迟滞）。 */
      exitScore: 40,
      /** 每次评估（room-observer 每 5 tick）的分数变化量。 */
      scoreStep: 10,
      /** 危机时仅当 ticksToDowngrade 低于此值才保留 1 个 upgrader 保级，否则停升级省能。 */
      downgradeGuard: 3000,
    },
    /** Link 传输参数。 */
    link: {
      /** source link 发起传输的最小能量阈值（P1-4：攒够再发，避免小额传输占冷却致 source link 溢出）。 */
      minTransfer: 400,
    },
    /** Storage 满仓阈值 — 超过此比例时触发限采 + 加速消费。 */
    storageFullThreshold: 0.9,
  },

  defense: {
    /** 联盟白名单：owner 命中者一律视为非威胁（不逃跑 / 不开火 / 不停经济）。 */
    allies: [] as readonly string[],
    /** 无塔时，威胁 creep 靠近 spawn/controller 至此 range 内才激活 safe mode（避免过境 scout 误烧）。 */
    safeModeTriggerRange: 5,
    /** 非战斗 creep 的逃跑触发距离：威胁 creep 在此范围内才逃跑（P1-1）。
     * 远端过境的威胁不会中断经济；靠近时才触发 flee。 */
    fleeRange: 10,
    /** Hauler 在 flee 状态下的"防御圈内安全充能"半径（P0-2 修复）。
     * 当 hauler 距 spawn ≤ 此值且携带能量时，允许向防御圈内的需能量结构（tower 优先）充能。
     * 解决战斗中 Tower 能量耗尽无人补给的死局，细化 G-SM-05 的语义。 */
    safeRefuelRange: 3,
    /** Tower 维修 wall/rampart 的目标血量，按 RCL 分级（约束 G-DF-08）。 */
    wallTargetHits: {
      rcl3_4: 100_000,
      rcl5_6: 1_000_000,
      rcl7_8: 10_000_000,
    },
    /** 受袭记忆窗口（tick）：lastHostileAt 距今小于此值视为受袭姿态。 */
    siegeMemoryTicks: 10000,
    /** 受袭姿态下 wall/rampart 目标血量的放大倍数。 */
    siegeWallMultiplier: 5,
  },

  roles: {
    harvester: { minCount: 2, maxCount: 4 },
    hauler: { minCount: 2, maxCount: 6 },
    distributor: { minCount: 1, maxCount: 3 },
    upgrader: { minCount: 1, maxCount: 3 },
    builder: { minCount: 1, maxCount: 4 },
    worker: { minCount: 0, maxCount: 2 },
    // 本房防御者：仅在房内出现威胁时按威胁数孵化（见 demand 的防御响应块）。
    defender: { minCount: 0, maxCount: 2 },
    // 远矿角色：每远矿目标 1 harvester + 1 hauler + 1 reserver
    remoteHarvester: { minCount: 0, maxCount: 6 },
    remoteHauler: { minCount: 0, maxCount: 6 },
    reserver: { minCount: 0, maxCount: 3 },
    // 扩张占领：同一时刻至多一个扩张行动（见 expansion-manager）。
    claimer: { minCount: 0, maxCount: 1 },
  },

  debug: {
    /** 在 creep 头顶绘制状态指示灯（work=绿 / acquire=黄 / idle=红 / flee=橙）。
     * 纯诊断功能，默认关闭。开启时每 creep 每 tick 约 0.001-0.005 CPU。
     * 用法：需要诊断时把此值改 true 重新构建上传即可，无需改其他代码。 */
    statusLight: false,
    /** Action 级 CPU profiling 开关。
     * 开启时每个 creep 的每个 action 的 resolve/execute 调用都会用 Game.cpu.getUsed() 测量。
     * 每次测量约 0.001 CPU，50 creep × 5 actions × 2 calls = ~0.5 CPU/tick 额外开销。
     * 仅在需要定位 CPU 热点时开启，平时关闭。数据在 globalCache 中按 tick 聚合。 */
    actionProfiling: false,
  },

  remote: {
    /** 远矿管理器运行间隔（tick）。 */
    managerInterval: 10,
    /** 最大同时运营远矿目标数（CPU 预算保护）。 */
    maxOperations: 2,
    /** 每个远矿目标的 harvester 数。 */
    harvestersPerTarget: 1,
    /** 每个远矿目标的 hauler 数。 */
    haulersPerTarget: 1,
    /** 是否启用 reserver（RCL3+ 才有意义，CLAIM 部件 600 能量）。 */
    enableReserver: true,
    /** 是否启用 remoteDefender（远矿防御者，杀 NPC reserver/Invader）。 */
    enableDefender: true,
    /** 远矿目标过期 tick 数（lastSeen 超过此值则暂停运营）。 */
    staleThreshold: 5000,
    /** 远矿启用 RCL 门限（低于此 RCL 不开远矿，集中能量发展本房）。 */
    minRcl: 4,
    /** 远矿房威胁的危险冷却（tick）— 冷却期内不作为新远矿/扩张候选。 */
    dangerCooldown: 2000,
  },

  expansion: {
    /** 扩张管理器运行间隔（tick）。 */
    interval: 100,
    /** sponsor 房最低 RCL — 经济未成熟不供养殖民行动。 */
    sponsorMinRcl: 5,
    /** 拓荒编队规模：worker（采集/填充/升级）+ builder（建 spawn）。 */
    pioneerWorkers: 2,
    pioneerBuilders: 2,
    /** claim 阶段超时（claimer 寿命 600 + 通勤 + 重派余量）。 */
    claimTimeout: 6000,
    /** 拓荒阶段超时 — 到期仅停止编队补充，房间保留自治。 */
    pioneerTimeout: 20000,
    /** 失败目标的黑名单冷却。 */
    blacklistCooldown: 20000,
  },

  factory: {
    /** 运行间隔（tick）— battery 生产冷却即为 10，更高频率无收益。 */
    interval: 10,
    /** battery 单批配方能量（COMMODITIES battery: 600 energy → 50 battery）。 */
    batchEnergy: 600,
    /** distributor 为 factory 维持的能量库存目标（5 批缓冲）。 */
    stockTarget: 3000,
  },

  market: {
    /** 交易系统运行间隔（tick）— getAllOrders 是重调用，必须低频。 */
    interval: 200,
    /** bucket 低于此值不做市场操作（贸易不是生存关键）。 */
    minBucket: 8000,
    /**
     * 各基础矿物最高买入价（credits/单位）— 高于此价宁可等待。
     * 基础矿物市价常年低于 1，X 稀缺溢价更高；价格随赛季波动，按需调整。
     */
    maxBuyPrice: {
      H: 1.5, O: 1.5, U: 1.5, L: 1.5, K: 1.5, Z: 1.5, X: 5,
    } as Readonly<Record<string, number>>,
    /** 本房矿物最低卖出价 — 低于此价不贱卖（宁可囤着等行情）。 */
    minSellPrice: 0.3,
    /** 卖出保留量：本房矿物合计低于此量不卖（留作自用反应原料）。 */
    sellReserve: 3000,
    /** 单笔 deal 最大成交量 — 控制单笔运费与坏单风险。 */
    maxDealAmount: 1000,
    /** terminal 能量储备目标 — deal 双向都从本方 terminal 扣能量运费。 */
    energyTarget: 10000,
    /** storage 能量低于此值时不给 terminal 备能（经济优先于贸易）。 */
    storageEnergyFloor: 20000,
    /** credits 低于此值暂停买入（保留应急余额）。 */
    creditFloor: 100,
  },
} as const;

/** 类型安全的档位上限查询。 */
export function tierLimits(tier: CpuTier): { soft: number; hard: number } {
  return CONFIG.cpu.limits[tier];
}

/** 类型安全的最大优先级查询。 */
export function tierMaxPriority(tier: CpuTier): Priority {
  return CONFIG.cpu.maxPriority[tier];
}
