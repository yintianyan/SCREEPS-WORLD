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
export function getWallTargetHits(
  rcl: number,
  underSiege = false,
  role: import("../kernel/contracts").FortificationRole = "perimeter",
): number {
  // utility（container 等低值资产叠盾）：保护对象价值低于全额维护成本，
  // 只维持新生急救地板 — 受袭也不升档（该格塌了损失有限，能量留给周界）。
  if (role === "utility") return CONFIG.defense.rampartBootstrapHits;
  const base = rcl >= 7
    ? CONFIG.defense.wallTargetHits.rcl7_8
    : rcl >= 5
      ? CONFIG.defense.wallTargetHits.rcl5_6
      : CONFIG.defense.wallTargetHits.rcl3_4;
  // core（结构叠盾）：只需撑过「周界已破 → 塔/defender 处理」的窗口，
  // 全额目标的折扣档 — 消除内圈盾与周界同价维护的经济黑洞。
  const scaled = role === "core"
    ? Math.round(base * CONFIG.defense.coreRampartFactor)
    : base;
  if (!underSiege) return scaled;
  // 受袭姿态：近期有真实敌对活动时抬高目标 — 防御深度用实际威胁校准，
  // 和平期不为假想敌过度投资墙体（修墙能量 = 少升的 RCL）。
  // 官方墙体血量上限 300M，封顶防溢出。
  return Math.min(scaled * CONFIG.defense.siegeWallMultiplier, 300_000_000);
}

export const CONFIG = {
  memory: { schemaVersion: 14 },

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
    /** 自愿放血宽限窗口（tick）— generatePixel 后 tier 地板抬到 conserve 的时长。
     * pixel 吃光整个 bucket（10000），但每 tick 20 CPU 限额不受影响：
     * 常态负载 ~2-5 CPU 时降到 recovery（冻结 P2 经济角色）是看门狗误判。
     * 700 覆盖 0 → conserve 阈值(1000+滞回) 的自然爬升（~+15/tick ≈ 100 tick）
     * 加数轮滞回等待；窗口内若 CPU 真实超支，逐 tick 硬上限仍然兜底。 */
    pixelGraceTicks: 700,
  },

  pixel: {
    /** Pixel 收割总开关 — 默认关闭。
     * generatePixel 吃光整个 bucket（10000 → 0），若清零时刻恰逢 global reset
     * （代码部署 / 服务器迁移），bundle 加载成本 > tickLimit(≈20) 会触发
     * reload death loop：每 tick 加载即被杀 → 被杀 tick 按 tickLimit 计费 →
     * bucket 永不回充 → 主循环永久死亡（线上实测：心跳停摆 187+ tick，
     * 全房 creep 冻结，靠上传空 loop 急救才恢复）。
     * 开启前置条件：bundle 经压缩后加载成本 ≪ 20 CPU，且接受放血后
     * ~600 tick 的 P3 降档窗口。 */
    enabled: false,
  },

  spawn: {
    /** body 替换窗口：ticksToLive <= body.length * 3 + 15（+ 路程项，见 demand.needsReplacement）。 */
    replaceBuffer: 15,
    /** 孵化请求被隔离前的最大重试次数。 */
    maxRetries: 5,
    /** 为 P0 恢复 body 预留的最低能量。 */
    recoveryEnergyReserve: 200,
    /** 饥饿超时降级的最低 body 成本地板。
     * 饥饿降级若无地板，会在能量池低谷按瞬时能量铸出残废 body（如 1C1M distributor），
     * 该 creep 存活整个生命周期无提前替换 → 吞吐塌方 → 水位持续低迷 →
     * 后续请求同样饥饿降级，形成自强化回路。降级产物低于地板时继续排队等能量；
     * 生存降级路径（P0 / bootstrap / recovery）豁免，保「速出保命」语义。 */
    starvationDegradeFloor: 300,
    /** Distributor 升编趋势确认窗口（tick）。
     * spawn 孵化瞬间抽干 spawn/extension → fillTargets 尖峰，这是 distributor 的
     * 日常工作信号而非缺员信号（在途 distributor 一两趟即可补满）。
     * 扩编（超出现有编制）必须等需求持续此窗口才生效 — 150 tick 足够现有编制
     * 跑 2-3 趟补满尖峰；补足 minCount 地板与缩编不受确认约束。
     * 防止一次 50 tick 的瞬时尖峰换来多个活 1500 tick 的常驻编制。 */
    distributorScaleUpDelay: 150,
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
    /**
     * Traffic Manager 总开关。
     * 开启：角色执行期只登记移动意图，tick 末 traffic-manager 后置系统
     * 按房集中解算（同格仲裁/对向换位/推挤静止者/锚定豁免）后统一签发 move；
     * yield/pull 旧让路机制同时短路禁用（双仲裁并存会互相打架）。
     * 关闭：登记函数直通引擎 move（完全恢复旧行为），后置系统空转 —
     * 单开关双向切换，是本机制的唯一回滚通道。
     */
    trafficManager: true,
    /**
     * 移动/锚定优先级表 — 数值越大越优先。
     * 同格争抢高优者胜；推挤仅当移动方优先级严格大于阻挡方时发生。
     *   flee：逃命高于一切（被堵住 = 死亡）。
     *   anchorMiner：站桩矿工锚 — 让出矿位 = 采集吞吐崩塌，仅次于逃命。
     *   work/anchorStation：携能交付与站桩升级/等 boost 同档 —
     *     交付方绕行代价（1-2 格）远小于把工作位让出去的代价。
     *   acquire：取能途中，空载被挤一格无损失。
     *   commute：跨房通勤等其他移动。
     *   parked：待命 creep 无任务在身，是最该被推开的对象。
     */
    trafficPriority: {
      flee: 100,
      anchorMiner: 90,
      work: 60,
      anchorStation: 60,
      acquire: 40,
      commute: 30,
      parked: 0,
    },
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
    /** 道路维修判定的血量比例阈值 — 低于此比例的道路视为待修。
     * repairRoads 动作与 builder 维修需求信号共用，保证「何时算需要修」口径一致。
     * 0.4 在任何地形下给约 20000 tick 修复窗口，足够 builder 响应。 */
    roadRepairThreshold: 0.4,
    /** 维修驱动 builder 的道路数门槛 — 待修道路达到此数量时，
     * 即使无建造 site 也维持 1 个 builder 巡修。
     * 成熟房布局建成后 site 归零 → builder 消亡，而塔不修路（只修 critical 与
     * wall/rampart），道路只能塌毁重建 — 重建耗能约为持续维修的 6 倍，
     * 且塌毁窗口期物流减速。3 条起孵避免为单条路专门养一个 builder。 */
    roadRepairBuilderFloor: 3,
  },

  layout: {
    /** 布局模式：constraint = 约束推导放置（默认），template = 固定模板（compact-core-v2，fallback）。
     * Phase 6 切换默认值为 constraint；template 保留为极端地形下的回退选项。 */
    mode: "constraint" as "template" | "constraint",
    /** 布局规划器的运行间隔（tick）。 */
    planInterval: 50,
    road: {
      /** 采样窗口内位置被判定为高频的最小通行次数。
       * 5：RCL2-3 仅 2-3 个 hauler 时每格每窗口约 3-6 次通行，
       * 阈值 10 会让最该修路的早期修不出路；双窗口要求防瞬时尖峰误判。 */
      minTraffic: 5,
      /** 每房最多返回的道路候选数。 */
      maxCandidates: 5,
      /** 候选位置到高价值端点（source/spawn/storage/controller）的最大曼哈顿距离。 */
      maxDistanceToEndpoints: 10,
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
    /** 物流配额归一化的基准运力（6 CARRY = 300）。
     * hauler 的 container 积压启发式（+1/+2 档）与 distributor 的 fillTarget 折算
     * 均按此运力标定；实际 body 运力更大时头数按比例折减，更小时按比例扩编。
     * 消除「body 随容量长大而配额公式不变」的头数浪费。 */
    referenceCarryCapacity: 300,
    /** upgrader 允许工作前的最低 extension 能量（RCL1-3）。 */
    upgradeEnergyFloor: 300,
    /** upgrader 允许工作前的最低 storage 能量（RCL4+，约束 G-EN-03/U-02）。 */
    upgradeEnergyFloorStorage: 1000,
    /** builder 允许工作前的最低能量盈余。 */
    buildEnergySurplus: 200,
    /** 触发紧急升级的控制器 ticksToDowngrade 阈值（迟滞进入阈值）。 */
    controllerDowngradeThreshold: 10000,
    /** controllerDowngradeRisk 迟滞退出阈值 —— ticksToDowngrade 回升到此值以上才退出风险状态。 */
    controllerDowngradeExitThreshold: 15000,
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
      /**
       * @deprecated 实际生效逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS.drainEnterScore。
       * 保留此字段仅为避免破坏性变更，全库无其他引用。
       */
      sourceFullRatio: 0.85,
      /**
       * @deprecated 实际生效逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS。
       * 保留此字段仅为避免破坏性变更，全库无其他引用。
       */
      energyThresholdRatio: 0.4,
      /**
       * @deprecated 实际生效逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS。
       * 保留此字段仅为避免破坏性变更，全库无其他引用。
       */
      energyThresholdCap: 400,
      /**
       * @deprecated 实际生效逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS.drainEnterScore。
       * 保留此字段仅为避免破坏性变更，全库无其他引用。
       */
      enterScore: 100,
      /**
       * @deprecated 实际生效逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS.drainExitScore。
       * 保留此字段仅为避免破坏性变更，全库无其他引用。
       */
      exitScore: 40,
      /**
       * @deprecated 实际生效逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS.scoreStep。
       * 保留此字段仅为避免破坏性变更，全库无其他引用。
       */
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
    /**
     * Distributor 水位分级的绝对能量阈值（storage 库存，单位：能量）。
     *
     * 必须用绝对值而非容量比例：storage 总容量 1,000,000（STORAGE_CAPACITY），
     * 按比例分级时 10% 档 = 10 万能量 — 发展期房间（库存常年数百到数万）
     * 永久卡在最低档，distributor 被锁死在「仅填 spawn」模式，extension 断供。
     * 与 upgrade.sprintStorage(50000)/sustainedStorage(10000) 同一参照系，
     * 两套 storage 调度共用一种刻度。
     *
     * ── 水位权限表（Batch 2 统一刻度 — 全部 storage 消费者按此表取能）──
     * | storage 水位      | distributor      | upgrader        | builder   | lab  | terminal |
     * | ≥ full(50k)       | 全目标满载        | 冲刺(=sprint)   | 满载      | 放行 | ≥20k 放行 |
     * | ≥ sustained(10k)  | 仅 spawn/ext 满载 | 500/趟          | 200/趟    | 放行 | <20k 拒   |
     * | ≥ low(2k)         | 限额 400          | 200/趟(≥1k)     | 50/趟     | 放行 | 拒       |
     * | < low(2k)         | 限额 200          | 拒取(<1k floor) | 拒取      | 拒   | 拒       |
     * 消费端实现：upgrader/builder 经 withdrawStorageCapped（限额 ≤0 时
     * resolve 拒绝，fallthrough 到 container/直采）；lab/terminal 在
     * industry.ts 双相门禁；distributor 经 computeDistributorTier。
     * builder 编制（demand B-5）同样按本表封顶。
     */
    distributorTiers: {
      /** ≥ 此值为 tier 0：满载取能，全目标（含 tower 补满/controller container）。 */
      full: 50000,
      /** ≥ 此值为 tier 1：满载取能，spawn/extension + tower 战备线 + controller container 兜底。 */
      sustained: 10000,
      /** ≥ 此值为 tier 2：限取 400/tick，spawn/extension + tower 战备线；低于则 tier 3（限取 200/tick，仍服务 spawn/extension — 节流靠限额而非裁剪目标）。 */
      low: 2000,
      /**
       * Tower 弹药战备线：tier 1-2 时 tower 能量低于此值才触发补给（补满由 tier 0 负责）。
       * 塔是威慑资产，威慑资产必须平时有弹 — 战后弹药真空 + 只靠威胁在场时的
       * 反应式补弹（hauler 战时让位）意味着下次袭击的前几十 tick 塔是哑的。
       * 500 = 50 发，低于 tower-defense 烧墙门槛（70% 能量），战备能量不会被
       * 墙体维护黑洞消耗；触发线语义（低于才补）保证低水位期投入有上界。
       */
      towerAmmoFloor: 500,
    },
    /**
     * 遗留能量（掉落堆/坟墓/废墟）值得 hauler 专程回收的最小数量。
     * 达到阈值的堆优先于 container 取货 — 遗留能量在衰减/限时灭失，
     * container 能量不衰减；低于阈值的零头仍走链尾兜底（container 空时顺手清理），
     * 避免「捡零头→半载往返」的空转（hauler 链注释里的历史教训）。
     * 100 ≈ 衰减损失开始可感知的规模（ceil(amount/1000)/tick）。
     */
    lootThreshold: 100,
    /** economyPressure 分段映射参数（room-state.ts 使用）。 */
    economyPressure: {
      /** 健康→谨慎的分界点（score 0..midpoint 映射 pressure 0.0..0.5）。 */
      midpoint: 40,
      /** 谨慎→危机的区间宽度（score midpoint..midpoint+range 映射 pressure 0.5..1.0）。 */
      range: 60,
    },
  },

  defense: {
    /** 联盟白名单：owner 命中者一律视为非威胁（不逃跑 / 不开火 / 不停经济）。 */
    allies: [] as readonly string[],
    /** 无塔时，威胁 creep 靠近 spawn/controller 至此 range 内才激活 safe mode（避免过境 scout 误烧）。 */
    safeModeTriggerRange: 5,
    /** 非战斗 creep 的逃跑触发距离：威胁 creep 在此范围内才逃跑（P1-1）。
     * 远端过境的威胁不会中断经济；靠近时才触发 flee。 */
    fleeRange: 10,
    /** M11 战时集结半径：小队威胁在场时非战斗 creep 撤至核心锚点
     * （storage/spawn）此范围内 — 塔在核心区，圈内即塔火力覆盖圈，
     * 追进来的敌人吃满塔伤，不追则收割失败。 */
    shelterRadius: 5,
    /** M11 safe mode 舰队伤亡熔断：窗口内战损（非自然死亡）达到阈值
     * 且威胁仍在场 → 激活 safe mode。触发条件必须保守 — safe mode 是
     * 消耗品（RCL 每级仅送一次，ghodium 制造需 RCL7+），3 只 ≈ 舰队
     * 四分之一，已是「不烧就真团灭」的证据水位。 */
    fleetLossFuse: { windowTicks: 200, deaths: 3 },
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
    /** 新生 rampart 急救线（hits）。
     * rampart 建成时仅 1 hit，且每 100 tick 衰减 300 hits — 不灌血必死于首个衰减周期，
     * 塌毁后规划器重新入队 site → builder 重建 → 又 1 hit，形成「建了就塌」死循环。
     * 低于此线的 rampart 由 repairFreshRampart 无门禁急救（绕过 fortification 的
     * 盈余门禁），灌到 10k ≈ 3300 tick 存活余量，足够常规维修链或塔接管。 */
    rampartBootstrapHits: 10_000,
    /** 受袭记忆窗口（tick）：lastHostileAt 距今小于此值视为受袭姿态。 */
    siegeMemoryTicks: 10000,
    /** 受袭姿态下 wall/rampart 目标血量的放大倍数。 */
    siegeWallMultiplier: 5,
    /** core 档（核心结构叠盾）目标血量相对周界全额的折扣系数。
     * 内圈盾只需撑过「周界已破 → 塔/defender 接战」的窗口，不承担第一道门的
     * 消耗职责。0.3 在 RCL5-6 = 30 万（塔火力下足够拖垮一支拆迁队），
     * 却把 ~40 个 extension 叠盾的灌注成本砍掉 70% — 释放的能量是 RCL 复利。 */
    coreRampartFactor: 0.3,
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
    // 远矿防御者：远矿房出现威胁时按需孵化（见 remote demand）。
    // 必须在此表注册 — roles 表同时是 recyclePass 的「在役角色」白名单，
    // 漏配会让该角色孵出即被判「废弃角色」回收，形成孵化→回收→再孵化
    // 的烧能循环，且远矿威胁永远无人处理。
    remoteDefender: { minCount: 0, maxCount: 2 },
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
    /** 普通威胁的失明保持窗口（tick，RM-2）— 有视野见威胁后，失明期间
     * 维持威胁态（暂停经济孵化）的时长。按 Invader 寿命尺度取短值：
     * 审查修正 — 复用 dangerCooldown(2000) 会在 enableDefender=false 时
     * 让单次威胁目击变成 2000 tick 收入黑洞（无 defender 重获视野解封）。
     * defender 在场时通常数十 tick 内清场并确认解除；300 覆盖一轮
     * defender 孵化 + 通勤 + 交战。 */
    threatBlindHold: 300,
    /** InvaderCore 压制冷却（tick）— 发现核心后孵化冻结的持续时长。
     * 这是重新探测节奏而非核心寿命估计：到期后恢复孵化，首个抵达的 creep
     * 带回视野 — 核心仍在则续期冷却，已消失则运营恢复。
     * 5000 tick 把「送死探测」的频率压到每 5000 tick 一只 creep 的成本。 */
    coreBlockCooldown: 5000,
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
