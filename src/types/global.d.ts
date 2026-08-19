import type { CreepMode, ColonyState, TaskKind, CpuTier } from "../kernel/contracts";
import type { ColonyPhase } from "../domain/economy/phase";
import type { RoomTuningState } from "../domain/tuning/types";

export {};

declare global {
  interface CreepAssignment {
    id: string;
    kind: TaskKind;
    targetId?: Id<_HasId>;
    sourceId?: Id<Source>;
    revision: number;
    assignedAt: number;
    leaseUntil: number;
  }

  interface CreepMemory {
    /** 注册的角色名。绝不从 creep 名推断角色。 */
    role: string;
    /** 用于归属和路由决策的 home 房间。 */
    home?: string;
    /** 行为模式 — 所有角色共享的有限状态。 */
    mode?: CreepMode;
    /** 稳定工作目标 id；目标不存在时清除。用于 build site 持久化。 */
    targetId?: Id<_HasId>;
    /** fillTarget 持久化 — 避免每 tick 在多个等距目标间摇摆。 */
    fillTargetId?: Id<_HasId>;
    /** repair 目标持久化 — 避免每 tick 在多个衰减 container 间摇摆。 */
    repairTargetId?: Id<_HasId>;
    /** 危路急救锁定目标 — 与 repairTargetId 分离，防共享缓存被常规修路写入后急救越过更紧急修复。 */
    urgentRoadId?: Id<_HasId>;
    /** harvester/miner 绑定的 source。 */
    sourceId?: Id<Source>;
    /** remote-harvester 缓存的 source 旁 container ID（避免每 tick lookForAtArea）。 */
    sourceContainerId?: Id<_HasId>;
    /**
     * 远矿 container 建 site 失败冷却到期 tick（RM-1，P0-A 收编后由 remote-mining-manager 写入）—
     * 持久失败时放行 dropEnergy；只阻断 create 路径，不阻断 build。
     */
    containerSiteCooldown?: number;
    /**
     * RM-1/P0-A：远矿 harvester 满载且无 container 时申请建 site 的标记 —
     * creep 写入，remote-mining-manager 消费后清除（成功或写冷却）。申请期间走 dropEnergy 释放产能。
     */
    needContainer?: boolean;
    /** 压缩的上次位置（x * 50 + y）用于卡位检测。 */
    lastPos?: number;
    /** 连续未移动的 tick 数。 */
    stuckTicks?: number;
    /**
     * P1-E 档 2：上次 PathFinder.search 重寻路 tick（plan.md §5.7.5）。
     * 两次重寻路间隔 ≥ dynamicRepathInterval，冷却内沿旧路径走一步；
     * absent=0 → 冷却不生效（与改造前一致）。per-creep 运行时状态，无需迁移。
     */
    lastRepathAt?: number;
    /**
     * v33-R11：remoteHarvester 上次改绑 source 的 tick（改绑自愈冷却）—
     * 防止「改绑到空缺源 → 原源变空缺 → 改回去」的振荡。
     * per-creep 运行时状态，无需迁移（同 lastRepathAt 先例）。
     */
    lastRebindAt?: number;
    /** 当前紧凑任务分配。 */
    assignment?: CreepAssignment;
    /** 用于稳定孵化 key 生成和替换跟踪的索引。 */
    spawnIndex?: number;
    /** B1：标记为待回收 — spawn-manager 引导其走向最近 spawn 并 recycleCreep。 */
    recycle?: boolean;
    /**
     * 远程角色目标房 — 远矿/扩张时的工作房间。ensureHome 按 mode+role 决定导航：
     * remoteHauler work→home、acquire→remoteTarget；remoteHarvester/reserver 恒 remoteTarget。
     */
    remoteTarget?: string;
    /**
     * 已知 hostile 房集合（owner≠我 / 带遗迹 spawn）— 供 moveTowardRoom 跨房路由绕行
     * （recon scout 专用，R6b 扩张修复：scout 钻进敌方房会被迫 flee 永远到不了 remoteTarget）。
     * 仅作导航安全网；真正路线优选由 prospect 评分惩罚（hostileAdjacent）在源头完成。
     */
    avoidRooms?: string[];
    /** remoteHauler 缓存的远矿 containerId — 避免每 tick room.find。 */
    remoteContainerId?: Id<StructureContainer>;
    /** Distributor 水位分级档位（0-3），由 distributor gate 每 tick 按 storage 水位计算。 */
    distributorTier?: 0 | 1 | 2 | 3;
    /**
     * 任务标记（PB 野采链，审计缺口 2）："powerBank"（战斗编队，attacker/healer
     * 分流：不集结直接推进 + 专用 PB 攻击候选）/"powerCollect"（collector 捡运）。
     * undefined = 常规角色（war 编队走 warPlan 相位机）。
     */
    mission?: "powerBank" | "powerCollect";
  }

  interface SpawnRequest {
    key: string;
    role: string;
    home: string;
    priority: 0 | 1 | 2 | 3 | 4;
    body: BodyPartConstant[];
    memory: CreepMemory;
    createdAt: number;
    expiresAt?: number;
    replaceBy?: number;
    retries: number;
  }

  interface BuildTask {
    key: string;
    pos: { x: number; y: number; roomName: string };
    structureType: BuildableStructureConstant;
    priority: 0 | 1 | 2 | 3;
    state: "queued" | "site" | "done" | "blocked";
    attempts: number;
    retryAt: number;
    assignedTo?: string;
    leaseUntil?: number;
    /** 此任务允许的最大同时工作 creep 数。 */
    maxWorkers?: number;
  }

  interface RoomMemory {
    colonyState?: ColonyState;
    /**
     * 经济压力梯度信号（0.0–1.0，从 drainScore 派生）：demand/construction/tower
     * 用它做梯度缩放，替代二值 crisis/normal 开关。
     */
    economyPressure?: number;
    controllerDowngradeRisk?: boolean;
    /**
     * 脆弱新房护栏标记（claim-secure，v-next，room-state 每 tick 写入）：
     * RCL<4 且 controller 临近降级时为 true，供 construction-manager 抑制非必要建造、
     * upgrader 放宽取能地板，集中能量保住 controller（新房无 storage 缓冲）。
     */
    claimSecure?: boolean;
    /**
     * 上一 tick 是否紧急（P1-2 边沿触发）：assignment-service 仅在
     * 「正常 → 紧急」上升沿失效任务，持续紧急不重复失效（防抖动）。
     */
    wasEmergency?: boolean;
    /**
     * 上次任务抢占 tick（TD-018 冷却）：两次抢占至少间隔 20 tick，
     * 防紧急/正常快速交替时每个上升沿都 invalidate assignment。
     */
    lastPreemptTick?: number;
    /**
     * 最近一次房内出现威胁 creep 的 tick（v12+，room-state 写入）— 受袭记忆，
     * 驱动防御姿态（如 wall/rampart 目标血量升档）。P1-3：仅在威胁新增
     * （count 增加）时刷新，防旧威胁停留时永不过期。
     */
    lastHostileAt?: number;
    /** P1-3：上一 tick 的威胁 creep 数量，用于检测新增威胁（count 增加）。
     * room-state 每 tick 写入，缺失时按 0 处理（首威胁即新增）。 */
    prevThreatCount?: number;
    /**
     * 无害侦察观测（v32+，R7c，room-state 写入）：最近一次「有敌对但无威胁
     * 部件」（侦察兵）目击 tick 与累计目击次数 — 盯防信号，与 lastHostileAt
     * 威胁记忆刻意分开（不触发防御，纯情报）。
     */
    lastObserverAt?: number;
    observerSightings?: number;
    /** 殖民相位观测（约束层的「经济真相」）。 */
    phase?: {
      phase: ColonyPhase;
      reserve: number;
      reserveDelta: number;
      drainScore: number;
      /** 流动性危机分数 (0-100)，方案 C：检测能量冻在 container 的物流死锁。 */
      liquidityScore: number;
      /** 危机带（crisis/recovery）驻留评估次数（v14+，最短驻留防极限环）。 */
      bandTicks?: number;
      /**
       * P0-1：srcRatio 满载 + storage 累积流失双条件持续成立的评估次数；
       * 任一条件不满足立即归零，达 srcStallEnterTicks 后强制 crisis。
       */
      srcStallTicks?: number;
      /**
       * P0-1：上一 tick storage 能量，用于跨 tick 算 storageDrainRate；
       * 无 storage/首次运行时 undefined（drainRate=0，不触发 srcRatio 通道）。
       */
      storageEnergyPrev?: number;
      /**
       * P0-1：srcRatio>0.9 期间 storage 累积净流失（E，正值=失血）。
       * 流失累加、回填抵消（max(0)）；超 storageDrainAccumThreshold(1000) 触发 srcStalled。
       */
      storageDrainAccum?: number;
      harvesterCount: number;
      sourceCount: number;
      rcl: number;
    };
    /**
     * Storage 能量超 storageFullThreshold 时为 true（room-state 每 tick 算），
     * 供 spawn-manager 限采 + demand 加速消费。
     */
    storageNearFull?: boolean;
    spawnQueue?: SpawnRequest[];
    /**
     * 孵化请求黑名单（SP-2）：key → 冷却到期 tick。重试上限清除的请求在冷却期内
     * 不得重建，打破「删除 → 重建 → 再删」的翻炒循环。
     */
    spawnBlacklist?: Record<string, number>;
    /**
     * P0-3：spawn churn 熔断 — 角色 → 熔断到期 tick。200 tick 滑窗内同 role
     * churn > 20 次则冻结孵化 100 tick；spawn-manager 写、demand 读、到期自清理。
     */
    churnFreezeUntil?: Record<string, number>;
    buildQueue?: BuildTask[];
    lastRcl?: number;
    /** C2：邻居房情报（room-observer 每 50 tick 刷新，M7 远矿/扩张选址数据源）。 */
    intel?: Record<string, import("../domain/intel").RoomIntel>;
    layout?: {
      version: number;
      templateId: string;
      state: "proposed" | "accepted" | "building" | "blocked" | "manual";
      /** 锚点的 packed 位置（x * 50 + y）。 */
      anchor?: number;
      /** 锚点质量分（candidate-score 评估，越高越好）。诊断用 + 未来多房间选址参考。 */
      anchorScore?: number;
      revision: number;
      nextPlanTick: number;
      /**
       * P1-F：4-stage 规划分片状态（v17+）：0 空闲 / 1-3 各 stage 待跑。
       * 跨 tick 中间产物放 globalCache（大对象不进 Memory）；reset 丢 data 时重置 0 重来。
       */
      planStage?: 0 | 1 | 2 | 3;
      /**
       * 目标清单缺口的下一次强制规划 tick（v21+，layout-planner 写）：缺口 > 0 时
       * gap-force 触发；放置失败设 tick+500 慢速重试；缺失视为 0（允许立即 gap-force）。
       */
      nextGapPlanTick?: number;
      // 冷数据 overrides / blocked 已迁移到 RawMemory segment 0（kernel/segment-store.ts）—
      // 以下字段仅 v3→v4 迁移期存在。
      /** @deprecated 已迁移到 segment，仅迁移期间存在。 */
      overrides?: Record<string, number>;
      /** @deprecated 已迁移到 segment，仅迁移期间存在。 */
      blocked?: Record<string, { code: number; retryAt: number }>;
    };
    /** min-cut 防御规划结果持久化（跨 Global Reset 存活）。 */
    minCut?: {
      /** 核心结构签名（检测是否需要重算）。 */
      sig: string;
      /** 扁平化 rampart 位置 [x1, y1, x2, y2, ...]。 */
      positions: number[];
      /** min-cut 是否完成。 */
      complete: boolean;
    };
    /** Builder pressure 迟滞状态（TD-016）：进入收缩 pressure > 0.35，退出 ≤ 0.25，带内保持不变。 */
    builderPressureState?: 'full' | 'shrinking';
    /**
     * Distributor 扩编需求首次出现 tick：需求持续超 distributorScaleUpDelay
     * 才允许扩编，回落即清除 — 防 fillTargets 尖峰催生过量 distributor。
     */
    distScaleUpSince?: number;
    /**
     * 远矿运营 — 从本房管理的远程采矿操作，key = 目标房名。
     * 由 remote-mining-manager 每 10 tick 评估/更新。
     */
    remoteOps?: Record<string, RemoteOp>;
  }

  interface KernelMemory {
    tier?: CpuTier;
    recoveryTicks?: number;
    skipReasons?: Record<string, number>;
    /**
     * 最近一次 generatePixel 的 tick（自愿放血协议）：宽限窗口内 scheduler 把
     * tier 地板抬到 conserve，防看门狗把自愿放血误判为 CPU 失控进 recovery。
     */
    pixelAt?: number;
    /** 运行时摘要 — 每 10 tick 更新，供控制台快速诊断。 */
    stats?: {
      /** 上次采样 tick。 */
      lastSample: number;
      /** 最近 10 采样点平均 CPU。 */
      cpuAvg10: number;
      /** 最近 10 采样点峰值 CPU。 */
      cpuMax10: number;
      /** 最近 10 采样点最低 bucket。 */
      bucketMin10: number;
      /** 累计进入 crisis 的次数。 */
      crisisCount: number;
      /** 累计 tier 转换次数。 */
      tierTransitions: number;
      /** 最频繁出错的 label。 */
      errorHotspot: string;
      /** 最频繁的 skip 原因。 */
      skipHotspot: string;
    };
    /** 参数自调优状态（v7+）。tuning-engine 每 500 tick 更新。 */
    tuning?: TuningMemory;
    /**
     * 当前扩张行动（v11+，同一时刻至多一个）：expansion-manager 状态机
     * claiming（claimer 在途）→ pioneering（拓荒编队建 spawn）。
     */
    expansion?: {
      state: "claiming" | "pioneering";
      /** 扩张目标房名。 */
      target: string;
      /** 孵化 claimer 与拓荒编队的 sponsor 房名。 */
      sponsor: string;
      /** 当前状态的起始 tick（超时判定基准）。 */
      startedAt: number;
    };
    /** 扩张失败目标黑名单（v11+）：房名 → 冷却到期 tick。 */
    expansionBlacklist?: Record<string, number>;
    /**
     * 帝国姿态（v13+，empire-strategy 每 tick 评估写入）— Strategy 层全局真相源：
     * 执行系统（扩张/远矿/未来进攻）只消费此处指令，不得自行裁决「是否该扩张/开战」。
     */
    strategy?: {
      /** 当前姿态：develop 固本 / expand 扩张 / fortify 设防 / war 战争。 */
      posture: "develop" | "expand" | "fortify" | "war";
      /** 当前姿态的起始 tick（滞回与耐心窗口的基准）。 */
      since: number;
      /** 指令：是否允许启动新的扩张行动。 */
      expansionAllowed: boolean;
      /** 指令：是否允许开辟新的远矿点（现役运营不受影响）。 */
      newRemoteOpsAllowed: boolean;
      /**
       * war 可持续性计数（v27+，R4）：war 姿态下经济压力持续超 warMaxPressure 的
       * 连续 tick 数（empire-strategy 每 tick 写）；超 warExitPatienceTicks →
       * 降级 fortify；压力恢复即清零 — 纯函数评估的滞回输入。
       */
      warPressureTicks?: number;
    };
    /**
     * 失守房间记录（v11+）：房名 → 首次检测到失守的 tick。
     * maintainMemory 据此在宽限期后清除 Memory.rooms 条目。
     */
    lostRooms?: Record<string, number>;
    /**
     * Power Creep 运营状态（v34+，power-creep-manager 唯一写者）。
     * homeAssignments：PC 名 → 驻留房名。PC 换房成本高（长途移动 +
     * 寿命消耗），粘性防每轮重算漂移；PC 消失/房失守时由系统清理条目。
     */
    powerCreeps?: {
      homeAssignments: Record<string, string>;
    };
    /**
     * 我方在途核弹台账（v35+，war-planner 唯一写者）：目标房名 → 落地到期
     * tick 数组。引擎无全局核弹查询 API（FIND_NUKES 需要目标房视野），
     * 自发核弹只能自查 — 台账即完整真相。发射时 push（Game.time +
     * NUKE_LANDING_TIME 50000），到期由 war-planner 每轮清理（防膨胀）。
     */
    nukesInFlight?: Record<string, number[]>;
    /**
     * 目标清单结构缺口观测（v21+，layout-planner 写）：期望 = CONTROLLER_STRUCTURES
     * 派生，已有 = 建成结构 + 我方在建 site + queued/blocked 队列任务；缺口 > 0 即
     * 真实未达成，供控制台采样与人工介入信号；仅在实际缺口集合变化时写入。
     */
    layoutGaps?: Record<string, Record<string, number>>;
    /**
     * 布局可观测性指标（v25+，layout-metrics 写，漏洞 #11）：房名 → 指标快照
     * （字段见 LayoutMetrics）。仅变化时写入；消费方：deadAssetRate>0.5 触发拆改评估、
     * linkUtilization<0.3 触发 link 审查、defenseWallRatio<0.7 防线弱点过多告警。
     */
    layoutMetrics?: Record<string, {
      deadAssetRate: number;
      linkUtilization: number;
      dismantleCount: number;
      mvcGapCount: number;
      linkConstrained: boolean;
      defenseWallRatio: number;
      defenseAlgoVersion: string;
      defenseRampartWeakPoints: number;
    }>;
    /**
     * 帝国战争计划（v26+，war-planner 写入；v27 R4 扩展）：仅 war 姿态时存在，
     * 同一时刻至多一个攻击编队（不并行开多线）；姿态退出/目标失效/战损止损时
     * 清除并回收在役 attacker。
     */
    warPlan?: {
      /** 目标房名（敌方玩家房）。 */
      targetRoom: string;
      /** 代孵 sponsor 房名（攻击者在此孵化，取 intel 通勤最近的房）。 */
      sponsor: string;
      /** 期望攻击者数（编队规模）。 */
      squadSize: number;
      /** 计划建立 tick。 */
      since: number;
      /** 目标 tower 数（情报快照，供编队/撤退参考）。 */
      towersSeen: number;
      /** 波次相位（R4）：build 集结（满编才推进）/ advance 推进（整波进攻），按存活数迟滞切换。 */
      phase?: "build" | "advance";
      /**
       * 累计提交的 attacker 孵化请求数（R4 止损账本，每 key 只计一次）；
       * 超 squadSize × CONFIG.war.casualtyMultiplier 判消耗战失败。
       */
      spawned?: number;
    };
    /**
     * 战争失败目标黑名单（v27+，war-planner 写入）：核验结论 failure/unknown 的
     * 目标冷却期内不被 selectWarTarget 重选；到期由 war-planner 清理。
     */
    warBlacklist?: Record<string, number>;
    /**
     * 战损止损后的整军休战截止（v27+，war-planner 写入）：此 tick 前不创建新战争
     * 计划（黑名单只挡单目标，休战期挡跨目标添油循环）；到期后姿态仍为 war 则重估。
     */
    warStandDownUntil?: number;
    /**
     * 帝国议程（v28+，empire-strategy 写入）— 短期目标真相源：
     * recovery（恢复）> defense-readiness（备战）> rcl-push（冲级）> develop（固本）。
     * 执行系统消费 initiative 协调优先级；决策纯函数见 domain/strategy/agenda。
     */
    agenda?: {
      initiative: "recovery" | "defense-readiness" | "rcl-push" | "develop";
      since: number;
      /**
       * rcl-push 窗口起始时的 controller 进度合计（v30+，R7a）：退出 rcl-push
       * 时据此归因窗口内的升级速率（AgendaOutcome 事件）。
       */
      progressBase?: number;
    };
    /**
     * 算力容量分层（v30+，empire-strategy 写入）：规模规划的前馈层 —
     * 按 min(cpuLimit, tickLimit) 动态计算，消费者据此缩放远矿/扩张雄心。
     */
    capacity?: {
      tier: "abundant" | "comfortable" | "tight" | "constrained";
      since: number;
      /** 升档候选连续满足余量的 tick 数（滞回防抖）。 */
      upgradeTicks: number;
    };
    /**
     * 扩张节奏台账（v31+，expansion-manager 写入）：每次扩张任务收摊追加
     * 一条结果（0=success/1=stolen/2=timeout/3=lost/4=aborted），有界 ring。
     * domain/expansion/rhythm 消费产出自适应调节（暂停/门禁/黑名单缩放）。
     */
    expansionRhythm?: {
      ring: number[];
      /** 最近一次评估出的黑名单缩放（0.5–1.5）。 */
      blacklistMultiplier: number;
      /** 最近一次评估出的目标最低 source 数（1–2）。 */
      minSources: number;
    };
    /** 扩张失败暂停截止（v31+）：此 tick 前不开新扩张行动（连续失败止损）。 */
    expansionPausedUntil?: number;
    /**
     * 侦察任务（v29+，prospect-manager 写入）：同一时刻至多一个。
     * 姿态 expansionAllowed 时主动为扩张候选房获取视野（决策就绪情报）。
     * 成功（intel 新鲜）/失败（超时/死亡上限）后清除，失败进 prospectCooldown。
     */
    prospect?: {
      /** 侦察目标房（扩张候选）。 */
      target: string;
      /** 孵化侦察兵的 sponsor 房（intel 归属房）。 */
      sponsor: string;
      /** 任务开始 tick（超时基准）。 */
      startedAt: number;
      /** 累计提交的 scout 孵化请求数（死亡上限判定）。 */
      spawned: number;
      /**
       * posture 退出（expansionAllowed=false）的持续起点 tick（Opt B 脱敏计时）。
       * 瞬时翻转（pixel 放血致 posture 临时翻 develop）不立即撤任务——累计非 expand
       * 时长超过 CONFIG.prospect.postureGraceTicks 才中止；恢复 expand 即清零。
       * 仅 liveThreat 可绕过本窗口即时中止（真实战争威胁优先级最高）。
       */
      postureExitSince?: number;
    };
    /**
     * 侦察失败目标冷却（v29+，prospect-manager 写入）：房名 → 到期 tick。
     * 冷却期内不被 selectProspectTarget 重选；到期由管理器清理。
     */
    prospectCooldown?: Record<string, number>;
    /**
     * PB 野采任务（v36+，power-farm-manager 唯一写者，审计缺口 2）：同一时刻
     * 至多一个。PB 击破后（编队房内视野确认）转 collect 阶段孵 collector 捡运
     * 掉落 power；collector 消失/超时/止损时清除并回收编队。war 姿态时不建
     * （军事资源不双线，warPlan 存续即冻结新任务）。
     */
    powerFarm?: {
      /** PB 目标房（通常 highway）。 */
      targetRoom: string;
      /** 代孵 sponsor 房名。 */
      sponsor: string;
      /** 任务建立 tick（超时基准）。 */
      since: number;
      /** 累计提交的战斗编队孵化请求数（止损账本）。 */
      spawned: number;
      /** PB 已击破，进入捡运阶段（collector 已派/待派）。 */
      phase: "strike" | "collect";
      /** collector 首次提交孵化请求的 tick（collect 宽限窗基准；per-mission
       * 运行时字段，缺失视为未派 — 与 lastRepathAt 同先例免迁移）。 */
      collectorSpawnedAt?: number;
    };
  }

  /** 参数自调优的持久化状态。 */
  interface TuningMemory {
    /** 上次调优 tick。 */
    lastTuned: number;
    /**
     * 生成 rooms 覆盖所基于的 CONFIG.tuning.baselineVersion（P1-I）：tuning-engine
     * 每次评估前比对，不匹配即清空 rooms 覆盖（旧值可能基于过时经济假设）从新基线
     * 收敛；undefined 视为不匹配（首次运行或 v18 迁移后）。
     */
    baselineVersion?: number;
    /** 每房间的调优覆盖值。key = 房间名。 */
    rooms: Record<string, RoomTuningState>;
    /** 每房间最近一次评估的诊断快照（供控制台查看）。key = 房间名。 */
    lastEval?: Record<string, {
      tick: number;
      adjustments: string[];
      signals: Record<string, number>;
      skipped?: string;
      /**
       * P3 修复（附录 E.2）：verify pass 被跳过时的原因 — 危机/低 bucket 期间外生
       * 信号不可信，verify 跳过保留 pending。取值 "verify_skipped_crisis" /
       * "verify_skipped_cpu_tier" / "verify_skipped_rcl"。
       */
      verifySkipped?: string;
      /** 本次评估产生的趋势记录（P1-1 调整置信度）。 */
      trend?: Record<string, "up" | "down" | "none">;
      /**
       * 改进 A：本次评估时 pending 验证中的参数诊断（精简版，控体积；
       * 完整 preAdjustSignals 在 Memory.kernel.tuning.rooms）。
       */
      pendingValidations?: Record<string, {
        adjustTick: number;
        expectedDirection: "improve" | "worsen";
        adjustDirection: "up" | "down";
        contractBlocked?: boolean;
      }>;
      /** 改进 A：本次评估时的冻结参数诊断（精简版）。 */
      frozenParams?: Record<string, {
        frozenUntil: number;
        rollbackCount: number;
        reason: string;
      }>;
      /**
       * P1 修复（附录 E.2）：人口合同 blocked 参数诊断 — roleCount 持续未达新边界时
       * 记录 blockedSinceTick，连续 2 个 verifyDelay 窗口仍未达 → 回滚 + 计 1 次回滚。
       */
      blockedParams?: Record<string, {
        blockedSinceTick: number;
        lastCheckedTick: number;
      }>;
    }>;
  }

  /**
   * 单个远矿运营记录（存 RoomMemory.remoteOps，短字段、有界）—
   * 遵循 Memory 规范：只存 ID、枚举、少量数字和短 key。
   */
  interface RemoteOp {
    /** 运营状态：scout（待侦察）→ active（采集中）→ paused（暂停）→ abandoned（废弃）。 */
    state: "scout" | "active" | "paused" | "abandoned";
    /** 源数量（有视野时记录，来自 intel 或实地观察）。 */
    sources?: number;
    /** 动态 hauler 编制（评选期按通勤成本算出，1-haulersMax）。
     * 缺失时回退 CONFIG.remote.haulersPerTarget（存量运营兼容）。 */
    haulerNeed?: number;
    /** 创建 tick。 */
    createdAt: number;
    /** 最近可见 tick（creep 进入或 observer 扫描时更新）。 */
    lastSeen: number;
    /**
     * InvaderCore 压制冷却截止 tick：发现核心 → 回收 → 失明 → 孵化恢复 → 新 creep
     * 送死的循环靠持久化冷却打破。到期恢复孵化探测（核心仍在则新视野续期）；
     * 有视野且确认核心消失时立即清除。
     */
    blockedUntil?: number;
    /**
     * P1：次级 Invader Core 清核标记 — remote-mining-manager 检测到 level-0
     * reserve-only 核心（无守卫、不反击）时置 true，驱动 demand 孵 coreClearer 拆核。
     * 与大要塞（level≥1 带守卫）的 blockedUntil 规避互斥：lesser 核心不阻塞运营
     * （核心清除后 demand 立即恢复），只靠此标记驱动清核。
     */
    needCoreClear?: boolean;
    /**
     * 普通威胁冷却截止 tick（RM-2，与 blockedUntil 同款双轨）：有视野见威胁写入/
     * 续期，确认清空立即清除，无视野时冷却期内维持威胁态 — 防「威胁→失明→恢复
     * 孵化→送死」循环送兵。
     */
    threatUntil?: number;
    /**
     * P1-G：危险冷却到期 tick（v16+，从 intel.dangerUntil 迁移至此）—
     * remote-mining-manager 唯一写入；冷却期内该房不作远矿/扩张候选（止损）。
     * 迁移原因：intel 双写者（room-observer 透传链）加一个写者就崩，remoteOps
     * 本就单一写者，搬家后字段归单一写者。
     */
    dangerUntil?: number;
    /**
     * 经济重估（A-3/B-6）：netScore 首次跌破门槛的 tick；连续低于门槛超过宽限期
     * 才废弃（抗抖动，防单次波动误撤边际 op）；回升到门槛以上时清除。
     */
    lowScoreSince?: number;
    /**
     * P0-A：本远矿房我方创建的 container construction site 数量（v15+）。
     * remote-mining-manager 每 managerInterval tick 用 lookForAtArea 实测校正 —
     * 只增不减会让几个远矿房永久占满 maxGlobalSites 饿死自有房重建；
     * construction-manager 全局上限判定读此值（ctx.globalSiteCount + Σ siteCount < maxGlobalSites）。
     */
    siteCount?: number;
    /**
     * v33 空转止损计时：编队全员空转（idle/flee 或 stuckTicks ≥ stallStuckTicks）
     * 的起始 tick；任一成员恢复工作立即清除。持续超过 CONFIG.remote.stallAbandonTicks
     * → 废弃运营。remote-mining-manager 唯一写者（managerInterval 采样）。
     */
    stallSince?: number;
  }

  interface Memory {
    schemaVersion?: number;
    creeps: Record<string, CreepMemory>;
    rooms: Record<string, RoomMemory>;
    kernel?: KernelMemory;
  }
}
