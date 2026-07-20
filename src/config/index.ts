import type { CpuTier, Priority } from "../kernel/contracts";

export const CONFIG = {
  memory: { schemaVersion: 3 },

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
    /** body 替换窗口：ticksToLive <= body.length * 3 + 15。 */
    replaceBuffer: 15,
    /** 孵化请求被隔离前的最大重试次数。 */
    maxRetries: 5,
    /** 为 P0 恢复 body 预留的最低能量。 */
    recoveryEnergyReserve: 200,
  },

  construction: {
    /** 每房最大活跃建造 site 数（普通）。 */
    maxNormalSitesPerRoom: 2,
    /** 每房额外允许的关键 site 数。 */
    maxCriticalSitesPerRoom: 1,
    /** 全局活跃 site 上限。 */
    maxGlobalSites: 5,
  },

  layout: {
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
    /** 每个 source 的目标 work parts 总数。 */
    sourceTargetWorkParts: 5,
    /** 能量低于此阈值时触发紧急抢占 — 释放普通任务转为 fill。 */
    emergencyFillThreshold: 300,
  },

  economy: {
    harvestWorkingParts: 5,
    /** upgrader 允许工作前的最低能量水平。 */
    upgradeEnergyFloor: 300,
    /** builder 允许工作前的最低能量盈余。 */
    buildEnergySurplus: 200,
    /** 触发紧急升级的控制器 ticksToDowngrade 阈值。 */
    controllerDowngradeThreshold: 10000,
  },

  roles: {
    harvester: { minCount: 2, maxCount: 4 },
    hauler: { minCount: 2, maxCount: 4 },
    upgrader: { minCount: 1, maxCount: 3 },
    builder: { minCount: 1, maxCount: 2 },
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
