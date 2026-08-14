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
  // utility（container 等低值资产）：只维持新生急救地板，受袭也不升档 —
  // 塌了损失有限，能量留给周界。
  if (role === "utility") return CONFIG.defense.rampartBootstrapHits;
  const base = rcl >= 7
    ? CONFIG.defense.wallTargetHits.rcl7_8
    : rcl >= 5
      ? CONFIG.defense.wallTargetHits.rcl5_6
      : CONFIG.defense.wallTargetHits.rcl3_4;
  // core（结构叠盾）：只需撑过「周界已破 → 塔/defender 处理」窗口，
  // 打折防内圈盾与周界同价维护的经济黑洞。
  const scaled = role === "core"
    ? Math.round(base * CONFIG.defense.coreRampartFactor)
    : base;
  if (!underSiege) return scaled;
  // 受袭姿态：以真实威胁校准防御深度，和平期不为假想敌过度投资
  // （修墙能量 = 少升的 RCL）；官方上限 300M 封顶防溢出。
  return Math.min(scaled * CONFIG.defense.siegeWallMultiplier, 300_000_000);
}

export const CONFIG = {
  memory: { schemaVersion: 29 },

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
    /**
     * 调优基线版本戳（P1-I）：CONFIG.roles 的 minCount/maxCount 基线调整时 +1 —
     * tuning-engine 检测不匹配即清空 Memory 存量覆盖，从新基线重新收敛。
     * R7：版本检查在 evalInterval 评估周期开头执行，升版后旧覆盖最长残留
     * 500 tick 才清（可接受，自调优会重新收敛）。
     * v2：tuning 闭环验证机制上线（pendingValidation/frozenParams/verifyDelay/
     * 人口合同前置/下调护栏/冻结复位基线）；升版触发 rooms 清空。
     */
    baselineVersion: 2,
  },

  cpu: {
    /** 各档位 bucket 阈值（降级立即生效）。 */
    tiers: {
      healthy: { min: 7000, recoveryHysteresis: 500, recoveryTicks: 20 },
      guarded: { min: 3000, recoveryHysteresis: 500, recoveryTicks: 20 },
      conserve: { min: 1000, recoveryHysteresis: 500, recoveryTicks: 20 },
      recovery: { min: 0, recoveryHysteresis: 500, recoveryTicks: 20 },
    },
    /** 各档位软/硬 CPU 上限比例（相对 Game.cpu.limit，0–1）— 比例化适配任意
     * CPU 限制（官服 20/私服 100/可变配额），数值反推自原 20 CPU 绝对值
     * （官服下行为零变化，私服高 CPU 下不再被静态值压死）。
     * 运行时 soft/hard = effectiveLimit × ratio（见 scheduler.CpuBudget）。 */
    limits: {
      healthy: { softRatio: 0.875, hardRatio: 0.96 },
      guarded: { softRatio: 0.80, hardRatio: 0.925 },
      conserve: { softRatio: 0.70, hardRatio: 0.85 },
      recovery: { softRatio: 0.60, hardRatio: 0.775 },
    },
    /** 各档位允许的最大优先级。 */
    maxPriority: {
      healthy: 4 as Priority,
      guarded: 3 as Priority,
      conserve: 2 as Priority,
      recovery: 1 as Priority,
    },
    /** 自愿放血宽限窗口（tick）— generatePixel 后 tier 地板抬到 conserve 的时长。
     * pixel 吃光整个 bucket，但常态负载 2-5 CPU 时降到 recovery 是看门狗误判；
     * 700 覆盖 0→conserve 阈值(1000+滞回) 的自然爬升加数轮滞回等待，
     * 窗口内真实超支仍由逐 tick 硬上限兜底。 */
    pixelGraceTicks: 700,
  },

  pixel: {
    /** Pixel 收割总开关 — 默认关闭。generatePixel 吃光整个 bucket，若清零时刻
     * 恰逢 global reset（部署/迁移），bundle 加载成本 > tickLimit 触发 reload
     * death loop：每 tick 加载即被杀 → bucket 永不回充 → 主循环永久死亡
     * （线上实测 187+ tick 停摆）。开启前置：bundle 压缩后加载成本 ≪ 20 CPU，
     * 且接受放血后 ~600 tick 的 P3 降档窗口。 */
    enabled: false,
  },

  spawn: {
    /** body 替换窗口：ticksToLive <= body.length * 3 + 15（+ 路程项，见 demand.needsReplacement）。 */
    replaceBuffer: 15,
    /** 孵化请求被隔离前的最大重试次数。 */
    maxRetries: 5,
    /** 为 P0 恢复 body 预留的最低能量。 */
    recoveryEnergyReserve: 200,
    /** 饥饿降级的最低 body 成本地板：无地板会在能量低谷铸出残废 body（如 1C1M
     * distributor），其存活整个生命周期 → 吞吐塌方 → 自强化回路。降级产物低于
     * 地板继续排队等能量；生存降级路径（P0/bootstrap/recovery）豁免，保「速出保命」。 */
    starvationDegradeFloor: 300,
    /** Distributor 升编趋势确认窗口（tick）：孵化瞬间抽干 spawn/ext 的 fillTarget
     * 尖峰是日常工作信号而非缺员信号；扩编必须等需求持续此窗口才生效 — 防一次
     * 50 tick 瞬时尖峰换来多个活 1500 tick 的常驻编制。补足 minCount 地板与缩编
     * 不受确认约束。 */
    distributorScaleUpDelay: 150,
    /**
     * 孵化请求 TTL：cleanQueue 按 expiresAt 清超期请求，防需求消失后的 stale 请求
     * 永久排队。需求仍在时下一 tick 以同 key 重建（hasKey 守卫解除）。
     * 硬约束：必须大于 trySpawn 的饥饿降级窗口（P1 饥饿 ≈100 tick、P2 ≈540 tick）—
     * 否则请求在降级触发前被清除重建、createdAt 重置，饥饿计时器永远归零 → 重新
     * 引入「等满配 → 永远凑不够」死锁（W37S58）。
     */
    requestTtl: 1000,
  },

  movement: {
    /** 本地寻路的 maxRooms。remote 角色未来通过 route/waypoint 跨房，本地任务始终为 1。 */
    localMaxRooms: 1,
    /**
     * Traffic Manager 总开关。开启：角色只登记移动意图，tick 末后置系统按房集中
     * 解算（同格仲裁/对向换位/推挤静止者/锚定豁免）后统一签发 move，
     * yield/pull 旧让路机制同时短路禁用（双仲裁并存会互相打架）。
     * 关闭：登记函数直通引擎 move（完全恢复旧行为），后置系统空转 — 唯一回滚通道。
     */
    trafficManager: true,
    /**
     * 移动/锚定优先级表 — 数值越大越优先；同格争抢高优者胜，推挤仅当移动方严格大于阻挡方。
     * flee 逃命高于一切（被堵住 = 死亡）；anchorMiner 让出矿位 = 采集吞吐崩塌；
     * work/anchorStation 携能交付与站桩同档 — 绕行代价远小于让出工作位；
     * acquire 空载被挤一格无损失；commute 跨房通勤；parked 待命者最该被推开。
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
    /**
     * P1-E：动态目标寻路限频（plan.md §5.7.5）。根因：traffic 模式下
     * registerStepViaPathfinder 的缓存 key = 目标精确格 + 路网 revision，
     * 动态目标（flee 逃逸点/追击 hostile/跟车目标）每 tick 变化 → 缓存必 miss →
     * 每 tick 每 creep 一次 PathFinder.search（战时 10 creep 同时 flee ≈ 10-30 CPU，
     * 直接爆 hard limit）。
     *   档 1 quantizeDynamicTarget：3×3 区块 key 替代精确格，区块内移动不触发重寻路。
     *     （R4 注：字段名含 "Dynamic" 但实现不区分动静态目标 — 静态目标同样量化，
     *     同区块相邻静态目标可能共享 key 错走 1 tick，路径耗尽后自愈；改名涉及
     *     6 处测试与运行时配置兼容，收益不抵成本，以注释澄清而非改名。）
     *   档 2 dynamicRepathInterval：同一 creep 两次 search 最小间隔，冷却内沿旧路径走一步。
     *   档 3 maxSearchesPerRoomPerTick：每房每 tick search 上限（战时保险丝，
     *     0=不限制），超预算意图降级为「沿旧路径走一步」或「原地让行」，
     *     遥测记 path-budget skip。
     * 驻留量化在 1-2 格微操场景路径略钝 — 可接受，flee 场景活下来优先于路径最优。
     */
    quantizeDynamicTarget: true,
    dynamicRepathInterval: 3,
    maxSearchesPerRoomPerTick: 0,
  },

  construction: {
    /** 每房最大活跃建造 site 数（普通）。3：让 priority-1 的 controller container
     * 无需等待 extension 完工即可插队入场，加速 RCL2→RCL3 站桩升级链路成型。 */
    maxNormalSitesPerRoom: 3,
    /** 每房道路专用 site 名额 — 独立于普通名额，保证走廊路能与 extension 并行建造，
     * 不被 priority 3 饥饿永久挤占。 */
    maxRoadSitesPerRoom: 2,
    /** 每房 wall 专用 site 名额 — min-cut v3 割集顶点改用 wall（阻挡通行），
     * 独立计额避免与 extension 竞争 normal 槽位导致防御线建不起来。 */
    maxWallSitesPerRoom: 2,
    /** 每房 rampart 专用 site 名额 — 核心覆盖 rampart + min-cut 有结构位置的 rampart，
     * 与 wall 同类独立计额，不与 normal/road 竞争。 */
    maxRampartSitesPerRoom: 2,
    /** 每房额外允许的关键 site 数。 */
    maxCriticalSitesPerRoom: 1,
    /** 全局活跃 site 上限。7：容纳 3 extension + 2 road + 关键 container
     * （source/controller）并行，避免被毁的 source container 重建被占满名额而阻塞。 */
    maxGlobalSites: 7,
    /** 永久位置冲突任务的黑名单冷却（tick）：blocked 任务连续 3 次 ERR_INVALID_TARGET
     * 被清除后其 key 入黑名单，冷却期内规划器不得重新入队 — 否则「入队 → blocked →
     * 删除 → 再入队」无限空转。10000 给足冲突源（如玩家手工建筑）被移除的时间。 */
    blockedRetryDelay: 10000,
    /** 道路维修判定的血量比例阈值：repairRoads 动作与 builder 维修需求信号共用，
     * 保证「何时算需要修」口径一致。0.4 在任何地形下给约 20000 tick 修复窗口。 */
    roadRepairThreshold: 0.4,
    /** 维修驱动 builder 的道路数门槛：待修道路达此数量时，即使无建造 site 也维持
     * 1 个 builder 巡修。成熟房 site 归零 → builder 消亡而塔不修路，道路只能塌毁
     * 重建（耗能约为持续维修 6 倍，且窗口期物流减速）。3 条起孵避免为单条路养 builder。 */
    roadRepairBuilderFloor: 3,
    /** 孤儿工地清扫间隔（tick）：低频遍历 Game.constructionSites（全局、无视野也可
     * remove），清掉「既非我方殖民地、又非活跃远矿目标、又非当前扩张目标」房间的工地。 */
    orphanSweepInterval: 100,
  },
  layout: {
    /** 布局模式：constraint = 约束推导放置（默认），template = 固定模板（compact-core-v2，fallback）。 */
    mode: "constraint" as "template" | "constraint",
    /** 布局规划器的运行间隔（tick）。 */
    planInterval: 50,
    road: {
      /** 采样窗口内位置被判定为高频的最小通行次数。
       * 5：RCL2-3 仅 2-3 个 hauler 时每格每窗口约 3-6 次通行，阈值 10 会让最该修路的
       * 早期修不出路；双窗口要求防瞬时尖峰误判。 */
      minTraffic: 5,
      /** 每房最多返回的道路候选数。 */
      maxCandidates: 5,
      /** 候选位置到高价值端点（source/spawn/storage/controller）的最大曼哈顿距离。 */
      maxDistanceToEndpoints: 10,
    },
  },

  assignment: {
    /** 本地任务租约时长（tick）。50 tick 给足单趟通勤 + 工作时间（builder 从
     * storage 取能走到工地可能要 20+ tick）；20 tick 的 lease 会在通勤途中过期，
     * 导致每 tick 重分配 — creep 在「摇摆」。仅在条件真正变化时才重分配。 */
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
    /** 物流配额归一化的基准运力（6 CARRY = 300）：hauler 的 container 积压启发式
     * 与 distributor 的 fillTarget 折算均按此标定；实际运力更大时头数折减、更小时
     * 扩编 — 消除「body 随容量长大而配额公式不变」的头数浪费。 */
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
      /** P0-4：storage 净流失率上限（E/tick，正值=流失）：跨 tick prev-cur > 此值
       * 且低水位（< sustainedStorage*2）时 upgrader 停止从 storage 取能，让 storage
       * 回血；降级风险时豁免（保级优先）。 */
      drainRateLimit: 5,
    },
    /** 能量危机检测与响应参数。 */
    crisis: {
      /** @deprecated 实际逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS（保留仅为避免破坏性变更）。 */
      sourceFullRatio: 0.85,
      /** @deprecated 实际逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS（保留仅为避免破坏性变更）。 */
      energyThresholdRatio: 0.4,
      /** @deprecated 实际逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS（保留仅为避免破坏性变更）。 */
      energyThresholdCap: 400,
      /** @deprecated 实际逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS（保留仅为避免破坏性变更）。 */
      enterScore: 100,
      /** @deprecated 实际逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS（保留仅为避免破坏性变更）。 */
      exitScore: 40,
      /** @deprecated 实际逻辑在 domain/economy/phase.ts DEFAULT_PHASE_OPTIONS（保留仅为避免破坏性变更）。 */
      scoreStep: 10,
      /** 危机时仅当 ticksToDowngrade 低于此值才保留 1 个 upgrader 保级，否则停升级省能。 */
      downgradeGuard: 3000,
    },
    /** Link 传输参数。 */
    link: {
      /** source link 发起传输的最小能量阈值（P1-4：攒够再发，避免小额传输占冷却致 source link 溢出）。 */
      minTransfer: 400,
      /** link 角色分类的锚定半径（Chebyshev）：classifyLinkRole 与 harvester 灌能识别
       * 共用同一值，杜绝两侧口径漂移致「死 link」。取 2：harvester 站 container（贴 source）
       * 上仍能 range1 够到隔一格的 link，故 source link 放 range≤2 内均可被灌能。 */
      anchorRange: 2,
      /**
       * RCL8 满级保级水位（2026-08-01）：controller link 的目标能量。满级后升级零收益
       * （controller.progress=0），默认停供（target=0）；仅降级风险
       * （ticksToDowngrade < controllerDowngradeThreshold）时维持此小水位，保级不烧库存。
       */
      maintainTarget: 200,
      /** RCL<8 半供门槛：storage 低于 sustainedStorage(10k) 但高于此值时，
       * controller link 只供 lowSupplyRatio 比例（慢升不饿死经济）。 */
      lowSupplyStorage: 4000,
      /** 半供比例：controller link 目标 = capacity × 此值（RCL<8 低水位）。 */
      lowSupplyRatio: 0.4,
      /** 枯竭保级比例：storage < lowSupplyStorage 时 controller link 目标 = capacity × 此值。 */
      maintainRatio: 0.2,
    },
    /** Storage 满仓阈值 — 超过此比例时触发限采 + 加速消费。 */
    storageFullThreshold: 0.9,
    /**
     * Distributor 水位分级的绝对能量阈值（storage 库存）。必须用绝对值而非容量比例：
     * storage 总容量 1,000,000（STORAGE_CAPACITY），按比例分级时 10% 档 = 10 万 —
     * 发展期房间（库存常年数百到数万）永久卡在最低档，extension 断供。
     * 与 upgrade.sprintStorage(50000)/sustainedStorage(10000) 同一参照系。
     *
     * ── 水位权限表（Batch 2 统一刻度 — 全部 storage 消费者按此表取能）──
     * | storage 水位      | distributor      | upgrader        | builder   | lab  | terminal |
     * | ≥ full(50k)       | 全目标满载        | 冲刺(=sprint)   | 满载      | 放行 | ≥20k 放行 |
     * | ≥ sustained(10k)  | 仅 spawn/ext 满载 | 500/趟          | 200/趟    | 放行 | <20k 拒   |
     * | ≥ low(2k)         | 限额 400          | 200/趟(≥1k)     | 50/趟     | 放行 | 拒       |
     * | < low(2k)         | 限额 200          | 拒取(<1k floor) | 拒取      | 拒   | 拒       |
     * 消费端实现：upgrader/builder 经 withdrawStorageCapped（限额 ≤0 时 resolve 拒绝，
     * fallthrough 到 container/直采）；lab/terminal 在 industry.ts 双相门禁；
     * distributor 经 computeDistributorTier；builder 编制（demand B-5）按本表封顶。
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
       * 威慑资产必须平时有弹 — 战后弹药真空 + 反应式补弹意味着下次袭击前几十 tick
       * 塔是哑的。500 = 50 发，低于塔烧墙门槛（70% 能量），战备能量不会被墙体维护
       * 黑洞消耗；触发线语义（低于才补）保证低水位期投入有上界。
       */
      towerAmmoFloor: 500,
    },
    /**
     * 遗留能量（掉落堆/坟墓/废墟）值得 hauler 专程回收的最小数量：达阈值优先于
     * container 取货（遗留能量衰减/限时灭失，container 不衰减）；低于阈值的零头
     * 走链尾兜底，避免「捡零头→半载往返」空转。100 ≈ 衰减损失开始可感知的规模
     * （ceil(amount/1000)/tick）。
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
    /** 非战斗 creep 的逃跑触发距离：威胁 creep 在此范围内才逃跑（P1-1）—
     * 远端过境的威胁不会中断经济，靠近时才触发 flee。 */
    fleeRange: 10,
    /** M11 战时集结半径：小队威胁在场时非战斗 creep 撤至核心锚点（storage/spawn）
     * 此范围内 — 塔在核心区，圈内即塔火力覆盖圈，追进来的敌人吃满塔伤。 */
    shelterRadius: 5,
    /** M11 safe mode 舰队伤亡熔断：窗口内战损（非自然死亡）达阈值且威胁仍在场 →
     * 激活 safe mode。触发必须保守 — safe mode 是消耗品（RCL 每级仅送一次，
     * ghodium 制造需 RCL7+），3 只 ≈ 舰队四分之一，已是「不烧就真团灭」的证据水位。 */
    fleetLossFuse: { windowTicks: 200, deaths: 3 },
    /** Hauler 在 flee 状态下的"防御圈内安全充能"半径（P0-2 修复）：距 spawn ≤ 此值
     * 且携带能量时允许向圈内需能量结构（tower 优先）充能 — 解决战斗中 Tower 能量
     * 耗尽无人补给的死局，细化 G-SM-05 语义。 */
    safeRefuelRange: 3,
    /** Tower 维修 wall/rampart 的目标血量，按 RCL 分级（约束 G-DF-08）。 */
    wallTargetHits: {
      rcl3_4: 100_000,
      rcl5_6: 1_000_000,
      rcl7_8: 10_000_000,
    },
    /** 新生 rampart 急救线（hits）：rampart 建成时仅 1 hit 且每 100 tick 衰减 300 —
     * 不灌血必死于首个衰减周期，塌毁后重建又 1 hit，形成「建了就塌」死循环。
     * 低于此线由 repairFreshRampart 无门禁急救，灌到 10k ≈ 3300 tick 存活余量。 */
    rampartBootstrapHits: 10_000,
    /** 受袭记忆窗口（tick）：lastHostileAt 距今小于此值视为受袭姿态。 */
    siegeMemoryTicks: 10000,
    /** P1-3：威胁过期 tick 数：threatCreeps>0 但 lastHostileAt 超过此值未刷新视为
     * stale — 旧威胁停留（无新增）超过此窗口不再维持 defense 姿态，让经济恢复。 */
    threatStaleTicks: 100,
    /** P1-3：退出 defense 迟滞 tick 数：威胁消除（threatCount=0）后若 lastHostileAt
     * 距今小于此值仍维持 defense 姿态 — 防敌人短暂进出导致 colonyState 高频抖动
     * （525 次/327k tick）。进入 defense 仍 1 tick 触发（防御不延迟）。 */
    defenseExitHysteresis: 50,
    /** 受袭姿态下 wall/rampart 目标血量的放大倍数。 */
    siegeWallMultiplier: 5,
    /** core 档（核心结构叠盾）目标血量相对周界全额的折扣系数：内圈盾只需撑过
     * 「周界已破 → 塔/defender 接战」窗口。0.3 在 RCL5-6 = 30 万（够拖垮一支拆迁队），
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
    // 远矿防御者：远矿房出现威胁时按需孵化（见 remote demand）。必须在此表注册 —
    // roles 表同时是 recyclePass 的「在役角色」白名单，漏配会让角色孵出即被判
    // 废弃回收，形成孵化→回收→再孵化的烧能循环，且远矿威胁永远无人处理。
    remoteDefender: { minCount: 0, maxCount: 2 },
    // 扩张占领：同一时刻至多一个扩张行动（见 expansion-manager）。
    claimer: { minCount: 0, maxCount: 1 },
    // 矿物采集：RCL6+ 有 extractor 且 mineral 未采空时孵化（见 demand 矿工块）。
    // minCount=0 → 矿采空后自然停孵，存量矿工老死不补。
    mineralMiner: { minCount: 0, maxCount: 1 },
    // 跨房远征攻击者：仅 war 姿态时由 war-planner 孵化（CONFIG.roles 兼任
    // recyclePass「在役角色」白名单 — 漏配会让攻击者孵出即被判废弃回收）。
    attacker: { minCount: 0, maxCount: 4 },
    // 侦察兵（R6b）：prospect 任务临时孵化，同一时刻至多 1 只。
    scout: { minCount: 0, maxCount: 1 },
  },

  war: {
    /** 战争规划器运行间隔（tick）。 */
    interval: 10,
    /** 目标情报新鲜度窗口（tick）：超过此值未更新的视野视为不可信，不选。 */
    targetFreshness: 1500,
    /** 目标 tower 数上限（含此值以下才可攻击；超过视为不可破，等待或换目标）。 */
    maxTowers: 3,
    /** 攻击编队基数（无 tower 目标）。 */
    squadBase: 3,
    /** 目标有 tower 时每座 tower 追加的攻击者数。 */
    squadPerTower: 2,
    /** 战争计划最长期限（tick）：超期重新选目标（目标可能已迁房/易主）。 */
    planTimeout: 6000,
    /** 低血撤退线：攻击者血量低于 hitsMax × 此比例 → 标记回收撤出战区。 */
    retreatRatio: 0.3,
    /** sponsor 快照缺失时的容量回退（测试/边缘态）— body 仍由 selectBody 约束。 */
    fallbackCapacity: 800,
    /** 战损止损上限（R4）：单计划累计提交的孵化请求数超过 squadSize × 此倍数即判
     * 消耗战失败 — 收编队 + 目标黑名单。2.5×：容忍首波全灭 + 半波替补，再打不穿
     * 就止损，不让 spawn 永续给远征添油。 */
    casualtyMultiplier: 2.5,
    /** 波次重组线（R4）：advance 阶段在役攻击者低于 squadSize × 此比例 → 计划回落
     * build，幸存者归建，补满编队后再整波推进 — 用「整波集结」替代「散兵逐个送」。 */
    waveRegroupRatio: 0.5,
    /** 战争目标黑名单冷却（tick，R4）：核验失败/未知的战争目标在冷却期内不被重选，
     * 防止「打不过 → 收摊 → 下一轮又选中 → 再送」的循环。 */
    warBlacklistTicks: 20000,
    /** 战损止损后的整军休战期（tick，R4）：消耗战收摊后不立即换目标重开 — 黑名单
     * 只挡单目标，休战期挡「A 止损 → 立刻打 B → 再止损 → 打 C」的跨目标添油循环。 */
    standDownTicks: 2000,
  },

  debug: {
    /** 在 creep 头顶绘制状态指示灯（work=绿 / acquire=黄 / idle=红 / flee=橙）。
     * 纯诊断功能，默认关闭；开启时每 creep 每 tick 约 0.001-0.005 CPU。 */
    statusLight: false,
    /** Action 级 CPU profiling 开关：每个 action 的 resolve/execute 调用都用
     * Game.cpu.getUsed() 测量（约 0.001 CPU/次；50 creep × 5 actions × 2 calls
     * ≈ 0.5 CPU/tick），数据在 globalCache 中按 tick 聚合。仅定位热点时开启。 */
    actionProfiling: false,
  },

  remote: {
    /** 远矿管理器运行间隔（tick）。 */
    managerInterval: 10,
    /** 最大同时运营远矿目标数（CPU 预算保护）。 */
    maxOperations: 2,
    /** 无 storage 时的开点上限 — 本房 sink（spawn/ext/tower/cc ≈ 4300 容量）消化
     * 能力有限，多点并发流入会背压空转（container 溢出 drop 衰减）。storage 建成后
     * 自动放开到 maxOperations。 */
    maxOperationsNoStorage: 1,
    /** 每个远矿目标的 harvester 数（op.sources 缺失时的回退值）。 */
    harvestersPerTarget: 1,
    /** 每个远矿目标的 harvester 数上限 — 按 source 数孵化（2-source 房需 2 只，
     * 否则第二源白白再生浪费）；上限防未知房 sources 异常虚增编制、占满孵化位。 */
    harvestersMaxPerTarget: 2,
    /** 每个远矿目标的 hauler 数（评选期未算出 haulerNeed 时的回退值）。 */
    haulersPerTarget: 1,
    /** 动态 hauler 编制上限 — 需要更多说明目标太远，评分门槛应已剔除它。 */
    haulersMax: 3,
    /** 净收益门槛（e/tick）— 评分低于此值的候选剔除：名额只有 maxOperations 个，
     * 烂目标（沼泽远房）占位比空置更亏。 */
    minNetScore: 3,
    /** 现役 op 经济重估宽限期（tick，A-3/B-6）— netScore 连续低于 minNetScore 超过
     * 此时长才废弃，抗路况/source 瞬时波动误撤边际 op（按 interval(10) 约 100 轮评估）。 */
    lowScoreGrace: 1000,
    /** 是否启用 reserver（RCL3+ 才有意义，CLAIM 部件 600 能量）。 */
    enableReserver: true,
    /** 是否启用 remoteDefender（远矿防御者，杀 NPC reserver/Invader）。 */
    enableDefender: true,
    /** 远矿目标过期 tick 数（lastSeen 超过此值则暂停运营）。 */
    staleThreshold: 5000,
    /** 远矿启用 RCL 门限（低于此 RCL 不开远矿，集中能量发展本房）。 */
    minRcl: 4,
    /** 逐房就绪门（Phase 1b）：一个房要「新开」远矿，除帝国姿态放行外，本房还须
     * 自身经济成熟（RCL ≥ roomMinRcl 且 storage ≥ roomMinStorage 且 colonyState=normal）
     * — 防 RCL4 新占嫩房过早分兵（本该闷头冲级）。现役远矿不受影响。
     * roomMinStorage 取 8000 而非 20000：20000 门槛对「storage 常年见底」的 2-source
     * 房是贫困陷阱 — 越穷越开不了远矿、越开不了越穷；远矿正是突破单房 20/tick
     * 收入天花板的唯一杠杆。8000 仍留一层缓冲防真嫩房过早分兵。 */
    roomMinRcl: 5,
    roomMinStorage: 8000,
    /** 远矿房威胁的危险冷却（tick）— 冷却期内不作为新远矿/扩张候选。 */
    dangerCooldown: 2000,
    /** 普通威胁的失明保持窗口（tick，RM-2）：有视野见威胁后，失明期间维持威胁态
     * （暂停经济孵化）的时长。审查修正 — 复用 dangerCooldown(2000) 会在
     * enableDefender=false 时让单次威胁目击变成 2000 tick 收入黑洞；defender 在场
     * 时通常数十 tick 清场并确认解除，300 覆盖一轮 defender 孵化 + 通勤 + 交战。 */
    threatBlindHold: 300,
    /** InvaderCore 压制冷却（tick）— 发现核心后孵化冻结的持续时长。这是重新探测
     * 节奏而非核心寿命估计：到期恢复孵化，首个抵达的 creep 带回视野 — 核心仍在则
     * 续期，已消失则运营恢复。5000 tick 把「送死探测」频率压到每 5000 tick 一只的成本。 */
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
    /**
     * storage 饥饿时的 terminal 能量储备地板（W7 止血修正，2026-08-01）。
     * 背景：私服 4.3.0 自带市场 API 但市场可为空（credits=0、无订单）—
     * terminal-manager 从不成交，10k 交易储备在 storage 枯竭的房间变成死资本
     * （W7N3/W7N4 实测 terminal 恒 10150/10400、storage=0、长期 crisis）。
     * 语义：storage < storageEnergyFloor(20k) 时，hauler 把 terminal 能量压缩到
     * 此地板（有市场时保留少量运费余量；无市场时归零，见 industry.ts
     * withdrawTerminalEnergy）；storage 恢复健康后按 energyTarget 重新回补。
     */
    terminalEnergyReserveFloor: 2000,
    /** storage 能量低于此值时不给 terminal 备能（经济优先于贸易）。 */
    storageEnergyFloor: 20000,
    /** credits 低于此值暂停买入（保留应急余额）。 */
    creditFloor: 100,
  },

  /** 帝国能量网络与市场深化（R5）— 跨房互济 + 能量市场交易。 */
  energy: {
    /** 救助地板：storage 能量低于此值 → 帝国互济的救助候选。 */
    aidRecipientFloor: 20000,
    /** 捐赠地板：storage 高于此值才可捐赠；捐赠后仍须高于此值。与救助地板分离
     * （50k > 20k）：受助方被补到 20k 后仍远低于捐赠线，结构性滞回 — 同一笔救助
     * 不可能让受助方翻转为捐赠方（防震荡）。 */
    aidDonorFloor: 50000,
    /** 单次跨房救助最大量（terminal 储备 target 10k，批次以不掏空捐赠方 terminal 为界）。 */
    aidMaxTransfer: 10000,
    /** 低于此量不送（能量运费不划算）。 */
    aidMinTransfer: 2000,
    /** 能量溢出卖线：storage 超过此水位才向市场卖能量（真实盈余出口）。 */
    energySellFloor: 100000,
    /** 能量最低卖出价（credits/单位）— 低于此价囤着等行情。 */
    minEnergySellPrice: 0.02,
    /** 能量最高买入价（credits/单位）— 危机救助价，高于此价宁可压缩运营。 */
    maxEnergyBuyPrice: 0.05,
    /** 能量买入触发线：storage 低于此值且 credits 充足才买（市场是最后救助通道）。 */
    energyBuyFloor: 5000,
  },

  /** 帝国议程（R6a）— 主动自治的短期目标层。 */
  agenda: {
    /** 受袭记忆窗口：lastHostileAt 距今小于此值 → defense-readiness（主动备战）。 */
    threatWindow: 3000,
    /** rcl-push 的最低 storage 水位（至少一房达标才主动冲级）。 */
    rclPushStorage: 20000,
    /** rcl-push 允许的最高平均经济压力（打不起不冲）。 */
    rclPushMaxPressure: 0.3,
    /** 普通目标切换的最短驻留（防 rcl-push ↔ develop 抖动；紧急目标立即生效）。 */
    minDwell: 200,
  },

  /** 主动情报（R6b）— 侦察任务：为扩张决策主动获取候选房视野。 */
  prospect: {
    /** 任务管理器运行间隔（tick）。 */
    interval: 25,
    /** 成功判定：目标 intel 距今 ≤ 此值且 sources 已知 → 决策就绪。 */
    intelFreshness: 50,
    /** 任务全程超时（含孵化等待）：超时判失败 + 目标冷却。 */
    maxMissionTicks: 1200,
    /** 最多孵化侦察兵数（含首发）：死亡达上限判失败 + 冷却。 */
    maxSpawns: 2,
    /** 失败/超时/死亡目标冷却：冷却期内不重选。 */
    cooldownTicks: 20000,
    /** 侦察是纯发展投资：bucket 低于此值不开新任务（进行中任务不受影响）。 */
    minBucket: 5000,
  },
} as const;

/** 类型安全的档位上限比例查询。 */
export function tierLimits(tier: CpuTier): { softRatio: number; hardRatio: number } {
  return CONFIG.cpu.limits[tier];
}

/** 类型安全的最大优先级查询。 */
export function tierMaxPriority(tier: CpuTier): Priority {
  return CONFIG.cpu.maxPriority[tier];
}
