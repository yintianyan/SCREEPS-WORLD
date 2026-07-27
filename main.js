'use strict';

/**
 * Screeps 沙箱 `global` 对象的类型安全访问器。
 *
 * 在 Screeps 运行时中 `global` 和 `globalThis` 是同一个沙箱作用域。
 * 使用 `globalThis` 以避免与 `@types/node` 的 `global` 类型冲突。
 * 所有字段可选，必须在 global reset 后可惰性重建。
 */
function globalCache() {
    return globalThis;
}

/**
 * 交通热度记录 — 供道路规划器使用。
 *
 * 使用 numeric packed key（x*50+y）替代字符串拼接，减少 GC 压力。
 * 数据存 globalCache().roomTraffic，每规划周期由 road-planner 轮换。
 */
/** 将 RoomPosition 压缩为单个数字：x * 50 + y。 */
function packPos$1(pos) {
    return pos.x * 50 + pos.y;
}
/**
 * 记录 creep 当前位置的交通热度。
 * 每次成功移动（OK 或 ERR_TIRED）后调用。
 */
function recordTraffic(creep) {
    const g = globalCache();
    if (!g.roomTraffic)
        g.roomTraffic = {};
    const roomName = creep.room.name;
    if (!g.roomTraffic[roomName])
        g.roomTraffic[roomName] = {};
    const key = String(creep.pos.x * 50 + creep.pos.y);
    g.roomTraffic[roomName][key] = (g.roomTraffic[roomName][key] ?? 0) + 1;
}

/**
 * 根据 RCL 返回每个 source 的目标 work parts 总数（约束 X-02）。
 * RCL1-3: 5 / RCL4-6: 6 / RCL7-8: 8。
 */
/**
 * 根据 RCL 返回 wall/rampart 的目标维护血量（约束 G-DF-08）。
 * RCL3-4: 100K / RCL5-6: 1M / RCL7-8: 10M。
 */
function getWallTargetHits(rcl, underSiege = false, role = "perimeter") {
    // utility（container 等低值资产叠盾）：保护对象价值低于全额维护成本，
    // 只维持新生急救地板 — 受袭也不升档（该格塌了损失有限，能量留给周界）。
    if (role === "utility")
        return CONFIG.defense.rampartBootstrapHits;
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
    if (!underSiege)
        return scaled;
    // 受袭姿态：近期有真实敌对活动时抬高目标 — 防御深度用实际威胁校准，
    // 和平期不为假想敌过度投资墙体（修墙能量 = 少升的 RCL）。
    // 官方墙体血量上限 300M，封顶防溢出。
    return Math.min(scaled * CONFIG.defense.siegeWallMultiplier, 300000000);
}
const CONFIG = {
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
            healthy: 4,
            guarded: 3,
            conserve: 2,
            recovery: 1,
        },
        /** 自愿放血宽限窗口（tick）— generatePixel 后 tier 地板抬到 conserve 的时长。
         * pixel 吃光整个 bucket（10000），但每 tick 20 CPU 限额不受影响：
         * 常态负载 ~2-5 CPU 时降到 recovery（冻结 P2 经济角色）是看门狗误判。
         * 700 覆盖 0 → conserve 阈值(1000+滞回) 的自然爬升（~+15/tick ≈ 100 tick）
         * 加数轮滞回等待；窗口内若 CPU 真实超支，逐 tick 硬上限仍然兜底。 */
        pixelGraceTicks: 700,
    },
    spawn: {
        /** body 替换窗口：ticksToLive <= body.length * 3 + 15（+ 路程项，见 demand.needsReplacement）。 */
        replaceBuffer: 15,
        /** 孵化请求被隔离前的最大重试次数。 */
        maxRetries: 5,
        /** 为 P0 恢复 body 预留的最低能量。 */
        recoveryEnergyReserve: 200,
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
        mode: "constraint",
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
         */
        distributorTiers: {
            /** ≥ 此值为 tier 0：满载取能，全目标（含 tower/controller container）。 */
            full: 50000,
            /** ≥ 此值为 tier 1：满载取能，仅 spawn/extension。 */
            sustained: 10000,
            /** ≥ 此值为 tier 2：限取 400/tick，仅 spawn/extension；低于则 tier 3（限取 200，仅 spawn 保命）。 */
            low: 2000,
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
        allies: [],
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
            rcl3_4: 100000,
            rcl5_6: 1000000,
            rcl7_8: 10000000,
        },
        /** 新生 rampart 急救线（hits）。
         * rampart 建成时仅 1 hit，且每 100 tick 衰减 300 hits — 不灌血必死于首个衰减周期，
         * 塌毁后规划器重新入队 site → builder 重建 → 又 1 hit，形成「建了就塌」死循环。
         * 低于此线的 rampart 由 repairFreshRampart 无门禁急救（绕过 fortification 的
         * 盈余门禁），灌到 10k ≈ 3300 tick 存活余量，足够常规维修链或塔接管。 */
        rampartBootstrapHits: 10000,
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
        },
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
};
/** 类型安全的档位上限查询。 */
function tierLimits(tier) {
    return CONFIG.cpu.limits[tier];
}
/** 类型安全的最大优先级查询。 */
function tierMaxPriority(tier) {
    return CONFIG.cpu.maxPriority[tier];
}

/** 各角色可接受的任务类型。
 *
 * source 分配统一归 targeting.getSource()（基于 sourceOccupancy 的公平份额），
 * 不经过 assignment 系统 — harvester/worker 采集均走 getSource，故无 "harvest" 任务类型。
 * 这消除了旧实现中「assignment harvest 槽位」与「targeting fairShare」的双轨制（P1-1）。
 */
const ROLE_TASK_KINDS = {
    worker: ["fill"],
    harvester: ["fill"],
    hauler: ["haul", "fill"],
    upgrader: ["upgrade"],
    // builder 只接受 build 任务：其 work 模式对 assignment target 调用 creep.build()，
    // 若拿到 fill 任务（target 是 spawn/extension 结构）会 ERR_INVALID_TARGET 死循环，
    // 永远无法建造。填充/维修/升级由 builder.ts 的 fallback 链在无 build 目标时自行处理。
    builder: ["build"],
};
// ──────────────────────────────────────────────
// 纯函数 — 不访问 Game/Memory/globalCache，接收显式数据参数
// ──────────────────────────────────────────────
/**
 * 为单个房间生成本 tick 可用任务列表（纯函数）。
 *
 * 接收预收集的 creep 分配摘要和房间标志位，返回排序后的任务列表。
 * 不访问 Game/Memory — 所有外部状态由参数传入。
 *
 * 性能优化：单次遍历 creep 摘要，按 assignment.id 分桶到 Map，
 * 所有任务共用同一份分桶结果，避免 O(N×M) 重复扫描。
 */
function buildRoomTasks(snapshot, creeps, flags) {
    const tasks = [];
    const roomName = snapshot.roomName;
    // 单次遍历 creep 摘要，按 home 过滤后分桶到 Map：
    //   taskToCreeps: assignment.id -> creep 名字列表（fill/haul/build/upgrade 共用）
    const taskToCreeps = new Map();
    for (const creep of creeps) {
        if (creep.home !== roomName)
            continue;
        const a = creep.assignment;
        if (!a)
            continue;
        const taskList = taskToCreeps.get(a.id) ?? [];
        taskList.push(creep.name);
        taskToCreeps.set(a.id, taskList);
    }
    // 1. fill 任务 — 向 spawn/extension 送能。
    if (snapshot.fillTargets.length > 0) {
        // 动态阈值：容量 40% 与固定上限取较小值，避免 RCL1 永久 P0。
        const fillThreshold = Math.min(Math.floor(snapshot.energyCapacityAvailable * 0.4), CONFIG.assignment.emergencyFillThreshold);
        const priority = snapshot.energyAvailable < fillThreshold ? 0 : 1;
        tasks.push({
            id: `fill:${roomName}`,
            kind: "fill",
            priority,
            maxWorkers: 3,
            assignedCreeps: taskToCreeps.get(`fill:${roomName}`) ?? [],
        });
    }
    // 2. haul 任务 — 为每个含能量的 container 生成独立任务（P2-5 拆分单点聚合）。
    // 旧实现每房只生成 1 个 haul 任务（pickup=最满 container），3 个 hauler 全挤向同一处，
    // 其余 container 饿死。拆分后配合 P2-4 距离感知，hauler 自然分散到不同 container。
    // maxWorkers=1：每个 container 至少分配 1 个 hauler 即可，多余 hauler 走自身回退链。
    // 排除 controller container：它是 haulFillTarget 的填充目标（priority 0），
    // 若同时作为 haul 取能源，hauler A 倒入 → 生成 haul 任务 → hauler B 取出 → 乒乓振荡。
    // 与 hauler.ts withdrawRichestCapped 的排除逻辑对齐。
    const ccId = snapshot.controllerContainer?.id;
    const haulContainers = snapshot.containers.filter(c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && c.id !== ccId);
    if (haulContainers.length > 0) {
        for (const c of haulContainers) {
            tasks.push({
                id: `haul:${roomName}:${c.id}`,
                kind: "haul",
                sourceId: c.id,
                priority: 1,
                maxWorkers: 1,
                assignedCreeps: taskToCreeps.get(`haul:${roomName}:${c.id}`) ?? [],
                pos: { x: c.pos.x, y: c.pos.y },
            });
        }
    }
    // 无含能量的 container 时不生成 haul 任务（TD-013）。
    // hauler 永不从 storage 取能 — storage → sink 的分发由 distributor 负责。
    // container 全空时 hauler 应等待 harvester 产出，而非隐蔽绕过架构约束从 storage 取能。
    // 3. build 任务 — 为每个 active site 生成。
    const ctrl = snapshot.controller;
    const inCrisis = flags.colonyState === "recovery";
    // Storage 尚未建成时视为关键基建 — 与 spawn/tower 同优先级。
    // RCL4+ 无 storage = hauler 无处倒能 + builder/upgrader 无中央能量源，
    // construction-manager 的 assessEmergencyRebuild 已将其标记为 emergency，
    // assignment 层必须对齐：集中 builder 工时优先完工，而非与 extension 平分。
    const needsStorage = snapshot.rcl >= 4 && snapshot.storage === undefined;
    for (const site of snapshot.myConstructionSites) {
        const isCritical = site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
        const isStorageSite = needsStorage && site.structureType === STRUCTURE_STORAGE;
        // controller container 是站桩升级链路的核心基础设施 — 提升为 priority 1，
        // 确保 builder 优先建造它而非远处的 extension。
        const isControllerContainer = site.structureType === STRUCTURE_CONTAINER &&
            ctrl !== undefined &&
            Math.abs(site.pos.x - ctrl.pos.x) <= 1 &&
            Math.abs(site.pos.y - ctrl.pos.y) <= 1;
        // source container 同样是关键物流基础设施。
        const isSourceContainer = site.structureType === STRUCTURE_CONTAINER &&
            snapshot.sources.some(s => Math.abs(site.pos.x - s.pos.x) <= 1 && Math.abs(site.pos.y - s.pos.y) <= 1);
        const isPriorityContainer = isControllerContainer || isSourceContainer;
        const isPriority = isCritical || isPriorityContainer || isStorageSite;
        // 能量危机：仅暂停道路（纯效率投入、无产能回报，是真正可推迟的 discretionary 建造）。
        const isRoad = site.structureType === STRUCTURE_ROAD;
        if (inCrisis && isRoad)
            continue;
        tasks.push({
            id: `build:${roomName}:${site.id}`,
            kind: "build",
            targetId: site.id,
            structureType: site.structureType,
            // storage 在建时 maxWorkers=2（集中主力完工，但留 1 个 builder 给 extension）；
            // spawn/tower/priority-container maxWorkers=2；普通 site maxWorkers=1。
            // 不全压 storage 的原因：extension 只需 200 progress，建成立即提升 energyCapacityAvailable，
            // 解锁更大 builder body（[2W,1C,2M]@350），整体建造速率翻倍。
            // 全压 storage（10,000 progress）时 3 builder × [1W] = 15 progress/tick，
            // 而先建 extension 再建 storage：1 builder × 200 progress ≈ 40 tick → 容量 350 →
            // builder body [2W] → 20 progress/tick，ROI 远高于全压 storage。
            priority: isPriority ? 1 : 2,
            maxWorkers: isStorageSite ? 2 : isPriority ? 2 : 1,
            assignedCreeps: taskToCreeps.get(`build:${roomName}:${site.id}`) ?? [],
            pos: { x: site.pos.x, y: site.pos.y },
        });
    }
    // 4. upgrade 任务 — 仅在 normal 或有降级风险时。
    if (snapshot.controller && snapshot.controller.my) {
        const hasDowngradeRisk = flags.controllerDowngradeRisk;
        const allowUpgrade = flags.colonyState === "normal" || hasDowngradeRisk;
        if (allowUpgrade) {
            tasks.push({
                id: `upgrade:${roomName}`,
                kind: "upgrade",
                targetId: snapshot.controller.id,
                priority: hasDowngradeRisk ? 1 : 2,
                maxWorkers: 3,
                assignedCreeps: taskToCreeps.get(`upgrade:${roomName}`) ?? [],
                pos: { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y },
            });
        }
    }
    // 预排序：按 priority 升序，供 chooseTaskForRole 直接遍历选择。
    tasks.sort((a, b) => a.priority - b.priority);
    return tasks;
}
/**
 * 验证 assignment 是否仍然有效（纯函数）。
 *
 * 无效条件：lease 过期、revision 变化、target 消失、source 消失。
 * 所有外部状态由参数传入，不访问 Game/Memory。
 */
function validateAssignmentRules(assignment, tick, layoutRevision, targetExists, sourceExists) {
    // lease 过期。
    if (tick > assignment.leaseUntil)
        return false;
    // revision 变化检查 — 布局修订后旧 assignment 立即失效。
    if (assignment.revision !== layoutRevision)
        return false;
    // target 存在检查。
    if (assignment.targetId && !targetExists)
        return false;
    // source 存在检查。
    if (assignment.sourceId && !sourceExists)
        return false;
    return true;
}
/**
 * 为角色从预排序任务列表中选择任务（纯函数）。
 *
 * 任务列表已按 priority 升序排列。优先级主导选择；同优先级内按距离 creep 最近选取（P2-4）。
 *
 * 距离感知（P2-4）：传入 creepPos 时，在最高优先级（最小 priority 值）的候选中选曼哈顿距离最近者，
 * 减少 50 creep 规模下的穿房通勤。无 pos 的任务（如 fill）在距离比较中排后（视为 Infinity），
 * 仅当无更近的有位置任务时入选。不传 creepPos 时退化为原「首个匹配」行为（向后兼容）。
 *
 * builder 特殊处理：道路 build 任务 priority 与 extension 平局，按数组序排在后面会被永久饥饿。
 * 这里预留 1 个 builder 给道路 —— 仅当「有道路任务待建」「尚无 builder 在修路」
 * 「且无 critical（spawn/tower，priority≤1）缺口」时触发，并选最近的待建道路。
 */
function chooseTaskForRole(role, tasks, creepPos) {
    const roleKinds = ROLE_TASK_KINDS[role];
    if (!roleKinds || roleKinds.length === 0)
        return undefined;
    // builder 道路预留：单次遍历同时统计道路任务和 critical 缺口。
    if (role === "builder") {
        let buildersOnRoad = 0;
        let hasFreeCritical = false;
        const roadCandidates = [];
        for (const t of tasks) {
            if (t.kind !== "build")
                continue;
            if (t.structureType === STRUCTURE_ROAD) {
                buildersOnRoad += t.assignedCreeps.length;
                if (t.assignedCreeps.length < t.maxWorkers)
                    roadCandidates.push(t);
            }
            if (t.priority <= 1 && t.assignedCreeps.length < t.maxWorkers)
                hasFreeCritical = true;
        }
        if (roadCandidates.length > 0 && buildersOnRoad === 0 && !hasFreeCritical) {
            return closestTask(roadCandidates, creepPos);
        }
    }
    // 1. 找最高优先级（最小 priority 值）且有匹配角色、有空位的任务。
    let bestPriority = Infinity;
    for (const task of tasks) {
        if (!roleKinds.includes(task.kind))
            continue;
        if (task.assignedCreeps.length >= task.maxWorkers)
            continue;
        if (task.priority < bestPriority)
            bestPriority = task.priority;
    }
    if (bestPriority === Infinity)
        return undefined;
    // 2. 收集该优先级的所有候选，距离感知选最近。
    const candidates = [];
    for (const task of tasks) {
        if (!roleKinds.includes(task.kind))
            continue;
        if (task.assignedCreeps.length >= task.maxWorkers)
            continue;
        if (task.priority === bestPriority)
            candidates.push(task);
    }
    return closestTask(candidates, creepPos);
}
/**
 * 在候选任务中选距离 creep 最近者（曼哈顿距离，P2-4）。
 * 无 creepPos 或仅一个候选时回退数组首个（保持确定性）。
 * 无 pos 的任务距离视为 Infinity —— 有位置任务优先，全无位置时回退首个。
 */
function closestTask(candidates, creepPos) {
    if (candidates.length === 0)
        return undefined;
    if (!creepPos || candidates.length === 1)
        return candidates[0];
    let best = candidates[0];
    let bestDist = taskDistance(best, creepPos);
    for (let i = 1; i < candidates.length; i++) {
        const d = taskDistance(candidates[i], creepPos);
        if (d < bestDist) {
            bestDist = d;
            best = candidates[i];
        }
    }
    return best;
}
/** 任务代表位置到 creep 的曼哈顿距离；任务无 pos 时返回 Infinity。 */
function taskDistance(task, pos) {
    if (!task.pos)
        return Infinity;
    return Math.abs(task.pos.x - pos.x) + Math.abs(task.pos.y - pos.y);
}

/**
 * Event Log — 离散事件日志的采集与持久化。
 *
 * 设计意图：Screeps 控制台是流式的，滚过去就没了。关键状态转换
 * (Phase 变迁、Tier 降级、P0 孵化、敌人入侵等) 需要持久化到 segment
 * 供事后追溯——Debug Investigation Protocol 的"收集日志"步骤依赖此数据。
 *
 * 数据流：
 *   任意系统调用 recordEvent() → globalCache().eventBuffer (heap, per-tick)
 *   → telemetry-collector 每 10 tick flush → segment 2 环形缓冲
 *
 * 事件检测策略：
 *   1. 显式记录：关键路径调用 recordEvent()（如 spawn-manager 创建 P0 请求）
 *   2. 差分检测：telemetry-collector 对比 Memory 中前后状态差值
 *   优先用差分检测（不改现有系统），显式记录仅用于差分无法覆盖的事件。
 *
 * 容量：segment 2 = 100KB，每事件 ~30 bytes，保留最近 500 条。
 */
// ─── 公共 API ───────────────────────────────────────────────
/**
 * 记录一个离散事件。
 * 写入 globalCache().eventBuffer（heap），由 telemetry-collector 低频 flush 到 segment。
 *
 * 此函数可从任意系统安全调用 — 不访问 Memory/segment，CPU 开销极低（数组 push）。
 */
function recordEvent(kind, roomName, data) {
    const g = globalCache();
    if (!g.eventBuffer)
        g.eventBuffer = { events: [] };
    g.eventBuffer.events.push({
        t: Game.time,
        k: kind,
        r: roomName,
        d: data,
    });
}
/** 获取并清空 per-tick 事件缓冲区。返回的事件由调用者持久化到 segment。 */
function drainEventBuffer() {
    const g = globalCache();
    if (!g.eventBuffer || !g.eventBuffer.events || g.eventBuffer.events.length === 0) {
        return [];
    }
    const events = g.eventBuffer.events;
    g.eventBuffer = { events: [] };
    return events;
}

/**
 * 每 tick 对象缓存 — 去重同 tick 内对同一 id 的重复 Game.getObjectById 调用（P2-6）。
 *
 * 典型冗余场景：
 *   - 角色 candidate 的 predicate 和 execute 对同一 targetId 各调一次（2→1）
 *   - builder 的 gate + predicate + execute 对同一 site 调三次（3→1）
 *   - 多 creep 分配到同一目标时各自查询（N→1）
 *
 * 安全性：单个 tick 内对象身份不变（结构销毁/创建发生在 tick 边界之间），
 * 缓存引用不会过期；缓存 null 同样安全（tick 内不存在的对象不会凭空出现）。
 * 缓存以 Game.time 标记，每 tick 自动重置；Global Reset 后随 globalCache 重建。
 *
 * 类型签名与 Game.getObjectById 完全一致（双重载），调用点零类型改动。
 */
function getCache() {
    const g = globalCache();
    if (!g.__objCache || g.__objCacheTick !== Game.time) {
        g.__objCache = new Map();
        g.__objCacheTick = Game.time;
    }
    return g.__objCache;
}
function getObjectById(id) {
    const cache = getCache();
    if (cache.has(id))
        return cache.get(id);
    const obj = Game.getObjectById(id);
    cache.set(id, obj);
    return obj;
}

// ──────────────────────────────────────────────
// 适配层 — 从 Game/Memory/creep 读取数据，调用纯函数，写回状态
// ──────────────────────────────────────────────
/** 获取当前 tick 的 TaskPool，不存在或过期时返回 undefined。 */
function getPool(ctx) {
    const g = globalCache();
    if (!g.assignment)
        return undefined;
    const tick = ctx?.tick ?? Game.time;
    if (g.assignment.tick !== tick)
        return undefined;
    return g.assignment.pool;
}
/**
 * 适配：释放 creep 的当前任务分配。
 * 通过 TaskPool 的 O(1) 索引查找任务，移除 creep 名字。
 */
function releaseFromTask(creep) {
    const assignment = creep.memory.assignment;
    if (!assignment)
        return;
    const pool = getPool();
    if (!pool)
        return;
    pool.releaseCreep(assignment.id, creep.name);
}
/**
 * 适配：获取或续约 creep 的任务分配（plan §5.7.2）。
 *
 * 从 creep.memory 读取现有 assignment，通过 Game.getObjectById 验证
 * target/source 存在性，从 Memory 读取 layout.revision，
 * 调用纯函数 validateAssignmentRules 判断有效性。
 * 有效则续约 lease；无效则释放并调用纯函数 chooseTaskForRole 选择新任务。
 *
 * 无可用任务时返回 undefined — 角色应进入 idle 或回退行为。
 */
function requestAssignment(creep, ctx) {
    // 1. 验证现有 assignment。
    if (creep.memory.assignment) {
        const home = creep.memory.home ?? creep.room?.name ?? "";
        const layoutRevision = Memory.rooms[home]?.layout?.revision ?? 0;
        const assignment = creep.memory.assignment;
        // 通过缓存版 getObjectById 检查 target/source 存在性（P2-6 去重）。
        const targetExists = !assignment.targetId || getObjectById(assignment.targetId) !== null;
        const sourceExists = !assignment.sourceId || getObjectById(assignment.sourceId) !== null;
        if (validateAssignmentRules(assignment, ctx.tick, layoutRevision, targetExists, sourceExists)) {
            assignment.leaseUntil = ctx.tick + CONFIG.assignment.leaseDuration;
            return assignment;
        }
        // 无效 — 确定失效原因并记录事件。
        // failReasonCode: 0=lease 过期 1=revision 变化 2=target 消失 3=source 消失
        let failReason = 0;
        if (ctx.tick > assignment.leaseUntil)
            failReason = 0;
        else if (assignment.revision !== layoutRevision)
            failReason = 1;
        else if (assignment.targetId && !targetExists)
            failReason = 2;
        else if (assignment.sourceId && !sourceExists)
            failReason = 3;
        recordEvent(16 /* EventKind.AssignmentExpired */, home, [failReason]);
        // 无效 — 释放旧 assignment。
        releaseFromTask(creep);
        creep.memory.assignment = undefined;
    }
    // 2. 从预排序列表中选择新任务。
    const pool = getPool(ctx);
    if (!pool)
        return undefined;
    const home = creep.memory.home ?? creep.room?.name ?? "";
    const roomTasks = pool.getRoomTasks(home);
    if (!roomTasks)
        return undefined;
    const role = creep.memory.role ?? "unknown";
    const chosen = chooseTaskForRole(role, roomTasks, { x: creep.pos.x, y: creep.pos.y });
    if (!chosen)
        return undefined;
    const layoutRevision = Memory.rooms[home]?.layout?.revision ?? 0;
    const assignment = {
        id: chosen.id,
        kind: chosen.kind,
        targetId: chosen.targetId,
        sourceId: chosen.sourceId,
        revision: layoutRevision,
        assignedAt: ctx.tick,
        leaseUntil: ctx.tick + CONFIG.assignment.leaseDuration,
    };
    creep.memory.assignment = assignment;
    pool.assignCreep(chosen.id, creep.name);
    recordEvent(15 /* EventKind.AssignmentAssigned */, home, [chosen.priority]);
    return assignment;
}
/**
 * 获取或续约 creep 的任务分配（plan §5.7.2）。
 * 如果现有 assignment 有效则续约；否则从可用任务列表分配新的。
 * 无可用任务时返回 undefined — 角色应进入 idle 或回退行为。
 */
function getAssignment(creep, ctx) {
    return requestAssignment(creep, ctx);
}
/** 释放 creep 的当前任务分配。 */
function releaseAssignment(creep) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
}

/**
 * 卡位检测与脱困 — yield/pull 让路、渐进式脱困、目标清除、安全出口。
 *
 * 脱困四级策略（由 pathfinding.ts 的 moveToTarget 驱动）：
 *   Level 0（正常）：ignoreCreeps: true + road-preference
 *   Level 1（stuckTicks >= threshold）：tryPullBlocker 请求让路
 *   Level 2（stuckTicks >= threshold+1）：ignoreCreeps: false + reusePath: 0
 *   Level 3（stuckTicks >= threshold+repathLimit）：放弃目标，idle
 */
/** 方向 → (dx, dy) 偏移表。供 pathfinding 的前置绕路检测复用。 */
const DIR_DELTA = {
    [TOP]: [0, -1], [TOP_RIGHT]: [1, -1], [RIGHT]: [1, 0], [BOTTOM_RIGHT]: [1, 1],
    [BOTTOM]: [0, 1], [BOTTOM_LEFT]: [-1, 1], [LEFT]: [-1, 0], [TOP_LEFT]: [-1, -1],
};
// ─── Yield/Pull 让路机制 ─────────────────────────────────
/**
 * 请求阻挡 creep 让路。
 * 将让路请求存入 globalCache，目标 creep 在下一次 moveToTarget 调用时执行。
 * 同 tick 内优先级低的 creep 请求优先级高的 creep 让路时，
 * 由于高优先级 creep 已经执行过，请求会在下一 tick 生效。
 *
 * 设计意图：对静止 creep（如 harvester 站桩采矿）请求无效是正确行为——
 * 它们不调用 moveToTarget，请求自然过期。站桩矿工不应让出矿位，
 * 否则会导致采集效率崩塌。绕行 creep 应通过 ignoreCreeps:false 自行绕路。
 */
function requestYield(blockerName, dir) {
    const g = globalCache();
    if (!g.__yieldRequests)
        g.__yieldRequests = {};
    g.__yieldRequests[blockerName] = dir;
}
/**
 * 检查并执行让路请求。
 * 在 moveToTarget 开头调用 — 如果其他 creep 请求本 creep 让路，
 * 立即执行移动并返回 true（本 tick 不再执行其他移动逻辑）。
 */
function checkAndExecuteYield(creep) {
    const g = globalCache();
    if (!g.__yieldRequests)
        return false;
    const dir = g.__yieldRequests[creep.name];
    if (dir === undefined)
        return false;
    delete g.__yieldRequests[creep.name];
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED) {
        recordTraffic(creep);
    }
    return true;
}
/**
 * 尝试让阻挡 creep 让路（Level 1 脱困）。
 * 找到目标方向上的 creep，请求它沿同方向移动。
 */
function tryPullBlocker(creep, targetPos) {
    const dir = creep.pos.getDirectionTo(targetPos);
    const delta = DIR_DELTA[dir];
    if (!delta)
        return;
    const nextX = creep.pos.x + delta[0];
    const nextY = creep.pos.y + delta[1];
    if (nextX < 0 || nextX > 49 || nextY < 0 || nextY > 49)
        return;
    const blockers = creep.room.lookForAt(LOOK_CREEPS, nextX, nextY);
    if (blockers.length > 0) {
        const blocker = blockers[0];
        requestYield(blocker.name, dir);
    }
}
// ─── 卡位检测 ─────────────────────────────────────────────
/**
 * 更新卡位计数。仅在值变化时写 Memory，减少 Proxy 开销。
 * 返回当前 stuckTicks。
 */
function updateStuckTicks(creep) {
    const currentPacked = creep.pos.x * 50 + creep.pos.y;
    const prevStuck = creep.memory.stuckTicks ?? 0;
    if (creep.memory.lastPos === currentPacked) {
        if (prevStuck === 0)
            creep.memory.stuckTicks = 1;
        else
            creep.memory.stuckTicks = prevStuck + 1;
    }
    else if (prevStuck !== 0) {
        creep.memory.stuckTicks = 0;
    }
    if (creep.memory.lastPos !== currentPacked) {
        creep.memory.lastPos = currentPacked;
    }
    return creep.memory.stuckTicks ?? 0;
}
// ─── 目标清除 ─────────────────────────────────────────────
/** 清除 creep 的目标和分配，进入安全空闲。 */
function clearTarget(creep) {
    releaseFromTask(creep);
    creep.memory.targetId = undefined;
    creep.memory.assignment = undefined;
    creep.memory.stuckTicks = 0;
}
// ─── 安全出口 ─────────────────────────────────────────────
/**
 * 查找最安全的出口 — 选择与敌人方向夹角最大的出口（约束 G-DF-09）。
 * 用 dot-product 评分：负 dot = 与敌人方向相反 = 最安全。
 */
function findSafestExit(creep, enemyPos) {
    const exits = Game.map.describeExits(creep.room.name);
    if (!exits)
        return undefined;
    const enemyDirX = enemyPos.x - 25;
    const enemyDirY = enemyPos.y - 25;
    const exitCandidates = [];
    for (const dirStr of Object.keys(exits)) {
        const dir = Number(dirStr);
        let exitVecX = 0;
        let exitVecY = 0;
        switch (dir) {
            case TOP:
                exitVecY = -1;
                break;
            case RIGHT:
                exitVecX = 1;
                break;
            case BOTTOM:
                exitVecY = 1;
                break;
            case LEFT:
                exitVecX = -1;
                break;
            default: continue;
        }
        const dot = enemyDirX * exitVecX + enemyDirY * exitVecY;
        exitCandidates.push({ dir, dot });
    }
    if (exitCandidates.length === 0)
        return undefined;
    exitCandidates.sort((a, b) => a.dot - b.dot);
    const hasOpposite = exitCandidates[0].dot < 0;
    const chosenDir = hasOpposite
        ? exitCandidates[0].dir
        : exitCandidates[exitCandidates.length - 1].dir;
    return creep.pos.findClosestByRange(chosenDir) ?? undefined;
}

/**
 * 寻路核心 — 结构缓存、路径持久化、走廊共享、跨房间缓存、moveToTarget。
 *
 * 路径缓存三级优先级（moveToTarget 内部）：
 *   1. 跨 tick 持久化路径（per-creep，目标+结构不变则复用）
 *   2. 走廊共享路径（同 tick 多 creep 共享主干，末端分歧）
 *   3. 新计算 PathFinder + 持久化 + 放入共享缓存
 *
 * 跨房间路径缓存（remote mining 前置）：
 *   出口到出口的路径存 globalCache，地形不变则永不失效。
 */
/**
 * 从结构和工地数组构建 CostMatrix 位置数组。
 * 提取为共享辅助函数，消除 preloadStructureCache 与 ensureStructureCache 回退路径之间的重复。
 */
function buildStructurePositions(structures, sites) {
    const positions = [];
    for (const s of structures) {
        let cost;
        if (s.structureType === STRUCTURE_ROAD)
            cost = 1;
        else if (s.structureType === STRUCTURE_CONTAINER)
            cost = 2;
        else if (s.structureType === STRUCTURE_RAMPART && s.my)
            cost = 2;
        else
            cost = 255;
        positions.push(s.pos.x, s.pos.y, cost);
    }
    for (const site of sites) {
        if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
            positions.push(site.pos.x, site.pos.y, 255);
        }
    }
    return { count: structures.length + sites.length, positions };
}
/**
 * 预热结构缓存 — 由 room-snapshot 调用，利用已采集的数据避免冗余 room.find。
 * movement 模块拥有自己的缓存结构（__structCache），外部通过此函数写入，
 * 不再直接操作 globalCache as any（P1-2：消除隐式耦合）。
 */
function preloadStructureCache(roomName, structures, sites) {
    const g = globalCache();
    if (!g.__structCache)
        g.__structCache = {};
    const { count, positions } = buildStructurePositions(structures, sites);
    g.__structCache[roomName] = { count, positions, checkedTick: Game.time };
}
/**
 * 预热静态占位缓存 — 由 room-snapshot 调用，利用已采集的 container/source 数据。
 * 站桩位置 = source 旁 range<=1 的 container（harvester 矿位）+ controllerContainer（upgrader 站桩位）。
 * 这些位置每 tick 重算（creep 可能消失），只存 globalCache 不进 Memory。
 */
function preloadStaticBlockers(roomName, positions) {
    const g = globalCache();
    if (!g.__staticBlockersCache)
        g.__staticBlockersCache = {};
    g.__staticBlockersCache[roomName] = { positions, checkedTick: Game.time };
}
/**
 * 将静态占位标记到 CostMatrix — 在所有 roomCallback 末尾调用。
 * 命中条件：checkedTick === Game.time（本 tick 已预加载）。
 * 未命中则跳过（该房间无站桩数据时路径仍可正常计算，只是不会绕开站桩 creep）。
 */
function applyStaticBlockers(matrix, roomName) {
    const g = globalCache();
    const entry = g.__staticBlockersCache?.[roomName];
    if (!entry || entry.checkedTick !== Game.time)
        return;
    const positions = entry.positions;
    for (let i = 0; i < positions.length; i += 2) {
        matrix.set(positions[i], positions[i + 1], 255);
    }
}
/**
 * 确保房间的结构缓存是最新的。
 * 优先读取 room-snapshot 预热的缓存（零 room.find）；
 * 仅在预热缺失时回退到 room.find（向后兼容）。
 */
function ensureStructureCache(roomName) {
    const g = globalCache();
    if (!g.__structCache)
        g.__structCache = {};
    let entry = g.__structCache[roomName];
    // 本 tick 已预热（由 room-snapshot 构建）→ 直接返回。
    if (entry && entry.checkedTick === Game.time) {
        return entry;
    }
    // 回退路径：预热缺失时自行 room.find（不应在正常 tick 中触发）。
    const room = Game.rooms[roomName];
    if (!room)
        return undefined;
    const structures = room.find(FIND_STRUCTURES);
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    const count = structures.length + sites.length;
    if (entry && entry.count === count) {
        entry.checkedTick = Game.time;
        return entry;
    }
    const built = buildStructurePositions(structures, sites);
    entry = { count: built.count, positions: built.positions, checkedTick: Game.time };
    g.__structCache[roomName] = entry;
    return entry;
}
/**
 * costCallback — 将结构层成本叠加到引擎传入的地形矩阵上。
 * 返回 void（修改传入矩阵，保留地形成本）。
 */
function structureCostCallback(roomName, matrix) {
    const entry = ensureStructureCache(roomName);
    if (!entry)
        return;
    const positions = entry.positions;
    for (let i = 0; i < positions.length; i += 3) {
        matrix.set(positions[i], positions[i + 1], positions[i + 2]);
    }
    applyStaticBlockers(matrix, roomName);
}
// ─── 自适应 reusePath ─────────────────────────────────────
function adaptiveReusePath(creep, target) {
    const range = creep.pos.getRangeTo(target);
    if (range <= 3)
        return 3;
    if (range <= 10)
        return 5;
    return 15;
}
// ─── 疲劳感知 swampCost ──────────────────────────────────
const PART_WEIGHT = {
    [WORK]: 2, [CARRY]: 2, [MOVE]: 2,
    [ATTACK]: 3, [RANGED_ATTACK]: 3, [HEAL]: 3,
    [TOUGH]: 1, [CLAIM]: 5,
};
function fatigueSwampCost(creep) {
    const body = creep.body;
    let moveCapacity = 0;
    let totalWeight = 0;
    for (const part of body) {
        const weight = PART_WEIGHT[part.type] ?? 2;
        totalWeight += weight;
        if (part.type === MOVE)
            moveCapacity += 2;
    }
    return moveCapacity < totalWeight ? 255 : 10;
}
// ─── 同 tick 路径共享 ─────────────────────────────────────
function packRoomName(roomName) {
    const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!match)
        return 0;
    const x = Number(match[2]) * (match[1] === "W" ? -1 : 1);
    const y = Number(match[4]) * (match[3] === "N" ? -1 : 1);
    return x * 1000 + y;
}
function pathShareKey(roomName, packedPos) {
    return packRoomName(roomName) * 2500 + packedPos;
}
function getPathShareCache() {
    const g = globalCache();
    if (!g.__pathShare || g.__pathShareTick !== Game.time) {
        g.__pathShare = new Map();
        g.__pathShareTick = Game.time;
    }
    return g.__pathShare;
}
function trySharedPath(creep, cacheKey) {
    const cache = getPathShareCache();
    const path = cache.get(cacheKey);
    if (!path)
        return undefined;
    const result = creep.moveByPath(path);
    if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS)
        return undefined;
    return result;
}
// ─── 走廊共享（主干路径 + 末端分歧）─────────────────────
/**
 * 走廊共享 — 同 tick 内多 creep 走向同一区域时共享主干路径。
 *
 * 原理：hauler 填 5 个不同 extension（5 个不同目标），但前 80% 路径相同
 * （从 source container 到核心区域的主干）。只有最后 2-3 格分歧。
 *
 * 实现：
 *   - 走廊 key = roomHash * 2500 + packedZoneCenter（区域中心格）
 *   - 主干路径 = 从 creep 位置到区域边缘（range <= zoneRadius 时停止）
 *   - 末端 = 各自 moveTo 精确目标（短距离，开销可忽略）
 *
 * 区域定义：以 spawn 为中心、半径 4 的圆形区域 = "核心走廊"。
 * 未来可扩展为多走廊（source 走廊、controller 走廊）。
 */
/**
 * 获取房间的核心区域中心（spawn 位置）。
 *
 * tick 级 globalCache 缓存：
 *   - spawn 位置在单 tick 内不变，多 creep 共享同一缓存项。
 *   - 命中条件：cached.tick === Game.time。
 *   - 未命中：执行 room.find + 写缓存 → 后续 creep 直接读缓存。
 *   - 跨 tick 失效：Game.time 变化后首次调用重新 find。
 *
 * 缓存不耦合 layout revision — spawn 位置变化是极低频事件（layout 重建），
 * 且 movement 层不应感知 layout 系统。即使每 tick 重新 find 一次也只是 1 次 find，
 * 相比每 creep 都 find 的原实现已是数量级优化。
 *
 * @internal 仅供 pathfinding 内部 + 单元测试使用。外部消费者应通过
 *            moveToTarget 间接依赖走廊共享能力，不直接调用此函数。
 */
function getCoreCenter(roomName) {
    const g = globalCache();
    if (!g.__coreCenter)
        g.__coreCenter = {};
    const cached = g.__coreCenter[roomName];
    if (cached && cached.tick === Game.time)
        return cached.pos;
    const room = Game.rooms[roomName];
    if (!room)
        return undefined;
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0)
        return undefined;
    const pos = { x: spawns[0].pos.x, y: spawns[0].pos.y };
    g.__coreCenter[roomName] = { tick: Game.time, pos };
    return pos;
}
/** 走廊共享缓存 key：roomHash * 2500 + packedZoneCenter。 */
function corridorKey(roomName, zoneCenter) {
    return packRoomName(roomName) * 2500 + (zoneCenter.x * 50 + zoneCenter.y);
}
/** 核心走廊半径（进入此范围后各 creep 分歧到各自目标）。 */
const CORRIDOR_ZONE_RADIUS = 4;
/**
 * 尝试使用走廊共享路径。
 * 如果 creep 在走廊区域外且目标是走廊区域内，共享主干路径到区域边缘。
 * 返回 OK/ERR_TIRED 表示成功使用了走廊路径；undefined 表示不适用。
 */
function tryCorridorPath(creep, target) {
    const center = getCoreCenter(creep.room.name);
    if (!center)
        return undefined;
    // 只有目标在核心区域内才使用走廊共享。
    const targetDistToCore = Math.max(Math.abs(target.x - center.x), Math.abs(target.y - center.y));
    if (targetDistToCore > CORRIDOR_ZONE_RADIUS)
        return undefined;
    // creep 已在区域内 — 不需要走廊（短距离直接 moveTo）。
    const creepDistToCore = Math.max(Math.abs(creep.pos.x - center.x), Math.abs(creep.pos.y - center.y));
    if (creepDistToCore <= CORRIDOR_ZONE_RADIUS + 1)
        return undefined;
    const cKey = corridorKey(creep.room.name, center);
    const cache = getPathShareCache();
    const trunkPath = cache.get(cKey);
    if (trunkPath) {
        // 复用主干路径。
        const result = creep.moveByPath(trunkPath);
        if (result !== ERR_NOT_FOUND && result !== ERR_INVALID_ARGS)
            return result;
    }
    // 首个到该走廊的 creep — 计算主干路径（到区域边缘 range = CORRIDOR_ZONE_RADIUS+1）。
    const centerPos = new RoomPosition(center.x, center.y, creep.room.name);
    const result = PathFinder.search(creep.pos, { pos: centerPos, range: CORRIDOR_ZONE_RADIUS + 1 }, {
        plainCost: 2,
        swampCost: fatigueSwampCost(creep),
        maxRooms: 1,
        roomCallback: (roomName) => {
            const room = Game.rooms[roomName];
            if (!room)
                return false;
            const matrix = new PathFinder.CostMatrix();
            const entry = ensureStructureCache(roomName);
            if (entry) {
                const positions = entry.positions;
                for (let i = 0; i < positions.length; i += 3) {
                    matrix.set(positions[i], positions[i + 1], positions[i + 2]);
                }
            }
            applyStaticBlockers(matrix, roomName);
            return matrix;
        },
    });
    if (!result.incomplete && result.path.length > 0) {
        cache.set(cKey, result.path);
        const moveResult = creep.moveByPath(result.path);
        if (moveResult !== ERR_NOT_FOUND && moveResult !== ERR_INVALID_ARGS)
            return moveResult;
    }
    return undefined;
}
function getCreepPathCache() {
    const g = globalCache();
    if (!g.__creepPathCache)
        g.__creepPathCache = {};
    return g.__creepPathCache;
}
function tryPersistedPath(creep, targetPacked, structCount) {
    const cache = getCreepPathCache();
    const entry = cache[creep.name];
    if (!entry)
        return undefined;
    if (entry.targetKey !== targetPacked)
        return undefined;
    if (entry.structCount !== structCount)
        return undefined;
    const result = creep.moveByPath(entry.path);
    if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) {
        delete cache[creep.name];
        return undefined;
    }
    return result;
}
function computeAndPersistPath(creep, pos, targetPacked, structCount) {
    const result = PathFinder.search(creep.pos, { pos, range: 1 }, {
        plainCost: 2,
        swampCost: fatigueSwampCost(creep),
        maxRooms: CONFIG.movement.localMaxRooms,
        roomCallback: (roomName) => {
            const room = Game.rooms[roomName];
            if (!room)
                return false;
            const matrix = new PathFinder.CostMatrix();
            const entry = ensureStructureCache(roomName);
            if (entry) {
                const positions = entry.positions;
                for (let i = 0; i < positions.length; i += 3) {
                    matrix.set(positions[i], positions[i + 1], positions[i + 2]);
                }
            }
            applyStaticBlockers(matrix, roomName);
            return matrix;
        },
    });
    if (result.incomplete || result.path.length === 0)
        return undefined;
    getCreepPathCache()[creep.name] = { targetKey: targetPacked, structCount, path: result.path };
    return result.path;
}
function getInterRoomCache() {
    const g = globalCache();
    if (!g.__interRoomCache)
        g.__interRoomCache = {};
    return g.__interRoomCache;
}
/** 缓存跨房间出口信息。 */
function cacheInterRoomExit(fromRoom, toRoom, exitDir, exitPos) {
    getInterRoomCache()[`${fromRoom}:${toRoom}`] = {
        exitDir,
        exitPos: { x: exitPos.x, y: exitPos.y },
    };
}
/** 查询缓存的跨房间出口信息。 */
function getCachedInterRoomExit(fromRoom, toRoom) {
    return getInterRoomCache()[`${fromRoom}:${toRoom}`];
}
/** 清除缓存的跨房间出口信息（卡位脱困时调用，强制下次重新选出口）。 */
function clearInterRoomExit(fromRoom, toRoom) {
    delete getInterRoomCache()[`${fromRoom}:${toRoom}`];
}
// ─── 核心移动函数 ─────────────────────────────────────────
/**
 * 向目标房间方向移动（通过最近出口），带道路优先 + 跨房间缓存 + 卡位脱困。
 *
 * 卡位脱困（与 moveToTarget 对齐但精简）：
 *   Level 0（正常）：reusePath: 5 + ignoreCreeps: true
 *   Level 1（stuck >= threshold）：reusePath: 0 强制重算路径
 *   Level 2（stuck >= threshold + repathLimit）：清出口缓存 + 换出口位置
 */
function moveTowardRoom(creep, targetRoom) {
    // 卡位检测 — 确保 ensureHome 提前 return 时仍能追踪 stuck 状态。
    const stuckTicks = updateStuckTicks(creep);
    const { stuckThreshold, repathLimit } = CONFIG.kernel;
    // Level 2：严重卡位 → 清出口缓存，下次重新选出口。
    if (stuckTicks >= stuckThreshold + repathLimit) {
        clearInterRoomExit(creep.room.name, targetRoom);
        // 强制 repath + ignoreCreeps: false 绕过阻挡 creep。
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir < 0)
            return;
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) {
            creep.moveTo(exit, {
                reusePath: 0,
                plainCost: 2,
                swampCost: 10,
                ignoreCreeps: false,
                costCallback: structureCostCallback,
            });
        }
        return;
    }
    // 尝试使用缓存的出口信息（避免每 tick 调用 findExitTo + findClosestByRange）。
    const cached = getCachedInterRoomExit(creep.room.name, targetRoom);
    let exit = null;
    if (cached) {
        exit = new RoomPosition(cached.exitPos.x, cached.exitPos.y, creep.room.name);
    }
    else {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir < 0)
            return;
        exit = creep.pos.findClosestByRange(exitDir);
        if (exit) {
            cacheInterRoomExit(creep.room.name, targetRoom, exitDir, exit);
        }
    }
    if (exit) {
        // Level 1：卡位 → reusePath: 0 强制重算路径。
        const reusePath = stuckTicks >= stuckThreshold ? 0 : 5;
        const result = creep.moveTo(exit, {
            reusePath,
            plainCost: 2,
            swampCost: 10,
            costCallback: structureCostCallback,
        });
        if (result === OK || result === ERR_TIRED) {
            recordTraffic(creep);
        }
    }
}
/**
 * 确保 creep 已设置 home 房间；不在 home 时尝试向 home 方向移动。
 * 只有 creep 实际在 home 房间内时才返回 true。
 *
 * 远程角色（remoteTarget 已设置）的导航规则：
 *   - remoteHauler work 模式 → 回 home 存能（穿梭行为）
 *   - 其他远程角色 → 常驻 remoteTarget
 *   - idle/flee 模式 → 回 home（安全）
 */
function ensureHome(creep) {
    if (!creep.memory.home) {
        creep.memory.home = creep.room.name;
    }
    const home = creep.memory.home;
    // 远程角色导航
    const remoteTarget = creep.memory.remoteTarget;
    if (remoteTarget) {
        const mode = creep.memory.mode ?? "acquire";
        // idle/flee → 回 home（安全）
        // remoteHauler work → 回 home（存能）
        // 其余 → remoteTarget
        // Bug 2 修复（扩展到全部远矿角色）：在 remoteTarget idle（container 空 /
        // source 被压制 / 无事可做）时不导航回 home，留在目标房等待条件恢复。
        // 否则 home↔remoteTarget 振荡：remoteTarget idle → goHome → home →
        // updateMode 转 acquire → 导航回 remoteTarget → 又 idle → goHome → ...
        // creep 在两房边界来回穿梭直至寿终（remoteHarvester 在 InvaderCore 压制房
        // 正是这个症状；被 recycle 标记的 creep 由 recyclePass 接管移动，不受此影响）。
        const goHome = mode === "flee" ||
            (mode === "idle" && creep.room.name !== remoteTarget) ||
            (mode === "work" && creep.memory.role === "remoteHauler");
        const dest = goHome ? home : remoteTarget;
        if (creep.room.name === dest)
            return true;
        moveTowardRoom(creep, dest);
        return false;
    }
    // 本地角色：原行为
    if (creep.room.name === home)
        return true;
    moveTowardRoom(creep, home);
    return false;
}
/**
 * 移动到目标 — 带自适应路径缓存、走廊共享、渐进式脱困。
 *
 * 路径缓存优先级：
 *   1. 跨 tick 持久化（per-creep，目标+结构不变）
 *   2. 走廊共享（同 tick 同区域主干）
 *   3. 同 tick 精确目标共享
 *   4. 新 PathFinder + 持久化
 *   5. 回退 moveTo（引擎内置缓存）
 *
 * 仅在操作返回 ERR_NOT_IN_RANGE 时调用。
 */
function moveToTarget(creep, target) {
    const pos = "pos" in target ? target.pos : target;
    // Yield 检查。
    if (checkAndExecuteYield(creep))
        return OK;
    // 短路：range <= 1。
    const range = creep.pos.getRangeTo(pos);
    if (range <= 1) {
        const dir = creep.pos.getDirectionTo(pos);
        const result = creep.move(dir);
        if (result === OK || result === ERR_TIRED)
            recordTraffic(creep);
        return result;
    }
    // 卡位检测。
    const stuckTicks = updateStuckTicks(creep);
    const { stuckThreshold, repathLimit } = CONFIG.kernel;
    // Level 3：放弃。
    if (stuckTicks >= stuckThreshold + repathLimit) {
        clearTarget(creep);
        creep.memory.mode = "idle";
        return ERR_NO_PATH;
    }
    // Level 1：pull。
    if (stuckTicks === stuckThreshold) {
        tryPullBlocker(creep, pos);
    }
    // ── 方案 A：前置检测前方一格有 creep 时立即绕路（不等 stuckTicks 累积）──
    // 根因：PathFinder 的 roomCallback 默认不把 creep 当障碍，新算路径会穿过 creep，
    // 后续 creep 复用 __pathShare 缓存导致火车排队。
    // 仅在 stuckTicks === 0 时检测——一旦卡住（stuckTicks > 0），Level 1/2 脱困接管。
    if (stuckTicks === 0 && range > 1) {
        const dir = creep.pos.getDirectionTo(pos);
        const delta = DIR_DELTA[dir];
        if (delta) {
            const nextX = creep.pos.x + delta[0];
            const nextY = creep.pos.y + delta[1];
            if (nextX >= 0 && nextX <= 49 && nextY >= 0 && nextY <= 49) {
                const blockers = creep.room.lookForAt(LOOK_CREEPS, nextX, nextY);
                if (blockers.length > 0) {
                    // 前方一格有 creep，跳过缓存直接让引擎绕路。
                    const result = creep.moveTo(pos, {
                        reusePath: 0,
                        ignoreCreeps: false,
                        maxRooms: CONFIG.movement.localMaxRooms,
                        range: 1,
                        plainCost: 2,
                        swampCost: fatigueSwampCost(creep),
                        costCallback: structureCostCallback,
                    });
                    if (result === OK || result === ERR_TIRED)
                        recordTraffic(creep);
                    return result;
                }
            }
        }
    }
    // ── 路径缓存（Level 0 + 中远距离）──
    if (stuckTicks === 0 && range > 3) {
        const targetPacked = packPos$1(pos);
        const structEntry = ensureStructureCache(creep.room.name);
        const structCount = structEntry?.count ?? -1;
        // 1. 跨 tick 持久化。
        const persistedResult = tryPersistedPath(creep, targetPacked, structCount);
        if (persistedResult !== undefined) {
            if (persistedResult === OK || persistedResult === ERR_TIRED)
                recordTraffic(creep);
            return persistedResult;
        }
        // 2. 走廊共享（主干路径到核心区域边缘）。
        const corridorResult = tryCorridorPath(creep, pos);
        if (corridorResult !== undefined) {
            if (corridorResult === OK || corridorResult === ERR_TIRED)
                recordTraffic(creep);
            return corridorResult;
        }
        // 3. 同 tick 精确目标共享。
        const cacheKey = pathShareKey(creep.room.name, targetPacked);
        const sharedResult = trySharedPath(creep, cacheKey);
        if (sharedResult !== undefined) {
            if (sharedResult === OK || sharedResult === ERR_TIRED)
                recordTraffic(creep);
            return sharedResult;
        }
        // 4. 新计算 + 持久化 + 共享。
        const path = computeAndPersistPath(creep, pos, targetPacked, structCount);
        if (path) {
            getPathShareCache().set(cacheKey, path);
            const result = creep.moveByPath(path);
            if (result !== ERR_NOT_FOUND && result !== ERR_INVALID_ARGS) {
                if (result === OK || result === ERR_TIRED)
                    recordTraffic(creep);
                return result;
            }
        }
    }
    // ── 回退：moveTo（引擎内置缓存）──
    const reusePath = stuckTicks >= stuckThreshold + 1 ? 0 : adaptiveReusePath(creep, pos);
    const ignoreCreeps = stuckTicks < stuckThreshold;
    const options = {
        reusePath,
        maxRooms: CONFIG.movement.localMaxRooms,
        ignoreCreeps,
        range: 1,
        plainCost: 2,
        swampCost: fatigueSwampCost(creep),
        costCallback: structureCostCallback,
    };
    const result = creep.moveTo(pos, options);
    if (result === OK || result === ERR_TIRED)
        recordTraffic(creep);
    return result;
}

/**
 * 归位（Parking）— 非站桩角色 idle 时主动离开关键格/道路，根治交通阻塞。
 *
 * 根因：role-runner 在无匹配候选时设 mode=idle 后 return，creep 原地石化。
 * 它停在「最后一次干活的位置」——可能是 source 旁（堵矿工）、spawn 前（堵孵化出口）、
 * 工地旁（堵 builder）、road 上（堵所有过路 creep）。idle 位置是路径无关的随机残留，
 * 无法预测，只能用统一的归位行为收拢。
 *
 * 设计原则（方案 C 通用算法）：
 *   - 停车位完全从 per-room 实时快照推导（snapshot 的结构/工地 + room 地形 + 实时 creep 位置），
 *     不预设任何位置表，不引用其他房间数据。算法对任意房间地形成立。
 *   - 站桩角色（harvester/upgrader）不参与——它们的 idle 是守在矿位/controller 旁，
 *     本就正确。仅 hauler/distributor/builder/worker 归位（由 role-runner 的 park 标志控制）。
 *
 * 安全性判定（isSafeSpot）：当前位置同时满足
 *   1. 不是关键格（source/controller/spawn/storage/工地 旁 range≤1）
 *   2. 不在 road 上（road 是交通主干道，停上面挡移动方）
 *   → 已经安全则不动（避免每 tick 重新寻路浪费 CPU + 防振荡）。
 *
 * 归位策略（findParkSpot）：8 邻域选最优格，评分优先级
 *   非关键格 > 非 road > 靠近核心（spawn 方向，缩短下次出勤通勤）。
 *   只在邻域内单步移动——归位是「让出关键格/道路」，不是「长途跋涉找完美停车位」。
 *
 * 防聚堆：__parkReservations 每 tick 重置，已安全/已选目标的 creep 预约各自格子，
 *   多 creep 不会抢同一格、不会互相把对方挤来挤去（振荡）。
 *
 * 数据来源约束：结构/工地/道路全部来自 RoomSnapshot（per-tick 预构建，O(1) 查询），
 *   仅「实时 creep 占位」用 room.lookForAt(LOOK_CREEPS)（快照不含其他 creep 的瞬时位置）。
 *   不做 lookForAt(LOOK_STRUCTURES) — 避免与快照重复扫描，且保证测试与生产同源。
 */
/** 归位预约缓存：本 tick 已被占用的目标格（packed pos 集合），每 tick 重置。 */
function getParkReservations() {
    const g = globalCache();
    if (!g.__parkReservations || g.__parkReservationsTick !== Game.time) {
        g.__parkReservations = new Set();
        g.__parkReservationsTick = Game.time;
    }
    return g.__parkReservations;
}
/**
 * 从快照构建本房归位数据（每房每 tick 缓存一次）。
 *
 * - critical：站桩工作位 + 结构出口旁（source/controller/spawn/storage/工地 的 range≤1 邻域）。
 *   idle creep 停在这些格会阻塞生产/孵化/建造。
 * - roads：道路格（交通主干道，idle 停上面挡移动方）。
 * - blocking：不可站立的阻挡结构格（墙/extension/tower 等；road/container/rampart 可站立不算）。
 *
 * 全部从 per-room 快照推导，对任意房间地形自适应，不依赖预设位置表。
 */
function getParkRoomData(snapshot) {
    const g = globalCache();
    if (!g.__parkRoomData)
        g.__parkRoomData = {};
    const cached = g.__parkRoomData[snapshot.roomName];
    if (cached && cached.tick === Game.time)
        return cached.data;
    const critical = new Set();
    const markAround = (x, y) => {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx <= 49 && ny >= 0 && ny <= 49)
                    critical.add(nx * 50 + ny);
            }
        }
    };
    for (const s of snapshot.sources)
        markAround(s.pos.x, s.pos.y);
    if (snapshot.controller)
        markAround(snapshot.controller.pos.x, snapshot.controller.pos.y);
    for (const sp of snapshot.spawns)
        markAround(sp.pos.x, sp.pos.y);
    if (snapshot.storage)
        markAround(snapshot.storage.pos.x, snapshot.storage.pos.y);
    for (const site of snapshot.myConstructionSites)
        markAround(site.pos.x, site.pos.y);
    const roads = new Set();
    for (const r of snapshot.roads)
        roads.add(packPos$1(r.pos));
    const blocking = new Set();
    const addIfBlocking = (type, x, y) => {
        // road/container/rampart 可站立（creep 能停上面），其余结构阻挡归位。
        if (type !== STRUCTURE_ROAD &&
            type !== STRUCTURE_CONTAINER &&
            type !== STRUCTURE_RAMPART) {
            blocking.add(x * 50 + y);
        }
    };
    const allStructures = [
        ...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers,
        ...snapshot.roads, ...snapshot.walls, ...snapshot.ramparts, ...snapshot.links,
        ...snapshot.labs,
    ];
    for (const s of allStructures)
        addIfBlocking(s.structureType, s.pos.x, s.pos.y);
    if (snapshot.storage)
        addIfBlocking(snapshot.storage.structureType, snapshot.storage.pos.x, snapshot.storage.pos.y);
    if (snapshot.terminal)
        addIfBlocking(snapshot.terminal.structureType, snapshot.terminal.pos.x, snapshot.terminal.pos.y);
    if (snapshot.extractor)
        addIfBlocking(snapshot.extractor.structureType, snapshot.extractor.pos.x, snapshot.extractor.pos.y);
    if (snapshot.factory)
        addIfBlocking(snapshot.factory.structureType, snapshot.factory.pos.x, snapshot.factory.pos.y);
    for (const site of snapshot.myConstructionSites)
        addIfBlocking(site.structureType, site.pos.x, site.pos.y);
    const data = { critical, roads, blocking };
    g.__parkRoomData[snapshot.roomName] = { tick: Game.time, data };
    return data;
}
/** 地形是否可站立（非墙）。边界外视为墙。 */
function isWalkableTerrain(room, x, y) {
    if (x < 0 || x > 49 || y < 0 || y > 49)
        return false;
    return room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL;
}
/** 该格是否被 creep 占用（实时位置，快照不含其他 creep 瞬时位置）。 */
function hasCreepAt(room, x, y) {
    return room.lookForAt(LOOK_CREEPS, x, y).length > 0;
}
/**
 * 8 邻域选最优归位格。返回目标格坐标，无可用格则 undefined。
 *
 * 评分（越小越优）：
 *   +1000 关键格（绝不去——会把一个阻塞换成另一个阻塞）
 *   +100  road（尽量避开主干道）
 *   +到核心距离（靠近 spawn，缩短下次出勤通勤；无 spawn 时此项为 0）
 */
function findParkSpot(creep, snapshot, data, reserved) {
    const room = creep.room;
    const coreX = snapshot.spawns[0]?.pos.x;
    const coreY = snapshot.spawns[0]?.pos.y;
    const currentPacked = packPos$1(creep.pos);
    const onBlockingTile = data.critical.has(currentPacked) || data.roads.has(currentPacked);
    const coreDist = (x, y) => coreX !== undefined && coreY !== undefined
        ? Math.max(Math.abs(x - coreX), Math.abs(y - coreY))
        : 0;
    const candidates = [];
    for (const dir of Object.keys(DIR_DELTA)) {
        const delta = DIR_DELTA[Number(dir)];
        if (!delta)
            continue;
        const nx = creep.pos.x + delta[0];
        const ny = creep.pos.y + delta[1];
        const packed = nx * 50 + ny;
        if (!isWalkableTerrain(room, nx, ny))
            continue;
        if (data.blocking.has(packed))
            continue;
        if (hasCreepAt(room, nx, ny))
            continue;
        if (reserved.has(packed))
            continue;
        candidates.push({ x: nx, y: ny, critical: data.critical.has(packed), road: data.roads.has(packed), core: coreDist(nx, ny) });
    }
    if (candidates.length === 0)
        return undefined;
    // 阶段 1（逃离）：当前在关键格/road 上时，只选「非关键且非 road」的真逃离格，
    //   其中取最靠近核心者（缩短下次出勤通勤）。这保证只要存在逃离格，一步就离开阻塞格，
    //   绝不会被 core 距离牵引进关键区深处振荡。
    if (onBlockingTile) {
        let escape;
        for (const c of candidates) {
            if (c.critical || c.road)
                continue;
            if (!escape || c.core < escape.core)
                escape = c;
        }
        if (escape)
            return { x: escape.x, y: escape.y };
    }
    // 阶段 2（尽力外移）：无真逃离格（深陷 3×3 关键区中心，四邻皆关键）时，
    //   退而求其次：非关键格优先，再取最靠近核心者，逐 tick 向外走直到出现逃离格。
    let best;
    for (const c of candidates) {
        if (!best) {
            best = c;
            continue;
        }
        if (c.critical !== best.critical) {
            if (!c.critical)
                best = c;
            continue;
        }
        if (c.road !== best.road) {
            if (!c.road)
                best = c;
            continue;
        }
        if (c.core < best.core)
            best = c;
    }
    return best ? { x: best.x, y: best.y } : undefined;
}
/**
 * 归位主入口 — role-runner 在 creep 无匹配候选（即将 idle）时调用。
 *
 * 行为：
 *   1. 已在安全格 → 预约本格，不动（防振荡 + 防重复寻路）。
 *   2. 在关键格/road 上 → 单步移到最优邻格并预约。
 *   3. 无可用邻格 → 不动（保持 idle，下 tick 再试）。
 *
 * 仅对非站桩角色调用（harvester/upgrader 不参与，由 role-runner 的 park 标志控制）。
 */
function parkIdleCreep(creep, snapshot) {
    const room = creep.room;
    // 能力守卫：归位需要地形查询与 lookForAt（探测实时 creep 占位）。
    // 精简 room mock（角色单元测试）不实现这些方法时跳过归位——归位是尽力行为，
    // 缺失环境下保持原 idle 行为即可，不应让角色管线崩溃。
    if (typeof room.getTerrain !== "function" || typeof room.lookForAt !== "function") {
        return;
    }
    const reserved = getParkReservations();
    const currentPacked = packPos$1(creep.pos);
    const data = getParkRoomData(snapshot);
    // 已安全：预约本格，不动。
    if (!data.critical.has(currentPacked) && !data.roads.has(currentPacked)) {
        reserved.add(currentPacked);
        return;
    }
    const spot = findParkSpot(creep, snapshot, data, reserved);
    if (!spot)
        return;
    reserved.add(spot.x * 50 + spot.y);
    const spotPos = room.getPositionAt(spot.x, spot.y);
    if (!spotPos)
        return;
    const dir = creep.pos.getDirectionTo(spotPos);
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED)
        recordTraffic(creep);
}

/**
 * Action 共享辅助 — 跨领域复用的 execute 层工具函数。
 *
 * 从 role-runner.ts 迁出，消除 actions → role-runner 的循环依赖。
 * role-runner 属于引擎层（生命周期调度），runAction 属于 execute 层（行为执行辅助）。
 */
/**
 * 执行操作并统一处理错误码。
 *
 * 统一了 30+ action 的错误处理模式：
 *   - `ERR_NOT_IN_RANGE`（-9）：自动触发 `moveToTarget`，无需声明。
 *   - 其他错误码：查 `handlers` 表，有则执行对应闭包。
 *   - 未注册的错误码：静默忽略（调用方可通过返回值自行判断）。
 *
 * 每个 action 的 `execute` 只需声明它关心哪些错误码及对应副作用，
 * 不再裸写 `if (result === ERR_xxx)` 分支 — 消除六种不一致模式的根源。
 *
 * @returns Screeps 结果码（供调用方自行判断）
 *
 * @example
 * // transfer 满了 → 清缓存 + 切 mode
 * runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
 *   [ERR_FULL]: () => {
 *     ac.creep.memory.fillTargetId = undefined;
 *     updateMode(ac.creep);
 *   },
 * });
 *
 * @example
 * // build 目标消失 → 清 targetId
 * runAction(ac.creep, site, () => ac.creep.build(site), {
 *   [ERR_INVALID_TARGET]: () => { ac.creep.memory.targetId = undefined; },
 * });
 *
 * @example
 * // 无额外错误处理（等价于 actOrMove）
 * runAction(ac.creep, t, () => ac.creep.withdraw(t, RESOURCE_ENERGY));
 */
function runAction(creep, target, action, handlers) {
    const result = action();
    if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, target);
    }
    else if (handlers) {
        const handler = handlers[result];
        if (handler)
            handler();
    }
    return result;
}

/** 获取或分配 creep 的 source。将 sourceId 存入 memory。 */
function getSource(creep, snapshot) {
    // 先尝试缓存的 source。
    if (creep.memory.sourceId) {
        const source = getObjectById(creep.memory.sourceId);
        if (source) {
            // 拥挤检测：如果当前 source 占用超过公平份额，且存在更空闲的 source，则重分配。
            // 公平份额 = ceil(总占用 / source 数量)。例如 2 harvester + 2 source → 每个最多 1。
            if (snapshot.sources.length > 1) {
                const myCount = snapshot.sourceOccupancy.get(source.id) ?? 0;
                let totalOccupancy = 0;
                let minCount = Infinity;
                for (const s of snapshot.sources) {
                    const c = snapshot.sourceOccupancy.get(s.id) ?? 0;
                    totalOccupancy += c;
                    if (c < minCount)
                        minCount = c;
                }
                const fairShare = Math.ceil(totalOccupancy / snapshot.sources.length);
                // 当前 source 超过公平份额 且 存在更空闲的 source → 迁移。
                if (myCount > fairShare && minCount < myCount) {
                    creep.memory.sourceId = undefined;
                    // 落入下方重分配逻辑。
                }
                else {
                    return source;
                }
            }
            else {
                return source;
            }
        }
        else {
            // source 消失 — 清除并重新分配。
            creep.memory.sourceId = undefined;
        }
    }
    // 使用快照数据分配占用最少的 source（无需全局扫描）。
    let best;
    let bestCount = Infinity;
    for (const source of snapshot.sources) {
        const count = snapshot.sourceOccupancy.get(source.id) ?? 0;
        if (count < bestCount) {
            bestCount = count;
            best = source;
        }
    }
    if (best) {
        creep.memory.sourceId = best.id;
    }
    return best;
}
/**
 * 查找最近的需能量结构（有空闲容量的 spawn 或 extension）。
 * 使用引擎原生 findClosestByRange 替代手动迭代。
 */
function getFillTarget(creep, snapshot) {
    if (snapshot.fillTargets.length === 0)
        return undefined;
    return creep.pos.findClosestByRange(snapshot.fillTargets) ?? undefined;
}
/**
 * Hauler 填充目标的优先级层级（threat 感知）。
 *
 * 返回有序的类型桶 — 调用者按序遍历，第一个有匹配的桶中取最近目标。
 * threat 存在时 tower 提升到最高优先（防御弹药是生存关键）。
 * 末尾空桶匹配所有剩余类型（回退兜底）。
 *
 * 注意：controller container 的特殊优先级（< 半满时插队）
 * 由 getHaulFillTarget 在调用此函数之前自行处理，不包含在此通用层级中 —
 * flee 场景不需要补给 controller container（非生存关键）。
 */
function haulerFillTiers(hasThreats) {
    return hasThreats
        ? [[STRUCTURE_TOWER], [STRUCTURE_SPAWN, STRUCTURE_EXTENSION], []]
        : [[STRUCTURE_SPAWN, STRUCTURE_EXTENSION], [STRUCTURE_TOWER], []];
}
/** 在 targets 中找最近的「未预约」目标；给定 types 时仅在这些结构类型中挑选。 */
function pickFillTarget(creep, targets, reserved, types) {
    const pool = targets.filter(s => !reserved.has(s.id) && (types === undefined || types.includes(s.structureType)));
    if (pool.length === 0)
        return undefined;
    return creep.pos.findClosestByRange(pool) ?? undefined;
}
/**
 * Hauler 专用的填充目标选择 — 带优先级与每 tick 预约去重。
 *
 * 老玩家填充优先级：
 *   0. controller container 低于半满时优先补 1 个 hauler（站桩升级供能核心，远离核心区易饿死）。
 *   1. spawn / extension —— 孵化引擎，断能即停产，最高优先。
 *   2. tower —— 防御/维修，次之。
 *   3. 其余（如非紧急的 controller container）。
 * 同级取最近未预约者；预约集合按 tick 惰性重置，避免多 hauler 抢同一目标互相堵位。
 * 所有目标都被预约时回退到最近目标（允许共享），避免死锁。
 */
function getHaulFillTarget(creep, snapshot) {
    if (snapshot.fillTargets.length === 0)
        return undefined;
    const g = globalCache();
    if (!g.fillReservations || g.fillReservationTick !== Game.time) {
        g.fillReservations = new Set();
        g.fillReservationTick = Game.time;
    }
    const reserved = g.fillReservations;
    const hasThreats = snapshot.threatCreeps.length > 0;
    // P1-3: 威胁存在时 tower 提升到最高优先级 — 防御弹药是生存关键。
    // tower 每次攻击消耗 10 能量，hauler 必须在威胁期间优先补给 tower 保持防御火力。
    if (hasThreats) {
        const tower = pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_TOWER]);
        if (tower) {
            reserved.add(tower.id);
            return tower;
        }
    }
    // 0. 站桩升级保障：controller container 低于半满时优先派一个 hauler 补给。
    const cc = snapshot.controllerContainer;
    if (cc &&
        cc.store.getFreeCapacity(RESOURCE_ENERGY) > cc.store.getUsedCapacity(RESOURCE_ENERGY) &&
        !reserved.has(cc.id)) {
        reserved.add(cc.id);
        return cc;
    }
    // 1→2→3 按 haulerFillTiers 优先级层级遍历（与 flee 逻辑共享同一层级定义）。
    // threat 时首个 [TOWER] 层级已在上方处理，此处为冗余遍历但无副作用 —
    // 已预留的 tower 会被 pickFillTarget 的 reserved 过滤排除。
    for (const types of haulerFillTiers(hasThreats)) {
        const target = pickFillTarget(creep, snapshot.fillTargets, reserved, types.length > 0 ? types : undefined);
        if (target) {
            reserved.add(target.id);
            return target;
        }
    }
    // 全部已预约 — 回退最近目标（允许共享）避免死锁。
    return (creep.pos.findClosestByRange(snapshot.fillTargets) ?? undefined);
}
/**
 * 根据 storage 库存的**绝对能量值**计算 distributor 调度档位。
 *
 * 刻度口径（曾经的教训）：不能用 energy/capacity 比例 — storage 总容量
 * 1,000,000，比例 10% = 10 万能量，发展期房间（库存数百到数万）永久卡在
 * tier 3「仅填 spawn」模式，extension 断供。绝对阈值来自
 * CONFIG.economy.distributorTiers，与 upgrade 调度（sprintStorage/
 * sustainedStorage）同一参照系。
 *
 * 边界不加迟滞：tier 只影响单车取量与目标类型，抖动代价小
 * （不像 colonyState 有全房爆炸半径），不值得引入驻留状态。
 * 无 storage 时返回 0（不限制）。
 */
function computeDistributorTier(storage) {
    if (!storage)
        return 0;
    const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);
    const tiers = CONFIG.economy.distributorTiers;
    if (energy >= tiers.full)
        return 0;
    if (energy >= tiers.sustained)
        return 1;
    if (energy >= tiers.low)
        return 2;
    return 3;
}
/**
 * Distributor 专用的填充目标选择 — 与 hauler 的 getHaulFillTarget 职责分离。
 *
 * 角色边界（修复角色错配）：
 *   distributor 的职责是 storage → 生产 sink。spawn/extension 是生产引擎，
 *   断能即停产 = 全盘崩溃，是绝对最高优先——即使敌袭期间也不让位 tower，
 *   因为 spawn 没能量就产不出防御 creep，等于釜底抽薪。
 *
 *   旧实现复用 hauler 专用的 getHaulFillTarget，其 #0 优先是 controller container
 *   （< 半满即派），导致 distributor 被持续 divert 去喂升级无底洞，spawn/extension
 *   长期排第二；且与 link 网络的 source/storage→controller 供能冗余，形成
 *   storage→distributor→controller container 的回流环路。本函数根治该错配。
 *
 * 优先级：
 *   1. spawn / extension —— 生产引擎，绝对最高（威胁下也不让位）。
 *   2. tower —— 防御/维修（tier >= 3 时跳过）。
 *   3. controller container —— 仅当房间无 controller link 时兜底（RCL4 有 storage 但
 *      link 未建成的窗口期）。有 controller link 时由 link 网络独占供能（零通勤），
 *      distributor 完全不碰，避免冗余回流。
 *
 * 同级取最近未预约者；预约集合与 hauler 共享（fillReservations，按 tick 惰性重置），
 * 避免 distributor 与 hauler 抢同一目标。所有目标都被预约时回退最近目标避免死锁。
 *
 * @param tier distributor 水位档位，控制允许填充的结构类型范围。
 */
function getDistributorFillTarget(creep, snapshot, tier = 0) {
    if (snapshot.fillTargets.length === 0)
        return undefined;
    const g = globalCache();
    if (!g.fillReservations || g.fillReservationTick !== Game.time) {
        g.fillReservations = new Set();
        g.fillReservationTick = Game.time;
    }
    const reserved = g.fillReservations;
    // tier 3: 仅填充 spawn（不含 extension），极端节水模式。
    const spawnTypes = tier === 3 ? [STRUCTURE_SPAWN] : [STRUCTURE_SPAWN, STRUCTURE_EXTENSION];
    // 1. spawn / extension（或仅 spawn）—— 生产引擎，最高优先。
    const primary = pickFillTarget(creep, snapshot.fillTargets, reserved, spawnTypes);
    if (primary) {
        reserved.add(primary.id);
        return primary;
    }
    // tier >= 1: 跳过 tower，保护低水位下的能量储备。
    if (tier < 1) {
        // 2. tower —— 防御。
        const tower = pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_TOWER]);
        if (tower) {
            reserved.add(tower.id);
            return tower;
        }
    }
    // 3. controller container 兜底 —— 仅当无 controller link 时（tier < 1 才允许）。
    if (tier < 1) {
        const hasControllerLink = snapshot.controller != null &&
            snapshot.links.some(l => l.pos.getRangeTo(snapshot.controller) <= 2);
        if (!hasControllerLink) {
            const cc = snapshot.controllerContainer;
            if (cc && !reserved.has(cc.id) && cc.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                reserved.add(cc.id);
                return cc;
            }
        }
    }
    // 全部已预约 — 回退最近目标（允许共享）避免死锁，但须符合 tier 类型约束。
    const fallbackPool = snapshot.fillTargets.filter(t => {
        if (tier === 3)
            return t.structureType === STRUCTURE_SPAWN;
        if (tier >= 1)
            return t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION;
        return true;
    });
    return (creep.pos.findClosestByRange(fallbackPool) ?? undefined);
}
/**
 * 在 spawn 安全区内、按 hauler 填充优先级选择最近的需能量结构。
 *
 * 供 flee 等特殊场景使用 — 与 getHaulFillTarget 共享优先级层级（haulerFillTiers），
 * 但不使用预约系统（flee 是临时行为，不应消耗正常 hauler 的预约配额），
 * 且增加空间约束（仅选择 spawnPos safeRange 范围内的结构）。
 *
 * 不包含 controller container 优先级 — flee 是生存行为，
 * controller container 供能是效率行为，不应在威胁期间占优先。
 */
function pickHaulFillTargetInRange(creep, snapshot, spawnPos, safeRange) {
    if (snapshot.fillTargets.length === 0)
        return undefined;
    const hasThreats = snapshot.threatCreeps.length > 0;
    for (const types of haulerFillTiers(hasThreats)) {
        let best;
        let bestDist = Infinity;
        for (const t of snapshot.fillTargets) {
            if (types.length > 0 && !types.includes(t.structureType))
                continue;
            if (t.pos.getRangeTo(spawnPos) > safeRange)
                continue;
            const d = creep.pos.getRangeTo(t.pos);
            if (d < bestDist) {
                bestDist = d;
                best = t;
            }
        }
        if (best)
            return best;
    }
    return undefined;
}
/** 找到能量最多的 container。 */
function findRichestContainer(containers) {
    let best;
    let bestEnergy = 0;
    for (const c of containers) {
        const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
        if (energy > bestEnergy) {
            bestEnergy = energy;
            best = c;
        }
    }
    return best;
}
/**
 * 找到距离 creep 最近且含有能量的 container。
 * 用于 builder 等需要在远处工地与能量源之间通勤的角色 — 选最近的能量源
 * 而非最满的，可显著缩短取能行走距离，提升建造 duty cycle。
 */
function findClosestContainerWithEnergy(creep, containers) {
    let best;
    let bestDist = Infinity;
    for (const c of containers) {
        if (c.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
            continue;
        const d = creep.pos.getRangeTo(c);
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    }
    return best;
}
/** 找到空闲容量最大的 container。 */
function findEmptiestContainer(containers) {
    let best;
    let bestFree = 0;
    for (const c of containers) {
        const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
        if (free > bestFree) {
            bestFree = free;
            best = c;
        }
    }
    return best;
}
/**
 * 选择下一个要拾取的掉落能量堆（考虑拾取范围与衰减）。
 *
 * 游戏机制：pickup 需相邻（range ≤ 1），每 tick 只能拾取一堆；掉落能量按
 * ceil(amount/1000)/tick 衰减，堆越大衰减越快。因此在“装满前持续拾取”时：
 *   - 若身边（range ≤ 1）有可拾取的堆，优先拾取能量最多的一堆
 *     （先拿大堆，减少剩余堆的衰减损耗）。
 *   - 否则走向最近的一堆去拾取。
 * “未装满则继续拾取”的跨 tick 循环由 FSM（updateMode：free>0 时保持 acquire）保证。
 */
function selectDroppedEnergy(creep, dropped) {
    if (dropped.length === 0)
        return undefined;
    // 优先拾取身边（range ≤ 1）能量最多的一堆。
    let richestAdjacent;
    for (const r of dropped) {
        if (creep.pos.getRangeTo(r) > 1)
            continue;
        if (!richestAdjacent || r.amount > richestAdjacent.amount) {
            richestAdjacent = r;
        }
    }
    if (richestAdjacent)
        return richestAdjacent;
    // 身边无可拾取 — 走向最近的一堆。
    return creep.pos.findClosestByRange([...dropped]) ?? undefined;
}
/**
 * 查找紧急维修目标：血量低于 50% 的 spawn/extension/tower/container。
 * 优先使用快照预计算的 criticalRepairTarget（零重复迭代）；
 * 快照未提供时回退到实时遍历（向后兼容）。
 */
function findCriticalRepair(snapshot) {
    if (snapshot.criticalRepairTarget !== undefined) {
        return snapshot.criticalRepairTarget;
    }
    // 回退路径：快照未预计算时实时遍历。
    const groups = [
        snapshot.spawns,
        snapshot.extensions,
        snapshot.towers,
        snapshot.containers,
    ];
    for (const group of groups) {
        for (const s of group) {
            if (s.hits < s.hitsMax * 0.5) {
                return s;
            }
        }
    }
    return undefined;
}

/**
 * 从 source 采集（通用）。
 *
 * resolve 检查 source.energy > 0：source 再生期间（energy === 0）不触发采集，
 * 避免 harvest → ERR_NOT_ENOUGH_RESOURCES → mode=idle 的无限振荡。
 * source 空时角色 fallthrough 到后续候选或 idle+park（离开矿位不堵路）。
 *
 * execute 中 ERR_NOT_ENOUGH_RESOURCES 不再设 idle：resolve 已过滤空 source，
 * 此处仅为跨 tick 竞态（resolve 通过后 source 被其他 creep 采空）。
 * 竞态是瞬时的，保持 acquire 模式下 tick 自动重试比切 idle 更快恢复。
 */
function harvestSource() {
    return {
        name: "harvest:source",
        resolve: (ac) => {
            const source = getSource(ac.creep, ac.snapshot);
            if (!source || source.energy === 0)
                return undefined;
            return source;
        },
        execute: (ac, source) => {
            runAction(ac.creep, source, () => ac.creep.harvest(source));
        },
    };
}
/**
 * 站桩采集并同 tick 倒能（定点 miner 专用）。
 *
 * 关键：Screeps 中 harvest 与 transfer 是两个独立 intent，可在同一 tick 执行。
 * 只要矿工站在 source container 之上（或与 source 及 sink 均 range<=1），
 * 每 tick 即可「采 + 倒」，1 CARRY 也能维持满吞吐 10/tick，
 * 消除「采满停一 tick 倒能」造成的 ~17% 产能损失。
 *
 * 触发条件：分配到的 source 旁（range<=1）存在 container 或 link 作为站桩点。
 * 无 sink（早期无 container）时 resolve=undefined，回退到通用 harvestSource。
 *
 * 该动作同时置于 harvester 的 acquire[0] 与 work[0]：
 *   - 无论 FSM 处于哪个 mode 都执行，绕开「单 tick 只跑一条链」的限制；
 *   - 作为 work[0] 拦截站桩矿工，使其永不落到 fill/build/upgrade 而离岗（P2-7）。
 */
function stationaryMine() {
    return {
        name: "harvest:stationary-mine",
        resolve: (ac) => {
            const source = getSource(ac.creep, ac.snapshot);
            if (!source)
                return undefined;
            const container = sourceAdjacentContainer(ac, source);
            const link = sourceAdjacentLink(ac, source);
            if (!container && !link)
                return undefined;
            return { source, container, link };
        },
        execute: (ac, target) => {
            const { source, container, link } = target;
            // 站位：优先站到 source container 之上（range 0 倒能，0 通勤）；否则站到 source 旁。
            const standTarget = container ?? source;
            // 站桩维护：站立的 source container 血量 < 80%（与 repairNearbyContainer 阈值一致）时先修再采。
            // harvest 与 repair 互斥（不能同 tick），故空手时先采一 tick 攒能量、本 tick 不倒，
            // 下一 tick 有能量即修，交替进行；防止 source container 坍塌断链（P0 物流 / P2-7 不离岗）。
            if (container
                && ac.creep.pos.getRangeTo(container) <= 1
                && container.hits < container.hitsMax * 0.8) {
                if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    ac.creep.repair(container);
                }
                else if (ac.creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    moveToTarget(ac.creep, standTarget);
                }
                return;
            }
            const harvestResult = ac.creep.harvest(source);
            if (harvestResult === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, standTarget);
                return;
            }
            // 同 tick 倒能：link 优先，其次 container（均需 range<=1 且有空位）。
            if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                const sink = link
                    && ac.creep.pos.getRangeTo(link) <= 1
                    && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                    ? link
                    : container
                        && ac.creep.pos.getRangeTo(container) <= 1
                        && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                        ? container
                        : undefined;
                if (sink) {
                    ac.creep.transfer(sink, RESOURCE_ENERGY);
                }
                else if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                    // 采集空间耗尽且身边 sink 均满 → 原地 drop 保持在位继续采（P2-7），
                    // 掉落能量由 hauler 的 pickupDroppedEnergy 回收，绝不离岗去 fill/build/upgrade。
                    ac.creep.drop(RESOURCE_ENERGY);
                }
            }
        },
    };
}
/** 找到与 source 相邻（range<=1）的 container（站桩倒能点）。 */
function sourceAdjacentContainer(ac, source) {
    return ac.snapshot.containers.find(c => c.pos.getRangeTo(source.pos) <= 1);
}
/** 找到与 source 相邻（range<=1）的 link（RCL5+ source link）。 */
function sourceAdjacentLink(ac, source) {
    return ac.snapshot.links.find(l => l.pos.getRangeTo(source.pos) <= 1);
}
/**
 * 从 mineral 采集（需要 extractor）。
 * 触发条件：房间有 extractor + mineral 有储量 + creep 有 carry 空间。
 * 用于 source 再生期间的空闲利用（RCL6+）。
 */
function harvestMineral() {
    return {
        name: "harvest:mineral",
        resolve: (ac) => {
            if (!ac.snapshot.extractor)
                return undefined;
            if (ac.snapshot.minerals.length === 0)
                return undefined;
            const mineral = ac.snapshot.minerals[0];
            if (mineral.mineralAmount <= 0 || ac.creep.store.getFreeCapacity() <= 0)
                return undefined;
            return { mineral };
        },
        execute: (ac, target) => {
            const { mineral } = target;
            runAction(ac.creep, mineral, () => ac.creep.harvest(mineral), {
                [ERR_NOT_ENOUGH_RESOURCES]: () => { ac.creep.memory.mode = "idle"; },
                [ERR_TIRED]: () => { ac.creep.memory.mode = "idle"; },
            });
        },
    };
}

/**
 * 拾取地上掉落的能量。
 *
 * 掉落能量来源：creep 死亡掉落、harvester 溢出、container 被摧毁残留等。
 * 掉落能量会随时间衰减（每 tick 减少 ceil(amount/1000)），因此应尽快拾取。
 * 目标选择由 selectDroppedEnergy 统一处理（优先身边最大堆，否则走向最近堆）。
 *
 * minAmount：只考虑不低于该数量的堆 — 用于「大堆优先于 container、
 * 零头链尾兜底」的双档链位（见 hauler 的 acquire 链）。默认 0 不过滤。
 *
 * "未装满则继续拾取"：本动作位于 acquire 候选链，而 updateMode 仅在 free===0 时才切
 * work。因此只要背包未满且快照中还有掉落能量，creep 会逐 tick 继续拾取不同的堆，
 * 直到装满才转入 work。
 */
function pickupDroppedEnergy(minAmount = 0) {
    return {
        name: "pickup:dropped-energy",
        resolve: (ac) => {
            const candidates = minAmount > 0
                ? ac.snapshot.droppedEnergy.filter(r => r.amount >= minAmount)
                : ac.snapshot.droppedEnergy;
            return selectDroppedEnergy(ac.creep, candidates);
        },
        execute: (ac, resource) => {
            runAction(ac.creep, resource, () => ac.creep.pickup(resource), {
                [ERR_FULL]: () => { ac.creep.memory.mode = "work"; },
            });
        },
    };
}
/**
 * 从坟墓/废墟提取遗留能量（withdraw，坟墓与掉落堆不同不能 pickup）。
 *
 * 目标选择与掉落能量同一原则：身边（range<=1）能量最多的优先
 * （减少剩余目标的衰减损耗），否则走向最近的一个。
 * minAmount 过滤零头 — 大额遗留（如全拆重建时 storage 库存进入的 ruin、
 * 满载 hauler 死亡的坟墓）值得专程；零头由链尾无阈值实例顺手清理。
 */
function lootRemains(minAmount = 0) {
    return {
        name: "loot:remains",
        resolve: (ac) => {
            const candidates = [];
            for (const t of ac.snapshot.tombstones) {
                if (t.store.getUsedCapacity(RESOURCE_ENERGY) >= Math.max(1, minAmount))
                    candidates.push(t);
            }
            for (const r of ac.snapshot.ruins) {
                if (r.store.getUsedCapacity(RESOURCE_ENERGY) >= Math.max(1, minAmount))
                    candidates.push(r);
            }
            if (candidates.length === 0)
                return undefined;
            // 身边能量最多的优先。
            let richestAdjacent;
            for (const c of candidates) {
                if (ac.creep.pos.getRangeTo(c) > 1)
                    continue;
                if (!richestAdjacent ||
                    c.store.getUsedCapacity(RESOURCE_ENERGY) > richestAdjacent.store.getUsedCapacity(RESOURCE_ENERGY)) {
                    richestAdjacent = c;
                }
            }
            if (richestAdjacent)
                return richestAdjacent;
            return ac.creep.pos.findClosestByRange(candidates) ?? candidates[0];
        },
        execute: (ac, remains) => {
            // 限量取：min(可用, 空闲)，避免 ERR_NOT_ENOUGH_RESOURCES 竞态置 idle。
            const available = remains.store.getUsedCapacity(RESOURCE_ENERGY);
            const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
            const amount = Math.min(available, carryFree);
            runAction(ac.creep, remains, () => ac.creep.withdraw(remains, RESOURCE_ENERGY, amount), {
                [ERR_FULL]: () => { ac.creep.memory.mode = "work"; },
            });
        },
    };
}
/**
 * 拾取身边的掉落能量（仅 range 内，不离开站桩位）。
 *
 * 专供 upgrader 等站桩角色使用：衰减资源应优先回收，但不能为了捡远处
 * 的掉落能量离开 controller 旁的站桩位。range 默认 2 — 覆盖站桩位
 * 周围一圈，足够捡起 harvester 溢出到 controller container 旁的能量。
 */
function pickupNearbyDroppedEnergy(range = 2) {
    return {
        name: "pickup:nearby-dropped-energy",
        resolve: (ac) => {
            const nearby = ac.snapshot.droppedEnergy.filter(r => ac.creep.pos.getRangeTo(r) <= range);
            return selectDroppedEnergy(ac.creep, nearby);
        },
        execute: (ac, resource) => {
            runAction(ac.creep, resource, () => ac.creep.pickup(resource), {
                [ERR_FULL]: () => { ac.creep.memory.mode = "work"; },
            });
        },
    };
}

/**
 * 判断 container 是否为物流关键 container（source container 或 controller container）。
 *
 * - source container：紧邻 source，是 hauler 的物流源。非采集角色直接取用会导致
 *   hauler 无事可做、物流链断裂。
 * - controller container：紧邻 controller，是 upgrader 的站桩能量源。builder 取用
 *   会导致 upgrader 断粮，站桩升级链路崩溃。
 *
 * builder 等非物流角色应从非物流 container（如 mineral container）取能。
 */
function isLogisticsContainer(c, ac) {
    // source container
    if (ac.snapshot.sources.some(s => c.pos.getRangeTo(s.pos) <= 1))
        return true;
    // controller container
    if (ac.snapshot.controllerContainer?.id === c.id)
        return true;
    return false;
}
/** 从最满的非物流 container 取能（upgrader 用，不抢 hauler/upgrader 的物流源）。 */
function withdrawRichestNonSourceContainer() {
    return {
        name: "withdraw:richest-non-source-container",
        resolve: (ac) => {
            const candidates = ac.snapshot.containers.filter(c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
            return findRichestContainer(candidates);
        },
        execute: (ac, best) => {
            runAction(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
        },
    };
}
/** 从最近的非物流 container 取能（builder 用，不抢 hauler/upgrader 的物流源）。 */
function withdrawClosestNonSourceContainer() {
    return {
        name: "withdraw:closest-non-source-container",
        resolve: (ac) => {
            const candidates = ac.snapshot.containers.filter(c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
            return findClosestContainerWithEnergy(ac.creep, candidates);
        },
        execute: (ac, best) => {
            runAction(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
        },
    };
}
/** 从 controller 旁 container 取能（站桩升级）。 */
function withdrawControllerContainer() {
    return {
        name: "withdraw:controller-container",
        resolve: (ac) => {
            const cc = ac.snapshot.controllerContainer;
            if (!cc || cc.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
                return undefined;
            return cc;
        },
        execute: (ac, cc) => {
            runAction(ac.creep, cc, () => ac.creep.withdraw(cc, RESOURCE_ENERGY));
        },
    };
}
/** 从 controller 旁 link 取能（link 站桩升级，0 通勤）。 */
function withdrawControllerLink() {
    return {
        name: "withdraw:controller-link",
        resolve: (ac) => {
            if (ac.snapshot.links.length === 0 || !ac.snapshot.controller)
                return undefined;
            return ac.snapshot.links.find(l => l.pos.getRangeTo(ac.snapshot.controller) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        },
        execute: (ac, ctrlLink) => {
            runAction(ac.creep, ctrlLink, () => ac.creep.withdraw(ctrlLink, RESOURCE_ENERGY));
        },
    };
}
/**
 * 从 storage 旁 link 取能 — link 物流链的「最后一公里」。
 *
 * Link 网络能量流：
 *   Harvester → Source Link →(link-system 瞬移)→ Storage Link →(本 action)→ Hauler → Storage
 *
 * 如果没有 creep 定期排空 storage link，link 网络会堵死：
 * storage link 满后 planLinkTransfers 的 storageFree=0，
 * source link 无法再向其传输，整条链路背压瘫痪。
 *
 * 优先级：link-system (P1) 在 creep 之前运行，会先将 storage link → controller link
 * 传输（如果 controller 缺能），hauler 排空的是剩余部分 — 不影响升级链供能。
 *
 * 限量取能：与 withdrawCapped 一致，取 min(可用, 空闲)，避免 ERR_NOT_ENOUGH_RESOURCES。
 */
function withdrawStorageLink() {
    return {
        name: "withdraw:storage-link",
        resolve: (ac) => {
            const st = ac.snapshot.storage;
            if (!st)
                return undefined;
            return ac.snapshot.links.find(l => l.pos.getRangeTo(st) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        },
        execute: (ac, link) => {
            const available = link.store.getUsedCapacity(RESOURCE_ENERGY);
            const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
            const amount = Math.min(available, carryFree);
            runAction(ac.creep, link, () => ac.creep.withdraw(link, RESOURCE_ENERGY, amount), {
                [ERR_NOT_ENOUGH_RESOURCES]: () => { ac.creep.memory.mode = "idle"; },
            });
        },
    };
}
/**
 * 从 storage 限量取能（upgrader 专用）。
 *
 * 防止 upgrader 一次取走大量能量导致 storage 突降、触发 economyPressure
 * 连锁降级。单次取 min(可用, 空闲, limit)。
 *
 * P1-1: limit 可为固定值或动态函数 — 动态函数允许按 storage 水位缩放取能上限。
 */
function withdrawStorageCapped(limit) {
    return {
        name: "withdraw:storage-capped",
        resolve: (ac) => {
            const st = ac.snapshot.storage;
            if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
                return undefined;
            const effectiveLimit = typeof limit === "function" ? limit(ac) : limit;
            return { storage: st, limit: effectiveLimit };
        },
        execute: (ac, target) => {
            const { storage, limit: effectiveLimit } = target;
            const available = storage.store.getUsedCapacity(RESOURCE_ENERGY);
            const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
            const amount = Math.min(available, carryFree, effectiveLimit);
            runAction(ac.creep, storage, () => ac.creep.withdraw(storage, RESOURCE_ENERGY, amount), {
                [ERR_NOT_ENOUGH_RESOURCES]: () => { ac.creep.memory.mode = "idle"; },
            });
        },
    };
}
/** 限量 withdraw（hauler 专用，避免 ERR_NOT_ENOUGH_RESOURCES）。 */
function withdrawCapped(target) {
    return {
        name: "withdraw:capped",
        resolve: (ac) => {
            const t = target(ac);
            if (!t || t.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
                return undefined;
            return t;
        },
        execute: (ac, t) => {
            const available = t.store.getUsedCapacity(RESOURCE_ENERGY);
            const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
            const amount = Math.min(available, carryFree);
            runAction(ac.creep, t, () => ac.creep.withdraw(t, RESOURCE_ENERGY, amount), {
                [ERR_NOT_ENOUGH_RESOURCES]: () => { ac.creep.memory.mode = "idle"; },
            });
        },
    };
}

/** 向身边 link 倒能（range <= 2）。 */
function dumpToNearbyLink() {
    return {
        name: "dump:nearby-link",
        resolve: (ac) => {
            const candidates = ac.snapshot.links.filter(l => ac.creep.pos.getRangeTo(l) <= 2 && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
            if (candidates.length === 0)
                return undefined;
            return ac.creep.pos.findClosestByRange(candidates) ?? undefined;
        },
        execute: (ac, link) => {
            runAction(ac.creep, link, () => ac.creep.transfer(link, RESOURCE_ENERGY));
        },
    };
}
/** 向身边 container 倒能（range <= 2，站桩 miner）。 */
function dumpToNearbyContainer() {
    return {
        name: "dump:nearby-container",
        resolve: (ac) => {
            const candidates = ac.snapshot.containers.filter(c => ac.creep.pos.getRangeTo(c) <= 2 && c.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
            if (candidates.length === 0)
                return undefined;
            return ac.creep.pos.findClosestByRange(candidates) ?? undefined;
        },
        execute: (ac, nearby) => {
            runAction(ac.creep, nearby, () => ac.creep.transfer(nearby, RESOURCE_ENERGY));
        },
    };
}
/**
 * 向身边 container 卸载矿物（range <= 2）。
 * 当 harvester 采集了 mineral（非 energy 资源）时，倒入最近 container。
 * 优先级高于 energy dump — 矿物不应占用 carry 空间。
 */
function dumpMineralsToNearbyContainer() {
    return {
        name: "dump:minerals-to-container",
        resolve: (ac) => {
            const mineral = Object.keys(ac.creep.store)
                .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r] > 0);
            if (!mineral)
                return undefined;
            const candidates = ac.snapshot.containers.filter(c => ac.creep.pos.getRangeTo(c) <= 2 && (c.store.getFreeCapacity() ?? 0) > 0);
            if (candidates.length === 0)
                return undefined;
            const container = ac.creep.pos.findClosestByRange(candidates) ?? undefined;
            if (!container)
                return undefined;
            return { container, mineral };
        },
        execute: (ac, target) => {
            runAction(ac.creep, target.container, () => ac.creep.transfer(target.container, target.mineral));
        },
    };
}
/** 建造身边 container site（range <= 3，经济自愈）。 */
function buildNearbyContainerSite() {
    return {
        name: "build:nearby-container-site",
        resolve: (ac) => {
            if (ac.snapshot.myConstructionSites.length === 0)
                return undefined;
            const site = ac.creep.pos.findClosestByRange(ac.snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER));
            if (!site || ac.creep.pos.getRangeTo(site) > 3)
                return undefined;
            return site;
        },
        execute: (ac, site) => {
            runAction(ac.creep, site, () => ac.creep.build(site));
        },
    };
}

/** 根据能量存储更新 creep 模式。仅在阈值跨越时写入。 */
function updateMode(creep) {
    const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    const mode = creep.memory.mode ?? "acquire";
    if (mode === "acquire" && free === 0) {
        creep.memory.mode = "work";
    }
    else if (mode === "work" && used === 0) {
        creep.memory.mode = "acquire";
    }
    else if (mode === "idle" || mode === "flee") {
        // idle/flee 恢复：有能量时转 work 去消耗，空载时转 acquire 去采集。
        // 修复：原实现缺少 idle 和 flee 分支导致 creep 一旦进入这些模式就永久卡死。
        // flee 场景：敌人离开后 shouldFlee 返回 false，但 mode 仍为 flee，需要恢复。
        creep.memory.mode = used > 0 ? "work" : "acquire";
    }
    else if (!creep.memory.mode) {
        creep.memory.mode = used > 0 ? "work" : "acquire";
    }
}
/**
 * 检查 creep 是否应逃跑（P1-1：距离分级）。
 * 仅当威胁 creep 在 fleeRange 范围内时才触发逃跑。
 * 远端过境的威胁（如 scout / reserver 穿越房间边缘）不会中断经济。
 */
function shouldFlee(creep, snapshot) {
    if (snapshot.threatCreeps.length === 0)
        return false;
    const range = CONFIG.defense.fleeRange;
    return snapshot.threatCreeps.some(t => creep.pos.getRangeTo(t.pos) <= range);
}
// ─── 远矿角色威胁检测 ──────────────────────────────────────
/**
 * 获取指定房间的 hostile creep 列表（per-tick per-room 缓存）。
 * 用于远矿角色在无 snapshot 的房间（远矿房 / 过境中间房）检测威胁。
 * 缓存生命周期：单 tick，globalCache 自动重置。
 */
function getRoomThreats(roomName) {
    const g = globalCache();
    if (!g.__remoteThreats)
        g.__remoteThreats = {};
    if (g.__remoteThreats[roomName]?.tick === Game.time) {
        return g.__remoteThreats[roomName].creeps;
    }
    const room = Game.rooms[roomName];
    if (!room)
        return [];
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
        filter: (c) => {
            // 联盟白名单过滤。
            const allies = CONFIG.defense.allies;
            return !allies.includes(c.owner.username);
        },
    });
    // 过滤出真正有威胁的 creep（有攻击部件）。
    const threats = hostiles.filter(c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK ||
        p.type === HEAL || p.type === WORK || p.type === CLAIM));
    g.__remoteThreats[roomName] = { tick: Game.time, creeps: threats };
    return threats;
}
/**
 * 远矿角色威胁检测 — 在任意「非 home 房」检查当前房间的敌人。
 *
 * 覆盖范围（修复 transit 盲区）：
 *   - 在 remoteTarget 房间作业时
 *   - 在 home ↔ remoteTarget 之间的过境中间房通勤时
 * 旧实现仅在 creep.room.name === remoteTarget 时检测，导致过境中间房遇袭不逃跑。
 *
 * 仅对设置了 remoteTarget 的远矿角色生效；本地角色由 shouldFlee（home snapshot）处理。
 * 与 shouldFlee 的区别：直接从 Game.rooms 扫描当前房（远矿房/中间房均无 snapshot）。
 */
function shouldFleeForeignRoom(creep) {
    if (!creep.memory.remoteTarget)
        return false;
    const home = creep.memory.home;
    // 在 home 房时由 shouldFlee（home snapshot）处理，此处只负责外部房间。
    if (home && creep.room.name === home)
        return false;
    const threats = getRoomThreats(creep.room.name);
    if (threats.length === 0)
        return false;
    const range = CONFIG.defense.fleeRange;
    return threats.some(t => creep.pos.getRangeTo(t.pos) <= range);
}
/**
 * 远矿角色逃跑 — 向 home 方向移动（无 snapshot 可用，简化路径）。
 * 释放 assignment（如有），然后直接 moveTowardRoom 到 home。
 * 不使用 flee() 中的 spawn/exit 逻辑 — 远矿房/中间房无 snapshot，
 * 且最快逃生路径是回到 home 房的塔防范围。
 */
function fleeToHome(creep) {
    if (creep.memory.assignment) {
        releaseFromTask(creep);
        creep.memory.assignment = undefined;
    }
    const home = creep.memory.home;
    if (home && creep.room.name !== home) {
        moveTowardRoom(creep, home);
    }
}
/**
 * 逃跑到安全位置 — 遵循约束 G-DF-02/03/09。
 * 策略分三级：
 *   1) spawn 比最近敌人更近时走向 spawn（塔防范围内）
 *   2) spawn 不可达时，走向敌人反向出口（避免冲向敌人）
 *   3) 无安全出口时走向任意最远出口
 * flee 期间释放普通 assignment（G-SM-05），仅移动不执行经济动作。
 *
 * P0-2 修复：haul 的"防御圈内安全充能"逻辑已从此函数移除，
 * 改由 RolePolicy.onFlee 钩子在角色层实现。
 * flee() 现在只负责通用移动逻辑，不感知任何具体角色。
 */
function flee(creep, snapshot) {
    // G-SM-05: flee 期间释放普通 assignment，仅移动到安全位置。
    if (creep.memory.assignment) {
        releaseFromTask(creep);
        creep.memory.assignment = undefined;
    }
    const nearestHostile = creep.pos.findClosestByRange(snapshot.threatCreeps) ?? undefined;
    // 策略 1：spawn 比最近敌人更近时走向 spawn（spawn 在安全侧、塔防范围内）。
    if (snapshot.spawns.length > 0 && nearestHostile) {
        const spawn = snapshot.spawns[0];
        const creepToSpawn = creep.pos.getRangeTo(spawn);
        const hostileToSpawn = nearestHostile.pos.getRangeTo(spawn);
        if (creepToSpawn < hostileToSpawn) {
            if (creepToSpawn > 3) {
                // G-DF-04: flee 期间使用 ignoreCreeps: false 以绕过阻挡。
                const result = creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
                if (result === OK || result === ERR_TIRED)
                    recordTraffic(creep);
            }
            return;
        }
    }
    // 策略 2/3：spawn 不安全或不可达 — 走向敌人反向出口。
    if (nearestHostile) {
        const safeExit = findSafestExit(creep, nearestHostile.pos);
        if (safeExit) {
            const result = creep.moveTo(safeExit, { reusePath: 5, ignoreCreeps: false });
            if (result === OK || result === ERR_TIRED)
                recordTraffic(creep);
            return;
        }
    }
    // G-DF-03：已在 home 但 spawn 不安全且无安全出口时 —
    // 优先走向敌人反向出口（上面已尝试）；无出口时至少向 spawn 移动（比站着好）。
    const home = creep.memory.home;
    if (home && creep.room.name !== home) {
        moveTowardRoom(creep, home);
        return;
    }
    if (snapshot.spawns.length > 0) {
        const spawn = snapshot.spawns[0];
        if (spawn && creep.pos.getRangeTo(spawn) > 3) {
            const result = creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
            if (result === OK || result === ERR_TIRED)
                recordTraffic(creep);
        }
    }
}

/**
 * 向 fillTarget 送能（通用，使用 getFillTarget）。
 *
 * 目标持久化：优先复用上一 tick 选定的 fillTarget（creep.memory.fillTargetId），
 * 仅在目标满/消失时重新选择。消除多个等距目标间的摇摆。
 */
function fillTarget() {
    return {
        name: "fill:target",
        resolve: (ac) => {
            // 优先复用持久化目标 — 验证它仍需填充。
            if (ac.creep.memory.fillTargetId) {
                const cached = getObjectById(ac.creep.memory.fillTargetId);
                if (cached && "store" in cached && cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    return cached;
                }
            }
            // 无有效缓存目标 — 重新选择。
            const target = getFillTarget(ac.creep, ac.snapshot);
            if (target) {
                ac.creep.memory.fillTargetId = target.id;
            }
            return target;
        },
        execute: (ac, t) => {
            runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
                [ERR_FULL]: () => {
                    ac.creep.memory.fillTargetId = undefined;
                    updateMode(ac.creep);
                },
            });
        },
    };
}
/** Hauler 专用填充（带 reservation 去重 + 优先级）。 */
function haulFillTarget() {
    return {
        name: "fill:haul-target",
        // 纯检查：fillTargets 已包含所有需填充的 spawn/extension/tower/controller container
        // （room-snapshot.ts 按是否有空闲容量过滤）。
        // 严禁添加 `|| controllerContainer !== undefined` — controllerContainer 存在不等于需要填充。
        // 该条件会导致 predicate 返回 true 而 execute 内 getHaulFillTarget 返回 undefined，
        // FSM 在此 return 不再 fallthrough，hauler 永远无法到达 fillStorage() — storage 空置死锁。
        resolve: (ac) => {
            if (ac.snapshot.fillTargets.length === 0)
                return undefined;
            return getHaulFillTarget(ac.creep, ac.snapshot);
        },
        execute: (ac, t) => {
            runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
                [ERR_FULL]: () => updateMode(ac.creep),
            });
        },
    };
}
/**
 * Distributor 专用填充目标 — 用 getDistributorFillTarget（spawn/extension 绝对优先）。
 *
 * 与 haulFillTarget 的区别：distributor 的职责是 storage → 生产 sink，spawn/extension
 * 断能即停产，优先级高于 tower 与 controller container；controller container 仅在无
 * controller link 时兜底（link 网络在场时独占升级供能）。详见 getDistributorFillTarget。
 */
function distributorFillTarget() {
    return {
        name: "fill:distributor-target",
        resolve: (ac) => {
            if (ac.snapshot.fillTargets.length === 0)
                return undefined;
            // 读取 distributor gate 每 tick 计算的水位档位，用于过滤目标类型。
            const tier = ac.creep.memory.distributorTier ?? 0;
            return getDistributorFillTarget(ac.creep, ac.snapshot, tier);
        },
        execute: (ac, t) => {
            runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
                [ERR_FULL]: () => updateMode(ac.creep),
            });
        },
    };
}
/** 向最空 container 倒能。 */
function fillEmptiestContainer() {
    return {
        name: "fill:emptiest-container",
        resolve: (ac) => {
            if (ac.snapshot.containers.length === 0)
                return undefined;
            const best = findEmptiestContainer(ac.snapshot.containers);
            if (!best || best.store.getFreeCapacity(RESOURCE_ENERGY) <= 0)
                return undefined;
            return best;
        },
        execute: (ac, best) => {
            runAction(ac.creep, best, () => ac.creep.transfer(best, RESOURCE_ENERGY));
        },
    };
}
/** 向 storage 送能。
 *
 * RCL4+ 有 storage 时，这是 hauler 的首选 sink（优先于 haulFillTarget）。
 * 设计意图：hauler 负责 container → storage（收集），distributor 负责 storage → spawn/extension（分发）。
 * storage 空闲时优先填充，建立中央能量储备；storage 满后 fallthrough 到 haulFillTarget。
 */
function fillStorage() {
    return {
        name: "fill:storage",
        resolve: (ac) => {
            if (!ac.snapshot.storage)
                return undefined;
            // storage 有空闲容量时才送 — 满了则 fallthrough 到 haulFillTarget
            if (ac.snapshot.storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0)
                return undefined;
            return ac.snapshot.storage;
        },
        execute: (ac, st) => {
            runAction(ac.creep, st, () => ac.creep.transfer(st, RESOURCE_ENERGY));
        },
    };
}

/** 建造 assignment 指定的 site（可选 tier 门禁）。 */
function buildAssignmentSite(options) {
    return {
        name: "build:assignment-site",
        resolve: (ac) => {
            if (ac.budget.tier === "recovery")
                return undefined;
            if (!ac.assignment?.targetId)
                return undefined;
            const site = getObjectById(ac.assignment.targetId);
            if (!site)
                return undefined;
            if (options?.conserveCriticalOnly && ac.budget.tier === "conserve") {
                if (site.structureType !== STRUCTURE_SPAWN
                    && site.structureType !== STRUCTURE_TOWER
                    && site.structureType !== STRUCTURE_STORAGE)
                    return undefined;
            }
            return site;
        },
        execute: (ac, site) => {
            runAction(ac.creep, site, () => ac.creep.build(site), {
                [ERR_INVALID_TARGET]: () => releaseAssignment(ac.creep),
            });
        },
    };
}
/**
 * 建造最近 site（可选 critical-only 过滤 + tier 门禁）。
 *
 * 目标持久化：复用 creep.memory.targetId 缓存的 site，
 * 仅在目标消失或不再满足 criticalOnly 过滤时重新选择。
 * 这消除了 builder 在两个等距工地间每 tick 切换的"摇摆"行为。
 *
 * criticalOnly 可为 boolean 或函数 — 函数允许按 tier 动态切换过滤策略。
 */
function buildNearestSite(criticalOnly = false, options) {
    return {
        name: "build:nearest-site",
        resolve: (ac) => {
            if (ac.budget.tier === "recovery")
                return undefined;
            const isCriticalOnly = typeof criticalOnly === "function" ? criticalOnly(ac) : criticalOnly;
            const sites = isCriticalOnly
                ? ac.snapshot.myConstructionSites.filter(isCriticalSite)
                : ac.snapshot.myConstructionSites;
            if (sites.length === 0)
                return undefined;
            // 优先复用持久化目标 — 验证它仍在当前候选列表中。
            if (ac.creep.memory.targetId) {
                const cached = getObjectById(ac.creep.memory.targetId);
                if (cached && sites.some(s => s.id === cached.id)) {
                    return cached;
                }
            }
            // 无有效缓存目标 — 重新选择最近的。
            const site = ac.creep.pos.findClosestByRange(sites);
            if (site) {
                ac.creep.memory.targetId = site.id;
                return site;
            }
            return undefined;
        },
        execute: (ac, site) => {
            runAction(ac.creep, site, () => ac.creep.build(site), {
                [ERR_INVALID_TARGET]: () => { ac.creep.memory.targetId = undefined; },
            });
        },
    };
}
function isCriticalSite(site) {
    return site.structureType === STRUCTURE_SPAWN
        || site.structureType === STRUCTURE_TOWER
        || site.structureType === STRUCTURE_STORAGE;
}

/** 打包坐标为单数字 key（与 defense-planner 的 minCut 存储口径一致）。 */
function packFortXY(x, y) {
    return x * 50 + y;
}
/**
 * 从快照 + min-cut 持久化数据构建分类上下文。
 * 每次维修决策构建一次（O(结构数)，~100 项），无需跨 tick 缓存。
 *
 * @param minCutPositions Memory 中的扁平坐标数组 [x0,y0,x1,y1,...]，无数据传 undefined
 */
function buildFortificationContext(snapshot, minCutPositions) {
    const minCutSet = new Set();
    if (minCutPositions) {
        for (let i = 0; i + 1 < minCutPositions.length; i += 2) {
            minCutSet.add(packFortXY(minCutPositions[i], minCutPositions[i + 1]));
        }
    }
    const coreSet = new Set();
    for (const s of snapshot.spawns)
        coreSet.add(packFortXY(s.pos.x, s.pos.y));
    for (const s of snapshot.extensions)
        coreSet.add(packFortXY(s.pos.x, s.pos.y));
    for (const s of snapshot.towers)
        coreSet.add(packFortXY(s.pos.x, s.pos.y));
    for (const s of snapshot.links)
        coreSet.add(packFortXY(s.pos.x, s.pos.y));
    if (snapshot.storage)
        coreSet.add(packFortXY(snapshot.storage.pos.x, snapshot.storage.pos.y));
    const utilitySet = new Set();
    for (const c of snapshot.containers)
        utilitySet.add(packFortXY(c.pos.x, c.pos.y));
    return { minCutSet, coreSet, utilitySet };
}
/**
 * 分类单个防御工事。
 *
 * @param isWall constructedWall 恒为 perimeter（不衰减的一次性路径封锁投资）
 */
function classifyFortification(x, y, isWall, ctx) {
    if (isWall)
        return "perimeter";
    const packed = packFortXY(x, y);
    if (ctx.minCutSet.has(packed))
        return "perimeter";
    if (ctx.coreSet.has(packed))
        return "core";
    if (ctx.utilitySet.has(packed))
        return "utility";
    // 未知位置：有 min-cut 情报时，割集外的散盾无防线价值 → utility；
    // 无情报（扇区防御房）时保守按周界 → 出口封锁 rampart 不降档。
    return ctx.minCutSet.size > 0 ? "utility" : "perimeter";
}

/**
 * Repair actions — 维修结构。
 *
 * 四层优先级：
 *   1. repairCritical — 血量 < 50% 的关键结构（spawn/tower）
 *   2. repairContainerDecay — container 血量 < 80%（物流链保护）
 *   3. repairNearbyContainer — 身边 container（站桩矿工自维护）
 *   4. repairRoads — 道路血量 < 40%（交通效率保护）
 *   5. repairFortifications — wall/rampart 到 RCL 分级目标血量（rampart 优先于 wall）
 *
 * 目标持久化：repairContainerDecay / repairRoads / repairFortifications 复用 creep.memory.repairTargetId。
 * 共享缓存安全：每个 action 验证缓存目标的 structureType，防止跨类型缓存泄漏。
 */
/** 道路维修阈值 — 血量低于此比例才修（与 builder 维修需求信号共用 CONFIG 口径）。 */
const ROAD_REPAIR_THRESHOLD = CONFIG.construction.roadRepairThreshold;
/** 修复 critical 结构（血量 < 50%）。findCriticalRepair 优先使用快照预计算值。 */
function repairCritical() {
    return {
        name: "repair:critical",
        resolve: (ac) => findCriticalRepair(ac.snapshot),
        execute: (ac, t) => {
            runAction(ac.creep, t, () => ac.creep.repair(t));
        },
    };
}
/**
 * 修复衰减中的 container（血量 < 80%）。
 * Container 每 tick 衰减 ~5000 hits，不修就会在 ~50 tick 内从 80% 降到 0 被摧毁。
 * 失去 source container = 物流链断裂 = 经济崩溃，因此阈值设得比 repairCritical (50%) 更激进。
 *
 * 目标持久化：优先复用上一 tick 选定的 container（creep.memory.repairTargetId），
 * 仅在目标修好/消失时重新选择。消除多个衰减 container 间的摇摆。
 */
function repairContainerDecay() {
    return {
        name: "repair:container-decay",
        resolve: (ac) => {
            // 优先复用持久化目标 — 验证类型 + 仍需修复。
            // P1 修复：原先不检查 structureType，当 repairRoads/repairFortifications 设置的
            // repairTargetId 指向 road/wall 时，getObjectById 返回非 container 对象，
            // 但 hits < hitsMax*0.8 的比例检查仍可能命中（道路 hitsMax 5000，80% = 4000），
            // 导致道路被当作 container 修复，真正衰减的 container 被饿死。
            if (ac.creep.memory.repairTargetId) {
                const cached = getObjectById(ac.creep.memory.repairTargetId);
                if (cached && cached.structureType === STRUCTURE_CONTAINER && cached.hits < cached.hitsMax * 0.8) {
                    return cached;
                }
            }
            // 无有效缓存目标 — 修血量最低的 container。
            let worst;
            let worstRatio = 1;
            for (const c of ac.snapshot.containers) {
                const ratio = c.hits / c.hitsMax;
                if (ratio < 0.8 && ratio < worstRatio) {
                    worstRatio = ratio;
                    worst = c;
                }
            }
            if (worst) {
                ac.creep.memory.repairTargetId = worst.id;
            }
            return worst;
        },
        execute: (ac, worst) => {
            runAction(ac.creep, worst, () => ac.creep.repair(worst), {
                [ERR_INVALID_TARGET]: () => { ac.creep.memory.repairTargetId = undefined; },
            });
        },
    };
}
/**
 * 修复身边的 container（range <= 2，血量 < 80%）。
 * Harvester 站桩专用：你正站在 container 旁边，它快塌了，先修再倒。
 * 比 repairContainerDecay 更紧急 — 只修身边的，不需要跑远路。
 */
function repairNearbyContainer() {
    return {
        name: "repair:nearby-container",
        resolve: (ac) => {
            const candidates = ac.snapshot.containers.filter(c => ac.creep.pos.getRangeTo(c) <= 2 && c.hits < c.hitsMax * 0.8);
            if (candidates.length === 0)
                return undefined;
            return ac.creep.pos.findClosestByRange(candidates) ?? undefined;
        },
        execute: (ac, nearby) => {
            runAction(ac.creep, nearby, () => ac.creep.repair(nearby));
        },
    };
}
/**
 * 修复 wall/rampart 到分层目标血量（B3：维修权从塔移交给 creep）。
 *
 * 老玩家认知：塔修墙是能量黑洞（10 能量/次 + 距离衰减 + 与开火争弹药），
 * creep 维修是 1 energy/100 hits/WORK —— 日常工事维护必须由 builder 承担。
 *
 * 分层目标（消除统一目标的维护经济黑洞）：
 *   perimeter（min-cut 割集 / wall / 扇区封锁）→ RCL 全额；
 *   core（结构叠盾）→ 全额 × coreRampartFactor；
 *   utility（container 叠盾）→ 仅新生急救地板。
 *
 * 门禁（全部满足才启用，resolve 内判断）：
 *   - tier 非 recovery/conserve（低 CPU 不修墙）；
 *   - 无威胁 creep（入侵期间修墙是白送能量，优先开火/保命）；
 *   - 盈余门槛按姿态分档：和平期需 storage ≥ sprintStorage（50k）— 墙是死资本，
 *     RCL 是复利，储备不足时能量优先灌 controller（10k-50k 区间由
 *     repairFreshRampart 维持地板）；受袭姿态放宽到 sustainedStorage（10k）—
 *     有真实威胁时墙体优先级高于发展。
 *   - 无 storage（RCL3-4）时放宽门禁 — 靠 work chain 优先级保证不抢生存行为。
 */
function repairFortifications() {
    return {
        name: "repair:fortifications",
        resolve: (ac) => {
            if (ac.budget.tier === "recovery" || ac.budget.tier === "conserve")
                return undefined;
            if (ac.snapshot.threatCreeps.length > 0)
                return undefined;
            // 受袭姿态：近期有敌对活动 → 墙体目标升档 + 盈余门槛放宽。
            const roomMemory = Memory.rooms[ac.snapshot.roomName];
            const lastHostileAt = roomMemory?.lastHostileAt;
            const underSiege = lastHostileAt !== undefined &&
                Game.time - lastHostileAt < CONFIG.defense.siegeMemoryTicks;
            const storage = ac.snapshot.storage;
            if (storage) {
                // 和平期全额灌墙要求真盈余（sprintStorage）；受袭期放宽（sustainedStorage）。
                const surplusGate = underSiege
                    ? CONFIG.economy.upgrade.sustainedStorage
                    : CONFIG.economy.upgrade.sprintStorage;
                if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < surplusGate) {
                    return undefined;
                }
            }
            // 无 storage（RCL1-4）— 放宽门禁，靠 work chain 优先级保证不抢生存行为。
            // 分层分类上下文：min-cut 割集来自 Memory 持久化数据。
            const fortCtx = buildFortificationContext(ac.snapshot, roomMemory?.minCut?.positions);
            const targetOf = (f) => getWallTargetHits(ac.snapshot.rcl, underSiege, classifyFortification(f.pos.x, f.pos.y, f.structureType === STRUCTURE_WALL, fortCtx));
            // 优先复用持久化目标 — 验证它仍是墙/城防且仍低于自身档位目标。
            if (ac.creep.memory.repairTargetId) {
                const cached = getObjectById(ac.creep.memory.repairTargetId);
                if (cached) {
                    if ((cached.structureType === STRUCTURE_WALL || cached.structureType === STRUCTURE_RAMPART)
                        && cached.hits < targetOf(cached)) {
                        return cached;
                    }
                }
            }
            // 无有效缓存目标 — 重新扫描最低血量的墙/城防。
            const target = findFortificationTarget(ac.snapshot, targetOf);
            if (target) {
                ac.creep.memory.repairTargetId = target.id;
            }
            return target;
        },
        execute: (ac, t) => {
            runAction(ac.creep, t, () => ac.creep.repair(t), {
                [ERR_INVALID_TARGET]: () => { ac.creep.memory.repairTargetId = undefined; },
            });
        },
    };
}
/**
 * 查找血量最低且低于自身档位目标血量的 wall/rampart。
 *
 * P2 修复：rampart 优先于 wall — rampart 被摧毁会暴露同格所有结构（spawn/tower/extension），
 * wall 被摧毁只产生缺口。先扫 rampart，只有当所有 rampart 都达标时才修 wall。
 */
function findFortificationTarget(snapshot, targetOf) {
    // 先扫 rampart — 被摧毁后果更严重（同格结构全裸）。
    let best;
    let bestHits = Infinity;
    for (const rampart of snapshot.ramparts) {
        if (rampart.hits < targetOf(rampart) && rampart.hits < bestHits) {
            bestHits = rampart.hits;
            best = rampart;
        }
    }
    // 所有 rampart 都达标后才扫 wall。
    if (!best) {
        for (const wall of snapshot.walls) {
            if (wall.hits < targetOf(wall) && wall.hits < bestHits) {
                bestHits = wall.hits;
                best = wall;
            }
        }
    }
    return best;
}
/**
 * 新生 rampart 急救 — 血量低于 rampartBootstrapHits 的 rampart 无条件优先灌血。
 *
 * rampart 建成时仅 1 hit，每 100 tick 衰减 300 hits [事实：官方常量
 * RAMPART_DECAY_AMOUNT/RAMPART_DECAY_TIME]，不灌血必死于首个衰减周期。
 * 塌毁 → 规划器重新入队 site → builder 重建 → 又 1 hit，
 * builder 被永久锁死在「建了就塌、塌了再建」循环，防线永远立不起来。
 *
 * 与 repairFortifications 的区别：
 *   - 无盈余/tier/威胁门禁 — 急救的是刚投入建造的资产，属止损而非发展性投资；
 *     威胁期间尤其要灌（rampart 正是防御工事，塌了同格结构全裸）。
 *   - 必须排在 build 动作之前 — 灌 10k 血只需十几 tick，建一个 site 要上百 tick，
 *     顺序反了新 rampart 必死在建造队列后面。
 *   - 目标持久化独立于 repairTargetId 链（避免与 fortifications 的缓存互踩），
 *     每 tick 直接扫 snapshot.ramparts — 数组已在快照预建，低于急救线的通常 0-2 个。
 */
function repairFreshRampart() {
    return {
        name: "repair:fresh-rampart",
        resolve: (ac) => {
            const threshold = CONFIG.defense.rampartBootstrapHits;
            let worst;
            let worstHits = threshold;
            for (const rampart of ac.snapshot.ramparts) {
                if (rampart.hits < worstHits) {
                    worstHits = rampart.hits;
                    worst = rampart;
                }
            }
            return worst;
        },
        execute: (ac, t) => {
            runAction(ac.creep, t, () => ac.creep.repair(t));
        },
    };
}
/**
 * 修复衰减中的道路（血量 < 40%）。
 *
 * 道路衰减率（按地形，[Facts] docs.screeps.com/api/StructureRoad.html）：
 *   - plain:  100 hits / 1000 ticks（hitsMax 5,000）
 *   - swamp:  500 hits / 1000 ticks（hitsMax 25,000）
 *   - wall:  15,000 hits / 1000 ticks（hitsMax 750,000）
 * 每个 creep 踩一步，衰减计时器额外减少 1 tick × body part 数量 —
 * 高流量道路衰减远快于低流量道路。
 *
 * 阈值 40% 在任何地形下给约 20,000 tick 的修复窗口，足够 builder 响应。
 * 道路塌毁不致命，但需在塌毁前修复以保持物流效率（swamp 无路 = 5x 移动成本）。
 *
 * 门禁：与 repairFortifications 一致 — recovery/conserve tier + 威胁期间不修路。
 * recovery 时升级控制器保级比修路重要；入侵期间修路是白送能量。
 *
 * 目标持久化：复用 creep.memory.repairTargetId（与 fortifications 共享）。
 */
function repairRoads() {
    return {
        name: "repair:roads",
        resolve: (ac) => {
            // P2 修复：加 tier/threat 门禁，与 repairFortifications 对齐。
            if (ac.budget.tier === "recovery" || ac.budget.tier === "conserve")
                return undefined;
            if (ac.snapshot.threatCreeps.length > 0)
                return undefined;
            // 优先复用持久化目标 — 验证它仍是道路且仍需修复。
            if (ac.creep.memory.repairTargetId) {
                const cached = getObjectById(ac.creep.memory.repairTargetId);
                if (cached && cached.structureType === STRUCTURE_ROAD) {
                    if (cached.hits < cached.hitsMax * ROAD_REPAIR_THRESHOLD) {
                        return cached;
                    }
                }
            }
            // 无有效缓存目标 — 修血量最低的道路。
            let worst;
            let worstRatio = ROAD_REPAIR_THRESHOLD;
            for (const r of ac.snapshot.roads) {
                const ratio = r.hits / r.hitsMax;
                if (ratio < worstRatio) {
                    worstRatio = ratio;
                    worst = r;
                }
            }
            if (worst) {
                ac.creep.memory.repairTargetId = worst.id;
            }
            return worst;
        },
        execute: (ac, worst) => {
            runAction(ac.creep, worst, () => ac.creep.repair(worst), {
                [ERR_INVALID_TARGET]: () => { ac.creep.memory.repairTargetId = undefined; },
            });
        },
    };
}

/**
 * Upgrade actions — 升级控制器。
 *
 * 两个变体：
 *   - upgradeController: 无能量门禁（角色自行决定是否升级）
 *   - upgradeControllerGated: 带 energyAvailable >= floor 门禁（防止与孵化竞争）
 */
/** 升级控制器（无能量门禁）。 */
function upgradeController() {
    return {
        name: "upgrade:controller",
        resolve: (ac) => {
            const ctrl = ac.snapshot.controller;
            if (!ctrl || !ctrl.my)
                return undefined;
            return ctrl;
        },
        execute: (ac, ctrl) => {
            runAction(ac.creep, ctrl, () => ac.creep.upgradeController(ctrl));
        },
    };
}

/**
 * 从 extractor 旁 container 搬运矿物到 storage/terminal。
 * 触发条件：container 中有非 energy 资源。
 */
function haulMineralsToStorage() {
    return {
        name: "haul:minerals-to-storage",
        resolve: (ac) => {
            if (!ac.snapshot.storage && !ac.snapshot.terminal)
                return undefined;
            // 如果 creep 正在 carrying 非 energy 资源，送到 storage/terminal
            const carriedMineral = Object.keys(ac.creep.store)
                .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r] > 0);
            if (carriedMineral) {
                const dest = ac.snapshot.terminal ?? ac.snapshot.storage;
                if (dest)
                    return { dest, mineral: carriedMineral, phase: "deposit" };
                return undefined;
            }
            // 找含矿物的 container
            const source = ac.snapshot.containers.find(c => {
                for (const res of Object.keys(c.store)) {
                    if (res !== RESOURCE_ENERGY && c.store[res] > 0)
                        return true;
                }
                return false;
            });
            if (!source)
                return undefined;
            const mineral = Object.keys(source.store)
                .find(r => r !== RESOURCE_ENERGY && source.store[r] > 0);
            if (!mineral)
                return undefined;
            return { source, mineral, phase: "withdraw" };
        },
        execute: (ac, t) => {
            if (t.phase === "deposit") {
                runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.mineral));
            }
            else {
                runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.mineral));
            }
        },
    };
}
/** storage 能量低于此值时不为 lab 抽能 — boost 能量不与 spawn/tower 补给抢血。 */
const LAB_ENERGY_STORAGE_FLOOR = 1000;
/**
 * 按 lab-system 发布的需求表搬运（storage/terminal ↔ lab）。
 *
 * 需求表（globalCache.labDemands）是化合物-lab 绑定的唯一真相源：
 * lab 角色分配（input1/input2/output/boost）只有 lab-system 知道，
 * 搬运端绝不自行猜测「哪个 lab 该装什么」——盲搬会让错矿占位、反应死锁。
 *
 * 四相：
 *   deposit  — 携带的资源正是某 lab 的装料需求 → 送入该 lab
 *   dump     — 携带化合物但无 lab 需要 → 倒回 storage 解堵
 *   unload   — 空载且有卸料需求（错矿清位/产物回收）→ 从 lab 取出
 *   withdraw — 空载且有装料需求 → 从 storage（优先）/terminal（市场买入回退）取料
 *
 * 注意容量判断必须带资源参数：lab 是受限 store，
 * 无参 getFreeCapacity() 返回 null——正是旧实现全链断路的根因。
 */
function supplyLabs() {
    return {
        name: "haul:supply-labs",
        resolve: (ac) => {
            if (ac.snapshot.labs.length === 0)
                return undefined;
            const storage = ac.snapshot.storage;
            if (!storage)
                return undefined;
            const demands = globalCache().labDemands;
            const table = demands?.tick === Game.time ? demands.byRoom[ac.snapshot.roomName] : undefined;
            if (!table)
                return undefined;
            const store = ac.creep.store;
            const carriedCompound = Object.keys(store)
                .find(r => r !== RESOURCE_ENERGY && store[r] > 0);
            // 1. 携带化合物：送到需要它的 lab；无需求方则倒回 storage 解堵。
            if (carriedCompound) {
                for (const load of table.loads) {
                    if (load.resource !== carriedCompound)
                        continue;
                    const lab = getObjectById(load.labId);
                    if (lab && (lab.store.getFreeCapacity(carriedCompound) ?? 0) > 0) {
                        return { dest: lab, resource: carriedCompound, phase: "deposit" };
                    }
                }
                return { dest: storage, resource: carriedCompound, phase: "dump" };
            }
            // 2. 携带能量且 lab 有能量缺口：直接投喂（boostCreep 每部件消耗 20 能量）。
            if (store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                for (const load of table.loads) {
                    if (load.resource !== RESOURCE_ENERGY)
                        continue;
                    const lab = getObjectById(load.labId);
                    if (lab && (lab.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0) > 0) {
                        return { dest: lab, resource: RESOURCE_ENERGY, phase: "deposit" };
                    }
                }
                return undefined;
            }
            // 3. 空载：先清（错矿/产物回收）再装 — 清位不完成，装料就会 ERR_FULL 空转。
            for (const unload of table.unloads) {
                const lab = getObjectById(unload.labId);
                const resource = unload.resource;
                if (lab && (lab.store[resource] ?? 0) > 0) {
                    return { source: lab, resource, phase: "unload" };
                }
            }
            const terminal = ac.snapshot.terminal;
            for (const load of table.loads) {
                const resource = load.resource;
                if (resource === RESOURCE_ENERGY) {
                    if (storage.store.getUsedCapacity(RESOURCE_ENERGY) > LAB_ENERGY_STORAGE_FLOOR) {
                        return { source: storage, resource, amount: load.amount, phase: "withdraw" };
                    }
                    continue;
                }
                // 化合物：storage 优先，terminal 回退 — 市场买入的矿物落在 terminal，
                // 没有回退则贸易补给的原料永远进不了反应链。
                if ((storage.store[resource] ?? 0) > 0) {
                    return { source: storage, resource, amount: load.amount, phase: "withdraw" };
                }
                if (terminal && (terminal.store[resource] ?? 0) > 0) {
                    return { source: terminal, resource, amount: load.amount, phase: "withdraw" };
                }
            }
            return undefined;
        },
        execute: (ac, t) => {
            if (t.phase === "deposit" || t.phase === "dump") {
                runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.resource));
            }
            else if (t.phase === "unload") {
                runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resource));
            }
            else {
                const available = t.source.store[t.resource] ?? 0;
                const amount = Math.min(t.amount, available, ac.creep.store.getFreeCapacity() ?? 0);
                if (amount <= 0)
                    return;
                runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resource, amount));
            }
        },
    };
}
/**
 * 维持 terminal 能量储备（storage → terminal）。
 * 市场 deal 无论买卖都从本方 terminal 扣能量运费 — terminal 没能量，
 * 贸易系统就是摆设。仅在 storage 能量高于地板值时搬运（经济优先于贸易）。
 * 双相候选：空载取 storage、满载送 terminal，可同时放入 acquire/work 链。
 */
function stockTerminalEnergy() {
    return {
        name: "haul:stock-terminal-energy",
        resolve: (ac) => {
            const terminal = ac.snapshot.terminal;
            const storage = ac.snapshot.storage;
            if (!terminal || !storage)
                return undefined;
            const need = CONFIG.market.energyTarget - terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            if (need <= 0)
                return undefined;
            const carrying = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
            if (carrying > 0)
                return { dest: terminal, phase: "deposit" };
            // 空载：storage 有富余才为 terminal 抽血。
            if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.market.storageEnergyFloor) {
                return undefined;
            }
            return { source: storage, phase: "withdraw" };
        },
        execute: (ac, t) => {
            if (t.phase === "deposit") {
                runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, RESOURCE_ENERGY));
            }
            else {
                runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, RESOURCE_ENERGY));
            }
        },
    };
}
/**
 * 为 factory 补给压缩原料能量（storage → factory）。
 * 仅在 storage 满仓信号下触发 — factory 压缩是对「必然浪费」的能量回收，
 * 正常水位下能量应流向 upgrade/build，不喂 factory。
 * 双相候选：空载取 storage、满载送 factory。
 */
function stockFactoryEnergy() {
    return {
        name: "haul:stock-factory-energy",
        resolve: (ac) => {
            const factory = ac.snapshot.factory;
            const storage = ac.snapshot.storage;
            if (!factory || !storage)
                return undefined;
            if (Memory.rooms[ac.snapshot.roomName]?.storageNearFull !== true)
                return undefined;
            const need = CONFIG.factory.stockTarget - factory.store.getUsedCapacity(RESOURCE_ENERGY);
            if (need <= 0)
                return undefined;
            const carrying = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
            if (carrying > 0)
                return { dest: factory, phase: "deposit" };
            return { source: storage, phase: "withdraw" };
        },
        execute: (ac, t) => {
            if (t.phase === "deposit") {
                runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, RESOURCE_ENERGY));
            }
            else {
                runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, RESOURCE_ENERGY));
            }
        },
    };
}

/**
 * Industry 模块类型定义。
 *
 * 设计原则：
 *   - 纯数据描述，不含 Game API 调用。
 *   - 反应链和 boost 决策均为纯函数，可独立测试。
 *   - 预留多房间扩展接口（TerminalPolicy）。
 */
// ─── 反应配方表 ─────────────────────────────────────────────
/** 所有反应的配方映射：output → [input1, input2]。 */
const REACTIONS = {
    // Tier 1
    UH: ["U", "H"],
    UO: ["U", "O"],
    ZH: ["Z", "H"],
    ZO: ["Z", "O"],
    LH: ["L", "H"],
    LO: ["L", "O"],
    KH: ["K", "H"],
    KO: ["K", "O"],
    GH: ["G", "H"],
    GO: ["G", "O"],
    // 中间产物
    OH: ["O", "H"],
    ZK: ["Z", "K"],
    UL: ["U", "L"],
    G: ["ZK", "UL"],
    // Tier 2
    UH2O: ["UH", "OH"],
    UHO2: ["UO", "OH"],
    ZH2O: ["ZH", "OH"],
    ZHO2: ["ZO", "OH"],
    LH2O: ["LH", "OH"],
    LHO2: ["LO", "OH"],
    KH2O: ["KH", "OH"],
    KHO2: ["KO", "OH"],
    GH2O: ["GH", "OH"],
    GHO2: ["GO", "OH"],
    // Tier 3
    XUH2O: ["X", "UH2O"],
    XUHO2: ["X", "UHO2"],
    XZH2O: ["X", "ZH2O"],
    XZHO2: ["X", "ZHO2"],
    XLH2O: ["X", "LH2O"],
    XLHO2: ["X", "LHO2"],
    XKH2O: ["X", "KH2O"],
    XKHO2: ["X", "KHO2"],
    XGH2O: ["X", "GH2O"],
    XGHO2: ["X", "GHO2"],
};
/** Boost 化合物 → 效果类别映射（用于决策）。
 *
 * 与引擎 BOOSTS 常量逐行对齐 — 化合物线路与效果的对应关系容易记错
 *（例如 UH 线是 attack 而非 harvest，harvest 是 UO 线），
 * 映射错误会让整条 lab 反应链产出无用化合物。
 */
const BOOST_EFFECTS = {
    // U 线：UH = attack，UO = harvest。
    UH: "attack", UH2O: "attack", XUH2O: "attack",
    UO: "harvest", UHO2: "harvest", XUHO2: "harvest",
    // G 线：GH = upgrade，GO = tough（承伤减免）。
    GH: "upgrade", GH2O: "upgrade", XGH2O: "upgrade",
    GO: "tough", GHO2: "tough", XGHO2: "tough",
    // L 线：LH = build/repair，LO = heal。
    LH: "repair", LH2O: "repair", XLH2O: "repair",
    LO: "heal", LHO2: "heal", XLHO2: "heal",
    // Z 线：ZH = dismantle，ZO = move（疲劳减免）。
    ZH: "dismantle", ZH2O: "dismantle", XZH2O: "dismantle",
    ZO: "move", ZHO2: "move", XZHO2: "move",
    // K 线：KH = carry，KO = rangedAttack。
    KH: "carry", KH2O: "carry", XKH2O: "carry",
    KO: "rangedAttack", KHO2: "rangedAttack", XKHO2: "rangedAttack",
};

/**
 * Boost 决策 — 纯函数，无 Game API 依赖。
 *
 * 决定哪些 creep 应该被 boost、使用什么化合物、优先级如何。
 * 设计原则：
 *   - boost 是锦上添花，不能阻塞经济（能量不足时不 boost）
 *   - 优先 boost 高价值角色（upgrader > harvester > builder）
 *   - 预留多房间扩展：boost 策略可按房间配置
 */
/** 默认 boost 策略：RCL6+ 启用，优先 upgrader。 */
const DEFAULT_BOOST_POLICY = {
    roleBoosts: {
        // 化合物线路与引擎 BOOSTS 对齐（见 types.ts 的 BOOST_EFFECTS）：
        // GH 线 = upgradeController，UO 线 = harvest（UH 线是 attack，不要混），
        // LH 线 = build/repair，UH 线 = attack。倍率均为 X 系 T3（最高档）。
        upgrader: "XGH2O", // upgradeController ×2
        harvester: "XUHO2", // harvest ×7
        builder: "XLH2O", // build/repair ×2
        // 防御战力放大：defender 是威胁触发的短窗口角色，boost 即时兑现。
        defender: "XUH2O", // attack ×4
    },
    minRcl: 6,
    reserveAmount: 100, // 保留 100 单位化合物用于反应链
};
/** 角色 boost 优先级（越高越先执行）。 */
const ROLE_BOOST_PRIORITY = {
    // 防御最高：defender 只在房内有威胁时存在，boost 是即时战力而非长期投资。
    defender: 20,
    upgrader: 10,
    harvester: 8,
    builder: 5,
};
/**
 * 新生 creep 的 boost 报到窗口：ticksToLive 高于此值视为刚出生（约 100 tick 内）。
 * 请求生成与 creep 的「去 lab 报到」拦截共用此阈值 —
 * 窗口一过，请求不再生成、creep 也不再被引导去 lab，天然防止在 lab 旁永久等待。
 */
const BOOST_REPORT_TTL = 1400;
/**
 * 计算当前 tick 的 boost 请求列表。
 *
 * @param creeps      当前存活 creep 摘要
 * @param rcl         房间 RCL
 * @param storage     storage 中各化合物数量
 * @param policy      boost 策略
 * @returns 按优先级排序的 boost 请求
 */
function evaluateBoostRequests(creeps, rcl, storage, policy = DEFAULT_BOOST_POLICY) {
    if (rcl < policy.minRcl)
        return [];
    const requests = [];
    for (const creep of creeps) {
        // 已经 boost 过的不再请求
        if (creep.boosted)
            continue;
        // 只 boost 新生 creep（报到窗口内，即刚出生 100 tick 内）
        if (creep.ticksToLive < BOOST_REPORT_TTL)
            continue;
        const targetCompound = policy.roleBoosts[creep.role];
        if (!targetCompound)
            continue;
        // 检查库存是否足够（保留 reserve）
        const available = (storage[targetCompound] ?? 0) - policy.reserveAmount;
        if (available < 30)
            continue; // 至少需要 30 单位（boost 一个 creep 需要 bodyParts × 30）
        const priority = ROLE_BOOST_PRIORITY[creep.role] ?? 0;
        requests.push({
            creepName: creep.name,
            compound: targetCompound,
            bodyParts: 5, // 默认 boost 5 个 body parts
            priority,
        });
    }
    // 按优先级降序排列
    requests.sort((a, b) => b.priority - a.priority);
    return requests;
}

/**
 * Boost 报到拦截 — 连接「boost 决策」与「boostCreep 执行」的就位环节。
 *
 * 数据流：lab-system（P1 系统，先于角色运行）每 tick 把「creep → boost lab」
 * 分配写入 globalCache.boostAssignments；role-runner 在角色管线早段调用本函数，
 * 命中分配的新生 creep 被引导到 lab 旁并原地等待，lab-system 在相邻时执行
 * lab.boostCreep（该 API 要求 creep 与 lab 相邻）。
 *
 * 自限性防呆：拦截仅在报到窗口内生效（ticksToLive > BOOST_REPORT_TTL，
 * 与请求生成共用同一阈值）。窗口一过，请求端不再生成、拦截端自动放行，
 * creep 转入正常工作 — 即使化合物迟迟不到位也不会在 lab 旁永久罚站。
 */
/**
 * 检查 creep 是否需要去 boost lab 报到。
 * 返回 true 表示本 tick 已被报到流程接管（移动或原地等待），角色管线应直接返回。
 */
function interceptForBoost(creep) {
    // 报到窗口已过 — 放行去干活。
    if ((creep.ticksToLive ?? 0) <= BOOST_REPORT_TTL)
        return false;
    const assignments = globalCache().boostAssignments;
    if (!assignments || assignments.tick !== Game.time)
        return false;
    const entry = assignments.byCreep[creep.name];
    if (!entry)
        return false;
    // lab 化合物未就位 — 不去罚站（尤其 defender：威胁在场时等待即战力真空）。
    // supplyLabs 备料完成后的分配周期会重新给出 ready 标记。
    if (!entry.ready)
        return false;
    const lab = getObjectById(entry.labId);
    if (!lab)
        return false;
    if (creep.pos.getRangeTo(lab.pos) > 1) {
        moveToTarget(creep, lab);
    }
    // 已在 lab 旁 — 原地等待 lab-system 执行 boostCreep（化合物由 supplyLabs 补给）。
    return true;
}

/** 如果此 label 在限频窗口内已记录过日志则返回 true。 */
function shouldSuppress(label, tick) {
    const g = globalCache();
    if (!g.errorLog)
        g.errorLog = new Map();
    const last = g.errorLog.get(label);
    if (last !== undefined && tick - last < CONFIG.kernel.errorLogInterval)
        return true;
    g.errorLog.set(label, tick);
    return false;
}
function formatError(error) {
    if (error instanceof Error)
        return error.stack ?? error.message;
    return String(error);
}
// ──────────────────────────────────────────────
// 共享的错误处理逻辑 — safeRun 和 safeRunBuild 共用
// ──────────────────────────────────────────────
/** 检查非关键 label 是否处于冷却期。 */
function isCoolingDown(label, critical) {
    if (critical)
        return false;
    const g = globalCache();
    if (!g.pluginCooldowns)
        g.pluginCooldowns = new Map();
    const cooldown = g.pluginCooldowns.get(label);
    return cooldown !== undefined && Game.time < cooldown;
}
/** 成功时重置错误计数。 */
function resetErrorCount(label) {
    const g = globalCache();
    if (g.errorCounts)
        g.errorCounts.delete(label);
}
/** 处理错误：限频日志、遥测计数、非关键插件冷却。 */
function handleError(label, error, critical) {
    const g = globalCache();
    if (!shouldSuppress(label, Game.time)) {
        console.log(`[${Game.time}] ${label}: ${formatError(error)}`);
    }
    recordError();
    // 跟踪连续错误并为非关键插件设置冷却。
    if (!critical) {
        if (!g.errorCounts)
            g.errorCounts = new Map();
        const count = (g.errorCounts.get(label) ?? 0) + 1;
        g.errorCounts.set(label, count);
        if (count >= 3) {
            if (!g.pluginCooldowns)
                g.pluginCooldowns = new Map();
            const cooldownTicks = Math.min(50 + count * 10, 200);
            g.pluginCooldowns.set(label, Game.time + cooldownTicks);
            g.errorCounts.set(label, 0); // 进入冷却后重置计数。
        }
    }
}
// ──────────────────────────────────────────────
// 公共 API
// ──────────────────────────────────────────────
/**
 * 系统和 creep 角色的错误边界。
 * 一个错误不能终止剩余 tick。相同错误按频率限流以避免日志刷屏
 * （默认：每个 label 每 25 tick 最多输出一次）。
 *
 * 非关键插件连续失败 3 次以上将被冷却 50-200 tick。
 * 关键（P0）插件不会被冷却 — 只有日志限流。
 */
function safeRun(label, action, critical = false) {
    if (isCoolingDown(label, critical))
        return;
    try {
        action();
        resetErrorCount(label);
    }
    catch (error) {
        handleError(label, error, critical);
    }
}
/** safeRun 的返回值变体 — 用于构建快照等需要返回值的场景。 */
function safeRunBuild(label, factory, critical = false) {
    if (isCoolingDown(label, critical))
        return undefined;
    try {
        const result = factory();
        resetErrorCount(label);
        return result;
    }
    catch (error) {
        handleError(label, error, critical);
        return undefined;
    }
}
/** 执行操作并测量其 CPU 消耗用于遥测。 */
function measuredRun(label, action) {
    const before = Game.cpu.getUsed();
    try {
        action();
    }
    finally {
        const after = Game.cpu.getUsed();
        recordCpu(label, after - before);
    }
}
function recordError() {
    const g = globalCache();
    if (!g.telemetry || g.telemetry.tick !== Game.time)
        return;
    g.telemetry.errors++;
}
function recordCpu(label, cost) {
    const g = globalCache();
    if (!g.telemetry || g.telemetry.tick !== Game.time)
        return;
    if (label.startsWith("system/")) {
        const name = label.slice("system/".length);
        g.telemetry.systemCpu[name] = (g.telemetry.systemCpu[name] ?? 0) + cost;
    }
    else if (label.startsWith("creep/")) {
        const parts = label.split("/");
        const role = parts[2] ?? "unknown";
        g.telemetry.roleCpu[role] = (g.telemetry.roleCpu[role] ?? 0) + cost;
    }
}
/**
 * 记录 Action 级 CPU profiling 数据。
 * 仅当 CONFIG.debug.actionProfiling 为 true 时调用 — 调用方负责门禁。
 * key 格式："roleName/actionName/resolve" | "roleName/actionName/execute" | "roleName/onFlee"。
 * 按 tick 惰性重置 Map。 */
function recordActionCpu(key, cost) {
    const g = globalCache();
    if (!g.actionCpu || g.actionCpuTick !== Game.time) {
        g.actionCpu = new Map();
        g.actionCpuTick = Game.time;
    }
    const entry = g.actionCpu.get(key);
    if (entry) {
        entry.count++;
        entry.totalCpu += cost;
        if (cost > entry.maxCpu)
            entry.maxCpu = cost;
    }
    else {
        g.actionCpu.set(key, { count: 1, totalCpu: cost, maxCpu: cost });
    }
}

/**
 * 创建一个由 RolePolicy 驱动的 CreepRole。
 *
 * @param name     角色名（用于注册和 telemetry）
 * @param priority 调度优先级 P0-P4
 * @param policy   声明式行为策略
 */
function defineRole(name, priority, policy) {
    return {
        name,
        priority,
        run(creep, ctx) {
            // try/finally 保证所有 return 路径（含异常）都绘制状态指示灯。
            // finally 块在 CONFIG.debug.statusLight 关闭时为零开销（函数内首行即 return）。
            try {
                // ── 1. 获取 home 房快照（home 恒为自有房，快照必存在）──
                const snapshot = ctx.getSnapshot(creep.memory.home);
                if (!snapshot)
                    return;
                // ── 2. B1：已标记回收的 creep 停止角色工作（移动由 spawn-manager 接管）──
                if (creep.memory.recycle) {
                    creep.memory.mode = "idle";
                    return;
                }
                // ── 3. 敌人检测 → flee（先于导航：遇袭即逃，无论是否在通勤途中）──
                // 战斗角色（policy.combat）豁免 — 它们的职责就是接敌，逃跑检测只适用于经济角色。
                // 按 creep 实际所在房间选择威胁来源：
                //   - 外部房间（远矿房 / 过境中间房）：无 snapshot，直接扫描当前房（shouldFleeForeignRoom）。
                //     修复 transit 盲区——必须排在 ensureHome 之前，否则过境 creep 被 ensureHome
                //     短路导航（返回 false 提前 return），永远轮不到威胁检测。
                //   - home 房：使用 home snapshot 的 threatCreeps（shouldFlee）。
                const inForeignRoom = creep.room.name !== creep.memory.home;
                if (!policy.combat && inForeignRoom && shouldFleeForeignRoom(creep)) {
                    creep.memory.mode = "flee";
                    fleeToHome(creep);
                    return;
                }
                if (!policy.combat && !inForeignRoom && shouldFlee(creep, snapshot)) {
                    creep.memory.mode = "flee";
                    // G-SM-05: flee 期间释放普通 assignment，仅移动到安全位置。
                    if (creep.memory.assignment) {
                        releaseAssignment(creep);
                    }
                    // P0-2: 调用角色级 onFlee 钩子 — 角色可自行处理安全区行为（如防御圈内充能）。
                    // 返回 true 表示已处理，跳过通用 flee 移动；返回 false 表示需要通用 flee 接管。
                    const fleeAc = {
                        creep,
                        snapshot,
                        assignment: undefined,
                        budget: ctx.budget,
                        ctx,
                    };
                    if (policy.onFlee) {
                        if (CONFIG.debug.actionProfiling) ;
                        else {
                            if (!policy.onFlee(fleeAc))
                                flee(creep, snapshot);
                        }
                    }
                    else {
                        flee(creep, snapshot);
                    }
                    return;
                }
                // ── 3.5 威胁消除后重置 flee mode ──
                // ensureHome 在 updateMode 之前执行。如果 mode=flee（上一 tick 残留），
                // ensureHome 看到 flee → goHome=true → 导航回 home → return false → updateMode 不执行 →
                // mode 永远不被重置。导致 remoteHarvester 到达 source 后不采集（mode=flee → 一直走回 home）。
                // 修复：shouldFleeForeignRoom/shouldFlee 返回 false = 当前无威胁 → 重置 flee mode。
                if (creep.memory.mode === "flee") {
                    creep.memory.mode = undefined;
                }
                // ── 3.7 Boost 报到 ──
                // 新生 creep（报到窗口内）若被 lab-system 分配了 boost lab，
                // 引导其到 lab 旁等待 boostCreep 执行。排在 flee 之后（安全优先）、
                // 正常工作流之前（boost 是即时战力放大，先强化再上岗）。
                if (interceptForBoost(creep))
                    return;
                // ── 4. 确认在目标房间（home 或 remoteTarget）──
                if (!ensureHome(creep)) {
                    // 远矿角色通勤中保持原 mode（acquire/work）——ensureHome 对 idle 模式
                    // 会导航回 home，导致 remote creep 在 home↔remoteTarget 之间振荡，
                    // 永远到不了目标房。本地角色（无 remoteTarget）仍切 idle 防止在异房作业。
                    if (!creep.memory.remoteTarget) {
                        creep.memory.mode = "idle";
                    }
                    return;
                }
                // ── 5. FSM 状态转换 ──
                updateMode(creep);
                // ── 6. 获取/续约任务 ──
                const assignment = getAssignment(creep, ctx);
                // ── 7. 构建 ActionContext ──
                const ac = {
                    creep,
                    snapshot,
                    assignment,
                    budget: ctx.budget,
                    ctx,
                };
                // ── 8. 角色级门禁 ──
                if (policy.gate && !policy.gate(ac)) {
                    creep.memory.mode = "idle";
                    return;
                }
                // ── 9. 按 mode 选择候选列表并评估 ──
                // resolve 模式：resolve 返回非 undefined 即执行，目标传入 execute。
                // 目标只解析一次，消除 predicate-execute 重复计算。
                //
                // actionProfiling 分支：开关关闭时走原始路径（零开销）；
                // 开启时每个 resolve/execute 调用用 Game.cpu.getUsed() 测量并记录到 globalCache。
                const candidates = creep.memory.mode === "work" ? policy.work : policy.acquire;
                if (CONFIG.debug.actionProfiling) ;
                else {
                    for (const candidate of candidates) {
                        const target = candidate.resolve?.(ac);
                        if (target !== undefined) {
                            candidate.execute(ac, target);
                            return;
                        }
                    }
                }
                // ── 10. 无匹配候选 → idle（移动角色先归位再 idle）──
                if (policy.park) {
                    parkIdleCreep(creep, snapshot);
                }
                // 远矿角色不在目标房间时不切 idle——idle 会导致 ensureHome 导航回 home，
                // 形成 idle→updateMode→acquire→action fail→idle 死循环，永远到不了 remoteTarget。
                // remoteHauler work 模式在 home 房无 action 时可以 idle（ensureHome 会保持在家）。
                const remoteTarget = creep.memory.remoteTarget;
                const haulerWorkAtHome = remoteTarget && creep.memory.role === "remoteHauler" &&
                    creep.memory.mode === "work" && creep.room.name === creep.memory.home;
                if (!remoteTarget || creep.room.name === remoteTarget || haulerWorkAtHome) {
                    creep.memory.mode = "idle";
                }
            }
            finally {
            }
        },
    };
}

/** recovery tier 门禁：释放 assignment（不建造）。 */
function builderGate(ac) {
    if (ac.budget.tier === "recovery") {
        releaseAssignment(ac.creep);
        return true;
    }
    // conserve 下不释放 assignment — construction-manager 的 developmentGate
    // 已在 conserve 下做了建造门禁（emergency 豁免），builder 不需要二次过滤。
    // 如果 site 存在，说明 construction-manager 认为可以建，builder 就应该去建它。
    return true;
}
/**
 * 动态计算 builder 从 storage 取能上限 — 按 storage 水位分档缩放。
 *
 * 与 distributor 水位分级对齐，确保低水位时 builder 不抢高优先级消费者的能量：
 *   - 高水位 (>20%)：放开到 carry 满载（库存充足，builder 全速建造）
 *   - 中水位 (10%-20%)：限 200/tick（节流但维持基本建造）
 *   - 低水位 (<10%)：限 50/tick（仅维持最低建造，让 hauler 优先补给 spawn/extension）
 *
 * 比 distributor 的阈值更保守：builder 是 P2，storage 水位低时 tier 系统会门禁建造
 * （recovery 跳过，conserve 只建 critical），取能也应同步收紧。
 */
function builderStorageLimit(ac) {
    const st = ac.snapshot.storage;
    if (!st)
        return 0;
    const energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
    const capacity = st.store.getCapacity(RESOURCE_ENERGY);
    if (capacity === 0)
        return 0;
    const ratio = energy / capacity;
    if (ratio > 0.2)
        return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
    if (ratio > 0.1)
        return 200;
    return 50;
}
const policy$b = {
    park: true,
    gate: builderGate,
    acquire: [
        // 0. 拾取地上掉落能量（衰减资源，最优先回收）。
        pickupDroppedEnergy(),
        // 1. 从 storage 取能（RCL4+ 主力源 — hauler 持续填充，最可靠）。
        //    无 storage 时 predicate=false，自动跳过。
        withdrawStorageCapped(builderStorageLimit),
        // 2. 取最近非物流 container 的能量（不抢 hauler/upgrader 的物流源）。
        withdrawClosestNonSourceContainer(),
        // 3. 兜底：所有 container 无能量时直接采集。
        harvestSource(),
    ],
    work: [
        // 急救：新生 rampart 灌血过生存线（建成仅 1 hit，100 tick 内必死于衰减）。
        // 必须排在 build 之前 — 灌血十几 tick，建 site 上百 tick；
        // 顺序反了就是「建了就塌、塌了再建」死循环，防线永远立不起来。
        repairFreshRampart(),
        // 建造 assignment 指定的 site（recovery 跳过）。
        buildAssignmentSite({ }),
        // 建造最近 site（recovery 跳过）。
        // conserve 下不再过滤 criticalOnly — construction-manager 的 developmentGate
        // 已控制哪些 site 应该存在，builder 只需去建它们。
        buildNearestSite(false),
        // 紧急：修复衰减中的 container（< 80% 血量）。
        // 优先级高于 fill — 失去 container = 物流链断裂 = 经济崩溃。
        repairContainerDecay(),
        // 紧急：修复血量 < 50% 的关键结构（spawn/tower/extension/container）。
        // P2 修复：原位于 fillTarget 之后，现提前 — 结构快塌了比填能量更紧急。
        repairCritical(),
        // fallback: 填充 spawn/extension。
        fillTarget(),
        // fallback: 修复衰减中的道路（< 40% 血量）。
        // P1 修复：原先道路无任何维修覆盖，塌毁后交通变慢浪费 CPU。
        repairRoads(),
        // fallback: 防御工事维修（B3：盈余门禁 + 无威胁时，修 wall/rampart 至分级血量）。
        // 维修权从塔移交 creep —— 塔修墙是能量黑洞，creep 修是 1 energy/100 hits/WORK。
        repairFortifications(),
        // 所有建造/填充/维修候选均不匹配 → park 待命。
        // builder 不 fallback 到升级 — 升级是 upgrader 的职责。
        // builder 等待新 construction site 出现，而不是消耗能量去升级。
    ],
};
const builderRole = defineRole("builder", 2, policy$b);

/** 占领目标房 controller。 */
function claimControllerAction() {
    return {
        name: "claimer:claim-controller",
        resolve: (ac) => {
            const remoteTarget = ac.creep.memory.remoteTarget;
            if (!remoteTarget || ac.creep.room.name !== remoteTarget)
                return undefined;
            const controller = ac.creep.room.controller;
            if (!controller || controller.my)
                return undefined; // 已占领 — 使命完成。
            return controller;
        },
        execute: (ac, controller) => {
            const result = ac.creep.claimController(controller);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, controller);
            }
            // ERR_GCL_NOT_ENOUGH / ERR_INVALID_TARGET（被抢占）等由
            // expansion-manager 的超时废弃路径兜底，不在角色层重试决策。
        },
    };
}
const policy$a = {
    acquire: [
        claimControllerAction(),
    ],
    work: [
        // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
        claimControllerAction(),
    ],
};
const claimerRole = defineRole("claimer", 2, policy$a);

/** 攻击 home 房内最近的威胁 creep。 */
function attackNearestThreat() {
    return {
        name: "defender:attack-threat",
        resolve: (ac) => {
            const threats = ac.snapshot.threatCreeps;
            if (threats.length === 0)
                return undefined;
            return ac.creep.pos.findClosestByRange(threats) ?? threats[0];
        },
        execute: (ac, target) => {
            const result = ac.creep.attack(target);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, target);
            }
        },
    };
}
const policy$9 = {
    combat: true,
    park: true,
    acquire: [
        attackNearestThreat(),
    ],
    work: [
        // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
        attackNearestThreat(),
    ],
};
const defenderRole = defineRole("defender", 1, policy$9);

/** 各档位对应的单次最大取能量。tier 0 = 满载（carry 容量）。 */
const TIER_WITHDRAW_CAP = [
    Infinity, // tier 0: 满载
    Infinity, // tier 1: 满载（但目标类型受限）
    400, // tier 2: 限取 400/tick
    200, // tier 3: 限取 200/tick
];
/** 从 storage 限量取能 — 带水位分级节流。
 *
 * 需求门禁是本角色的核心设计：
 * 没有 fillTarget（spawn/extension/tower 全满）时禁止从 storage 取能。
 * 这从架构上消除了 storage→storage 循环的可能性。
 *
 * 水位分级（由 gate 写入 creep.memory.distributorTier，
 * 阈值为绝对能量值 — CONFIG.economy.distributorTiers）：
 *   tier 0 (≥50k)：满载取能，所有 fillTarget 正常服务
 *   tier 1 (≥10k)：满载取能，fillTarget 仅 spawn/extension
 *   tier 2 (≥2k)：限取 400/tick，fillTarget 仅 spawn/extension
 *   tier 3 (<2k)：限取 200/tick，fillTarget 仅 spawn
 */
function withdrawStorageForDistribution() {
    return {
        name: "withdraw:storage-for-distribution",
        resolve: (ac) => {
            const st = ac.snapshot.storage;
            if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
                return undefined;
            // 需求门禁：没有下游 fillTarget 时禁止从 storage 取能。
            if (ac.snapshot.fillTargets.length === 0)
                return undefined;
            return st;
        },
        execute: (ac, target) => {
            const st = target;
            const available = st.store.getUsedCapacity(RESOURCE_ENERGY);
            const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
            // 水位分级限取：tier 由 gate 每 tick 计算并持久化到 memory。
            const tier = ac.creep.memory.distributorTier ?? 0;
            const cap = TIER_WITHDRAW_CAP[tier];
            const amount = Math.min(available, carryFree, cap);
            const result = ac.creep.withdraw(st, RESOURCE_ENERGY, amount);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, st);
            }
            else if (result === ERR_NOT_ENOUGH_RESOURCES) {
                ac.creep.memory.mode = "idle";
            }
        },
    };
}
/** 无 storage 时降级为 hauler — 处理 storage 被毁后 distributor 残留的场景。
 *
 * demand 系统在无 storage 时不会孵化新 distributor（正确），
 * 但已有的 distributor 无 storage 可取能 → acquire 返回 undefined → idle → 空转。
 * 降级为 hauler 后，creep 从 container 取能、填充 spawn/extension，继续工作。
 * 当 storage 重建后，demand 系统会孵化新的 distributor。
 *
 * body 兼容：distributor 和 hauler 都是纯 CARRY+MOVE，角色转换安全。
 *
 * 水位分级计算：每 tick 根据 storage 水位计算 distributorTier 并写入 memory，
 * 供 withdrawStorageForDistribution（限取）和 distributorFillTarget（过滤目标）使用。
 */
function distributorGate(ac) {
    if (!ac.snapshot.storage) {
        ac.creep.memory.role = "hauler";
        return false; // 跳过本 tick，下一 tick 以 hauler 角色运行
    }
    // 每 tick 重新计算水位档位，供本 tick 的 acquire/work 阶段读取。
    ac.creep.memory.distributorTier = computeDistributorTier(ac.snapshot.storage);
    return true;
}
const policy$8 = {
    park: true,
    gate: distributorGate,
    acquire: [
        // 唯一取能源：storage（带需求门禁）。
        // 没有 fillTarget 时 predicate=false → idle → demand 系统不补孵。
        withdrawStorageForDistribution(),
        // terminal 能量备货（storage 富余时）— 无 fillTarget 需求时的低优先级取能，
        // 保证市场 deal 的运费储备不断供。
        stockTerminalEnergy(),
        // factory 压缩原料备货（仅 storage 满仓时触发）。
        stockFactoryEnergy(),
        // lab 供料（取料/卸料相）— 必须挂在 acquire 链：work 模式要求满载进入，
        // 空载的「从 storage 取化合物 / 从 lab 清错矿」只有 acquire 阶段能执行。
        // 只挂 work 链时取料相永不可达，需求表沦为无消费者的死数据。
        supplyLabs(),
    ],
    work: [
        // distributor 专用填充：spawn/extension 绝对优先 > tower > controller container（仅无 link 兜底）。
        // 不复用 hauler 的 haulFillTarget——避免被 divert 去喂 controller container 而饿死 spawn。
        distributorFillTarget(),
        // terminal 能量备货（deposit 相）— 排在经济 sink 之后、lab 供料之前：
        // 携能状态下 supplyLabs 的取料相无法执行（背包已满），先卸给 terminal。
        stockTerminalEnergy(),
        // factory 压缩原料备货（deposit 相，仅满仓时触发）。
        stockFactoryEnergy(),
        // 化合物供料到 lab。
        supplyLabs(),
        // 所有 sink 均满 — 原地待命。
        // 注意：distributor 没有 fillStorage — 这是架构约束。
        // 如果加了 fillStorage，就会重新引入 storage→storage 循环。
    ],
};
const distributorRole = defineRole("distributor", 1, policy$8);

const policy$7 = {
    acquire: [
        // 0. 站桩采集并同 tick 倒能（source 旁有 container/link 时）— 消除采/倒互斥的产能损失。
        stationaryMine(),
        // 1. 无 source sink（早期无 container）时的通用采集（含拥挤迁移）。
        harvestSource(),
        // source 再生期间：如果 extractor 存在（RCL6+），采集 mineral。
        harvestMineral(),
    ],
    work: [
        // 0. 站桩采集同 tick 倒能 — 拦截站桩矿工，使其永不因 container 满而落到后续离岗动作（P2-7）。
        stationaryMine(),
        // 1. 矿物优先卸载（不应占用 energy carry 空间）。
        dumpMineralsToNearbyContainer(),
        // 2. 身边 link（range<=2）— 瞬时传输到 controller/storage。
        dumpToNearbyLink(),
        // 3. 身边 container（range<=2）— 站桩 miner 倒能（经济第一优先级）。
        dumpToNearbyContainer(),
        // 3.5 紧急恢复：身边 container 在建 site（range<=3）。
        buildNearbyContainerSite(),
        // 3.6 身边 container 血量 < 80% 时修复（仅在倒能后仍有剩余能量时触发，
        //     即 container 已满无法接收更多能量 — 避免修复抢占倒能导致经济断流）。
        repairNearbyContainer(),
        // 4. 直接送 spawn/extension/tower（早期无 container 的矿工物流回退）。
        fillTarget(),
        // 5. 全满时倒入最空 container。
        fillEmptiestContainer(),
        // 所有倒能/填充候选均不匹配 → park 待命。
        // harvester 不 fallback 到建造/升级 — 这些是 builder/upgrader 的职责。
        // harvester 留在矿位等待 container 有空间，stationaryMine 会拦截。
    ],
};
const harvesterRole = defineRole("harvester", 1, policy$7);

/**
 * Hauler — P1 收集者角色。
 *
 * 职责：将能量从源（container/dropped/link）搬运到 sink（spawn/extension/storage）。
 * 数据流方向：源 → Storage/Sink（单向，永不从 storage 取能）。
 *
 * 与 distributor 的职责分离：
 *   - Hauler（收集者）：container/dropped/link → storage/sink
 *   - Distributor（分发者）：storage → spawn/extension/tower/lab
 *
 * 架构约束：hauler 永不从 storage 取能。
 * 这消除了旧架构中 hauler 同时从 storage 取能又存回 storage 的循环依赖。
 * storage → sink 的分发由 distributor 角色负责。
 *
 * 无 storage 时（RCL1-3）：hauler 直接 container → spawn/extension 直送，
 * 不需要 distributor。
 *
 * onFlee 钩子（P0-2 修复）：
 *   hauler 在 flee 状态下的"防御圈内安全充能"逻辑从 lifecycle.ts 移到此处。
 *   仅当 hauler 携带能量且已在 spawn 安全区内时触发，
 *   向防御圈内的需能量结构（threat 时 tower 优先）转移能量。
 *   解决战斗中 Tower 能量耗尽、hauler 全部 flee 导致无人补给的防御死局。
 *
 * 策略声明：
 *   acquire: assignment container > storage link（排空 link 网络）> 大额遗留能量
 *            （坟墓/废墟/掉落堆 ≥ lootThreshold，衰减资源优先）> 最满 container（主取能）
 *            > 零头遗留兜底
 *   work:    haul fillTarget（带 reservation）> minerals → storage > labs > storage > 待命
 *
 * acquire 顺序要点：零头 droppedEnergy 排最后。container 满溢时 harvester 会 drop 溢出能量，
 * 若先捡零头 drop 会让 hauler 半满离开、来回空转而抽不干满 container（溢出根源未除）；
 * 先抽最满 container 既满载搬运又从源头止住溢出。大额遗留（≥ lootThreshold）例外插队 —
 * 它们在衰减/限时灭失，container 能量不会。详见 acquire 链内注释。
 */
/** 从 assignment 指定的 container 限量取能。
 *
 * TD-013 修复：增加运行时结构类型检查。
 * assignment service 已不再将 storage 作为 haul source，但防御性检查仍保留，
 * 防止未来回退路径 reintroduction 导致 hauler 隐蔽从 storage 取能。
 */
function withdrawAssignmentContainer() {
    return {
        name: "withdraw:assignment-container",
        resolve: (ac) => {
            if (!ac.assignment?.sourceId)
                return undefined;
            const obj = getObjectById(ac.assignment.sourceId);
            if (obj === null)
                return undefined;
            // 运行时类型守卫：仅允许 StructureContainer，拒绝 storage 等其他结构。
            // hauler 架构约束：永不从 storage 取能（storage → sink 由 distributor 负责）。
            if (obj.structureType !== STRUCTURE_CONTAINER)
                return undefined;
            const container = obj;
            if (container.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
                return undefined;
            return container;
        },
        execute: (ac, container) => {
            const available = container.store.getUsedCapacity(RESOURCE_ENERGY);
            const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
            const amount = Math.min(available, carryFree);
            const result = ac.creep.withdraw(container, RESOURCE_ENERGY, amount);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, container);
            }
            else if (result === ERR_NOT_ENOUGH_RESOURCES) {
                ac.creep.memory.mode = "idle";
            }
        },
    };
}
/** 从最满的非 controller container 限量取能。
 *
 * 禁止从 controller container 取能：hauler 的 work 链会向 controller container 倒能
 * （haulFillTarget 将低于半满的 controller container 列为最高优先级填充目标）。
 * 如果 acquire 链同时从 controller container 取能，会形成「取→倒→取→倒」振荡。
 */
function withdrawRichestCapped() {
    return withdrawCapped((ac) => {
        // 排除 controller container — 它是 hauler 的填充目标，不是取能来源。
        const candidates = ac.snapshot.controllerContainer
            ? ac.snapshot.containers.filter(c => c.id !== ac.snapshot.controllerContainer.id)
            : ac.snapshot.containers;
        const best = findRichestContainer(candidates);
        if (!best || best.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
            return undefined;
        return best;
    });
}
// ─── onFlee：防御圈内安全充能（P0-2 从 lifecycle.ts 迁移）─────────
/**
 * Hauler 在 flee 状态下的"防御圈内安全充能"。
 *
 * 触发条件（全部满足）：
 *   1. hauler 已在 spawn 安全区内（距 spawn ≤ safeRefuelRange）
 *   2. 存在需能量结构（fillTargets）且该结构也在防御圈内
 *   3. 目标不在敌人侧（目标距敌人 ≥ hauler 距敌人，避免向敌人移动）
 *
 * 执行：
 *   - 在 transfer 范围内（≤ 1）→ 执行 transfer
 *   - 否则 → 移动到目标（仍在防御圈内）
 *
 * 优先级与 getHaulFillTarget 对齐：threat 存在时 tower 优先。
 * 返回 true 表示已执行充能（transfer 或移动），flee 函数应跳过原移动逻辑。
 * 返回 false 表示未处理，需要通用 flee 移动逻辑接管。
 */
function haulerOnFlee(ac) {
    const creep = ac.creep;
    const snapshot = ac.snapshot;
    // 仅携带能量的 hauler 才执行安全充能。
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
        return false;
    if (snapshot.spawns.length === 0)
        return false;
    if (snapshot.fillTargets.length === 0)
        return false;
    const spawn = snapshot.spawns[0];
    const safeRange = CONFIG.defense.safeRefuelRange;
    // hauler 必须已在 spawn 安全区内
    if (creep.pos.getRangeTo(spawn.pos) > safeRange)
        return false;
    const nearestHostile = creep.pos.findClosestByRange(snapshot.threatCreeps) ?? undefined;
    // 复用 getHaulFillTarget 的优先级层级（haulerFillTiers）选择防御圈内最近的需能量结构。
    // 不使用预约系统 — flee 是临时行为，不应消耗正常 hauler 的预约配额。
    const target = pickHaulFillTargetInRange(creep, snapshot, spawn.pos, safeRange);
    if (!target)
        return false;
    // 安全检查：目标不能在敌人侧（目标距敌人 < hauler 距敌人 = 向敌人移动）
    if (nearestHostile) {
        const hostileToTarget = nearestHostile.pos.getRangeTo(target.pos);
        const creepToHostile = creep.pos.getRangeTo(nearestHostile.pos);
        if (hostileToTarget < creepToHostile)
            return false;
    }
    const dist = creep.pos.getRangeTo(target.pos);
    if (dist <= 1) {
        creep.transfer(target, RESOURCE_ENERGY);
        return true;
    }
    // 移动到目标（仍在防御圈内）
    creep.moveTo(target, { reusePath: 5, ignoreCreeps: false });
    return true;
}
const policy$6 = {
    park: true,
    onFlee: haulerOnFlee,
    acquire: [
        // 0. 优先使用 assignment 指定的 container（任务驱动，定向搬运）。
        withdrawAssignmentContainer(),
        // 1. 排空 storage link — link 物流链的「最后一公里」。
        //    必须在 container 之前：storage link 是 link 网络的排水口，
        //    不排空则 source link 背压瘫痪，整条 link 网络堵死。
        withdrawStorageLink(),
        // 2. 大额遗留能量优先于 container —— 衰减资源优先原则。
        //    坟墓/废墟/掉落堆都在衰减或限时灭失，container 能量不衰减：
        //    同样一车运力，先救会消失的。阈值（lootThreshold）挡住零头，
        //    保住下方「先抽满 container 防溢出空转」的既有取舍——
        //    只有值得专程的大额遗留（满载 creep 死亡、拆除建筑的库存）才插队。
        //    container 能量不足装满一车时，FSM（free>0 保持 acquire）会自然
        //    继续走这些候选凑满，无需显式「凑单」逻辑。
        lootRemains(CONFIG.economy.lootThreshold),
        pickupDroppedEnergy(CONFIG.economy.lootThreshold),
        // 3. 回退到最满 container —— 主取能源。
        //    必须排在零头拾取之前：container 满溢时 harvester 会 drop 溢出能量，
        //    若先捡零头 drop（小堆、衰减），hauler 背包没装满就离开去卸货，回来时 harvester 又 drop，
        //    于是「捡零头→半满离开→返回→再捡零头」来回空转，满 container 始终没被抽干（溢出根源未除）。
        //    先抽最满 container：一口装满背包（满载搬运），且抽干 container 即消除溢出根源。
        withdrawRichestCapped(),
        // 4. 零头兜底 —— 残余清理（死亡掉落零头 / container 被毁残留 / 溢出小堆）。
        //    降至最后：仅当无 assignment / link / 大额遗留 / container 可取时才触发。
        lootRemains(1),
        pickupDroppedEnergy(),
        // 注意：hauler 永不从 storage 取能。
        // storage → sink 的分发由 distributor 角色负责。
        // 这从架构上消除了 storage→storage 循环。
    ],
    work: [
        // 矿物优先搬运（高价值资源不应滞留在 container）。
        haulMineralsToStorage(),
        // RCL4+: 优先填充 storage（distributor 从 storage 分发到 spawn/extension）。
        // RCL1-3: 无 storage → predicate=false → fallthrough 到 haulFillTarget。
        // 这修复了 storage 空置死锁：旧顺序 haulFillTarget 在前，spawn 不满时 hauler
        // 永远直送 spawn，storage 永远空，distributor 永远 idle。
        fillStorage(),
        // spawn/extension 紧急回退：storage 满或无 storage 时直送。
        haulFillTarget(),
        // 化合物供料到 lab。
        supplyLabs(),
        // 所有 sink 均满 — 原地待命。
        // hauler 无 WORK 部件，不能升级控制器（upgradeController 会 ERR_NO_BODYPART）。
        // 空闲是正确信号：供给 > 需求，demand 系统会据此减少 hauler 孵化数量。
    ],
};
const haulerRole = defineRole("hauler", 1, policy$6);

/**
 * 获取远矿 source — 从缓存的 sourceId 或直接 find。
 * 首次进入远矿房时执行一次 room.find，之后复用 sourceId。
 */
function getRemoteSource(creep) {
    // 优先使用缓存的 sourceId。
    if (creep.memory.sourceId) {
        const source = getObjectById(creep.memory.sourceId);
        if (source)
            return source;
        // source 消失（如 SK 房 source 被占领），清除缓存。
        creep.memory.sourceId = undefined;
    }
    // 首次或缓存失效：从当前房间 find source。
    const room = creep.room;
    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0)
        return undefined;
    // 选最近的 source（远矿房通常 2 个 source，选近的减少通勤）。
    let best = sources[0];
    let bestDist = creep.pos.getRangeTo(best);
    for (let i = 1; i < sources.length; i++) {
        const dist = creep.pos.getRangeTo(sources[i]);
        if (dist < bestDist) {
            best = sources[i];
            bestDist = dist;
        }
    }
    creep.memory.sourceId = best.id;
    return best;
}
/**
 * 查找 source 旁的 container（range <= 1）。
 *
 * P2 优化：缓存 containerId 到 creep.memory.sourceContainerId，
 * 避免每 tick 调用 lookForAtArea（0.05-0.1 CPU/次）。
 * 缓存失效条件：container 被摧毁（getObjectById 返回 null）。
 */
function findSourceContainer(creep, source) {
    // 优先使用缓存的 containerId。
    if (creep.memory.sourceContainerId) {
        const cached = getObjectById(creep.memory.sourceContainerId);
        if (cached) {
            // 验证仍在 source 旁（防御性：container 可能被回收后在别处重建）。
            if (cached.pos.getRangeTo(source.pos) <= 1)
                return cached;
        }
        // 缓存失效 — 清除并重新扫描。
        creep.memory.sourceContainerId = undefined;
    }
    // 首次或缓存失效：lookForAtArea 扫描 source 周围 3x3 区域。
    const structures = creep.room.lookForAtArea(LOOK_STRUCTURES, Math.max(0, source.pos.y - 1), Math.max(0, source.pos.x - 1), Math.min(49, source.pos.y + 1), Math.min(49, source.pos.x + 1), true);
    for (const entry of structures) {
        if (entry.structure.structureType === STRUCTURE_CONTAINER) {
            const container = entry.structure;
            // 缓存 containerId，后续 tick 直接用 getObjectById 取回。
            creep.memory.sourceContainerId = container.id;
            return container;
        }
    }
    return undefined;
}
/** 远矿采集 + 站桩倒能。 */
function remoteStationaryMine() {
    return {
        name: "remote-harvest:stationary-mine",
        resolve: (ac) => {
            const source = getRemoteSource(ac.creep);
            if (!source)
                return undefined;
            // 检查是否在采集范围内。
            if (ac.creep.pos.getRangeTo(source) > 1)
                return undefined;
            return source;
        },
        execute: (ac, source) => {
            // 采集。
            const harvestResult = ac.creep.harvest(source);
            if (harvestResult === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, source);
                return;
            }
            // 同 tick 倒能：如果背包有能量且旁边有 container，倒入 container。
            if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                const container = findSourceContainer(ac.creep, source);
                if (container) {
                    const freeCap = container.store.getFreeCapacity(RESOURCE_ENERGY);
                    if (freeCap > 0) {
                        ac.creep.transfer(container, RESOURCE_ENERGY);
                    }
                }
            }
        },
    };
}
/** 移动到 source 并采集（未到达站桩位时）。 */
function remoteHarvestSource() {
    return {
        name: "remote-harvest:move-and-mine",
        resolve: (ac) => getRemoteSource(ac.creep),
        execute: (ac, source) => {
            const result = ac.creep.harvest(source);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, source);
            }
            else if (result === ERR_NOT_ENOUGH_RESOURCES) {
                ac.creep.memory.mode = "idle";
            }
        },
    };
}
/** 采满且无 container 时 drop 能量（避免产能停滞）。 */
function dropEnergy() {
    return {
        name: "remote-harvest:drop",
        resolve: (ac) => {
            if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                return undefined;
            // 检查旁边是否有 container 可倒入。
            const source = getRemoteSource(ac.creep);
            if (source) {
                const container = findSourceContainer(ac.creep, source);
                if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    return { type: "transfer", container };
                }
            }
            // 无 container 或 container 满 → drop
            return { type: "drop" };
        },
        execute: (ac, resolved) => {
            if (resolved.type === "transfer") {
                ac.creep.transfer(resolved.container, RESOURCE_ENERGY);
            }
            else {
                ac.creep.drop(RESOURCE_ENERGY);
            }
        },
    };
}
const policy$5 = {
    acquire: [
        // 站桩采集 + 同 tick 倒能（到达矿位后）。
        remoteStationaryMine(),
        // 移动到 source 并采集（通勤中）。
        remoteHarvestSource(),
    ],
    work: [
        // 站桩采集 + 同 tick 倒能（work 模式也继续采）。
        remoteStationaryMine(),
        // 采满无处倒 → drop 释放产能。
        dropEnergy(),
    ],
};
const remoteHarvesterRole = defineRole("remoteHarvester", 1, policy$5);

/** 从远矿 container 取能。 */
function withdrawRemoteContainer() {
    return {
        name: "remote-hauler:withdraw-container",
        resolve: (ac) => {
            // 只在 remoteTarget 房间内执行（ensureHome 保证已到达）。
            const remoteTarget = ac.creep.memory.remoteTarget;
            if (!remoteTarget || ac.creep.room.name !== remoteTarget)
                return undefined;
            return findRemoteContainer(ac.creep);
        },
        execute: (ac, container) => {
            const available = container.store.getUsedCapacity(RESOURCE_ENERGY);
            const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
            const amount = Math.min(available, carryFree);
            if (amount <= 0) {
                // container 空了 → 检查地上是否有 drop 的能量。
                const dropped = findDroppedEnergy(ac.creep);
                if (dropped) {
                    const result = ac.creep.pickup(dropped);
                    if (result === ERR_NOT_IN_RANGE) {
                        moveToTarget(ac.creep, dropped);
                    }
                }
                return;
            }
            const result = ac.creep.withdraw(container, RESOURCE_ENERGY, amount);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, container);
            }
        },
    };
}
/** 拾取远矿房地上掉落的能量（remoteHarvester drop 的）。 */
function pickupRemoteDropped() {
    return {
        name: "remote-hauler:pickup-dropped",
        resolve: (ac) => {
            const remoteTarget = ac.creep.memory.remoteTarget;
            if (!remoteTarget || ac.creep.room.name !== remoteTarget)
                return undefined;
            return findDroppedEnergy(ac.creep);
        },
        execute: (ac, dropped) => {
            const result = ac.creep.pickup(dropped);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, dropped);
            }
        },
    };
}
/** 在远矿房查找有能量的 container（双层缓存避免每 tick find）。
 *
 * 第一层 per-creep：remoteContainerId 仍有能量时直接复用。
 * 第二层 per-tick per-room 共享：container 空窗期内，若无共享缓存，
 * 每只 remoteHauler 每 tick 会各自全房 FIND_STRUCTURES，
 * 违反「角色禁止全房 find」硬约束（与 findDroppedEnergy 同一约束、同一模式）。
 * 导出仅供接线测试验证共享缓存行为。
 */
function findRemoteContainer(creep) {
    // 优先使用缓存的 containerId — 避免每 tick room.find。
    if (creep.memory.remoteContainerId) {
        const cached = Game.getObjectById(creep.memory.remoteContainerId);
        if (cached && cached.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            return cached;
        }
        // 缓存失效 — container 被摧毁或空了，清除并重新 find。
        creep.memory.remoteContainerId = undefined;
    }
    // 首次或缓存失效：走 per-tick per-room 共享列表（同房多 hauler 一次 find）。
    const g = globalCache();
    if (!g.__remoteContainers)
        g.__remoteContainers = {};
    const roomCached = g.__remoteContainers[creep.room.name];
    let containers;
    if (roomCached && roomCached.tick === Game.time) {
        containers = roomCached.list;
    }
    else {
        containers = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                s.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
        });
        g.__remoteContainers[creep.room.name] = { tick: Game.time, list: containers };
    }
    if (containers.length === 0)
        return undefined;
    const closest = (creep.pos.findClosestByRange(containers) ?? containers[0]);
    // 缓存 containerId，后续 tick 直接用 getObjectById 取回。
    creep.memory.remoteContainerId = closest.id;
    return closest;
}
/** 在远矿房查找最近的掉落能量。
 *
 * 掉落资源列表走 per-tick per-room 缓存：远矿房无 RoomSnapshot 预热，
 * 若每 tick 直接 room.find，container 空档期内 acquire 链每 tick 都会全房扫描，
 * 违反「角色禁止全房 find」硬约束。缓存生命周期单 tick，同房多 hauler 共享。
 */
function findDroppedEnergy(creep) {
    const g = globalCache();
    if (!g.__remoteDropped)
        g.__remoteDropped = {};
    const cached = g.__remoteDropped[creep.room.name];
    let resources;
    if (cached && cached.tick === Game.time) {
        resources = cached.list;
    }
    else {
        resources = creep.room.find(FIND_DROPPED_RESOURCES, {
            filter: (r) => r.resourceType === RESOURCE_ENERGY,
        });
        g.__remoteDropped[creep.room.name] = { tick: Game.time, list: resources };
    }
    if (resources.length === 0)
        return undefined;
    return creep.pos.findClosestByRange(resources) ?? resources[0];
}
const policy$4 = {
    park: true,
    acquire: [
        // 优先从 container 取能。
        withdrawRemoteContainer(),
        // 回退：拾取地上 drop 的能量。
        pickupRemoteDropped(),
    ],
    work: [
        // 存入 storage（RCL4+）。
        fillStorage(),
        // 回退：直送 spawn/extension。
        haulFillTarget(),
        // 所有 sink 满 — 待命（ensureHome 会导航回 home，parkIdleCreep 归位）。
    ],
};
const remoteHaulerRole = defineRole("remoteHauler", 1, policy$4);

/** 在 remoteTarget 房间内查找并攻击 hostile creep。 */
function attackHostileAction() {
    return {
        name: "remote-defender:attack-hostile",
        resolve: (ac) => {
            // 只在 remoteTarget 房间内执行。
            const remoteTarget = ac.creep.memory.remoteTarget;
            if (!remoteTarget || ac.creep.room.name !== remoteTarget)
                return undefined;
            // 查找 hostile creep（过滤联盟白名单）。
            const hostiles = ac.creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => {
                    const allies = CONFIG.defense.allies;
                    return !allies.includes(c.owner.username);
                },
            });
            if (hostiles.length === 0)
                return undefined;
            // 选最近的 hostile。
            return ac.creep.pos.findClosestByRange(hostiles) ?? hostiles[0];
        },
        execute: (ac, target) => {
            const result = ac.creep.attack(target);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, target);
            }
        },
    };
}
const policy$3 = {
    // 战斗角色 — 豁免 flee 检测，否则到达远矿房看到敌人立刻逃回 home，
    // 攻击候选永远轮不到执行。
    combat: true,
    acquire: [
        attackHostileAction(),
    ],
    work: [
        // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
        attackHostileAction(),
    ],
};
const remoteDefenderRole = defineRole("remoteDefender", 1, policy$3);

/**
 * 检测房间是否被 InvaderCore 占据（per-tick per-room 共享缓存）。
 *
 * InvaderCore 持续为 controller 续期预约（每 tick +2），reserver 的
 * attackController 每次仅 -1（1 CLAIM）— 永远磨不过，留守是纯空耗。
 * 检测到核心即放弃动作，role-runner 走 idle → ensureHome 导航回 home；
 * 孵化冻结与回收由 remote-mining-manager 负责，此处是其 10-tick
 * 评估间隔内的即时兜底。缓存单 tick 生命周期，同房多 creep 共享一次 find。
 * 导出供接线测试验证检测与缓存行为。
 */
function roomHasInvaderCore(room) {
    const g = globalCache();
    if (!g.__remoteInvaderCore)
        g.__remoteInvaderCore = {};
    const cached = g.__remoteInvaderCore[room.name];
    if (cached && cached.tick === Game.time)
        return cached.blocked;
    const cores = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
    });
    const blocked = cores.length > 0;
    g.__remoteInvaderCore[room.name] = { tick: Game.time, blocked };
    return blocked;
}
/** 占领/攻击 controller。 */
function reserveControllerAction() {
    return {
        name: "reserver:reserve-controller",
        resolve: (ac) => {
            // 只在 remoteTarget 房间内执行。
            const remoteTarget = ac.creep.memory.remoteTarget;
            if (!remoteTarget || ac.creep.room.name !== remoteTarget)
                return undefined;
            // 房间必须有 controller。
            const controller = ac.creep.room.controller;
            if (!controller)
                return undefined;
            // InvaderCore 压制房：放弃动作 — attackController 磨不过核心续期，
            // 返回 undefined 走 idle → 回 home 等待回收，不在此空耗寿命。
            if (roomHasInvaderCore(ac.creep.room))
                return undefined;
            return controller;
        },
        execute: (ac, controller) => {
            // controller 有主且非自己 → 攻击 controller（降级敌方控制）。
            if (controller.owner && !controller.my) {
                const result = ac.creep.attackController(controller);
                if (result === ERR_NOT_IN_RANGE) {
                    moveToTarget(ac.creep, controller);
                }
                return;
            }
            // 尝试预定。
            const result = ac.creep.reserveController(controller);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, controller);
            }
            else if (result === ERR_INVALID_TARGET) {
                // controller 被其他玩家/Invader 预定 → attackController 降低其预定期。
                // reserveController 在 controller 已被其他玩家预定时返回 ERR_INVALID_TARGET。
                // attackController 有 1000 tick cooldown（cooldown 中返回 ERR_TIRED），
                // 每次成功攻击降低 1 tick reservation — 缓慢但持续消耗敌方预定。
                const attackResult = ac.creep.attackController(controller);
                if (attackResult === ERR_NOT_IN_RANGE) {
                    moveToTarget(ac.creep, controller);
                }
                // ERR_TIRED = cooldown 中，等待下一 tick 再试。
            }
        },
    };
}
const policy$2 = {
    acquire: [
        reserveControllerAction(),
    ],
    work: [
        // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
        reserveControllerAction(),
    ],
};
const reserverRole = defineRole("reserver", 2, policy$2);

/**
 * Upgrader — P2 升级角色。
 *
 * 策略声明：
 *   gate:    能量地板门禁（仅阻止 acquire，不阻止 work）；紧急防降级覆盖
 *   acquire: 身边掉落能量 > controller link > controller container > storage(动态限量) > 最满非物流 container > harvest
 *   work:    升级控制器
 *
 * 站桩升级核心：upgrader 站在 controller 旁，从 link/container 取能 + 升级，0 通勤。
 * P1-1: storage 取能上限按水位动态缩放 — 高水位时放开上限加速消化库存，
 * 低水位时收紧防止 storage 突降触发 economyPressure 连锁降级。
 */
/** upgrader 视为「已在站桩位」的最大距离（controller container/controller 周边）。 */
const STATION_RANGE = 3;
/**
 * 空闲归站 — 不在站桩位附近时移动过去待命。
 *
 * 根因：acquire 链全部落空（controller container 存在但空、无 link、storage
 * 低水位、gate 拦截直采）时，role-runner 置 idle 且 upgrader 被 parking 排除
 * （parking.ts 明文豁免站桩角色）→ 刚孵化的 upgrader 石化在 spawn 出口挡路。
 * 「站桩角色的 idle 是守在 controller 旁」这个前提只有 creep 已经在站桩位才成立。
 *
 * 该动作作为 acquire 链兜底：已在站桩位 → resolve undefined（正常 idle 等补给）；
 * 不在 → 移动过去。到位后 hauler 一填 container 立即取能开工，零通勤延迟。
 */
function moveToStation() {
    return {
        name: "move:controller-station",
        resolve: (ac) => resolveStationAnchor(ac),
        execute: (ac, anchor) => {
            moveToTarget(ac.creep, anchor);
        },
    };
}
/** 解析站桩锚点；已在站桩位或无锚点时返回 undefined。 */
function resolveStationAnchor(ac) {
    // 站桩锚点：controller container 优先（真正的取能位），无则己方 controller 本体。
    const ctrl = ac.snapshot.controller;
    const anchor = ac.snapshot.controllerContainer ?? (ctrl?.my ? ctrl : undefined);
    if (!anchor)
        return undefined;
    if (ac.creep.pos.getRangeTo(anchor.pos) <= STATION_RANGE)
        return undefined;
    return anchor;
}
/** gate 拦截路径的归站副作用 — 不在站桩位时移动过去（与 builderGate 的副作用先例一致）。 */
function nudgeToStation(ac) {
    const anchor = resolveStationAnchor(ac);
    if (anchor)
        moveToTarget(ac.creep, anchor);
}
/**
 * 能量地板门禁 — 仅阻止 acquire 模式取能，不阻止已满载的 upgrader 交付。
 * 紧急状态（ticksToDowngrade < threshold）时豁免。
 *
 * 关键修复：门禁只在 upgrader 需要直接采集时才阻止。
 * 如果 controller container / 任何 container 有能量，upgrader 不与 spawn 竞争，
 * 不应被 energyAvailable 地板阻止。
 */
function upgraderGate(ac) {
    const controller = ac.snapshot.controller;
    const isEmergency = controller != null &&
        controller.my &&
        controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold;
    if (isEmergency)
        return true; // 紧急：不阻止
    // 仅阻止 acquire 模式。
    if (ac.creep.memory.mode !== "acquire")
        return true;
    // 如果有替代能量源（非 source container / link 有能量），upgrader 不与 spawn 竞争，放行。
    // P0-3：仅检查非 source container — upgrader 不再从 source container 取能，
    // 若只有 source container 有能量，upgrader 会落到 harvestSource 与 spawn 竞争。
    // 注意：storage 不在此列 — storage 低于 floor 时正是要保护它不被 upgrader 抽干。
    const hasNonSourceContainerEnergy = ac.snapshot.containers.some(c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
        !ac.snapshot.sources.some(s => c.pos.getRangeTo(s.pos) <= 1));
    const hasLinkEnergy = ac.snapshot.links.some(l => l.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
    if (hasNonSourceContainerEnergy || hasLinkEnergy)
        return true;
    // 无替代能量源 — upgrader 只能直接采集，此时用能量地板门禁防止与孵化竞争。
    const hasStorage = ac.snapshot.storage !== undefined;
    const belowFloor = ac.snapshot.rcl >= 4 && hasStorage
        ? ac.snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.economy.upgradeEnergyFloorStorage
        : ac.snapshot.energyAvailable < Math.min(CONFIG.economy.upgradeEnergyFloor, Math.floor(ac.snapshot.energyCapacityAvailable * 0.4));
    if (belowFloor) {
        // 门禁拦截前先归站：gate 返回 false 会直接 idle（不走 acquire 链的归站兜底），
        // 刚孵化的 upgrader 会石化在 spawn 出口挡路。移动到站桩位再 idle —
        // 能量恢复后零通勤开工，等待期间也不占用核心区交通格。
        nudgeToStation(ac);
        return false;
    }
    return true;
}
/**
 * P1-1: 动态计算 storage 取能上限 — 按 storage 水位缩放。
 *
 * - 高水位 (>50%)：放开到 carry 满载（库存盈余应被快速消化）
 * - 中水位 (15%-50%)：用固定配置值（平衡消化速度与突降风险）
 * - 低水位 (<15%)：收紧到 200（保护 storage 触发 economyPressure 连锁降级）
 */
function dynamicStorageLimit(ac) {
    const st = ac.snapshot.storage;
    if (!st)
        return CONFIG.economy.upgrade.perTickWithdrawLimit;
    const energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
    const capacity = st.store.getCapacity(RESOURCE_ENERGY);
    if (capacity === 0)
        return CONFIG.economy.upgrade.perTickWithdrawLimit;
    const ratio = energy / capacity;
    if (ratio > 0.5)
        return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
    if (ratio > 0.15)
        return CONFIG.economy.upgrade.perTickWithdrawLimit;
    return 200;
}
const policy$1 = {
    gate: upgraderGate,
    acquire: [
        // 0. 拾取身边的掉落能量（range<=2，不离开站桩位）。
        pickupNearbyDroppedEnergy(2),
        // 1. controller 旁 link（0 通勤，link 瞬移供能）。
        withdrawControllerLink(),
        // 2. controller 旁 container（0 通勤）。
        withdrawControllerContainer(),
        // 3. storage（动态限量取能 — 按 storage 水位缩放，防止突降触发 economyPressure 连锁降级）。
        // P1-1: 高水位(>50%)时放开到 carry 满载；低水位(<15%)时收紧到 200，中间用固定值。
        withdrawStorageCapped(dynamicStorageLimit),
        // 4. 最满非物流 container（不抢 hauler 的物流源）。
        withdrawRichestNonSourceContainer(),
        // 5. 兜底：所有 container 无能量时直接采集。
        harvestSource(),
        // 6. 归站兜底：取能全部落空（container 空、source 占满等）时移动到
        //    controller 站桩位待命，而不是石化在 spawn 出口挡路。
        moveToStation(),
    ],
    work: [
        upgradeController(),
    ],
};
const upgraderRole = defineRole("upgrader", 2, policy$1);

/** 向 assignment 指定的 target 送能。 */
function fillAssignmentTarget() {
    return {
        name: "fill:assignment-target",
        resolve: (ac) => {
            if (!ac.assignment?.targetId)
                return undefined;
            const target = getObjectById(ac.assignment.targetId);
            return target ?? undefined;
        },
        execute: (ac, t) => {
            const result = ac.creep.transfer(t, RESOURCE_ENERGY);
            if (result === ERR_NOT_IN_RANGE) {
                moveToTarget(ac.creep, t);
            }
            else if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES) {
                const used = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
                if (used === 0)
                    ac.creep.memory.mode = "acquire";
            }
        },
    };
}
const policy = {
    park: true,
    acquire: [
        // 拾取地上掉落能量（衰减资源，优先于采集）。
        pickupDroppedEnergy(),
        // 采集 — getSource 公平份额分配（含拥挤迁移），source 分配统一入口。
        harvestSource(),
    ],
    work: [
        // 优先使用 assignment 指定的 target。
        fillAssignmentTarget(),
        // 紧急：修复血量 < 50% 的关键结构（spawn/tower/extension/container）。
        // P0 修复：worker 被 kernel 计入 repairRooms，必须有实际 repair action 才名副其实。
        // 优先于 fill — 结构快塌了比填能量更紧急。
        repairCritical(),
        // 回退到最近 fillTarget。
        fillTarget(),
        // 无填充目标 — 升级。
        upgradeController(),
    ],
};
const workerRole = defineRole("worker", 0, policy);

/**
 * Ring Buffer — 固定容量环形缓冲区。
 *
 * 设计意图：Screeps 的 RawMemory segment 有 100KB 上限 [Facts]，
 * 时序数据和事件日志必须在固定空间内循环覆盖最老数据。
 *
 * 纯数据结构 — 不依赖 Game/Memory/global，可独立 Vitest 测试。
 * 序列化友好：JSON.stringify 后是 { d: [...], h: number, c: number } 结构，
 * 反序列化后可直接恢复操作。
 */
/** 创建一个容量为 capacity 的空环形缓冲区。 */
function createRingBuffer(capacity) {
    return { d: new Array(capacity), h: 0, c: 0 };
}
/** 向缓冲区推入一条数据。满则覆盖最老数据。 */
function ringPush(buf, entry) {
    buf.d[buf.h] = entry;
    buf.h = (buf.h + 1) % buf.d.length;
    if (buf.c < buf.d.length)
        buf.c++;
}
/** 按时间顺序返回所有有效数据（最老在前）。 */
function ringToArray(buf) {
    if (buf.c === 0)
        return [];
    const cap = buf.d.length;
    const result = [];
    // 如果缓冲区未满，head 指针之前的都是有效数据（从 0 到 head-1）。
    // 如果缓冲区已满，head 指向最老的数据（它将被下一次 push 覆盖）。
    const start = buf.c < cap ? 0 : buf.h;
    for (let i = 0; i < buf.c; i++) {
        const idx = (start + i) % cap;
        const val = buf.d[idx];
        // 同时过滤 undefined 和 null：
        // JSON.stringify 将 undefined 转为 null，反序列化后 null 残留在 d 数组中。
        // 旧裁剪逻辑可能留下 undefined 空洞，经 segment 往返后变为 null。
        if (val != null)
            result.push(val);
    }
    return result;
}

/**
 * Segment Store — RawMemory segment 的类型安全读写层。
 *
 * 设计原则：
 *   - 热数据留 Memory（每 tick 自动序列化），冷数据存 segment（按需加载）。
 *   - 读取走 globalCache 缓存（global reset 后从 RawMemory.segments 重建）。
 *   - 写入标记 dirty，tick 末尾统一 flush（避免多次 JSON.stringify）。
 *   - segment 需要在 tick 开始时通过 requestSegments() 声明激活。
 *
 * Segment 分配表：
 *   0 — layout 冷数据（overrides / blocked per room）
 *   1 — CPU 时序环形缓冲 + 人口普查快照（~52KB，远低于 100KB 上限）
 *   2 — 事件日志环形缓冲（Phase/Tier/ColonyState 转换等离散事件）
 *   3 — 经济时序环形缓冲（~28KB，远低于 100KB 上限）
 *   4-9 — 预留（多房间 intel / market / 路径缓存）
 *
 * 旧版将 CPU + Economy 混存于 segment 1，满载 ~81KB，逼近 100KB 上限。
 * 拆分后每个 segment 独立远低于上限，彻底消除溢出风险。
 * 激活 4 个 segment 仍在 10 个上限内 [Facts]。
 */
// ─── Segment ID 常量 ────────────────────────────────────────
const SEGMENT_LAYOUT = 0;
const SEGMENT_CPU = 1;
const SEGMENT_EVENT_LOG = 2;
const SEGMENT_ECONOMY = 3;
// ─── 容量常量 ───────────────────────────────────────────────
/** CPU 时序环形缓冲容量（每 10 tick 采样 → 300 条 = 3000 tick 窗口）。 */
const CPU_RING_CAPACITY = 300;
/** 经济时序环形缓冲容量（每 50 tick 采样 → 200 条 = 10000 tick 窗口）。 */
const ECONOMY_RING_CAPACITY = 200;
/** 事件日志环形缓冲容量（保留最近 500 条事件）。 */
const EVENT_RING_CAPACITY = 500;
function segCache() {
    const g = globalCache();
    if (!g.__segStore)
        g.__segStore = {};
    return g.__segStore;
}
/**
 * P1-2 可用性守卫：判断 segment 数据本 tick 是否尚不可读。
 *
 * setActiveSegments 下一 tick 才生效 [Facts] — global reset 后的首 tick，
 * RawMemory.segments[N] 为 undefined（未激活），并非 segment 真的没有数据。
 * 此时若照常创建空结构并缓存，采样/写入会把空数据 flush 回 RawMemory，
 * **整体覆盖历史 segment**（时序清零、layout 冷数据丢失）。
 *
 * 判定：raw 为 undefined 且本 tick 恰是首次请求激活的 tick（requestedAt === Game.time）。
 * 从下一 tick 起 undefined 视为「segment 从未写入」（全新服务器），照常初始化 —
 * 避免把真空 segment 误判为未加载而永久阻塞写入。
 * 未调用过 requestSegments 的环境（单元测试）requestedAt 为 undefined，守卫不生效。
 */
function segmentUnavailable(segmentId) {
    return (RawMemory.segments[segmentId] === undefined &&
        segCache().requestedAt === Game.time);
}
/**
 * layout segment 本 tick 是否可安全读写 — 供依赖 segment 的迁移做就绪门禁。
 * reset 首 tick segment 未加载时返回 false，迁移链应在此中断、下 tick 重试，
 * 否则迁移数据会被写进 readLayoutSegment 返回的临时空结构后随源字段删除而丢失。
 */
function layoutSegmentReady() {
    return !segmentUnavailable(SEGMENT_LAYOUT);
}
// ─── 公共 API ───────────────────────────────────────────────
/**
 * 在 tick 开始时调用 — 声明需要激活的 segment。
 * 激活 4 个 segment（layout + cpu + eventLog + economy）在 10 个上限内 [Facts]。
 */
function requestSegments() {
    const cache = segCache();
    if (cache.requested)
        return;
    cache.requested = true;
    cache.requestedAt = Game.time;
    RawMemory.setActiveSegments([
        SEGMENT_LAYOUT,
        SEGMENT_CPU,
        SEGMENT_EVENT_LOG,
        SEGMENT_ECONOMY,
    ]);
}
/**
 * 读取 layout segment 数据（带缓存）。
 * 首次调用时从 RawMemory.segments 解析；global reset 后自动重建。
 */
function readLayoutSegment() {
    const cache = segCache();
    if (cache.layout)
        return cache.layout;
    // reset 后首 tick segment 未加载 — 返回临时空结构且不缓存，
    // flush 因 cache.layout 为空跳过写入，防止空数据覆盖历史 segment。
    if (segmentUnavailable(SEGMENT_LAYOUT))
        return {};
    const raw = RawMemory.segments[SEGMENT_LAYOUT];
    if (raw) {
        try {
            cache.layout = JSON.parse(raw);
        }
        catch {
            cache.layout = {};
        }
    }
    else {
        cache.layout = {};
    }
    return cache.layout;
}
/**
 * 获取指定房间的 layout 冷数据。不存在时自动创建空条目。
 */
function getRoomLayoutData(roomName) {
    const data = readLayoutSegment();
    if (!data[roomName]) {
        data[roomName] = { overrides: {}, blocked: {} };
    }
    return data[roomName];
}
/** 标记 layout segment 为 dirty — tick 末尾 flush 时写回 RawMemory。 */
function markLayoutDirty() {
    segCache().layoutDirty = true;
}
// ─── CPU segment (Segment 1) ───────────────────────────────
/**
 * 读取 CPU segment 数据（带缓存）。
 * 包含 CPU 时序环形缓冲 + 最新人口普查快照。
 *
 * 自动迁移：如果检测到旧格式（segment 1 包含 economy 字段），
 * 会将 economy 数据迁移到 segment 3 并清理 segment 1。
 */
function readCpuSegment() {
    const cache = segCache();
    if (cache.cpuSeg)
        return cache.cpuSeg;
    // reset 后首 tick segment 未加载 — 返回临时空结构且不缓存（见 segmentUnavailable）。
    if (segmentUnavailable(SEGMENT_CPU))
        return createEmptyCpuSegment();
    const raw = RawMemory.segments[SEGMENT_CPU];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.cpu) {
                // 检测旧格式（包含 economy 字段）— 触发迁移。
                if (parsed.economy && !cache.migrated) {
                    migrateLegacyTimeseries(parsed);
                    // 迁移已重建 cpuSeg，直接返回。
                    if (cache.cpuSeg)
                        return cache.cpuSeg;
                }
                // 非迁移路径：清理可能残留的 null 空洞（JSON 往返后 undefined → null）。
                cache.cpuSeg = {
                    cpu: rebuildRingBuffer(parsed.cpu, CPU_RING_CAPACITY),
                    population: parsed.population,
                };
            }
            else {
                cache.cpuSeg = createEmptyCpuSegment();
            }
        }
        catch {
            cache.cpuSeg = createEmptyCpuSegment();
        }
    }
    else {
        cache.cpuSeg = createEmptyCpuSegment();
    }
    return cache.cpuSeg;
}
/** 标记 CPU segment 为 dirty — tick 末尾 flush 时写回。 */
function markCpuDirty() {
    segCache().cpuDirty = true;
}
/** 创建带空环形缓冲区的初始 CPU segment 数据。 */
function createEmptyCpuSegment() {
    return {
        cpu: createRingBuffer(CPU_RING_CAPACITY),
    };
}
// ─── Economy segment (Segment 3) ───────────────────────────
/**
 * 读取经济 segment 数据（带缓存）。
 * 包含经济时序环形缓冲（按房间混合，每 50 tick 一条）。
 *
 * 自动迁移：首次读取时如果 segment 3 为空，
 * 会尝试从旧 segment 1 中提取 economy 数据。
 */
function readEconomySegment() {
    const cache = segCache();
    if (cache.economySeg)
        return cache.economySeg;
    // reset 后首 tick segment 未加载 — 返回临时空结构且不缓存（见 segmentUnavailable）。
    if (segmentUnavailable(SEGMENT_ECONOMY))
        return createEmptyEconomySegment();
    // 触发迁移检查（如果 segment 1 有旧格式数据）。
    if (!cache.migrated) {
        const raw1 = RawMemory.segments[SEGMENT_CPU];
        if (raw1) {
            try {
                const parsed = JSON.parse(raw1);
                if (parsed && parsed.economy) {
                    // 旧格式 — 迁移 economy 到 segment 3。
                    migrateLegacyTimeseries(parsed);
                    // 迁移函数已设置 cache.economySeg。
                    if (cache.economySeg)
                        return cache.economySeg;
                }
            }
            catch {
                // segment 1 损坏 — 走正常初始化。
            }
        }
    }
    const raw3 = RawMemory.segments[SEGMENT_ECONOMY];
    if (raw3) {
        try {
            const parsed = JSON.parse(raw3);
            if (parsed && parsed.economy) {
                // 清理可能残留的 null 空洞。
                cache.economySeg = {
                    economy: rebuildRingBuffer(parsed.economy, ECONOMY_RING_CAPACITY),
                };
            }
            else {
                cache.economySeg = createEmptyEconomySegment();
            }
        }
        catch {
            cache.economySeg = createEmptyEconomySegment();
        }
    }
    else {
        cache.economySeg = createEmptyEconomySegment();
    }
    return cache.economySeg;
}
/** 标记经济 segment 为 dirty — tick 末尾 flush 时写回。 */
function markEconomyDirty() {
    segCache().economyDirty = true;
}
/** 创建带空环形缓冲区的初始经济 segment 数据。 */
function createEmptyEconomySegment() {
    return {
        economy: createRingBuffer(ECONOMY_RING_CAPACITY),
    };
}
// ─── 迁移逻辑 ───────────────────────────────────────────────
/**
 * 将旧格式 segment 1（CPU + economy + population 混存）
 * 迁移到新格式：segment 1 仅保留 CPU + population，economy 迁移到 segment 3。
 *
 * 迁移是幂等的：如果已迁移则直接返回。
 * 迁移后立即标记两个 segment 为 dirty，在 tick 末尾 flush 时写入正确格式。
 */
function migrateLegacyTimeseries(legacy) {
    const cache = segCache();
    if (cache.migrated)
        return;
    cache.migrated = true;
    console.log("[segment] migrating legacy segment 1 → segment 1 (cpu) + segment 3 (economy)");
    // 重建 economy ring buffer — 过滤旧裁剪逻辑留下的 null/undefined 空洞。
    if (legacy.economy) {
        const cleanEconomy = rebuildRingBuffer(legacy.economy, ECONOMY_RING_CAPACITY);
        cache.economySeg = { economy: cleanEconomy };
        cache.economyDirty = true;
    }
    // 重建 cpu ring buffer — 同样过滤空洞。
    if (legacy.cpu) {
        const cleanCpu = rebuildRingBuffer(legacy.cpu, CPU_RING_CAPACITY);
        cache.cpuSeg = {
            cpu: cleanCpu,
            population: legacy.population,
        };
        cache.cpuDirty = true;
    }
}
/**
 * 从可能包含 null/undefined 空洞的旧 ring buffer 重建干净的新 ring buffer。
 * 保留所有有效数据和时间顺序。
 */
function rebuildRingBuffer(old, capacity) {
    const clean = createRingBuffer(capacity);
    const valid = ringToArray(old); // ringToArray 已过滤 null/undefined
    for (const item of valid) {
        ringPush(clean, item);
    }
    return clean;
}
// ─── 事件日志 segment (Segment 2) ───────────────────────────
/**
 * 读取事件日志 segment 数据（带缓存）。
 */
function readEventLogSegment() {
    const cache = segCache();
    if (cache.eventLog)
        return cache.eventLog;
    // reset 后首 tick segment 未加载 — 返回临时空结构且不缓存（见 segmentUnavailable）。
    if (segmentUnavailable(SEGMENT_EVENT_LOG)) {
        return { events: createRingBuffer(EVENT_RING_CAPACITY) };
    }
    const raw = RawMemory.segments[SEGMENT_EVENT_LOG];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed.events) {
                // 清理可能残留的 null 空洞。
                cache.eventLog = {
                    events: rebuildRingBuffer(parsed.events, EVENT_RING_CAPACITY),
                };
            }
            else {
                cache.eventLog = { events: createRingBuffer(EVENT_RING_CAPACITY) };
            }
        }
        catch {
            cache.eventLog = { events: createRingBuffer(EVENT_RING_CAPACITY) };
        }
    }
    else {
        cache.eventLog = { events: createRingBuffer(EVENT_RING_CAPACITY) };
    }
    return cache.eventLog;
}
/** 标记事件日志 segment 为 dirty — tick 末尾 flush 时写回。 */
function markEventLogDirty() {
    segCache().eventLogDirty = true;
}
// ─── Size guard ─────────────────────────────────────────────
/** 安全阈值：序列化体积超过此值时触发裁剪。 */
const SEGMENT_SIZE_LIMIT = 90 * 1024;
/** 裁剪时保留的比例。 */
const TRIM_KEEP_RATIO = 0.75;
/**
 * 裁剪环形缓冲区 — 保留最新的 keepCount 条数据，重建缓冲区。
 * O(c) 复杂度，对于 300 条目约 0.01ms。
 */
function trimRingBuffer(buf, keepCount) {
    if (keepCount <= 0)
        return createRingBuffer(buf.d.length);
    const all = ringToArray(buf);
    if (all.length <= keepCount)
        return buf;
    const keep = all.slice(all.length - keepCount);
    const newBuf = createRingBuffer(buf.d.length);
    for (const item of keep) {
        ringPush(newBuf, item);
    }
    return newBuf;
}
/**
 * 在 tick 末尾调用 — 将所有 dirty segment 刷写回 RawMemory。
 * 仅在有新写入时执行 JSON.stringify（避免无变化时的 CPU 浪费）。
 */
function flushSegments() {
    const cache = segCache();
    if (cache.layoutDirty && cache.layout) {
        RawMemory.segments[SEGMENT_LAYOUT] = JSON.stringify(cache.layout);
        cache.layoutDirty = false;
    }
    // CPU segment — 满载 ~52KB，远低于 100KB 上限。
    // 保留 size guard 作为 defense-in-depth。
    if (cache.cpuDirty && cache.cpuSeg) {
        let serialized = JSON.stringify(cache.cpuSeg);
        if (serialized.length > SEGMENT_SIZE_LIMIT) {
            cache.cpuSeg.cpu = trimRingBuffer(cache.cpuSeg.cpu, Math.floor(cache.cpuSeg.cpu.c * TRIM_KEEP_RATIO));
            serialized = JSON.stringify(cache.cpuSeg);
        }
        RawMemory.segments[SEGMENT_CPU] = serialized;
        cache.cpuDirty = false;
    }
    // Economy segment — 满载 ~28KB，远低于 100KB 上限。
    if (cache.economyDirty && cache.economySeg) {
        let serialized = JSON.stringify(cache.economySeg);
        if (serialized.length > SEGMENT_SIZE_LIMIT) {
            cache.economySeg.economy = trimRingBuffer(cache.economySeg.economy, Math.floor(cache.economySeg.economy.c * TRIM_KEEP_RATIO));
            serialized = JSON.stringify(cache.economySeg);
        }
        RawMemory.segments[SEGMENT_ECONOMY] = serialized;
        cache.economyDirty = false;
    }
    if (cache.eventLogDirty && cache.eventLog) {
        RawMemory.segments[SEGMENT_EVENT_LOG] = JSON.stringify(cache.eventLog);
        cache.eventLogDirty = false;
    }
}

/** 从版本 N 到 N+1 的迁移函数。每个必须幂等。
 * ready（可选）：迁移依赖的外部资源（如 RawMemory segment）是否就绪 —
 * 未就绪时迁移链在此中断，版本停在断点，下 tick 重试。 */
const MIGRATIONS = [
    {
        from: 0,
        to: 1,
        run: () => {
            Memory.creeps ?? (Memory.creeps = {});
            Memory.rooms ?? (Memory.rooms = {});
        },
    },
    {
        from: 1,
        to: 2,
        run: () => {
            // v2：添加 kernel 跟踪，确保房间有孵化/建造队列。
            Memory.kernel ?? (Memory.kernel = {});
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (!room)
                    continue;
                room.spawnQueue ?? (room.spawnQueue = []);
                room.buildQueue ?? (room.buildQueue = []);
                room.layout ?? (room.layout = {
                    version: 1,
                    templateId: "compact-core-v1",
                    state: "accepted",
                    revision: 0,
                    nextPlanTick: 0,
                });
            }
            // 迁移遗留 creep memory：从 working 标志设置 mode。
            for (const name in Memory.creeps) {
                const creep = Memory.creeps[name];
                if (creep && !creep.mode) {
                    creep.mode = creep.working ? "work" : "acquire";
                }
            }
        },
    },
    {
        from: 2,
        to: 3,
        run: () => {
            var _a, _b;
            // v3：扩展 LayoutMemory 添加 overrides 和 blocked 字段。
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (!room)
                    continue;
                if (room.layout) {
                    (_a = room.layout).overrides ?? (_a.overrides = {});
                    (_b = room.layout).blocked ?? (_b.blocked = {});
                }
            }
        },
    },
    {
        from: 3,
        to: 4,
        // 就绪门禁：reset 首 tick segment 未加载时 readLayoutSegment 返回不缓存的
        // 临时空结构 — 若照常迁移，overrides/blocked 会被写进临时对象后随 Memory
        // 删除而永久丢失。segment 就绪（下一 tick）后再执行。
        ready: () => layoutSegmentReady(),
        run: () => {
            // v4：将 layout 冷数据（overrides/blocked）从 Memory 迁移到 RawMemory segment 0。
            // 减少每 tick JSON.stringify(Memory) 的体积。
            const segData = readLayoutSegment();
            let migrated = false;
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (!room?.layout)
                    continue;
                const overrides = room.layout.overrides;
                const blocked = room.layout.blocked;
                if (overrides || blocked) {
                    segData[roomName] = {
                        overrides: overrides ?? {},
                        blocked: blocked ?? {},
                    };
                    delete room.layout.overrides;
                    delete room.layout.blocked;
                    migrated = true;
                }
            }
            if (migrated)
                markLayoutDirty();
        },
    },
    {
        from: 4,
        to: 5,
        run: () => {
            // v5：建档 CreepMemory.recycle? 与 RoomMemory.intel?（B1 回收通道 / C2 邻居情报）。
            // 两者均为可选字段，无需回填；此处仅做畸形数据自愈（幂等）。
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (!room)
                    continue;
                if (room.intel !== undefined && typeof room.intel !== "object") {
                    delete room.intel;
                }
            }
            for (const name in Memory.creeps) {
                const creep = Memory.creeps[name];
                if (!creep)
                    continue;
                if (creep.recycle !== undefined && typeof creep.recycle !== "boolean") {
                    delete creep.recycle;
                }
            }
        },
    },
    {
        from: 5,
        to: 6,
        run: () => {
            // v6：核心模板 compact-core-v1 → v2（偶校验棋盘格，修复全密封实心块）。
            // v1 的 cell 坐标全部作废：清理 buildQueue 中未开工的 core.* 任务
            // （site/done 的已建结构保留，不拆不改），版本号+1、revision+1 触发重规划。
            // 幂等：仅当 templateId 仍为 v1 时执行，重复运行不再递增 revision。
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (!room?.layout)
                    continue;
                if (room.layout.templateId === "compact-core-v2")
                    continue;
                room.layout.templateId = "compact-core-v2";
                room.layout.version = 2;
                room.layout.revision = (room.layout.revision ?? 0) + 1;
                room.layout.nextPlanTick = 0;
                if (Array.isArray(room.buildQueue)) {
                    room.buildQueue = room.buildQueue.filter(t => !(t.key.startsWith("core.") && (t.state === "queued" || t.state === "blocked")));
                }
            }
        },
    },
    {
        from: 6,
        to: 7,
        run: () => {
            // v7：添加参数自调优 Memory 结构（Memory.kernel.tuning）。
            // tuning 字段可选——tuning-engine 首次运行时自动初始化。
            // 此迁移仅做畸形数据自愈（幂等）：如果 tuning 存在但结构不完整，修正它。
            if (!Memory.kernel)
                Memory.kernel = {};
            if (Memory.kernel.tuning !== undefined) {
                // 确保必要子字段存在。
                const t = Memory.kernel.tuning;
                if (typeof t !== "object" || t === null) {
                    delete Memory.kernel.tuning;
                }
                else {
                    if (typeof t.lastTuned !== "number")
                        t.lastTuned = 0;
                    if (typeof t.rooms !== "object" || t.rooms === null)
                        t.rooms = {};
                    // lastEval 从 v7 早期的单对象格式迁移为 Record<string, {...}>。
                    // 旧格式有 room 字段，新格式以 room 为 key。
                    if (t.lastEval !== undefined && typeof t.lastEval === "object" && !Array.isArray(t.lastEval)) {
                        const oldEval = t.lastEval;
                        if (typeof oldEval.room === "string" && typeof oldEval.tick === "number") {
                            // 旧格式：单对象 { tick, room, adjustments, signals, skipped }
                            const room = oldEval.room;
                            const migrated = {};
                            migrated[room] = {
                                tick: oldEval.tick,
                                adjustments: oldEval.adjustments ?? [],
                                signals: oldEval.signals ?? {},
                                skipped: oldEval.skipped,
                            };
                            t.lastEval = migrated;
                        }
                        // 如果已经是 Record 格式（无 room 字段），保持不变。
                    }
                }
            }
        },
    },
    {
        from: 7,
        to: 8,
        run: () => {
            // v8：清除 CreepMemory.working 遗留字段。
            // v1→v2 迁移已将 working 转为 mode，但字段本身从未被删除。
            // 此迁移幂等地删除所有 creep 的 working 字段；
            // 如果 creep 没有 working 字段，delete 无副作用。
            for (const name in Memory.creeps) {
                const creep = Memory.creeps[name];
                if (creep && creep.working !== undefined) {
                    delete creep.working;
                }
            }
        },
    },
    {
        from: 8,
        to: 9,
        run: () => {
            // v9：方案 C 流动性维度 — 为每个房间的 phase 回填 liquidityScore 字段。
            // 旧 Memory 的 phase 无此字段；缺失时默认 0（不假定存在流动性危机，
            // 分数随后由 room-state 每 tick 从 spendableRatio/frozenRatio 实时信号累加）。
            // 幂等：仅当字段缺失时写入。
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (room?.phase && room.phase.liquidityScore === undefined) {
                    room.phase.liquidityScore = 0;
                }
            }
        },
    },
    {
        from: 9,
        to: 10,
        run: () => {
            // v10：远矿运营 — 为每个自有房间初始化 remoteOps 字段。
            // remoteOps 是可选字段，无需回填；此处仅做畸形数据自愈（幂等）。
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (!room)
                    continue;
                if (room.remoteOps !== undefined && typeof room.remoteOps !== "object") {
                    delete room.remoteOps;
                }
            }
            // 清理死亡 creep 的 remoteTarget 遗留（creep 死亡后 memory 已被清理，
            // 但防御性检查不伤害）。
            for (const name in Memory.creeps) {
                const creep = Memory.creeps[name];
                if (creep && creep.remoteTarget !== undefined && typeof creep.remoteTarget !== "string") {
                    delete creep.remoteTarget;
                }
            }
        },
    },
    {
        from: 10,
        to: 11,
        run: () => {
            // v11：扩张系统 — expansion / expansionBlacklist / lostRooms 均为
            // Memory.kernel 下的可选字段，惰性创建，无需回填；
            // 此处仅做畸形数据自愈（幂等）。
            const kernel = Memory.kernel;
            if (!kernel)
                return;
            if (kernel.expansion !== undefined && typeof kernel.expansion !== "object") {
                delete kernel.expansion;
            }
            if (kernel.expansionBlacklist !== undefined && typeof kernel.expansionBlacklist !== "object") {
                delete kernel.expansionBlacklist;
            }
            if (kernel.lostRooms !== undefined && typeof kernel.lostRooms !== "object") {
                delete kernel.lostRooms;
            }
        },
    },
    {
        from: 11,
        to: 12,
        run: () => {
            // v12：威胁情报与受袭记忆 — roomMem.lastHostileAt 与
            // intel 条目的 towers/dangerUntil 均为可选数字字段，惰性写入，
            // 无需回填；此处仅做畸形数据自愈（幂等）。
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (!room)
                    continue;
                if (room.lastHostileAt !== undefined && typeof room.lastHostileAt !== "number") {
                    delete room.lastHostileAt;
                }
                const intel = room.intel;
                if (!intel)
                    continue;
                for (const entry of Object.values(intel)) {
                    if (entry.towers !== undefined && typeof entry.towers !== "number") {
                        delete entry.towers;
                    }
                    if (entry.dangerUntil !== undefined && typeof entry.dangerUntil !== "number") {
                        delete entry.dangerUntil;
                    }
                }
            }
        },
    },
    {
        from: 12,
        to: 13,
        run: () => {
            // v13：帝国姿态 — kernel.strategy 为可选字段，empire-strategy 每 tick
            // 重建，无需回填；此处仅做畸形数据自愈（幂等）。
            const kernel = Memory.kernel;
            if (!kernel)
                return;
            if (kernel.strategy !== undefined && typeof kernel.strategy !== "object") {
                delete kernel.strategy;
            }
        },
    },
    {
        from: 13,
        to: 14,
        run: () => {
            // v14：相位驻留计数 — 为已有 phase 状态回填 bandTicks。
            // 缺失时按 0（未入危机带）处理；处于危机带的房间从 0 重新计驻留，
            // 最坏情况是本次危机多停留一个驻留窗口，安全方向的保守默认。
            // 幂等：仅当字段缺失时写入。
            for (const roomName in Memory.rooms) {
                const room = Memory.rooms[roomName];
                if (room?.phase && room.phase.bandTicks === undefined) {
                    room.phase.bandTicks = 0;
                }
            }
        },
    },
];
/**
 * 维护 Memory：执行版本化迁移、清理死亡 creep、初始化默认值。
 * 每 tick 开头调用一次。
 */
function maintainMemory() {
    var _a;
    const current = Memory.schemaVersion ?? 0;
    if (current < CONFIG.memory.schemaVersion)
        migrateMemory(current);
    // 确保根结构存在。
    Memory.creeps ?? (Memory.creeps = {});
    Memory.rooms ?? (Memory.rooms = {});
    Memory.kernel ?? (Memory.kernel = {});
    // 每 tick 清理死亡 creep memory（小帝国 — 安全且廉价）。
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
    // 确保每个自有房间有 RoomMemory 条目。
    const ownedRooms = new Set();
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room || !room.controller?.my)
            continue;
        ownedRooms.add(roomName);
        if (!Memory.rooms[roomName]) {
            Memory.rooms[roomName] = { spawnQueue: [], buildQueue: [] };
        }
        else {
            const rm = Memory.rooms[roomName];
            rm.spawnQueue ?? (rm.spawnQueue = []);
            rm.buildQueue ?? (rm.buildQueue = []);
        }
    }
    // 失守房间清理：Memory.rooms 中不再拥有的房间条目延迟清除。
    // 自有房恒有视野（结构提供视野），条目房不在拥有集合即为失守/放弃。
    // 宽限期防止 claim 边界抖动误删布局与队列数据；到期后连同
    // tuning 覆盖值一并清除，避免失守房数据永久滞留（慢性泄漏）。
    const LOST_ROOM_GRACE = 20000;
    (_a = Memory.kernel).lostRooms ?? (_a.lostRooms = {});
    const lostRooms = Memory.kernel.lostRooms;
    for (const roomName in Memory.rooms) {
        if (ownedRooms.has(roomName)) {
            if (lostRooms[roomName] !== undefined)
                delete lostRooms[roomName];
            continue;
        }
        const lostAt = lostRooms[roomName] ?? (lostRooms[roomName] = Game.time);
        if (Game.time - lostAt > LOST_ROOM_GRACE) {
            delete Memory.rooms[roomName];
            delete lostRooms[roomName];
            if (Memory.kernel.tuning?.rooms[roomName]) {
                delete Memory.kernel.tuning.rooms[roomName];
            }
            if (Memory.kernel.tuning?.lastEval?.[roomName]) {
                delete Memory.kernel.tuning.lastEval[roomName];
            }
        }
    }
}
/** 按升序执行迁移。每个迁移都是幂等的。
 *
 * 迁移链中断语义：某步的 ready() 未就绪时停在断点、保留当前版本，
 * 下 tick 从断点续跑 — 幂等性保证重复执行安全。
 * 版本号只随实际执行的迁移递增，不做无条件盖章：
 * 若未来 MIGRATIONS 出现断号，版本会停在缺口处暴露问题，
 * 而不是被盖章静默掩盖、永久丢失缺口步骤。
 */
function migrateMemory(currentVersion) {
    let version = currentVersion;
    for (const migration of MIGRATIONS) {
        if (version !== migration.from)
            continue;
        if (migration.ready && !migration.ready())
            break;
        migration.run();
        version = migration.to;
        Memory.schemaVersion = version;
    }
}
/**
 * 记录跳过原因，用于遥测和诊断。
 * 单 tick 内累加到 global 缓冲区，tick 末尾由 flushSkips 低频刷入 Memory，
 * 避免在 CPU 压力下产生频繁 Memory 写入。
 */
function recordSkip(reason) {
    const g = globalCache();
    if (!g.skipBuffer)
        g.skipBuffer = {};
    g.skipBuffer[reason] = (g.skipBuffer[reason] ?? 0) + 1;
    // 同时递增单 tick 遥测计数器。
    if (g.telemetry && g.telemetry.tick === Game.time) {
        g.telemetry.skipped++;
    }
}
/**
 * 将 global 中的 skipBuffer 刷入 Memory，并执行低频清理。
 * 由 Kernel 在 tick 末尾调用。
 */
function flushSkips() {
    const g = globalCache();
    if (!g.skipBuffer)
        return;
    if (!Memory.kernel)
        Memory.kernel = {};
    if (!Memory.kernel.skipReasons)
        Memory.kernel.skipReasons = {};
    for (const [reason, count] of Object.entries(g.skipBuffer)) {
        // 累加但设上限，防止数字溢出。
        const current = Memory.kernel.skipReasons[reason] ?? 0;
        Memory.kernel.skipReasons[reason] = Math.min(current + count, 100000);
    }
    g.skipBuffer = {};
    // 每 500 tick 重置统计窗口，保留最近数据，防止无限增长。
    if (Game.time % 500 === 0) {
        Memory.kernel.skipReasons = {};
    }
}

/** 各档位的 bucket 阈值（降级立即生效）。
 * 单一真相源：CONFIG.cpu.tiers[*].min — 此处仅做按档位索引的视图，
 * 避免 config 与 scheduler 双源漂移（调 config 不生效的静默陷阱）。 */
const TIER_BUCKET_MIN = {
    healthy: CONFIG.cpu.tiers.healthy.min,
    guarded: CONFIG.cpu.tiers.guarded.min,
    conserve: CONFIG.cpu.tiers.conserve.min,
    recovery: CONFIG.cpu.tiers.recovery.min,
};
/** 从高到低排列的档位顺序，用于扫描。 */
const TIER_ORDER = ["healthy", "guarded", "conserve", "recovery"];
/**
 * 根据 bucket 带滞回地确定 CPU 档位。
 *
 * 降级立即生效 — bucket 低时必须马上限流。
 * 升级需要 bucket 超过下一档阈值至少 `recoveryHysteresis`，
 * 并持续 `recoveryTicks` 个 tick，避免频繁抖动。
 *
 * @param voluntaryDrain 自愿放血宽限（generatePixel 后的窗口期）：
 *   tier 地板抬到 conserve — pixel 清零 bucket 只损失突发容量，
 *   每 tick 限额不变，P2 经济角色不应被 recovery 档冻结。
 *   仅影响 recovery 判定；真实 CPU 超支仍由逐 tick 硬上限兜底。
 */
function resolveTier(prevTier, prevRecoveryTicks, bucket, voluntaryDrain = false) {
    const result = resolveTierNatural(prevTier, prevRecoveryTicks, bucket);
    // 自愿放血宽限：recovery 地板抬到 conserve。
    // 不影响 recoveryTicks 记账 — 滞回升级逻辑照常从真实档位爬升。
    if (voluntaryDrain && result.tier === "recovery") {
        return { tier: "conserve", recoveryTicks: result.recoveryTicks };
    }
    return result;
}
function resolveTierNatural(prevTier, prevRecoveryTicks, bucket) {
    // 根据 bucket 确定自然档位（降级立即生效）。
    const naturalTier = bucketToTier(bucket);
    // 降级（更差的档位）立即生效。
    // tierRank: healthy=0 < guarded=1 < conserve=2 < recovery=3（数值越大越差）
    if (prevTier === undefined || tierRank$1(naturalTier) >= tierRank$1(prevTier)) {
        return { tier: naturalTier, recoveryTicks: 0 };
    }
    // 升级（更好的档位）：逐步升级并带滞回。
    // 目标是当前档位的上一档（而非自然档位）。
    const currentRank = tierRank$1(prevTier);
    const targetTier = TIER_ORDER[currentRank - 1] ?? naturalTier;
    const hysteresisThreshold = TIER_BUCKET_MIN[targetTier] + CONFIG.cpu.tiers[prevTier].recoveryHysteresis;
    if (bucket >= hysteresisThreshold) {
        const ticks = prevRecoveryTicks + 1;
        if (ticks >= CONFIG.cpu.tiers[prevTier].recoveryTicks) {
            return { tier: targetTier, recoveryTicks: 0 };
        }
        return { tier: prevTier, recoveryTicks: ticks };
    }
    // bucket 低于滞回阈值 — 重置恢复计数器。
    return { tier: prevTier, recoveryTicks: 0 };
}
function bucketToTier(bucket) {
    for (const tier of TIER_ORDER) {
        if (bucket >= TIER_BUCKET_MIN[tier])
            return tier;
    }
    return "recovery";
}
function tierRank$1(tier) {
    return TIER_ORDER.indexOf(tier);
}
/** 基于 Game.cpu 的具体 Budget 实现。 */
class CpuBudget {
    constructor(tier) {
        this.tier = tier;
        const limits = tierLimits(tier);
        // 有效硬上限：Game.cpu.limit 和 Game.cpu.tickLimit 的较小值减去安全余量。
        // tickLimit 可能临时低于 20。
        const cpuLimit = Math.min(Game.cpu.limit ?? 20, Game.cpu.tickLimit ?? 20);
        this.hardLimit = Math.min(limits.hard, cpuLimit - CONFIG.kernel.cpuReserve);
        this.softLimit = Math.min(limits.soft, this.hardLimit - 1);
    }
    canStart(priority) {
        if (this.isExhausted())
            return false;
        const max = tierMaxPriority(this.tier);
        if (priority > max)
            return false;
        // P0 始终尝试（必须保持廉价）。非 P0 遵守软上限。
        if (priority > 0 && this.spent() >= this.softLimit)
            return false;
        return true;
    }
    isExhausted() {
        return Game.cpu.getUsed() >= this.hardLimit;
    }
    spent() {
        return Game.cpu.getUsed();
    }
}
/** 为当前 tick 创建预算，并更新 Memory 中的档位跟踪。 */
function createBudget() {
    const bucket = Game.cpu.bucket ?? 10000;
    const prevTier = Memory.kernel?.tier;
    const prevTicks = Memory.kernel?.recoveryTicks ?? 0;
    // 自愿放血宽限：generatePixel 清零 bucket 后的窗口期内，
    // recovery 地板抬到 conserve（P2 经济角色照常运行）。
    const pixelAt = Memory.kernel?.pixelAt;
    const voluntaryDrain = pixelAt !== undefined && Game.time - pixelAt < CONFIG.cpu.pixelGraceTicks;
    const { tier, recoveryTicks } = resolveTier(prevTier, prevTicks, bucket, voluntaryDrain);
    // 持久化档位跟踪，供下一 tick 使用。
    if (!Memory.kernel)
        Memory.kernel = {};
    Memory.kernel.tier = tier;
    Memory.kernel.recoveryTicks = recoveryTicks;
    return new CpuBudget(tier);
}

/** 在 global 中初始化单 tick 遥测对象。 */
function initTelemetry(tick) {
    const g = globalCache();
    g.telemetry = {
        tick,
        systemCpu: {},
        roleCpu: {},
        skipped: 0,
        errors: 0,
    };
    // 初始化 per-tick 事件缓冲区 — 任意系统可通过 recordEvent() 写入，
    // telemetry-collector 在 tick 末尾 flush 到 segment 2。
    if (!g.eventBuffer) {
        g.eventBuffer = { events: [] };
    }
    else {
        // 上一 tick 的残留事件（如果 telemetry-collector 未运行，如 recovery tier）
        // 保留最多 50 条，防止无限增长。正常情况下 collector 每 10 tick flush。
        if (g.eventBuffer.events.length > 50) {
            g.eventBuffer.events = g.eventBuffer.events.slice(-50);
        }
    }
}
/** 输出轻量的 tick 末尾摘要。仅在有值得关注的内容时才记录日志。 */
function emitSummary(budget) {
    const g = globalCache();
    if (!g.telemetry)
        return;
    const t = g.telemetry;
    const totalCpu = Game.cpu.getUsed();
    const bucket = Game.cpu.bucket ?? 0;
    const topSystems = Object.entries(t.systemCpu)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    const parts = [
        `[${t.tick}] tier=${budget.tier} cpu=${totalCpu.toFixed(1)} bucket=${bucket}`,
    ];
    if (t.errors > 0)
        parts.push(`errors=${t.errors}`);
    if (t.skipped > 0)
        parts.push(`skipped=${t.skipped}`);
    for (const [name, cpu] of topSystems) {
        parts.push(`${name}=${cpu.toFixed(1)}`);
    }
    // 仅在 CPU 偏高或有错误时记录日志 — 避免健康 tick 的控制台刷屏。
    if (totalCpu > budget.softLimit * 0.8 || t.errors > 0) {
        console.log(parts.join(" "));
    }
}

/**
 * 威胁分类 — 纯函数，区分「威胁 creep」与「无害过客」。
 *
 * 背景（P0-2）：room.find(FIND_HOSTILE_CREEPS) 不区分 scout / reserver / 中立 /
 * 攻击单位。若直接当「有敌人」消费，一个路过的 scout 会同时触发全体逃跑、
 * 切 defense 状态、停建造、作废任务、误烧 safe mode，冻结整个经济。
 *
 * 判定原则：只有具备实际威胁部件的 creep 才算威胁。
 *   - ATTACK / RANGED_ATTACK：近战 / 远程攻击
 *   - HEAL：治疗（奶妈，配合攻击单位极危险）
 *   - WORK：拆迁（可拆墙 / 结构）
 *   - CLAIM：攻击控制器（downgrade / reserve 干扰）
 * 仅有 MOVE / CARRY / TOUGH 的 creep（典型 scout / reserver 空壳）不算威胁。
 *
 * 联盟白名单：owner 命中 allies 的 creep 一律视为非威胁。
 */
/** 具备任一即视为威胁的部件类型。 */
const THREAT_PARTS = [
    ATTACK,
    RANGED_ATTACK,
    HEAL,
    WORK,
    CLAIM,
];
/** 判断单个 creep 是否构成威胁。 */
function isThreat(input, allies) {
    if (allies.includes(input.owner))
        return false;
    return input.bodyParts.some(p => THREAT_PARTS.includes(p));
}
/** 从敌对 creep 列表中筛出真正的威胁 creep。 */
function classifyThreats(hostiles, allies) {
    return hostiles.filter(c => isThreat({ owner: c.owner.username, bodyParts: c.body.map(b => b.type) }, allies));
}

/**
 * 为单个自有房间构建 RoomSnapshot。
 * 这是每 tick 唯一调用 room.find() 的地方 — 所有系统和角色
 * 都消费快照以避免重复扫描。
 *
 * 成本：每房每 tick O(structures + sources + sites + hostiles)。
 * 必须保持廉价：此处不使用 PathFinder、lookAt 或地形扫描。
 *
 * @param globalSourceOccupancy 由 Kernel 预构建的全局 source 占用映射，
 *   避免每个房间独立遍历全部 Game.creeps。
 * @param globalCreepEnergy 由 Kernel 预构建的全局“房间 → creep 携带能量”映射（P1-5 ①）。
 * @param globalPendingHarvesters 由 Kernel 预构建的全局“房间 → 待计入 harvester”映射（P0-1）。
 */
function buildRoomSnapshot(room, globalSourceOccupancy, globalCreepEnergy, globalPendingHarvesters) {
    const myStructures = room.find(FIND_MY_STRUCTURES);
    const spawns = myStructures.filter(isSpawn);
    const extensions = myStructures.filter(isExtension);
    const towers = myStructures.filter(isTower);
    const links = myStructures.filter(isLink);
    const labs = myStructures.filter(isLab);
    // 一次 find 获取所有中性结构，在 JS 层按类型分组。
    // 比多次带 filter 的 find 更高效（减少 C++ ↔ JS 边界穿越）。
    const allStructures = room.find(FIND_STRUCTURES);
    const containers = allStructures.filter(s => s.structureType === STRUCTURE_CONTAINER);
    const roads = allStructures.filter(s => s.structureType === STRUCTURE_ROAD);
    const walls = allStructures.filter(s => s.structureType === STRUCTURE_WALL);
    const ramparts = allStructures.filter(s => s.structureType === STRUCTURE_RAMPART);
    const extractor = allStructures.find(s => s.structureType === STRUCTURE_EXTRACTOR);
    const factory = allStructures.find(s => s.structureType === STRUCTURE_FACTORY);
    const observer = allStructures.find(s => s.structureType === STRUCTURE_OBSERVER);
    const powerSpawn = allStructures.find(s => s.structureType === STRUCTURE_POWER_SPAWN);
    const storage = room.storage ?? undefined;
    const terminal = room.terminal ?? undefined;
    const sources = room.find(FIND_SOURCES);
    let minerals = [];
    try {
        minerals = room.find(FIND_MINERALS);
    }
    catch {
        // FIND_MINERALS 可能在测试环境未定义。
    }
    const allSites = room.find(FIND_CONSTRUCTION_SITES);
    const mySites = room.find(FIND_MY_CONSTRUCTION_SITES);
    const hostileCreeps = room.find(FIND_HOSTILE_CREEPS);
    // 威胁分级：仅具备攻击/治疗/拆迁/claim 部件且非联盟者才算威胁（P0-2）。
    const threatCreeps = classifyThreats(hostileCreeps, CONFIG.defense.allies);
    // 掉落资源：采集地上散落的能量（creep 死亡掉落、harvester 溢出等）。
    const droppedEnergy = room.find(FIND_DROPPED_RESOURCES).filter(r => r.resourceType === RESOURCE_ENERGY);
    // 遗留能量容器：坟墓（creep 死亡）与废墟（建筑被毁/拆除）。
    // 两者都在衰减/限时灭失，是 hauler 优先回收的对象。
    // try/catch 防御：FIND_TOMBSTONES/FIND_RUINS 可能在精简测试环境未定义。
    let tombstones = [];
    let ruins = [];
    try {
        tombstones = room.find(FIND_TOMBSTONES).filter(t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        ruins = room.find(FIND_RUINS).filter(r => r.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
    }
    catch {
        // 常量未定义的环境（旧测试 mock）— 视为无遗留资源。
    }
    // 探测 controller 旁 1 格内的 container — upgrader 站桩升级的能量来源。
    let controllerContainer;
    if (room.controller) {
        const cx = room.controller.pos.x;
        const cy = room.controller.pos.y;
        controllerContainer = containers.find(c => Math.abs(c.pos.x - cx) <= 1 && Math.abs(c.pos.y - cy) <= 1);
    }
    // 修复：tower 必须包含在 fillTargets 中，否则无 creep 给塔充能，RCL3+ 防御形同虚设。
    // controller container 也纳入 fillTargets — hauler 顺手补能，保证 upgrader 不断粮。
    const fillBase = [
        ...spawns,
        ...extensions,
        ...towers,
    ];
    if (controllerContainer)
        fillBase.push(controllerContainer);
    const fillTargets = fillBase.filter(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    // needsRecovery 仅基于 spawn 存在性；
    // 更精细的恢复判断由 Kernel.computeColonyState 负责（已统计 harvester 数量）。
    const needsRecovery = spawns.length === 0;
    // 资源占用：使用 Kernel 预构建的全局映射，或本房独立构建。
    const sourceOccupancy = new Map();
    for (const source of sources) {
        sourceOccupancy.set(source.id, globalSourceOccupancy?.get(source.id) ?? 0);
    }
    // ── 预热移动模块的结构缓存（P1-2：通过模块公开 API 写入，消除 as any 隐式耦合）──
    // movement.ts 的 ensureStructureCache 原本每房间每 tick 额外调用
    // room.find(FIND_STRUCTURES) + room.find(FIND_MY_CONSTRUCTION_SITES)。
    // 此处利用 snapshot 已采集的数据直接构建缓存，消除冗余 find。
    // ensureStructureCache 检测 checkedTick === Game.time 后直接返回，不再 find。
    preloadStructureCache(room.name, allStructures, mySites);
    // ── 预热静态占位缓存（方案 B：根治路径缓存撞墙）──
    // 站桩位置 = source 旁 range<=1 的 container（harvester 矿位）+ controllerContainer（upgrader 站桩位）。
    // pathfinding 的 roomCallback 读取并标 255，使 PathFinder 算路径时天然绕开站桩矿工。
    // 复用已采集的 containers/sources/controllerContainer，零额外 find。
    const staticBlockerPositions = [];
    for (const c of containers) {
        if (sources.some(s => c.pos.getRangeTo(s.pos) <= 1)) {
            staticBlockerPositions.push(c.pos.x, c.pos.y);
        }
    }
    if (controllerContainer) {
        staticBlockerPositions.push(controllerContainer.pos.x, controllerContainer.pos.y);
    }
    preloadStaticBlockers(room.name, staticBlockerPositions);
    // ── 预计算关键维修目标（血量 < 50% 的 spawn/extension/tower/container）──
    // 供 tower-defense 和 builder actions 复用，避免各模块重复迭代。
    let criticalRepairTarget;
    for (const s of spawns) {
        if (s.hits < s.hitsMax * 0.5) {
            criticalRepairTarget = s;
            break;
        }
    }
    if (!criticalRepairTarget) {
        for (const s of extensions) {
            if (s.hits < s.hitsMax * 0.5) {
                criticalRepairTarget = s;
                break;
            }
        }
    }
    if (!criticalRepairTarget) {
        for (const s of towers) {
            if (s.hits < s.hitsMax * 0.5) {
                criticalRepairTarget = s;
                break;
            }
        }
    }
    if (!criticalRepairTarget) {
        for (const s of containers) {
            if (s.hits < s.hitsMax * 0.5) {
                criticalRepairTarget = s;
                break;
            }
        }
    }
    return {
        roomName: room.name,
        rcl: room.controller?.level ?? 0,
        controller: room.controller,
        spawns,
        extensions,
        towers,
        containers,
        roads,
        walls,
        ramparts,
        storage,
        controllerContainer,
        links,
        sources,
        constructionSites: allSites,
        myConstructionSites: mySites,
        hostileCreeps,
        threatCreeps,
        energyAvailable: room.energyAvailable,
        energyCapacityAvailable: room.energyCapacityAvailable,
        fillTargets,
        needsRecovery,
        sourceOccupancy,
        pendingHarvesters: globalPendingHarvesters?.get(room.name) ?? 0,
        creepEnergy: globalCreepEnergy?.get(room.name) ?? 0,
        minerals,
        labs,
        terminal,
        extractor,
        factory,
        observer,
        powerSpawn,
        droppedEnergy,
        tombstones,
        ruins,
        criticalRepairTarget,
    };
}
// 结构筛选类型守卫。
function isSpawn(s) {
    return s.structureType === STRUCTURE_SPAWN;
}
function isExtension(s) {
    return s.structureType === STRUCTURE_EXTENSION;
}
function isTower(s) {
    return s.structureType === STRUCTURE_TOWER;
}
function isLink(s) {
    return s.structureType === STRUCTURE_LINK;
}
function isLab(s) {
    return s.structureType === STRUCTURE_LAB;
}

/** 具体 TickContext，包含用于内核设置的内部变更方法。 */
class Context {
    constructor(budget) {
        this._snapshots = new Map();
        this._globalSiteCount = 0;
        this.tick = Game.time;
        this.budget = budget;
    }
    get globalSiteCount() {
        return this._globalSiteCount;
    }
    getSnapshot(roomName) {
        return this._snapshots.get(roomName);
    }
    snapshots() {
        return this._snapshots.values();
    }
    /** @internal */
    _addSnapshot(snapshot) {
        this._snapshots.set(snapshot.roomName, snapshot);
        this._globalSiteCount += snapshot.myConstructionSites.length;
    }
}
/**
 * 同优先级角色内的执行顺序（约束 X-19）。
 * harvester 在 hauler 之前执行，确保先填 container 再取，避免 hauler 空跑。
 */
const ROLE_EXECUTION_ORDER = {
    worker: 0,
    harvester: 1,
    hauler: 2,
    upgrader: 3,
    builder: 4,
};
class Kernel {
    constructor(registry) {
        this.registry = registry;
        // 缓存 roleMap 和 sortedSystems — Registry 内容在 tick 间不变，避免每 tick 重建和排序。
        this.roleMap = new Map(registry.getRoles().map(r => [r.name, r]));
        this.sortedSystems = registry.getSystems();
    }
    run() {
        // 1. 预算 — 根据 bucket 带滞回地确定 CPU 档位。
        const budget = createBudget();
        // 2. Segment — 声明本 tick 需要激活的 RawMemory segment。
        //    必须在 maintainMemory 之前：迁移（如 v4）会调用 readLayoutSegment，
        //    而 segmentUnavailable 守卫依赖 requestSegments 写入的 requestedAt 判断
        //    「reset 首 tick segment 未加载」。若迁移先执行，守卫失效，
        //    空结构可能被缓存并在 flush 时整体覆盖 segment 历史数据。
        safeRun("segments-request", () => requestSegments(), true);
        // 3. Memory — 迁移、清理、默认值。关键步骤：永不冷却。
        safeRun("memory", () => maintainMemory(), true);
        // 3.5 遥测 — 初始化单 tick 计数器。
        initTelemetry(Game.time);
        // 4. 构建上下文。
        const ctx = new Context(budget);
        // 5. 构建房间快照（P0 — 必须在任何读取快照的系统之前运行）。
        this.buildSnapshots(ctx);
        // 6. 按优先级排序运行系统。
        //    room-state (P0) 在 spawn-manager (P0) 之前注册，先计算每房 ColonyState。
        this.runSystems(ctx);
        // 7. 按优先级排序运行 creep 角色。
        this.runCreeps(ctx);
        // 8. 遥测摘要。
        emitSummary(budget);
        // 9. 将 skip 原因从 global 缓冲区刷入 Memory。
        safeRun("flush-skips", () => flushSkips(), true);
        // 10. 将 dirty segment 数据刷写回 RawMemory。
        safeRun("segments-flush", () => flushSegments(), true);
    }
    buildSnapshots(ctx) {
        // 预构建全局 source 占用映射，避免每个房间独立遍历全部 Game.creeps。
        // 仅统计实际采矿角色（harvester/worker），其他角色的 sourceId 仅用于 acquire 寻路，
        // 不占用采矿位。
        const globalSourceOccupancy = new Map();
        // 同时汇总每房 creep 身上携带的能量（按 memory.home 归属），
        // 供 room-state 的 reserve 计入在途能量，避免物流搬运造成危机信号抖动（P1-5 ①）。
        const globalCreepEnergy = new Map();
        // P1-3：预构建拥有维修 creep（builder/worker）的房间集合，
        // 供 tower-defense 消费，避免塔防系统独立全量扫描 Game.creeps。
        const globalRepairRooms = new Set();
        // P0-1：预构建每房「待计入」harvester/worker 数量。
        // 包括已存活但尚未分配 sourceId 的 + 正在孵化中的，避免替换期间的假 bootstrap。
        const globalPendingHarvesters = new Map();
        for (const creep of Object.values(Game.creeps)) {
            const home = creep.memory.home;
            if (home) {
                const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
                if (carried > 0) {
                    globalCreepEnergy.set(home, (globalCreepEnergy.get(home) ?? 0) + carried);
                }
            }
            const role = creep.memory.role;
            if (role === "builder" || role === "worker") {
                const repairHome = home ?? creep.room.name;
                if (repairHome)
                    globalRepairRooms.add(repairHome);
            }
            if (role !== "harvester" && role !== "worker")
                continue;
            const sid = creep.memory.sourceId;
            if (sid) {
                globalSourceOccupancy.set(sid, (globalSourceOccupancy.get(sid) ?? 0) + 1);
            }
            else {
                // 已存活但尚未分配 sourceId 的新 harvester — 计入 pending。
                const pendingHome = home ?? creep.room.name;
                if (pendingHome) {
                    globalPendingHarvesters.set(pendingHome, (globalPendingHarvesters.get(pendingHome) ?? 0) + 1);
                }
            }
        }
        // 孵化中的 creep 已存在于 Game.creeps（spawning=true），上方循环已覆盖：
        // 有 sourceId → 计入 occupancy；无 sourceId → 计入 pending。
        // 因此无需再遍历 Game.spawns 单独统计孵化中的 harvester/worker —
        // 那样会把同一 creep 第二次计入 pending，虚增 room-state 的 harvesterCount、
        // 掩盖真实 bootstrap 信号。
        // 将 repairRooms 写入 globalCache，供 tower-defense 读取。
        globalCache().repairRooms = globalRepairRooms;
        for (const room of Object.values(Game.rooms)) {
            if (!room.controller?.my)
                continue;
            const snapshot = safeRunBuild(room.name, () => buildRoomSnapshot(room, globalSourceOccupancy, globalCreepEnergy, globalPendingHarvesters));
            if (snapshot)
                ctx._addSnapshot(snapshot);
        }
    }
    runSystems(ctx) {
        // 检查是否有任何自有房间处于 recovery 状态。
        // recovery 时 colonyState="recovery"，意味着关键基建缺失或经济断裂。
        // 此时 construction-manager (P2) 和 layout-planner (P3) 必须能够运行：
        //   - layout-planner: 重新将被毁的关键结构任务推入 buildQueue
        //   - construction-manager: 为紧急任务创建 construction site
        // 这与 runCreeps 中 builder 的 recovery 豁免同理（P2 builder 在 recovery 时
        // 以 P1 等效优先级运行），确保灾后重建路径不被 budget tier 完全冻结。
        const anyRecovery = Object.values(Memory.rooms).some(r => r?.colonyState === "recovery");
        // 关键基建缺失检测：storage/tower/spawn 在 buildQueue 中 P0 queued 但从未建成。
        // 此场景下 colonyState 可能为 "normal"（phase=growth），不触发 anyRecovery，
        // 但 construction-manager 仍被 budget tier 拦截 → 关键基建永远建不成 → 死锁。
        // anyCriticalGap 扩展豁免范围，覆盖"从未建成"与"被毁重建"两种情况。
        const anyCriticalGap = hasCriticalStructureGap(Memory.rooms);
        // 使用缓存的已排序 systems 列表（构造时构建）。
        for (const system of this.sortedSystems) {
            if (!this.shouldRunSystem(system, ctx)) {
                recordSkip(`system/${system.name}/interval`);
                continue;
            }
            // Recovery / 关键基建缺失豁免：construction-manager 和 layout-planner
            // 在 anyRecovery 或 anyCriticalGap 时以 P1 等效优先级通过 budget 检查，
            // 确保紧急重建路径可达。
            const isConstructionCritical = (anyRecovery || anyCriticalGap) &&
                (system.name === "construction-manager" || system.name === "layout-planner");
            const effectivePriority = isConstructionCritical
                ? 1
                : system.priority;
            if (!ctx.budget.canStart(effectivePriority)) {
                recordSkip(`system/${system.name}/budget`);
                continue;
            }
            measuredRun(`system/${system.name}`, () => safeRun(`system/${system.name}`, () => system.run(ctx), system.priority === 0));
            if (ctx.budget.isExhausted())
                break;
        }
    }
    shouldRunSystem(system, ctx) {
        // 间隔检查：最多每 N tick 运行一次。
        if (system.interval && system.interval > 1) {
            if (ctx.tick % system.interval !== 0)
                return false;
        }
        return true;
    }
    runCreeps(ctx) {
        // 使用缓存的 roleMap（构造时构建）。
        const roleMap = this.roleMap;
        // 收集 creep 及其角色优先级用于排序。
        const creepEntries = [];
        for (const creep of Object.values(Game.creeps)) {
            const role = roleMap.get(creep.memory.role);
            if (!role) {
                // 自愈：清除未知角色的旧目标和分配。
                creep.memory.targetId = undefined;
                creep.memory.assignment = undefined;
                // 使用稳定 label（按角色名而非 creep 名）进行限频。
                safeRun(`creep/unknown-role/${creep.memory.role}`, () => {
                    console.log(`[${Game.time}] creep/${creep.name}: unknown role '${creep.memory.role}', cleared targets`);
                });
                continue;
            }
            creepEntries.push({ creep, role });
        }
        // 按角色优先级升序排序（P0 在前），同优先级内按角色执行顺序排序
        // （X-19：harvester 在 hauler 前），最后按 ticksToLive 升序排序。
        creepEntries.sort((a, b) => {
            if (a.role.priority !== b.role.priority)
                return a.role.priority - b.role.priority;
            const aOrder = ROLE_EXECUTION_ORDER[a.role.name] ?? 99;
            const bOrder = ROLE_EXECUTION_ORDER[b.role.name] ?? 99;
            if (aOrder !== bOrder)
                return aOrder - bOrder;
            const aTtl = a.creep.ticksToLive ?? 1500;
            const bTtl = b.creep.ticksToLive ?? 1500;
            return aTtl - bTtl;
        });
        for (const { creep, role } of creepEntries) {
            // 每房殖民地状态门禁：在 recovery/bootstrap 时允许 P0 和 P1（能量链），
            // 但跳过 P2+（发展角色如 upgrader）。
            // 例外：recovery 时允许 builder——重建被毁基建是生存行为，不是发展。
            // 状态由 room-state 系统每 tick 写入 RoomMemory.colonyState。
            //
            // P1-2（CPU 死亡螺旋修复）：colony-state 门禁在 budget 检查之前执行。
            // 原先 budget.canStart 先于 colony-state 检查，recovery tier 的 maxPriority=1
            // 会先挡住 P2 builder，使 colony-state 中的 builder 豁免形同虚设。
            // 现在：先计算 colony-state 豁免，被豁免的 builder 用 P1 等效优先级通过 budget。
            const home = creep.memory.home;
            const roomState = home ? Memory.rooms[home]?.colonyState ?? "normal" : "normal";
            const isBuilderRecoveryExempt = roomState === "recovery" && role.name === "builder";
            if ((roomState === "recovery" || roomState === "bootstrap") &&
                role.priority > 1 &&
                !isBuilderRecoveryExempt) {
                recordSkip(`creep/${role.name}/colony-state`);
                continue;
            }
            // Budget 检查 — 被豁免的 builder 用 P1 等效优先级，获得 CPU 逃生通道。
            const budgetPriority = isBuilderRecoveryExempt ? 1 : role.priority;
            if (!ctx.budget.canStart(budgetPriority)) {
                recordSkip(`creep/${role.name}/budget`);
                continue;
            }
            if (ctx.budget.isExhausted())
                break;
            measuredRun(`creep/${creep.name}/${role.name}`, () => safeRun(`creep/${creep.name}/${role.name}`, () => role.run(creep, ctx), role.priority === 0));
        }
    }
}
// ─── 纯函数（可独立测试）────────────────────────────────────
/**
 * 检测是否有任何房间的 buildQueue 中存在 P0 queued 的关键基建任务。
 *
 * 关键基建 = storage / tower / spawn — 这三类结构缺失时经济链路断裂，
 * 必须让 construction-manager 在任何 budget tier 下都能运行（以 P1 等效优先级）。
 *
 * 纯函数 — 不访问 Game/Memory，接收显式参数，可在 Vitest 中独立测试。
 */
function hasCriticalStructureGap(rooms) {
    return Object.values(rooms).some(r => r?.buildQueue?.some(t => t.priority === 0 && t.state === "queued" &&
        (t.structureType === STRUCTURE_STORAGE ||
            t.structureType === STRUCTURE_TOWER ||
            t.structureType === STRUCTURE_SPAWN)));
}

/** 显式注册可防止 import 顺序耦合，使扩展可审计。 */
class Registry {
    constructor() {
        this.systems = new Map();
        this.roles = new Map();
    }
    registerSystem(system) {
        this.assertUnique(this.systems, system.name, "system");
        this.systems.set(system.name, system);
        return this;
    }
    registerRole(role) {
        this.assertUnique(this.roles, role.name, "role");
        this.roles.set(role.name, role);
        return this;
    }
    /** 系统按优先级升序排列（P0 在前）。 */
    getSystems() {
        return [...this.systems.values()].sort((a, b) => a.priority - b.priority);
    }
    /** 角色按优先级升序排列（P0 在前）。 */
    getRoles() {
        return [...this.roles.values()].sort((a, b) => a.priority - b.priority);
    }
    getRole(name) {
        return this.roles.get(name);
    }
    getSystem(name) {
        return this.systems.get(name);
    }
    assertUnique(items, name, kind) {
        if (items.has(name))
            throw new Error(`Duplicate ${kind} registration: ${name}`);
    }
}

/**
 * TaskPool — 单 tick 任务池数据结构，封装任务存储与索引。
 *
 * 架构价值：
 *   - **封装**：任务存储细节不泄漏到系统/适配层。数据结构变更只需改此文件。
 *   - **O(1) 任务查找**：通过 taskIndex 替代 tasks.find() 的 O(N) 线性扫描。
 *   - **单次扫描失效**：invalidate 合并「收集 creep 名」和「清空 assignedCreeps」为一次遍历。
 *
 * 生命周期：
 *   1. 每 tick 开头 assignment-service 调用 init(tick) 创建空池
 *   2. 为每房调用 setRoomTasks() 存入任务列表（同时构建索引）
 *   3. 角色通过 findTask()/getRoomTasks() 查找任务
 *   4. 角色通过 assignCreep()/releaseCreep() 修改分配状态
 *   5. tick 结束后池随 global reset 自然消亡
 *
 * 不访问 Game/Memory/globalCache — 纯数据结构，由调用方管理生命周期。
 */
class TaskPool {
    constructor() {
        this.roomTasks = new Map();
        /** taskId -> 任务条目，O(1) 查找替代 tasks.find()。 */
        this.taskIndex = new Map();
        this._tick = 0;
    }
    /** 初始化空池（每 tick 开头调用）。 */
    init(tick) {
        this.roomTasks.clear();
        this.taskIndex.clear();
        this._tick = tick;
    }
    get tick() {
        return this._tick;
    }
    /**
     * 存入房间的任务列表并构建 ID 索引。
     * 同一房间重复调用会覆盖旧任务（索引同步更新）。
     */
    setRoomTasks(roomName, tasks) {
        this.roomTasks.set(roomName, tasks);
        for (const task of tasks) {
            this.taskIndex.set(task.id, task);
        }
    }
    /** 获取房间的任务列表（只读视图）。 */
    getRoomTasks(roomName) {
        return this.roomTasks.get(roomName);
    }
    /** O(1) 按 ID 查找任务（替代 tasks.find）。 */
    findTask(taskId) {
        return this.taskIndex.get(taskId);
    }
    /**
     * 将 creep 分配到任务（带去重）。
     * @returns true 如果分配成功（任务存在且 creep 未已在列表中）。
     */
    assignCreep(taskId, creepName) {
        const task = this.taskIndex.get(taskId);
        if (!task)
            return false;
        if (task.assignedCreeps.includes(creepName))
            return false;
        task.assignedCreeps.push(creepName);
        return true;
    }
    /**
     * 从任务的 assignedCreeps 中移除 creep。
     * @returns true 如果移除成功。
     */
    releaseCreep(taskId, creepName) {
        const task = this.taskIndex.get(taskId);
        if (!task)
            return false;
        const idx = task.assignedCreeps.indexOf(creepName);
        if (idx < 0)
            return false;
        task.assignedCreeps.splice(idx, 1);
        return true;
    }
    /**
     * 失效指定房间内 priority >= minPriority 的所有任务。
     * 单次遍历同时：收集 creep 名 + 清空 assignedCreeps。
     * @returns 需要清除 assignment 的 creep 名列表。
     */
    invalidate(roomName, minPriority) {
        const tasks = this.roomTasks.get(roomName);
        if (!tasks)
            return [];
        const names = [];
        for (const task of tasks) {
            if (task.priority >= minPriority) {
                names.push(...task.assignedCreeps);
                task.assignedCreeps = [];
            }
        }
        return names;
    }
}

/**
 * 任务分配服务 — P1 系统，在所有角色之前运行。
 *
 * 职责（plan §5.7.2）：
 *   - 为每房生成本 tick 可用任务列表
 *   - source 槽位显式化（每 source 的 maxWorkers）
 *   - 物流任务确定性化（haul/fill 任务）
 *   - 建造任务带 maxWorkers 与 lease
 *   - 紧急抢占由系统完成（P0 fill / flee 使普通 assignment 失效）
 *
 * 数据流：
 *   1. 每 tick 初始化 global.assignment 缓存
 *   2. 检测紧急状态（能量不足或敌对威胁）— 触发抢占
 *   3. 为每房生成任务列表存入缓存
 *   4. 角色通过 helpers.getAssignment 获取或续约任务
 *
 * 架构：领域层 buildRoomTasks 是纯函数，TaskPool 封装索引与原子操作。
 * 本模块（系统层）负责从 Game/Memory 收集数据、调用纯函数、写回缓存。
 *
 * 优先级：P1 — 失败时角色回退到无 assignment 行为，允许 safeRun 冷却避免刷屏。
 */
const assignmentServiceSystem = {
    name: "assignment-service",
    priority: 1,
    run(ctx) {
        const pool = initAssignmentCache(ctx.tick);
        // P1-1：在循环外预构建全量 creep 分配摘要，避免 O(rooms × creeps) 重复遍历。
        // 原先 generateRoomTasks 在每房间循环内遍历全部 Game.creeps，N 房间 × M creep = O(N×M)。
        const allCreepRefs = collectAllCreepRefs();
        for (const snapshot of ctx.snapshots()) {
            // 紧急抢占（plan §5.7.2 规则 5）：能量低于 fill 阈值或有敌对单位时，
            // 释放 priority >= 1 的普通任务，强制 creep 重新请求 P0 fill 或进入 flee。
            //
            // P1-2 边沿触发：仅在「正常 → 紧急」上升沿失效一次。持续紧急期间不重复失效——
            // 旧实现每 tick 清空所有 assignment 并写 memory.assignment=undefined，
            // 使 lease 机制在持续敌袭/低能量期间形同虚设，且产生大量 Memory 写入抖动。
            // flee 由 role-runner 每 tick 独立处理（shouldFlee），不依赖 assignment 失效。
            const roomMem = Memory.rooms[snapshot.roomName];
            const emergency = isEmergencyState(snapshot);
            const wasEmergency = roomMem?.wasEmergency === true;
            if (roomMem)
                roomMem.wasEmergency = emergency;
            // Storage 优先：RCL4+ 无 storage 且有 storage site 时，强制释放 builder 的非 storage assignment。
            // 根因：lease 机制（50 tick）让 builder 保持旧的 extension assignment 不切换，
            // 导致 storage site 无人建造，经济中枢断裂。此函数每 tick 主动失效非 storage build assignment，
            // 强制 builder 在 chooseTaskForRole 中重新选 priority=1 的 storage site。
            const needsStorage = snapshot.rcl >= 4 && snapshot.storage === undefined;
            if (needsStorage) {
                releaseNonStorageBuilderAssignments(snapshot);
            }
            generateRoomTasks(pool, snapshot, ctx, allCreepRefs);
            // 抢占必须在 generateRoomTasks 之后执行 — TaskPool 每 tick 重建为空，
            // 任务写入前调用 invalidate 只会读到空列表、返回空 creep 名单，
            // 整个抢占退化为 no-op（曾因此静默失效）。任务生成后，
            // invalidate 同时清空 task.assignedCreeps 与 creep.memory.assignment，
            // 角色在其后的 runCreeps 阶段重新请求任务，本 tick 即转向 P0 fill/flee。
            //
            // TD-018 冷却：传入 lastPreemptTick 与当前 tick，抢占触发后记录 tick，
            // 防止房间在紧急/正常之间快速交替时每个上升沿都触发 invalidate。
            if (shouldPreemptAssignments(emergency, wasEmergency, roomMem?.lastPreemptTick, ctx.tick)) {
                invalidateAssignments(pool, snapshot.roomName, 1);
                if (roomMem)
                    roomMem.lastPreemptTick = ctx.tick;
            }
        }
    },
};
// ──────────────────────────────────────────────
// 适配层 — 从 Game/Memory 收集数据，调用纯函数，写回缓存
// ──────────────────────────────────────────────
/**
 * 初始化 assignment 缓存（每 tick 开头调用）。
 * 缓存操作在适配层完成 — 领域层不访问 globalCache。
 */
function initAssignmentCache(tick) {
    const pool = new TaskPool();
    pool.init(tick);
    const g = globalCache();
    g.assignment = { tick, pool };
    return pool;
}
/**
 * 适配：遍历全部 Game.creeps 一次，收集 creep 分配摘要。
 * P1-1：从 generateRoomTasks 提取到循环外，避免每房间重复遍历。
 */
function collectAllCreepRefs() {
    const refs = [];
    for (const creep of Object.values(Game.creeps)) {
        const home = creep.memory.home ?? creep.room?.name;
        if (!home)
            continue;
        const a = creep.memory.assignment;
        refs.push({
            name: creep.name,
            home,
            assignment: a
                ? {
                    id: a.id,
                    kind: a.kind,
                    sourceId: a.sourceId ? a.sourceId : undefined,
                }
                : undefined,
        });
    }
    return refs;
}
/**
 * 适配：为房间生成任务列表并写入 TaskPool。
 * 从预构建的全量 creepRefs 中筛选本房 creep，
 * 从 Memory 读取房间标志位，调用纯函数 buildRoomTasks 后将结果存入任务池。
 */
function generateRoomTasks(pool, snapshot, ctx, allCreepRefs) {
    if (pool.tick !== ctx.tick)
        return;
    const roomName = snapshot.roomName;
    const roomMem = Memory.rooms[roomName];
    // 从预构建的全量摘要中筛选本房 creep。
    const creepRefs = [];
    for (const ref of allCreepRefs) {
        if (ref.home === roomName)
            creepRefs.push(ref);
    }
    const flags = {
        colonyState: (roomMem?.colonyState ?? "normal"),
        controllerDowngradeRisk: roomMem?.controllerDowngradeRisk === true,
    };
    const tasks = buildRoomTasks(snapshot, creepRefs, flags);
    pool.setRoomTasks(roomName, tasks);
}
/**
 * 适配：失效指定房间内 priority >= minPriority 的所有任务。
 * 使用 TaskPool.invalidate() 单次遍历收集 creep 名并清空 assignedCreeps，
 * 然后清除这些 creep 的 memory.assignment。
 */
function invalidateAssignments(pool, roomName, minPriority) {
    const creepNames = pool.invalidate(roomName, minPriority);
    // 清除 creep memory 中的 assignment。
    for (const name of creepNames) {
        const creep = Game.creeps[name];
        if (creep) {
            creep.memory.assignment = undefined;
        }
    }
}
/**
 * 适配：强制释放绑定在非 storage/extension site 的 builder assignment。
 *
 * 触发条件：RCL4+ 无 storage 且存在 storage construction site。
 * storage 是经济中枢——haul 无处倒能、builder/upgrader 无中央能量源。
 * assignment-service 已将 storage site 标记为 priority=1, maxWorkers=2，
 * 但 lease 机制（50 tick）让 builder 保持旧的 road/rampart assignment 不切换。
 * 此函数每 tick 主动失效非 storage/extension build assignment，强制 builder 重新选 storage。
 *
 * 不释放 extension site 上的 builder——extension 建成后提升 energyCapacityAvailable，
 * 解锁更大 builder body，整体建造速率翻倍。全压 storage 反而拖慢 extension 重建。
 * 当 storage site 不存在（被 block 或未规划）时不释放——避免 builder 永久 idle。
 * 已在建 storage 的 builder 不受影响（target 是 storage site，不释放）。
 */
function releaseNonStorageBuilderAssignments(snapshot) {
    // 必须存在 storage construction site 才释放——否则 builder 无 storage 可建。
    const hasStorageSite = snapshot.myConstructionSites.some(s => s.structureType === STRUCTURE_STORAGE);
    if (!hasStorageSite)
        return;
    for (const creep of Object.values(Game.creeps)) {
        if (creep.memory.home !== snapshot.roomName)
            continue;
        if (creep.memory.role !== "builder")
            continue;
        const a = creep.memory.assignment;
        if (!a || a.kind !== "build" || !a.targetId)
            continue;
        const site = Game.getObjectById(a.targetId);
        // 保留 storage 和 extension site 上的 builder；释放其他（road/rampart/link 等）。
        if (site && site.structureType !== STRUCTURE_STORAGE && site.structureType !== STRUCTURE_EXTENSION) {
            creep.memory.assignment = undefined;
        }
    }
}
// ──────────────────────────────────────────────
// 纯判断函数
// ──────────────────────────────────────────────
/**
 * 判断房间是否处于紧急状态需要触发任务抢占。
 * 紧急条件（任一满足）：
 *   - 能量低于动态 fill 阈值 — 需要所有非关键 creep 转为 fill
 *   - 有敌对 creep — 非战斗 creep 应进入 flee
 *
 * 动态阈值：取 energyCapacityAvailable 的 40% 和固定上限的较小值。
 * 修复：原固定 300 阈值在 RCL1（容量 300）下永久触发紧急状态，
 * 导致 assignment 每 tick 被清空重建，creep 无法稳定工作。
 */
function isEmergencyState(snapshot) {
    const dynamicThreshold = Math.min(Math.floor(snapshot.energyCapacityAvailable * 0.4), CONFIG.assignment.emergencyFillThreshold);
    if (snapshot.energyAvailable < dynamicThreshold)
        return true;
    if (snapshot.threatCreeps.length > 0)
        return true;
    return false;
}
/**
 * 判断是否应触发任务抢占（纯函数，P1-2 边沿触发 + TD-018 冷却机制）。
 *
 * 仅在「正常 → 紧急」上升沿返回 true（emergency=true 且 wasEmergency=false）。
 * 持续紧急（true,true）、持续正常（false,false）、紧急缓解（false,true）均返回 false。
 * 这保证一次紧急事件只失效一次 assignment，避免持续期间每 tick 抖动。
 *
 * TD-018 冷却：上升沿触发后需距上次抢占至少 20 tick，防止房间在紧急/正常之间
 * 快速交替时每个上升沿都触发 invalidateAssignments，导致 creep 频繁丢失任务。
 * 首次抢占（lastPreemptTick 为 undefined 或距今超过 20 tick）不受冷却限制。
 */
function shouldPreemptAssignments(emergency, wasEmergency, lastPreemptTick, currentTick) {
    if (!emergency || wasEmergency)
        return false;
    // 冷却判断：距上次抢占至少间隔 20 tick
    if (lastPreemptTick !== undefined && currentTick - lastPreemptTick < 20)
        return false;
    return true;
}

/**
 * 建造队列域模块 — BuildTask 状态同步与清理的纯函数。
 *
 * 这些函数从 construction-manager（系统层）提取，使队列管理逻辑可独立测试。
 * construction-manager 负责调用 Game API（createConstructionSite），
 * 本模块只操作 BuildTask[] 数据结构 + 从 RoomSnapshot 读取的只读数据。
 */
/**
 * 同步 BuildTask 状态与房间内实际建造 site 和已建结构。
 *
 * 状态转换规则：
 *   queued + site 存在      → site
 *   queued + 结构已建成     → done
 *   site  + site 消失       → done（已建成）或 queued（被毁）
 *
 * 纯函数 — 不访问 Game/Memory，所有数据由参数传入。
 */
function syncTaskStates(queue, snapshot) {
    // 按位置 → site 映射，用于 queued→site 转换。
    // 注意：同一位置只可能有一个 site，但不同结构类型的任务可能指向同一位置。
    // 下面的匹配会额外检查 structureType，防止误匹配。
    const sites = new Map();
    for (const site of snapshot.myConstructionSites) {
        sites.set(`${site.pos.x},${site.pos.y}`, site);
    }
    // 预构建已建成结构的「位置:类型」集合，避免 lookForAt 调用。
    // 两个要点（幽灵任务循环的根因修复）：
    //   1. 必须含 rampart/wall/road/lab 等全部可入队类型 — 缺谁，谁的任务
    //      建成后就永远无法转 done，而是 site 消失 → 回退 queued → 重复建
    //      site 失败 → blocked → purge → 规划器再生成，无限 churn。
    //   2. key 必须带结构类型 — rampart 与建筑共格（core rampart 覆盖正是
    //      这么设计的），pos→单类型映射会让两者互相覆盖、判定失真。
    const builtPositions = new Set();
    const builtStructures = [
        ...snapshot.spawns,
        ...snapshot.extensions,
        ...snapshot.towers,
        ...snapshot.containers,
        ...snapshot.links,
        ...snapshot.ramparts,
        ...snapshot.walls,
        ...snapshot.roads,
        ...snapshot.labs,
    ];
    if (snapshot.storage) {
        builtStructures.push(snapshot.storage);
    }
    if (snapshot.terminal) {
        builtStructures.push(snapshot.terminal);
    }
    if (snapshot.extractor) {
        builtStructures.push(snapshot.extractor);
    }
    for (const s of builtStructures) {
        builtPositions.add(`${s.pos.x},${s.pos.y}:${s.structureType}`);
    }
    for (const task of queue) {
        const key = `${task.pos.x},${task.pos.y}`;
        const builtKey = `${key}:${task.structureType}`;
        if (task.state === "queued") {
            // 检查该位置是否存在**匹配结构类型**的 site。
            // P0 修复：旧实现只检查位置不检查类型，导致 storage 的 site 被误匹配给
            // 同位置的 extension 任务，extension 永远不会变成 site 也不会被创建。
            const site = sites.get(key);
            if (site && site.structureType === task.structureType) {
                task.state = "site";
            }
            else if (builtPositions.has(builtKey)) {
                // 该位置已建成目标结构 — 避免 layout planner 反复重添已完成任务。
                task.state = "done";
            }
        }
        else if (task.state === "site") {
            // 检查 site 是否消失（完成或被毁）或类型不匹配。
            const site = sites.get(key);
            if (!site || site.structureType !== task.structureType) {
                // 从快照结构数据检查是否已建成，避免 lookForAt。
                task.state = builtPositions.has(builtKey) ? "done" : "queued";
            }
        }
    }
}
/**
 * 移除已完成任务和过期阻塞任务。
 *
 * 清理规则：
 *   done                      → 删除（已完成，无需保留）
 *   blocked + attempts >= 3   → 删除（永久冲突，避免内存泄漏）
 *   blocked + retryAt 过期    → 转回 queued（保留 attempts 历史）
 *
 * 返回因永久冲突被删除的任务 key 列表 — 调用方应将其记入阻塞黑名单，
 * 否则布局规划器下个周期会按同 key 重新入队，形成
 * 「入队 → blocked → 删除 → 再入队」的无限空转循环。
 *
 * 纯函数 — 只操作 queue 数据结构 + tick 参数。
 */
function cleanTasks(queue, tick) {
    const purgedKeys = [];
    for (let i = queue.length - 1; i >= 0; i--) {
        const task = queue[i];
        if (!task)
            continue;
        if (task.state === "done") {
            queue.splice(i, 1);
            continue;
        }
        if (task.state === "blocked") {
            // 超过 3 次重试的永久冲突任务直接删除，避免内存泄漏。
            if (task.attempts >= 3) {
                purgedKeys.push(task.key);
                queue.splice(i, 1);
                continue;
            }
            if (tick > task.retryAt) {
                task.state = "queued";
                // 注意：不重置 attempts，保留失败历史以达上限后删除。
            }
        }
    }
    return purgedKeys;
}
/**
 * 检查是否有 source 缺少 container（且无在建 container site）—— 需要紧急重建。
 *
 * 缺失 source container 时该 source 的 harvester 只能长途送能到 spawn，经济瘫痪，
 * 必须允许在低能量/恢复状态下重建，否则陷入「能量低→不建造→无法重建→能量更低」死锁。
 *
 * 纯函数 — 从 snapshot 读取只读数据。
 */
function needsSourceContainerRebuild(snapshot) {
    const adjacentContainer = (x, y) => snapshot.containers.some(c => Math.abs(c.pos.x - x) <= 1 && Math.abs(c.pos.y - y) <= 1);
    const adjacentContainerSite = (x, y) => snapshot.constructionSites.some(s => s.structureType === STRUCTURE_CONTAINER && Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
    return snapshot.sources.some(s => !adjacentContainer(s.pos.x, s.pos.y) && !adjacentContainerSite(s.pos.x, s.pos.y));
}
/**
 * 评估房间的紧急重建需求。
 *
 * 注意：spawn 缺失在初始 bootstrap 时也是 true（房间刚建立还没有 spawn）。
 * 调用方应结合 layout.anchor 是否已设置来区分「从未建造」与「被毁重建」。
 * construction-manager 的 developmentGate 不做此区分 —— 无论初始还是重建，
 * 缺 spawn 时都必须豁免门禁以尽快恢复。
 *
 * 纯函数 — 从 snapshot 读取只读数据。
 */
function assessEmergencyRebuild(snapshot) {
    const sourceContainer = needsSourceContainerRebuild(snapshot);
    // RCL3 才解锁 tower；RCL < 3 时无塔是正常的，不算紧急。
    const tower = snapshot.rcl >= 3 && snapshot.towers.length === 0;
    // spawn 缺失 = 无法孵化，最严重的紧急状态。
    const spawn = snapshot.spawns.length === 0;
    // RCL4 才解锁 storage；RCL < 4 时无 storage 是正常的，不算紧急。
    // storage 被毁 = hauler 无处倒能 + builder/upgrader 无中央能量源 → 经济死循环。
    const storage = snapshot.rcl >= 4 && snapshot.storage === undefined;
    return {
        sourceContainer,
        tower,
        spawn,
        storage,
        any: sourceContainer || tower || spawn || storage,
    };
}
/**
 * 判断一个 BuildTask 是否属于紧急重建任务。
 *
 * 用于 tryCreateSite 排序加权：紧急任务排到队列最前，
 * 确保关键基建在被毁后第一时间创建 site。
 *
 * 纯函数 — 从 task + snapshot + emergency 状态推断。
 */
function isEmergencyTask(task, snapshot, emergency) {
    if (emergency.tower && task.structureType === STRUCTURE_TOWER)
        return true;
    if (emergency.spawn && task.structureType === STRUCTURE_SPAWN)
        return true;
    if (emergency.storage && task.structureType === STRUCTURE_STORAGE)
        return true;
    if (emergency.sourceContainer && task.structureType === STRUCTURE_CONTAINER) {
        // 仅 source 旁的 container 才算紧急 — controller container 不在此列。
        return snapshot.sources.some(s => Math.abs(s.pos.x - task.pos.x) <= 1 && Math.abs(s.pos.y - task.pos.y) <= 1);
    }
    return false;
}

/**
 * 建造管理器 — 唯一创建建造 site 的模块。
 *
 * 职责：
 *   - 同步 BuildTask 状态与实际建造 site（委托 domain/construction/queue）
 *   - 强制执行每房和全局 site 限制
 *   - 应用开发门禁（在恢复状态或存在 P0/P1 缺口时不建造）
 *   - 全局每 tick 最多创建 1 个 site
 *
 * 纯逻辑已提取到 domain/construction/queue.ts，本模块只处理 Game API 调用。
 *
 * 优先级：P2（发展性工作 — 不能与生存竞争）。
 */
const constructionManagerSystem = {
    name: "construction-manager",
    priority: 2,
    interval: 1,
    run(ctx) {
        let normalCreatedThisTick = false;
        let emergencyCreatedThisTick = false;
        for (const snapshot of ctx.snapshots()) {
            const roomMem = Memory.rooms[snapshot.roomName];
            if (!roomMem)
                continue;
            const queue = roomMem.buildQueue ?? [];
            // 1. 同步任务状态与实际 site（纯函数 — domain/construction/queue）。
            syncTaskStates(queue, snapshot);
            // 2. 清理完成 / 阻塞的任务（纯函数 — domain/construction/queue）。
            //    永久冲突（3 次 ERR_INVALID_TARGET）被清除的 key 记入 segment 黑名单，
            //    layout-planner 在冷却期内不会按同 key 重新入队。
            const purgedKeys = cleanTasks(queue, ctx.tick);
            if (purgedKeys.length > 0) {
                const segData = getRoomLayoutData(snapshot.roomName);
                segData.blocked ?? (segData.blocked = {});
                for (const key of purgedKeys) {
                    segData.blocked[key] = {
                        code: 1, // ERR_INVALID_TARGET 类永久冲突
                        retryAt: ctx.tick + CONFIG.construction.blockedRetryDelay,
                    };
                }
                markLayoutDirty();
            }
            // 3. 评估紧急重建状态。
            const emergency = assessEmergencyRebuild(snapshot);
            // 4. 检查开发门禁。
            if (!developmentGate(snapshot, ctx, emergency))
                continue;
            // 5. 尝试从队列创建一个 site。
            // 紧急重建独立计额 — 允许每 tick 创建 1 个紧急 + 1 个普通 site，
            // 避免普通建造任务挤占关键基建重建窗口。
            if (emergency.any && !emergencyCreatedThisTick) {
                const created = tryCreateSite(queue, snapshot, emergency);
                if (created)
                    emergencyCreatedThisTick = true;
            }
            else if (!normalCreatedThisTick) {
                const created = tryCreateSite(queue, snapshot, emergency);
                if (created)
                    normalCreatedThisTick = true;
            }
            roomMem.buildQueue = queue;
        }
    },
};
/**
 * 开发门禁 — 创建任何新 site 前必须满足。
 * 返回 true 表示允许建造。
 *
 * 紧急重建（source container / tower / spawn / storage 缺失）豁免 economyPressure / budget /
 * P0 队列 / 能量门禁，但不豁免威胁检测 — 敌人脚下不建工地。
 */
function developmentGate(snapshot, ctx, emergency) {
    if (!emergency.any) {
        // 梯度门禁：用 economyPressure 替代二值 colonyState 开关。
        // pressure 0.0–0.3: 正常建造（基础阈值）
        // pressure 0.3–0.8: 线性提高能量阈值（从基础 → 90% 容量）
        // pressure > 0.8: 完全阻塞非紧急建造
        const pressure = Memory.rooms[snapshot.roomName]?.economyPressure ?? 0;
        if (pressure > 0.8)
            return false;
        if (ctx.budget.tier === "recovery" || ctx.budget.tier === "conserve")
            return false;
    }
    // 有威胁 creep 时不建造（过境 scout 不影响建造）。
    // 紧急重建也不豁免此条 — 敌人脚下建工地 = 送钱。
    if (snapshot.threatCreeps.length > 0)
        return false;
    if (!emergency.any) {
        // 检查 P0 孵化队列缺口 — 仅 P0（紧急恢复 worker）阻塞建造。
        const roomMem = Memory.rooms[snapshot.roomName];
        if (roomMem?.spawnQueue) {
            const hasEmergencySpawn = roomMem.spawnQueue.some(r => r.priority === 0);
            if (hasEmergencySpawn)
                return false;
        }
        // 检查能量盈余 — 梯度阈值：随 economyPressure 线性提高。
        // pressure 0.0–0.3: 基础阈值（容量 60%）
        // pressure 0.3–0.8: 线性提高到容量 90%
        const pressure = Memory.rooms[snapshot.roomName]?.economyPressure ?? 0;
        const baseRatio = 0.6;
        const maxRatio = 0.9;
        const ratio = pressure <= 0.3
            ? baseRatio
            : baseRatio + ((pressure - 0.3) / 0.5) * (maxRatio - baseRatio);
        const buildThreshold = Math.min(Math.floor(snapshot.energyCapacityAvailable * ratio), CONFIG.economy.buildEnergySurplus + CONFIG.spawn.recoveryEnergyReserve);
        if (snapshot.energyAvailable < buildThreshold)
            return false;
    }
    // 全局 site 上限 — 紧急重建豁免自设限额（仍受游戏硬上限约束）。
    if (!emergency.any && ctx.globalSiteCount >= CONFIG.construction.maxGlobalSites)
        return false;
    return true;
}
/** 尝试从队列创建一个建造 site。成功创建返回 true。 */
function tryCreateSite(queue, snapshot, emergency) {
    // 按紧急重建 + 优先级排序：紧急任务排到最前，确保关键基建第一时间创建 site。
    const sorted = queue
        .filter(t => t.state === "queued" && Game.time >= t.retryAt)
        .sort((a, b) => {
        const aEmergency = isEmergencyTask(a, snapshot, emergency);
        const bEmergency = isEmergencyTask(b, snapshot, emergency);
        if (aEmergency !== bEmergency)
            return aEmergency ? -1 : 1;
        return a.priority - b.priority;
    });
    // 检查每房 site 限制。道路与 source container 单独计额，避免被 extension 永久挤占。
    const adjacentToSource = (x, y) => snapshot.sources.some(s => Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
    const isSourceContainerSite = (s) => s.structureType === STRUCTURE_CONTAINER && adjacentToSource(s.pos.x, s.pos.y);
    const roadSites = snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_ROAD).length;
    const sourceContainerSites = snapshot.myConstructionSites.filter(isSourceContainerSite).length;
    const normalSites = snapshot.myConstructionSites.filter(s => s.structureType !== STRUCTURE_SPAWN &&
        s.structureType !== STRUCTURE_TOWER &&
        s.structureType !== STRUCTURE_ROAD &&
        !isSourceContainerSite(s)).length;
    const criticalSites = snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_TOWER || s.structureType === STRUCTURE_SPAWN).length;
    // storage 独立计额 — 不与 extension 竞争 normal 名额，也不与 tower/spawn 竞争 critical 名额。
    // storage 是单例结构（每房最多 1 个），独立计数避免被 3 个 extension site 永久挤占。
    const storageSites = snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_STORAGE).length;
    for (const task of sorted) {
        const isCritical = task.structureType === STRUCTURE_TOWER || task.structureType === STRUCTURE_SPAWN;
        const isRoad = task.structureType === STRUCTURE_ROAD;
        const isStorage = task.structureType === STRUCTURE_STORAGE;
        const isSourceContainer = task.structureType === STRUCTURE_CONTAINER && adjacentToSource(task.pos.x, task.pos.y);
        // 检查每房限制。
        if (isCritical) {
            if (criticalSites >= CONFIG.construction.maxCriticalSitesPerRoom)
                continue;
        }
        else if (isStorage) {
            if (storageSites >= 1)
                continue;
        }
        else if (isRoad) {
            if (roadSites >= CONFIG.construction.maxRoadSitesPerRoom)
                continue;
        }
        else if (isSourceContainer) {
            if (sourceContainerSites >= CONFIG.construction.maxCriticalSitesPerRoom)
                continue;
        }
        else {
            if (normalSites >= CONFIG.construction.maxNormalSitesPerRoom)
                continue;
        }
        // 尝试创建 site。
        const room = Game.rooms[task.pos.roomName];
        if (!room)
            continue;
        const result = room.createConstructionSite(task.pos.x, task.pos.y, task.structureType);
        if (result === OK) {
            task.state = "site";
            task.attempts = 0;
            return true;
        }
        if (result === ERR_INVALID_TARGET) {
            task.state = "blocked";
            task.attempts++;
            task.retryAt = Game.time + 100;
            continue;
        }
        if (result === ERR_RCL_NOT_ENOUGH) {
            task.retryAt = Game.time + 50;
            continue;
        }
        if (result === ERR_FULL) {
            task.retryAt = Game.time + 10;
            return false;
        }
        // 未知错误 — 指数退避。
        task.attempts++;
        task.retryAt = Game.time + Math.min(10 * Math.pow(2, task.attempts), 200);
    }
    return false;
}

/** 将坐标编码为单个数字：x * 50 + y，范围 0-2499。 */
function packPos(x, y) {
    return x * 50 + y;
}
/** 解码 packed 位置。 */
function unpackPos(packed) {
    return { x: Math.floor(packed / 50), y: packed % 50 };
}

/**
 * 障碍结构类型（不可通行）。使用字符串字面量而非 Screeps 常量，
 * 使模块在无 Screeps 运行时（Vitest）也可加载。
 * road/container/自有 rampart 可通行，不在此列。
 */
const OBSTACLE_TYPES = new Set([
    "spawn",
    "extension",
    "tower",
    "storage",
    "link",
    "lab",
    "terminal",
    "factory",
    "nuker",
    "observer",
    "powerSpawn",
    "extractor",
]);
/**
 * 预计算障碍位置集合（packed x*50+y）——仅不可通行结构与障碍工地。
 * 每规划周期调用一次，供密封守卫（wouldSeal）复用。
 */
function buildObstaclePositionSet(snapshot) {
    const set = new Set();
    const arrays = [
        snapshot.spawns,
        snapshot.extensions,
        snapshot.towers,
        snapshot.links,
        snapshot.labs,
    ];
    for (const arr of arrays) {
        for (const s of arr) {
            set.add(packPos(s.pos.x, s.pos.y));
        }
    }
    if (snapshot.storage)
        set.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
    if (snapshot.terminal)
        set.add(packPos(snapshot.terminal.pos.x, snapshot.terminal.pos.y));
    if (snapshot.extractor)
        set.add(packPos(snapshot.extractor.pos.x, snapshot.extractor.pos.y));
    if (snapshot.factory)
        set.add(packPos(snapshot.factory.pos.x, snapshot.factory.pos.y));
    for (const site of snapshot.constructionSites) {
        if (OBSTACLE_TYPES.has(site.structureType)) {
            set.add(packPos(site.pos.x, site.pos.y));
        }
    }
    return set;
}
/** 可站格 = 边界内、非墙、无障碍结构/工地的格子。 */
function isServiceTile(x, y, terrain, obstacleSet) {
    if (x < 1 || x > 48 || y < 1 || y > 48)
        return false;
    if (terrain.get(x, y) === TERRAIN_MASK_WALL)
        return false;
    return !obstacleSet.has(packPos(x, y));
}
/**
 * 密封守卫 —「建筑孤岛」检测（v1 实心块教训：29 个结构 8 邻居全堵死）。
 *
 * transfer / spawnCreep / repair 射程均为 1，任何障碍结构都必须保留
 * ≥1 个相邻可站格（服务格），否则永远无法填充/维修/孵化。
 *
 * 在 (x,y) 放置障碍结构前检查：
 *   1. 自身仍有 ≥1 个相邻可站格（否则出生即密封）；
 *   2. 不夺走任何相邻障碍结构的最后一个可站格（否则把邻居封死）。
 *
 * 返回 true = 会造成密封，必须拒绝。
 */
function wouldSeal(x, y, terrain, obstacleSet) {
    // 1. 自身服务格检查。
    let selfFree = false;
    for (let dx = -1; dx <= 1 && !selfFree; dx++) {
        for (let dy = -1; dy <= 1 && !selfFree; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            if (isServiceTile(x + dx, y + dy, terrain, obstacleSet))
                selfFree = true;
        }
    }
    if (!selfFree)
        return true;
    // 2. 邻居服务格检查：我们占掉 (x,y) 后，邻居必须仍有 ≥1 个可站格。
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!obstacleSet.has(packPos(nx, ny)))
                continue;
            // 邻居当前的可站格（排除我们将占据的 (x,y)）。
            let neighborFree = 0;
            for (let tx = -1; tx <= 1; tx++) {
                for (let ty = -1; ty <= 1; ty++) {
                    if (tx === 0 && ty === 0)
                        continue;
                    const cx = nx + tx;
                    const cy = ny + ty;
                    if (cx === x && cy === y)
                        continue; // 我们即将占据的格子
                    if (isServiceTile(cx, cy, terrain, obstacleSet))
                        neighborFree++;
                }
            }
            if (neighborFree === 0)
                return true;
        }
    }
    return false;
}
/**
 * 预计算房间内各结构类型的数量（已建 + site）。
 * 每规划周期调用一次，供 validateBuildCell 复用 — 消除 O(cells × structures) 扫描。
 */
function precomputeStructureCounts(snapshot) {
    const counts = new Map();
    const typedArrays = [
        snapshot.spawns,
        snapshot.extensions,
        snapshot.towers,
        snapshot.containers,
        snapshot.roads,
        snapshot.links,
    ];
    for (const arr of typedArrays) {
        for (const s of arr) {
            counts.set(s.structureType, (counts.get(s.structureType) ?? 0) + 1);
        }
    }
    if (snapshot.storage) {
        counts.set(snapshot.storage.structureType, (counts.get(snapshot.storage.structureType) ?? 0) + 1);
    }
    for (const site of snapshot.constructionSites) {
        counts.set(site.structureType, (counts.get(site.structureType) ?? 0) + 1);
    }
    return counts;
}
/**
 * 各结构类型的「承诺数量」= 已建结构 + 我方在建 site + 队列中未完成任务。
 *
 * 供 constraint 放置器做批次抵扣（代际稳定性）：placeStructures 只为
 * 真实缺口生成放置，已被承诺的数量不再排位 — 消除「已建格进 occupied →
 * 贪心顺延到次优格 → 同一逻辑结构在新格重复排队」的代际漂移与幽灵任务
 * （幽灵任务最终 ERR_RCL_NOT_ENOUGH → blocked → 黑名单 churn）。
 *
 * 队列口径：仅计 queued/blocked 任务 — site 状态的任务对应实体 site
 * （已由 site 计数覆盖），done 任务对应已建结构（已由结构计数覆盖），
 * 重复计入会高估承诺、导致缺口放置不足。
 *
 * 纯函数 — 从 snapshot 与队列读取只读数据。
 */
function computeCommittedCounts(snapshot, queue) {
    const counts = new Map();
    const add = (type) => {
        counts.set(type, (counts.get(type) ?? 0) + 1);
    };
    for (const s of snapshot.spawns)
        add(s.structureType);
    for (const s of snapshot.extensions)
        add(s.structureType);
    for (const s of snapshot.towers)
        add(s.structureType);
    for (const s of snapshot.labs)
        add(s.structureType);
    if (snapshot.storage)
        add(snapshot.storage.structureType);
    if (snapshot.terminal)
        add(snapshot.terminal.structureType);
    if (snapshot.factory)
        add(snapshot.factory.structureType);
    for (const site of snapshot.myConstructionSites)
        add(site.structureType);
    for (const task of queue) {
        if (task.state === "queued" || task.state === "blocked")
            add(task.structureType);
    }
    return counts;
}
/**
 * 预计算所有被占用位置（packed x*50+y）。
 * 包括：source/controller/mineral/已有结构/site。
 * 每规划周期调用一次，供 validateBuildCell 和 findAdjacentBuildable 复用。
 */
function buildOccupiedPositionSet(snapshot, minerals) {
    const set = new Set();
    for (const s of snapshot.sources) {
        set.add(packPos(s.pos.x, s.pos.y));
    }
    if (snapshot.controller) {
        set.add(packPos(snapshot.controller.pos.x, snapshot.controller.pos.y));
    }
    if (minerals) {
        for (const m of minerals) {
            set.add(packPos(m.pos.x, m.pos.y));
        }
    }
    const structures = [
        ...snapshot.spawns,
        ...snapshot.extensions,
        ...snapshot.towers,
        ...snapshot.containers,
        ...snapshot.links,
        ...snapshot.constructionSites,
    ];
    for (const s of structures) {
        set.add(packPos(s.pos.x, s.pos.y));
    }
    if (snapshot.storage) {
        set.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
    }
    return set;
}
/**
 * 从 BuildQueue 中提取已完成的 blueprint key 集合。
 * 用于依赖检查 — 只有 state 为 "done" 的任务才算完成。
 */
function collectCompletedKeys(queue) {
    const set = new Set();
    for (const task of queue) {
        // 已完成或已有 site 的任务算作依赖满足。
        if (task.state === "done" || task.state === "site") {
            set.add(task.key);
        }
        // 已建结构也满足依赖 — 通过 key 匹配。
    }
    return set;
}
/**
 * 从房间实际已建结构中提取已完成的 blueprint key 集合。
 *
 * construction-manager 会在任务完成后立即删除 "done" 任务，
 * 因此仅依赖队列会漏掉已建结构。此函数通过检查锚点偏移位置
 * 上的实际结构类型来补充 completedKeys。
 */
function collectCompletedKeysFromStructures(blueprint, anchorX, anchorY, snapshot) {
    const set = new Set();
    // 预构建位置 → 结构类型映射（packed numeric key，消除字符串分配）。
    const structureMap = new Map();
    for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers, ...snapshot.links]) {
        structureMap.set(packPos(s.pos.x, s.pos.y), s.structureType);
    }
    if (snapshot.storage) {
        structureMap.set(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y), STRUCTURE_STORAGE);
    }
    for (const cell of blueprint.cells) {
        const x = anchorX + cell.dx;
        const y = anchorY + cell.dy;
        const existing = structureMap.get(packPos(x, y));
        if (existing === cell.structureType) {
            set.add(cell.key);
        }
    }
    return set;
}

/**
 * 将候选转为 BuildTask 对象（用于推入 BuildQueue）。
 * state 初始为 "queued"。
 */
function candidateToBuildTask(candidate) {
    return {
        key: candidate.key,
        pos: candidate.pos,
        structureType: candidate.structureType,
        priority: candidate.priority,
        state: "queued",
        attempts: 0,
        retryAt: 0,
    };
}
/**
 * 为 source 生成 container 任务。
 * 在 source 附近寻找可建造位置。
 */
function createSourceContainerTasks(snapshot, room, options) {
    const candidates = [];
    const maxContainers = CONTROLLER_STRUCTURES[STRUCTURE_CONTAINER]?.[snapshot.rcl] ?? 0;
    const existingContainers = snapshot.containers.length;
    const containerSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER).length;
    // 已有 container + site 数已达上限。
    if (existingContainers + containerSites >= maxContainers)
        return candidates;
    // 统计真正覆盖 source 的 container 数（紧邻某 source 的 container / site）。
    // 不能用 existingContainers（含 controller container）对比 source 数 —— 否则
    // controller container 会被误算进 source 覆盖，导致被毁的 source container 永不补建。
    const adjacentToSource = (x, y) => snapshot.sources.some(s => Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
    const sourceContainerCount = snapshot.containers.filter(c => adjacentToSource(c.pos.x, c.pos.y)).length;
    const sourceContainerSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER && adjacentToSource(s.pos.x, s.pos.y)).length;
    if (sourceContainerCount + sourceContainerSites >= snapshot.sources.length)
        return candidates;
    for (const source of snapshot.sources) {
        // 检查 source 旁是否已有 container 或 site。
        if (hasAdjacentStructure(source.pos.x, source.pos.y, snapshot, STRUCTURE_CONTAINER))
            continue;
        // 寻找相邻可建造位置。
        const adjacentPos = findAdjacentBuildable(source.pos, room, snapshot, options);
        if (adjacentPos) {
            candidates.push({
                key: `logistics.container.source.${source.id}`,
                pos: adjacentPos,
                structureType: STRUCTURE_CONTAINER,
                priority: 1,
                phase: "rcl2",
                validation: "ok",
            });
        }
    }
    return candidates;
}
/**
 * 为 controller 生成 container 任务。
 *
 * 老玩家关键认知：controller container 在 RCL2 就应建造（container RCL2 即解锁），
 * 它让 upgrader 站桩升级（0 通勤），升级吞吐提升约 2 倍。RCL2→RCL3 是整个游戏
 * 最漫长的 grind，越早建好 controller container 越早摆脱慢速升级。
 */
function createControllerContainerTask(snapshot, room, options) {
    if (snapshot.rcl < 2)
        return undefined;
    if (!snapshot.controller)
        return undefined;
    const controller = snapshot.controller;
    // 检查 controller 旁是否已有 container 或 site。
    if (hasAdjacentStructure(controller.pos.x, controller.pos.y, snapshot, STRUCTURE_CONTAINER))
        return undefined;
    const maxContainers = CONTROLLER_STRUCTURES[STRUCTURE_CONTAINER]?.[snapshot.rcl] ?? 0;
    const existingContainers = snapshot.containers.length;
    const containerSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER).length;
    if (existingContainers + containerSites >= maxContainers)
        return undefined;
    const adjacentPos = findAdjacentBuildable(controller.pos, room, snapshot, options);
    if (!adjacentPos)
        return undefined;
    return {
        key: `logistics.container.controller`,
        pos: adjacentPos,
        structureType: STRUCTURE_CONTAINER,
        // 优先级 1：高于 extension（priority 2）。一旦有 site 名额空出立即插队建造。
        priority: 1,
        phase: "rcl2",
        validation: "ok",
    };
}
/**
 * 为 source 生成 link 任务（RCL5+）。
 * source link 紧邻 source 放置，harvester 采矿后直接 transfer 到 link，
 * 由 link 系统瞬移到 controller/storage link，替代 hauler 长途往返。
 *
 * 队列感知：`queuedLinkCount` 传入当前 BuildQueue 中已有的 link 任务数
 * （含所有角色的 link 任务），防止超额分配 RCL 上限内的 link 槽位。
 *
 * 数量限制：`maxNew` 限制本次调用最多创建的新 source link 数。
 * layout-planner 分两趟调用：第一趟 maxNew=1 保证 storage link 有槽位；
 * 第二趟 maxNew=Infinity 放置剩余 source link。
 */
function createSourceLinkTasks(snapshot, room, options, queuedLinkCount = 0, maxNew = Infinity) {
    if (snapshot.rcl < 5)
        return [];
    const candidates = [];
    const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
    const existingLinks = snapshot.links.length;
    const linkSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_LINK).length;
    // 队列中的 link 任务也算占用槽位 — 防止超额分配。
    if (existingLinks + linkSites + queuedLinkCount >= maxLinks)
        return candidates;
    const remainingSlots = maxLinks - existingLinks - linkSites - queuedLinkCount;
    const limit = Math.min(maxNew, remainingSlots);
    for (const source of snapshot.sources) {
        if (candidates.length >= limit)
            break;
        if (hasAdjacentStructure(source.pos.x, source.pos.y, snapshot, STRUCTURE_LINK))
            continue;
        const adjacentPos = findAdjacentBuildable(source.pos, room, snapshot, options);
        // 密封守卫：link 是障碍结构，出生即密封或封死邻居的位置不放。
        if (adjacentPos && options.obstacleSet && wouldSeal(adjacentPos.x, adjacentPos.y, room.getTerrain(), options.obstacleSet)) {
            continue;
        }
        if (adjacentPos) {
            candidates.push({
                key: `logistics.link.source.${source.id}`,
                pos: adjacentPos,
                structureType: STRUCTURE_LINK,
                priority: 2,
                phase: "late",
                validation: "ok",
            });
        }
    }
    return candidates;
}
/**
 * 为 controller 生成 link 任务（RCL5+）。
 * controller link 紧邻 controller 放置，upgrader 站桩 withdraw 取能，
 * 能量由 source link 瞬移送入，实现 0 通勤站桩升级。
 *
 * 队列感知：`queuedLinkCount` 传入当前 BuildQueue 中已有的 link 任务数。
 */
function createControllerLinkTask(snapshot, room, options, queuedLinkCount = 0) {
    if (snapshot.rcl < 5)
        return undefined;
    if (!snapshot.controller)
        return undefined;
    const controller = snapshot.controller;
    if (hasAdjacentStructure(controller.pos.x, controller.pos.y, snapshot, STRUCTURE_LINK))
        return undefined;
    const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
    const existingLinks = snapshot.links.length;
    const linkSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_LINK).length;
    if (existingLinks + linkSites + queuedLinkCount >= maxLinks)
        return undefined;
    const adjacentPos = findAdjacentBuildable(controller.pos, room, snapshot, options);
    if (!adjacentPos)
        return undefined;
    // 密封守卫：link 是障碍结构。
    if (options.obstacleSet && wouldSeal(adjacentPos.x, adjacentPos.y, room.getTerrain(), options.obstacleSet)) {
        return undefined;
    }
    return {
        key: `logistics.link.controller`,
        pos: adjacentPos,
        structureType: STRUCTURE_LINK,
        priority: 1,
        phase: "late",
        validation: "ok",
    };
}
/**
 * 为 storage 生成 link 任务（RCL5+）。
 * storage link 紧邻 storage 放置（range <= 2），作为 link 网络的「最后一公里」：
 * source link 能量瞬移到 storage link，hauler 从 storage link 排空到 storage。
 *
 * 优先级 = 1（与 controller link 同级）：在 RCL5 仅 2 个 link 槽位时，
 * storage link 的优先级高于第二个 source link —— 因为 source + storage
 * 是最小可用 link 网络（source→storage 物流打通），而双 source 无 storage
 * 意味着 link 网络无法卸载能量。
 *
 * 队列感知：`queuedLinkCount` 传入当前 BuildQueue 中已有的 link 任务数。
 */
function createStorageLinkTask(snapshot, room, options, queuedLinkCount = 0) {
    if (snapshot.rcl < 5)
        return undefined;
    if (!snapshot.storage)
        return undefined;
    // 检查 storage 附近是否已有 link 或 link 工地。
    if (hasAdjacentStructure(snapshot.storage.pos.x, snapshot.storage.pos.y, snapshot, STRUCTURE_LINK))
        return undefined;
    const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
    const existingLinks = snapshot.links.length;
    const linkSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_LINK).length;
    if (existingLinks + linkSites + queuedLinkCount >= maxLinks)
        return undefined;
    // 在 storage 附近 1 格内寻找可建造位置（link 不需要站桩位，只需紧邻 storage）。
    const adjacentPos = findAdjacentBuildable(snapshot.storage.pos, room, snapshot, options);
    if (!adjacentPos)
        return undefined;
    // 密封守卫：link 是障碍结构。
    if (options.obstacleSet && wouldSeal(adjacentPos.x, adjacentPos.y, room.getTerrain(), options.obstacleSet)) {
        return undefined;
    }
    return {
        key: `logistics.link.storage`,
        pos: adjacentPos,
        structureType: STRUCTURE_LINK,
        // 优先级 1：与 controller link 同级，高于第二个 source link（priority 2）。
        // layout-planner 在 source(1) 之后、controller 之前调用，保证 RCL5
        // 仅有的 2 个槽位分配为 source + storage。
        priority: 1,
        phase: "late",
        validation: "ok",
    };
}
/**
 * 为 mineral 生成 extractor 任务（RCL6+）。
 *
 * extractor 必须建在 mineral 矿位上——矿位本身就是合法建造点，
 * 因此不走 validateBuildCell 的 occupied 检查（矿会被误判为占用）。
 * 补齐「extractor → harvestMineral → hauler 运回」产业链的第一环。
 */
function createExtractorTask(snapshot) {
    if (snapshot.rcl < 6)
        return undefined;
    const mineral = snapshot.minerals[0];
    if (!mineral)
        return undefined;
    // 已有 extractor 或 extractor site 则不再生成（每房上限 1）。
    const maxExtractors = CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR]?.[snapshot.rcl] ?? 0;
    const existingExtractors = snapshot.extractor !== undefined ? 1 : 0;
    const extractorSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_EXTRACTOR).length;
    if (existingExtractors + extractorSites >= maxExtractors)
        return undefined;
    return {
        key: `industry.extractor.${mineral.id}`,
        pos: { x: mineral.pos.x, y: mineral.pos.y, roomName: snapshot.roomName },
        structureType: STRUCTURE_EXTRACTOR,
        priority: 3,
        phase: "rcl6",
        validation: "ok",
    };
}
/** 检查指定位置附近 1 格内是否已有某类型结构（直接遍历，零数组分配）。 */
function hasAdjacentStructure(cx, cy, snapshot, structureType) {
    const adjacent = (s) => s.structureType === structureType &&
        Math.abs(s.pos.x - cx) <= 1 && Math.abs(s.pos.y - cy) <= 1;
    for (const s of snapshot.containers)
        if (adjacent(s))
            return true;
    for (const s of snapshot.links)
        if (adjacent(s))
            return true;
    for (const s of snapshot.constructionSites)
        if (adjacent(s))
            return true;
    return false;
}
/**
 * 在目标位置附近寻找可建造位置。
 *
 * 站桩位感知：优先选择「旁边至少有一个可站立格」的位置。
 * harvester/upgrader 站桩时需要站在 container 相邻格，若 container 落在
 * 三面是墙的凹位，站桩 creep 无处站立，退化成每 tick 挪一步。
 * 先收集所有可建造候选，优先返回有站立格的；都没有时回退到任意可建造格。
 */
function findAdjacentBuildable(center, room, snapshot, options) {
    const terrain = room.getTerrain();
    // 优先使用预计算的占用集合（每规划周期构建一次），否则回退到本地构建。
    const occupiedSet = options.occupiedSet ?? buildOccupiedSet(snapshot, options.minerals);
    const candidates = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            const x = center.x + dx;
            const y = center.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48)
                continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                continue;
            if (occupiedSet.has(packPos(x, y)))
                continue;
            candidates.push({ x, y });
        }
    }
    if (candidates.length === 0)
        return undefined;
    // 优先返回有相邻站立格的候选（站立格：非墙、边界内、非中心格）。
    for (const c of candidates) {
        if (hasStandingTile(c.x, c.y, center.x, center.y, terrain)) {
            return { ...c, roomName: center.roomName };
        }
    }
    // 回退：任意可建造格（极端地形下保证 container 仍能放下）。
    const fallback = candidates[0];
    return { ...fallback, roomName: center.roomName };
}
/** 检查 (x,y) 相邻 8 格中是否存在可站立格（非墙、边界内、非 (cx,cy) 中心格）。 */
function hasStandingTile(x, y, cx, cy, terrain) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx === cx && ny === cy)
                continue; // 中心是 source/controller，不能站
            if (nx < 1 || nx > 48 || ny < 1 || ny > 48)
                continue;
            if (terrain.get(nx, ny) === TERRAIN_MASK_WALL)
                continue;
            return true;
        }
    }
    return false;
}
/** 预构建已占用位置集合（回退路径 — 优先使用 validation.buildOccupiedPositionSet）。 */
function buildOccupiedSet(snapshot, minerals) {
    const set = new Set();
    for (const s of [
        ...snapshot.spawns,
        ...snapshot.extensions,
        ...snapshot.containers,
        ...snapshot.towers,
        ...snapshot.links,
        ...snapshot.constructionSites,
    ]) {
        set.add(packPos(s.pos.x, s.pos.y));
    }
    if (snapshot.storage) {
        set.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
    }
    for (const s of snapshot.sources) {
        set.add(packPos(s.pos.x, s.pos.y));
    }
    if (snapshot.controller) {
        set.add(packPos(snapshot.controller.pos.x, snapshot.controller.pos.y));
    }
    if (minerals) {
        for (const m of minerals) {
            set.add(packPos(m.pos.x, m.pos.y));
        }
    }
    return set;
}
// ─── 核心预规划道路 ─────────────────────────────────────────
/**
 * 为棋盘格走道生成预规划道路。
 *
 * 老玩家认知：v2 棋盘格中结构在偶校验格，奇校验格是天然走道。
 * 如果等流量采样（100+ tick 窗口 × 2）再铺路，前 200 tick hauler 在 plain 上走
 * （cost 2），效率减半。预规划走道格铺 road 让 hauler 从第一天就 cost 1。
 *
 * 策略：找到所有奇校验格（dx+dy 为奇数），且正交相邻 ≥ 2 个已建/已规划结构位置，
 * 这些格子一定是高频通行路径。生成 priority 3 道路任务（背景建造，不拖慢 RCL 冲刺）。
 *
 * 只在 RCL2+ 生成（至少有第一批 extension 后走道才有意义）。
 * 每周期最多生成 maxRoadsPerCycle 条（避免淹没 buildQueue）。
 */
function createCoreRoadTasks(blueprint, anchorX, anchorY, roomName, room, snapshot, occupiedSet, maxRoadsPerCycle = 4) {
    const candidates = [];
    if (snapshot.rcl < 2)
        return candidates;
    const terrain = room.getTerrain();
    // 收集当前 RCL 已建/已规划的结构绝对位置（偶校验格）。
    const structurePositions = new Set();
    for (const cell of blueprint.cells) {
        if (cell.minRcl > snapshot.rcl)
            continue;
        structurePositions.add(packPos(anchorX + cell.dx, anchorY + cell.dy));
    }
    // 加入已有结构位置。
    for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers, ...snapshot.links]) {
        structurePositions.add(packPos(s.pos.x, s.pos.y));
    }
    if (snapshot.storage)
        structurePositions.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
    // 扫描核心区域（±7）内的奇校验格，找正交相邻 ≥ 2 个结构的走道格。
    let generated = 0;
    for (let dx = -7; dx <= 7 && generated < maxRoadsPerCycle; dx++) {
        for (let dy = -7; dy <= 7 && generated < maxRoadsPerCycle; dy++) {
            // 只要奇校验格（走道格）。
            if ((dx + dy) % 2 === 0)
                continue;
            const x = anchorX + dx;
            const y = anchorY + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48)
                continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                continue;
            if (occupiedSet.has(packPos(x, y)))
                continue;
            // 计算正交相邻（4 方向）的结构数量。
            let adjacentStructures = 0;
            const orthogonal = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [ox, oy] of orthogonal) {
                if (structurePositions.has(packPos(x + ox, y + oy))) {
                    adjacentStructures++;
                }
            }
            if (adjacentStructures >= 2) {
                candidates.push({
                    key: `road.core.${x}.${y}`,
                    pos: { x, y, roomName },
                    structureType: STRUCTURE_ROAD,
                    priority: 3,
                    phase: "rcl2",
                    validation: "ok",
                });
                generated++;
            }
        }
    }
    return candidates;
}
const DEFAULT_DEFENSE_OPTIONS = {
    // P0-3：从 4 降为 3 — RCL3 是"刚有 Tower 但无 rampart"的最脆弱窗口期。
    minRcl: 3,
    defenseRadius: 7,
    lineLength: 3,
    maxLinesPerCycle: 1,
};
/** 8 方向单位向量（对应 atan2 的 8 个 45° 扇区，0 = 东，顺时针）。 */
const OCTANT_VECTORS = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
/** 垂直方向（逆时针旋转 90°）：(dx,dy) → (-dy,dx)。 */
function perpendicular(vec) {
    return [-vec[1], vec[0]];
}
/** 将 (dx, dy) 方向归一到 8 扇区索引。 */
function octantIndex(dx, dy) {
    const angle = Math.atan2(dy, dx); // -PI..PI
    const sector = Math.round(angle / (Math.PI / 4)); // -4..4
    return ((sector % 8) + 8) % 8; // 0..7
}
/**
 * 为房间生成防御工事任务（出口走廊封堵线）。
 *
 * 老玩家认知：单个 rampart 不挡路，敌人直接绕过去。
 * 有意义的防御 = 垂直于出口方向的连续 rampart 线（3-5 个），
 * 迫使入侵者必须摧毁或绕路，为 tower 争取 5-10 tick 输出窗口。
 *
 * 策略：
 *   1. 把出口按相对核心的方位归入 8 个扇区
 *   2. 对暴露扇区（出口最多的优先），在 核心 + 方向 × radius 处
 *      沿垂直方向铺设 lineLength 个 rampart
 *   3. 每个 rampart 吸附到最近可建造空格（避免落在墙上）
 *   4. 每周期最多生成 maxLinesPerCycle 条线（不拖慢 RCL 冲刺）
 *
 * 纯函数 — 出口位置由调用方通过 room.find(FIND_EXIT) 采集后传入。
 */
function createDefenseTasks(snapshot, exitPositions, room, options, config = DEFAULT_DEFENSE_OPTIONS) {
    const candidates = [];
    if (snapshot.rcl < config.minRcl)
        return candidates;
    const core = snapshot.spawns[0];
    if (!core)
        return candidates;
    // rampart 上限检查（已有 + site 达上限则不再生成）。
    const maxRamparts = CONTROLLER_STRUCTURES[STRUCTURE_RAMPART]?.[snapshot.rcl] ?? 0;
    const existingRamparts = snapshot.ramparts.length;
    const rampartSites = snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_RAMPART).length;
    if (existingRamparts + rampartSites >= maxRamparts)
        return candidates;
    // 按扇区统计出口数量。
    const exitCountByOctant = new Map();
    for (const exit of exitPositions) {
        const dx = exit.x - core.pos.x;
        const dy = exit.y - core.pos.y;
        const octant = octantIndex(dx, dy);
        exitCountByOctant.set(octant, (exitCountByOctant.get(octant) ?? 0) + 1);
    }
    if (exitCountByOctant.size === 0)
        return candidates;
    // 暴露扇区按出口数量降序，取前 N 条线。
    const exposedOctants = [...exitCountByOctant.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, config.maxLinesPerCycle)
        .map(([octant]) => octant);
    const terrain = room.getTerrain();
    // 本地可变副本：防止同线内重复落子（ReadonlySet 不可修改）。
    const localOccupied = new Set(options.occupiedSet ?? buildOccupiedSet(snapshot, options.minerals));
    for (const octant of exposedOctants) {
        const vec = OCTANT_VECTORS[octant];
        const perp = perpendicular(vec);
        // 线的中心点：核心 + 出口方向 × radius。
        const centerX = core.pos.x + vec[0] * config.defenseRadius;
        const centerY = core.pos.y + vec[1] * config.defenseRadius;
        // 沿垂直方向铺设 lineLength 个 rampart（居中分布）。
        const halfLen = Math.floor(config.lineLength / 2);
        for (let i = -halfLen; i <= halfLen; i++) {
            const idealX = centerX + perp[0] * i;
            const idealY = centerY + perp[1] * i;
            const pos = findBuildableNear(idealX, idealY, terrain, localOccupied);
            if (!pos)
                continue;
            // 标记为已占用，防止同线内重复落子。
            localOccupied.add(packPos(pos.x, pos.y));
            candidates.push({
                key: `defense.rampart.${octant}.${i + halfLen}`,
                pos: { ...pos, roomName: snapshot.roomName },
                structureType: STRUCTURE_RAMPART,
                priority: 2,
                phase: "rcl4",
                validation: "ok",
            });
        }
    }
    return candidates;
}
/**
 * 在理想点附近（半径 2）寻找最近的可建造空格。
 * 返回距离理想点欧氏距离最近的非墙、未占用、边界内的格子。
 */
function findBuildableNear(idealX, idealY, terrain, occupiedSet) {
    let best;
    let bestDist = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
            const x = Math.round(idealX) + dx;
            const y = Math.round(idealY) + dy;
            if (x < 1 || x > 48 || y > 48 || y < 1)
                continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                continue;
            if (occupiedSet.has(packPos(x, y)))
                continue;
            const dist = (x - idealX) ** 2 + (y - idealY) ** 2;
            if (dist < bestDist) {
                bestDist = dist;
                best = { x, y };
            }
        }
    }
    return best;
}

/**
 * Min-Cut 防御规划 — 用最少 rampart 封锁所有入侵路径。
 *
 * 算法：最小顶点割（Minimum Vertex Cut）via 最大流（Edmonds-Karp）。
 *
 * 问题建模：
 *   - 图 G = (V, E)：V = 所有非墙格，E = 正交相邻非墙格之间的边
 *   - Source 集合 S = 房间出口格（敌人入口）
 *   - Sink 集合 T = 核心区域格（要保护的结构）
 *   - 求：最小的顶点集合 C，使得移除 C 后 S 和 T 不连通
 *   - C 中的格就是 rampart 放置位置
 *
 * 实现：顶点割 → 边割转换 + Edmonds-Karp 最大流
 *   - 每个顶点 v 拆为 v_in → v_out（容量 1 = 可被切割）
 *   - 相邻顶点 u_out → v_in（容量 INF = 不可切割的边）
 *   - Source 顶点容量 INF（不可切割出口格）
 *   - Sink 顶点容量 INF（不可切割核心格）
 *   - 最大流值 = 最小割大小 = 最少 rampart 数
 *   - 从残余图中提取割集：BFS 从 source 出发，
 *     经过容量 > 0 的边能到达的 v_in 中，
 *     v_in → v_out 边已满载（残余 = 0）的 v 就是割集
 *
 * CPU 成本：
 *   - 图规模：~2000 非墙格 × 2（拆点）= ~4000 节点，~16000 边
 *   - Edmonds-Karp：O(V × E²) 最坏，但实际流值小（通常 < 20）
 *   - 实测：~0.5-2ms（可接受，只在 RCL4 首次规划时执行一次）
 *   - 缓存：结果存入 segment，地形不变则不重算
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */
/** 图节点 ID 编码：每个格 (x,y) 拆为 in/out 两个节点。 */
function nodeId(x, y, isOut) {
    // 格索引 = x*50+y (0..2499)，in = idx*2, out = idx*2+1
    const idx = x * 50 + y;
    return idx * 2 + (isOut ? 1 : 0);
}
/** INF 容量（不可切割）。 */
const INF_CAP = 10000;
/**
 * 计算房间的最小割防御线。
 *
 * @param getTerrain 地形查询 (x,y) → 是否墙
 * @param corePositions 核心区域格（要保护的结构位置）
 * @param exitPositions 房间出口格（敌人入口）
 * @param maxRamparts 最大允许 rampart 数（超过则放弃，返回 complete=false）
 */
function computeMinCutDefense(getTerrain, corePositions, exitPositions, maxRamparts = 30) {
    if (corePositions.length === 0 || exitPositions.length === 0) {
        return { rampartPositions: [], cutSize: 0, complete: false };
    }
    // 1. 标记 source/sink 格
    const coreSet = new Set();
    for (const p of corePositions)
        coreSet.add(p.x * 50 + p.y);
    const exitSet = new Set();
    for (const p of exitPositions)
        exitSet.add(p.x * 50 + p.y);
    // 2. 收集所有非墙格（节点）
    const openTiles = [];
    const tileIndex = new Map(); // packed → index in openTiles
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            if (getTerrain(x, y))
                continue;
            const packed = x * 50 + y;
            tileIndex.set(packed, openTiles.length);
            openTiles.push({ x, y });
        }
    }
    const nodeCount = 50 * 50 * 2; // 最大节点数（拆点后）
    const adj = Array.from({ length: nodeCount }, () => []);
    // 添加边的辅助函数
    function addEdge(from, to, cap) {
        adj[from].push({ to, cap, rev: adj[to].length });
        adj[to].push({ to: from, cap: 0, rev: adj[from].length - 1 });
    }
    // 3. 建图：拆点 + 邻接边
    for (const tile of openTiles) {
        const { x, y } = tile;
        const packed = x * 50 + y;
        const vIn = nodeId(x, y, false);
        const vOut = nodeId(x, y, true);
        // 拆点边：v_in → v_out
        // Source/Sink 格容量 INF（不可切割），普通格容量 1
        const isSource = exitSet.has(packed);
        const isSink = coreSet.has(packed);
        const vertexCap = (isSource || isSink) ? INF_CAP : 1;
        addEdge(vIn, vOut, vertexCap);
        // 邻接边：v_out → neighbor_in（正交 4 方向）
        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50)
                continue;
            if (getTerrain(nx, ny))
                continue;
            const nIn = nodeId(nx, ny, false);
            addEdge(vOut, nIn, INF_CAP);
        }
    }
    // 4. 添加超级 source 和超级 sink
    const SUPER_SOURCE = nodeCount - 2;
    const SUPER_SINK = nodeCount - 1;
    for (const p of exitPositions) {
        if (getTerrain(p.x, p.y))
            continue;
        const vOut = nodeId(p.x, p.y, true);
        addEdge(SUPER_SOURCE, vOut, INF_CAP);
    }
    for (const p of corePositions) {
        if (getTerrain(p.x, p.y))
            continue;
        const vIn = nodeId(p.x, p.y, false);
        addEdge(vIn, SUPER_SINK, INF_CAP);
    }
    // 5. Edmonds-Karp 最大流（BFS 增广）
    // 优化：预分配 typed arrays + head pointer queue，避免每次增广重新分配。
    const totalNodes = nodeCount;
    let maxFlow = 0;
    // 预分配 BFS 工作区（在所有增广间复用，避免反复 GC 压力）。
    const parent = new Int32Array(totalNodes);
    const parentEdgeIdx = new Int32Array(totalNodes);
    const visited = new Uint8Array(totalNodes);
    const bfsQueue = new Int32Array(totalNodes); // 预分配队列容量
    function augment() {
        // 重置工作区（typed array fill 比 regular array 快）。
        visited.fill(0);
        parent.fill(-1);
        parentEdgeIdx.fill(-1);
        // 使用 head/tail 指针替代 shift()（shift 是 O(N)）。
        let head = 0;
        let tail = 0;
        bfsQueue[tail++] = SUPER_SOURCE;
        visited[SUPER_SOURCE] = 1;
        while (head < tail) {
            const u = bfsQueue[head++];
            if (u === SUPER_SINK)
                break;
            const edges = adj[u];
            for (let i = 0; i < edges.length; i++) {
                const e = edges[i];
                if (e.cap <= 0 || visited[e.to])
                    continue;
                visited[e.to] = 1;
                parent[e.to] = u;
                parentEdgeIdx[e.to] = i;
                bfsQueue[tail++] = e.to;
            }
        }
        if (!visited[SUPER_SINK])
            return false;
        // 回溯增广（瓶颈 = 1，因为普通顶点容量为 1）
        let v = SUPER_SINK;
        while (v !== SUPER_SOURCE) {
            const u = parent[v];
            const ei = parentEdgeIdx[v];
            const e = adj[u][ei];
            e.cap -= 1;
            adj[e.to][e.rev].cap += 1;
            v = u;
        }
        maxFlow++;
        return true;
    }
    // 执行增广直到无路径或超过 maxRamparts
    while (maxFlow <= maxRamparts) {
        if (!augment())
            break;
    }
    // 6. 提取最小割集
    // 从 SUPER_SOURCE 出发，沿残余容量 > 0 的边 BFS，
    // 找到所有可达的 v_in 节点中，v_in→v_out 边已满载（残余=0）的格。
    if (maxFlow > maxRamparts) {
        return { rampartPositions: [], cutSize: maxFlow, complete: false };
    }
    // 复用预分配的 bfsQueue 和 visited（重置为 reachable）。
    const reachable = visited;
    reachable.fill(0);
    let rHead = 0;
    let rTail = 0;
    bfsQueue[rTail++] = SUPER_SOURCE;
    reachable[SUPER_SOURCE] = 1;
    while (rHead < rTail) {
        const u = bfsQueue[rHead++];
        for (const e of adj[u]) {
            if (e.cap > 0 && !reachable[e.to]) {
                reachable[e.to] = 1;
                bfsQueue[rTail++] = e.to;
            }
        }
    }
    // 割集：v_in 可达但 v_out 不可达的普通格（非 source/sink）
    const rampartPositions = [];
    for (const tile of openTiles) {
        const packed = tile.x * 50 + tile.y;
        if (coreSet.has(packed) || exitSet.has(packed))
            continue;
        const vIn = nodeId(tile.x, tile.y, false);
        const vOut = nodeId(tile.x, tile.y, true);
        if (reachable[vIn] && !reachable[vOut]) {
            rampartPositions.push({ x: tile.x, y: tile.y });
        }
    }
    return {
        rampartPositions,
        cutSize: rampartPositions.length,
        complete: rampartPositions.length <= maxRamparts && rampartPositions.length > 0,
    };
}

/**
 * 防御规划器 — P3 独立系统，负责生成 rampart/wall 建造任务。
 *
 * 策略（Phase 5 升级）：
 *   1. 优先使用 min-cut 算法：用最少 rampart 封锁所有入侵路径
 *   2. Min-cut 失败（割集过大/地形太开放）时 fallback 到扇区防御
 *
 * 触发：interval 10（每 10 tick 评估一次）。
 *
 * CPU 优化（P1 修复）：
 *   - min-cut 结果缓存在 global heap，仅在核心结构变化时重算
 *   - bucket < 5000 时完全跳过（非关键系统不能拖垮生存）
 *   - buildQueue 中已有 mincut rampart key 时跳过计算
 *   - room.find(FIND_EXIT) 结果缓存在 heap（地形不变）
 */
const defensePlannerSystem = {
    name: "defense-planner",
    priority: 3,
    interval: 10,
    run(ctx) {
        // P3 在 conserve/recovery 下不运行。
        if (ctx.budget.tier === "conserve" || ctx.budget.tier === "recovery")
            return;
        // Bucket 门禁 — 低于 5000 时完全跳过防御规划。
        // 防御规划是非关键的 P3 工作，不能在 CPU 紧张时拖垮生存。
        if (Game.cpu.bucket < 5000)
            return;
        for (const snapshot of ctx.snapshots()) {
            planDefense(snapshot);
        }
    },
};
/** Min-cut 最大 rampart 数（超过则 fallback 到扇区）。 */
const MAX_CUT_RAMPARTS = 30;
/**
 * 获取或创建房间的 min-cut 缓存。
 * 缓存 key 为 roomName，存放在 global heap。
 */
function getMinCutCache(roomName) {
    const g = globalCache();
    // 优先读 global heap（快）
    if (g.__minCutCache?.[roomName])
        return g.__minCutCache[roomName];
    // Global Reset 后从 Memory 恢复 — 避免 bucket < 5000 时防御真空
    const roomMem = Memory.rooms[roomName];
    if (roomMem?.minCut) {
        const stored = roomMem.minCut;
        const positions = [];
        for (let i = 0; i < stored.positions.length; i += 2) {
            positions.push({ x: stored.positions[i], y: stored.positions[i + 1] });
        }
        const cache = {
            signature: stored.sig,
            result: { rampartPositions: positions, complete: stored.complete },
            tick: 0,
        };
        // 写回 global heap
        if (!g.__minCutCache)
            g.__minCutCache = {};
        g.__minCutCache[roomName] = cache;
        return cache;
    }
    return undefined;
}
function setMinCutCache(roomName, cache) {
    const g = globalCache();
    if (!g.__minCutCache)
        g.__minCutCache = {};
    g.__minCutCache[roomName] = cache;
    // 同步到 Memory（跨 Global Reset 存活）
    const roomMem = Memory.rooms[roomName];
    if (roomMem) {
        const positions = [];
        for (const pos of cache.result.rampartPositions) {
            positions.push(pos.x, pos.y);
        }
        roomMem.minCut = {
            sig: cache.signature,
            positions,
            complete: cache.result.complete,
        };
    }
}
/**
 * 计算核心结构的签名 — 用于检测是否需要重算 min-cut。
 * 签名包含 spawns、extensions、storage、towers 的位置。
 * 只有核心结构变化时才需要重算。
 */
function computeCoreSignature(snapshot) {
    const parts = [];
    for (const s of snapshot.spawns)
        parts.push(`s${s.pos.x},${s.pos.y}`);
    for (const s of snapshot.extensions)
        parts.push(`e${s.pos.x},${s.pos.y}`);
    if (snapshot.storage)
        parts.push(`st${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
    for (const s of snapshot.towers)
        parts.push(`t${s.pos.x},${s.pos.y}`);
    return parts.sort().join("|");
}
/**
 * 获取或缓存房间的出口位置。
 * room.find(FIND_EXIT) 是全房扫描，缓存避免每 10 tick 重算。
 */
function getCachedExits(room, roomName) {
    const g = globalCache();
    if (!g.__exitCache)
        g.__exitCache = {};
    const cached = g.__exitCache[roomName];
    // 出口位置在房间地形不变时是固定的，缓存 1000 tick 过期。
    if (cached && Game.time - cached.tick < 1000) {
        return cached.positions;
    }
    const positions = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
    g.__exitCache[roomName] = { positions, tick: Game.time };
    return positions;
}
function planDefense(snapshot) {
    // P0-3 修复：RCL 门禁从 4 降为 3。
    // RCL3 是"刚有 Tower 但无 rampart"的最脆弱窗口期 — 一波突袭就破。
    // RCL3 时跳过昂贵的 min-cut，走扇区防御 fallback（少量 rampart 包围核心）。
    if (snapshot.rcl < 3)
        return;
    const room = Game.rooms[snapshot.roomName];
    if (!room)
        return;
    const roomMem = Memory.rooms[snapshot.roomName];
    if (!roomMem)
        return;
    const queue = roomMem.buildQueue ?? [];
    const existingKeys = new Set();
    for (const t of queue)
        existingKeys.add(t.key);
    let added = false;
    // ── 核心结构 rampart 覆盖（P1：保护建筑不被直接攻击）──
    // rampart 可与建筑共格 — 在每个核心结构位置叠加 rampart，
    // 使敌方必须先拆 rampart 才能攻击建筑。独立于 min-cut/扇区路径封锁逻辑。
    added = addCoreRampartCoverage(queue, snapshot, existingKeys) || added;
    // 快速检查：如果 buildQueue 中已有未完成的 mincut rampart key，跳过 min-cut 计算。
    // min-cut rampart key 格式: defense.mincut.{x}.{y}
    const mincutKeyCount = queue.filter(t => t.key.startsWith("defense.mincut.") && t.state !== "done").length;
    // P0 修复：如果 buildQueue 中已有未完成的 mincut rampart 任务，跳过全部计算。
    // 这些任务存于 Memory（跨 global reset 存活），无需因 global cache 清空而重算。
    // 如果核心结构已变，旧 rampart 位置会因 ERR_INVALID_TARGET 被标记为 blocked，
    // cleanTasks 清理后 mincutKeyCount 归零，自然触发重算。
    if (mincutKeyCount > 0) {
        if (added)
            roomMem.buildQueue = queue;
        return; // rampart 任务已在队列中，无需重算 min-cut
    }
    // mincutKeyCount == 0：所有 rampart 已建成或从未创建 — 检查缓存决定是否重算。
    const cached = getMinCutCache(snapshot.roomName);
    const coreSig = computeCoreSignature(snapshot);
    // 使用缓存的出口位置。
    const exitPositions = getCachedExits(room, snapshot.roomName);
    // 核心区域格（要保护的结构）。
    const corePositions = [];
    for (const s of snapshot.spawns)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    for (const s of snapshot.extensions)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    if (snapshot.storage)
        corePositions.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
    for (const s of snapshot.towers)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    // ── 策略 1：Min-Cut（最少 rampart 完全封锁）──
    // P0-3：RCL3 跳过 min-cut — 核心结构少，扇区防御更快且够用。
    // min-cut 计算昂贵（图论算法），RCL3 的简单布局不值得这个成本。
    if (snapshot.rcl >= 4) {
        // 仅在缓存 miss 时执行昂贵的 min-cut 计算。
        let cutResult;
        if (cached && cached.signature === coreSig) {
            // 核心结构未变但 mincut key 为 0（可能任务被清理了）— 用缓存结果重新生成任务。
            cutResult = cached.result;
        }
        else {
            // 缓存 miss 或核心结构已变 — 执行 min-cut 计算。
            const terrain = room.getTerrain();
            const getTerrain = (x, y) => terrain.get(x, y) === TERRAIN_MASK_WALL;
            const computed = computeMinCutDefense(getTerrain, corePositions, exitPositions, MAX_CUT_RAMPARTS);
            cutResult = {
                rampartPositions: computed.rampartPositions,
                complete: computed.complete,
            };
            // 缓存结果。
            setMinCutCache(snapshot.roomName, {
                signature: coreSig,
                result: cutResult,
                tick: Game.time,
            });
        }
        if (cutResult.complete) {
            // Min-cut 成功：使用割集位置生成 rampart 任务。
            // 已建 rampart 位置跳过 — 缓存命中的再生成路径若不对照实建结构去重，
            // 会为已建成的割集位置重复入队（建 site 必失败 → blocked → purge →
            // 下周期再生成，幽灵任务无限 churn；core 覆盖路径同款去重，此处补齐）。
            const builtRamparts = new Set();
            for (const r of snapshot.ramparts) {
                builtRamparts.add(r.pos.x * 50 + r.pos.y);
            }
            for (let i = 0; i < cutResult.rampartPositions.length; i++) {
                const pos = cutResult.rampartPositions[i];
                if (builtRamparts.has(pos.x * 50 + pos.y))
                    continue;
                const key = `defense.mincut.${pos.x}.${pos.y}`;
                if (existingKeys.has(key))
                    continue;
                queue.push({
                    key,
                    pos: { x: pos.x, y: pos.y, roomName: snapshot.roomName },
                    structureType: STRUCTURE_RAMPART,
                    priority: 2,
                    state: "queued",
                    attempts: 0,
                    retryAt: 0,
                });
                existingKeys.add(key);
                added = true;
            }
            if (added) {
                roomMem.buildQueue = queue;
            }
            return; // min-cut 成功，不需要 fallback
        }
    }
    // ── 策略 2：扇区防御（RCL3 的主路径 / RCL4+ 的 fallback）──
    const minerals = snapshot.minerals;
    const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);
    const validationOptions = {
        completedKeys: collectCompletedKeys(queue),
        minerals,
        structureCounts: precomputeStructureCounts(snapshot),
        occupiedSet,
        obstacleSet: buildObstaclePositionSet(snapshot),
    };
    const defenseCandidates = createDefenseTasks(snapshot, exitPositions, room, validationOptions);
    for (const candidate of defenseCandidates) {
        if (existingKeys.has(candidate.key))
            continue;
        queue.push(candidateToBuildTask(candidate));
        existingKeys.add(candidate.key);
        added = true;
    }
    if (added) {
        roomMem.buildQueue = queue;
    }
}
/**
 * 核心结构 rampart 覆盖 — 在每个核心结构位置生成 rampart 任务。
 *
 * rampart 可与建筑共格，使敌方必须先拆 rampart 才能攻击建筑。
 * 用 snapshot.ramparts 去重，避免对已有 rampart 的位置重复入队。
 *
 * 覆盖范围：spawn / extension / storage / tower / link / container —
 * 这些是敌方优先攻击的高价值目标。
 *
 * 返回是否新增了任务。
 */
function addCoreRampartCoverage(queue, snapshot, existingKeys) {
    // 构建已有 rampart 位置集合（去重）
    const existingRampartPositions = new Set();
    for (const r of snapshot.ramparts) {
        existingRampartPositions.add(r.pos.x * 50 + r.pos.y);
    }
    // 核心结构位置集合
    const corePositions = [];
    for (const s of snapshot.spawns)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    for (const s of snapshot.extensions)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    if (snapshot.storage)
        corePositions.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
    for (const s of snapshot.towers)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    for (const s of snapshot.links)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    for (const s of snapshot.containers)
        corePositions.push({ x: s.pos.x, y: s.pos.y });
    let added = false;
    for (const pos of corePositions) {
        const packed = pos.x * 50 + pos.y;
        // 跳过已有 rampart 的位置
        if (existingRampartPositions.has(packed))
            continue;
        const key = `defense.core.rampart.${pos.x}.${pos.y}`;
        if (existingKeys.has(key))
            continue;
        queue.push({
            key,
            pos: { x: pos.x, y: pos.y, roomName: snapshot.roomName },
            structureType: STRUCTURE_RAMPART,
            priority: 2,
            state: "queued",
            attempts: 0,
            retryAt: 0,
        });
        existingKeys.add(key);
        added = true;
    }
    return added;
}

/**
 * 帝国姿态评估 — Strategy 层的纯函数核心。
 *
 * 解决的架构缺口：此前「何时扩张/何时收缩/何时备战」散落在各执行系统的
 * 局部门禁里（expansion 看 GCL、remote 看 RCL）— 功能上线即自动开启，
 * 帝国没有统一的战略判断。本模块把这些裁决收拢为单一姿态状态机：
 * 执行系统只消费指令，不自作主张；进攻能力未来接入时必须插进这个插座，
 * 禁止「代码写完即开战」。
 *
 * 姿态语义：
 *   develop — 固本：发展经济与 RCL，不开新远矿点、不扩张。默认姿态。
 *   expand  — 扩张：经济全面健康 + GCL 有余量 + CPU 富余 + 无近期威胁。
 *   fortify — 设防：出现敌对活动 — 暂停扩张与新远矿点，防御投资升档。
 *   war     — 战争：威胁持续超过耐心窗口且经济扛得住 — 姿态存在但
 *             当前唯一消费者是防御强度；进攻执行器建成后由此授权。
 *
 * 迁移规则（与 CPU tier 同款哲学）：
 *   升级（威胁方向）立即生效 — 紧急旁路，不等驻留期；
 *   降级（安全方向）需要静默期 + 最短驻留期 — 滞回防抖。
 */
const DEFAULT_POSTURE_OPTIONS = {
    threatWindow: 10000,
    warPatience: 5000,
    minDwell: 1000,
    expandMinBucket: 7000,
    expandMaxPressure: 0.4,
    warMaxPressure: 0.4,
};
/**
 * 评估帝国姿态（纯函数，带滞回）。
 */
function evaluateEmpirePosture(input, options = DEFAULT_POSTURE_OPTIONS) {
    const { tick, rooms, gclLevel, bucket, prev } = input;
    // ── 世界状态信号 ──
    const threatRecent = rooms.some(r => r.lastHostileAt !== undefined && tick - r.lastHostileAt < options.threatWindow);
    const avgPressure = rooms.length > 0
        ? rooms.reduce((sum, r) => sum + r.economyPressure, 0) / rooms.length
        : 1;
    const allNormal = rooms.length > 0 && rooms.every(r => r.colonyState === "normal");
    const gclHeadroom = gclLevel > rooms.length;
    const prevPosture = prev?.posture ?? "develop";
    const since = prev?.since ?? tick;
    const dwellElapsed = tick - since;
    // ── 威胁升级：立即生效（紧急旁路，不等驻留期）──
    if (threatRecent) {
        // fortify 持续超过耐心窗口且经济扛得住 → 战争姿态。
        // 注意：war 的授权来自「持续被打 + 打得起」的证据链，
        // 与是否存在进攻代码无关 — 执行器必须听姿态的，反之不成立。
        if ((prevPosture === "fortify" || prevPosture === "war") &&
            dwellElapsed >= options.warPatience &&
            avgPressure <= options.warMaxPressure) {
            return finalize("war", prevPosture, since, tick);
        }
        if (prevPosture === "war") {
            return finalize("war", prevPosture, since, tick);
        }
        return finalize("fortify", prevPosture, since, tick);
    }
    // ── 威胁消退：降级需要最短驻留期（滞回防抖）──
    if (prevPosture === "fortify" || prevPosture === "war") {
        if (dwellElapsed < options.minDwell) {
            return finalize(prevPosture, prevPosture, since, tick);
        }
        // 静默期满 — 回落到固本（不直接跳 expand，先确认经济恢复节奏）。
        return finalize("develop", prevPosture, since, tick);
    }
    // ── 和平姿态选择：expand 需要全面健康 ──
    const canExpand = gclHeadroom &&
        allNormal &&
        bucket >= options.expandMinBucket &&
        avgPressure <= options.expandMaxPressure;
    return finalize(canExpand ? "expand" : "develop", prevPosture, since, tick);
}
/** 组装结果：姿态变更时刷新 since，并派生各域指令。 */
function finalize(posture, prevPosture, prevSince, tick) {
    const since = posture === prevPosture ? prevSince : tick;
    return {
        posture,
        since,
        expansionAllowed: posture === "expand",
        newRemoteOpsAllowed: posture === "develop" || posture === "expand",
    };
}

const empireStrategySystem = {
    name: "empire-strategy",
    priority: 1,
    interval: 1,
    run(ctx) {
        // 采集各房战略输入（room-state P0 已在本 tick 更新过这些字段）。
        const rooms = [];
        for (const snapshot of ctx.snapshots()) {
            const roomMem = Memory.rooms[snapshot.roomName];
            if (!roomMem)
                continue;
            rooms.push({
                colonyState: roomMem.colonyState ?? "normal",
                economyPressure: roomMem.economyPressure ?? 0,
                lastHostileAt: roomMem.lastHostileAt,
                rcl: snapshot.rcl,
            });
        }
        if (!Memory.kernel)
            Memory.kernel = {};
        const prev = Memory.kernel.strategy;
        const result = evaluateEmpirePosture({
            tick: ctx.tick,
            rooms,
            gclLevel: Game.gcl?.level ?? 1,
            bucket: Game.cpu.bucket ?? 10000,
            prev: prev ? { posture: prev.posture, since: prev.since } : undefined,
        });
        // 姿态变更时打日志 — 战略转向是帝国级事件，必须可观测。
        if (prev?.posture !== result.posture) {
            console.log(`[${ctx.tick}] strategy: posture ${prev?.posture ?? "(none)"} → ${result.posture}` +
                ` (rooms=${rooms.length}, gcl=${Game.gcl?.level ?? 1}, bucket=${Game.cpu.bucket ?? "?"})`);
        }
        Memory.kernel.strategy = {
            posture: result.posture,
            since: result.since,
            expansionAllowed: result.expansionAllowed,
            newRemoteOpsAllowed: result.newRemoteOpsAllowed,
        };
    },
};

/** 孵化请求的 body 模板和生成约束。 */
/**
 * 按角色 → 档位索引的 body 目录。
 * 从高到低尝试各档位，第一个满足 energyCapacityAvailable 的即为选中结果。
 * "recovery" 档位始终可在 200 能量内生成，用于 P0 紧急孵化。
 *
 * 使用字符串字面量而非 Screeps 全局常量（WORK, CARRY, MOVE），
 * 使模块在无 Screeps 运行时的情况下也可测试。
 */
const BODY_TEMPLATES = {
    worker: [
        // 开局优化：RCL1 起始 300 能量直接用满，2 WORK 采集速度翻倍，大幅缩短 bootstrap。
        { parts: ["work", "work", "carry", "move"], minCapacity: 300 },
        { parts: ["work", "carry", "move"], minCapacity: 200 },
    ],
    harvester: [
        // 站桩矿工：5 WORK 恰好匹配 source 再生速率 (3000/300=10/tick)，1 MOVE 仅用于通勤到工位。
        // 每多 1 WORK 成本 +100，按容量平滑降级（1W=200 / 2W=300 / 3W=400 / 4W=500 / 5W=600），
        // 避免低容量时卡在 1 WORK（2/tick，远低于 source 再生）拖垮经济。
        { parts: ["work", "work", "work", "work", "work", "carry", "move"], minCapacity: 600 },
        { parts: ["work", "work", "work", "work", "carry", "move"], minCapacity: 500 },
        { parts: ["work", "work", "work", "carry", "move"], minCapacity: 400 },
        { parts: ["work", "work", "carry", "move"], minCapacity: 300 },
        { parts: ["work", "carry", "move"], minCapacity: 200 },
    ],
    hauler: [
        // RCL3+ 大运力档：同样吞吐用更少 creep，省 CPU/寻路/spawn 孵化窗。
        {
            parts: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move"],
            minCapacity: 600,
        },
        // 300–599 补档：RCL2（容量 550）正是流动性陷阱高发期，
        // 卡在 3C 档只有 150 运力是搬运短板 — 断档会放大 colonyState 振荡。
        { parts: ["carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move"], minCapacity: 500 },
        { parts: ["carry", "carry", "carry", "carry", "move", "move", "move", "move"], minCapacity: 400 },
        { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
        { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
    ],
    distributor: [
        // 与 hauler 相同的 body — 纯 CARRY+MOVE 物流角色。
        // 从 storage 取能分发给 spawn/extension/tower，同样需要大运力 + 道路满速。
        {
            parts: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move"],
            minCapacity: 600,
        },
        { parts: ["carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move"], minCapacity: 500 },
        { parts: ["carry", "carry", "carry", "carry", "move", "move", "move", "move"], minCapacity: 400 },
        { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
        { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
    ],
    upgrader: [
        // 站桩升级：1 CARRY 承接 withdraw，2 MOVE 通勤，其余全 WORK。
        // [15W] @1650：RCL5(1800) 起可孵；RCL8 时单 creep 恰好顶满官方 15 energy/tick 上限。
        {
            parts: [
                "work", "work", "work", "work", "work", "work", "work", "work",
                "work", "work", "work", "work", "work", "work", "work",
                "carry", "move", "move",
            ],
            minCapacity: 1650,
        },
        // [8W,1C,2M] @950：RCL4(1300) 主力档。
        {
            parts: ["work", "work", "work", "work", "work", "work", "work", "work", "carry", "move", "move"],
            minCapacity: 950,
        },
        // [4W] @500：RCL2-3(550/800) 过渡档。
        { parts: ["work", "work", "work", "work", "carry", "move"], minCapacity: 500 },
        { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
        { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
        { parts: ["work", "carry", "move"], minCapacity: 200 },
    ],
    builder: [
        // [8W,4C,6M] @1300：RCL4 主力档。MOVE ≥ 非 MOVE/2，道路上满速；
        // 大工地（storage/tower）几下拍完，减少往返取能次数。
        {
            parts: [
                "work", "work", "work", "work", "work", "work", "work", "work",
                "carry", "carry", "carry", "carry",
                "move", "move", "move", "move", "move", "move",
            ],
            minCapacity: 1300,
        },
        // [4W,2C,3M] @650：RCL3(800) 过渡档。
        {
            parts: ["work", "work", "work", "work", "carry", "carry", "move", "move", "move"],
            minCapacity: 650,
        },
        { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
        { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
        { parts: ["work", "carry", "move"], minCapacity: 200 },
    ],
    remoteHarvester: [
        // [5W,1C,3M] @750：与本地 harvester 相同的 5W 站桩矿工配置，
        // 加 2 个额外 MOVE 保证跨房通勤效率（无道路时仍可移动）。
        { parts: ["work", "work", "work", "work", "work", "carry", "move", "move", "move"], minCapacity: 750 },
        // [3W,1C,2M] @450：中容量档。
        { parts: ["work", "work", "work", "carry", "move", "move"], minCapacity: 450 },
        // [2W,1C,2M] @350：低容量回退。
        { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
        { parts: ["work", "carry", "move"], minCapacity: 200 },
    ],
    remoteHauler: [
        // 与 hauler 相同的 CARRY+MOVE 配置，但额外 MOVE 保证跨房无道路时可行进。
        { parts: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move", "move", "move"], minCapacity: 800 },
        { parts: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move"], minCapacity: 600 },
        { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
        { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
    ],
    reserver: [
        // [CLAIM,MOVE] @650：最小占领配置。1 CLAIM = 600 能量。
        // reserveController 每 tick 续期 1 tick，1 个 CLAIM 部件即满足需求。
        { parts: ["claim", "move"], minCapacity: 650 },
    ],
    claimer: [
        // [CLAIM,MOVE,MOVE] @700：扩张占领投送。多 1 MOVE 加速跨房长途通勤 —
        // CLAIM creep 寿命仅 600 tick，路上每省 1 tick 都是占领窗口。
        { parts: ["claim", "move", "move"], minCapacity: 700 },
        { parts: ["claim", "move"], minCapacity: 650 },
    ],
    remoteDefender: [
        // [ATTACK,ATTACK,MOVE,MOVE] @520：20 damage/tick，10 tick 击杀 NPC reserver（200 hits）。
        // NPC reserver 通常只有 [CLAIM,MOVE]，无攻击能力 → defender 不会受伤。
        { parts: ["attack", "attack", "move", "move"], minCapacity: 520 },
        // [ATTACK,MOVE] @130：最小配置，10 damage/tick，20 tick 击杀 NPC reserver。
        { parts: ["attack", "move"], minCapacity: 130 },
    ],
    defender: [
        // 本房防御者：与塔协同贴脸输出。1:1 ATTACK:MOVE 保证无路面也能追击。
        // [10A,10M] @1300：RCL5+ 主力档，300 damage/tick。
        {
            parts: [
                "attack", "attack", "attack", "attack", "attack",
                "attack", "attack", "attack", "attack", "attack",
                "move", "move", "move", "move", "move",
                "move", "move", "move", "move", "move",
            ],
            minCapacity: 1300,
        },
        // [6A,6M] @780：RCL3-4 档。
        { parts: ["attack", "attack", "attack", "attack", "attack", "attack", "move", "move", "move", "move", "move", "move"], minCapacity: 780 },
        // [4A,4M] @520：RCL2-3 档。
        { parts: ["attack", "attack", "attack", "attack", "move", "move", "move", "move"], minCapacity: 520 },
        // [2A,2M] @260：早期最小可用防御。
        { parts: ["attack", "attack", "move", "move"], minCapacity: 260 },
        // [A,M] @130：绝境档 — 有防御总比没有强。
        { parts: ["attack", "move"], minCapacity: 130 },
    ],
};
/**
 * 道路优化 body 变体（约束 HA-10）。
 * RCL4+ 核心物流路已铺设时使用：1 MOVE 可在道路上带动 2 CARRY（fatigue-free）。
 * 道路未覆盖时使用默认模板保证移动效率。
 * 按容量从高到低选档：同样吞吐用更少 creep，省 CPU 与 spawn 孵化窗。
 */
const ROAD_OPTIMIZED_BODIES = {
    hauler: [
        // [16C,8M] @1200：RCL4(1300) 顶档。
        {
            parts: [
                "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
                "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
                "move", "move", "move", "move", "move", "move", "move", "move",
            ],
            minCapacity: 1200,
        },
        // [8C,4M] @600：RCL3(800) 档。
        {
            parts: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move"],
            minCapacity: 600,
        },
        { parts: ["carry", "carry", "carry", "carry", "move", "move"], minCapacity: 300 },
    ],
    distributor: [
        // 与 hauler 相同的道路优化 body。
        {
            parts: [
                "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
                "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
                "move", "move", "move", "move", "move", "move", "move", "move",
            ],
            minCapacity: 1200,
        },
        {
            parts: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move"],
            minCapacity: 600,
        },
        { parts: ["carry", "carry", "carry", "carry", "move", "move"], minCapacity: 300 },
    ],
};
/** P0 恢复用的最小可用 body — 始终为 [WORK, CARRY, MOVE]，成本 200 能量。 */
const RECOVERY_BODY = ["work", "carry", "move"];
/** 各 body 部件的成本。使用与 BodyPartConstant 值匹配的字符串键。 */
const PART_COST = {
    move: 50,
    work: 100,
    carry: 50,
    attack: 80,
    ranged_attack: 150,
    heal: 250,
    claim: 600,
    tough: 10,
};
function bodyCost(body) {
    return body.reduce((sum, part) => sum + (PART_COST[part] ?? 0), 0);
}
/**
 * 选择适合 spawn 能量容量的最佳 body。
 * 最后回退到恢复 body，确保 P0 孵化不会因 body 选择而阻塞。
 *
 * options.rcl：RCL4+ 时 hauler 优先使用道路优化变体（约束 HA-10）。
 */
function selectBody(role, energyCapacityAvailable, options) {
    // RCL4+ 核心物流路已铺设时，hauler 使用道路优化变体。
    if (options?.rcl !== undefined && options.rcl >= 4) {
        const roadTiers = ROAD_OPTIMIZED_BODIES[role];
        if (roadTiers) {
            for (const t of roadTiers) {
                if (energyCapacityAvailable >= t.minCapacity)
                    return [...t.parts];
            }
        }
    }
    const templates = BODY_TEMPLATES[role];
    if (templates) {
        for (const t of templates) {
            if (energyCapacityAvailable >= t.minCapacity)
                return [...t.parts];
        }
    }
    return [...RECOVERY_BODY];
}
/**
 * 将 body 降级以适应当前可用能量。
 * 每次移除最贵的可移除部件（优先砍 WORK=100，保留 CARRY/MOVE），
 * 直到成本满足或无可移除部件。至少保留 requiredParts 中每种各一个。
 * 默认要求 [WORK, CARRY, MOVE]；hauler 等纯 CARRY+MOVE 角色可传入 ["carry", "move"]。
 * 如果连最小 body 也无法满足，返回 undefined（调用方应推迟请求）。
 */
function degradeBody(body, energyAvailable, requiredParts = ["work", "carry", "move"]) {
    const parts = [...body];
    while (bodyCost(parts) > energyAvailable) {
        // 统计每种部件当前数量。
        const counts = new Map();
        for (const p of parts)
            counts.set(p, (counts.get(p) ?? 0) + 1);
        // 找最贵的可移除部件（移除后该类型数量仍 >= 所需最低数量）。
        let worstIdx = -1;
        let worstCost = -1;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            const cost = PART_COST[p] ?? 0;
            if (cost < worstCost)
                continue;
            // 检查移除后是否仍满足 requiredParts 约束。
            const isRequired = requiredParts.includes(p);
            const currentCount = counts.get(p) ?? 0;
            if (isRequired && currentCount <= 1)
                continue; // 最后一个不可移除
            worstIdx = i;
            worstCost = cost;
        }
        if (worstIdx === -1)
            break; // 无可移除部件
        parts.splice(worstIdx, 1);
    }
    // 确保最小可用组合：包含所有 requiredParts。
    for (const part of requiredParts) {
        if (!parts.includes(part))
            return undefined;
    }
    if (bodyCost(parts) > energyAvailable)
        return undefined;
    return parts;
}

/**
 * 从各 sponsor 房的邻居情报中评选扩张目标。
 * 返回最优候选；无可行目标（或 GCL 无余量）返回 undefined。
 */
function selectExpansionTarget(input) {
    const { ownedRoomNames, gclLevel, intelBySponsor, tick, blacklist, maxIntelAge = 10000 } = input;
    // GCL 余量门禁：可占房数 = GCL 等级。
    if (gclLevel <= ownedRoomNames.length)
        return undefined;
    const owned = new Set(ownedRoomNames);
    let best;
    for (const [sponsor, intel] of Object.entries(intelBySponsor)) {
        for (const [roomName, info] of Object.entries(intel)) {
            if (owned.has(roomName))
                continue;
            // 只考虑可 claim 的普通房。
            if (info.kind !== "normal")
                continue;
            if (info.status !== "normal")
                continue;
            // 有主房不碰（占领 ≠ 宣战）。
            if (info.owner)
                continue;
            // 必须有过视野 — sources 未知即盲区，claim 不赌。
            if (info.sources === undefined)
                continue;
            if (info.sources < 1)
                continue;
            // 情报过期不可信。
            const age = tick - info.lastSeen;
            if (age > maxIntelAge)
                continue;
            // 危险冷却中的房不选（威胁刚出现过 — 拓荒编队会被白吃）。
            if (info.dangerUntil !== undefined && tick < info.dangerUntil)
                continue;
            // 有敌塔的房不选：塔会点杀 claimer 与拓荒者，claim 变成送葬。
            if ((info.towers ?? 0) > 0)
                continue;
            // 黑名单冷却。
            const retryAt = blacklist?.[roomName];
            if (retryAt !== undefined && tick < retryAt)
                continue;
            // 评分：source 数主导 + 新鲜度修正（满分 100，线性衰减到 0）。
            const freshness = Math.max(0, 100 - (age / maxIntelAge) * 100);
            const score = info.sources * 1000 + freshness;
            if (!best || score > best.score) {
                best = { roomName, sponsorRoom: sponsor, score, sources: info.sources };
            }
        }
    }
    return best;
}

/**
 * 孵化队列操作 — 管理 SpawnRequest 列表的纯函数。
 * 队列存储在 RoomMemory.spawnQueue 中，是孵化意图的唯一来源。
 */
/** 通过稳定 key 将请求合并到队列。已有请求更新而非重复。 */
function submitRequest(queue, request) {
    const existing = queue.find(r => r.key === request.key);
    if (existing) {
        // 更新字段但保留创建时间和重试次数。
        existing.role = request.role;
        existing.home = request.home;
        existing.priority = request.priority;
        existing.body = request.body;
        existing.memory = request.memory;
        existing.expiresAt = request.expiresAt;
        existing.replaceBy = request.replaceBy;
    }
    else {
        queue.push({ ...request });
    }
}
/**
 * 撤销指定房间内某角色的所有待处理请求，返回移除数量。
 *
 * 请求撤销通道：队列请求的常规出队路径只有孵化成功 / TTL 过期 / 重试隔离，
 * 需求前提消失（如威胁清除后的 defender、状态翻转后的 upgrader）时，
 * 残留请求会在 TTL 窗口（最长 1000 tick）内继续被孵化 — 幽灵需求浪费能量。
 * 调用方在每 tick 需求评估前按当前世界状态主动撤销。
 */
function removeRequestsByRole(queue, role, home) {
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const req = queue[i];
        if (req && req.role === role && req.home === home) {
            queue.splice(i, 1);
            removed++;
        }
    }
    return removed;
}
/** 按优先级升序排序（P0 在前），有 replaceBy 的替换请求优先，然后按 createdAt 升序排序。 */
function sortQueue(queue) {
    return queue.sort((a, b) => {
        if (a.priority !== b.priority)
            return a.priority - b.priority;
        // X-17：有 replaceBy 的替换请求优先于普通请求。
        const aReplace = a.replaceBy !== undefined ? 0 : 1;
        const bReplace = b.replaceBy !== undefined ? 0 : 1;
        if (aReplace !== bReplace)
            return aReplace - bReplace;
        return a.createdAt - b.createdAt;
    });
}
/** 检查队列中是否已存在某 key 的请求。 */
function hasRequest(queue, key) {
    return queue.some(r => r.key === key);
}
/** 移除过期请求（createdAt + TTL < now）和隔离请求（retries > max）。 */
function cleanQueue(queue, tick, maxRetries) {
    for (let i = queue.length - 1; i >= 0; i--) {
        const req = queue[i];
        if (!req)
            continue;
        if (req.retries >= maxRetries) {
            queue.splice(i, 1);
            continue;
        }
        if (req.expiresAt && tick > req.expiresAt) {
            queue.splice(i, 1);
        }
    }
}
/** 统计房间内某角色的待处理请求数（不含孵化中）。
 *
 * 可选 home 过滤：sponsor 房代孵他房 creep（扩张拓荒）时，请求寄宿在
 * sponsor 队列但 home 指向目标房 — 不过滤会污染 sponsor 自身的人口预算。
 */
function countPending(queue, role, home) {
    return queue.filter(r => r.role === role && (home === undefined || r.home === home)).length;
}
/** 构建稳定去重 key：role:room:source?:index */
function spawnKey(role, home, index, sourceId) {
    return sourceId
        ? `${role}:${home}:${sourceId}:${index}`
        : `${role}:${home}:${index}`;
}

/**
 * 地形分析 — Distance Transform 计算房间开放度。
 *
 * Distance Transform 为每个非墙格赋值"到最近墙/边界的距离"，
 * 值越大 = 周围越开阔 = 越适合放置核心建筑群。
 *
 * 算法：Chamfer 3-4 近似距离变换（两遍扫描）。
 *   - 正交方向代价 3，对角方向代价 4（近似欧氏距离 ×3）
 *   - 前向扫描（左上→右下）：传播上/左/左上/右上邻居
 *   - 后向扫描（右下→左上）：传播下/右/左下/右下邻居
 *   - 最终值 ÷3 归一化为整数格距离
 *
 * CPU 成本：O(50×50) = 2500 次比较/赋值 ≈ 0.01ms，可忽略。
 * 缓存策略：地形永不变，每房计算一次后存入 RawMemory segment。
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */
/** 墙/边界初始值（足够大，两遍扫描后会被正确距离替代）。 */
const INF = 200;
/**
 * 计算房间的 Chamfer 3-4 Distance Transform。
 *
 * @param getTerrain 地形查询函数 (x,y) → 是否墙。
 *   注入而非直接传 RoomTerrain，使模块可在 Vitest 中无 Screeps 全局运行。
 * @returns DistanceField (Uint8Array, length 2500)
 */
function computeDistanceField(getTerrain) {
    const field = new Uint8Array(2500);
    // 初始化：墙/边界 = 0，开放格 = INF
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const isWall = x === 0 || x === 49 || y === 0 || y === 49 || getTerrain(x, y);
            field[x * 50 + y] = isWall ? 0 : INF;
        }
    }
    // 前向扫描（左上→右下）
    for (let x = 1; x < 49; x++) {
        for (let y = 1; y < 49; y++) {
            const i = x * 50 + y;
            if (field[i] === 0)
                continue;
            // 上（正交 +3）、左（正交 +3）、左上（对角 +4）、右上（对角 +4）
            const up = field[(x - 1) * 50 + y] + 3;
            const left = field[x * 50 + (y - 1)] + 3;
            const upLeft = field[(x - 1) * 50 + (y - 1)] + 4;
            const upRight = field[(x + 1) * 50 + (y - 1)] + 4;
            const min = Math.min(field[i], up, left, upLeft, upRight);
            field[i] = min;
        }
    }
    // 后向扫描（右下→左上）
    for (let x = 48; x >= 1; x--) {
        for (let y = 48; y >= 1; y--) {
            const i = x * 50 + y;
            if (field[i] === 0)
                continue;
            // 下（正交 +3）、右（正交 +3）、左下（对角 +4）、右下（对角 +4）
            const down = field[(x + 1) * 50 + y] + 3;
            const right = field[x * 50 + (y + 1)] + 3;
            const downLeft = field[(x - 1) * 50 + (y + 1)] + 4;
            const downRight = field[(x + 1) * 50 + (y + 1)] + 4;
            const min = Math.min(field[i], down, right, downLeft, downRight);
            field[i] = min;
        }
    }
    // 归一化：÷3（正交距离单位），截断到 [0, 255]
    for (let i = 0; i < 2500; i++) {
        field[i] = Math.min(Math.floor(field[i] / 3), 255);
    }
    return field;
}
/** 查询某格的开放度（到最近墙的格距离）。越界返回 0。 */
function opennessAt(field, x, y) {
    if (x < 0 || x >= 50 || y < 0 || y >= 50)
        return 0;
    return field[x * 50 + y] ?? 0;
}
/**
 * 计算以 (cx,cy) 为中心、radius 为半径的方形区域内被墙/边界阻挡的格数。
 * 用于锚点评分 — blockedCells 越少 = 核心模板落地越顺利。
 */
function countBlockedCells(cx, cy, radius, getTerrain) {
    let blocked = 0;
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) {
                blocked++;
                continue;
            }
            if (getTerrain(x, y))
                blocked++;
        }
    }
    return blocked;
}

/**
 * 约束推导锚点选择 — 从地形约束推导最优核心位置。
 *
 * 设计哲学（plan §5.6）：
 *   布局从约束推导，而非套用固定模板。锚点是布局的根基——
 *   选错锚点 = 核心区域被墙切割 = 大量 relocation = 物流效率崩塌。
 *
 * 当前状态（Phase 3）：
 *   本模块只做"诊断评分"——评估已有锚点（spawn 位置）的质量，
 *   不改变运行时行为。Phase 4 才启用约束推导放置。
 *
 * 评分维度：
 *   - openness：核心区域平坦度（Distance Transform 值）
 *   - avgSourceDist：到所有 source 的平均曼哈顿距离（hauler 通勤）
 *   - controllerDist：到 controller 的距离（升级通勤，link 前重要）
 *   - exitDistance：到最近出口的距离（防御纵深）
 *   - blockedCells：核心 7×7 区域内被墙/边界阻挡的格数
 *   - mineralDist：到 mineral 的距离（RCL6+ 相关）
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */
/** 默认权重 — 地形平坦度最重要，blockedCells 强惩罚。 */
const DEFAULT_WEIGHTS = {
    openness: 5,
    sourceDist: -2,
    controllerDist: -1.5,
    exitDistance: 2,
    blockedCells: -3,
    mineralDist: -0.5,
};
/**
 * 评分公式：加权线性组合。
 * score = w.openness * openness + w.sourceDist * avgSourceDist + ...
 * 分数越高越好。
 */
function scoreAnchor(c, w = DEFAULT_WEIGHTS) {
    return (w.openness * c.openness
        + w.sourceDist * c.avgSourceDist
        + w.controllerDist * c.controllerDist
        + w.exitDistance * c.exitDistance
        + w.blockedCells * c.blockedCells
        + w.mineralDist * c.mineralDist);
}
/**
 * 评估单个位置的锚点质量（不搜索，只评分）。
 * 用于诊断已有 spawn 位置。
 */
function evaluateAnchorAt(x, y, input, weights = DEFAULT_WEIGHTS) {
    const { field, sources, controller, exits, mineral, getTerrain } = input;
    const openness = opennessAt(field, x, y);
    let avgSourceDist = 0;
    if (sources.length > 0) {
        let total = 0;
        for (const s of sources)
            total += Math.abs(s.x - x) + Math.abs(s.y - y);
        avgSourceDist = total / sources.length;
    }
    else {
        avgSourceDist = 25; // 无 source 时给中性值
    }
    const controllerDist = controller
        ? Math.abs(controller.x - x) + Math.abs(controller.y - y)
        : 25;
    let exitDistance = 50;
    for (const e of exits) {
        const d = Math.abs(e.x - x) + Math.abs(e.y - y);
        if (d < exitDistance)
            exitDistance = d;
    }
    const mineralDist = mineral
        ? Math.abs(mineral.x - x) + Math.abs(mineral.y - y)
        : 25;
    const blockedCells = countBlockedCells(x, y, 3, getTerrain);
    const constraint = {
        openness, avgSourceDist, controllerDist, exitDistance, blockedCells, mineralDist,
    };
    return { x, y, ...constraint, score: scoreAnchor(constraint, weights) };
}
/**
 * 从 DistanceField 中搜索并排序候选锚点。
 *
 * 筛选条件：
 *   1. openness >= minOpenness（默认 4，约 4 格半径无墙）
 *   2. 边界内 [bounds]（默认 [5,44]）
 *   3. 不占 source/controller/mineral
 *
 * CPU 成本：O(40×40) 候选 × O(7×7) blockedCells = ~8000 次比较。
 * 只在首次规划时执行一次，后续从 Memory 读取。
 */
function selectAnchors(input) {
    const { field, sources, controller, exits, mineral, getTerrain, weights = DEFAULT_WEIGHTS, bounds = { minX: 5, maxX: 44, minY: 5, maxY: 44 }, minOpenness = 4, maxCandidates = 5, } = input;
    // 不可占用位置
    const occupied = new Set();
    for (const s of sources)
        occupied.add(s.x * 50 + s.y);
    if (controller)
        occupied.add(controller.x * 50 + controller.y);
    if (mineral)
        occupied.add(mineral.x * 50 + mineral.y);
    const candidates = [];
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            if (occupied.has(x * 50 + y))
                continue;
            const openness = opennessAt(field, x, y);
            if (openness < minOpenness)
                continue;
            const candidate = evaluateAnchorAt(x, y, { field, sources, controller, exits, mineral, getTerrain }, weights);
            candidates.push(candidate);
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, maxCandidates);
}
/**
 * 诊断：评估已有锚点在候选列表中的排名。
 * 返回 { rank, total, candidate } — rank 从 1 开始。
 * 如果已有锚点不满足 minOpenness，rank = -1（不合格）。
 */
function diagnoseAnchor(currentX, currentY, input) {
    const current = evaluateAnchorAt(currentX, currentY, input, input.weights);
    const all = selectAnchors(input);
    // 找当前锚点在排序列表中的位置
    let rank = -1;
    for (let i = 0; i < all.length; i++) {
        if (all[i].score <= current.score) {
            rank = i + 1;
            break;
        }
    }
    if (rank === -1)
        rank = all.length + 1; // 比所有候选都差
    return { rank, total: all.length, candidate: current };
}

/**
 * compact-core-v2 — 偶校验棋盘格核心模板（修复 v1 的全密封实心块缺陷）。
 *
 * 锚点为已有主 spawn 的位置 (0,0)。所有结构以相对偏移定位。
 *
 * v1 的教训（P0 缺陷）：v1 把结构排成实心块，全建成后 29/68 个结构 8 邻居全被
 * 障碍堵死 —— 三个 spawn 出生格为 0（无法孵化）、storage 无法存取、塔无法补能、
 * 22 个 extension 永远无法填充。transfer/spawnCreep 射程均为 1，
 * 「每个结构至少 1 个相邻可站格」是不可妥协的几何约束。
 *
 * v2 设计原则：
 *   1. **偶校验棋盘格**：所有结构只落在 (dx+dy) 为偶数的格子上，
 *      奇数格永远留空作走道 —— 每个结构天然拥有 4 个正交可站格，
 *      从几何上不可能形成密封（建筑孤岛）。
 *   2. **spawn 出生格**：每个 spawn 的 4 个正交邻居均为奇校验走道格，
 *      spawnCreep 永远有处可去。
 *   3. extension 按到锚点距离分环分配 RCL 批次，内密外疏；
 *      RCL8 环扩到 ±6（棋盘格密度约 50%，69 个结构需要更大占地）。
 *   4. 该模板的几何不变量由 tests/layout-v2.test.ts 永久守护：
 *      任何 cell 修改若制造密封，测试立即失败。
 *
 * 结构数量限制（CONTROLLER_STRUCTURES）：
 *   extension: RCL2=5, RCL3=10, RCL4=20, RCL5=30, RCL6=40, RCL7=50, RCL8=60
 *   tower:     RCL3=1, RCL5=2, RCL7=3
 *   storage:   RCL4=1 / link: RCL5=2, RCL6=3 / spawn: RCL7=2, RCL8=3
 */
function cell(key, dx, dy, structureType, minRcl, phase, priority, tags, requires) {
    return { key, dx, dy, structureType, minRcl, phase, priority, tags, requires };
}
const COMPACT_CORE_V2 = {
    id: "compact-core-v2",
    anchorKind: "primary-spawn",
    cells: [
        // ── RCL2: 第一批 5 个 extension（锚点四角 + 东侧）──
        cell("core.ext.01", -1, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
        cell("core.ext.02", 1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
        cell("core.ext.03", -1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
        cell("core.ext.04", 2, 0, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
        cell("core.ext.05", 3, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
        // ── RCL3: 补充 5 个 extension（共 10），加第 1 个 tower ──
        cell("core.ext.06", 1, 3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
        cell("core.ext.07", -3, 1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
        cell("core.ext.08", -1, 3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
        cell("core.ext.09", 3, -1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
        cell("core.ext.10", -1, -3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
        cell("core.tower.01", 2, 2, STRUCTURE_TOWER, 3, "rcl3", 0, ["defense", "core"]),
        // ── RCL4: 补充 10 个 extension（共 20），加 storage ──
        cell("core.ext.11", 1, -3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.12", -3, -1, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.13", 3, 3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.14", -3, 3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.15", 3, -3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.16", -3, -3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.17", 4, 0, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.18", 0, 4, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.19", -4, 0, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.ext.20", 0, -4, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
        cell("core.storage.01", 0, 2, STRUCTURE_STORAGE, 4, "rcl4", 0, ["core", "logistics"]),
        // ── Late (RCL5): 补充 10 个 extension（共 30），加 tower2 / link1 ──
        cell("core.ext.21", 4, 2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.22", 2, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.23", -2, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.24", -4, 2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.25", 4, -2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.26", 2, -4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.27", -4, -2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.28", -2, -4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.29", 4, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.ext.30", -4, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
        cell("core.tower.02", -2, -2, STRUCTURE_TOWER, 5, "late", 0, ["defense", "core"]),
        cell("core.link.01", 1, 1, STRUCTURE_LINK, 5, "late", 2, ["core", "logistics"], ["core.storage.01"]),
        // ── RCL6: 补充 10 个 extension（共 40），加 link2 ──
        cell("core.ext.31", 4, -4, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.32", -4, -4, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.33", 5, 1, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.34", 1, 5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.35", -5, 1, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.36", -1, 5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.37", 5, -1, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.38", -1, -5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.39", 5, 3, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        cell("core.ext.40", 3, 5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
        // core.link.02 已移除 — 原位置 (-2,2) 与 storage (0,2) Chebyshev 距离 = 2，
        // classifyLink 会将其误判为第二个 storage link，导致 RCL6 的 3 个 link 槽位
        // 分配为 2 storage + 1 source，controller link 永远无法创建。
        // 所有非核心 link 由 task-factory 按角色优先级放置（source→storage→controller）。
        // ── RCL7: 补充 10 个 extension（共 50），加 tower3 / spawn2 ──
        cell("core.ext.41", -5, 3, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.42", -3, 5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.43", 5, -3, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.44", 3, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.45", -5, -3, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.46", -3, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.47", 5, 5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.48", -5, 5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.49", 5, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.ext.50", -5, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
        cell("core.tower.03", 2, -2, STRUCTURE_TOWER, 7, "late", 0, ["defense", "core"]),
        cell("core.spawn.02", -2, 0, STRUCTURE_SPAWN, 7, "late", 1, ["core"]),
        // ── RCL8: 补充 10 个 extension（共 60，±6 外环），加 spawn3 ──
        cell("core.ext.51", 6, 0, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.52", 0, 6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.53", -6, 0, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.54", 0, -6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.55", 6, 2, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.56", 2, 6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.57", -6, 2, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.58", -2, 6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.59", 6, -2, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.ext.60", 2, -6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
        cell("core.spawn.03", 0, -2, STRUCTURE_SPAWN, 8, "rcl8", 1, ["core"]),
        // ── Industry: Terminal (RCL6) ──
        cell("core.terminal.01", 4, 6, STRUCTURE_TERMINAL, 6, "rcl6", 1, ["core", "logistics"]),
        // ── Industry: Factory (RCL7) ──
        cell("core.factory.01", -4, 6, STRUCTURE_FACTORY, 7, "rcl7", 2, ["core", "logistics"]),
        // ── Industry: Labs (RCL6: 3, RCL7: +3=6, RCL8: +4=10) ──
        // SE cluster（2 labs，可 boost）
        cell("core.lab.01", 6, 4, STRUCTURE_LAB, 6, "rcl6", 2, ["core", "industry"]),
        cell("core.lab.02", 6, 6, STRUCTURE_LAB, 6, "rcl6", 2, ["core", "industry"]),
        // NE cluster（3 labs，可反应：lab03+lab04 → lab05）
        cell("core.lab.03", 6, -4, STRUCTURE_LAB, 6, "rcl6", 2, ["core", "industry"]),
        cell("core.lab.04", 6, -6, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
        cell("core.lab.05", 4, -6, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
        // NW cluster（2 labs，可 boost）
        cell("core.lab.06", -6, 4, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
        cell("core.lab.07", -6, 6, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
        // SW cluster（3 labs，可反应：lab08+lab09 → lab10）
        cell("core.lab.08", -6, -4, STRUCTURE_LAB, 8, "rcl8", 2, ["core", "industry"]),
        cell("core.lab.09", -6, -6, STRUCTURE_LAB, 8, "rcl8", 2, ["core", "industry"]),
        cell("core.lab.10", -4, -6, STRUCTURE_LAB, 8, "rcl8", 2, ["core", "industry"]),
        // ── RCL8 终局建筑（Empire 阶段）──
        // observer: 侦察远程房间（无需 creep 在场），Empire 情报系统基础。
        cell("core.observer.01", 7, 1, STRUCTURE_OBSERVER, 8, "rcl8", 2, ["core", "defense"]),
        // powerSpawn: 处理 power（creep power 使用前提），开启 power 体系。
        cell("core.powerSpawn.01", -7, 1, STRUCTURE_POWER_SPAWN, 8, "rcl8", 1, ["core", "industry"]),
        // nuker: 跨房核打击，PvP 终局威慑武器。
        cell("core.nuker.01", 1, 7, STRUCTURE_NUKER, 8, "rcl8", 2, ["core", "defense"]),
    ],
};

/**
 * Expansion Manager — P3 系统，GCL 变现的唯一入口（claim 新房）。
 *
 * 状态机（Memory.kernel.expansion，同一时刻至多一个扩张行动）：
 *
 *   idle ──(GCL 有余量 + sponsor 房健康 + intel 有可行目标)──► claiming
 *   claiming ──(目标房 controller.my)──► pioneering（选锚点 + 写 layout）
 *   claiming ──(超时/被抢占)──► idle + 目标进黑名单冷却
 *   pioneering ──(新房 spawn 建成)──► idle（新房自治，普通系统接管）
 *   pioneering ──(超时)──► idle（房已占，仅停止编队补充）
 *
 * 架构复用（关键决策）：占领后只做一件事 — 用约束推导（distance field +
 * selectAnchors）选出锚点写入新房 layout.anchor。此后完全复用既有机器：
 *   layout-planner 的「spawn 被毁重建」路径推入 P0 spawn 任务 →
 *   construction-manager 的紧急豁免创建 site → 拓荒 builder 建造 →
 *   spawn 建成后新房自己的 demand/bootstrap 闭环接管。
 * 灾后恢复机器与殖民机器是同一台 — 不新造第二条建造管线。
 *
 * 拓荒编队：worker×N（采集/填充/升级）+ builder×N（建 spawn），
 * home 指向新房（sponsor 队列代孵，countPending 的 home 过滤保证
 * 不污染 sponsor 自身人口预算），孵化后经 ensureHome 自行走到新房。
 */
const expansionManagerSystem = {
    name: "expansion-manager",
    priority: 3,
    interval: CONFIG.expansion.interval,
    run(ctx) {
        // 扩张是纯发展行为：CPU 紧张时整体挂起。
        if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded")
            return;
        if ((Game.cpu.bucket ?? 0) < 5000)
            return;
        if (!Memory.kernel)
            Memory.kernel = {};
        const expansion = Memory.kernel.expansion;
        if (!expansion) {
            // 战略门禁：是否扩张由 empire-strategy 的姿态裁决（Strategy 层），
            // 本系统只在获得授权时评选目标 — 不自行判断「现在是不是好时机」。
            // 姿态未就绪（reset 首 tick）默认不扩张：固本是安全缺省。
            if (Memory.kernel.strategy?.expansionAllowed !== true)
                return;
            tryStartExpansion(ctx);
            return;
        }
        // 进行中的扩张行动不因姿态回落而中断 — claimer/拓荒编队已是沉没投资，
        // 半途而废比完成更贵；姿态只裁决「是否开启新行动」。
        switch (expansion.state) {
            case "claiming":
                advanceClaiming(ctx, expansion);
                break;
            case "pioneering":
                advancePioneering(ctx, expansion);
                break;
        }
    },
};
/** 把失败目标记入黑名单（冷却期内评估器不再选中）。 */
function blacklistTarget(roomName, tick) {
    var _a;
    if (!Memory.kernel)
        Memory.kernel = {};
    (_a = Memory.kernel).expansionBlacklist ?? (_a.expansionBlacklist = {});
    Memory.kernel.expansionBlacklist[roomName] = tick + CONFIG.expansion.blacklistCooldown;
}
/**
 * 召回扩张行动的存活 creep（claimer + 拓荒编队）。
 *
 * abort 只清 Memory 不触碰 creep 会留下孤儿：拓荒者 home=新房，
 * 失守后 home 房无 snapshot → role-runner 每 tick 静默 return，
 * recyclePass 按自有房遍历也覆盖不到 — 整支编队原地呆立至寿终。
 * 把 home 改回 sponsor 并标记 recycle，让既有回收链（role-runner 停工 +
 * spawn-manager recyclePass 归航）接管；同时清掉 sponsor 队列中
 * 尚未孵化的本目标请求，防止 abort 后继续送兵。
 *
 * @internal 导出仅供接线级单元测试使用，业务代码经由 abort 路径调用。
 */
function reclaimExpeditionCreeps(target, sponsor) {
    for (const creep of Object.values(Game.creeps)) {
        const mem = creep.memory;
        if (mem.home !== target && !(mem.remoteTarget === target && mem.role === "claimer"))
            continue;
        mem.home = sponsor;
        mem.remoteTarget = undefined;
        mem.assignment = undefined;
        mem.recycle = true;
    }
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (queue) {
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].home === target)
                queue.splice(i, 1);
        }
    }
}
/** 清理已到期的黑名单条目（防无限累积）。 */
function pruneBlacklist(tick) {
    const bl = Memory.kernel?.expansionBlacklist;
    if (!bl)
        return;
    for (const [room, retryAt] of Object.entries(bl)) {
        if (tick >= retryAt)
            delete bl[room];
    }
}
// ─── idle → claiming ────────────────────────────────────────
function tryStartExpansion(ctx) {
    pruneBlacklist(ctx.tick);
    // GCL 余量（测试环境无 Game.gcl 时按 1 处理 — 单房间下永远无余量，安全）。
    const gclLevel = Game.gcl?.level ?? 1;
    // sponsor 候选：经济成熟（RCL 门槛）且状态健康的自有房。
    const ownedRoomNames = [];
    const intelBySponsor = {};
    for (const snapshot of ctx.snapshots()) {
        ownedRoomNames.push(snapshot.roomName);
        if (snapshot.rcl < CONFIG.expansion.sponsorMinRcl)
            continue;
        const roomMem = Memory.rooms[snapshot.roomName];
        if (roomMem?.colonyState !== "normal")
            continue;
        if (roomMem.intel)
            intelBySponsor[snapshot.roomName] = roomMem.intel;
    }
    if (Object.keys(intelBySponsor).length === 0)
        return;
    const target = selectExpansionTarget({
        ownedRoomNames,
        gclLevel,
        intelBySponsor,
        tick: ctx.tick,
        blacklist: Memory.kernel?.expansionBlacklist,
    });
    if (!target)
        return;
    Memory.kernel.expansion = {
        state: "claiming",
        target: target.roomName,
        sponsor: target.sponsorRoom,
        startedAt: ctx.tick,
    };
    submitClaimer(target.sponsorRoom, target.roomName, ctx.tick);
    console.log(`[${ctx.tick}] expansion: claiming ${target.roomName} (sponsor=${target.sponsorRoom}, sources=${target.sources})`);
}
/** 向 sponsor 队列提交 claimer 请求（稳定 key，幂等）。 */
function submitClaimer(sponsor, target, tick) {
    const roomMem = Memory.rooms[sponsor];
    if (!roomMem)
        return;
    const queue = roomMem.spawnQueue ?? [];
    const key = `claimer:${sponsor}:${target}`;
    if (hasRequest(queue, key))
        return;
    const capacity = Game.rooms[sponsor]?.energyCapacityAvailable ?? 650;
    submitRequest(queue, {
        key,
        role: "claimer",
        home: sponsor,
        priority: 2,
        body: selectBody("claimer", capacity),
        memory: { role: "claimer", home: sponsor, mode: "acquire", remoteTarget: target },
        createdAt: tick,
        expiresAt: tick + CONFIG.spawn.requestTtl,
        retries: 0,
    });
    roomMem.spawnQueue = queue;
}
// ─── claiming → pioneering ──────────────────────────────────
function advanceClaiming(ctx, expansion) {
    const targetRoom = Game.rooms[expansion.target];
    // 占领成功 → 选锚点、写 layout、进入拓荒。
    if (targetRoom?.controller?.my) {
        if (seedLayoutAnchor(targetRoom)) {
            expansion.state = "pioneering";
            expansion.startedAt = ctx.tick;
            submitPioneers(ctx, expansion);
            console.log(`[${ctx.tick}] expansion: claimed ${expansion.target}, pioneering`);
        }
        else {
            // 无可行锚点 — 极罕见（开阔度门槛已带回退），放弃并冷却。
            console.log(`[${ctx.tick}] expansion: no viable anchor in ${expansion.target}, aborting`);
            blacklistTarget(expansion.target, ctx.tick);
            reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
            Memory.kernel.expansion = undefined;
        }
        return;
    }
    // 被他人抢占 → 立即放弃。
    if (targetRoom?.controller?.owner && !targetRoom.controller.my) {
        console.log(`[${ctx.tick}] expansion: ${expansion.target} taken by ${targetRoom.controller.owner.username}, aborting`);
        blacklistTarget(expansion.target, ctx.tick);
        reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
        Memory.kernel.expansion = undefined;
        return;
    }
    // 超时 → 放弃（claimer 迷路/被杀/GCL 边界竞争失败）。
    if (ctx.tick - expansion.startedAt > CONFIG.expansion.claimTimeout) {
        console.log(`[${ctx.tick}] expansion: claim ${expansion.target} timed out, aborting`);
        blacklistTarget(expansion.target, ctx.tick);
        reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
        Memory.kernel.expansion = undefined;
        return;
    }
    // claimer 阵亡且无 pending → 幂等重派。
    const claimerAlive = Object.values(Game.creeps).some(c => c.memory.role === "claimer" && c.memory.remoteTarget === expansion.target);
    if (!claimerAlive) {
        submitClaimer(expansion.sponsor, expansion.target, ctx.tick);
    }
}
/**
 * 用约束推导为新房选锚点并写入 layout — 之后交给既有的
 * layout-planner（spawn 重建路径）+ construction-manager（紧急豁免）。
 */
function seedLayoutAnchor(room) {
    var _a, _b;
    const terrain = room.getTerrain();
    const getTerrain = (x, y) => terrain.get(x, y) === TERRAIN_MASK_WALL;
    const field = computeDistanceField(getTerrain);
    const sources = room.find(FIND_SOURCES).map(s => ({ x: s.pos.x, y: s.pos.y }));
    const controller = room.controller
        ? { x: room.controller.pos.x, y: room.controller.pos.y }
        : undefined;
    const exits = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
    const mineral = room.find(FIND_MINERALS)[0];
    const mineralPos = mineral ? { x: mineral.pos.x, y: mineral.pos.y } : undefined;
    const base = { field, sources, controller, exits, mineral: mineralPos, getTerrain };
    // 开阔度 4 优先；地形逼仄的房间回退到 2（能放下 spawn 即可，核心可后续 relocation）。
    let candidates = selectAnchors({ ...base, maxCandidates: 1 });
    if (candidates.length === 0) {
        candidates = selectAnchors({ ...base, maxCandidates: 1, minOpenness: 2 });
    }
    const best = candidates[0];
    if (!best)
        return false;
    (_a = Memory.rooms)[_b = room.name] ?? (_a[_b] = { spawnQueue: [], buildQueue: [] });
    const roomMem = Memory.rooms[room.name];
    roomMem.layout = {
        version: 2,
        templateId: COMPACT_CORE_V2.id,
        state: "accepted",
        revision: 0,
        nextPlanTick: 0, // 立即触发首次规划。
        anchor: packPos(best.x, best.y),
        anchorScore: best.score,
    };
    return true;
}
// ─── pioneering → done ──────────────────────────────────────
function advancePioneering(ctx, expansion) {
    const targetRoom = Game.rooms[expansion.target];
    // 房间失守（被抢/降级）→ 结束行动并冷却。
    if (!targetRoom?.controller?.my) {
        console.log(`[${ctx.tick}] expansion: lost ${expansion.target} during pioneering, aborting`);
        blacklistTarget(expansion.target, ctx.tick);
        reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
        Memory.kernel.expansion = undefined;
        return;
    }
    // 完成判据：新房 spawn 建成 — 此后新房的 demand/bootstrap 闭环自治。
    if (targetRoom.find(FIND_MY_SPAWNS).length > 0) {
        console.log(`[${ctx.tick}] expansion: ${expansion.target} spawn online, expansion complete`);
        Memory.kernel.expansion = undefined;
        return;
    }
    // 超时：房已占下，仅停止编队补充（残余拓荒者继续干活至寿终）。
    if (ctx.tick - expansion.startedAt > CONFIG.expansion.pioneerTimeout) {
        console.log(`[${ctx.tick}] expansion: pioneering ${expansion.target} timed out, squad replenishment stopped`);
        Memory.kernel.expansion = undefined;
        return;
    }
    submitPioneers(ctx, expansion);
}
/** 维持拓荒编队规模（sponsor 队列代孵，稳定 key 幂等）。 */
function submitPioneers(_ctx, expansion) {
    const roomMem = Memory.rooms[expansion.sponsor];
    if (!roomMem)
        return;
    const queue = roomMem.spawnQueue ?? [];
    const capacity = Game.rooms[expansion.sponsor]?.energyCapacityAvailable ?? 300;
    const sponsorRcl = Game.rooms[expansion.sponsor]?.controller?.level ?? 4;
    // 存活计数（home 指向目标房的拓荒者）。
    const living = {};
    for (const creep of Object.values(Game.creeps)) {
        if (creep.memory.home !== expansion.target)
            continue;
        const role = creep.memory.role;
        living[role] = (living[role] ?? 0) + 1;
    }
    const squad = [
        { role: "worker", count: CONFIG.expansion.pioneerWorkers },
        { role: "builder", count: CONFIG.expansion.pioneerBuilders },
    ];
    for (const { role, count } of squad) {
        const pending = queue.filter(r => r.role === role && r.home === expansion.target).length;
        const total = (living[role] ?? 0) + pending;
        for (let i = total; i < count; i++) {
            const key = `expansion:${role}:${expansion.target}:${i}`;
            if (hasRequest(queue, key))
                continue;
            submitRequest(queue, {
                key,
                role,
                home: expansion.target, // home = 新房：孵化后 ensureHome 自行迁徙。
                priority: 2,
                body: selectBody(role, capacity, { rcl: sponsorRcl }),
                memory: { role, home: expansion.target, mode: "acquire", spawnIndex: i },
                createdAt: Game.time,
                expiresAt: Game.time + CONFIG.spawn.requestTtl,
                retries: 0,
            });
        }
    }
    roomMem.spawnQueue = queue;
}

/**
 * Factory Manager — P3 系统，RCL7-8 终局结构的最小运营层。
 *
 * 职责：
 *   1. Factory：storage 满仓时把过剩能量压缩为 battery（600 energy → 50 battery，
 *      冷却 10 tick）。满仓意味着能量在源头被 harvester drop 浪费 —
 *      压缩把「必然损失」转为可存储/可交易的资产（battery 解压回收率 5/6）。
 *      解压（能量紧缺时 battery → energy）留待跨房调度阶段接入。
 *   2. PowerSpawn：有 power 与能量存货时 processPower（1 power + 50 energy/次），
 *      积累 GPL。power 采集（power bank）属更后期能力 — 当前 power 来源
 *      仅限 terminal 转入，无存货时本分支零开销跳过。
 *
 * 能量补给：factory 的原料能量由 distributor 的 stockFactoryEnergy 在
 * storage 满仓信号下搬运（见 actions/industry.ts）。
 */
/** processPower 单次消耗的能量（引擎常量 POWER_SPAWN_ENERGY_RATIO）。 */
const POWER_PROCESS_ENERGY = 50;
const factoryManagerSystem = {
    name: "factory-manager",
    priority: 3,
    interval: CONFIG.factory.interval,
    run(ctx) {
        for (const snapshot of ctx.snapshots()) {
            // ── PowerSpawn：GPL 涓流 ──
            const powerSpawn = snapshot.powerSpawn;
            if (powerSpawn &&
                typeof powerSpawn.processPower === "function" &&
                powerSpawn.store.getUsedCapacity(RESOURCE_POWER) >= 1 &&
                powerSpawn.store.getUsedCapacity(RESOURCE_ENERGY) >= POWER_PROCESS_ENERGY) {
                powerSpawn.processPower();
            }
            // ── Factory：满仓能量压缩 ──
            const factory = snapshot.factory;
            if (!factory)
                continue;
            // 测试/私服环境的 factory mock 可能无 produce — 安全跳过。
            if (typeof factory.produce !== "function")
                continue;
            if (factory.cooldown > 0)
                continue;
            // 仅在 storage 满仓（能量正在源头被浪费）时压缩 — 正常水位下
            // 能量应流向 upgrade/build，压缩的 1/6 折损划不来。
            if (Memory.rooms[snapshot.roomName]?.storageNearFull !== true)
                continue;
            if (factory.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.factory.batchEnergy)
                continue;
            factory.produce(RESOURCE_BATTERY);
        }
    },
};

const DEFAULT_ROAD_OPTIONS = {
    // 修复：旧值 10 对 RCL2-3 太严（2 个 hauler 时每格每窗口仅 ~3-6 次通行），
    // 导致最该修路的早期修不出路，hauler 白跑上万 tick plain。降到 5 让早期道路成型。
    // 双窗口要求保留（防瞬时尖峰误判），仅降低阈值。
    minTraffic: 5,
    maxCandidates: 5,
    maxDistanceToEndpoints: 10,
};
/**
 * 从交通热度数据中评估道路候选（plan §5.6.6）。
 *
 * 规则：
 *   - 只有连续两个采样窗口都超过阈值的位置才入选
 *   - 不在核心保留格、出口、墙、已有 road 或 site 上
 *   - 至少靠近两个高价值端点（source/spawn/storage/controller）
 *
 * @param currentTraffic 当前采样窗口的交通数据（posKey "x,y" -> count）
 * @param prevTraffic 上一个采样窗口的交通数据
 */
function evaluateRoadCandidates(roomName, snapshot, currentTraffic, prevTraffic, options = DEFAULT_ROAD_OPTIONS) {
    if (!currentTraffic || !prevTraffic)
        return [];
    // 收集高价值端点位置。
    const endpoints = [];
    for (const s of snapshot.spawns)
        endpoints.push({ x: s.pos.x, y: s.pos.y });
    for (const s of snapshot.sources)
        endpoints.push({ x: s.pos.x, y: s.pos.y });
    if (snapshot.storage)
        endpoints.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
    if (snapshot.controller)
        endpoints.push({ x: snapshot.controller.pos.x, y: snapshot.controller.pos.y });
    // 构建已占用位置集合（已有结构 + site + source/controller + road）。
    const occupiedSet = new Set();
    for (const s of [
        ...snapshot.spawns,
        ...snapshot.extensions,
        ...snapshot.towers,
        ...snapshot.containers,
        ...snapshot.roads,
        ...snapshot.constructionSites,
    ]) {
        occupiedSet.add(`${s.pos.x},${s.pos.y}`);
    }
    if (snapshot.storage) {
        occupiedSet.add(`${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
    }
    for (const s of snapshot.sources) {
        occupiedSet.add(`${s.pos.x},${s.pos.y}`);
    }
    if (snapshot.controller) {
        occupiedSet.add(`${snapshot.controller.pos.x},${snapshot.controller.pos.y}`);
    }
    const candidates = [];
    for (const [posKey, traffic] of Object.entries(currentTraffic)) {
        // 两个窗口都需超过阈值。
        if (traffic < options.minTraffic)
            continue;
        const prevCount = prevTraffic[posKey] ?? 0;
        if (prevCount < options.minTraffic)
            continue;
        const commaIdx = posKey.indexOf(",");
        const x = parseInt(posKey.slice(0, commaIdx), 10);
        const y = parseInt(posKey.slice(commaIdx + 1), 10);
        // 边界检查。
        if (x < 1 || x > 48 || y < 1 || y > 48)
            continue;
        // 已占用位置不建 road。
        if (occupiedSet.has(posKey))
            continue;
        // 至少靠近两个高价值端点。
        let nearbyEndpoints = 0;
        for (const ep of endpoints) {
            const dist = Math.abs(ep.x - x) + Math.abs(ep.y - y);
            if (dist <= options.maxDistanceToEndpoints)
                nearbyEndpoints++;
            if (nearbyEndpoints >= 2)
                break;
        }
        if (nearbyEndpoints < 2)
            continue;
        candidates.push({
            key: `road.${roomName}.${x}.${y}`,
            pos: { x, y, roomName },
            structureType: STRUCTURE_ROAD,
            priority: 3,
            traffic,
        });
    }
    // 按交通量降序排序，取前 N 个。
    candidates.sort((a, b) => b.traffic - a.traffic);
    return candidates.slice(0, options.maxCandidates);
}

const DEFAULT_CORRIDOR_OPTIONS = {
    maxRoadsPerCycle: 12,
};
/** 判断 container 是否为 source container（紧邻某个 source）。 */
function isSourceContainer(c, snapshot) {
    return snapshot.sources.some(s => Math.abs(s.pos.x - c.pos.x) <= 1 && Math.abs(s.pos.y - c.pos.y) <= 1);
}
/**
 * 收集需要连通的物流走廊端点对（纯函数，便于单测）。
 *
 * 排序（按物流优先级从高到低）：
 *   1. controller container → core — 站桩升级供能线，hauler 供能最吃紧
 *   2. source container → core — 能量源头到孵化点
 *   3. storage → core — storage(RCL4+) 建成后 hauler 需 storage↔spawn 往返送能
 *
 * 配合 maxRoadsPerCycle 分段铺设时，优先保证最关键的供能走廊先成型。
 */
function collectCorridorEndpoints(snapshot) {
    const spawn = snapshot.spawns[0];
    if (!spawn)
        return [];
    const core = { x: spawn.pos.x, y: spawn.pos.y, roomName: snapshot.roomName };
    const pairs = [];
    // controller container → 核心（优先）。
    if (snapshot.controllerContainer) {
        const cc = snapshot.controllerContainer;
        pairs.push({ from: { x: cc.pos.x, y: cc.pos.y, roomName: snapshot.roomName }, to: core });
    }
    // 每个 source container → 核心。
    for (const c of snapshot.containers) {
        if (!isSourceContainer(c, snapshot))
            continue;
        pairs.push({ from: { x: c.pos.x, y: c.pos.y, roomName: snapshot.roomName }, to: core });
    }
    // storage → 核心（RCL4+，storage 建成后 hauler 的核心通勤路段）。
    if (snapshot.storage) {
        const st = snapshot.storage;
        pairs.push({ from: { x: st.pos.x, y: st.pos.y, roomName: snapshot.roomName }, to: core });
    }
    return pairs;
}
/**
 * 构建走廊规划用的 CostMatrix — 每规划周期只构建一次，供所有走廊对复用。
 * 避开墙与已有结构（不能在其上修路），偏好已有道路（复用）。
 *
 * protectedPositions：蓝图未来格（packed x*50+y）— 标记为 255 不可通行。
 * 修复：旧实现不保护蓝图格，走廊路可能占用未来 extension 位置，
 * 导致该 extension 被 validateBuildCell 判定 "occupied" 而永久消失。
 */
function buildCorridorCostMatrix(snapshot, room, protectedPositions) {
    const cost = new PathFinder.CostMatrix();
    const terrain = room.getTerrain();
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                cost.set(x, y, 255);
        }
    }
    for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers]) {
        cost.set(s.pos.x, s.pos.y, 255);
    }
    if (snapshot.storage)
        cost.set(snapshot.storage.pos.x, snapshot.storage.pos.y, 255);
    for (const s of snapshot.sources)
        cost.set(s.pos.x, s.pos.y, 255);
    if (snapshot.controller)
        cost.set(snapshot.controller.pos.x, snapshot.controller.pos.y, 255);
    for (const s of snapshot.constructionSites)
        cost.set(s.pos.x, s.pos.y, 255);
    for (const r of snapshot.roads)
        cost.set(r.pos.x, r.pos.y, 1);
    // 保护蓝图未来格 — 走廊路不得占用未来的 extension/结构位置。
    if (protectedPositions) {
        for (const packed of protectedPositions) {
            const x = Math.floor(packed / 50);
            const y = packed % 50;
            // 仅在该格尚未被标记为道路时保护（已有道路优先保留）。
            if (cost.get(x, y) !== 1)
                cost.set(x, y, 255);
        }
    }
    return cost;
}
/**
 * 默认 PathFinder 实现：CostMatrix 每规划周期构建一次，所有走廊对共享。
 * 仅在运行时调用；单测通过注入 pathFn 绕过 Screeps 全局。
 */
function defaultPathFn(snapshot, room, protectedPositions) {
    // 每规划周期只构建一次 CostMatrix（旧实现每走廊对构建一次，N 对 = N 次 50x50 扫描）。
    const cost = buildCorridorCostMatrix(snapshot, room, protectedPositions);
    return (from, to) => {
        const fromPos = new RoomPosition(from.x, from.y, from.roomName);
        const toPos = new RoomPosition(to.x, to.y, to.roomName);
        const ret = PathFinder.search(fromPos, { pos: toPos, range: 1 }, {
            plainCost: 2,
            swampCost: 10,
            roomCallback: () => cost,
        });
        return ret.path.map(p => ({ x: p.x, y: p.y }));
    };
}
/**
 * 规划走廊路：沿最高优先级走廊对的最优路径收集待建道路格。
 *
 * 每次只规划一条走廊（第一个 pair），前一条建完后才规划下一条。
 * 原因：同时规划所有走廊会一次性涌入 30-40 条 road 淹没 buildQueue，
 * 抢占 builder 工时导致 extension/container 建造停滞。
 * 一条一条建，经济基础设施优先，道路是锦上添花。
 *
 * 去重规则：跳过已有 road / constructionSite / 结构 / source / controller 所在格，
 * 以及本批次已收录的格。受 maxRoadsPerCycle 上限约束分段返回。
 * 调用方（layout-planner）再按 key 与 buildQueue 去重后入队。
 */
function planCorridorRoads(room, snapshot, options = DEFAULT_CORRIDOR_OPTIONS, pathFn, protectedPositions) {
    const pairs = collectCorridorEndpoints(snapshot);
    if (pairs.length === 0)
        return [];
    const fn = defaultPathFn(snapshot, room, protectedPositions);
    // 已占用格：不能在其上修路，也不重复入队。
    const occupied = new Set();
    for (const s of [
        ...snapshot.roads,
        ...snapshot.constructionSites,
        ...snapshot.spawns,
        ...snapshot.extensions,
        ...snapshot.towers,
        ...snapshot.containers,
    ]) {
        occupied.add(`${s.pos.x},${s.pos.y}`);
    }
    if (snapshot.storage)
        occupied.add(`${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
    for (const s of snapshot.sources)
        occupied.add(`${s.pos.x},${s.pos.y}`);
    if (snapshot.controller)
        occupied.add(`${snapshot.controller.pos.x},${snapshot.controller.pos.y}`);
    const seen = new Set();
    const result = [];
    // 只规划第一条走廊（最高优先级），不贪多。
    const pair = pairs[0];
    const path = fn(pair.from, pair.to);
    for (const step of path) {
        if (step.x < 1 || step.x > 48 || step.y < 1 || step.y > 48)
            continue;
        const key = `${step.x},${step.y}`;
        if (occupied.has(key) || seen.has(key))
            continue;
        seen.add(key);
        result.push({ x: step.x, y: step.y, roomName: snapshot.roomName });
        if (result.length >= options.maxRoadsPerCycle)
            break;
    }
    return result;
}

/**
 * 规划本周期应入队的道路任务。
 *
 * 返回待入队的 BuildTask 列表（调用方负责 push 到 queue + 更新 existingKeys）。
 * 内部已做去重（不会返回 existingKeys 中已有的 key，也不会返回本批次重复 key）。
 */
function planRoads(ctx) {
    const { snapshot, room, blueprint, anchor, occupiedSet, queue, existingKeys } = ctx;
    const tasks = [];
    // 本批次已收录的 key（防止三种道路来源之间重复）。
    const batchKeys = new Set();
    const isDuplicate = (key) => existingKeys.has(key) || batchKeys.has(key);
    const markAdded = (key) => { batchKeys.add(key); };
    // 基础设施门禁：仅当 priority === 0（tower/storage）的 queued 任务存在时，
    // 不生成核心路和走廊路。
    //
    // 旧实现用 priority <= 1，导致 RCL2-4 阶段 buildQueue 中几乎总有
    // priority 1 的 extension 排队，道路被永久冻结——恰是 hauler 最需要路的时期。
    // 道路本身是 priority 3 + 独立 site 名额（maxRoadSitesPerRoom），
    // 不会挤占 extension/container 的建造名额，门禁只需保护 tower/storage 这种
    // 真正关键的 priority 0 结构即可。
    const hasPendingCritical = queue.some(t => t.priority === 0 && t.state === "queued");
    // ── 1. 核心棋盘格路（RCL2+）──
    if (!hasPendingCritical) {
        const coreRoadCandidates = createCoreRoadTasks(blueprint, anchor.x, anchor.y, snapshot.roomName, room, snapshot, occupiedSet);
        for (const candidate of coreRoadCandidates) {
            if (isDuplicate(candidate.key))
                continue;
            tasks.push(candidateToBuildTask(candidate));
            markAdded(candidate.key);
        }
    }
    // ── 2. 流量采样路（RCL4+）──
    if (snapshot.rcl >= 4) {
        const g = globalCache();
        const currentTraffic = g.roomTraffic?.[snapshot.roomName];
        const prevTraffic = g.prevRoomTraffic?.[snapshot.roomName];
        // 显式传入 CONFIG.layout.road — 不传则 road-policy 内置默认生效，
        // config 沦为无人消费的死配置（调参静默不生效）。
        const roadCandidates = evaluateRoadCandidates(snapshot.roomName, snapshot, currentTraffic, prevTraffic, CONFIG.layout.road);
        for (const candidate of roadCandidates) {
            if (isDuplicate(candidate.key))
                continue;
            tasks.push({
                key: candidate.key,
                pos: candidate.pos,
                structureType: STRUCTURE_ROAD,
                priority: candidate.priority,
                state: "queued",
                attempts: 0,
                retryAt: 0,
            });
            markAdded(candidate.key);
        }
    }
    // ── 3. 确定性走廊路（source↔core↔controller）──
    // 不受 hasPendingCritical 冻结：重建期（P0 任务排队时）恰恰是走廊路
    // 最需要恢复的窗口 — source↔core 无路时 hauler 通勤减速，重建反而更慢。
    // 走廊路安全性：PathFinder 确定性生成（不依赖交通数据）、priority 3 +
    // 独立 road site 名额（maxRoadSitesPerRoom）、每周期仅一条走廊 ≤12 格，
    // 且 tryCreateSite 按 priority 排序 — P0 关键结构永远先建，走廊只补空档。
    {
        // 保护蓝图未来格 — 走廊路不得占用未来的 extension/结构位置。
        const protectedPositions = new Set();
        for (const cell of blueprint.cells) {
            protectedPositions.add(packPos(anchor.x + cell.dx, anchor.y + cell.dy));
        }
        const corridorRoads = planCorridorRoads(room, snapshot, undefined, undefined, protectedPositions);
        for (const pos of corridorRoads) {
            const key = `road.${snapshot.roomName}.${pos.x}.${pos.y}`;
            if (isDuplicate(key))
                continue;
            tasks.push({
                key,
                pos: { x: pos.x, y: pos.y, roomName: snapshot.roomName },
                structureType: STRUCTURE_ROAD,
                priority: 3,
                state: "queued",
                attempts: 0,
                retryAt: 0,
            });
            markAdded(key);
        }
    }
    return tasks;
}
/**
 * 交通数据轮换 — 将当前窗口快照为 prevTraffic，然后清零当前窗口。
 *
 * 无论 RCL、无论是否生成道路，每规划周期必须调用一次。
 * 确保 RCL4 启用流量路时已有 prevTraffic 可供双窗口比较。
 */
function rotateTraffic(roomName) {
    const g = globalCache();
    const currentTraffic = g.roomTraffic?.[roomName];
    if (currentTraffic) {
        if (!g.prevRoomTraffic)
            g.prevRoomTraffic = {};
        g.prevRoomTraffic[roomName] = { ...currentTraffic };
    }
    if (g.roomTraffic) {
        g.roomTraffic[roomName] = {};
    }
}

/**
 * 新房锚点评分 — 纯函数。
 *
 * 评分公式（plan §5.6.3）：
 *   score = 4 * buildableCoreTiles
 *         - 2 * averageDistanceToSources
 *         - 1 * distanceToController
 *         + 3 * exitRisk   // exitRisk = 到最近出口的距离，越大越安全
 *         - 4 * blockedTemplateCells
 *
 * 分数越高越好。候选需满足核心矩形不越界、关键格不是墙、
 * 距出口保留安全距离、不占 source/controller/mineral。
 */
function scoreCandidate(input) {
    return (4 * input.buildableCoreTiles
        - 2 * input.averageDistanceToSources
        - 1 * input.distanceToController
        + 3 * input.exitRisk
        - 4 * input.blockedTemplateCells);
}
/**
 * 从 Room 和 Blueprint 提取候选评分所需的数据。
 * 调用方提供候选坐标和房间信息，此函数完成扫描。
 * 大扫描只能在 Green 下增量完成（plan §5.6.3）。
 */
function evaluateCandidate(room, blueprint, cx, cy) {
    const terrain = room.getTerrain();
    const sources = room.find(FIND_SOURCES);
    const controller = room.controller;
    // 统计可建造核心格（3 格半径内非墙非边界）。
    let buildableCoreTiles = 0;
    for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48)
                continue;
            if (terrain.get(x, y) !== TERRAIN_MASK_WALL)
                buildableCoreTiles++;
        }
    }
    // 到各 source 的平均距离。
    let avgDist = 0;
    if (sources.length > 0) {
        let total = 0;
        for (const s of sources) {
            total += Math.abs(s.pos.x - cx) + Math.abs(s.pos.y - cy);
        }
        avgDist = total / sources.length;
    }
    // 到 controller 的距离。
    const distCtrl = controller
        ? Math.abs(controller.pos.x - cx) + Math.abs(controller.pos.y - cy)
        : 50;
    // 到最近出口的估算距离（取四方向最小值）。
    const exitRisk = Math.min(cx, cy, 49 - cx, 49 - cy);
    // 统计被墙/边界阻挡的模板 cell 数。
    let blocked = 0;
    for (const cell of blueprint.cells) {
        const x = cx + cell.dx;
        const y = cy + cell.dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) {
            blocked++;
            continue;
        }
        if (terrain.get(x, y) === TERRAIN_MASK_WALL)
            blocked++;
    }
    return {
        x: cx,
        y: cy,
        buildableCoreTiles,
        averageDistanceToSources: avgDist,
        distanceToController: distCtrl,
        exitRisk,
        blockedTemplateCells: blocked,
    };
}

/**
 * 约束推导结构放置 — 从地形约束推导每个结构的位置。
 *
 * 替代固定模板偏移（compact-core-v2 的 dx/dy），用贪心算法在候选格中
 * 为每个结构找满足所有约束且评分最高的位置。
 *
 * 约束集：
 *   1. 偶校验（dx+dy 偶数）— 棋盘格走道不变量
 *   2. 非墙、非越界
 *   3. 不重叠（occupiedSet）
 *   4. 不密封（wouldSeal 守卫）
 *   5. 到锚点距离 <= maxRadius
 *   6. Lab 集群：反应 trio 必须相互 range <= 2
 *
 * 放置顺序（优先级从高到低）：
 *   spawn > storage > tower > link > terminal > factory > lab > extension
 *   高优先级结构先占位，低优先级结构在剩余格中选择。
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */
const DEFAULT_PLACER_CONFIG = {
    maxRadius: 7,
    minOpenness: 2,
};
/** RCL → 该等级新增的结构批次（与 CONTROLLER_STRUCTURES 对齐）。 */
const RCL_BATCHES = {
    2: [
        { type: STRUCTURE_EXTENSION, count: 5, priority: 1, phase: "rcl2" },
    ],
    3: [
        { type: STRUCTURE_EXTENSION, count: 5, priority: 1, phase: "rcl3" },
        { type: STRUCTURE_TOWER, count: 1, priority: 0, phase: "rcl3" },
    ],
    4: [
        { type: STRUCTURE_EXTENSION, count: 10, priority: 1, phase: "rcl4" },
        { type: STRUCTURE_STORAGE, count: 1, priority: 0, phase: "rcl4" },
    ],
    5: [
        { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "late" },
        { type: STRUCTURE_TOWER, count: 1, priority: 0, phase: "late" },
        // LINK 不在此放置 — constraint-placer 的评分算法不理解 link 角色
        // （source/storage/controller），随机放置会导致 RCL5 仅有的 2 个 link
        // 分配为 2 个 source link 或 2 个 storage link，link 网络失效。
        // 所有 link 由 task-factory 的 create*LinkTask 按角色优先级放置。
    ],
    6: [
        { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "rcl6" },
        { type: STRUCTURE_TERMINAL, count: 1, priority: 1, phase: "rcl6" },
        { type: STRUCTURE_LAB, count: 3, priority: 2, phase: "rcl6" },
    ],
    7: [
        { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "rcl7" },
        { type: STRUCTURE_TOWER, count: 1, priority: 0, phase: "rcl7" },
        { type: STRUCTURE_SPAWN, count: 1, priority: 1, phase: "rcl7" },
        { type: STRUCTURE_FACTORY, count: 1, priority: 2, phase: "rcl7" },
        { type: STRUCTURE_LAB, count: 3, priority: 2, phase: "rcl7" },
    ],
    8: [
        { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "rcl8" },
        { type: STRUCTURE_SPAWN, count: 1, priority: 1, phase: "rcl8" },
        { type: STRUCTURE_LAB, count: 4, priority: 2, phase: "rcl8" },
    ],
};
/** 放置优先级：数值越小越先放置（先占位）。 */
const TYPE_PLACE_ORDER = {
    [STRUCTURE_SPAWN]: 0,
    [STRUCTURE_STORAGE]: 1,
    [STRUCTURE_TOWER]: 2,
    [STRUCTURE_LINK]: 3,
    [STRUCTURE_TERMINAL]: 4,
    [STRUCTURE_FACTORY]: 5,
    [STRUCTURE_LAB]: 6,
    [STRUCTURE_EXTENSION]: 7,
};
/**
 * 预计算候选格列表 — 偶校验、边界内、非墙、开放度 >= minOpenness。
 *
 * 评分 = openness × 2 - distFromAnchor - energyPenalty
 *
 * - openness：周围走道越多越好（棋盘格不变量保证）
 * - distFromAnchor：离核心越近越好（减少 hauler 通勤）
 * - energyPenalty：离能量端点（source/controller）越远越好，
 *   让 storage/link 等物流结构优先落在靠近能量流转路径的位置。
 *
 * 按评分降序排列。
 *
 * @param energyEndpoints 能量端点位置（source/controller），用于计算能量流转距离惩罚。
 *   为空时退化为纯几何评分（向后兼容）。
 */
function buildCandidateGrid(anchor, field, getTerrain, config, energyEndpoints = []) {
    const candidates = [];
    const { maxRadius, minOpenness } = config;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
        for (let dy = -maxRadius; dy <= maxRadius; dy++) {
            // 偶校验（棋盘格不变量）
            if (((dx + dy) % 2 + 2) % 2 !== 0)
                continue;
            const x = anchor.x + dx;
            const y = anchor.y + dy;
            // 边界（留出 2 格安全距离）
            if (x < 2 || x > 47 || y < 2 || y > 47)
                continue;
            // 非墙
            if (getTerrain(x, y))
                continue;
            // 开放度门槛
            const openness = opennessAt(field, x, y);
            if (openness < minOpenness)
                continue;
            const dist = Math.abs(dx) + Math.abs(dy);
            // 能量端点距离惩罚：到最近端点的曼哈顿距离 × 0.5。
            // 权重 0.5 让它不会压倒 openness/anchor 距离，只在同等条件下偏好靠近能量端点的格子。
            let energyPenalty = 0;
            if (energyEndpoints.length > 0) {
                let minEnergyDist = Infinity;
                for (const ep of energyEndpoints) {
                    const d = Math.abs(ep.x - x) + Math.abs(ep.y - y);
                    if (d < minEnergyDist)
                        minEnergyDist = d;
                }
                energyPenalty = minEnergyDist * 0.5;
            }
            candidates.push({ x, y, score: openness * 2 - dist - energyPenalty });
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
}
/**
 * 检查在 (x,y) 放置障碍结构是否会密封。
 * 简化版 wouldSeal：检查自身 4 正交邻居中是否有 >= 1 个可站格。
 * （完整 wouldSeal 在 validation.ts 中，这里用轻量版避免循环依赖。）
 */
function wouldSealLocal(x, y, getTerrain, occupied) {
    const orthogonal = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of orthogonal) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || nx > 48 || ny < 1 || ny > 48)
            continue;
        if (getTerrain(nx, ny))
            continue;
        if (occupied.has(packPos(nx, ny)))
            continue;
        return false; // 找到可站格，不密封
    }
    return true; // 4 正交邻居全堵，密封
}
/**
 * 为 lab 集群寻找相互 range <= 2 的位置组。
 *
 * 策略：从候选格中找第一个满足条件的 trio（3 个 lab 相互 Chebyshev <= 2）。
 * 如果 count > 3，继续找与已有 lab 集群 range <= 2 的额外位置。
 *
 * @returns 找到的位置列表（可能少于 count）
 */
function placeLabCluster(count, candidates, occupied, getTerrain, existingLabs) {
    const placed = [...existingLabs];
    const result = [];
    for (let i = 0; i < count; i++) {
        let found = false;
        for (const c of candidates) {
            const packed = packPos(c.x, c.y);
            if (occupied.has(packed))
                continue;
            if (wouldSealLocal(c.x, c.y, getTerrain, occupied))
                continue;
            // 检查与已有 lab 的 Chebyshev 距离 <= 2
            if (placed.length > 0) {
                const inRange = placed.some(l => Math.max(Math.abs(l.x - c.x), Math.abs(l.y - c.y)) <= 2);
                if (!inRange)
                    continue;
            }
            // 找到合法位置
            placed.push({ x: c.x, y: c.y });
            result.push({ x: c.x, y: c.y });
            occupied.add(packed);
            found = true;
            break;
        }
        if (!found)
            break; // 找不到更多合法位置
    }
    return result;
}
/**
 * 约束推导结构放置 — 主入口。
 *
 * 为指定 RCL 放置所有结构（从 RCL2 到目标 RCL 的累计）。
 * 返回放置结果列表，调用方转为 BuildTask 入队。
 *
 * @param anchor 核心锚点（主 spawn 位置）
 * @param field Distance Transform 距离场
 * @param getTerrain 地形查询（是否墙）
 * @param rcl 目标 RCL 等级
 * @param preOccupied 预占用位置（source/controller/mineral/已有结构）
 * @param committed 各结构类型的承诺数量（已建 + 在建 site + 队列任务）—
 *   放置时按批次抵扣，只为真实缺口生成放置（代际稳定性核心）。
 * @param config 放置配置
 * @param energyEndpoints 能量端点位置（source/controller），用于评分加权。
 *   传入时结构放置偏好靠近能量流转路径；不传时退化为纯几何评分。
 * @param existingLabPositions 已建 lab 位置 — 新增 lab 续接既有集群（相邻约束）。
 */
function placeStructures(anchor, field, getTerrain, rcl, preOccupied, committed, config = DEFAULT_PLACER_CONFIG, energyEndpoints = [], existingLabPositions = []) {
    const candidates = buildCandidateGrid(anchor, field, getTerrain, config, energyEndpoints);
    const occupied = new Set(preOccupied);
    // 锚点本身被 spawn 占用
    occupied.add(packPos(anchor.x, anchor.y));
    const placements = [];
    // Lab 集群续接：已建 lab 位置作为集群种子 — 抵扣后新增的 lab
    // 必须落在既有集群 range<=2 内，否则反应 trio 相邻约束被代际漂移破坏。
    const labPositions = [...existingLabPositions];
    // 承诺抵扣（代际稳定性核心）：已建结构 + 在建 site + 队列任务
    // 已经覆盖的数量不再生成放置。旧实现每周期放置 RCL 累计全量、
    // 只跳过被占格子 — 已建结构把自己的格子占掉后，放置顺延到次优格，
    // 产生「同一逻辑结构在新格子再排一次」的幽灵任务与代际位置漂移。
    const remaining = {};
    for (const [type, n] of committed)
        remaining[type] = n;
    // 初始 spawn（锚点位）由玩家/扩张放置，不在 RCL_BATCHES 内 —
    // 从 spawn 承诺中扣除 1，避免误抵扣掉 RCL7/8 批次的 spawn #2/#3。
    if ((remaining[STRUCTURE_SPAWN] ?? 0) > 0) {
        remaining[STRUCTURE_SPAWN] -= 1;
    }
    /** 消耗某类型的承诺额度，返回本批次还需放置的数量。 */
    const deductBatch = (type, count) => {
        const deduct = Math.min(count, remaining[type] ?? 0);
        if (deduct > 0)
            remaining[type] = (remaining[type] ?? 0) - deduct;
        return count - deduct;
    };
    // 收集所有 RCL 批次并按放置优先级排序
    const batches = [];
    for (let r = 2; r <= rcl; r++) {
        const rclBatches = RCL_BATCHES[r];
        if (rclBatches)
            batches.push(...rclBatches);
    }
    batches.sort((a, b) => (TYPE_PLACE_ORDER[a.type] ?? 99) - (TYPE_PLACE_ORDER[b.type] ?? 99));
    for (const batch of batches) {
        const { type, count, priority, phase } = batch;
        const need = deductBatch(type, count);
        if (need <= 0)
            continue;
        // Lab 特殊处理：集群放置
        if (type === STRUCTURE_LAB) {
            const labResult = placeLabCluster(need, candidates, occupied, getTerrain, labPositions);
            for (const pos of labResult) {
                labPositions.push(pos);
                placements.push({
                    key: placementKey(type, pos.x, pos.y),
                    pos,
                    structureType: type,
                    priority,
                    phase,
                });
            }
            continue;
        }
        // 通用贪心放置
        let placed = 0;
        for (const c of candidates) {
            if (placed >= need)
                break;
            const packed = packPos(c.x, c.y);
            if (occupied.has(packed))
                continue;
            // 密封守卫（障碍结构）
            const isObstacle = type !== STRUCTURE_ROAD && type !== STRUCTURE_CONTAINER;
            if (isObstacle && wouldSealLocal(c.x, c.y, getTerrain, occupied))
                continue;
            occupied.add(packed);
            placements.push({
                key: placementKey(type, c.x, c.y),
                pos: { x: c.x, y: c.y },
                structureType: type,
                priority,
                phase,
            });
            placed++;
        }
    }
    return placements;
}
/**
 * 放置任务 key — 坐标绑定：`constraint.<type>.<x>.<y>`。
 *
 * 旧实现用递增计数器命名（constraint.extension.01），key 与坐标零绑定 —
 * 已建格进入 occupied 后贪心顺延，同一 key 代际间指向不同格子，
 * existingKeys 去重 / 黑名单 / done 判定全部失去锚定。
 * 坐标绑定后同一格永远同 key，重推导天然幂等。
 */
function placementKey(type, x, y) {
    return `constraint.${type}.${x}.${y}`;
}
/**
 * 将 ConstraintPlacement 列表转为 BuildTaskCandidate 格式（兼容现有入队流程）。
 * 所有候选标记为 validation: "ok"（放置算法已保证合法性）。
 */
function placementsToCandidates(placements, roomName) {
    return placements.map(p => ({
        key: p.key,
        pos: { ...p.pos, roomName },
        structureType: p.structureType,
        priority: p.priority,
        phase: p.phase,
        validation: "ok",
    }));
}

/**
 * 布局规划器 — P3 低频系统，负责生成和维护建造计划。
 *
 * 职责（plan §5.6.3）：
 *   - 在触发条件满足时重新规划布局
 *   - 将蓝图 cells 转为 BuildTask 并推入 BuildQueue
 *   - 动态生成 source/controller container 任务
 *   - 评估交通热度并生成道路候选
 *
 * 触发条件（由 shouldPlan 判定，每 tick 调用一次但内部早返回）：
 *   - 首次运行（无 LayoutMemory）
 *   - controller 等级变化
 *   - nextPlanTick 到期（默认 50 tick）
 *   - layout.state 被人工设为 proposed
 *
 * 不使用 System.interval — 因 kernel.shouldRunSystem 用 tick % interval 跳过，
 * 会导致 RCL 变化触发最多延迟 interval-1 tick。改为每 tick 调用 planRoom，
 * 由 shouldPlan 内部的 nextPlanTick 和 RCL 检查控制实际规划时机。
 *
 * 只在 Green 或 Guarded 且房间不处于 BOOTSTRAP/RECOVERY/DEFENSE 时运行。
 */
const layoutPlannerSystem = {
    name: "layout-planner",
    priority: 3,
    run(ctx) {
        for (const snapshot of ctx.snapshots()) {
            this.planRoom(snapshot, ctx);
        }
    },
    planRoom(snapshot, ctx) {
        const room = Game.rooms[snapshot.roomName];
        if (!room)
            return;
        const roomMem = Memory.rooms[snapshot.roomName];
        if (!roomMem)
            return;
        // 初始化 LayoutMemory（热数据留 Memory，冷数据 overrides/blocked 在 segment）。
        if (!roomMem.layout) {
            roomMem.layout = {
                version: 2,
                templateId: COMPACT_CORE_V2.id,
                state: "accepted",
                revision: 0,
                nextPlanTick: ctx.tick,
            };
        }
        const layout = roomMem.layout;
        // 人工 manual 状态不自动规划。
        if (layout.state === "manual")
            return;
        // 确定锚点 — 优先使用 live spawn 位置；spawn 被毁时回退到存储锚点（紧急重建）。
        if (snapshot.spawns.length > 0) {
            const spawn = snapshot.spawns[0];
            const anchorPacked = packPos(spawn.pos.x, spawn.pos.y);
            // 首次设置锚点，或 spawn 重建在新位置时更新锚点。
            // spawn 位置变化时清空 segment 中的 overrides 和 blocked（旧偏移记录失效）并递增 revision，
            // 触发所有携带旧 revision 的 assignment 失效（见 validateAssignment 的 revision 检查）。
            if (layout.anchor === undefined) {
                layout.anchor = anchorPacked;
                // 接通 candidate-score：评估所选锚点质量并存储（诊断 + 未来多房间选址参考）。
                // 此前 evaluateCandidate/scoreCandidate 是死代码，现在在锚点确立时实际执行。
                const candidateInput = evaluateCandidate(room, COMPACT_CORE_V2, spawn.pos.x, spawn.pos.y);
                if (candidateInput) {
                    layout.anchorScore = scoreCandidate(candidateInput);
                }
                // Phase 3 诊断：Distance Transform 锚点质量评估（不改变运行时行为）。
                // 计算地形开放度，评估当前 spawn 位置在所有候选中的排名。
                // 结果仅输出日志，供人工判断锚点质量；Phase 4 才启用约束推导放置。
                {
                    const terrain = room.getTerrain();
                    const getTerrain = (x, y) => terrain.get(x, y) === TERRAIN_MASK_WALL;
                    const field = computeDistanceField(getTerrain);
                    const exits = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
                    const sources = snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y }));
                    const controller = snapshot.controller
                        ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y }
                        : undefined;
                    const mineral = snapshot.minerals[0]
                        ? { x: snapshot.minerals[0].pos.x, y: snapshot.minerals[0].pos.y }
                        : undefined;
                    const diagnosis = diagnoseAnchor(spawn.pos.x, spawn.pos.y, {
                        field, sources, controller, exits, mineral, getTerrain,
                    });
                    console.log(`[layout] anchor diagnosis ${snapshot.roomName}: ` +
                        `rank ${diagnosis.rank}/${diagnosis.total}, ` +
                        `score ${diagnosis.candidate.score.toFixed(1)}, ` +
                        `openness ${diagnosis.candidate.openness}, ` +
                        `blocked ${diagnosis.candidate.blockedCells}, ` +
                        `srcDist ${diagnosis.candidate.avgSourceDist.toFixed(1)}`);
                }
            }
            else if (layout.anchor !== anchorPacked) {
                layout.anchor = anchorPacked;
                // 冷数据在 segment 中重置。
                const segData = getRoomLayoutData(snapshot.roomName);
                segData.overrides = {};
                segData.blocked = {};
                markLayoutDirty();
                layout.revision++;
                // 锚点变化意味着所有旧坐标失效 — 清空 buildQueue，由下次规划重建。
                roomMem.buildQueue = [];
                // 同步移除按旧锚点创建的 construction site（孤儿 site 根治）。
                // 只清队列不清 site 的后果：builder 的建造目标取自快照 site 而非队列
                // （buildNearestSite 直接扫 myConstructionSites），旧 site 会被照常
                // 建成在错误位置；且孤儿 site 占用每房 site 限额，新队列任务被
                // tryCreateSite 反复跳过 — 「不在 buildQueue 的位置被建造 + 队列积压」
                // 两个症状同源于此。
                for (const site of snapshot.myConstructionSites) {
                    site.remove();
                }
            }
        }
        else if (layout.anchor === undefined) {
            // 无 spawn 且无存储锚点 — 初始 bootstrap 前的正常状态，无法规划。
            return;
        }
        // spawn 被毁但 layout.anchor 已设置时，使用存储锚点继续规划（紧急重建路径）。
        // 检查触发条件。
        if (!shouldPlan(layout, ctx.tick, snapshot))
            return;
        // 执行规划。
        layout.state = "building";
        const queue = roomMem.buildQueue ?? [];
        // revision 语义收窄：只有影响 creep 目标选择的结构（container/link/spawn/storage）
        // 入队时才递增 revision。road/extension 不改变 fillTargets/withdraw 目标，
        // 不应让全员 assignment 失效（旧实现每 50 tick 加条路就全员重选任务，纯浪费）。
        let targetingChanged = false;
        // 收集已完成 key 集合（用于依赖检查）。
        // 合并队列状态和实际已建结构，避免 done 任务被清除后依赖检查失败。
        const completedKeys = collectCompletedKeys(queue);
        const anchor = unpackPos(layout.anchor);
        for (const key of collectCompletedKeysFromStructures(COMPACT_CORE_V2, anchor.x, anchor.y, snapshot)) {
            completedKeys.add(key);
        }
        // 直接使用 RoomSnapshot 中的 minerals 数据 — RoomSnapshot 已在 buildRoomSnapshot
        // 中通过 room.find(FIND_MINERALS) 采集，此处无需重复调用（避免 CPU 浪费）。
        const minerals = snapshot.minerals;
        // 预计算结构计数与占用集合 — 每规划周期构建一次，供所有 cell 验证复用。
        // 消除旧实现 O(cells × structures) 的重复扫描（50+ cells × 30+ structures）。
        precomputeStructureCounts(snapshot);
        const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);
        // 障碍集合（仅不可通行结构/工地）— 密封守卫：拒绝制造建筑孤岛的建造。
        const obstacleSet = buildObstaclePositionSet(snapshot);
        ctx.globalSiteCount;
        const validationOptions = {
            minerals,
            occupiedSet,
            obstacleSet,
        };
        // 预构建队列 key 集合 — O(1) 去重，替代旧实现每候选 O(queue) 的 some() 扫描。
        // 同时构建位置集合 — 防止不同 key 的任务占据同一格子（P0 修复：
        // 旧实现只按 key 去重，constraint.extension.* 和 core.ext.* 两个命名空间
        // 会在同一位置生成重复任务，导致 buildQueue 中同位置多任务相互阻塞）。
        const existingKeys = new Set();
        const existingPositions = new Set();
        for (const t of queue) {
            existingKeys.add(t.key);
            existingPositions.add(`${t.pos.x},${t.pos.y}`);
        }
        // 阻塞黑名单：连续 ERR_INVALID_TARGET 被清除的任务 key 在冷却期内禁止重新入队，
        // 打破「入队 → blocked → 删除 → 重规划再入队」的无限空转（如玩家手工建筑占位）。
        // 冷却到期的条目顺手清理，防止 segment 黑名单无限累积。
        const segBlocked = getRoomLayoutData(snapshot.roomName).blocked ?? {};
        for (const [blockedKey, entry] of Object.entries(segBlocked)) {
            if (ctx.tick >= entry.retryAt) {
                delete segBlocked[blockedKey];
                markLayoutDirty();
            }
        }
        const isBlacklisted = (key) => segBlocked[key] !== undefined;
        // 1. 核心结构任务 — 按 CONFIG.layout.mode 分支。
        // tryAddTask 统一封装 key + position 双重去重，防止同位置多任务。
        const tryAddTask = (candidate) => {
            if (existingKeys.has(candidate.key))
                return false;
            if (isBlacklisted(candidate.key))
                return false;
            const posKey = `${candidate.pos.x},${candidate.pos.y}`;
            if (existingPositions.has(posKey))
                return false;
            queue.push(candidateToBuildTask(candidate));
            existingKeys.add(candidate.key);
            existingPositions.add(posKey);
            return true;
        };
        {
            // ── 约束推导模式：从地形约束推导结构位置 ──
            const terrain = room.getTerrain();
            const getTerrain = (x, y) => terrain.get(x, y) === TERRAIN_MASK_WALL;
            const field = computeDistanceField(getTerrain);
            // 能量端点：source + controller 位置，用于评分加权（让物流结构偏好靠近能量流转路径）。
            const energyEndpoints = [];
            for (const s of snapshot.sources)
                energyEndpoints.push({ x: s.pos.x, y: s.pos.y });
            if (snapshot.controller)
                energyEndpoints.push({ x: snapshot.controller.pos.x, y: snapshot.controller.pos.y });
            const placements = placeStructures(anchor, field, getTerrain, snapshot.rcl, occupiedSet, 
            // 承诺抵扣：已建 + 在建 site + 队列任务不再排位 — 只为真实缺口放置，
            // 消除全拆重建期间的代际位置漂移与幽灵任务（详见 computeCommittedCounts）。
            computeCommittedCounts(snapshot, queue), DEFAULT_PLACER_CONFIG, energyEndpoints, 
            // Lab 集群续接：新增 lab 必须落在既有集群 range<=2 内（反应 trio 约束）。
            snapshot.labs.map(l => ({ x: l.pos.x, y: l.pos.y })));
            const constraintCandidates = placementsToCandidates(placements, snapshot.roomName);
            for (const candidate of constraintCandidates) {
                if (tryAddTask(candidate))
                    ;
            }
        }
        // 2. Source container 任务。
        const sourceContainerCandidates = createSourceContainerTasks(snapshot, room, validationOptions);
        for (const candidate of sourceContainerCandidates) {
            if (tryAddTask(candidate)) {
                targetingChanged = true;
            }
        }
        // 3. Controller container 任务（RCL3+）。
        const controllerContainer = createControllerContainerTask(snapshot, room, validationOptions);
        if (controllerContainer) {
            if (tryAddTask(controllerContainer)) {
                targetingChanged = true;
            }
        }
        // 3.5 Link 任务（RCL5+）— 按角色优先级分配有限的 link 槽位。
        //
        // RCL 分配策略（CONTROLLER_STRUCTURES link 上限：RCL5=2, RCL6=3, RCL7=4, RCL8=6）:
        //   RCL5 (2 links): source(1) + storage   → 最小可用 link 网络
        //   RCL6 (3 links): + controller           → 站桩升级链打通
        //   RCL7 (4 links): + source(2)            → 双 source 全覆盖
        //   RCL8 (6 links): + 2 hub                 → 终局枢纽
        //
        // 队列感知：统计 BuildQueue 中已有的 link 任务数，防止超额分配。
        // 每放置一个 link 任务后递增 queuedLinks，后续函数据此判断剩余槽位。
        let queuedLinks = queue.filter(t => t.structureType === STRUCTURE_LINK).length;
        // 3.5a Source link（第一趟，maxNew=1）— 保证至少 1 个 source link。
        //    优先放第一个 source，不消费所有槽位。
        const sourceLinkFirst = createSourceLinkTasks(snapshot, room, validationOptions, queuedLinks, 1);
        for (const candidate of sourceLinkFirst) {
            if (tryAddTask(candidate)) {
                queuedLinks++;
                targetingChanged = true;
            }
        }
        // 3.5b Storage link — link 网络的「最后一公里」：source→storage 物流打通。
        //    RCL5 仅 2 个槽位时，storage link 优先于第二个 source link。
        const storageLink = createStorageLinkTask(snapshot, room, validationOptions, queuedLinks);
        if (storageLink) {
            if (tryAddTask(storageLink)) {
                queuedLinks++;
                targetingChanged = true;
            }
        }
        // 3.5c Controller link — 站桩升级链：source→controller 0 通勤升级。
        //    RCL6+ 才有第 3 个槽位（RCL5 的 2 槽位已被 source + storage 占用）。
        const controllerLink = createControllerLinkTask(snapshot, room, validationOptions, queuedLinks);
        if (controllerLink) {
            if (tryAddTask(controllerLink)) {
                queuedLinks++;
                targetingChanged = true;
            }
        }
        // 3.5d Source link（第二趟，maxNew=∞）— 放置剩余 source link。
        //    RCL7+ 有第 4 个槽位时，为第二个 source 也放置 link。
        const sourceLinkRest = createSourceLinkTasks(snapshot, room, validationOptions, queuedLinks);
        for (const candidate of sourceLinkRest) {
            if (tryAddTask(candidate)) {
                queuedLinks++;
                targetingChanged = true;
            }
        }
        // 3.7 Extractor 任务（RCL6+）— 矿位上，补齐矿物产业链第一环。
        {
            const extractor = createExtractorTask(snapshot);
            if (extractor) {
                if (tryAddTask(extractor))
                    ;
            }
        }
        // 3.8 防御工事已提取到独立系统 defense-planner.ts（Phase 2 重构）。
        // 3.9-5. 道路规划（核心棋盘格路 + 流量采样路 + 确定性走廊路）。
        // 提取到 domain/layout/road-planner.ts — 行为等价，含基础设施门禁和去重。
        {
            const roadTasks = planRoads({
                snapshot,
                room,
                blueprint: COMPACT_CORE_V2,
                anchor,
                occupiedSet,
                queue,
                existingKeys,
            });
            for (const task of roadTasks) {
                const posKey = `${task.pos.x},${task.pos.y}`;
                if (existingKeys.has(task.key) || existingPositions.has(posKey))
                    continue;
                if (isBlacklisted(task.key))
                    continue;
                queue.push(task);
                existingKeys.add(task.key);
                existingPositions.add(posKey);
            }
        }
        // ── 紧急 spawn 重建 ──
        // spawn 不在 RCL_BATCHES 中（初始 spawn 由玩家放置），
        // 因此正常规划流程不会为其生成任务。spawn 被毁时在此手动入队。
        // P0 修复：原位被占时在锚点附近找替代位置，避免 createConstructionSite 死循环。
        if (snapshot.spawns.length === 0 && layout.anchor !== undefined) {
            const anchorPos = unpackPos(layout.anchor);
            const spawnKey = `constraint.spawn.01`;
            if (!existingKeys.has(spawnKey)) {
                // 确定重建位置：优先锚点，被占时螺旋搜索替代位置
                let buildPos;
                if (isPositionBuildable(room, anchorPos.x, anchorPos.y, occupiedSet)) {
                    buildPos = { x: anchorPos.x, y: anchorPos.y };
                }
                else {
                    buildPos = findSpawnRelocationPosition(room, anchorPos, occupiedSet);
                    if (buildPos) {
                        console.log(`[layout] spawn rebuild: anchor (${anchorPos.x},${anchorPos.y}) blocked, ` +
                            `relocating to (${buildPos.x},${buildPos.y}) in ${snapshot.roomName}`);
                    }
                    else {
                        console.log(`[layout] WARN: spawn rebuild stuck in ${snapshot.roomName}, ` +
                            `no relocation position found near anchor`);
                    }
                }
                if (buildPos) {
                    queue.push({
                        key: spawnKey,
                        pos: { x: buildPos.x, y: buildPos.y, roomName: snapshot.roomName },
                        structureType: STRUCTURE_SPAWN,
                        priority: 0,
                        state: "queued",
                        attempts: 0,
                        retryAt: 0,
                    });
                    existingKeys.add(spawnKey);
                    existingPositions.add(`${buildPos.x},${buildPos.y}`);
                    targetingChanged = true;
                }
            }
        }
        // 交通数据轮换（无论 RCL 都执行，确保 RCL4 时已有 prevTraffic 可用）。
        rotateTraffic(snapshot.roomName);
        roomMem.buildQueue = queue;
        // 仅在影响 creep 目标选择的结构入队时递增 revision — 避免道路/extension 入队
        // 导致全员 assignment 无意义失效（旧实现每 50 tick 加条路就全员重选任务）。
        if (targetingChanged) {
            layout.revision++;
        }
        // 更新规划时间戳和 RCL 跟踪。
        layout.nextPlanTick = ctx.tick + CONFIG.layout.planInterval;
        roomMem.lastRcl = snapshot.rcl;
    },
};
/** 判断是否应该执行规划。 */
function shouldPlan(layout, tick, snapshot) {
    // 人工 proposed 状态 — 立即规划。
    if (layout.state === "proposed")
        return true;
    // nextPlanTick 到期。
    if (tick >= layout.nextPlanTick)
        return true;
    // RCL 变化。
    const roomMem = Memory.rooms[snapshot.roomName];
    if (roomMem?.lastRcl !== undefined && roomMem.lastRcl !== snapshot.rcl) {
        return true;
    }
    // 紧急重建：关键基建缺失时立即触发规划，不等 50 tick 周期。
    // 仅当房间已规划过（anchor 已设置）时检查 — 初始 bootstrap 不触发。
    // 额外检查队列中是否已有待建任务：已有则无需重复规划，避免每 tick 跑规划浪费 CPU。
    if (layout.anchor !== undefined) {
        const emergency = assessEmergencyRebuild(snapshot);
        if (emergency.any) {
            const queue = roomMem?.buildQueue ?? [];
            const hasPendingTask = queue.some(t => (t.state === "queued" || t.state === "site") &&
                isEmergencyTask(t, snapshot, emergency));
            if (!hasPendingTask)
                return true;
        }
    }
    return false;
}
// ─── Spawn 重建 relocation（P0 修复：避免原位被占时死循环）──
/**
 * 检测位置是否可建建筑（地形非墙 + 无已有结构占用）。
 * spawn 不能建在出口格（0 或 49），边界限制 1-48。
 */
function isPositionBuildable(room, x, y, occupiedSet) {
    if (x < 1 || x > 48 || y < 1 || y > 48)
        return false;
    const terrain = room.getTerrain();
    if (terrain.get(x, y) === TERRAIN_MASK_WALL)
        return false;
    if (occupiedSet.has(packPos(x, y)))
        return false;
    return true;
}
/**
 * 在锚点附近螺旋搜索可建 spawn 的替代位置。
 * 搜索范围 ±3 格（避免 spawn 离核心太远）。
 * 返回第一个可建位置，无则 undefined。
 */
function findSpawnRelocationPosition(room, anchor, occupiedSet) {
    for (let radius = 1; radius <= 3; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                // 只搜索当前半径的边缘（螺旋外扩）
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius)
                    continue;
                const x = anchor.x + dx;
                const y = anchor.y + dy;
                if (isPositionBuildable(room, x, y, occupiedSet)) {
                    return { x, y };
                }
            }
        }
    }
    return undefined;
}

/**
 * 反应链规划 — 纯函数，无 Game API 依赖。
 *
 * 给定目标产物和当前库存，反向推导完整反应链。
 * 每个 lab 每 tick 产出 5 单位产物（LAB_REACTION_AMOUNT）。
 */
/** 每个 lab 每 tick 的反应产出量。 */
const LAB_REACTION_AMOUNT = 5;
/**
 * 反向推导反应链：从目标产物回溯到基础矿物。
 *
 * @param target       目标化合物
 * @param amount       目标数量
 * @param available    当前库存（storage + terminal 中的化合物数量）
 * @returns 有序反应步骤列表（从基础到高级），或 null（配方不存在）
 */
function planReactionChain(target, amount, available) {
    const steps = [];
    const needed = new Map();
    needed.set(target, amount);
    // BFS 反向展开：从目标回溯到基础矿物
    const queue = [target];
    const visited = new Set();
    while (queue.length > 0) {
        const compound = queue.shift();
        if (visited.has(compound))
            continue;
        visited.add(compound);
        const need = needed.get(compound) ?? 0;
        const have = available[compound] ?? 0;
        const deficit = need - have;
        if (deficit <= 0)
            continue; // 库存足够，无需生产
        const recipe = REACTIONS[compound];
        if (!recipe)
            continue; // 基础矿物，无法再分解
        const [input1, input2] = recipe;
        // 每个反应产出 5 单位，需要 ceil(deficit / 5) 次反应
        const batches = Math.ceil(deficit / LAB_REACTION_AMOUNT);
        const inputNeeded = batches * LAB_REACTION_AMOUNT;
        // 记录反应步骤
        steps.push({ input1, input2, output: compound, amount: batches * LAB_REACTION_AMOUNT });
        // 递归需求：输入物也需要足够量
        needed.set(input1, (needed.get(input1) ?? 0) + inputNeeded);
        needed.set(input2, (needed.get(input2) ?? 0) + inputNeeded);
        queue.push(input1, input2);
    }
    // 反转：从基础到高级
    steps.reverse();
    return { steps, target, targetAmount: amount };
}
/**
 * 判断当前库存是否满足反应链的下一步输入需求。
 *
 * @param step      当前反应步骤
 * @param available 当前库存
 * @returns 是否可以执行此步骤
 */
function canExecuteStep(step, available) {
    const need1 = LAB_REACTION_AMOUNT;
    const need2 = LAB_REACTION_AMOUNT;
    return (available[step.input1] ?? 0) >= need1 && (available[step.input2] ?? 0) >= need2;
}
/**
 * 从反应计划中获取下一个可执行的步骤。
 *
 * @param plan      反应计划
 * @param available 当前库存
 * @returns 下一个可执行步骤，或 null（全部完成或原料不足）
 */
function getNextExecutableStep(plan, available) {
    for (const step of plan.steps) {
        // 检查输出是否已满足
        const outputHave = available[step.output] ?? 0;
        if (outputHave >= step.amount)
            continue;
        // 检查输入是否足够
        if (canExecuteStep(step, available))
            return step;
        // 输入不足 — 需要先生产输入物（但步骤已排序，前面的应该先执行）
        return null;
    }
    return null;
}
/** runReaction 要求两个 input lab 均在 output lab 的 range≤2 内。 */
const REACTION_RANGE = 2;
/** 切比雪夫距离（Screeps 的 getRangeTo 语义）。 */
function chebyshev(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
/**
 * 从候选 lab 中挑选一个满足相邻约束的反应三元组（纯函数）。
 *
 * runReaction 要求两个 input lab 均在 output lab 的 range≤2 内；
 * RCL7-8 的 lab 若分散布置，任意取 3 个可能永远无法反应。此函数扫描每个
 * 候选 output lab，找到至少两个在其 range≤2 内的其它 lab 作为 input。
 *
 * @returns 满足约束的三元组；若无任何 output lab 能凑齐两个相邻 input，返回 undefined。
 */
function selectReactionTrio(labs) {
    for (const output of labs) {
        const inputs = labs.filter(l => l.id !== output.id && chebyshev(l, output) <= REACTION_RANGE);
        if (inputs.length >= 2) {
            return { output: output.id, input1: inputs[0].id, input2: inputs[1].id };
        }
    }
    return undefined;
}

// ─── Boost/装料常量（引擎数值：boostCreep 每部件 30 矿物 + 20 能量）────
const LAB_BOOST_MINERAL = 30;
const LAB_BOOST_ENERGY = 20;
/** 反应 input lab 的装料目标 — 一个批次量，避免一次抽干 storage。 */
const REACTION_LOAD_TARGET = 300;
/** output lab 产物积累到此量即发布回收需求（攒批搬运，减少往返）。 */
const OUTPUT_RECLAIM_THRESHOLD = 100;
/** boost 效果 → 对应 body part（用于封顶实际可强化的部件数）。 */
const EFFECT_PART = {
    harvest: WORK, upgrade: WORK, repair: WORK, dismantle: WORK,
    attack: ATTACK, rangedAttack: RANGED_ATTACK, heal: HEAL,
    carry: CARRY, move: MOVE, tough: TOUGH,
};
function getIndustryMemory(roomName) {
    const mem = Memory.rooms[roomName];
    if (!mem)
        return {};
    if (!mem.industry)
        mem.industry = {};
    return mem.industry;
}
// ─── 库存收集 ───────────────────────────────────────────────
/** 收集房间中所有化合物库存（storage + terminal + labs）。 */
function collectCompoundInventory(snapshot) {
    const inventory = {};
    // Storage
    if (snapshot.storage) {
        const store = snapshot.storage.store;
        for (const resource of Object.keys(store)) {
            if (resource === RESOURCE_ENERGY)
                continue;
            inventory[resource] = (inventory[resource] ?? 0) + store[resource];
        }
    }
    // Terminal
    if (snapshot.terminal) {
        const store = snapshot.terminal.store;
        for (const resource of Object.keys(store)) {
            if (resource === RESOURCE_ENERGY)
                continue;
            inventory[resource] = (inventory[resource] ?? 0) + store[resource];
        }
    }
    // Labs（正在反应中的也算库存）
    for (const lab of snapshot.labs) {
        const store = lab.store;
        for (const resource of Object.keys(store)) {
            if (resource === RESOURCE_ENERGY)
                continue;
            inventory[resource] = (inventory[resource] ?? 0) + store[resource];
        }
    }
    return inventory;
}
// ─── Lab 分配 ───────────────────────────────────────────────
/**
 * 规划 lab 分配：优先 boost，剩余做反应。
 *
 * 策略：
 *   - 1 个 lab 专门 boost（如果有 boost 请求）
 *   - 剩余 lab 中取 3 个做反应（2 input + 1 output）
 *   - 其余 idle
 */
function planLabs(snapshot, boostRequests, reactionStep) {
    const labs = snapshot.labs;
    const assignments = [];
    if (labs.length === 0) {
        return { assignments: [] };
    }
    let labIndex = 0;
    // 1. Boost lab（第一个 lab）
    if (boostRequests.length > 0 && labs.length > 0) {
        const boostLab = labs[labIndex];
        const req = boostRequests[0];
        assignments.push({
            labId: boostLab.id,
            role: "boost",
            boostTarget: req.creepName,
            boostCompound: req.compound,
            boostParts: req.bodyParts,
        });
        labIndex++;
    }
    // 2. Reaction labs（需要 3 个相邻的：2 input + 1 output）。
    // runReaction 要求两个 input lab 均在 output lab 的 range≤2 内，
    // 因此不能任意取 3 个——须挑选满足相邻约束的三元组，否则本 tick 不反应（P2-8）。
    const remainingLabs = labs.slice(labIndex);
    if (reactionStep && remainingLabs.length >= 3) {
        const trio = selectReactionTrio(remainingLabs.map(l => ({ id: l.id, x: l.pos.x, y: l.pos.y })));
        if (trio) {
            assignments.push({ labId: trio.input1, role: "input1" }, { labId: trio.input2, role: "input2" }, { labId: trio.output, role: "output" });
            // 未参与反应的剩余 lab 标记 idle。
            for (const lab of remainingLabs) {
                if (!assignments.some(a => a.labId === lab.id)) {
                    assignments.push({ labId: lab.id, role: "idle" });
                }
            }
            return {
                assignments,
                reaction: { ...reactionStep, amount: LAB_REACTION_AMOUNT },
            };
        }
        // 找不到相邻三元组：lab 分散布局，本 tick 不反应，全部 idle（走下方 fallback）。
    }
    // 3. 剩余 idle
    for (let i = labIndex; i < labs.length; i++) {
        const lab = labs[i];
        if (!assignments.some(a => a.labId === lab.id)) {
            assignments.push({ labId: lab.id, role: "idle" });
        }
    }
    return { assignments };
}
// ─── 搬运需求推导 ───────────────────────────────────────────
/** lab 当前装载的矿物（能量除外；空 lab 返回 undefined）。 */
function heldMineral(lab) {
    return Object.keys(lab.store)
        .find(r => r !== RESOURCE_ENERGY && (lab.store[r] ?? 0) > 0);
}
/**
 * 依据 lab 分配推导本 tick 的装/卸料需求表。
 *
 * 规则：
 *   boost lab   — 需要 boostCompound（parts×30）+ 能量（parts×20）；装错矿先清位
 *   input lab   — 需要对应反应原料至批次目标量；装错矿先清位
 *   output lab  — 装着非本反应产物立即回收；产物积攒到阈值后攒批回收
 *   idle lab    — 任何残留矿物回收
 *
 * 错矿 lab 在清位完成前不发装料需求 — 否则搬运端会对满仓 lab 反复 ERR_FULL 空转。
 *
 * @internal 导出仅供接线级单元测试使用，业务代码不直接调用。
 */
function computeLabDemands(labPlan) {
    const loads = [];
    const unloads = [];
    const reaction = labPlan.reaction;
    for (const assignment of labPlan.assignments) {
        const lab = Game.getObjectById(assignment.labId);
        if (!lab)
            continue;
        const held = heldMineral(lab);
        let want;
        let target = 0;
        if (assignment.role === "boost" && assignment.boostCompound) {
            want = assignment.boostCompound;
            const parts = assignment.boostParts ?? 5;
            target = parts * LAB_BOOST_MINERAL;
            const energyMissing = parts * LAB_BOOST_ENERGY - lab.store.getUsedCapacity(RESOURCE_ENERGY);
            if (energyMissing > 0) {
                loads.push({ labId: assignment.labId, resource: RESOURCE_ENERGY, amount: energyMissing });
            }
        }
        else if (assignment.role === "input1" && reaction) {
            want = reaction.input1;
            target = REACTION_LOAD_TARGET;
        }
        else if (assignment.role === "input2" && reaction) {
            want = reaction.input2;
            target = REACTION_LOAD_TARGET;
        }
        if (want) {
            if (held && held !== want) {
                unloads.push({ labId: assignment.labId, resource: held });
                continue;
            }
            const missing = target - (lab.store[want] ?? 0);
            if (missing > 0) {
                loads.push({ labId: assignment.labId, resource: want, amount: missing });
            }
            continue;
        }
        if (!held)
            continue;
        if (assignment.role === "output" && reaction && held === reaction.output) {
            // 本反应的正常产出 — 攒批回收，避免每 5 单位跑一趟。
            if ((lab.store[held] ?? 0) >= OUTPUT_RECLAIM_THRESHOLD) {
                unloads.push({ labId: assignment.labId, resource: held });
            }
        }
        else {
            // idle 残留 / output 装着往期产物 — 立即回收清位。
            unloads.push({ labId: assignment.labId, resource: held });
        }
    }
    return { loads, unloads };
}
// ─── 系统实现 ───────────────────────────────────────────────
const labSystem = {
    name: "lab-manager",
    priority: 1,
    run(ctx) {
        for (const snapshot of ctx.snapshots()) {
            // RCL6+ 才有 lab
            if (snapshot.rcl < 6)
                continue;
            if (snapshot.labs.length === 0)
                continue;
            const room = Game.rooms[snapshot.roomName];
            if (!room)
                continue;
            const industryMem = getIndustryMemory(snapshot.roomName);
            // 原料断供休眠：单房间只产一种矿物，多矿种原料在市场/跨房补给接入前
            // 不会自行出现。此时每 tick「规划反应链 → 无可执行步骤 → 清除 → 再规划」
            // 是纯 CPU 空转。休眠期内跳过本房全部 lab 逻辑，到期后重新评估
            //（休眠由下方「无反应可执行且无 boost 需求」时设置）。
            if (industryMem.idleUntil !== undefined && ctx.tick < industryMem.idleUntil) {
                continue;
            }
            const inventory = collectCompoundInventory(snapshot);
            // P2-9：清理已死亡 creep 的名字，防止 boostedCreeps 无限累积。
            // 复用 Game.creeps 判断存活，去重后仅保留仍在世的名字（无需 schema 迁移）。
            if (industryMem.boostedCreeps && industryMem.boostedCreeps.length > 0) {
                industryMem.boostedCreeps = industryMem.boostedCreeps.filter(name => Game.creeps[name] !== undefined);
            }
            // ── 1. Boost 决策 ──
            const creepSummaries = Object.values(Game.creeps)
                .filter(c => c.memory.home === snapshot.roomName)
                .map(c => ({
                name: c.name,
                role: c.memory.role ?? "unknown",
                ticksToLive: c.ticksToLive ?? 0,
                boosted: (industryMem.boostedCreeps ?? []).includes(c.name),
            }));
            const boostRequests = evaluateBoostRequests(creepSummaries, snapshot.rcl, inventory, DEFAULT_BOOST_POLICY);
            // ── 2. 反应规划（含自动目标选择） ──
            // 如果没有手动设定反应目标，根据 boost 需求自动决定。
            if (!industryMem.reactionTarget) {
                if (boostRequests.length > 0) {
                    // 优先生产 boost 需要的化合物
                    industryMem.reactionTarget = boostRequests[0].compound;
                    industryMem.reactionAmount = 300; // 一批 300 单位
                }
                else {
                    // 默认生产 XGH2O（upgrade boost，最高价值）
                    industryMem.reactionTarget = "XGH2O";
                    industryMem.reactionAmount = 300;
                }
            }
            let reactionStep = null;
            if (industryMem.reactionTarget && industryMem.reactionAmount) {
                // 使用持久化的反应计划
                if (!industryMem.reactionPlan || industryMem.reactionPlan.target !== industryMem.reactionTarget) {
                    industryMem.reactionPlan = planReactionChain(industryMem.reactionTarget, industryMem.reactionAmount, inventory) ?? undefined;
                }
                if (industryMem.reactionPlan) {
                    const step = getNextExecutableStep(industryMem.reactionPlan, inventory);
                    if (step) {
                        reactionStep = step;
                    }
                    else {
                        // 反应链完成，清除目标让下 tick 重新评估
                        industryMem.reactionTarget = undefined;
                        industryMem.reactionAmount = undefined;
                        industryMem.reactionPlan = undefined;
                    }
                }
            }
            // 无可执行反应且无 boost 需求 → 进入休眠，等原料库存变化后再评估。
            // 500 tick ≈ 一个 tuning 评估窗口，对 boost 时效的影响可忽略。
            if (!reactionStep && boostRequests.length === 0) {
                industryMem.idleUntil = ctx.tick + 500;
                continue;
            }
            // ── 3. Lab 分配 ──
            const labPlan = planLabs(snapshot, boostRequests, reactionStep);
            // ── 3.2 发布搬运需求表 ──
            // lab 角色分配只有本系统知道 — 不发布需求表，supplyLabs 只能盲搬，
            // 化合物永远进不了正确的 lab（工业链断路的第二层根因）。
            // 系统先于角色运行，同 tick 数据可达。
            const demandTable = computeLabDemands(labPlan);
            {
                const g = globalCache();
                if (!g.labDemands || g.labDemands.tick !== ctx.tick) {
                    g.labDemands = { tick: ctx.tick, byRoom: {} };
                }
                g.labDemands.byRoom[snapshot.roomName] = demandTable;
            }
            // ── 3.5 发布 boost 报到分配 ──
            // 把「creep → boost lab」写入 globalCache，供 role-runner 引导新生 creep
            // 走到 lab 旁（boostCreep 要求相邻）。系统先于角色运行，同 tick 数据可达。
            // ready = lab 内化合物与能量均已备足（boostCreep 每部件 30 矿物 + 20 能量，
            // 缺任一项都会 ERR_NOT_ENOUGH_RESOURCES）：未备足时不引导报到
            //（creep 先正常干活，supplyLabs 搬运到位后的评估周期再来），防止在 lab 旁空等。
            for (const assignment of labPlan.assignments) {
                if (assignment.role !== "boost" || !assignment.boostTarget)
                    continue;
                const g = globalCache();
                if (!g.boostAssignments || g.boostAssignments.tick !== ctx.tick) {
                    g.boostAssignments = { tick: ctx.tick, byCreep: {} };
                }
                const boostLab = Game.getObjectById(assignment.labId);
                const stocked = assignment.boostCompound !== undefined &&
                    ((boostLab?.store[assignment.boostCompound] ?? 0) >= LAB_BOOST_MINERAL) &&
                    ((boostLab?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) >= LAB_BOOST_ENERGY);
                g.boostAssignments.byCreep[assignment.boostTarget] = {
                    labId: assignment.labId,
                    ready: stocked,
                };
            }
            // ── 4. 执行 boost ──
            for (const assignment of labPlan.assignments) {
                if (assignment.role !== "boost" || !assignment.boostTarget || !assignment.boostCompound)
                    continue;
                const lab = Game.getObjectById(assignment.labId);
                const creep = Game.creeps[assignment.boostTarget];
                if (!lab || !creep)
                    continue;
                // 部件数按三重约束封顶：矿物存量 / 能量存量 / creep 实际可强化的部件数。
                // 不封顶直接 boostCreep 会尝试强化全部匹配部件 — 备料只够 5 个部件时
                // 必然 ERR_NOT_ENOUGH_RESOURCES，boost 永不成功。
                const compound = assignment.boostCompound;
                const effect = BOOST_EFFECTS[assignment.boostCompound];
                const partType = effect ? EFFECT_PART[effect] : undefined;
                if (!partType)
                    continue;
                const matchedParts = creep.body.filter(p => p.type === partType && !p.boost).length;
                const byMineral = Math.floor((lab.store[compound] ?? 0) / LAB_BOOST_MINERAL);
                const byEnergy = Math.floor(lab.store.getUsedCapacity(RESOURCE_ENERGY) / LAB_BOOST_ENERGY);
                const parts = Math.min(matchedParts, byMineral, byEnergy);
                if (parts <= 0) {
                    // 备料未到位 — supplyLabs 依据需求表补给后，下一评估周期执行。
                    continue;
                }
                const result = lab.boostCreep(creep, parts);
                if (result === OK) {
                    if (!industryMem.boostedCreeps)
                        industryMem.boostedCreeps = [];
                    industryMem.boostedCreeps.push(creep.name);
                }
            }
            // ── 5. 执行反应 ──
            if (labPlan.reaction) {
                const input1Assignment = labPlan.assignments.find(a => a.role === "input1");
                const input2Assignment = labPlan.assignments.find(a => a.role === "input2");
                if (input1Assignment && input2Assignment) {
                    const input1Lab = Game.getObjectById(input1Assignment.labId);
                    const input2Lab = Game.getObjectById(input2Assignment.labId);
                    if (input1Lab && input2Lab) {
                        // 确保 input labs 中有正确的原料
                        const input1Amount = input1Lab.store[labPlan.reaction.input1] ?? 0;
                        const input2Amount = input2Lab.store[labPlan.reaction.input2] ?? 0;
                        if (input1Amount >= LAB_REACTION_AMOUNT && input2Amount >= LAB_REACTION_AMOUNT) {
                            // 找一个 output lab 来执行反应
                            const outputAssignment = labPlan.assignments.find(a => a.role === "output");
                            if (outputAssignment) {
                                const outputLab = Game.getObjectById(outputAssignment.labId);
                                if (outputLab) {
                                    outputLab.runReaction(input1Lab, input2Lab);
                                }
                            }
                        }
                    }
                }
            }
        }
    },
};

/**
 * Link 能量传输决策（纯函数）。
 *
 * 根据 link 的角色分类和能量状态，决定哪些 link 应向哪些 link 传输多少能量。
 * 一个 link 每 tick 只能发起一次传输（Screeps 引擎限制）。
 *
 * 传输优先级：
 *   1. source link → controller link（站桩升级供能核心，0 通勤升级链）
 *   2. source link → storage link（溢出回收）
 *   3. storage link → controller link（controller link 缺能且无 source link 补给时）
 */
/**
 * 规划本 tick 的 link 间能量传输。
 *
 * 约束：
 *   - 每个源 link 每 tick 最多参与一次传输（引擎限制）
 *   - 传输量不超过源 link 的可用能量和目标 link 的空闲容量
 *   - 不在冷却中的 link 才能发起传输
 *
 * P1-4 最小传输阈值（minTransfer）：source link 只在能量达到阈值（攒够再发）
 * 或快满（防溢出）时才发起，避免小额传输白占冷却导致源 link 装不下新能量而溢出；
 * controller link 处于“急需”（能量低于阈值）时豁免，保证升级不断粮。
 * minTransfer 默认 0（无阈值，向后兼容），生产调用由 link-system 传入 CONFIG 值。
 */
function planLinkTransfers(links, opts = {}) {
    const minTransfer = opts.minTransfer ?? 0;
    // 快满比例：源 link 能量达容量 90% 时即使低于阈值也发（避免下一批采集溢出）。
    const NEAR_FULL_RATIO = 0.9;
    const transfers = [];
    const sent = new Set();
    const sourceLinks = links.filter(l => l.role === "source" && l.energy > 0 && l.cooldown === 0);
    const controllerLink = links.find(l => l.role === "controller");
    const storageLink = links.find(l => l.role === "storage");
    let controllerNeeds = controllerLink
        ? controllerLink.energyCapacity - controllerLink.energy
        : 0;
    // controller 急需：controller link 能量低于阈值 → 豁免 source 阈值，优先喂升级链。
    const controllerUrgent = controllerLink !== undefined && controllerLink.energy < minTransfer;
    // source link 是否达到发起传输的能量条件：达阈值 或 快满。
    const meetsThreshold = (src) => src.energy >= minTransfer || src.energy >= src.energyCapacity * NEAR_FULL_RATIO;
    // 1. source → controller（最高优先：站桩升级供能）
    for (const src of sourceLinks) {
        if (controllerNeeds <= 0)
            break;
        if (!meetsThreshold(src) && !controllerUrgent)
            continue;
        const amount = Math.min(src.energy, controllerNeeds);
        transfers.push({ fromId: src.id, toId: controllerLink.id, amount });
        sent.add(src.id);
        controllerNeeds -= amount;
    }
    // 2. source → storage（溢出回收）
    if (storageLink) {
        let storageFree = storageLink.energyCapacity - storageLink.energy;
        for (const src of sourceLinks) {
            if (sent.has(src.id) || storageFree <= 0)
                continue;
            if (!meetsThreshold(src))
                continue;
            const amount = Math.min(src.energy, storageFree);
            transfers.push({ fromId: src.id, toId: storageLink.id, amount });
            sent.add(src.id);
            storageFree -= amount;
        }
    }
    // 3. storage → controller（controller 仍缺能时补充）
    if (storageLink &&
        storageLink.cooldown === 0 &&
        storageLink.energy > 0 &&
        controllerLink &&
        controllerNeeds > 0) {
        const amount = Math.min(storageLink.energy, controllerNeeds);
        if (amount > 0) {
            transfers.push({ fromId: storageLink.id, toId: controllerLink.id, amount });
        }
    }
    return transfers;
}

/**
 * Link 能量传输系统 — P1 系统，管理 link 间瞬时能量传输。
 *
 * 职责：
 *   - 将房间内 link 按位置分类（source / controller / storage / hub）
 *   - 调用 planLinkTransfers 计算传输计划
 *   - 执行 link.transferEnergy() 完成能量瞬移
 *
 * link 链路是 RCL5+ 的核心物流：source link ← harvester 存能 →
 * controller link → upgrader 取能，全程 0 通勤替代 hauler 往返。
 * storage link 作为溢出回收和 controller 补给的枢纽。
 *
 * 优先级：P1 — link 传输极廉价（每房每 tick O(links) 查找 + 少量 API 调用），
 * 且直接关系升级吞吐，在能量链中优先级仅次于孵化。
 */
const linkSystem = {
    name: "link-system",
    priority: 1,
    run(ctx) {
        for (const snapshot of ctx.snapshots()) {
            if (snapshot.links.length === 0)
                continue;
            runRoomLinks(snapshot);
        }
    },
};
/**
 * 执行单房 link 传输：分类 → 规划 → 执行。
 */
function runRoomLinks(snapshot) {
    const links = snapshot.links;
    const linkMap = new Map();
    for (const l of links)
        linkMap.set(l.id, l);
    const infos = links.map(l => ({
        id: l.id,
        energy: l.store.getUsedCapacity(RESOURCE_ENERGY),
        energyCapacity: l.store.getCapacity(RESOURCE_ENERGY),
        cooldown: l.cooldown,
        role: classifyLink(l, snapshot),
    }));
    const transfers = planLinkTransfers(infos, { minTransfer: CONFIG.economy.link.minTransfer });
    for (const t of transfers) {
        const from = linkMap.get(t.fromId);
        const to = linkMap.get(t.toId);
        if (!from || !to)
            continue;
        from.transferEnergy(to, t.amount);
    }
}
/**
 * 根据 link 与 source/controller/storage 的距离分类。
 * range <= 2 视为紧邻（harvester 可在采矿位直接 transfer）。
 *
 * 优先级判定：当一个 link 同时紧邻多个目标时（如 source 和 storage 都在 range 2 内），
 * 按物流角色重要性判定 — source > controller > storage > hub。
 * 防止 source link 被误判为 storage link 导致 planLinkTransfers 不把它的能量送到 controller。
 */
function classifyLink(link, snapshot) {
    // 逐一检查所有匹配，收集后按优先级选择。
    const isNearSource = snapshot.sources.some(src => link.pos.getRangeTo(src) <= 2);
    if (isNearSource)
        return "source";
    const isNearController = snapshot.controller != null && link.pos.getRangeTo(snapshot.controller) <= 2;
    if (isNearController)
        return "controller";
    const isNearStorage = snapshot.storage != null && link.pos.getRangeTo(snapshot.storage) <= 2;
    if (isNearStorage)
        return "storage";
    return "hub";
}

/**
 * Pixel 生成系统 — P3 系统，在 CPU bucket 满载时生成 pixel。
 *
 * `Game.cpu.generatePixel()` 消耗 **10000 bucket**（吃光整个 bucket 上限）。
 * 遥测实证：bucket 10000 → 0，随后以 ~+15/tick 净回充爬升 — 注意成本不是 5000，
 * 旧注释的「healthy tier 门禁防跌破阈值」因此形同虚设：每次生成必然清零 bucket。
 *
 * 自愿放血协议：生成后写 Memory.kernel.pixelAt，scheduler 在宽限窗口内把
 * tier 地板抬到 conserve — bucket 清零只损失突发容量，每 tick 20 CPU 限额不变，
 * 常态负载（~2-5 CPU）下经济角色（P0-P2）应照常运行，只有 P3 发展性工作暂停。
 * 无此协议的后果（遥测实录）：每次 pixel → recovery 档 → upgrader/builder 等
 * P2 全停数百 tick → 每 ~660 tick 一轮「creep 不工作」锯齿。
 *
 * 优先级：P3 — 纯收益操作，绝不与生存/发展竞争。
 */
const pixelSystem = {
    name: "pixel-generator",
    priority: 3,
    interval: 10,
    run(ctx) {
        // 只在 healthy tier 下生成 — 保证放血起点是满 bucket + 低负载。
        if (ctx.budget.tier !== "healthy")
            return;
        // 私服无 generatePixel API — 安全检查避免每 10 tick 报 TypeError。
        if (typeof Game.cpu.generatePixel !== "function")
            return;
        if ((Game.cpu.bucket ?? 0) >= 10000) {
            const result = Game.cpu.generatePixel();
            if (result === OK) {
                // 记录放血时刻 — scheduler 据此启用宽限（tier 地板 conserve），
                // 防止看门狗把自愿献血误判为失血性休克。
                if (!Memory.kernel)
                    Memory.kernel = {};
                Memory.kernel.pixelAt = ctx.tick;
            }
        }
    },
};

/**
 * 远矿目标选择 — 纯函数，不访问 Game/Memory。
 *
 * 老玩家认知：远矿选址依赖邻房情报（RoomIntel），核心筛选条件：
 *   1. 普通房（有 controller，可 claim/reserve）
 *   2. 无主（owner 未定义）
 *   3. 房态正常（status === "normal"，排除 novice/respawn/closed）
 *   4. 有 source（有视野时记录了 sources > 0）
 *
 * 优先级排序：有视野 > 无视野（有视野说明已有 creep 路过，信息更可靠）。
 * 同等条件下选 source 数多的（normal 房固定 2 source，但未来 SK 房可能有 3）。
 *
 * 数据流：
 *   room-observer 采集 intel → 本函数筛选候选 → remote-mining-manager 创建 remoteOps
 */
/**
 * 从邻居房情报中筛选远矿候选目标。
 *
 * 纯函数 — 接收预收集的 intel 和 existingOps，不访问 Game/Memory。
 * 返回按优先级排序的候选列表。
 */
function selectRemoteTargets(input) {
    const { homeRoom, intel, existingOps, tick, staleThreshold } = input;
    if (!intel)
        return [];
    const candidates = [];
    const activeTargets = new Set();
    // 收集已有运营的目标（非 abandoned 状态）。
    if (existingOps) {
        for (const [roomName, op] of Object.entries(existingOps)) {
            if (op.state !== "abandoned") {
                activeTargets.add(roomName);
            }
        }
    }
    for (const [roomName, info] of Object.entries(intel)) {
        // 排除自身房间。
        if (roomName === homeRoom)
            continue;
        // 排除已有运营的房间。
        if (activeTargets.has(roomName))
            continue;
        // 只选普通房（有 controller，可 reserve）。
        if (info.kind !== "normal")
            continue;
        // 排除有主的房间。
        if (info.owner)
            continue;
        // 排除非正常状态的房间（novice/respawn/closed）。
        if (info.status !== "normal")
            continue;
        // 排除危险冷却中的房间 — 威胁刚出现过的房不送兵（止损）。
        if (info.dangerUntil !== undefined && tick < info.dangerUntil)
            continue;
        const hasRecentVision = tick - info.lastSeen < staleThreshold;
        candidates.push({
            roomName,
            sources: info.sources,
            hasRecentVision,
        });
    }
    // 排序：有近期视野 > 无视野；source 数多 > 少；房名字母序（确定性）。
    candidates.sort((a, b) => {
        if (a.hasRecentVision !== b.hasRecentVision) {
            return a.hasRecentVision ? -1 : 1;
        }
        const aSources = a.sources ?? 0;
        const bSources = b.sources ?? 0;
        if (aSources !== bSources)
            return bSources - aSources;
        return a.roomName.localeCompare(b.roomName);
    });
    return candidates;
}
/**
 * 判断远矿运营是否应暂停（情报过期或房间状态变化）。
 *
 * 纯函数 — 接收显式参数，不访问 Game/Memory。
 */
function shouldPauseOperation(op, tick, staleThreshold) {
    if (op.state === "abandoned")
        return true;
    return tick - op.lastSeen > staleThreshold;
}

/**
 * 远矿需求评估 — 纯函数，不访问 Game/Memory。
 *
 * 评估每个 active 远矿运营所需的 creep 数量，生成 SpawnRequest。
 *
 * 与本地 evaluateDemand 的区别：
 *   - 远矿需求独立评估，不经过本房的 evaluateDemand
 *   - 远矿 creep 的 home = 孵化房，remoteTarget = 远矿房
 *   - 远矿请求直接推入 spawnQueue，与本地请求共享优先级排序
 *
 * 优先级设计：
 *   - remoteHarvester: P1（经济引擎，与本地 harvester 同级）
 *   - remoteHauler: P1（物流链，与本地 hauler 同级）
 *   - reserver: P2（防御性，不阻塞经济）
 *
 * 安全门禁：
 *   - colonyState 非 normal 时暂停远矿孵化（远矿是扩张行为，危机时收缩）
 *   - CPU tier <= conserve 时不孵化远矿（CPU 预算保护）
 */
/**
 * 评估远矿孵化需求。
 *
 * 纯函数 — 接收预收集的数据，返回待提交的 SpawnRequest 列表。不访问 Game/Memory。
 *
 * 评估逻辑：
 *   1. 遍历 active 状态的远矿运营
 *   2. 对每个运营，统计已分配的 harvester/hauler/reserver 数量
 *   3. 不足目标数量则生成 SpawnRequest
 *   4. 替换逻辑：creep 即将死亡时提前替补
 */
function evaluateRemoteDemand(input) {
    const { homeRoom, colonyState, energyCapacityAvailable, tick, remoteOps, remoteCreeps, spawnQueue } = input;
    const requests = [];
    // 安全门禁：危机/恢复状态时暂停远矿孵化（远矿是扩张行为，危机时收缩）。
    if (colonyState === "recovery" || colonyState === "bootstrap") {
        return { requests };
    }
    // CPU 预算保护：conserve 以下不孵化远矿。
    // 注意：这里只检查 colonyState，CPU tier 检查由系统层在调用前完成。
    for (const [targetRoom, op] of Object.entries(remoteOps)) {
        if (op.state !== "active")
            continue;
        // InvaderCore 压制的房：暂停一切孵化（含 defender）— 打不动就不送兵。
        // 现役 creep 由 remote-mining-manager 的 recycle 通道撤回；
        // 核心消失（自然 decay / 视野确认清空）后本集合不再包含该房，孵化自动恢复。
        if (input.blockedRooms?.has(targetRoom))
            continue;
        // 统计该远矿目标已分配的各角色数量。
        const counts = countRemoteCreepsByRole(remoteCreeps, targetRoom);
        const pending = {
            remoteHarvester: countRemotePending(spawnQueue, "remoteHarvester", targetRoom),
            remoteHauler: countRemotePending(spawnQueue, "remoteHauler", targetRoom),
            reserver: countRemotePending(spawnQueue, "reserver", targetRoom),
        };
        // 1. Remote Harvester — 每目标 1 个（可配置）。
        const harvesterTarget = CONFIG.remote.harvestersPerTarget;
        const harvesterTotal = (counts.remoteHarvester ?? 0) + pending.remoteHarvester;
        if (harvesterTotal < harvesterTarget) {
            const key = spawnKey("remoteHarvester", homeRoom, harvesterTotal, targetRoom);
            const body = selectBody("remoteHarvester", energyCapacityAvailable);
            requests.push(createRemoteRequest("remoteHarvester", homeRoom, targetRoom, harvesterTotal, key, 1, body, tick));
        }
        else {
            // 替换逻辑：检查即将死亡的 remoteHarvester。
            const replacement = findReplacement(remoteCreeps, "remoteHarvester", targetRoom);
            if (replacement) {
                // 替补 key 绑定濒死 creep 名而非 total 索引：total = 存活 + pending，
                // 随替补请求入队而增长，同一濒死 creep 会在每个评估周期产生新 key 的重复请求；
                // 稳定 key 使 submitRequest 按 key 幂等合并，替换窗口内始终只有一条替补请求。
                const key = replacementKey("remoteHarvester", homeRoom, targetRoom, replacement);
                const body = selectBody("remoteHarvester", energyCapacityAvailable);
                requests.push(createRemoteRequest("remoteHarvester", homeRoom, targetRoom, harvesterTotal, key, 1, body, tick, replacement));
            }
        }
        // 2. Remote Hauler — 每目标 1 个（可配置）。
        const haulerTarget = CONFIG.remote.haulersPerTarget;
        const haulerTotal = (counts.remoteHauler ?? 0) + pending.remoteHauler;
        if (haulerTotal < haulerTarget) {
            const key = spawnKey("remoteHauler", homeRoom, haulerTotal, targetRoom);
            const body = selectBody("remoteHauler", energyCapacityAvailable);
            requests.push(createRemoteRequest("remoteHauler", homeRoom, targetRoom, haulerTotal, key, 1, body, tick));
        }
        else {
            const replacement = findReplacement(remoteCreeps, "remoteHauler", targetRoom);
            if (replacement) {
                // 稳定替补 key（同 harvester 分支）。
                const key = replacementKey("remoteHauler", homeRoom, targetRoom, replacement);
                const body = selectBody("remoteHauler", energyCapacityAvailable);
                requests.push(createRemoteRequest("remoteHauler", homeRoom, targetRoom, haulerTotal, key, 1, body, tick, replacement));
            }
        }
        // 3. Reserver — 每目标 1 个（可配置，RCL 门禁由系统层检查）。
        {
            const reserverTotal = (counts.reserver ?? 0) + pending.reserver;
            if (reserverTotal < 1) {
                const key = spawnKey("reserver", homeRoom, reserverTotal, targetRoom);
                const body = selectBody("reserver", energyCapacityAvailable);
                // reserver body 可能无法在低容量时生成（CLAIM 需要 650 能量）。
                // 如果 body 选择失败（回退到 RECOVERY_BODY），跳过 — 等容量提升后再孵化。
                if (body.includes("claim")) {
                    requests.push(createRemoteRequest("reserver", homeRoom, targetRoom, reserverTotal, key, 2, body, tick));
                }
            }
            else {
                const replacement = findReplacement(remoteCreeps, "reserver", targetRoom);
                if (replacement) {
                    // 稳定替补 key（同 harvester 分支）。
                    const key = replacementKey("reserver", homeRoom, targetRoom, replacement);
                    const body = selectBody("reserver", energyCapacityAvailable);
                    if (body.includes("claim")) {
                        requests.push(createRemoteRequest("reserver", homeRoom, targetRoom, reserverTotal, key, 2, body, tick, replacement));
                    }
                }
            }
        }
        // 4. Remote Defender — 有威胁时生成。
        {
            const hasThreats = input.remoteThreats?.[targetRoom] ?? false;
            if (hasThreats) {
                const defenderPending = countRemotePending(spawnQueue, "remoteDefender", targetRoom);
                const defenderTotal = (counts.remoteDefender ?? 0) + defenderPending;
                if (defenderTotal < 1) {
                    const key = spawnKey("remoteDefender", homeRoom, defenderTotal, targetRoom);
                    const body = selectBody("remoteDefender", energyCapacityAvailable);
                    requests.push(createRemoteRequest("remoteDefender", homeRoom, targetRoom, defenderTotal, key, 1, body, tick));
                }
            }
        }
    }
    return { requests };
}
// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────
/** 统计指定远矿目标的各角色存活 creep 数。 */
function countRemoteCreepsByRole(creeps, targetRoom) {
    const counts = {};
    for (const creep of creeps) {
        if (creep.remoteTarget !== targetRoom)
            continue;
        const role = creep.role ?? "unknown";
        counts[role] = (counts[role] ?? 0) + 1;
    }
    return counts;
}
/** 统计指定远矿目标的某角色 pending 请求数。 */
function countRemotePending(queue, role, targetRoom) {
    let count = 0;
    for (const req of queue) {
        if (req.role !== role)
            continue;
        if (req.memory.remoteTarget !== targetRoom)
            continue;
        count++;
    }
    return count;
}
/**
 * 查找需要替换的远矿 creep。
 * 阈值 = body.length * 3 + replaceBuffer + travelTicks（跨房通勤更远，加 50 tick 余量）。
 */
function findReplacement(creeps, role, targetRoom, tick) {
    for (const creep of creeps) {
        if (creep.role !== role)
            continue;
        if (creep.remoteTarget !== targetRoom)
            continue;
        if (creep.ticksToLive === undefined)
            continue;
        const threshold = (creep.bodyLength ?? 3) * 3 + CONFIG.spawn.replaceBuffer + 50;
        if (creep.ticksToLive <= threshold) {
            return creep.name;
        }
    }
    return undefined;
}
/**
 * 替补请求的稳定去重 key — 绑定被替换 creep 的名字。
 *
 * 不使用 spawnKey(role, home, total, target)：total = 存活 + pending 之和，
 * 每个评估周期随 pending 增长而漂移，同一濒死 creep 会产生一串不同 key 的
 * 重复请求（P1-5）。creep 名在其生命周期内唯一且稳定，天然幂等。
 */
function replacementKey(role, home, target, dyingCreepName) {
    return `${role}:${home}:${target}:repl:${dyingCreepName}`;
}
/** 创建远矿 SpawnRequest。 */
function createRemoteRequest(role, home, target, index, key, priority, body, tick, replaceBy) {
    const req = {
        key,
        role,
        home,
        priority,
        body,
        memory: {
            role,
            home,
            mode: "acquire",
            spawnIndex: index,
            remoteTarget: target,
        },
        createdAt: tick,
        // 请求带 TTL：需求消失（运营 paused/abandoned）后的 stale 请求
        // 由 cleanQueue 按 expiresAt 清除，不会永久排队直至孵化。
        expiresAt: tick + CONFIG.spawn.requestTtl,
        retries: 0,
    };
    if (replaceBy) {
        req.replaceBy = tick;
    }
    return req;
}

/**
 * Remote Mining Manager — P2 系统，远矿运营的中央调度器。
 *
 * 职责：
 *   - 从 RoomMemory.intel 评选远矿目标（selectRemoteTargets）
 *   - 创建/更新 RoomMemory.remoteOps 状态
 *   - 评估远矿 spawn 需求（evaluateRemoteDemand）
 *   - 将远矿请求推入 spawnQueue
 *   - 暂停过期运营、清理废弃运营
 *
 * 数据流：
 *   room-observer（每 50 tick 采集 intel）
 *     → remote-mining-manager（每 10 tick 评估）
 *       → selectRemoteTargets（纯函数筛选候选）
 *       → evaluateRemoteDemand（纯函数生成请求）
 *       → spawnQueue（推入请求）
 *         → spawn-manager（孵化执行）
 *
 * 优先级：P2 — 远矿是扩张行为，不阻塞本房经济。
 * 间隔：10 tick — 平衡响应速度与 CPU 开销。
 *
 * 安全门禁：
 *   - colonyState 非 normal 时暂停新远矿孵化
 *   - CPU tier conserve 以下不孵化远矿
 *   - RCL < minRcl 时不启动远矿
 *   - 远矿目标数不超过 maxOperations
 */
const remoteMiningManagerSystem = {
    name: "remote-mining-manager",
    priority: 2,
    interval: CONFIG.remote.managerInterval,
    run(ctx) {
        for (const snapshot of ctx.snapshots()) {
            const roomMem = Memory.rooms[snapshot.roomName];
            if (!roomMem)
                continue;
            // RCL 门禁：低于 minRcl 不启动远矿。
            if (snapshot.rcl < CONFIG.remote.minRcl)
                continue;
            const remoteOps = roomMem.remoteOps ?? {};
            // 1. 评估现有运营：暂停过期、清理废弃。
            maintainExistingOps(remoteOps, ctx.tick);
            // 2. 如果 active 运营数不足，从 intel 评选新目标。
            //    战略门禁：开辟新远矿点须获 empire-strategy 姿态授权
            //    （fortify/war 时收缩战线不铺新点）；现役运营不受影响。
            const activeCount = countActiveOps(remoteOps);
            const newOpsAllowed = Memory.kernel?.strategy?.newRemoteOpsAllowed === true;
            if (newOpsAllowed && activeCount < CONFIG.remote.maxOperations) {
                const candidates = selectRemoteTargets({
                    homeRoom: snapshot.roomName,
                    intel: roomMem.intel,
                    existingOps: remoteOps,
                    tick: ctx.tick,
                    staleThreshold: CONFIG.remote.staleThreshold,
                });
                // 只补充到 maxOperations。
                const needed = CONFIG.remote.maxOperations - activeCount;
                for (let i = 0; i < Math.min(needed, candidates.length); i++) {
                    const candidate = candidates[i];
                    remoteOps[candidate.roomName] = {
                        state: "active",
                        sources: candidate.sources,
                        createdAt: ctx.tick,
                        lastSeen: ctx.tick,
                    };
                }
            }
            // 3. 更新 remoteOps 到 Memory。
            if (Object.keys(remoteOps).length > 0) {
                roomMem.remoteOps = remoteOps;
            }
            // 4. 评估远矿 spawn 需求。
            const colonyState = roomMem.colonyState ?? "normal";
            const queue = roomMem.spawnQueue ?? [];
            // 收集远矿 creep 摘要（从 Game.creeps 遍历一次）。
            const remoteCreeps = collectRemoteCreeps(snapshot.roomName);
            // 收集远矿房威胁（有视野的 active 运营房）— evaluateRemoteDemand 据此
            // 生成 remoteDefender 请求；缺少此输入时 defender 分支永不触发。
            const remoteThreats = collectRemoteThreats(remoteOps);
            // 收集 InvaderCore 压制房（结构不是 creep，FIND_HOSTILE_CREEPS 检测不到）。
            // 核心 100,000 hits，defender/reserver 均无力处理 — 该房进入止损模式：
            // 打上危险冷却 + 暂停孵化 + 回收现役 creep，等核心自然 decay 后自动恢复。
            const remoteBlockers = collectRemoteBlockers(remoteOps);
            // 压制状态持久化：瞬时视野检测 + Memory 冷却双轨合并。
            // 只用瞬时集合的死角：回收 creep 后该房失明 → 检测集合清空 → 孵化恢复
            // → 新 creep 抵达发现核心 → 再回收 — 死循环，每轮白送整编 creep。
            // 规则：有视野见核心 → 写/续期 blockedUntil；有视野确认消失 → 立即清除；
            // 无视野 → 冷却未到期即视为仍被压制（宁可少采 5000 tick，不送一轮兵）。
            const blockedRooms = new Set();
            for (const [rn, op] of Object.entries(remoteOps)) {
                if (op.state !== "active")
                    continue;
                const observed = remoteBlockers[rn];
                if (observed === true) {
                    // 有视野且核心在场 — 写入/续期压制冷却。
                    op.blockedUntil = ctx.tick + CONFIG.remote.coreBlockCooldown;
                    blockedRooms.add(rn);
                }
                else if (observed === false) {
                    // 有视野且确认核心消失 — 提前解封。
                    if (op.blockedUntil !== undefined)
                        op.blockedUntil = undefined;
                }
                else if (op.blockedUntil !== undefined) {
                    // 无视野 — 冷却期内维持压制；到期后放行（恢复孵化以重获视野再评估）。
                    if (ctx.tick < op.blockedUntil) {
                        blockedRooms.add(rn);
                    }
                    else {
                        op.blockedUntil = undefined;
                    }
                }
            }
            // 威胁写入情报层：出现威胁的远矿房打上危险冷却标记 —
            // 冷却期内该房不作为新的远矿/扩张候选（止损：不给对手送兵）。
            // 现役运营不因此暂停 — defender 已接通，先应战再评估。
            // InvaderCore 压制房同样打冷却 — 核心存续期间不重复选点。
            if (roomMem.intel) {
                for (const [threatRoom, hasThreat] of Object.entries(remoteThreats)) {
                    if (!hasThreat && !blockedRooms.has(threatRoom))
                        continue;
                    const info = roomMem.intel[threatRoom];
                    if (info) {
                        info.dangerUntil = ctx.tick + CONFIG.remote.dangerCooldown;
                    }
                }
            }
            // InvaderCore 压制房的现役远矿 creep 全部标记回收 —
            // harvester 采集被压制、reserver 空耗寿命，留守是持续净亏损。
            recycleBlockedRoomCreeps(snapshot.roomName, blockedRooms);
            const { requests } = evaluateRemoteDemand({
                homeRoom: snapshot.roomName,
                colonyState,
                energyCapacityAvailable: snapshot.energyCapacityAvailable,
                tick: ctx.tick,
                remoteOps,
                remoteCreeps,
                spawnQueue: queue,
                remoteThreats,
                blockedRooms,
            });
            // 推入 spawnQueue。
            for (const req of requests) {
                submitRequest(queue, req);
            }
            roomMem.spawnQueue = queue;
            // 5. 回收过量远矿 creep（超过配置上限的旧 creep 标记回收，节省 CPU）。
            recycleExcessRemoteCreeps(snapshot.roomName, remoteOps);
        }
    },
};
/**
 * 维护现有远矿运营：暂停过期运营、更新 lastSeen、清理废弃。
 */
function maintainExistingOps(remoteOps, tick) {
    for (const [roomName, op] of Object.entries(remoteOps)) {
        if (op.state === "abandoned")
            continue;
        // 归属校验（需视野）：目标房已被其他玩家占有 → 立即废弃。
        // intel 对从未有视野的房间记录不到 owner（盲选是远矿自举的必经之路 —
        // 第一只远矿 creep 进房才产生视野），因此把校验放在获得视野之后，
        // 而非在候选筛选阶段排除所有未知房。
        const targetRoom = Game.rooms[roomName];
        if (targetRoom?.controller?.owner && !targetRoom.controller.my) {
            op.state = "abandoned";
            continue;
        }
        // 检查是否有 creep 在该远矿房（有则更新 lastSeen）。
        const hasCreep = hasCreepInRoom(roomName);
        if (hasCreep) {
            op.lastSeen = tick;
        }
        // 过期暂停。
        if (shouldPauseOperation(op, tick, CONFIG.remote.staleThreshold)) {
            if (op.state === "active") {
                op.state = "paused";
            }
        }
        else if (op.state === "paused") {
            // 恢复：有新视野或 creep 到达时恢复 active。
            if (hasCreep) {
                op.state = "active";
                op.lastSeen = tick;
            }
        }
    }
    // 清理长期废弃的运营（超过 staleThreshold * 3 且无 creep）。
    const abandonThreshold = CONFIG.remote.staleThreshold * 3;
    for (const [roomName, op] of Object.entries(remoteOps)) {
        if (op.state === "paused" && tick - op.lastSeen > abandonThreshold) {
            op.state = "abandoned";
        }
    }
    // 清理 abandoned 超过 10000 tick 的记录（防止 Memory 膨胀）。
    const cleanupThreshold = CONFIG.remote.staleThreshold * 6;
    for (const roomName of Object.keys(remoteOps)) {
        const op = remoteOps[roomName];
        if (op.state === "abandoned" && tick - op.lastSeen > cleanupThreshold) {
            delete remoteOps[roomName];
        }
    }
}
/** 统计 active 状态的运营数。 */
function countActiveOps(remoteOps) {
    let count = 0;
    for (const op of Object.values(remoteOps)) {
        if (op.state === "active")
            count++;
    }
    return count;
}
/** 检查是否有 creep 在指定房间（通过 Game.rooms 判断可见性 + creep 存在）。 */
function hasCreepInRoom(roomName) {
    const room = Game.rooms[roomName];
    if (!room)
        return false;
    // 检查是否有自己的 creep 在该房间。
    return Object.values(Game.creeps).some((c) => c.room.name === roomName && c.my);
}
/**
 * 回收过量远矿 creep。
 *
 * 当某远矿目标的存活 creep 数超过配置上限时，标记最老的 creep 回收。
 * 回收标记由 spawn-manager 的 recyclePass 实际执行（spawn.recycleCreep）。
 * 只标记超额部分，保留配置上限数量的 creep 继续工作。
 */
function recycleExcessRemoteCreeps(homeRoom, remoteOps) {
    // 收集每个 active 目标的远矿 creep，按角色分组。
    const byTarget = new Map();
    for (const creep of Object.values(Game.creeps)) {
        if (creep.memory.home !== homeRoom)
            continue;
        if (creep.memory.recycle)
            continue; // 已标记回收的跳过。
        const target = creep.memory.remoteTarget;
        if (!target)
            continue;
        const op = remoteOps[target];
        if (!op || op.state !== "active")
            continue;
        let entry = byTarget.get(target);
        if (!entry) {
            entry = { harvester: [], hauler: [], reserver: [], defender: [] };
            byTarget.set(target, entry);
        }
        const role = creep.memory.role;
        if (role === "remoteHarvester")
            entry.harvester.push(creep);
        else if (role === "remoteHauler")
            entry.hauler.push(creep);
        else if (role === "reserver")
            entry.reserver.push(creep);
        else if (role === "remoteDefender")
            entry.defender.push(creep);
    }
    // 对每个目标，检查是否超额。
    for (const [, entry] of byTarget) {
        // harvester 超额：保留 harvestersPerTarget 个最年轻的，回收其余。
        if (entry.harvester.length > CONFIG.remote.harvestersPerTarget) {
            entry.harvester.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
            for (let i = CONFIG.remote.harvestersPerTarget; i < entry.harvester.length; i++) {
                entry.harvester[i].memory.recycle = true;
            }
        }
        // hauler 超额。
        if (entry.hauler.length > CONFIG.remote.haulersPerTarget) {
            entry.hauler.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
            for (let i = CONFIG.remote.haulersPerTarget; i < entry.hauler.length; i++) {
                entry.hauler[i].memory.recycle = true;
            }
        }
        // reserver 超额（目标 1 个）。
        if (entry.reserver.length > 1) {
            entry.reserver.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
            for (let i = 1; i < entry.reserver.length; i++) {
                entry.reserver[i].memory.recycle = true;
            }
        }
        // defender 超额（目标 1 个 — 威胁清除后多余的 defender 回收）。
        if (entry.defender.length > 1) {
            entry.defender.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
            for (let i = 1; i < entry.defender.length; i++) {
                entry.defender[i].memory.recycle = true;
            }
        }
    }
}
/** 收集归属于本房的所有远矿 creep 摘要。 */
function collectRemoteCreeps(homeRoom) {
    const result = [];
    for (const creep of Object.values(Game.creeps)) {
        if (creep.memory.home !== homeRoom)
            continue;
        const role = creep.memory.role ?? "unknown";
        // 只收集远矿角色。
        if (role !== "remoteHarvester" && role !== "remoteHauler" && role !== "reserver" && role !== "remoteDefender") {
            continue;
        }
        result.push({
            name: creep.name,
            role,
            remoteTarget: creep.memory.remoteTarget,
            ticksToLive: creep.ticksToLive,
            bodyLength: creep.body.length,
        });
    }
    return result;
}
/**
 * 收集远矿房威胁信息 — 检测 active 运营的远矿房是否有 hostile creep。
 * 用于触发 remoteDefender 孵化需求。
 */
function collectRemoteThreats(remoteOps) {
    const threats = {};
    for (const [roomName, op] of Object.entries(remoteOps)) {
        if (op.state !== "active")
            continue;
        const room = Game.rooms[roomName];
        if (!room)
            continue;
        const hostiles = room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) => {
                const allies = CONFIG.defense.allies;
                return !allies.includes(c.owner.username);
            },
        });
        threats[roomName] = hostiles.length > 0;
    }
    return threats;
}
/**
 * 收集 InvaderCore 压制信息 — 检测 active 运营的远矿房是否被 InvaderCore 占据。
 *
 * InvaderCore 是敌对结构而非 creep，FIND_HOSTILE_CREEPS 检测不到 —
 * 「房里只有一个核心、没有 Invader creep」的场景在旧实现中完全漏报，
 * 运营继续送 harvester/reserver 空耗。检测需要视野（active 房通常有驻场 creep）。
 * 导出供接线测试验证检测链路。
 */
function collectRemoteBlockers(remoteOps) {
    const blockers = {};
    for (const [roomName, op] of Object.entries(remoteOps)) {
        if (op.state !== "active")
            continue;
        const room = Game.rooms[roomName];
        if (!room)
            continue;
        const cores = room.find(FIND_HOSTILE_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
        });
        blockers[roomName] = cores.length > 0;
    }
    return blockers;
}
/**
 * 回收 InvaderCore 压制房的现役远矿 creep。
 *
 * 核心压制期间该房是净亏损：source 被敌方预约压在 1500 容量、
 * reserver 打不动核心持续续期的预约。标记 recycle 后 role-runner 短路停工，
 * spawn-manager 的 recyclePass 引导回收；孵化冻结由 blockedRooms 负责，
 * 核心 decay 后运营自动恢复（remoteOps 状态与 intel 均保留）。
 */
function recycleBlockedRoomCreeps(homeRoom, blockedRooms) {
    if (blockedRooms.size === 0)
        return;
    for (const creep of Object.values(Game.creeps)) {
        if (creep.memory.home !== homeRoom)
            continue;
        if (creep.memory.recycle)
            continue;
        const target = creep.memory.remoteTarget;
        if (!target || !blockedRooms.has(target))
            continue;
        creep.memory.recycle = true;
    }
}

/**
 * 邻居房情报（C2：M7 远矿/扩张的数据源，零视野成本先行积累）。
 *
 * 老玩家认知：扩张选址依赖「邻房有什么」——source 数、矿物、归属、是否 SK 房。
 * 其中房名分类（highway/center/SK/normal）与房间状态（novice/respawn/closed）
 * 无需视野即可获得；source/矿物/归属需要视野（未来 scout/observer 补全）。
 *
 * 纯函数 — 不访问 Game/Memory，所有数据由调用方采集后传入。
 */
/**
 * 按房名分类房间（无需视野）。
 *
 * 官方地图规律：坐标个位（mod 10）决定房间性质——
 *   任一坐标 mod 10 == 0        → 公路房（highway，十字路口无 controller）
 *   双坐标 mod 10 == 5          → 中心房（center，3 source + 1 矿，无 controller）
 *   双坐标 mod 10 ∈ {4,5,6}     → source keeper 房（3 source，SK 把守）
 *   其余                        → 普通房（可 claim）
 */
function classifyRoomByName(roomName) {
    const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!match)
        return "normal";
    const x = Number(match[2]) % 10;
    const y = Number(match[4]) % 10;
    if (x === 0 || y === 0)
        return "highway";
    if (x === 5 && y === 5)
        return "center";
    if (x >= 4 && x <= 6 && y >= 4 && y <= 6)
        return "sk";
    return "normal";
}
/** 扫描单个邻房的情报。visibleRoom 为 undefined 时只落房名分类与房态。
 *
 * prev：既有条目 — 跨刷新保留的字段（dangerUntil；无视野时还保留上次的
 * sources/mineral/owner/towers 观测值）。不传则视为首次建档。
 * 危险标记必须跨刷新存活：它由威胁事件写入，常规情报刷新不得冲掉。
 */
function scanNeighborIntel(roomName, status, tick, visibleRoom, prev) {
    const intel = {
        kind: classifyRoomByName(roomName),
        status,
        lastSeen: tick,
    };
    if (visibleRoom) {
        intel.sources = visibleRoom.sources;
        if (visibleRoom.mineralType)
            intel.mineral = visibleRoom.mineralType;
        if (visibleRoom.owner)
            intel.owner = visibleRoom.owner;
        if (visibleRoom.towers !== undefined)
            intel.towers = visibleRoom.towers;
    }
    else if (prev) {
        // 无视野：沿用上次观测值（数据会随 lastSeen 保持但陈旧度由消费方判断）。
        if (prev.sources !== undefined)
            intel.sources = prev.sources;
        if (prev.mineral !== undefined)
            intel.mineral = prev.mineral;
        if (prev.owner !== undefined)
            intel.owner = prev.owner;
        if (prev.towers !== undefined)
            intel.towers = prev.towers;
        // 无视野时 lastSeen 不应前移（视野数据没有更新）。
        intel.lastSeen = prev.lastSeen;
    }
    // 危险冷却：未到期则保留（与视野无关 — 由威胁事件独立管理）。
    if (prev?.dangerUntil !== undefined && tick < prev.dangerUntil) {
        intel.dangerUntil = prev.dangerUntil;
    }
    return intel;
}

/**
 * 相位诊断日志的固定打印间隔（tick）。
 * 相位变化时立即打印；无变化时每 50 tick 打印一次完整快照，便于在控制台观察趋势。
 */
const PHASE_LOG_INTERVAL = 50;
/** 邻居情报刷新间隔（tick）。房态/归属变化慢，50 tick 足够且零 CPU 压力。 */
const INTEL_SCAN_INTERVAL = 50;
/** Observer 视野请求间隔（tick）。每次挑一个最陈旧的邻房刷新。 */
const OBSERVE_INTERVAL = 25;
/** intel 视野数据的陈旧阈值（tick）— 超过则值得用 observer 刷新。 */
const INTEL_STALE_AFTER = 2000;
/**
 * 房间观察器 — P3 房间级诊断与情报采集。
 *
 * 职责：
 *   - 相位诊断日志（趋势观察，供调参）
 *   - 邻居房情报采集（出口/房态/SK 分类零视野可得；资源/归属字段需视野补全）
 *   - observer 视野调度：observeRoom 的视野只存续下一 tick，
 *     因此系统 interval 必须为 1：本 tick 请求 → 下 tick 捕获。
 *     内部各任务自带取模门控，非触发 tick 的开销仅为几次条件判断。
 *
 * 经济状态计算（ColonyPhase → ColonyState）已移至 room-state 系统（P0，每 tick）。
 */
const roomObserverSystem = {
    name: "room-observer",
    priority: 3,
    interval: 1,
    run(ctx) {
        // 上一 tick 通过 observer 请求的视野本 tick 生效 — 优先捕获（仅一次机会）。
        captureObservedIntel(ctx.tick);
        for (const snapshot of ctx.snapshots()) {
            const roomMem = Memory.rooms[snapshot.roomName];
            if (!roomMem)
                continue;
            // 诊断日志：相位变化时立即打印；无变化时按固定间隔打印快照。
            // room-state 系统每 tick 更新 roomMem.phase，此处仅读取并输出。
            const phase = roomMem.phase;
            if (phase) {
                logPhaseIfChangedOrDue(ctx.tick, snapshot.roomName, undefined, // 前一个相位名称不再在此追踪（room-state 已写入）
                phase.phase, phase);
            }
            // 邻居房情报 — 远矿/扩张选址的数据源。
            if (ctx.tick % INTEL_SCAN_INTERVAL === 0) {
                refreshNeighborIntel(snapshot.roomName, roomMem, ctx.tick);
            }
            // Observer 视野调度：挑最陈旧的邻房请求视野，下一 tick 捕获。
            if (snapshot.observer && ctx.tick % OBSERVE_INTERVAL === 0) {
                requestObservation(snapshot.observer, snapshot.roomName, roomMem, ctx.tick);
            }
        }
    },
};
function pendingSlot() {
    const g = globalCache();
    if (!g.__observePending)
        g.__observePending = {};
    return g.__observePending;
}
/**
 * 挑选最值得刷新的邻房并请求 observer 视野。
 * 优先级：从未有过视野（sources 未知）> 视野数据最陈旧且超过阈值。
 */
function requestObservation(observer, homeRoom, roomMem, tick) {
    const intel = roomMem.intel;
    if (!intel)
        return;
    let target;
    let staleness = -1;
    for (const [neighbor, info] of Object.entries(intel)) {
        if (info.kind === "highway")
            continue; // 公路房无 source/controller，观察无收益。
        if (info.sources === undefined) {
            // 从未有过视野 — 最高优先。
            target = neighbor;
            staleness = Infinity;
            break;
        }
        const age = tick - info.lastSeen;
        if (age > INTEL_STALE_AFTER && age > staleness) {
            target = neighbor;
            staleness = age;
        }
    }
    if (!target)
        return;
    if (observer.observeRoom(target) === OK) {
        pendingSlot().pending = { tick, targetRoom: target, homeRoom };
    }
}
/**
 * 捕获上一 tick observer 请求的视野 — observeRoom 的视野只在下一 tick 存在，
 * 错过本次窗口就要等下个 OBSERVE_INTERVAL。
 */
function captureObservedIntel(tick) {
    const slot = pendingSlot();
    const pending = slot.pending;
    if (!pending)
        return;
    if (pending.tick !== tick - 1) {
        slot.pending = undefined;
        return;
    }
    slot.pending = undefined;
    const room = Game.rooms[pending.targetRoom];
    const roomMem = Memory.rooms[pending.homeRoom];
    if (!room || !roomMem?.intel)
        return;
    const status = Game.map.getRoomStatus(pending.targetRoom).status;
    roomMem.intel[pending.targetRoom] = scanNeighborIntel(pending.targetRoom, status, tick, {
        sources: room.find(FIND_SOURCES).length,
        mineralType: room.find(FIND_MINERALS)[0]?.mineralType,
        owner: room.controller?.owner?.username,
        towers: countHostileTowers(room),
    }, roomMem.intel[pending.targetRoom]);
}
/**
 * 刷新本房出口邻房的情报记录。
 * describeExits + getRoomStatus 无需视野；Game.rooms 有视野时补资源/归属字段。
 * 只写短字段（每邻房 ≤6 个标量），Memory 体积有界。
 */
function refreshNeighborIntel(roomName, roomMem, tick) {
    const exits = Game.map.describeExits(roomName);
    if (!exits)
        return;
    const intel = roomMem.intel ?? {};
    for (const neighbor of Object.values(exits)) {
        if (!neighbor)
            continue;
        const status = Game.map.getRoomStatus(neighbor).status;
        const visible = Game.rooms[neighbor];
        intel[neighbor] = scanNeighborIntel(neighbor, status, tick, visible
            ? {
                sources: visible.find(FIND_SOURCES).length,
                mineralType: visible.find(FIND_MINERALS)[0]?.mineralType,
                owner: visible.controller?.owner?.username,
                towers: countHostileTowers(visible),
            }
            : undefined, intel[neighbor]);
    }
    roomMem.intel = intel;
}
/** 统计房间内敌方 tower 数（进攻/远矿风险评估的核心变量）。 */
function countHostileTowers(room) {
    return room
        .find(FIND_HOSTILE_STRUCTURES)
        .filter(s => s.structureType === STRUCTURE_TOWER).length;
}
/**
 * 相位诊断日志输出（限频）。
 *
 * 触发条件：
 *   - 到达 PHASE_LOG_INTERVAL 周期：打印完整快照，标记 [PERIODIC]
 *
 * 无变化且未到周期：静默，避免控制台刷屏。
 */
function logPhaseIfChangedOrDue(tick, roomName, _prevPhase, newPhase, state) {
    const due = tick % PHASE_LOG_INTERVAL === 0;
    if (!due)
        return;
    console.log(`[PERIODIC] phase/${roomName}: phase=${newPhase}` +
        ` reserve=${state.reserve} delta=${state.reserveDelta >= 0 ? "+" : ""}${state.reserveDelta}` +
        ` drain=${state.drainScore} harv=${state.harvesterCount}/${state.sourceCount} rcl=${state.rcl}` +
        ` state=${Memory.rooms[roomName]?.colonyState ?? "?"}`);
}

const DEFAULT_PHASE_OPTIONS = {
    // 迟滞带加宽：进入 crisis 需 150 分（10 tick @step15），退出需降到 30（4 tick @step40）。
    // 旧值 100/40 在 ec=300 时 4 tick 即触发，导致 phase 在 growth↔crisis 间高频振荡。
    drainEnterScore: 150,
    drainExitScore: 30,
    recoveryClearScore: 5,
    // 非对称步长：进入慢（15/tick），退出快（40/tick）——交替场景下净 -25/tick，快速脱困。
    scoreStep: 15,
    recoveryStep: 40,
    // 流动性陷阱收紧：ec=300 时 spendableRatio<0.3 太容易触发（spawn 空=常态）。
    // 0.15 → ec=300 时需 spendable<45 才触发；0.8 → container 80%+ 才算积压。
    liquiditySpendableRatio: 0.15,
    liquidityFrozenRatio: 0.8,
    // 非对称步长：陷阱累积慢（15/tick），恢复快（50/tick）——交替场景下净 -35/tick。
    liquidityStep: 15,
    liquidityRecoveryStep: 50,
    // 主动消费豁免：spendableRatio ≥ 0.5（spawn 口袋过半）时储备下降不计赤字。
    // 0.5 给 spawn 补能延迟留余量：孵化脉冲后 hauler 回填需数 tick，健康房常态在 0.5 以上。
    drainSpendableFloor: 0.5,
    // 最短驻留 100 次评估（room-state 每 tick 评估 → 100 tick）：
    // 覆盖一轮 creep 孵化 + 通勤周期，让 recovery 期真正攒出缓冲，而非形式性过场。
    minBandTicks: 100,
};
/**
 * 计算殖民相位（纯函数，带迟滞）。
 *
 * 双维度危机模型（方案 C）：
 *   - 偿付能力维度 drainScore：总储备趋势（reserveDelta < 0 持续）→ 生产崩溃。
 *   - 流动性维度 liquidityScore：spendableRatio 低且 frozenRatio 高持续 → 物流死锁
 *     （能量冻在 container，spawn 破产，W37S58 根因）。
 *   crisisScore = max(drainScore, liquidityScore)，任一维度爆表即危机。
 *   这修复了旧模型「只量总财富不量流动性」的失明：W37S58 总储备在涨（drainScore=0）
 *   但 94% 能量冻在 container、spawn 只有 5% 可达，旧模型判为 growth，永久死锁。
 *
 * 相位优先级：
 *   crisis（crisisScore 高）> recovery（脱离中）> steady（RCL8 且满员）> bootstrap（harvester 不足）> growth。
 * crisis/recovery 之间用 crisisScore 迟滞，避免在临界点抖动。
 */
function evaluateColonyPhase(input, prev, options = DEFAULT_PHASE_OPTIONS) {
    // 首次观测无基线，reserveDelta 记 0（不判为赤字）。
    const reserveDelta = prev.prevReserve === undefined ? 0 : input.reserve - prev.prevReserve;
    // ── 偿付能力维度：drainScore ──
    // 主动消费豁免（TD-003 根因 A）：spawn 口袋健康时的储备下降是升级/建造投资，
    // 只有「储备下降 且 可孵化能量吃紧」才视为生产端失血。
    const draining = reserveDelta < 0 && input.spendableRatio < options.drainSpendableFloor;
    // P0-2：非对称步长 — 盈余时用 recoveryStep（> scoreStep）加速退出，打破临界振荡。
    const delta = draining ? options.scoreStep : -options.recoveryStep;
    const drainScore = Math.max(0, Math.min(options.drainEnterScore, prev.drainScore + delta));
    // ── 流动性维度：liquidityScore ──
    // 流动性陷阱 = spawn 破产（可达能量占比低）且能量积压（最满 container 填充率高）。
    // 两者必须同时成立：单独 container 满是正常物流中转（hauler 正在搬），不是危机；
    // 单独 spawn 空是孵化脉冲消耗（马上被 hauler 补回），也不是危机。
    // 只有「container 满 + spawn 空」持续存在 = 搬运能力不足/缺失 = 真死锁。
    const liquidityTrap = input.spendableRatio < options.liquiditySpendableRatio &&
        input.frozenRatio > options.liquidityFrozenRatio;
    const liquidityDelta = liquidityTrap ? options.liquidityStep : -options.liquidityRecoveryStep;
    const prevLiquidity = prev.liquidityScore ?? 0;
    const liquidityScore = Math.max(0, Math.min(options.drainEnterScore, prevLiquidity + liquidityDelta));
    // ── 合并双维度：任一爆表即危机 ──
    const crisisScore = Math.max(drainScore, liquidityScore);
    const understaffed = input.harvesterCount < Math.max(1, input.sourceCount);
    const inCrisisBand = prev.phase === "crisis" || prev.phase === "recovery";
    // 危机带驻留计数（TD-003 根因 B）：带内每次评估 +1，用于最短驻留判定。
    const bandTicksSoFar = inCrisisBand ? (prev.bandTicks ?? 0) : 0;
    const dwellSatisfied = bandTicksSoFar >= options.minBandTicks;
    let phase;
    if (crisisScore >= options.drainEnterScore) {
        phase = "crisis";
    }
    else if (inCrisisBand && crisisScore >= options.drainExitScore) {
        phase = "crisis";
    }
    else if (inCrisisBand && (crisisScore > options.recoveryClearScore || !dwellSatisfied)) {
        // 分数已清但驻留未满 → 停在 recovery 攒缓冲，防止秒退回 normal 后
        // 支出立刻恢复、赤字重新累积的极限环；同时兜住 recoveryStep 过大
        // 导致分数从迟滞带直接跳 0、crisis 直切 normal 的路径。
        phase = "recovery";
    }
    else if (input.rcl >= 8 && !understaffed) {
        phase = "steady";
    }
    else if (understaffed) {
        phase = "bootstrap";
    }
    else {
        phase = "growth";
    }
    const stillInBand = phase === "crisis" || phase === "recovery";
    const bandTicks = stillInBand ? bandTicksSoFar + 1 : 0;
    return { phase, prevReserve: input.reserve, drainScore, liquidityScore, bandTicks, reserveDelta };
}
/**
 * 将殖民相位映射为 ColonyState（plan §5.4 统一状态）。
 *
 * 映射规则：
 *   defense       ← 有敌对单位（优先级最高）
 *   bootstrap     ← phase bootstrap（采集者不足）
 *   recovery      ← phase crisis 或 recovery（经济赤字或恢复中）
 *   normal        ← phase growth 或 steady（健康运行）
 *
 * 纯函数 — 不访问 Game/Memory，接收显式参数。
 */
function phaseToColonyState(phase, hasHostiles) {
    if (hasHostiles)
        return "defense";
    if (phase === "bootstrap")
        return "bootstrap";
    if (phase === "crisis" || phase === "recovery")
        return "recovery";
    return "normal";
}

/**
 * 房间状态系统 — P0，每 tick 运行，在所有其他系统之前。
 *
 * 职责（plan §5.4 统一状态）：
 *   - 为每个自有房间计算殖民相位（evaluateColonyPhase）
 *   - 映射为 ColonyState 并写入 RoomMemory.colonyState
 *   - 检测控制器降级风险并写入 RoomMemory.controllerDowngradeRisk
 *
 * 这是所有经济/发展决策的「一处真相」：
 *   - spawn-manager 读 RoomMemory.colonyState 决定孵化优先级
 *   - assignment-service 读 RoomMemory.colonyState 决定任务生成
 *   - construction-manager 读 RoomMemory.colonyState 决定建造门禁
 *   - kernel.runCreeps 读 RoomMemory.colonyState 决定角色执行门禁
 *
 * 替代了：
 *   - kernel.computeColonyState（全局状态 → 每房状态）
 *   - economy/crisis.ts（source 满度启发式 → 储备趋势）
 *   - room-observer 中的危机/相位计算（P3/interval 5 → P0/每 tick）
 */
const roomStateSystem = {
    name: "room-state",
    priority: 0,
    interval: 1,
    run(ctx) {
        for (const snapshot of ctx.snapshots()) {
            const roomMem = Memory.rooms[snapshot.roomName];
            if (!roomMem)
                continue;
            // 1. 计算总储备 = energyAvailable + containers + storage + terminal + 在途 creep 携带能量。
            // 计入 creep 身上能量（P1-5 ①）：hauler 取/送不再改变 reserve，避免物流搬运制造假危机信号。
            let reserve = snapshot.energyAvailable;
            for (const c of snapshot.containers) {
                reserve += c.store.getUsedCapacity(RESOURCE_ENERGY);
            }
            if (snapshot.storage) {
                reserve += snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
            }
            reserve += snapshot.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
            reserve += snapshot.creepEnergy ?? 0;
            // 2. 统计有效采集者（已分配 source 的 harvester/worker）。
            // 复用 Kernel 预构建的 sourceOccupancy 求和，避免遍历全部 Game.creeps。
            // P0-1：加入 pendingHarvesters（已存活但未分配 sourceId 的 + 孵化中的），
            // 避免替换期间的假 bootstrap 导致 P2 角色被冻结。
            let harvesterCount = 0;
            for (const count of snapshot.sourceOccupancy.values()) {
                harvesterCount += count;
            }
            harvesterCount += snapshot.pendingHarvesters ?? 0;
            // 2.5 流动性信号（方案 C）—— 检测「富得流油却花不出去」的物流死锁。
            // spendableRatio：spawn 口袋的可达能量占容量比。低 = spawn 实际破产。
            const spendableRatio = snapshot.energyCapacityAvailable > 0
                ? snapshot.energyAvailable / snapshot.energyCapacityAvailable
                : 0;
            // frozenRatio：最满 container 的填充率。高 = 能量积压在 container 搬不走。
            // 两者同时极端（spawn 空 + container 满）= 搬运能力缺失 = 真死锁，而非正常物流中转。
            let frozenRatio = 0;
            for (const c of snapshot.containers) {
                const cap = c.store.getCapacity(RESOURCE_ENERGY);
                if (cap > 0) {
                    const fill = c.store.getUsedCapacity(RESOURCE_ENERGY) / cap;
                    if (fill > frozenRatio)
                        frozenRatio = fill;
                }
            }
            // 3. 评估殖民相位（带迟滞的纯函数）。
            const prevPhase = {
                phase: roomMem.phase?.phase ?? "growth",
                prevReserve: roomMem.phase?.reserve,
                drainScore: roomMem.phase?.drainScore ?? 0,
                liquidityScore: roomMem.phase?.liquidityScore ?? 0,
                bandTicks: roomMem.phase?.bandTicks ?? 0,
            };
            const phaseResult = evaluateColonyPhase({
                reserve,
                spendable: snapshot.energyAvailable,
                spendableRatio,
                frozenRatio,
                harvesterCount,
                sourceCount: snapshot.sources.length,
                rcl: snapshot.rcl,
            }, prevPhase);
            // 4. 持久化相位状态（供下一 tick 迟滞计算）。
            roomMem.phase = {
                phase: phaseResult.phase,
                reserve,
                reserveDelta: phaseResult.reserveDelta,
                drainScore: phaseResult.drainScore,
                liquidityScore: phaseResult.liquidityScore,
                bandTicks: phaseResult.bandTicks,
                harvesterCount,
                sourceCount: snapshot.sources.length,
                rcl: snapshot.rcl,
            };
            // 5. 映射为 ColonyState 并写入 RoomMemory。
            const hasHostiles = snapshot.threatCreeps.length > 0;
            roomMem.colonyState = phaseToColonyState(phaseResult.phase, hasHostiles);
            // 受袭记忆：威胁出现即刷新时间戳 — 供防御姿态判断（动态墙体目标等）。
            if (hasHostiles) {
                roomMem.lastHostileAt = ctx.tick;
            }
            // 5.5 经济压力梯度信号 (0.0–1.0)。
            // 取双维度最大值（方案 C）：偿付危机（drainScore）与流动性危机（liquidityScore）
            // 任一升高都推高压力，使建造门禁 / P2 缩放对「富得流油却花不出去」也做出反应。
            // score 0→midpoint 映射 pressure 0.0→0.5（健康→谨慎）
            // score midpoint→midpoint+range 映射 pressure 0.5→1.0（紧张→危机）
            const { midpoint, range } = CONFIG.economy.economyPressure;
            const score = Math.max(phaseResult.drainScore, phaseResult.liquidityScore);
            roomMem.economyPressure = score <= midpoint
                ? (score / midpoint) * 0.5
                : 0.5 + ((score - midpoint) / range) * 0.5;
            // 6. Storage 满仓检测 — 超过阈值时标记，供 demand 限采 + 加速消费。
            // 满仓 = 能量在源头被浪费（harvester drop），必须加速升级/建造消化盈余。
            if (snapshot.storage) {
                const storageEnergy = snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
                const storageCapacity = snapshot.storage.store.getCapacity(RESOURCE_ENERGY);
                roomMem.storageNearFull = storageCapacity > 0
                    && storageEnergy / storageCapacity >= CONFIG.economy.storageFullThreshold;
            }
            else {
                roomMem.storageNearFull = false;
            }
            // 6. 检测控制器降级风险（非对称迟滞带）。
            // 进入阈值 = controllerDowngradeThreshold (10000)：低于此值进入风险。
            // 退出阈值 = controllerDowngradeExitThreshold (15000)：高于此值才退出风险。
            // 利用 roomMem.controllerDowngradeRisk 旧值作为状态记忆，无需额外字段。
            const controller = snapshot.controller;
            if (controller != null && controller.my) {
                const ttd = controller.ticksToDowngrade;
                if (roomMem.controllerDowngradeRisk) {
                    // 当前已在风险状态：需回升到退出阈值以上才解除
                    roomMem.controllerDowngradeRisk = ttd < CONFIG.economy.controllerDowngradeExitThreshold;
                }
                else {
                    // 当前不在风险状态：低于进入阈值才触发
                    roomMem.controllerDowngradeRisk = ttd < CONFIG.economy.controllerDowngradeThreshold;
                }
            }
            else {
                roomMem.controllerDowngradeRisk = false;
            }
        }
    },
};

/**
 * Tuning Bounds — 每个可调参数的安全边界、步长和冷却时间。
 *
 * 设计原则：
 *   - 硬边界（floor/ceiling）是绝对安全限制，覆盖值永远不能超出。
 *   - 步长（step）控制单次调整幅度——保守起见统一为 1。
 *   - 冷却（cooldownTicks）防止同一参数频繁调整导致振荡。
 *   - 信号阈值定义在各自的评估函数中，这里只管参数的数值边界。
 *
 * 纯数据模块 — 不依赖 Game/Memory，可独立测试。
 */
/**
 * 所有可调参数的安全约束目录。
 *
 * 边界设定依据 [Experience]：
 *   hauler.maxCount:  2–8  — 低于 2 无法维持基本物流；高于 8 在单房下 CPU 和 spawn 窗口不可承受。
 *   hauler.minCount:  1–4  — 低于 1 物流断链；高于 4 浪费孵化能量。
 *   harvester.maxCount: 2–6 — 低于 2 单点故障；高于 6 拥堵 source。
 *   upgrader.maxCount: 1–4  — 低于 1 无法保级；高于 4 在 20CPU 下不可承受。
 *   builder.maxCount:  1–6  — 低于 1 无法建造；高于 6 抢占经济能量。
 *
 * 冷却时间 1000 tick（= 2 次评估间隔）：
 *   tuning-engine 每 500 tick 运行一次，1000 tick 冷却确保至少跳过一次评估，
 *   让上次调整的效果有时间在遥测数据中体现。
 */
const TUNING_BOUNDS = {
    "hauler.maxCount": {
        param: "hauler.maxCount",
        floor: 2,
        ceiling: 8,
        step: 1,
        cooldownTicks: 1000,
    },
    "hauler.minCount": {
        param: "hauler.minCount",
        floor: 1,
        ceiling: 4,
        step: 1,
        cooldownTicks: 1000,
    },
    "harvester.maxCount": {
        param: "harvester.maxCount",
        floor: 2,
        ceiling: 6,
        step: 1,
        cooldownTicks: 1000,
    },
    "upgrader.maxCount": {
        param: "upgrader.maxCount",
        floor: 1,
        ceiling: 4,
        step: 1,
        cooldownTicks: 1000,
    },
    "builder.maxCount": {
        param: "builder.maxCount",
        floor: 1,
        ceiling: 6,
        step: 1,
        cooldownTicks: 1000,
    },
};
/** 将值钳制在参数的安全边界内。 */
function clampParam(param, value) {
    const bounds = TUNING_BOUNDS[param];
    if (!bounds)
        return value;
    return Math.max(bounds.floor, Math.min(bounds.ceiling, value));
}
/** 检查参数是否仍在冷却期内。 */
function isInCooldown(param, lastAdjustedTick, currentTick) {
    if (lastAdjustedTick === undefined)
        return false;
    const bounds = TUNING_BOUNDS[param];
    if (!bounds)
        return false;
    return currentTick - lastAdjustedTick < bounds.cooldownTicks;
}

/**
 * Tuned Config — 运行时参数覆盖层。
 *
 * 设计意图：不修改静态 CONFIG，而是在其之上叠加由 tuning-engine
 * 产生的运行时覆盖值。消费者通过 getRoleBounds() 查询，
 * 先查 Memory.kernel.tuning 中的覆盖值，回退到 CONFIG 默认值。
 *
 * 数据流：
 *   CONFIG (静态基线) ← getRoleBounds() ← demand.ts / spawn-manager.ts
 *                          ↑
 *   Memory.kernel.tuning.rooms[roomName].roleBounds (运行时覆盖)
 *                          ↑
 *   tuning-engine (每 500 tick 更新)
 *
 * 安全保证：
 *   - 覆盖值永远在 TUNING_BOUNDS 的 floor/ceiling 范围内。
 *   - 无 Memory / global reset 后自动回退到 CONFIG 默认值。
 *   - 消费者不需要感知调优系统的存在——只是换个函数读参数。
 */
/** 角色 → 参数路径映射，用于 clampParam 安全钳制。 */
const ROLE_PARAM_MAP = {
    hauler: { min: "hauler.minCount", max: "hauler.maxCount" },
    harvester: { min: "harvester.minCount", max: "harvester.maxCount" },
    upgrader: { min: "upgrader.minCount", max: "upgrader.maxCount" },
    builder: { min: "builder.minCount", max: "builder.maxCount" },
    remoteHarvester: { min: "remoteHarvester.minCount", max: "remoteHarvester.maxCount" },
    remoteHauler: { min: "remoteHauler.minCount", max: "remoteHauler.maxCount" },
    reserver: { min: "reserver.minCount", max: "reserver.maxCount" },
};
/**
 * 获取角色的有效数量边界（CONFIG 默认 + 运行时覆盖）。
 *
 * @param role     角色名（如 "hauler"）
 * @param roomName 房间名（可选，用于查 per-room 覆盖）
 * @returns { minCount, maxCount } 合并后的有效值
 */
function getRoleBounds(role, roomName) {
    const configBounds = CONFIG.roles[role];
    if (!configBounds) {
        return { minCount: 0, maxCount: 0 };
    }
    let minCount = configBounds.minCount;
    let maxCount = configBounds.maxCount;
    // 查询运行时覆盖值
    if (roomName) {
        const roomTuning = Memory.kernel?.tuning?.rooms?.[roomName]?.roleBounds?.[role];
        if (roomTuning) {
            if (roomTuning.minCount !== undefined)
                minCount = roomTuning.minCount;
            if (roomTuning.maxCount !== undefined)
                maxCount = roomTuning.maxCount;
        }
    }
    // 安全钳制：确保覆盖值不超出硬边界
    const paramMap = ROLE_PARAM_MAP[role];
    if (paramMap) {
        minCount = clampParam(paramMap.min, minCount);
        maxCount = clampParam(paramMap.max, maxCount);
    }
    // 不变性：minCount <= maxCount
    if (minCount > maxCount) {
        minCount = maxCount;
    }
    return { minCount, maxCount };
}
/**
 * 获取所有角色的有效边界（用于 demand.ts 的批量查询）。
 */
function getAllRoleBounds(roomName) {
    const result = {};
    for (const role of Object.keys(CONFIG.roles)) {
        result[role] = getRoleBounds(role, roomName);
    }
    return result;
}

/** 各角色降级时必需保留的最小部件组合。hauler/distributor 无需 WORK。 */
const ROLE_REQUIRED_PARTS = {
    hauler: ["carry", "move"],
    distributor: ["carry", "move"],
    remoteHarvester: ["work", "carry", "move"],
    remoteHauler: ["carry", "move"],
    reserver: ["claim", "move"],
    claimer: ["claim", "move"],
    remoteDefender: ["attack", "move"],
    defender: ["attack", "move"],
};
/**
 * 统计指定房间内所有角色的存活 creep 数（含孵化中）。
 *
 * 纯函数 — 接收预收集的 creep 和 spawning 摘要列表，不访问 Game/Memory。
 */
function countCreepsByRole(creeps, spawning, roomName) {
    const counts = {};
    for (const creep of creeps) {
        if (creep.home !== roomName)
            continue;
        const role = creep.role ?? "unknown";
        counts[role] = (counts[role] ?? 0) + 1;
    }
    for (const s of spawning) {
        if (s.home !== roomName)
            continue;
        const role = s.role ?? "unknown";
        counts[role] = (counts[role] ?? 0) + 1;
    }
    return counts;
}
/**
 * 判断 creep 是否即将需要替换。
 * 阈值 = body.length * 3（孵化耗时）+ buffer（安全余量）+ travelTicks（通勤路程）。
 * 纯函数 — 接收显式参数，不访问 Creep 对象。
 */
function needsReplacement(ticksToLive, bodyLength, travelTicks = 0) {
    if (ticksToLive === undefined)
        return false;
    const threshold = bodyLength * 3 + CONFIG.spawn.replaceBuffer + travelTicks;
    return ticksToLive <= threshold;
}
/**
 * 估算 harvester 从 spawn 到其 source 的通勤 tick 数（Chebyshev 距离 × 1.5 地形系数，上限 50）。
 * 用于提前替补的替换阈值，防止「替补走完路程前矿工已死」的采集断档。
 */
function estimateTravelTicks(snapshot, sourceId) {
    if (!sourceId)
        return 0;
    const spawn = snapshot.spawns[0];
    if (!spawn)
        return 0;
    const source = snapshot.sources.find(s => s.id === sourceId);
    if (!source)
        return 0;
    const range = spawn.pos.getRangeTo(source.pos);
    return Math.min(50, Math.ceil(range * 1.5));
}
// ─── Body 感知配额（数量 × body 大小 = 能力，配额按能力而非头数计）───
/**
 * 估算「本 tick 若孵化该角色，实际会得到的 body」。
 * 与 createRequest 的降级路径同口径：bootstrap/recovery 按 energyAvailable 降级
 * （速出保命的小 body），normal 按 energyCapacity 满配。
 * 口径不一致的后果：危机时按满配 body 折算数量 → 头数偏少 + 实际孵出小 body
 * → 能力双重缺口。
 */
function estimatePlannedBody(role, energyCapacity, energyAvailable, colonyState, rcl) {
    const fullBody = selectBody(role, energyCapacity, { rcl });
    if (colonyState === "bootstrap" || colonyState === "recovery") {
        return (degradeBody(fullBody, energyAvailable, ROLE_REQUIRED_PARTS[role]) ??
            selectBody(role, energyAvailable, { rcl }));
    }
    return fullBody;
}
/** 统计 body 中指定部件的数量（至少 1，防除零）。 */
function countBodyParts(body, part) {
    return Math.max(1, body.filter(p => p === part).length);
}
/**
 * 评估房间孵化需求。
 *
 * 纯函数 — 接收预收集的所有数据（快照、队列、creep 摘要、房间上下文），
 * 返回待提交的 SpawnRequest 列表。不访问 Game/Memory。
 *
 * 优先级顺序：
 *   P0 — 无 harvester 时的恢复 worker
 *   P1 — harvester 至 minCount，带 source 分配（基于实际占用）
 *   P1 — hauler 至 minCount
 *   P2 — upgrader 至 minCount
 *   P2 — builder 至 minCount（仅当存在建造 site 时）
 */
function evaluateDemand(snapshot, queue, colonyState, creeps, spawning, roomCtx, tick) {
    const requests = [];
    const home = snapshot.roomName;
    const energyCapacity = snapshot.energyCapacityAvailable;
    // 统一经济状态：recovery 涵盖 crisis + recovery 相位，收缩非关键消耗。
    const inCrisis = colonyState === "recovery";
    // Storage 满仓信号 — 限采 + 加速消费。
    const storageNearFull = roomCtx.storageNearFull === true;
    // 单次遍历获取所有角色计数。
    // pending 计数带 home 过滤 — sponsor 房代孵的拓荒请求（home 指向新房）
    // 寄宿在本房队列，不得计入本房人口预算。
    const counts = countCreepsByRole(creeps, spawning, home);
    const pending = {
        harvester: countPending(queue, "harvester", home),
        worker: countPending(queue, "worker", home),
        hauler: countPending(queue, "hauler", home),
        distributor: countPending(queue, "distributor", home),
        upgrader: countPending(queue, "upgrader", home),
        builder: countPending(queue, "builder", home),
    };
    // P0：恢复 worker — 当没有存活 harvester/worker 时。
    // 仅看存活数（counts），不看 pending — pending 中的 stale 请求可能永远无法孵化
    // （如能量不足降级失败），若计入会导致 harvesterCount > 0 → P0 worker 不创建 → 死锁。
    const livingHarvesters = (counts.harvester ?? 0) + (counts.worker ?? 0);
    if (livingHarvesters === 0) {
        const key = spawnKey("worker", home, 0);
        requests.push(createRequest("worker", home, 0, key, 0, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
        return { requests }; // P0 阻塞其他所有请求
    }
    // P1：Defender — 房内出现威胁时的防御响应（防御优先于经济扩员）。
    // 塔负责远程集火，defender 贴脸补刀；无塔窗口期（RCL1-2 / 塔被打空）
    // defender 是唯一主动防线。数量按威胁数缩放、受 maxCount 封顶；
    // 威胁清除后不再补充，存量 defender 自然到期（minCount=0，替换门禁不触发）。
    if (snapshot.threatCreeps.length > 0) {
        const defenderConfig = getRoleBounds("defender", home);
        const defenderPending = countPending(queue, "defender", home);
        const defenderTotal = (counts.defender ?? 0) + defenderPending;
        const defenderTarget = Math.min(snapshot.threatCreeps.length, defenderConfig.maxCount);
        for (let i = defenderTotal; i < defenderTarget; i++) {
            const key = spawnKey("defender", home, i);
            if (!hasKey(queue, key)) {
                requests.push(createRequest("defender", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
            }
        }
    }
    // P1：Harvester — 基于实际占用分配到最少拥挤的 source。
    // 使用本地占用副本，确保同一轮多次孵化时后续迭代能看到前面的分配。
    const harvesterConfig = getRoleBounds("harvester", home);
    const harvesterLiving = counts.harvester ?? 0;
    const harvesterTotal = harvesterLiving + pending.harvester;
    // P0-1: Storage 满仓时限采 — 有效目标降为 source 数（每 source 1 个矿工保底），
    // 不再补到 minCount。满仓时 harvester 产出被 drop 浪费，省下孵化能量给 upgrader/builder 消化库存。
    //
    // Body 感知饱和封顶：source 再生 10/tick，harvestWorkingParts(5) 个 WORK 即采空。
    // 每 source 所需矿工数 = ceil(5 / 单体 WORK 数)，受 maxMinersPerSource 站位上限约束。
    // 5W 时代（600 容量+）每 source 1 个矿工即饱和 — 超出饱和线的头数无产出可采，
    // 纯属浪费孵化能量与 CPU（tuned minCount 是头数思维，body 长大后不会自动缩）。
    const harvesterBody = estimatePlannedBody("harvester", energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl);
    const workPerHarvester = countBodyParts(harvesterBody, "work");
    const minersPerSource = Math.min(CONFIG.assignment.maxMinersPerSource, Math.ceil(CONFIG.economy.harvestWorkingParts / workPerHarvester));
    const saturationTarget = snapshot.sources.length * minersPerSource;
    const harvesterTarget = storageNearFull
        ? Math.min(snapshot.sources.length, harvesterConfig.minCount)
        : Math.min(harvesterConfig.minCount, saturationTarget);
    if (harvesterTotal < harvesterTarget) {
        // 本地占用映射：从快照复制，循环内累加，避免同轮重复分配同一 source。
        const localOccupancy = new Map([...snapshot.sourceOccupancy.entries()].map(([k, v]) => [k, v]));
        for (let i = harvesterTotal; i < harvesterTarget; i++) {
            // 找到占用最少的 source。
            let bestSource;
            let bestCount = Infinity;
            for (const source of snapshot.sources) {
                const count = localOccupancy.get(source.id) ?? 0;
                if (count < bestCount) {
                    bestCount = count;
                    bestSource = source;
                }
            }
            const sourceId = bestSource?.id;
            // 累加本地占用，确保下一个 harvester 分配到不同 source。
            if (sourceId) {
                localOccupancy.set(sourceId, (localOccupancy.get(sourceId) ?? 0) + 1);
            }
            const key = spawnKey("harvester", home, i, sourceId);
            if (!hasKey(queue, key)) {
                // 危机时 harvester 提为 P0：经济引擎优先于一切，尽快恢复采集。
                requests.push(createRequest("harvester", home, 1, key, inCrisis ? 0 : 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick, sourceId));
            }
        }
    }
    // P1：Hauler — 仅在有 container 或 storage 时才创建（hauler 无 WORK，不能自采）。
    // 能量驱动配额：根据 container 实际积压量决定 hauler 数量，而非固定乘数。
    // 逻辑：container 能量 > 80% 容量 → 需要 2 个 hauler（严重积压，搬运能力不足）
    //       container 能量 > 40% 容量 → 需要 1 个 hauler（正常物流压力）
    //       container 能量 < 40% → 不需要额外 hauler（搬运能力过剩，不孵）
    // 这确保 hauler 数量跟随实际物流压力动态调整，不会在 container 空时白孵。
    //
    // RCL5+ Link-aware 物流：
    //   当 source link 在线时，harvester 优先倒能到 link（而非 container），
    //   source container 几乎不填 → container 贡献自然降为 0（反馈 loop 正常工作）。
    //   但 link 网络把能量瞬移到 storage link，需要 hauler 排空（withdrawStorageLink）。
    //   这是 RCL5+ 的新物流任务，必须纳入需求信号，否则 storage link 积压无人搬。
    //   同时，storage link 排空后需求降到 0 → minCount 地板兜底 → tuning-engine
    //   观测到 container/link 持续空置（containerFillRatio 代理信号，无 container 时按 0 计）
    //   → 降低 minCount → hauler 数量自然减少。
    //   这就是「RCL5 后 link 参与物流，hauler 数量慢慢减少」的机制。
    const haulerConfig = getRoleBounds("hauler", home);
    const haulerTotal = (counts.hauler ?? 0) + pending.hauler;
    const hasLogistics = snapshot.containers.length > 0 || snapshot.storage !== undefined;
    let dynamicHaulerTarget = 0;
    if (hasLogistics) {
        // 1. Source container 积压信号（RCL1-4 主物流路径）。
        for (const c of snapshot.containers) {
            const capacity = c.store.getCapacity(RESOURCE_ENERGY) || 1;
            const fillRatio = c.store.getUsedCapacity(RESOURCE_ENERGY) / capacity;
            if (fillRatio > 0.8)
                dynamicHaulerTarget += 2;
            else if (fillRatio > 0.4)
                dynamicHaulerTarget += 1;
        }
        // 2. Storage link 积压信号（RCL5+ link 网络的「最后一公里」）。
        //    link-system 将 source link 能量瞬移到 storage link，hauler 需排空到 storage。
        //    无 storage 时不存在 storage link（classifyLink 回退为 hub）。
        if (snapshot.storage) {
            const storageLink = snapshot.links.find(l => l.pos.getRangeTo(snapshot.storage) <= 2);
            if (storageLink) {
                const linkCap = storageLink.store.getCapacity(RESOURCE_ENERGY) || 1;
                const linkFillRatio = storageLink.store.getUsedCapacity(RESOURCE_ENERGY) / linkCap;
                if (linkFillRatio > 0.8)
                    dynamicHaulerTarget += 2;
                else if (linkFillRatio > 0.4)
                    dynamicHaulerTarget += 1;
            }
        }
        // 运力归一化：积压档位（+1/+2）按基准运力（referenceCarryCapacity = 6 CARRY）标定。
        // body 随容量长大（RCL4 道路档 16C = 800 运力）后，同样积压需要的头数按比例折减；
        // 早期小 body（2C = 100 运力）则按比例扩编。头数 × 单体运力 ≈ 恒定总运力，
        // 消除「配额公式不随 body 变化」的浪费（大 body 时代多孵的每一头都是纯闲置）。
        if (dynamicHaulerTarget > 0) {
            const haulerBody = estimatePlannedBody("hauler", energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl);
            const carryPerHauler = countBodyParts(haulerBody, "carry") * 50;
            dynamicHaulerTarget = Math.ceil((dynamicHaulerTarget * CONFIG.economy.referenceCarryCapacity) / carryPerHauler);
        }
        // 至少 minCount（保证基本物流不断），至多 maxCount。
        dynamicHaulerTarget = Math.min(haulerConfig.maxCount, Math.max(haulerConfig.minCount, dynamicHaulerTarget));
        // TD-015：economyPressure 梯度衰减 — pressure > 0.6 时线性降低 hauler 配额，
        // 让物流端平滑感知经济压力（而非仅靠 inCrisis 二值开关突然砍）。
        // pressure=0.6 无衰减，pressure=1.0 缩至 minCount。
        const haulerPressure = roomCtx.economyPressure;
        if (haulerPressure > 0.6) {
            dynamicHaulerTarget = Math.max(haulerConfig.minCount, Math.round(dynamicHaulerTarget * (1 - (haulerPressure - 0.6) / 0.4)));
        }
    }
    // 能量危机收缩（仅偿付危机适用）：收缩 hauler 到 minCount —— 仅保留把能量搬回 spawn
    // 供孵化 harvester 的最小力量，避免孵出一堆无能量可搬的空闲 hauler，白白浪费孵化能量。
    // 方案 C：流动性危机例外 —— 能量冻在 container（liquidityScore 主导）时 hauler 是解药，
    // 必须按 dynamicTarget 满量孵化才能搬空积压、打破「spawn 破产」死锁。
    // 此时收缩 hauler 会让死锁永久化（W37S58 根因之一）。
    const liquidityScore = roomCtx.liquidityScore ?? 0;
    const drainScore = roomCtx.drainScore ?? 0;
    const liquidityDriven = liquidityScore >= 40 && liquidityScore >= drainScore;
    const haulerTarget = (inCrisis && !liquidityDriven)
        ? Math.min(dynamicHaulerTarget, haulerConfig.minCount)
        : dynamicHaulerTarget;
    if (haulerTotal < haulerTarget && hasLogistics) {
        for (let i = haulerTotal; i < haulerTarget; i++) {
            const key = spawnKey("hauler", home, i);
            if (!hasKey(queue, key)) {
                requests.push(createRequest("hauler", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
            }
        }
    }
    // P1：Distributor — 仅在有 storage 时才创建（RCL4+）。
    // 职责：从 storage 取能分发给 spawn/extension/tower/lab。
    // 与 hauler 的职责分离：hauler 是收集者（源→storage），distributor 是分发者（storage→sink）。
    // 无 storage 时不存在 distributor 的需求 — hauler 直接 container→sink 直送。
    // 数量：基于 fillTarget 需求量。spawn/extension/tower 未满时需要 distributor。
    const distConfig = getRoleBounds("distributor", home);
    const distTotal = (counts.distributor ?? 0) + pending.distributor;
    const hasStorage = snapshot.storage !== undefined;
    let distTarget = 0;
    if (hasStorage) {
        // fillTarget 数量决定需求，按单体运力折算头数：每 150 运力承接 1 个 fillTarget
        // （基准 body 6C=300 运力 → 2 个/头，与原「每 2 个 fillTarget 配 1 个」口径一致；
        // RCL4 道路档 16C=800 运力 → 5 个/头，大 body 时代自动减员）。
        // fillTargets 含 spawn/extension/tower 等未满 sink。
        const fillCount = snapshot.fillTargets.length;
        const distBody = estimatePlannedBody("distributor", energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl);
        const fillPerDistributor = Math.max(2, Math.floor((countBodyParts(distBody, "carry") * 50) / 150));
        distTarget = Math.min(distConfig.maxCount, Math.max(distConfig.minCount, Math.ceil(fillCount / fillPerDistributor)));
        // TD-015：economyPressure 梯度衰减 — 与 hauler 同公式，pressure > 0.6 时线性降低 distributor 配额。
        const distPressure = roomCtx.economyPressure;
        if (distPressure > 0.6) {
            distTarget = Math.max(distConfig.minCount, Math.round(distTarget * (1 - (distPressure - 0.6) / 0.4)));
        }
        // 危机时收缩到 minCount。
        if (inCrisis)
            distTarget = Math.min(distTarget, distConfig.minCount);
        // 升编趋势确认：spawn 孵化瞬间抽干 spawn/extension → fillTargets 尖峰，
        // 这是 distributor 的日常工作信号而非缺员信号（在途编制一两趟即可补满）。
        // 扩编（超出现有编制且超出 minCount 地板）必须等需求持续
        // distributorScaleUpDelay tick 才放行；补足 minCount 与缩编即时生效。
        // 不确认的后果：一次 50 tick 的尖峰入队的请求活在队列里直至孵化，
        // 换来多个活 1500 tick 的常驻编制（与 builderPressureState 同为 Memory 短 key 迟滞先例）。
        const distMem = Memory.rooms[home];
        if (distTarget > distTotal && distTarget > distConfig.minCount) {
            const since = distMem?.distScaleUpSince;
            if (since === undefined) {
                // 需求首现 — 记录起点，本轮压回地板（现有编制或 minCount 的较大者）。
                if (distMem)
                    distMem.distScaleUpSince = tick;
                distTarget = Math.min(distTarget, Math.max(distTotal, distConfig.minCount));
            }
            else if (tick - since < CONFIG.spawn.distributorScaleUpDelay) {
                // 确认窗口未满 — 继续压回地板。
                distTarget = Math.min(distTarget, Math.max(distTotal, distConfig.minCount));
            }
            // 窗口已满 → 需求真实持续，放行扩编（distTarget 保持折算值）。
        }
        else if (distMem?.distScaleUpSince !== undefined) {
            // 需求回落或编制已满足 — 尖峰未获确认，重置计时器。
            distMem.distScaleUpSince = undefined;
        }
    }
    if (distTotal < distTarget && hasStorage) {
        for (let i = distTotal; i < distTarget; i++) {
            const key = spawnKey("distributor", home, i);
            if (!hasKey(queue, key)) {
                requests.push(createRequest("distributor", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
            }
        }
    }
    // P2：Upgrader — 仅在 normal 状态下，不在 bootstrap/recovery。
    // 当控制器存在降级风险时，即使在 recovery/bootstrap 也允许生成 upgrader（P1 优先级）。
    const hasDowngradeRisk = roomCtx.controllerDowngradeRisk;
    const allowUpgrader = colonyState === "normal" || hasDowngradeRisk;
    if (allowUpgrader) {
        const upgraderConfig = getRoleBounds("upgrader", home);
        const upgraderTotal = (counts.upgrader ?? 0) + pending.upgrader;
        // A2：升级功率改由「storage 水位 + 大 body WORK 数」驱动，替代固定小 body 数量梯度。
        // 老玩家认知：防御与 spawn 供能之外，盈余能量应优先灌 controller —— RCL 是复利。
        // 大 body 站桩（15W@1650）让 1 个 upgrader 即可跑满 ≈15/tick，creep 数更少、CPU 更省。
        const stationUpgradeOnline = snapshot.controllerContainer !== undefined;
        const ctrl = snapshot.controller;
        const crisisNeedsGuard = inCrisis && ctrl !== undefined && ctrl.ticksToDowngrade < CONFIG.economy.crisis.downgradeGuard;
        const pressure = roomCtx.economyPressure;
        const upgradeCfg = CONFIG.economy.upgrade;
        const workPerBody = selectBody("upgrader", energyCapacity, { rcl: snapshot.rcl }).filter(p => p === "work").length || 1;
        const hasStorage = snapshot.storage !== undefined;
        const storageEnergy = hasStorage ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
        let upgraderTarget;
        if (hasDowngradeRisk || crisisNeedsGuard) {
            // 保级紧急：拉满（自采也要保级）。
            upgraderTarget = upgraderConfig.maxCount;
        }
        else if (!stationUpgradeOnline) {
            // 无 controller container：多 upgrader 长途自采，通勤浪费抵消数量优势，保持 minCount。
            upgraderTarget = pressure <= 0.7 ? upgraderConfig.minCount : 0;
        }
        else if (hasStorage && storageEnergy >= upgradeCfg.sprintStorage && pressure <= 0.3) {
            // 冲刺：库存充足且经济健康，烧库存换 RCL 复利（2 个满 body 站桩）。
            // P0-1: Storage 满仓时拉满 maxCount — 盈余能量必须被消化，否则在源头被浪费。
            upgraderTarget = storageNearFull
                ? upgraderConfig.maxCount
                : Math.min(upgraderConfig.maxCount, 2);
        }
        else if (hasStorage && storageEnergy >= upgradeCfg.sustainedStorage) {
            // 维持：1 个大 body 站桩 ≈ 15/tick，盈余全喂 controller。
            upgraderTarget = 1;
        }
        else if (!hasStorage) {
            // RCL1-3 早期猛冲（无 storage，能量不升级也是浪费）：沿用 pressure 梯度。
            // pressure 0.0–0.3 满目标；0.3–0.7 线性缩到 minCount；0.7–1.0 缩到 0。
            const fullTarget = stationUpgradeOnline ? upgraderConfig.maxCount : upgraderConfig.minCount;
            if (pressure <= 0.3) {
                upgraderTarget = fullTarget;
            }
            else if (pressure <= 0.7) {
                const t = (pressure - 0.3) / 0.4;
                upgraderTarget = Math.round(fullTarget + t * (upgraderConfig.minCount - fullTarget));
            }
            else {
                const t = (pressure - 0.7) / 0.3;
                upgraderTarget = Math.round(upgraderConfig.minCount * (1 - t));
            }
        }
        else {
            // storage 低水位（< sustained）：最多 1 个大 body，pressure 高则停升级攒库存。
            upgraderTarget = pressure <= 0.5 ? 1 : 0;
        }
        // RCL8 官方限速：controller 每 tick 最多吃 15 能量升级。
        // 按当前 body 的 WORK 数折算 creep 数上限（15W body → 1 个，恰好顶满）。
        if (snapshot.rcl >= 8) {
            const maxCountByWork = Math.max(1, Math.floor(upgradeCfg.rcl8MaxWorkParts / workPerBody));
            upgraderTarget = Math.min(upgraderTarget, maxCountByWork);
        }
        // 保级覆盖：控制器快降级时至少保留 minCount。
        if (crisisNeedsGuard || hasDowngradeRisk) {
            upgraderTarget = Math.max(upgraderTarget, upgraderConfig.minCount);
        }
        if (upgraderTotal < upgraderTarget) {
            // 降级风险时提升为 P1 优先级，确保快速保级。
            const upgraderPriority = hasDowngradeRisk ? 1 : 2;
            for (let i = upgraderTotal; i < upgraderTarget; i++) {
                const key = spawnKey("upgrader", home, i);
                if (!hasKey(queue, key)) {
                    requests.push(createRequest("upgrader", home, i, key, upgraderPriority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
                }
            }
        }
    }
    // P2：Builder — 独立于 upgrader 门禁。
    // 灾后重建（recovery）时 builder 是生存角色，不是发展角色——必须允许 spawn。
    // bootstrap 时不孵 builder（新手房优先建立能量链）。
    // 动态数量：每个活跃 site 配 1 个 builder，但上限受经济承载力约束。
    //
    // 道路维修需求信号：成熟房布局建成后 site 归零 → builder 消亡，
    // 但道路持续衰减且塔不修路（只修 critical 与 wall/rampart）——
    // 无此信号时道路只能塌毁重建（重建耗能约为维修 6 倍 + 塌毁窗口期物流减速）。
    // 待修道路达到门槛时，即使无 site 也维持 1 个 builder 巡修
    //（builder work 链自带 repairRoads，无需新增行为）。
    const roadsNeedingRepair = snapshot.roads.filter(r => r.hits < r.hitsMax * CONFIG.construction.roadRepairThreshold).length;
    const roadRepairDemand = roadsNeedingRepair >= CONFIG.construction.roadRepairBuilderFloor;
    if (colonyState !== "bootstrap" && (snapshot.myConstructionSites.length > 0 || roadRepairDemand)) {
        const builderConfig = getRoleBounds("builder", home);
        const builderTotal = (counts.builder ?? 0) + pending.builder;
        const economyCap = (counts.harvester ?? 0) + (counts.worker ?? 0) + 1;
        const dynamicBuilderTarget = Math.min(builderConfig.maxCount, economyCap, Math.max(builderConfig.minCount, snapshot.myConstructionSites.length, 
        // 纯维修需求保底 1 个 — minCount 可能为 0（成熟房 tuning 收缩后）。
        roadRepairDemand ? 1 : 0));
        // 梯度缩放：用 economyPressure 迟滞带替代单阈值开关（TD-016）。
        // 迟滞窗：进入收缩 > 0.35，退出收缩 <= 0.25，带内保持当前状态。
        // 消除 pressure 在阈值附近波动时 builder 目标反复跳变的振荡。
        const builderPressure = roomCtx.economyPressure;
        const roomMem = Memory.rooms[home];
        let state = roomMem?.builderPressureState ?? 'full';
        if (state === 'full' && builderPressure > 0.35) {
            state = 'shrinking';
            if (roomMem)
                roomMem.builderPressureState = state;
        }
        else if (state === 'shrinking' && builderPressure <= 0.25) {
            state = 'full';
            if (roomMem)
                roomMem.builderPressureState = state;
        }
        let builderTarget;
        if (state === 'full') {
            builderTarget = dynamicBuilderTarget;
        }
        else {
            // shrinking：从 0.35 开始线性收缩，到 1.0 缩至 minCount。
            const t = Math.min(1, (builderPressure - 0.35) / 0.65);
            builderTarget = Math.round(dynamicBuilderTarget + t * (builderConfig.minCount - dynamicBuilderTarget));
            builderTarget = Math.max(builderTarget, builderConfig.minCount);
        }
        if (builderTotal < builderTarget) {
            // recovery 时提升为 P1（重建被毁基建是生存行为）；normal 时保持 P2（发展）。
            const builderPriority = inCrisis ? 1 : 2;
            for (let i = builderTotal; i < builderTarget; i++) {
                const key = spawnKey("builder", home, i);
                if (!hasKey(queue, key)) {
                    requests.push(createRequest("builder", home, i, key, builderPriority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
                }
            }
        }
    }
    // 即将死亡的 creep 的替换请求。
    // 老玩家四重门禁，防止 creep 数量激增：
    //   1. 角色存在性门禁（worker 有 harvester 时不替换，builder 无 site 不替换）
    //   2. maxCount 硬上限（living + pending 已达上限不替换）
    //   3. 盈余检查（living + pending > minCount 说明有多余，不替换）
    //   4. 稳定 key（不含 sourceId，防止 assignment 重分配导致 key 漂移产生重复）
    const roleConfigs = getAllRoleBounds(home);
    for (const creep of creeps) {
        if (creep.home !== home)
            continue;
        // A4：harvester 的替换阈值计入 spawn→source 通勤路程，
        // 防止替补还没走到矿位老矿工已死、采集断档。
        const travelTicks = creep.role === "harvester" ? estimateTravelTicks(snapshot, creep.sourceId) : 0;
        if (!needsReplacement(creep.ticksToLive, creep.bodyLength, travelTicks))
            continue;
        const role = creep.role;
        const config = roleConfigs[role];
        if (!config)
            continue;
        // 门禁 1：角色存在性 — worker 是紧急角色，harvester 建立后不再替换。
        if (role === "worker" && (counts.harvester ?? 0) + (counts.worker ?? 0) > 1)
            continue;
        // builder 无建造 site 且无道路维修需求时不替换（避免孵化无事可做的 builder）。
        if (role === "builder" && snapshot.myConstructionSites.length === 0 && !roadRepairDemand)
            continue;
        // upgrader 在 colonyState 不允许时不替换。
        if (role === "upgrader" && !allowUpgrader)
            continue;
        // 门禁 2：maxCount 硬上限。
        const livingCount = counts[role] ?? 0;
        const pendingCount = countPending(queue, role, home) + requests.filter(r => r.role === role).length;
        if (livingCount + pendingCount >= config.maxCount)
            continue;
        // 门禁 3：盈余检查 — 如果去掉这个将死的 creep 后仍 >= minCount，说明有多余，不替换。
        // 只有当 "将死 creep 是维持 minCount 的必要成员" 时才提前替换（利用 overlap 无缝衔接）。
        if (livingCount - 1 + pendingCount >= config.minCount)
            continue;
        // 门禁 4：稳定 key — 不含 sourceId，防止 assignment 重分配导致 key 漂移。
        const index = creep.spawnIndex ?? 0;
        const key = spawnKey(role, home, index);
        if (!hasKey(queue, key) && !requests.some(r => r.key === key)) {
            const priority = role === "harvester" || role === "worker" ? 1 : 2;
            const req = createRequest(role, home, index, key, priority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick, creep.sourceId);
            req.replaceBy = tick + req.body.length * 3 + CONFIG.spawn.replaceBuffer + travelTicks;
            requests.push(req);
        }
    }
    return { requests };
}
function hasKey(queue, key) {
    return queue.some(r => r.key === key);
}
/**
 * 创建孵化请求（纯函数）。
 *
 * energyAvailable 和 tick 由调用方显式传入，不从 Game/Memory 读取。
 */
function createRequest(role, home, index, key, priority, energyCapacity, energyAvailable, colonyState, rcl, tick, sourceId) {
    // X-16：body 选择策略按角色和状态分层：
    //   P0（紧急 worker）/ crisis / recovery / bootstrap：基于 energyAvailable 降级，速出保命。
    //   P1 harvester 在 normal 状态：使用 energyCapacity 满配 body，不降级。
    //     原因：2W harvester（300 能量）产出 4/tick vs 1W（200 能量）产出 2/tick，
    //     多等 100 能量（~50 tick）换来整个生命周期（1500 tick）双倍产出，ROI 极高。
    //     trySpawn 对非 P0 请求会自动等待能量足够再孵化，无需在请求层面降级。
    //   P2+（upgrader/builder）：使用 energyCapacity 满配。
    let body;
    // defender 始终降级：防御是时间敏感的 — 敌人正在拆家时，
    // 30 tick 后出场的满配不如现在就出场的半配（塔在补足火力差）。
    const shouldDegrade = priority === 0 ||
        role === "defender" ||
        colonyState === "bootstrap" ||
        colonyState === "recovery";
    if (shouldDegrade) {
        const fullBody = selectBody(role, energyCapacity, { rcl });
        const requiredParts = ROLE_REQUIRED_PARTS[role];
        // 优雅降级：孵化当前能量能负担的最大 body。宁可先出一个较小的 harvester（低效但维持 colony 存活），
        // 也不要为等待大 body 而让 harvester 断档归零（曾因此陷入「无 harvester→无收入→永远孵不起」死锁）。
        body = degradeBody(fullBody, energyAvailable, requiredParts) ?? selectBody(role, energyAvailable, { rcl });
    }
    else {
        body = selectBody(role, energyCapacity, { rcl });
    }
    const memory = {
        role,
        home,
        mode: "acquire",
        spawnIndex: index,
        ...(sourceId ? { sourceId } : {}),
    };
    return {
        key,
        role,
        home,
        priority,
        body,
        memory,
        createdAt: tick,
        // 请求带 TTL：需求消失后的 stale 请求由 cleanQueue 清除；
        // 需求仍在时下一 tick 以同 key 重建（hasKey 守卫解除）。
        // 副作用收益：重建时按当时容量重选 body，避免入队后 body 长期冻结。
        // TTL(1000) > 饥饿降级窗口（见 CONFIG.spawn.requestTtl 注释），不干扰降级计时。
        expiresAt: tick + CONFIG.spawn.requestTtl,
        retries: 0,
    };
}

/**
 * B1 回收通道的纯决策部分 — 选出应被标记回收的 creep 名。
 *
 * 标记规则（保守白名单，不做全量配额对账）：
 *   1. 废弃角色：role 不在 knownRoles 中（角色已下线，creep 永远闲置）；
 *      role 为 "unknown" 时跳过（数据畸形，交迁移/人工处理，不贸然回收）；
 *   2. 富余 worker：harvester 满编（≥ harvesterMinCount）时，
 *      worker 保留 1 只作灾后保险，其余回收（与 demand 存在性门禁语义一致）。
 *
 * 纯函数 — 接收预收集的摘要列表，不访问 Game/Memory。
 */
function selectRecycleCandidates(summaries, home, knownRoles, harvesterMinCount) {
    const marked = [];
    // 规则 1：废弃角色（"unknown" 除外 — 数据畸形交迁移/人工处理）。
    for (const s of summaries) {
        if (s.home !== home)
            continue;
        if (!knownRoles.has(s.role) && s.role !== "unknown")
            marked.push(s.name);
    }
    // 规则 2：harvester 满编时，保留最先遇到的 1 只 worker 作保险，其余标记。
    const harvesterCount = summaries.filter(s => s.home === home && s.role === "harvester").length;
    if (harvesterCount >= harvesterMinCount) {
        const workers = summaries.filter(s => s.home === home && s.role === "worker");
        for (const w of workers.slice(1)) {
            marked.push(w.name);
        }
    }
    return marked;
}

/**
 * 孵化管理器 — 唯一调用 spawnCreep 的模块。
 *
 * 职责：
 *   - 评估每房孵化需求
 *   - 在 Memory 中维护去重、按优先级排序的队列
 *   - 处理队列：尝试孵化最高优先级的请求
 *   - 处理 P0 恢复、body 降级和重试限制
 *
 * 优先级：P0（在所有依赖人口的其他系统之前运行）。
 */
const spawnManagerSystem = {
    name: "spawn-manager",
    priority: 0,
    run(ctx) {
        // P1-1：在循环外预构建全量摘要，避免 O(rooms × creeps) 重复遍历。
        // collectCreepSummaries / collectSpawningSummaries 遍历全部 Game.creeps / Game.spawns，
        // 原先在每房间循环内调用，N 房间 × M creep = O(N×M)。现改为 O(M) 一次构建。
        const creeps = collectCreepSummaries();
        const spawning = collectSpawningSummaries();
        // P3-3：预建 per-room 索引，避免 recyclePass 每房全量扫描 Game.creeps。
        // O(M) 一次构建，N 房间各取自己的子集 → 总计 O(M) 而非 O(N×M)。
        const creepsByRoom = new Map();
        for (const s of creeps) {
            const arr = creepsByRoom.get(s.home);
            if (arr)
                arr.push(s);
            else
                creepsByRoom.set(s.home, [s]);
        }
        for (const snapshot of ctx.snapshots()) {
            const roomMem = Memory.rooms[snapshot.roomName];
            if (!roomMem)
                continue;
            const queue = roomMem.spawnQueue ?? [];
            // 1. 先清理过期 / 隔离的请求 — 必须在 evaluateDemand 之前运行。
            //    否则已达到 maxRetries 的 stale 请求仍被 evaluateDemand 计入 pending，
            //    导致 harvesterCount > 0 → P0 worker 恢复请求不创建 → 死锁。
            cleanQueue(queue, ctx.tick, CONFIG.spawn.maxRetries);
            // 1.5 请求撤销通道：需求前提消失时立即出队，不等 TTL（幽灵需求回收）。
            //     trySpawn 消费队列时不复核当前世界状态 — 按旧状态入队的请求
            //     在 TTL 窗口（最长 1000 tick）内仍会被孵化，浪费能量。
            const colonyState = roomMem.colonyState ?? "normal";
            //     defender：威胁清除后不再需要（存量 defender 自然到期，见 demand 注释）。
            if (snapshot.threatCreeps.length === 0) {
                removeRequestsByRole(queue, "defender", snapshot.roomName);
            }
            //     upgrader：非 normal 且无降级风险时 demand 不再生成（allowUpgrader 门禁），
            //     与之对称地撤销残留请求，避免 recovery 期间孵出发展角色加剧赤字。
            if (colonyState !== "normal" && roomMem.controllerDowngradeRisk !== true) {
                removeRequestsByRole(queue, "upgrader", snapshot.roomName);
            }
            //     distributor：填充需求已清零（fillTargets 空 = 尖峰已被在途编制消化）
            //     且存活编制达 minCount 地板时，撤销尖峰期入队的扩编请求。
            //     不撤销的后果：请求在 TTL 窗口内仍会孵化 — 需求早已消失的常驻编制。
            //     minCount 守卫保证不误伤「storage 刚建成、首个 distributor 待孵」的请求。
            if (snapshot.fillTargets.length === 0) {
                const livingDist = (creepsByRoom.get(snapshot.roomName) ?? [])
                    .filter(c => c.role === "distributor").length;
                if (livingDist >= getRoleBounds("distributor", snapshot.roomName).minCount) {
                    removeRequestsByRole(queue, "distributor", snapshot.roomName);
                }
            }
            // 2. 从 Game/Memory 收集数据，调用纯函数评估需求。
            const roomCtx = {
                controllerDowngradeRisk: roomMem.controllerDowngradeRisk === true,
                energyAvailable: Game.rooms[snapshot.roomName]?.energyAvailable ?? 200,
                economyPressure: roomMem.economyPressure ?? 0,
                storageNearFull: roomMem.storageNearFull === true,
                liquidityScore: roomMem.phase?.liquidityScore ?? 0,
                drainScore: roomMem.phase?.drainScore ?? 0,
            };
            const { requests } = evaluateDemand(snapshot, queue, colonyState, creeps, spawning, roomCtx, ctx.tick);
            for (const req of requests) {
                submitRequest(queue, req);
            }
            roomMem.spawnQueue = queue;
            // 3. 按优先级排序。
            sortQueue(queue);
            // 4. 尝试孵化最高优先级的请求。
            trySpawn(snapshot, queue);
            // 5. B1：回收通道 — 标记退役 creep，引导至最近 spawn 回收残值能量。
            //    P3-3：传入预建的本房 creep 子集，避免全量 Game.creeps 扫描。
            recyclePass(snapshot, creepsByRoom.get(snapshot.roomName) ?? []);
        }
    },
};
/** 当前注册的角色集合（CONFIG.roles 是唯一权威）。 */
const KNOWN_ROLES = new Set(Object.keys(CONFIG.roles));
/**
 * B1 回收通道。
 *
 * 标记规则（保守白名单，不做全量配额对账）：
 *   1. 废弃角色：role 不在 CONFIG.roles 中（角色已下线，creep 永远闲置）；
 *   2. 富余 worker：harvester 满编时，worker 保留 1 只作灾后保险，其余回收
 *      （与 demand 的存在性门禁语义一致：worker 是过渡角色，不是常备军）。
 *
 * 执行：被标记 creep 走向本房最近 spawn（role-runner 对其短路 idle，不抢移动权），
 * 相邻时 spawn.recycleCreep 回收残值能量；spawn 忙碌时等待下一 tick。
 */
function recyclePass(snapshot, roomCreeps) {
    const home = snapshot.roomName;
    // ── 标记（纯函数决策）──
    // roomCreeps 已按 home 预过滤，selectRecycleCandidates 内部的 home 过滤为冗余 no-op，
    // 但保留以维护纯函数的自包含契约。
    const marked = selectRecycleCandidates(roomCreeps, home, KNOWN_ROLES, getRoleBounds("harvester", home).minCount);
    const markedSet = new Set(marked);
    for (const name of marked) {
        const creep = Game.creeps[name];
        if (creep && !creep.memory.recycle)
            creep.memory.recycle = true;
    }
    // ── 执行：引导至最近 spawn 并回收 ──
    // P3-3：仅遍历本房 creep 列表（来自预建索引），不再全量扫描 Game.creeps。
    // 待处理集合 = summary 中已有 recycle 标记的（旧标记）∪ 本 tick 新标记的（markedSet）。
    if (snapshot.spawns.length === 0)
        return;
    for (const s of roomCreeps) {
        if (!s.recycle && !markedSet.has(s.name))
            continue;
        const creep = Game.creeps[s.name];
        if (!creep)
            continue; // creep 可能在本 tick 死亡
        // 跨房归航：回收 creep 可能身处远矿房/失守的扩张房 —
        // findClosestByRange 只在同房有效（跨房返回 null 会让 creep 原地卡死）。
        if (creep.room.name !== home) {
            moveTowardRoom(creep, home);
            continue;
        }
        const spawn = creep.pos.findClosestByRange(snapshot.spawns);
        if (!spawn)
            continue;
        if (creep.pos.getRangeTo(spawn) <= 1) {
            // ERR_BUSY（spawn 孵化中）时静默等待下一 tick，不算失败。
            spawn.recycleCreep(creep);
        }
        else {
            moveToTarget(creep, spawn);
        }
    }
}
/**
 * 尝试从队列孵化 creep — 遍历所有空闲 spawn，多 spawn 房间可同 tick 并行开工。
 *
 * 能量记账：room.energyAvailable 是 tick 开始的快照，同 tick 多次 spawnCreep
 * 的扣费引擎在意图执行阶段才结算 — 若都按快照校验，第二个意图可能超支失败。
 * 因此用本地 energyBudget 逐次扣减，保证每个意图都在真实可用额度内。
 * 处理 P0 降级、body 容量校验和错误重试。
 */
function trySpawn(snapshot, queue) {
    if (queue.length === 0)
        return;
    if (snapshot.spawns.length === 0)
        return;
    // 收集所有空闲 spawn — RCL7-8 有 2-3 个 spawn，逐个消费队列请求。
    const freeSpawns = snapshot.spawns.filter(s => !s.spawning);
    if (freeSpawns.length === 0)
        return; // 所有 spawn 忙 — 不是错误。
    let spawnIdx = 0;
    let energyBudget = freeSpawns[0].room.energyAvailable;
    // 如果有待处理的 P0 请求，不处理更低优先级的请求。
    const hasP0 = queue.some(r => r.priority === 0);
    // 按优先级顺序处理请求（queue 已排序；splice 会改数组，倒序快照遍历不可行 —
    // 这里遍历副本，出队用 indexOf 定位）。
    for (const req of [...queue]) {
        if (spawnIdx >= freeSpawns.length)
            return; // 空闲 spawn 用尽。
        const spawn = freeSpawns[spawnIdx];
        if (!req)
            continue;
        // P0 阻塞：如果存在 P0 请求但暂时无法满足，不孵化非 P0 creep。
        if (hasP0 && req.priority > 0)
            return;
        // 检查 body 是否有效。
        if (req.body.length === 0) {
            req.retries++;
            continue;
        }
        const cost = bodyCost(req.body);
        // 降级策略（三层）：
        //   1. P0 始终降级（紧急恢复）。
        //   2. P1 在 bootstrap/recovery 时降级（关键路径死锁防护）。
        //   3. P1 饥饿超时降级：请求等待超过 2× 孵化耗时仍未孵化，说明 spawn 实际饥饿
        //      但 colonyState 可能仍为 "normal"（worker 维持 reserve 稳定，相位系统检测不到危机）。
        //      此时必须降级，否则陷入「等满额能量 → 永远凑不够 → 请求永远排队」死锁。
        //      线上 W37S58 实测：crisisCount=93 但 colonyState=normal，hauler 请求排队 4000+ tick 未孵化。
        //   4. P2 饥饿超时 + 经济压力降级：P2（发展角色）仅在同时满足以下条件时降级——
        //      a) 请求等待超过 10× 孵化耗时（给发展角色充足等待窗口）
        //      b) economyPressure > 0.5（确认经济确实紧张，而非仅是能量积累慢）
        //      双条件避免 bootstrap/正常低速增长阶段 P2 过早出小 body 导致人口配额被低效 creep 占满
        //      （rcl1-survival / live-anomaly-reproduction 测试回归）。
        let body = req.body;
        if (cost > energyBudget) {
            const roomMem = Memory.rooms[snapshot.roomName];
            const roomState = roomMem?.colonyState ?? "normal";
            const economyPressure = roomMem?.economyPressure ?? 0;
            const spawnTime = req.body.length * 3;
            const waitTicks = Game.time - (req.createdAt ?? Game.time);
            const starvedP1 = req.priority === 1 && waitTicks >= spawnTime * 2;
            const starvedP2 = req.priority === 2 && waitTicks >= spawnTime * 10 && economyPressure > 0.5;
            const allowDegrade = req.priority === 0 ||
                (req.priority === 1 && (roomState === "bootstrap" || roomState === "recovery")) ||
                starvedP1 ||
                starvedP2;
            if (allowDegrade) {
                // 使用角色正确的 requiredParts，避免 hauler（无 WORK）降级时
                // 因默认要求 WORK 而返回 undefined。
                const requiredParts = ROLE_REQUIRED_PARTS[req.role];
                const degraded = degradeBody(req.body, energyBudget, requiredParts);
                if (!degraded) {
                    // 降级失败说明能量连最小 body 都负担不起。
                    // 必须递增 retries，否则请求永远留在队列中不被 cleanQueue 清除，
                    // 持续阻塞 P0 worker 恢复请求的创建 → 永久死锁。
                    req.retries++;
                    continue;
                }
                body = degraded;
            }
            else {
                continue;
            }
        }
        // 检查 body 不超过容量上限。
        const capacity = spawn.room.energyCapacityAvailable;
        if (bodyCost(body) > capacity) {
            req.retries++;
            console.log(`[${Game.time}] spawn/${snapshot.roomName}: body exceeds capacity for ${req.key}`);
            continue;
        }
        // 生成包含 spawnIndex 的唯一 creep 名以供追踪。
        const memSpawnIndex = req.memory.spawnIndex ?? 0;
        const name = `${req.role}-${snapshot.roomName}-${memSpawnIndex}-${Game.time}-${Math.random().toString(36).slice(2, 6)}`;
        const result = spawn.spawnCreep(body, name, {
            memory: { ...req.memory },
        });
        if (result === OK) {
            const queueIdx = queue.indexOf(req);
            if (queueIdx >= 0)
                queue.splice(queueIdx, 1);
            // 扣减本地能量预算，换下一个空闲 spawn 继续消费队列。
            energyBudget -= bodyCost(body);
            spawnIdx++;
            continue;
        }
        if (result === ERR_BUSY) {
            // 该 spawn 意外忙碌 — 换下一个空闲 spawn 重试当前请求所在队列。
            spawnIdx++;
            continue;
        }
        if (result === ERR_NOT_ENOUGH_ENERGY)
            continue;
        // 所有其他错误：递增重试次数并可能隔离。
        req.retries++;
        if (req.retries < CONFIG.spawn.maxRetries) {
            console.log(`[${Game.time}] spawn/${snapshot.roomName}: spawnCreep returned ${result} for ${req.key} (retry ${req.retries})`);
        }
    }
}
/**
 * 适配层：从 Game.creeps 收集所有 creep 摘要。
 * 供纯函数 evaluateDemand 消费，避免领域层直接访问 Game。
 */
function collectCreepSummaries() {
    const result = [];
    for (const creep of Object.values(Game.creeps)) {
        // 跳过孵化中的 creep — 它们由 collectSpawningSummaries 单独收集。
        // Screeps 中孵化中的 creep 已存在于 Game.creeps（spawning=true），
        // 若两个列表各计一次，countCreepsByRole 会双重计数，孵化期间抑制真实需求。
        if (creep.spawning)
            continue;
        result.push({
            name: creep.name,
            role: creep.memory.role ?? "unknown",
            home: creep.memory.home ?? creep.room.name,
            ticksToLive: creep.ticksToLive,
            bodyLength: creep.body.length,
            sourceId: creep.memory.sourceId,
            spawnIndex: creep.memory.spawnIndex,
            recycle: creep.memory.recycle === true,
        });
    }
    return result;
}
/**
 * 适配层：从 Game.spawns 收集正在孵化中的 creep 摘要。
 * 供纯函数 evaluateDemand 消费，避免领域层直接访问 Game/Memory。
 */
function collectSpawningSummaries() {
    const result = [];
    for (const spawn of Object.values(Game.spawns)) {
        const spawning = spawn.spawning;
        if (!spawning)
            continue;
        const mem = Memory.creeps[spawning.name];
        if (!mem)
            continue;
        result.push({
            name: spawning.name,
            role: mem.role ?? "unknown",
            home: mem.home ?? spawn.room.name,
        });
    }
    return result;
}

/**
 * Time Series — CPU 和经济指标的时序数据采集。
 *
 * 设计意图：将 per-tick 遥测数据从 heap（单 tick 生命周期）提升为
 * 持久化的时间序列（存入 RawMemory segment），供事后趋势分析。
 *
 * 数据流：
 *   per-tick heap telemetry → 采样（每 N tick）→ ring buffer → segment flush
 *
 * 采样频率策略：
 *   - CPU 时序：每 10 tick 采样一次（500 条 = 5000 tick 窗口）
 *   - 经济时序：每 50 tick 采样一次（300 条 = 15000 tick 窗口）
 *   - 人口普查：每 100 tick 采样一次（仅保留最新快照）
 *
 * 成本：采样 ~0 CPU（浅拷贝几个数字），flush ~0.1 CPU（JSON.stringify）。
 * 受 P3 budget 门禁：conserve/recovery tier 下跳过采集。
 */
// ─── 采样逻辑（纯函数，便于测试）──────────────────────────────
/** 从 per-tick 遥测数据构建一个 CPU 采样点。 */
function sampleCpu(tick, budget, telemetry) {
    const cpu = Game.cpu.getUsed();
    const bucket = Game.cpu.bucket ?? 0;
    const tierRank = budget.tier === "healthy" ? 0
        : budget.tier === "guarded" ? 1
            : budget.tier === "conserve" ? 2
                : 3;
    // Top-3 系统按 CPU 降序
    const sys = Object.entries(telemetry.systemCpu)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    return {
        t: tick,
        cpu: Math.round(cpu * 10) / 10,
        bk: bucket,
        ti: tierRank,
        sl: Math.round(budget.softLimit * 10) / 10,
        hl: Math.round(budget.hardLimit * 10) / 10,
        sk: telemetry.skipped,
        er: telemetry.errors,
        s1: sys[0]?.[0] ?? "",
        v1: sys[0]?.[1] ? Math.round(sys[0][1] * 10) / 10 : 0,
        s2: sys[1]?.[0] ?? "",
        v2: sys[1]?.[1] ? Math.round(sys[1][1] * 10) / 10 : 0,
        s3: sys[2]?.[0] ?? "",
        v3: sys[2]?.[1] ? Math.round(sys[2][1] * 10) / 10 : 0,
    };
}
/** 从 RoomMemory.phase 构建一个经济采样点。 */
function sampleEconomy(tick, roomName, phase, economyPressure, snapshot) {
    const phaseRank = phase.phase === "bootstrap" ? 0
        : phase.phase === "growth" ? 1
            : phase.phase === "crisis" ? 2
                : phase.phase === "recovery" ? 3
                    : 4; // steady
    return {
        t: tick,
        r: roomName,
        rs: phase.reserve,
        d: phase.reserveDelta,
        ds: phase.drainScore,
        p: Math.round(economyPressure * 100),
        ea: snapshot.energyAvailable,
        ec: snapshot.energyCapacityAvailable,
        se: snapshot.storageEnergy,
        hc: phase.harvesterCount,
        sc: phase.sourceCount,
        ph: phaseRank,
        cte: snapshot.containerEnergy,
        cce: snapshot.controllerContainerEnergy,
    };
}

/**
 * Telemetry Collector — P3 系统，时序数据采集 + 事件日志 + 运行时摘要。
 *
 * 职责：
 *   1. 每 10 tick 采样 CPU 时序数据（来自 per-tick telemetry heap）
 *   2. 每 50 tick 采样经济时序数据（来自 RoomMemory.phase）
 *   3. 每 100 tick 采样人口普查数据
 *   4. 每 10 tick 执行差分事件检测（对比 Memory 前后状态）
 *   5. 每 10 tick flush per-tick 事件缓冲区到 segment 2
 *   6. 每 10 tick 更新 Memory.kernel.stats 摘要
 *
 * 优先级：P3 — 采集系统是非关键的，在 conserve/recovery tier 下跳过。
 * interval: 10 — 每 10 tick 运行一次（对齐 cpuSampleInterval）。
 *
 * CPU 预算：正常态 ~0.05-0.1 CPU/run（采样 + 偶尔 JSON.stringify）。
 * flush 受 segment dirty flag 控制 — 无新数据时不 stringify。
 */
// ─── 系统定义 ───────────────────────────────────────────────
const telemetryCollectorSystem = {
    name: "telemetry-collector",
    priority: 3,
    interval: CONFIG.telemetry.cpuSampleInterval,
    run(ctx) {
        // P3 在 conserve/recovery 下不运行 — 采集是非关键的。
        if (ctx.budget.tier === "conserve" || ctx.budget.tier === "recovery")
            return;
        const tick = ctx.tick;
        const tel = globalCache().telemetry;
        if (!tel || tel.tick !== tick)
            return; // telemetry 未初始化
        // 1. CPU 时序采样（每 interval tick = 每 10 tick）
        sampleCpuData(tick, ctx);
        // 2. 经济时序采样（每 economySampleInterval tick = 每 50 tick）
        if (tick % CONFIG.telemetry.economySampleInterval === 0) {
            sampleEconomyData(tick, ctx);
        }
        // 3. 人口普查（每 populationInterval tick = 每 100 tick）
        if (tick % CONFIG.telemetry.populationInterval === 0) {
            samplePopulationData(tick);
        }
        // 4. 差分事件检测 + 事件缓冲 flush
        detectAndFlushEvents(tick, ctx);
        // 5. 更新 Memory.kernel.stats 摘要
        updateStatsSummary(tick);
        // 6. 输出结构化遥测行供外部采集器（WebSocket console 订阅）接收。
        // 格式：@TELEMETRY {json} — 前缀过滤，不影响游戏控制台可读性。
        emitTelemetryLine(tick, ctx);
    },
};
// ─── CPU 时序采样 ────────────────────────────────────────────
function sampleCpuData(tick, ctx) {
    // 显式守卫：不依赖外部调用顺序，Global Reset 后 telemetry 未重建时直接跳过。
    const tel = globalCache().telemetry;
    if (!tel || tel.tick !== tick)
        return;
    const sample = sampleCpu(tick, ctx.budget, tel);
    const seg = readCpuSegment();
    ringPush(seg.cpu, sample);
    markCpuDirty();
}
// ─── 经济时序采样 ────────────────────────────────────────────
function sampleEconomyData(tick, ctx) {
    const seg = readEconomySegment();
    for (const snapshot of ctx.snapshots()) {
        const roomMem = Memory.rooms[snapshot.roomName];
        if (!roomMem?.phase)
            continue;
        const storageEnergy = snapshot.storage
            ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY)
            : 0;
        // P0-2: 采集 container 级别能量流数据，用于诊断物流瓶颈。
        // - containerEnergy: 所有 container 的能量总和（物流缓冲健康度）
        // - controllerContainerEnergy: controller 旁 container 的能量（站桩升级供能链健康度）
        let containerEnergy = 0;
        for (const c of snapshot.containers) {
            containerEnergy += c.store.getUsedCapacity(RESOURCE_ENERGY);
        }
        const controllerContainerEnergy = snapshot.controllerContainer
            ? snapshot.controllerContainer.store.getUsedCapacity(RESOURCE_ENERGY)
            : 0;
        const sample = sampleEconomy(tick, snapshot.roomName, roomMem.phase, roomMem.economyPressure ?? 0, {
            energyAvailable: snapshot.energyAvailable,
            energyCapacityAvailable: snapshot.energyCapacityAvailable,
            storageEnergy,
            containerEnergy,
            controllerContainerEnergy,
        });
        ringPush(seg.economy, sample);
    }
    markEconomyDirty();
}
// ─── 人口普查 ───────────────────────────────────────────────
function samplePopulationData(tick) {
    const counts = {};
    const ttls = {};
    const modeCounts = { acquire: 0, work: 0, idle: 0, flee: 0 };
    for (const creep of Object.values(Game.creeps)) {
        const role = creep.memory.role ?? "unknown";
        counts[role] = (counts[role] ?? 0) + 1;
        const ttl = creep.ticksToLive ?? 1500;
        if (!ttls[role])
            ttls[role] = [];
        ttls[role].push(ttl);
        // mode 分布采集
        const mode = creep.memory.mode ?? "idle";
        if (mode in modeCounts)
            modeCounts[mode]++;
    }
    // 孵化状态
    let sq = 0;
    let p0 = 0;
    for (const roomMem of Object.values(Memory.rooms)) {
        if (roomMem?.spawnQueue) {
            sq += roomMem.spawnQueue.length;
            p0 += roomMem.spawnQueue.filter(r => r.priority === 0).length;
        }
    }
    let sp = 0;
    for (const spawn of Object.values(Game.spawns)) {
        if (spawn.spawning)
            sp++;
    }
    const avg = (role) => {
        const arr = ttls[role];
        if (!arr || arr.length === 0)
            return 0;
        return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    };
    const snapshot = {
        t: tick,
        hv: counts["harvester"] ?? 0,
        ha: counts["hauler"] ?? 0,
        up: counts["upgrader"] ?? 0,
        bd: counts["builder"] ?? 0,
        wk: counts["worker"] ?? 0,
        hvTtl: avg("harvester"),
        haTtl: avg("hauler"),
        upTtl: avg("upgrader"),
        bdTtl: avg("builder"),
        sq,
        sp,
        p0,
        ma: modeCounts.acquire,
        mw: modeCounts.work,
        mi: modeCounts.idle,
        mf: modeCounts.flee,
    };
    const seg = readCpuSegment();
    seg.population = snapshot;
    markCpuDirty();
}
// ─── 差分事件检测 + 事件 flush ───────────────────────────────
/**
 * 对比 Memory 中前后状态，检测关键转换并记录为事件。
 * 同时将 per-tick eventBuffer 中的显式事件 flush 到 segment 2。
 *
 * 差分检测不需要修改现有系统 — telemetry-collector 作为纯观察者，
 * 每次运行时读取当前 Memory 状态，与上次记录的"前值"对比。
 */
function detectAndFlushEvents(tick, ctx) {
    const g = globalCache();
    if (!g.__telemetryPrevState)
        g.__telemetryPrevState = {};
    const prev = g.__telemetryPrevState;
    // 1. Tier 转换检测
    const currentTier = ctx.budget.tier;
    if (prev.tier !== undefined && prev.tier !== currentTier) {
        const prevRank = tierRank(prev.tier);
        const currRank = tierRank(currentTier);
        if (currRank > prevRank) {
            drainEventBuffer(); // 先 flush 显式事件
            pushEventDirect(1 /* EventKind.TierDowngrade */, "", [prevRank, currRank]);
        }
        else {
            drainEventBuffer();
            pushEventDirect(2 /* EventKind.TierUpgrade */, "", [prevRank, currRank]);
        }
    }
    prev.tier = currentTier;
    // 2. 房间级差分检测
    if (!prev.rooms)
        prev.rooms = {};
    for (const snapshot of ctx.snapshots()) {
        const roomName = snapshot.roomName;
        const roomMem = Memory.rooms[roomName];
        if (!roomMem)
            continue;
        const prevRoom = prev.rooms[roomName] ?? {};
        if (!prev.rooms[roomName])
            prev.rooms[roomName] = {};
        // Phase 转换
        const currentPhase = roomMem.phase?.phase;
        if (prevRoom.phase !== undefined &&
            currentPhase !== undefined &&
            prevRoom.phase !== currentPhase) {
            pushEventDirect(0 /* EventKind.PhaseTransition */, roomName, [phaseRank(prevRoom.phase), phaseRank(currentPhase)]);
            // 进入 crisis 计数
            if (currentPhase === "crisis") {
                incrementCrisisCount();
            }
        }
        prev.rooms[roomName].phase = currentPhase;
        // ColonyState 转换
        const currentColony = roomMem.colonyState;
        if (prevRoom.colonyState !== undefined &&
            currentColony !== undefined &&
            prevRoom.colonyState !== currentColony) {
            pushEventDirect(3 /* EventKind.ColonyStateChange */, roomName, [colonyStateRank(prevRoom.colonyState), colonyStateRank(currentColony)]);
        }
        prev.rooms[roomName].colonyState = currentColony;
        // RCL 变化
        const currentRcl = snapshot.rcl;
        if (prevRoom.rcl !== undefined &&
            prevRoom.rcl !== currentRcl &&
            currentRcl > prevRoom.rcl) {
            pushEventDirect(4 /* EventKind.ControllerLevelUp */, roomName, [prevRoom.rcl, currentRcl]);
        }
        prev.rooms[roomName].rcl = currentRcl;
        // 敌人入侵/清除
        const hasThreats = snapshot.threatCreeps.length > 0;
        if (prevRoom.hadThreats !== undefined) {
            if (hasThreats && !prevRoom.hadThreats) {
                pushEventDirect(7 /* EventKind.EnemyInvasion */, roomName, [snapshot.threatCreeps.length]);
            }
            else if (!hasThreats && prevRoom.hadThreats) {
                pushEventDirect(8 /* EventKind.EnemyCleared */, roomName, []);
            }
        }
        prev.rooms[roomName].hadThreats = hasThreats;
        // Controller 降级风险
        const downgradeRisk = roomMem.controllerDowngradeRisk === true;
        if (downgradeRisk && !prevRoom.downgradeRisk) {
            const ctrl = snapshot.controller;
            const ticks = ctrl?.ticksToDowngrade ?? 0;
            pushEventDirect(5 /* EventKind.ControllerDowngradeRisk */, roomName, [ticks]);
        }
        prev.rooms[roomName].downgradeRisk = downgradeRisk;
        // 关键结构被毁检测 — spawn/tower/container/storage 数量减少时记录事件。
        // structureTypeCode: 0=spawn, 1=tower, 2=container, 3=storage
        const currStructures = {
            sp: snapshot.spawns.length,
            tw: snapshot.towers.length,
            ct: snapshot.containers.length,
            st: snapshot.storage ? 1 : 0,
        };
        if (prevRoom.structures) {
            if (currStructures.sp < prevRoom.structures.sp) {
                pushEventDirect(13 /* EventKind.StructureDestroyed */, roomName, [0, prevRoom.structures.sp, currStructures.sp]);
            }
            if (currStructures.tw < prevRoom.structures.tw) {
                pushEventDirect(13 /* EventKind.StructureDestroyed */, roomName, [1, prevRoom.structures.tw, currStructures.tw]);
            }
            if (currStructures.ct < prevRoom.structures.ct) {
                pushEventDirect(13 /* EventKind.StructureDestroyed */, roomName, [2, prevRoom.structures.ct, currStructures.ct]);
            }
            if (currStructures.st < prevRoom.structures.st) {
                pushEventDirect(13 /* EventKind.StructureDestroyed */, roomName, [3, prevRoom.structures.st, currStructures.st]);
            }
        }
        prev.rooms[roomName].structures = currStructures;
    }
    // 3. Flush per-tick 事件缓冲区中的显式事件
    const explicitEvents = drainEventBuffer();
    if (explicitEvents.length > 0) {
        const seg = readEventLogSegment();
        for (const evt of explicitEvents) {
            ringPush(seg.events, evt);
        }
        markEventLogDirty();
    }
}
/** 直接推入事件到 segment（绕过 heap buffer，用于差分检测）。 */
function pushEventDirect(kind, roomName, data) {
    const seg = readEventLogSegment();
    ringPush(seg.events, {
        t: Game.time,
        k: kind,
        r: roomName,
        d: data,
    });
    markEventLogDirty();
}
// ─── Memory.kernel.stats 摘要 ────────────────────────────────
function updateStatsSummary(tick) {
    if (!Memory.kernel)
        Memory.kernel = {};
    if (!Memory.kernel.stats) {
        Memory.kernel.stats = {
            lastSample: 0,
            cpuAvg10: 0,
            cpuMax10: 0,
            bucketMin10: 0,
            crisisCount: 0,
            tierTransitions: 0,
            errorHotspot: "",
            skipHotspot: "",
        };
    }
    const stats = Memory.kernel.stats;
    const seg = readCpuSegment();
    const cpuSamples = ringToArray(seg.cpu);
    // 取最近 10 个采样点
    const recent = cpuSamples.slice(-10);
    if (recent.length > 0) {
        let sum = 0;
        let max = 0;
        let bucketMin = Infinity;
        for (const s of recent) {
            sum += s.cpu;
            if (s.cpu > max)
                max = s.cpu;
            if (s.bk < bucketMin)
                bucketMin = s.bk;
        }
        stats.cpuAvg10 = Math.round((sum / recent.length) * 10) / 10;
        stats.cpuMax10 = Math.round(max * 10) / 10;
        stats.bucketMin10 = bucketMin === Infinity ? 0 : bucketMin;
    }
    stats.lastSample = tick;
    // 最频繁的 skip 原因
    if (Memory.kernel.skipReasons) {
        let maxSkip = 0;
        let hotspot = "";
        for (const [reason, count] of Object.entries(Memory.kernel.skipReasons)) {
            if (count > maxSkip) {
                maxSkip = count;
                hotspot = reason;
            }
        }
        stats.skipHotspot = hotspot;
    }
    // 最频繁的错误 label（从 globalCache 读取，per-tick 限频日志的计数）
    const g = globalCache();
    if (g.errorCounts && g.errorCounts.size > 0) {
        let maxErr = 0;
        let hotspot = "";
        for (const [label, count] of g.errorCounts) {
            if (count > maxErr) {
                maxErr = count;
                hotspot = label;
            }
        }
        stats.errorHotspot = hotspot;
    }
}
// ─── 结构化 console 输出（外部采集通道）──────────────────────
/**
 * 输出一行 @TELEMETRY 前缀的 JSON，供外部 WebSocket console 订阅器接收。
 *
 * 格式：@TELEMETRY {"t":12345,"cpu":8.2,"bk":8500,...}
 *
 * 外部采集脚本按 @TELEMETRY 前缀过滤，写入 telemetry.jsonl 供事后分析。
 * 此行同时出现在游戏控制台 — 前缀使其可辨识但不干扰人类阅读。
 *
 * CPU 开销：单次 console.log 约 0.02-0.05 CPU [Experience]。
 * 每 10 tick 一次，在 P3 budget 下可接受。
 */
function emitTelemetryLine(tick, ctx) {
    // 显式守卫：不依赖外部调用顺序，Global Reset 后 telemetry 未重建时直接跳过。
    const tel = globalCache().telemetry;
    if (!tel || tel.tick !== tick)
        return;
    const stats = Memory.kernel?.stats;
    // 仅在有值得关注的信号时输出，避免健康 tick 刷屏。
    // 始终输出：CPU > softLimit*0.7、有错误、有 skip、有事件、有 stats。
    const cpu = Game.cpu.getUsed();
    const hasSignal = cpu > ctx.budget.softLimit * 0.7
        || tel.errors > 0
        || tel.skipped > 0
        || stats != null;
    if (!hasSignal)
        return;
    const payload = {
        t: tick,
        cpu: Math.round(cpu * 10) / 10,
        bk: Game.cpu.bucket ?? 0,
        tier: ctx.budget.tier,
        sk: tel.skipped,
        er: tel.errors,
        // 摘要指标（如果已更新）
        avg: stats?.cpuAvg10 ?? 0,
        max: stats?.cpuMax10 ?? 0,
        bkm: stats?.bucketMin10 ?? 0,
        crisis: stats?.crisisCount ?? 0,
        errHot: stats?.errorHotspot ?? "",
        skipHot: stats?.skipHotspot ?? "",
    };
    console.log(`@TELEMETRY ${JSON.stringify(payload)}`);
}
// ─── 辅助函数 ───────────────────────────────────────────────
function tierRank(tier) {
    return tier === "healthy" ? 0
        : tier === "guarded" ? 1
            : tier === "conserve" ? 2
                : 3;
}
function phaseRank(phase) {
    return phase === "bootstrap" ? 0
        : phase === "growth" ? 1
            : phase === "crisis" ? 2
                : phase === "recovery" ? 3
                    : 4; // steady
}
function colonyStateRank(state) {
    return state === "bootstrap" ? 0
        : state === "recovery" ? 1
            : state === "normal" ? 2
                : 3; // defense
}
function incrementCrisisCount() {
    if (!Memory.kernel)
        Memory.kernel = {};
    if (!Memory.kernel.stats) {
        Memory.kernel.stats = {
            lastSample: 0,
            cpuAvg10: 0,
            cpuMax10: 0,
            bucketMin10: 0,
            crisisCount: 0,
            tierTransitions: 0,
            errorHotspot: "",
            skipHotspot: "",
        };
    }
    Memory.kernel.stats.crisisCount++;
}

/** 基础矿物库存目标（每种至少保留的量）。 */
const MINERAL_RESERVE_TARGET = {
    H: 500,
    O: 500,
    U: 500,
    L: 500,
    K: 500,
    Z: 500,
    X: 200,
};
/**
 * 检查房间是否缺少某种基础矿物（用于市场采购决策）。
 *
 * @param available 当前库存
 * @returns 缺少的矿物列表及缺口量
 */
function getMineralDeficits(available) {
    const deficits = [];
    for (const [mineral, target] of Object.entries(MINERAL_RESERVE_TARGET)) {
        const have = available[mineral] ?? 0;
        if (have < target) {
            deficits.push({ mineral, deficit: target - have });
        }
    }
    return deficits;
}
/**
 * 从卖单中挑最优买入目标：单价不超上限，价低者优先，同价量大者优先
 *（一次 deal 吃满批量，摊薄能量运费）。
 */
function pickBestSellOrder(orders, maxPrice) {
    let best;
    for (const o of orders) {
        if (o.price > maxPrice)
            continue;
        if (o.amount <= 0 || !o.roomName)
            continue;
        if (!best || o.price < best.price || (o.price === best.price && o.amount > best.amount)) {
            best = o;
        }
    }
    return best;
}
/**
 * 从买单中挑最优卖出目标：单价不低于底线，价高者优先，同价量大者优先。
 */
function pickBestBuyOrder(orders, minPrice) {
    let best;
    for (const o of orders) {
        if (o.price < minPrice)
            continue;
        if (o.amount <= 0 || !o.roomName)
            continue;
        if (!best || o.price > best.price || (o.price === best.price && o.amount > best.amount)) {
            best = o;
        }
    }
    return best;
}

/**
 * Terminal Manager — P3 系统，市场贸易的唯一 Game.market 调用点。
 *
 * 战略定位：单房间只产一种矿物，lab 反应链需要多矿种原料。
 * 在多房间互济接入前，市场是唯一的原料来源；而买入需要 credits，
 * credits 的唯一收入是卖出本房盈余矿物 — 因此必须双向交易才能形成闭环：
 *
 *   extractor → 本房矿物 → terminal（haulMineralsToStorage 已优先存 terminal）
 *     → 卖出盈余换 credits → 买入缺口矿物 → supplyLabs（terminal 回退）→ lab 反应链
 *
 * 能量运费：deal 无论买卖都从本方 terminal 扣能量
 *（calcTransactionCost），由 distributor 的 stockTerminalEnergy 维持储备。
 *
 * 节流设计：
 *   - interval 200 tick + bucket 门禁 — getAllOrders 是重调用 [Facts]
 *   - 每次运行每房最多 1 单（terminal 有 deal 冷却），全局引擎上限 10 单/tick [Facts]
 *   - 私服无市场 API 时整体跳过（与 pixel-system 同款守卫）
 */
const terminalManagerSystem = {
    name: "terminal-manager",
    priority: 3,
    interval: CONFIG.market.interval,
    run(ctx) {
        // 私服/测试环境无市场 API — 安全跳过。
        if (typeof Game.market?.getAllOrders !== "function")
            return;
        // 贸易不是生存关键：仅在 CPU 富余时运行。
        if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded")
            return;
        if ((Game.cpu.bucket ?? 0) < CONFIG.market.minBucket)
            return;
        for (const snapshot of ctx.snapshots()) {
            const terminal = snapshot.terminal;
            if (!terminal)
                continue;
            if (terminal.cooldown > 0)
                continue;
            // 1. 先卖后买：卖出是 credits 的唯一来源，信用地板前必须先有收入。
            if (trySellHomeMineral(snapshot, terminal))
                continue; // 本次冷却窗口已用掉
            // 2. 买入缺口矿物（credits 允许时）。
            tryBuyDeficit(snapshot, terminal);
        }
    },
};
/** 把 Game.market 的订单对象裁剪为纯函数可消费的摘要。 */
function toSummaries(orders) {
    return orders.map(o => ({
        id: o.id,
        price: o.price,
        amount: o.remainingAmount ?? o.amount,
        roomName: o.roomName,
    }));
}
/** 能量运费校验后执行 deal。成功返回 true。 */
function executeDeal(order, amount, terminal, roomName) {
    if (amount <= 0 || !order.roomName)
        return false;
    const cost = Game.market.calcTransactionCost(amount, roomName, order.roomName);
    if (cost > terminal.store.getUsedCapacity(RESOURCE_ENERGY))
        return false;
    const result = Game.market.deal(order.id, amount, roomName);
    if (result === OK) {
        console.log(`[${Game.time}] terminal/${roomName}: deal ${order.id} amount=${amount} price=${order.price} energyCost=${cost}`);
        return true;
    }
    return false;
}
/**
 * 卖出本房盈余矿物 — 保留 sellReserve 自用，只卖 terminal 内现货
 *（deal 从 terminal 出货，storage 部分由 haulMineralsToStorage 逐步转运）。
 */
function trySellHomeMineral(snapshot, terminal) {
    const homeMineral = snapshot.minerals[0]?.mineralType;
    if (!homeMineral)
        return false;
    const inTerminal = terminal.store.getUsedCapacity(homeMineral) ?? 0;
    const inStorage = snapshot.storage?.store.getUsedCapacity(homeMineral) ?? 0;
    const surplus = inTerminal + inStorage - CONFIG.market.sellReserve;
    if (surplus <= 0 || inTerminal <= 0)
        return false;
    const orders = toSummaries(Game.market.getAllOrders({ type: ORDER_BUY, resourceType: homeMineral }));
    const best = pickBestBuyOrder(orders, CONFIG.market.minSellPrice);
    if (!best)
        return false;
    const amount = Math.min(surplus, inTerminal, best.amount, CONFIG.market.maxDealAmount);
    return executeDeal(best, amount, terminal, snapshot.roomName);
}
/** 买入库存缺口最大的一种基础矿物（每次运行只处理一种，控制 getAllOrders 开销）。 */
function tryBuyDeficit(snapshot, terminal) {
    if (Game.market.credits < CONFIG.market.creditFloor)
        return false;
    const inventory = collectMineralInventory(snapshot);
    const deficits = getMineralDeficits(inventory);
    if (deficits.length === 0)
        return false;
    // 缺口最大者优先 — 反应链最先卡在存量最少的原料上。
    deficits.sort((a, b) => b.deficit - a.deficit);
    const target = deficits[0];
    const maxPrice = CONFIG.market.maxBuyPrice[target.mineral];
    if (maxPrice === undefined)
        return false;
    const orders = toSummaries(Game.market.getAllOrders({ type: ORDER_SELL, resourceType: target.mineral }));
    const best = pickBestSellOrder(orders, maxPrice);
    if (!best)
        return false;
    // 成交量受缺口、订单余量、单笔上限与 credits 余额四重约束。
    const affordable = Math.floor((Game.market.credits - CONFIG.market.creditFloor) / best.price);
    const amount = Math.min(target.deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
    return executeDeal(best, amount, terminal, snapshot.roomName);
}
/** 汇总 storage + terminal 的矿物库存（供缺口计算）。 */
function collectMineralInventory(snapshot) {
    const inventory = {};
    const stores = [snapshot.storage?.store, snapshot.terminal?.store];
    for (const store of stores) {
        if (!store)
            continue;
        for (const resource of Object.keys(store)) {
            if (resource === RESOURCE_ENERGY)
                continue;
            inventory[resource] = (inventory[resource] ?? 0) + (store[resource] ?? 0);
        }
    }
    return inventory;
}

/**
 * Tuning Evaluator — 从聚合遥测信号推导参数调整的纯函数。
 *
 * 设计原则（模型7：韧性优先于完美）：
 *   - 保守调整：每次只步进 1，有冷却期防振荡。
 *   - 趋势确认（P1-1）：连续 2 次评估窗口显示同方向信号才调整，防止单次噪声驱动决策。
 *   - 信号驱动：只在有充分证据时才调整。
 *   - 危机锁定：经济不稳定时完全跳过调优，让静态 CONFIG 应对。
 *   - 纯函数：不访问 Game/Memory，接收所有数据作为参数，可 Vitest 测试。
 *
 * 调优逻辑概览：
 *   hauler.maxCount  ↑ container 持续满 + hauler 已达上限 + 经济健康 + 消费端未饱和
 *                      （spawnFillRatio < 0.8 — 消费端饱和时加 hauler 只会加剧拥堵）
 *                    ↓ container 持续空 + hauler > minCount + 经济健康
 *   hauler.minCount  ↑ container 持续半满 + 经济健康
 *                    ↓ container 持续极空 + hauler ≤ minCount
 *   harvester.maxCount ↑ 储备持续下降 + harvester 已达上限 + 经济非危机
 *                      ↓ 储备持续增长 + harvester > minCount + 经济健康
 *   upgrader.maxCount ↑ storage 持续高位 + 经济健康 + upgrader 已达上限
 *                     ↓ storage 低位 OR 经济压力高
 *   builder.maxCount  ↑ buildQueue 持续积压 + 经济健康 + builder 已达上限
 *                     ↓ buildQueue 空 OR 经济压力高
 *
 * 趋势确认机制：
 *   每个参数维护一个 lastTrend 方向（up/down/none）。
 *   - 当前评估计算"期望方向" desired。
 *   - 若 desired != "none" 且 prevDirection == desired → 触发调整，newDirection 重置为 "none"。
 *   - 若 desired != "none" 且 prevDirection != desired → 记录 newDirection = desired（首次观察）。
 *   - 若 desired == "none" → newDirection = "none"（清除趋势）。
 *   效果：单次噪声不会触发调整，必须连续 2 次评估窗口都显示同方向。
 */
// ─── 信号阈值常量 ─────────────────────────────────────────────
/** 储备趋势阈值（每采样周期 50 tick 的 delta）。 */
const RESERVE_DRAINING = -50;
const RESERVE_SURPLUS = 100;
/** 经济健康阈值。 */
const PRESSURE_HEALTHY = 0.3;
const PRESSURE_STRESSED = 0.5;
/** 危机比例阈值 — 超过此值跳过所有调优。 */
const CRISIS_RATIO_LOCK = 0.3;
/** Container 填充率阈值。 */
const CONTAINER_HIGH = 0.7;
const CONTAINER_MODERATE = 0.5;
const CONTAINER_LOW = 0.2;
const CONTAINER_VERY_LOW = 0.15;
/**
 * Spawn+extension 填充率阈值 — 消费端饱和度判断。
 * [Experience] 当 spawn/extension 持续 >= 80% 时，说明消费端已饱和，
 * container 满 不是 hauler 不够，而是无处可送。此时加 hauler 只会加剧拥堵。
 */
const SPAWN_SATURATED = 0.8;
/** Storage 能量阈值。 */
const STORAGE_SURPLUS = 50000;
const STORAGE_LOW = 10000;
/** Build queue 积压阈值。 */
const BUILD_BACKLOG = 3;
// ─── 主评估函数 ───────────────────────────────────────────────
/**
 * 评估所有可调参数，返回需要执行的调整列表。
 *
 * @param signals        从遥测聚合的信号
 * @param currentBounds  当前生效的角色边界（CONFIG + override 合并后的值）
 * @param lastAdjusted   每个参数上次调整的 tick
 * @param currentTick    当前 tick
 * @param prevTrend      上次评估的趋势记录（每个参数的方向）—— P1-1 趋势确认
 * @returns 评估结果（调整列表 + 诊断信号 + 新趋势记录）
 */
function evaluateTuning(signals, currentBounds, lastAdjusted, currentTick, prevTrend = {}) {
    const adjustments = [];
    const newTrend = {};
    const signalRecord = toSignalRecord(signals);
    // ── 全局门禁 ──
    if (signals.tierRank >= 2) {
        return { adjustments, signals: signalRecord, skipped: "cpu_tier_conserve_or_worse", newTrend };
    }
    if (signals.crisisRatio > CRISIS_RATIO_LOCK) {
        return { adjustments, signals: signalRecord, skipped: "economy_unstable", newTrend };
    }
    if (signals.rcl < 2) {
        return { adjustments, signals: signalRecord, skipped: "rcl_too_low", newTrend };
    }
    // ── 逐参数评估 ──
    const evals = [
        ["hauler.maxCount", evaluateHaulerMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["hauler.maxCount"] ?? "none")],
        ["hauler.minCount", evaluateHaulerMinCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["hauler.minCount"] ?? "none")],
        ["harvester.maxCount", evaluateHarvesterMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["harvester.maxCount"] ?? "none")],
        ["upgrader.maxCount", evaluateUpgraderMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["upgrader.maxCount"] ?? "none")],
        ["builder.maxCount", evaluateBuilderMaxCount(signals, currentBounds, lastAdjusted, currentTick, prevTrend["builder.maxCount"] ?? "none")],
    ];
    for (const [param, evalResult] of evals) {
        newTrend[param] = evalResult.newDirection;
        if (evalResult.adjustment) {
            adjustments.push(evalResult.adjustment);
        }
    }
    return { adjustments, signals: signalRecord, newTrend };
}
// ─── hauler.maxCount ─────────────────────────────────────────
function evaluateHaulerMaxCount(s, bounds, lastAdjusted, tick, prevDirection) {
    const param = "hauler.maxCount";
    if (isInCooldown(param, lastAdjusted[param], tick)) {
        return { newDirection: "none" };
    }
    const current = bounds.hauler?.maxCount ?? 6;
    const boundsDef = TUNING_BOUNDS[param];
    const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
    // 计算期望方向
    let desired = "none";
    let reason = "";
    // ↑ 增加：container 持续满 + hauler 已达上限 + 经济健康 + 消费端未饱和
    if (s.containerFillRatio > CONTAINER_HIGH &&
        s.haulerCount >= current &&
        economyHealthy &&
        s.spawnFillRatio < SPAWN_SATURATED &&
        current < boundsDef.ceiling) {
        desired = "up";
        reason = `Containers ${(s.containerFillRatio * 100).toFixed(0)}% full, spawn ${(s.spawnFillRatio * 100).toFixed(0)}% (unsaturated), haulers at max ${current}`;
    }
    // ↓ 减少：container 持续空 + hauler > minCount + 经济健康
    else if (s.containerFillRatio < CONTAINER_LOW &&
        s.haulerCount > (bounds.hauler?.minCount ?? 2) &&
        economyHealthy &&
        current > boundsDef.floor) {
        desired = "down";
        reason = `Containers only ${(s.containerFillRatio * 100).toFixed(0)}% full, haulers likely oversupplied at max ${current}`;
    }
    return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}
// ─── hauler.minCount ─────────────────────────────────────────
function evaluateHaulerMinCount(s, bounds, lastAdjusted, tick, prevDirection) {
    const param = "hauler.minCount";
    if (isInCooldown(param, lastAdjusted[param], tick)) {
        return { newDirection: "none" };
    }
    const current = bounds.hauler?.minCount ?? 2;
    const boundsDef = TUNING_BOUNDS[param];
    const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
    let desired = "none";
    let reason = "";
    // ↑ 增加：container 持续半满 + 经济健康
    if (s.containerFillRatio > CONTAINER_MODERATE &&
        economyHealthy &&
        current < boundsDef.ceiling) {
        desired = "up";
        reason = `Containers ${(s.containerFillRatio * 100).toFixed(0)}% full, raising floor to ensure throughput`;
    }
    // ↓ 减少：container 持续极空 + hauler ≤ minCount
    else if (s.containerFillRatio < CONTAINER_VERY_LOW &&
        s.haulerCount <= current &&
        current > boundsDef.floor) {
        desired = "down";
        reason = `Containers only ${(s.containerFillRatio * 100).toFixed(0)}% full, lowering floor to avoid idle haulers`;
    }
    return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}
// ─── harvester.maxCount ──────────────────────────────────────
function evaluateHarvesterMaxCount(s, bounds, lastAdjusted, tick, prevDirection) {
    const param = "harvester.maxCount";
    if (isInCooldown(param, lastAdjusted[param], tick)) {
        return { newDirection: "none" };
    }
    const current = bounds.harvester?.maxCount ?? 4;
    const boundsDef = TUNING_BOUNDS[param];
    const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
    const economyNotCrisis = s.avgPressure < PRESSURE_STRESSED;
    let desired = "none";
    let reason = "";
    // ↑ 增加：储备持续下降 + harvester 已达上限 + 经济非危机
    if (s.avgReserveDelta < RESERVE_DRAINING &&
        s.harvesterCount >= current &&
        economyNotCrisis &&
        current < boundsDef.ceiling) {
        desired = "up";
        reason = `Reserve draining (${s.avgReserveDelta.toFixed(0)}/cycle) with harvesters at max ${current}`;
    }
    // ↓ 减少：储备持续增长 + harvester > minCount + 经济健康
    else if (s.avgReserveDelta > RESERVE_SURPLUS &&
        s.harvesterCount > (bounds.harvester?.minCount ?? 2) &&
        economyHealthy &&
        current > boundsDef.floor) {
        desired = "down";
        reason = `Reserve surplus (+${s.avgReserveDelta.toFixed(0)}/cycle), harvesters oversupplied at max ${current}`;
    }
    return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}
// ─── upgrader.maxCount ───────────────────────────────────────
function evaluateUpgraderMaxCount(s, bounds, lastAdjusted, tick, prevDirection) {
    const param = "upgrader.maxCount";
    if (isInCooldown(param, lastAdjusted[param], tick)) {
        return { newDirection: "none" };
    }
    const current = bounds.upgrader?.maxCount ?? 3;
    const boundsDef = TUNING_BOUNDS[param];
    const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
    const economyStressed = s.avgPressure > PRESSURE_STRESSED;
    let desired = "none";
    let reason = "";
    // ↑ 增加：storage 持续高位 + 经济健康 + upgrader 已达上限
    if (s.avgStorageEnergy > STORAGE_SURPLUS &&
        economyHealthy &&
        s.upgraderCount >= current &&
        current < boundsDef.ceiling) {
        desired = "up";
        reason = `Storage ${s.avgStorageEnergy.toFixed(0)} energy with upgraders at max ${current}, burning surplus`;
    }
    // ↓ 减少：storage 低位 OR 经济压力高
    else if ((s.avgStorageEnergy < STORAGE_LOW || economyStressed) &&
        current > boundsDef.floor) {
        desired = "down";
        reason = s.avgStorageEnergy < STORAGE_LOW
            ? `Storage low (${s.avgStorageEnergy.toFixed(0)}), conserving upgrade capacity`
            : `Economy pressure high (${(s.avgPressure * 100).toFixed(0)}%), reducing upgrade capacity`;
    }
    return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}
// ─── builder.maxCount ────────────────────────────────────────
function evaluateBuilderMaxCount(s, bounds, lastAdjusted, tick, prevDirection) {
    const param = "builder.maxCount";
    if (isInCooldown(param, lastAdjusted[param], tick)) {
        return { newDirection: "none" };
    }
    const current = bounds.builder?.maxCount ?? 4;
    const boundsDef = TUNING_BOUNDS[param];
    const economyHealthy = s.avgPressure < PRESSURE_HEALTHY;
    const economyStressed = s.avgPressure > 0.4;
    let desired = "none";
    let reason = "";
    // ↑ 增加：buildQueue 持续积压 + 经济健康 + builder 已达上限
    if (s.buildQueueBacklog > BUILD_BACKLOG &&
        economyHealthy &&
        s.builderCount >= current &&
        current < boundsDef.ceiling) {
        desired = "up";
        reason = `Build backlog ${s.buildQueueBacklog} items with builders at max ${current}`;
    }
    // ↓ 减少：buildQueue 空 OR 经济压力高
    else if ((s.buildQueueBacklog === 0 || economyStressed) &&
        current > boundsDef.floor) {
        desired = "down";
        reason = s.buildQueueBacklog === 0
            ? `No build backlog, reducing builder capacity from ${current}`
            : `Economy pressure high (${(s.avgPressure * 100).toFixed(0)}%), reducing builder capacity`;
    }
    return confirmAndBuild(param, desired, prevDirection, current, boundsDef.step, reason);
}
// ─── 趋势确认核心 ────────────────────────────────────────────
/**
 * 趋势确认逻辑（P1-1 调整置信度）。
 *
 * @param param        参数路径
 * @param desired      本次评估的期望方向
 * @param prevDirection 上次评估记录的方向
 * @param currentValue  当前参数值
 * @param step         步长
 * @param reason       调整原因（仅触发时使用）
 * @returns 参数评估结果（含可能的新调整和最新方向）
 *
 * 机制：
 *   - desired == "none" → 清除趋势，newDirection = "none"
 *   - desired != "none" 且 prevDirection == desired → 连续 2 次同方向，触发调整，newDirection 重置为 "none"
 *   - desired != "none" 且 prevDirection != desired → 首次观察，记录 newDirection = desired，不调整
 */
function confirmAndBuild(param, desired, prevDirection, currentValue, step, reason) {
    // 无调整倾向 — 清除趋势
    if (desired === "none") {
        return { newDirection: "none" };
    }
    // 连续 2 次同方向 — 触发调整，重置趋势
    if (prevDirection === desired) {
        const newValue = desired === "up"
            ? clampParam(param, currentValue + step)
            : clampParam(param, currentValue - step);
        return {
            adjustment: { param, oldValue: currentValue, newValue, reason },
            newDirection: "none", // 调整后重置，下次需重新积累 2 次确认
        };
    }
    // 首次观察 — 记录方向，不调整
    return { newDirection: desired };
}
// ─── 辅助函数 ────────────────────────────────────────────────
/** 将 TuningSignals 转为扁平 Record 供诊断记录。 */
function toSignalRecord(s) {
    return {
        avgReserveDelta: Math.round(s.avgReserveDelta),
        avgPressure: Math.round(s.avgPressure * 100) / 100,
        avgDrainScore: Math.round(s.avgDrainScore),
        crisisRatio: Math.round(s.crisisRatio * 100) / 100,
        avgStorageEnergy: Math.round(s.avgStorageEnergy),
        containerFillRatio: Math.round(s.containerFillRatio * 100) / 100,
        spawnFillRatio: Math.round(s.spawnFillRatio * 100) / 100,
        haulerCount: s.haulerCount,
        harvesterCount: s.harvesterCount,
        upgraderCount: s.upgraderCount,
        builderCount: s.builderCount,
        buildQueueBacklog: s.buildQueueBacklog,
        tierRank: s.tierRank,
        rcl: s.rcl,
    };
}

/**
 * Tuning Engine — P3 系统：基于遥测数据的参数自调优引擎。
 *
 * 职责：
 *   1. 每 500 tick 读取时序数据（economy ring buffer + CPU ring buffer）
 *   2. 读取活快照信号（container 填充率、角色计数、build queue）
 *   3. 聚合为 TuningSignals
 *   4. 调用纯函数 evaluateTuning() 产出调整决策
 *   5. 将调整写入 Memory.kernel.tuning（持久化覆盖值）
 *   6. 记录事件日志供事后追溯
 *
 * 优先级：P3 — 自调优是非关键的后台优化。
 * interval: 500 — 每 500 tick 运行一次（= 10 次 economy 采样窗口）。
 *
 * CPU 预算：正常态 ~0.1-0.2 CPU/run（ring buffer 遍历 + 聚合计算）。
 * 受 P3 budget 门禁：conserve/recovery tier 下跳过。
 *
 * 安全保证：
 *   - 数据不足（< 10 个 economy 采样点）时跳过。
 *   - 所有调整经 clampParam 安全钳制。
 *   - 每个参数有 1000 tick 冷却期防振荡。
 *   - 经济不稳定时完全锁定。
 */
/** 最少需要的 economy 采样点数，低于此数跳过评估。 */
const MIN_SAMPLES = 10;
// ─── 系统定义 ───────────────────────────────────────────────
const tuningEngineSystem = {
    name: "tuning-engine",
    priority: 3,
    interval: CONFIG.tuning.evalInterval,
    run(ctx) {
        // P3 在 conserve/recovery 下不运行。
        if (ctx.budget.tier === "conserve" || ctx.budget.tier === "recovery")
            return;
        // 确保 tuning Memory 结构存在。
        if (!Memory.kernel)
            Memory.kernel = {};
        if (!Memory.kernel.tuning) {
            Memory.kernel.tuning = { lastTuned: 0, rooms: {} };
        }
        // 快照所有房间的当前 bounds —— 评估期间使用快照，避免多房循环中
        // 房间 A 的 applyAdjustment 写入 Memory 后污染房间 B 的 getRoleBounds 读取。
        // 这是"读-写隔离"原则：评估基于 tick 开头的世界状态，调整在 tick 内缓冲。
        const snapshots = [...ctx.snapshots()];
        const roomBoundsSnapshot = new Map();
        for (const snap of snapshots) {
            const boundsMap = {};
            for (const role of ["hauler", "harvester", "upgrader", "builder"]) {
                boundsMap[role] = getRoleBounds(role, snap.roomName);
            }
            roomBoundsSnapshot.set(snap.roomName, boundsMap);
        }
        for (const snapshot of snapshots) {
            safeRunTuning(ctx, snapshot.roomName, roomBoundsSnapshot.get(snapshot.roomName));
        }
        Memory.kernel.tuning.lastTuned = ctx.tick;
    },
};
// ─── 核心逻辑 ───────────────────────────────────────────────
/**
 * 单房间调优评估（包裹在 safeRun 语义中）。
 *
 * @param ctx          Tick 上下文
 * @param roomName     被评估房间
 * @param boundsSnapshot 本 tick 开头快照的角色边界——防止多房读-写污染
 */
function safeRunTuning(ctx, roomName, boundsSnapshot) {
    try {
        // 1. 聚合信号
        const signals = aggregateSignals(ctx, roomName);
        if (!signals)
            return;
        // 2. 使用 tick 开头的 bounds 快照（而非实时 getRoleBounds）
        const boundsMap = boundsSnapshot;
        // 3. 获取当前调优状态（含上次趋势记录，用于 P1-1 趋势确认）
        const roomTuning = getOrCreateRoomTuning(roomName);
        const prevTrend = roomTuning.lastTrend ?? {};
        // 4. 调用纯函数评估（传入上次趋势，获取新趋势）
        const evaluation = evaluateTuning(signals, boundsMap, roomTuning.lastAdjusted, ctx.tick, prevTrend);
        // 5. 应用调整
        if (evaluation.adjustments.length > 0) {
            for (const adj of evaluation.adjustments) {
                applyAdjustment(roomName, adj.param, adj.newValue, ctx.tick);
                console.log(`[${ctx.tick}] tuning/${roomName}: ${adj.param} ${adj.oldValue}→${adj.newValue} (${adj.reason})`);
            }
        }
        // 6. 保存新趋势记录（P1-1：连续 2 次同方向才调整，单次只记录方向）
        roomTuning.lastTrend = evaluation.newTrend;
        // 7. 保存诊断快照（per-room，避免多房间评估时互相覆盖）
        if (!Memory.kernel.tuning.lastEval) {
            Memory.kernel.tuning.lastEval = {};
        }
        Memory.kernel.tuning.lastEval[roomName] = {
            tick: ctx.tick,
            adjustments: evaluation.adjustments.map(a => `${a.param}=${a.oldValue}→${a.newValue}`),
            signals: evaluation.signals,
            skipped: evaluation.skipped,
            trend: evaluation.newTrend,
        };
    }
    catch (error) {
        // 调优错误不得中断 tick——静默记录，下次再试。
        console.log(`[${ctx.tick}] tuning/${roomName}: error ${error.message}`);
    }
}
// ─── 信号聚合 ───────────────────────────────────────────────
/**
 * 从时序数据和活快照聚合 TuningSignals。
 * 返回 null 表示数据不足，调用方应跳过评估。
 */
function aggregateSignals(ctx, roomName) {
    const cpuSeg = readCpuSegment();
    const econSeg = readEconomySegment();
    // ── 经济趋势信号（从 economy ring buffer）──
    const allEconomy = ringToArray(econSeg.economy);
    const roomEconomy = allEconomy.filter(s => s.r === roomName);
    const recentEconomy = roomEconomy.slice(-20);
    if (recentEconomy.length < MIN_SAMPLES)
        return null;
    const avgReserveDelta = avg(recentEconomy.map(s => s.d));
    const avgPressure = avg(recentEconomy.map(s => s.p / 100));
    const avgDrainScore = avg(recentEconomy.map(s => s.ds));
    const crisisRatio = recentEconomy.filter(s => s.ph === 2 || s.ph === 3).length / recentEconomy.length;
    const avgStorageEnergy = avg(recentEconomy.map(s => s.se));
    // 消费端饱和度：spawn+extension 平均填充率。
    // 从 EconomySample.ea/ec 计算，反映评估窗口内的趋势而非瞬时值。
    // ec 为 0（无 spawn）的采样点跳过，避免除零。
    const fillSamples = recentEconomy.filter(s => s.ec > 0);
    const avgSpawnFillRatio = fillSamples.length > 0
        ? avg(fillSamples.map(s => s.ea / s.ec))
        : 0;
    // ── CPU 信号（从 CPU ring buffer，全局）──
    const cpuSamples = ringToArray(cpuSeg.cpu);
    const recentCpu = cpuSamples.slice(-20);
    const tierRank = recentCpu.length > 0
        ? Math.round(avg(recentCpu.map(s => s.ti)))
        : 0;
    // ── 活快照信号 ──
    const snapshot = ctx.getSnapshot(roomName);
    if (!snapshot)
        return null;
    // container 填充率
    let containerFillRatio = 0;
    if (snapshot.containers.length > 0) {
        let totalFill = 0;
        for (const c of snapshot.containers) {
            const cap = c.store.getCapacity(RESOURCE_ENERGY) || 1;
            totalFill += c.store.getUsedCapacity(RESOURCE_ENERGY) / cap;
        }
        containerFillRatio = totalFill / snapshot.containers.length;
    }
    // 角色计数（从 Game.creeps）
    const counts = countRolesByHome(roomName);
    // build queue backlog
    const roomMem = Memory.rooms[roomName];
    const buildQueueBacklog = roomMem?.buildQueue
        ? roomMem.buildQueue.filter(t => t.state === "queued").length
        : 0;
    return {
        avgReserveDelta,
        avgPressure,
        avgDrainScore,
        crisisRatio,
        avgStorageEnergy,
        containerFillRatio,
        spawnFillRatio: avgSpawnFillRatio,
        haulerCount: counts.hauler ?? 0,
        harvesterCount: counts.harvester ?? 0,
        upgraderCount: counts.upgrader ?? 0,
        builderCount: counts.builder ?? 0,
        buildQueueBacklog,
        tierRank,
        rcl: snapshot.rcl,
    };
}
// ─── 调整应用 ───────────────────────────────────────────────
/** 将调整写入 Memory.kernel.tuning。 */
function applyAdjustment(roomName, param, newValue, tick) {
    const roomTuning = getOrCreateRoomTuning(roomName);
    // param 格式: "role.field"，如 "hauler.maxCount"
    const [role, field] = parseParam(param);
    if (!role || !field)
        return;
    if (!roomTuning.roleBounds[role]) {
        roomTuning.roleBounds[role] = {};
    }
    if (field === "maxCount") {
        roomTuning.roleBounds[role].maxCount = newValue;
    }
    else if (field === "minCount") {
        roomTuning.roleBounds[role].minCount = newValue;
    }
    roomTuning.lastAdjusted[param] = tick;
}
/** 获取或创建房间的调优状态。 */
function getOrCreateRoomTuning(roomName) {
    if (!Memory.kernel)
        Memory.kernel = {};
    if (!Memory.kernel.tuning) {
        Memory.kernel.tuning = { lastTuned: 0, rooms: {} };
    }
    if (!Memory.kernel.tuning.rooms[roomName]) {
        Memory.kernel.tuning.rooms[roomName] = {
            roleBounds: {},
            lastAdjusted: {},
        };
    }
    return Memory.kernel.tuning.rooms[roomName];
}
// ─── 辅助函数 ───────────────────────────────────────────────
/** 数组平均值。 */
function avg(values) {
    if (values.length === 0)
        return 0;
    let sum = 0;
    for (const v of values)
        sum += v;
    return sum / values.length;
}
/** 统计指定 home 房间各角色的存活 creep 数。 */
function countRolesByHome(roomName) {
    const counts = {};
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (!creep)
            continue;
        if ((creep.memory.home ?? creep.room.name) !== roomName)
            continue;
        const role = creep.memory.role ?? "unknown";
        counts[role] = (counts[role] ?? 0) + 1;
    }
    return counts;
}
/** 解析参数路径 "hauler.maxCount" → ["hauler", "maxCount"]。 */
function parseParam(param) {
    const idx = param.indexOf(".");
    if (idx === -1)
        return [undefined, undefined];
    return [param.slice(0, idx), param.slice(idx + 1)];
}

/**
 * Tower 目标选择 — 纯函数（P1-3）。
 *
 * 背景：旧实现用 findClosestByRange 只打最近目标，不识别治疗奶妈、不集火、
 * 也不考虑塔伤随距离衰减，容易被带 HEAL 的单位奶穿而空耗能量。
 *
 * 选择原则（全塔集火同一目标）：
 *   ① 带 HEAL 的奶妈优先 —— 先点掉治疗源，避免拉锯耗空；
 *   ② 有效血量（hits + 自愈缓冲估算）最低者优先 —— 优先击杀最脆单位换取减员；
 *   ③ 距塔近者优先 —— 塔伤随距离衰减（≤5 满伤，≥20 最低），近处收益最大。
 *
 * 纯函数、无副作用；系统层负责收集摘要并在异常时回退到 findClosestByRange。
 */
/** 单个 HEAL 部件每 tick 的自愈量（引擎常量 HEAL_POWER）。 */
const HEAL_POWER$1 = 12;
/**
 * 自愈缓冲 tick 数：把「几 tick 的自愈量」折算进有效血量，
 * 使带 HEAL 的单位有效血量更高、优先级排序更贴近实战（越难打的越该先集火其治疗源）。
 */
const HEAL_BUFFER_TICKS = 5;
/**
 * 从威胁摘要中选出全塔集火的目标 ID。
 *
 * @returns 目标 creep 的 id；无威胁时返回 undefined。
 */
function selectTowerTarget(threats) {
    if (threats.length === 0)
        return undefined;
    let best;
    for (const t of threats) {
        if (best === undefined || isBetterTarget(t, best)) {
            best = t;
        }
    }
    return best?.id;
}
/** 估算有效血量：当前血量 + 自愈能力缓冲（奶妈更"耐打"，有效血量更高）。 */
function effectiveHp(t) {
    return t.hits + t.healParts * HEAL_POWER$1 * HEAL_BUFFER_TICKS;
}
/** a 是否比 b 更应被优先集火。 */
function isBetterTarget(a, b) {
    // ① 奶妈优先：带 HEAL 的排在无 HEAL 之前。
    const aHeals = a.healParts > 0;
    const bHeals = b.healParts > 0;
    if (aHeals !== bHeals)
        return aHeals;
    // ② 有效血量最低优先（最脆先杀）。
    const aHp = effectiveHp(a);
    const bHp = effectiveHp(b);
    if (aHp !== bHp)
        return aHp < bHp;
    // ③ 距塔近者优先（塔伤随距离衰减，近处收益最大）。
    return a.rangeToTower < b.rangeToTower;
}

/**
 * Tower 交战盈亏判定 — 纯函数。
 *
 * 背景：塔只要看到威胁就全弹开火的策略存在经济漏洞——
 * 塔伤随距离衰减（≤5 格满伤 600，≥20 格仅 150），而带足量 HEAL 的编队
 * 可以站在远距把伤害全部奶回去，让塔白白倾泻能量（heal-tank 骗塔战术）。
 * 官方防御文档明示：「well-secured team … withstand the attack by multiple
 * towers at point-blank range」——不算账就开火等于给对手送能量。
 *
 * 判定原则（战争即经济）：
 *   开火当且仅当「全塔对焦点目标的合计净伤 > 敌方编队的合计治疗量」，
 *   即每发炮弹都在真实削减敌方血量，而不是喂给对方的 HEAL。
 *   打不动时保留塔能量（蓄能等敌方近身/减员），例外：
 *   敌人已突入核心区（强制交战半径内）——此时结构损失比能量损失更贵，照打。
 *
 * 治疗估算取防守方悲观假设：敌方所有 HEAL 部件都以满效率（12/部件）
 * 治疗被集火目标。不计 boost 倍率——boost 编队的识别属于情报层职责。
 *
 * 引擎常量 [Facts: docs.screeps.com/api 常量表]：
 *   TOWER_POWER_ATTACK=600, TOWER_OPTIMAL_RANGE=5,
 *   TOWER_FALLOFF_RANGE=20, TOWER_FALLOFF=0.75, HEAL_POWER=12。
 */
/** 塔满伤（range ≤ TOWER_OPTIMAL_RANGE）。 */
const TOWER_POWER_ATTACK = 600;
/** 满伤距离上限。 */
const TOWER_OPTIMAL_RANGE = 5;
/** 衰减终点距离（≥ 此距离伤害不再下降）。 */
const TOWER_FALLOFF_RANGE = 20;
/** 最大衰减比例（衰减终点伤害 = 满伤 × (1 - FALLOFF)）。 */
const TOWER_FALLOFF = 0.75;
/** 单 HEAL 部件近身治疗量。 */
const HEAL_POWER = 12;
/**
 * 单塔对指定距离目标的期望伤害：
 * range ≤ 5 → 600；range ≥ 20 → 150；之间线性衰减。
 */
function towerDamageAt(range) {
    if (range <= TOWER_OPTIMAL_RANGE)
        return TOWER_POWER_ATTACK;
    const effectiveRange = Math.min(range, TOWER_FALLOFF_RANGE);
    const falloffProgress = (effectiveRange - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
    return Math.floor(TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF * falloffProgress));
}
/**
 * 判定全塔集火是否有净收益。
 *
 * - 合计伤害 > 编队合计治疗 → 开火（每发都在真实掉血）。
 * - 打不动且敌人未突破核心 → 停火蓄能，等敌方近身（伤害上升）或撤退。
 * - 敌人突入核心区 → 无条件开火：结构被拆的损失恒大于塔能量，
 *   且近身处塔伤接近满值，通常也已越过盈亏线。
 */
function assessEngagement(towers, squad) {
    let expectedDamage = 0;
    for (const t of towers) {
        if (t.energy < 10)
            continue; // 单次攻击耗 10 能量，不足者不计入火力。
        expectedDamage += towerDamageAt(t.rangeToTarget);
    }
    const expectedHeal = squad.totalHealParts * HEAL_POWER;
    const engage = squad.breachingCore || expectedDamage > expectedHeal;
    return { engage, expectedDamage, expectedHeal };
}

/**
 * Tower 防御系统 — P0 系统，负责所有 Tower 操作和安全模式。
 *
 * 职责：
 *   - 检测敌对 creep 并调度 Tower 攻击（三塔协同同一目标）
 *   - 无敌人时执行紧急维修（关键结构低于 50% 血量）
 *   - 无紧急维修时维护 wall/rampart 到 RCL 分级目标血量
 *   - 无 Tower 且有敌人时激活安全模式
 *
 * 优先级：P0（防御是生存关键 — 永不被冷却）。
 */
const towerDefenseSystem = {
    name: "tower-defense",
    priority: 0,
    run(ctx) {
        for (const snapshot of ctx.snapshots()) {
            if (snapshot.towers.length === 0) {
                // 无 Tower — 收紧 safe mode：仅当威胁 creep 靠近核心区（spawn，无 spawn 时退到 controller）
                // 至 safeModeTriggerRange 内才激活，避免无害过境 scout 误烧珍贵的 safe mode。
                if (snapshot.threatCreeps.length > 0 && isCoreBreached(snapshot)) {
                    tryActivateSafeMode(snapshot);
                }
                continue;
            }
            // 有 Tower — G-DF-06：攻击敌人 > 紧急维修 > wall/rampart 维护。
            if (snapshot.threatCreeps.length > 0) {
                // 所有 tower 集火同一目标 —— 奶妈优先、最脆优先、近距优先。
                const firstTower = snapshot.towers.find(t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
                const breachingCore = isCoreBreached(snapshot);
                let fired = false;
                if (firstTower) {
                    const target = selectFocusTarget(firstTower, snapshot.threatCreeps);
                    if (target) {
                        // 交战盈亏判定：全塔合计伤害（含距离衰减）必须超过敌方编队
                        // 合计治疗量才开火，否则每发炮弹都被 HEAL 奶回、白耗能量
                        // （heal-tank 骗塔战术）。敌人突入核心区时无条件开火。
                        const towerSummaries = snapshot.towers.map(t => ({
                            energy: t.store.getUsedCapacity(RESOURCE_ENERGY),
                            rangeToTarget: t.pos.getRangeTo(target.pos),
                        }));
                        const totalHealParts = snapshot.threatCreeps.reduce((sum, c) => sum + c.body.filter(p => p.type === HEAL).length, 0);
                        const decision = assessEngagement(towerSummaries, {
                            totalHealParts,
                            breachingCore,
                        });
                        if (decision.engage) {
                            for (const tower of snapshot.towers) {
                                if (tower.store.getUsedCapacity(RESOURCE_ENERGY) === 0)
                                    continue;
                                tower.attack(target);
                                fired = true;
                            }
                        }
                    }
                }
                // 最后防线：敌人已突入核心区，但所有塔打不出火力
                //（能量耗尽 / 被奶穿打不动）— 塔防线事实失效，激活 safe mode。
                // 官方定位 safe mode 为「defense tactic of last resort」，
                // 此前它只在「无塔」分支触发，塔被打空时反而没有兜底。
                if (!fired && breachingCore) {
                    tryActivateSafeMode(snapshot);
                }
                continue;
            }
            // 无敌人 — 维修逻辑。
            // A3/B3：维修权移交 creep —— 塔修 1 次 10 能量且有距离衰减，creep 修是
            // 1 energy/100 hits/WORK。本房存在 builder/worker 时塔只保留开火职责，
            // 省下的能量是真实的防御弹药；无维修 creep 时保留塔修作为灾后安全网。
            if (hasRepairCreep(snapshot.roomName)) {
                continue;
            }
            // G-DF-08：wall/rampart 目标血量按角色分层 + RCL 分级；受袭姿态升档。
            const roomMemForSiege = Memory.rooms[snapshot.roomName];
            const underSiege = roomMemForSiege?.lastHostileAt !== undefined &&
                Game.time - roomMemForSiege.lastHostileAt < CONFIG.defense.siegeMemoryTicks;
            // 分层分类上下文（与 repairFortifications 同口径）：
            // 周界全额 / 核心折扣 / container 仅地板 — 塔安全网不为低值盾浪费弹药。
            const fortCtx = buildFortificationContext(snapshot, roomMemForSiege?.minCut?.positions);
            // 预选 wall/rampart 维护目标（所有 tower 共用，避免重复查找）。
            let wallRepairTarget = findWallRepairTarget(snapshot, snapshot.rcl, underSiege, fortCtx);
            // 关键维修目标预计算值，提升到 tower 循环外避免重复调用。
            const repairTarget = snapshot.criticalRepairTarget ?? findCriticalRepair(snapshot);
            // 房间状态门禁：wall 维护只在经济平稳时执行。
            // recovery/bootstrap 期间保留 tower 能量应对突发，不浪费在墙上。
            const roomMem = Memory.rooms[snapshot.roomName];
            const colonyState = roomMem?.colonyState ?? "normal";
            const wallMaintenanceAllowed = colonyState === "normal";
            for (const tower of snapshot.towers) {
                // G-DF-07：能量 < 50 时不维修（保留攻击能量）；能量 = 0 时跳过。
                if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 50)
                    continue;
                // R3-07：维修优先级 spawn/extension → tower → container → wall/rampart。
                if (repairTarget) {
                    tower.repair(repairTarget);
                    continue;
                }
                // G-DF-08：wall/rampart 维护（最低优先级）。
                // 门禁：colonyState 必须 normal + tower 能量 > 70%（保留应急储备）。
                if (wallRepairTarget && wallMaintenanceAllowed) {
                    const towerEnergyRatio = tower.store.getUsedCapacity(RESOURCE_ENERGY) / tower.store.getCapacity(RESOURCE_ENERGY);
                    if (towerEnergyRatio > 0.7) {
                        tower.repair(wallRepairTarget);
                    }
                }
            }
        }
    },
};
/**
 * 本房是否存在可承担维修的 creep（builder 或 worker）。
 * A3：存在时塔让出全部非战斗维修，只保留开火职责。
 * P1-3：从 Kernel.buildSnapshots 预构建的 globalCache.repairRooms 读取，
 * 不再独立全量扫描 Game.creeps。
 */
function hasRepairCreep(roomName) {
    return globalCache().repairRooms?.has(roomName) === true;
}
/**
 * 为全塔集火选择目标（P1-3）。
 * 用纯函数 selectTowerTarget 按「奶妈优先 / 最脆优先 / 近距优先」排序；
 * 异常或选不出时回退到 findClosestByRange，保证防御不因选择逻辑失效而停火。
 */
function selectFocusTarget(referenceTower, threats) {
    const summaries = threats.map(c => ({
        id: c.id,
        healParts: c.body.filter(p => p.type === HEAL).length,
        hits: c.hits,
        hitsMax: c.hitsMax,
        rangeToTower: referenceTower.pos.getRangeTo(c.pos),
    }));
    const targetId = selectTowerTarget(summaries);
    const target = targetId ? Game.getObjectById(targetId) : undefined;
    // 回退：目标已消失或无法解析时退回最近目标。
    return target ?? referenceTower.pos.findClosestByRange(threats) ?? undefined;
}
/**
 * 核心区是否被威胁 creep 突破（无塔时的 safe mode 触发判据）。
 * 任一威胁 creep 距 spawn（无 spawn 时退到 controller）range <= safeModeTriggerRange 即视为突破。
 * 避免仅因房间边缘出现威胁就误烧 safe mode。
 */
function isCoreBreached(snapshot) {
    const anchor = snapshot.spawns[0] ?? snapshot.controller;
    if (!anchor)
        return true; // 既无 spawn 也无 controller — 无参考点，保守视为突破。
    const range = CONFIG.defense.safeModeTriggerRange;
    return snapshot.threatCreeps.some(c => c.pos.getRangeTo(anchor.pos) <= range);
}
/**
 * 激活 safe mode（带完整前置校验）。
 * 触发场景：① 无塔且核心被突破；② 有塔但全部打不出火力且核心被突破。
 * safe mode 是最后防线 — 校验 controller 归属 / 未激活 / 无冷却 / 有可用次数。
 */
function tryActivateSafeMode(snapshot) {
    const controller = snapshot.controller;
    if (controller?.my &&
        !controller.safeMode &&
        !controller.safeModeCooldown &&
        controller.safeModeAvailable > 0) {
        controller.activateSafeMode();
    }
}
/**
 * 找到需要维修的 wall/rampart（血量低于自身档位目标值）。
 * 选择血量最低的优先维修，避免一个 wall 满了其他还没修。
 * 约束 G-DF-08：目标血量按角色分层（perimeter/core/utility）+ RCL 分级。
 */
function findWallRepairTarget(snapshot, rcl, underSiege, fortCtx) {
    let best;
    let bestHits = Infinity;
    for (const wall of snapshot.walls) {
        const target = getWallTargetHits(rcl, underSiege, classifyFortification(wall.pos.x, wall.pos.y, true, fortCtx));
        if (wall.hits < target && wall.hits < bestHits) {
            bestHits = wall.hits;
            best = wall;
        }
    }
    for (const rampart of snapshot.ramparts) {
        const target = getWallTargetHits(rcl, underSiege, classifyFortification(rampart.pos.x, rampart.pos.y, false, fortCtx));
        if (rampart.hits < target && rampart.hits < bestHits) {
            bestHits = rampart.hits;
            best = rampart;
        }
    }
    return best;
}

/**
 * Bootstrap — 唯一组合根。
 * 新增系统或角色只需修改此文件并添加对应模块，无需修改 Kernel。
 *
 * 系统注册顺序（同优先级内按注册顺序执行）：
 *   P0: room-state → spawn-manager → tower-defense
 *   P1: assignment-service（任务列表生成 + 紧急抢占）→ link-system（link 能量瞬移）→ lab-system（lab 反应 + boost）
 *   P2: construction-manager → remote-mining-manager（远矿目标评估 + spawn 请求）
 *   P3: layout-planner → defense-planner → room-observer → pixel-generator → telemetry-collector → tuning-engine
 *
 * 角色优先级：
 *   P0: worker（启动期/灾后恢复）
 *   P1: harvester, hauler, distributor, remoteHarvester, remoteHauler（能量链）
 *   P2: upgrader, builder, reserver（发展 + 远矿占领）
 *
 * 注意：room-state 必须在 spawn-manager 之前运行 —
 *   它每 tick 计算每房 ColonyState 并写入 RoomMemory，供所有后续系统消费。
 *   assignment-service 设为 P1 而非 P0 —
 *   失败时角色回退到无 assignment 行为，避免 P0 永不冷却刷屏。
 *   worker(P0) 可能在第一 tick 早于 assignment 运行，回退行为正确。
 */
const registry = new Registry()
    // P0：房间状态（每房 ColonyState + downgradeRisk，必须在所有其他系统之前运行）
    .registerSystem(roomStateSystem)
    // P0：孵化管理（紧急恢复、队列处理）
    .registerSystem(spawnManagerSystem)
    // P0：塔防（攻击、维修、安全模式）
    .registerSystem(towerDefenseSystem)
    // P1：帝国姿态（Strategy 层 — 在所有战术消费者之前裁决扩张/收缩/备战）
    .registerSystem(empireStrategySystem)
    // P1：任务分配（生成任务列表 + 紧急抢占，在 P1 角色之前运行）
    .registerSystem(assignmentServiceSystem)
    // P1：link 能量传输（source→controller/storage 瞬移，替代 hauler 往返）
    .registerSystem(linkSystem)
    // P1：lab 反应 + boost（化合物生产、creep 强化）
    .registerSystem(labSystem)
    // P2：建造（消费 BuildQueue，受 site 限流）
    .registerSystem(constructionManagerSystem)
    // P2：远矿管理（每 10 tick 评估目标 + 生成远矿 spawn 请求）
    .registerSystem(remoteMiningManagerSystem)
    // P3：布局规划（低频生成 BuildTask 推入 BuildQueue）
    .registerSystem(layoutPlannerSystem)
    // P3：防御规划（rampart/wall 生成，独立于核心布局）
    .registerSystem(defensePlannerSystem)
    // P3：房间观察（低频策略）
    .registerSystem(roomObserverSystem)
    // P3：pixel 生成（bucket 满载时生成 pixel）
    .registerSystem(pixelSystem)
    // P3：terminal 市场贸易（卖盈余矿物换 credits → 买缺口原料喂反应链）
    .registerSystem(terminalManagerSystem)
    // P3：factory/powerSpawn 最小运营（满仓能量压缩 battery + GPL 涓流）
    .registerSystem(factoryManagerSystem)
    // P3：扩张管理（GCL 有余量时 claim 新房 + 拓荒编队投送）
    .registerSystem(expansionManagerSystem)
    // P3：遥测采集（时序数据 + 事件日志 + 运行时摘要，低频采样）
    .registerSystem(telemetryCollectorSystem)
    // P3：参数自调优（每 500 tick 读取遥测 → 调整角色边界覆盖值）
    .registerSystem(tuningEngineSystem)
    // P0：恢复 worker（启动期 / 灾后）
    .registerRole(workerRole)
    // P1：defender（本房防御响应 — 房内出现威胁时孵化，与塔协同）
    .registerRole(defenderRole)
    // P1：harvester 和 hauler（能量链）
    .registerRole(harvesterRole)
    .registerRole(haulerRole)
    // P1：distributor（storage → sink 分发，RCL4+）
    .registerRole(distributorRole)
    // P1：远矿角色（远矿采集 + 穿梭搬运）
    .registerRole(remoteHarvesterRole)
    .registerRole(remoteHaulerRole)
    // P2：upgrader 和 builder（发展）
    .registerRole(upgraderRole)
    .registerRole(builderRole)
    // P2：reserver（远矿 controller 占领）
    .registerRole(reserverRole)
    // P2：claimer（扩张占领新房 controller）
    .registerRole(claimerRole)
    // P1：remoteDefender（远矿防御者，杀 NPC reserver/Invader）
    .registerRole(remoteDefenderRole);
const kernel = new Kernel(registry);

const loop = () => kernel.run();

exports.loop = loop;
//# sourceMappingURL=main.js.map
