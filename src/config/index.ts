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
export function getWallTargetHits(rcl: number): number {
  if (rcl >= 7) return CONFIG.defense.wallTargetHits.rcl7_8;
  if (rcl >= 5) return CONFIG.defense.wallTargetHits.rcl5_6;
  return CONFIG.defense.wallTargetHits.rcl3_4;
}

export const CONFIG = {
  memory: { schemaVersion: 8 },

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
    /** 本地任务租约时长（tick）。 */
    leaseDuration: 20,
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
    /** Tower 维修 wall/rampart 的目标血量，按 RCL 分级（约束 G-DF-08）。 */
    wallTargetHits: {
      rcl3_4: 100_000,
      rcl5_6: 1_000_000,
      rcl7_8: 10_000_000,
    },
    rampartTargetHits: {
      rcl3_4: 100_000,
      rcl5_6: 1_000_000,
      rcl7_8: 10_000_000,
    },
  },

  roles: {
    harvester: { minCount: 2, maxCount: 4 },
    hauler: { minCount: 2, maxCount: 6 },
    upgrader: { minCount: 1, maxCount: 3 },
    builder: { minCount: 1, maxCount: 4 },
    worker: { minCount: 0, maxCount: 2 },
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
