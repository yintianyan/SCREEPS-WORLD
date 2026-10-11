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
    /** remote-harvester 的远矿 source 槽位索引（0-based），spawn 时由 demand 预分配。 */
    sourceSlot?: number;
    /** remote-harvester 缓存的 source 旁 container ID（避免每 tick lookForAtArea）。 */
    sourceContainerId?: Id<_HasId>;
    /** remote-harvester 上次扫描 container 的 tick — 降频重扫用，防止 container 被摧毁后每 tick lookForAtArea。 */
    lastContainerScanTick?: number;
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
     * TD-001：Level 3 弃目标时记录被放弃的 assignment task id。
     * chooseTaskForRole 在冷却期内过滤此 id，防止立即重新分配相同目标导致循环。
     * per-creep 运行时状态，无需迁移（同 lastRepathAt 先例）。
     */
    abandonedTaskId?: string;
    /** TD-001：abandonedTaskId 写入时的 tick，用于冷却判断。 */
    abandonedAt?: number;
    /**
     * 档 2：上次 PathFinder.search 重寻路 tick。
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
    /** F16：attackController cooldown 截止 tick — 避免在 cooldown 中盲调浪费 CPU。 */
    attackCooldownEnd?: number;
    /** F12：distributor 降级为 hauler 标记 — storage 重建后 hauler gate 检查此标记转回。 */
    distributorDegraded?: boolean;
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
    /** @deprecated remoteHauler 不再缓存 containerId — 每 tick 重新评估（就近优先）。 */
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
    /** 排队权重（0 最高）。只回答"先孵谁"，不回答"这间房会不会死"。 */
    priority: 0 | 1 | 2 | 3 | 4;
    /**
     * 本房生存需求：true = 不孵它，**队列所在这间房**就要出事（失守/崩经济）。
     *
     * 为什么必须与 priority 分开：跨房编排（agenda-manager 的运能请求、远矿编制、
     * 战争编队）也能拿到 priority 0 —— 那是"帝国层面急着要"，不是"捐出这间房要死了"。
     * 一个字段两种语义的后果：捐出方看见自己队列里有 0 就停建、停孵本房非 0 请求，
     * 于是"被别人求援"变成对自家基建的否决权（construction-manager 的 site 闸、
     * room-state 的孵化饥饿计数、spawn-manager 的孵化阻塞都读这一维）。
     *
     * 属主纪律：由**请求的产出方**声明，不由消费者猜。读取方一律经
     * `domain/spawn/queue.hasSurvivalRequest()`，不得再各自比较 priority。
     * 必填（不是可选）—— 缺省即 false 会让忘标的生产者静默失去生存否决。
     */
    survival: boolean;
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
    /** 入队 tick（R2 队列治理：年龄观测与超龄清除）。旧数据缺省 → v42 迁移回填。 */
    queuedAt?: number;
    assignedTo?: string;
    leaseUntil?: number;
    /** 此任务允许的最大同时工作 creep 数。 */
    maxWorkers?: number;
  }

  interface RoomMemory {
    colonyState?: ColonyState;
    /** colonyState 最近一次变化的 tick（由 room-state-system 写入）。 */
    colonyStateSince?: number;
    /**
     * P3 能量核算瘦快照（schema v37，economy 系统唯一写者，50tick 错峰）。
     * 字段镜像 domain/economy/accounting.EconomyMemorySnapshot（整数化短字段，
     * STATE_OWNERSHIP §2 Memory 白名单）。消费只经 queryEconomy() 公开接口。
     */
    economy?: {
      /** 采样 tick。 */
      t: number;
      /** 净流 EMA ×100（能量/tick）。 */
      nf: number;
      /** 合同储备（storage+terminal+link 水位）。 */
      cr: number;
      /** 风险缓冲 tick 数 ×10。 */
      rb: number;
      /** 最近一窗 drift。 */
      dr: number;
      /** 估计收入 ×10（能量/tick）。 */
      ei: number;
      /** 效率系数 ×100。 */
      ef: number;
      /** 最近一窗各桶增量（能量，零值不入账）—— drift 点名哪个记账项缺/多。 */
      bk?: Record<string, number>;
      /** 最近一窗池快照 [trackedStart, trackedEnd, otherStart, otherEnd, looseDelta]。 */
      pl?: number[];
      /** 最近一窗在途背包能量 [carryStart, carryEnd] —— 跨窗残差的判别量（见 #23(2)）。 */
      ce?: number[];
      /**
       * 长视界 drift 累计 [Σdrift, ΣflowBalance, Σticks] —— 把"窗边界振荡"与"单向漏账"
       * 分开的判别量，见 domain/economy/accounting.EconomyMemorySnapshot.ws。
       */
      ws?: number[];
    };
    /**
     * 经济压力梯度信号（0.0–1.0，从 drainScore 派生）：demand/construction/tower
     * 用它做梯度缩放，替代二值 crisis/normal 开关。
     */
    economyPressure?: number;
    /**
     * 能量边际价值（价格信号，0..1）：0=紧缺（抑制消费、鼓励采集），
     * 1=充裕（鼓励消费、不鼓励扩编）。room-state 每 tick 从 economy
     * 核算的 netFlow EMA 和 estimatedIncome 派生，供 demand 弹性调节。
     * 未核算时为 0.5（中性）。
     */
    energyPrice?: number;
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
    /**
     * #152 观测专用（**当前零消费者**）：与 `lastHostileAt` 同拍盖章，但按行凶者身份分尺。
     * 立此因由：把 posture 钉在 `war` 的是上面那把房级尺，而段 5 的按人敌意列对 NPC 恒为 0
     * （`intelligence.ts:83-91` 显式排除 `INVADER_USERNAME`）⇒ 三十天里没有任何玩家攻击记录，
     * 恒战的成因是 **NPC 骚扰与玩家宣战在这把尺上同价**。分尺落盘后 #151 才谈得上按来源降尾税。
     * 两把尺都不参与任何决策，改动战争语义仍属人。
     */
    lastInvaderHostileAt?: number;
    lastPlayerHostileAt?: number;
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
      /**
       * 流动性陷阱连续成立的评估次数（room-state 每 tick 写入）；陷阱一断即归零，
       * 达 economy 的 liquidityEnterTicks 后 liquidityScore 才开始累加。
       * 旧 Memory 无此字段按 0 处理（无需迁移）。
       */
      liquidityTrapTicks?: number;
      /** 危机带（crisis/recovery）驻留评估次数（v14+，最短驻留防极限环）。 */
      bandTicks?: number;
      /**
       * P0-1：srcRatio 满载 + storage 累积流失双条件持续成立的评估次数；
       * 任一条件不满足立即归零，达 srcStallEnterTicks 后强制 crisis。
       */
      srcStallTicks?: number;
      /** 欠员连续成立的评估次数（bootstrapEnterTicks 的驻留计数）；一断归零。缺席容忍，无 schema 变更。 */
      bootstrapTicks?: number;
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
    /**
     * FINDING-04 修复：生命线角色 churn WARN 限频表。
     * role → 下次允许输出 WARN 的 tick。每 CHURN_WINDOW 最多 1 条 WARN。
     */
    churnWarnAt?: Record<string, number>;
    buildQueue?: BuildTask[];
    lastRcl?: number;
    /** room-state 维护：RCL 等级（变化检测用，与 layout-planner 的 lastRcl 独立）。 */
    lastRclLevel?: number;
    /** room-state 维护：RCL 等级变化 tick（期望自检 E5 停滞检测的年龄基准）。 */
    lastRclChangeAt?: number;
    /** room-state 维护：上一次观测到的 controller.progress（「进度有没有动」的对照值）。 */
    controllerProgressSeen?: number;
    /** room-state 维护：controller.progress 最近一次变化的 tick（E5 停滞时长基准）。
     * 必须落 Memory 而非 heap：掐断升级道的改动本身就是一次部署，而部署把 heap 计时器归零 ——
     * 于是 10000 拍阈值在迭代期永远够不到（线上实测幼房 progress 冻结数小时，E5 一次未报）。 */
    controllerProgressChangedAt?: number;
    /** room-state 维护：`controller.progressTotal`（升到下一级还需要的总进度），与 progress 同处刷新。
     * 为什么要单独存：`progressTotal` 只在进度变化的那一拍读，零额外成本，而它是**唯一能把
     * 「速率」变成「还有多久」的分母**。没有它时 RCL 距离只能报速率（线上实测：同一份读数下
     * 两个会话的 RCL5 ETA 差出 ~2,000 拍，分歧全部来自这个读不到的值）。 */
    controllerProgressTotalSeen?: number;
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
    /**
     * 累计拆改计划创建次数（#82）：`layoutMetrics.dismantleCount` 的真实来源。
     * 没有它就只能给仪表写占位 0 —— 而"用 0 顶替测不出来"正是本模块上次变成化石的病。
     */
    dismantleCount?: number;
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
    builderPressureState?: "full" | "shrinking";
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
    /**
     * 远矿「废弃墓碑」（纯观测，不参与任何决策）：每次 op 废弃追加一条，
     * 定长保留最新 CONFIG.remote.graveyardCap 条。
     * 为什么不能只靠 remoteOps：abandoned 记录经 staleThreshold×6 会被卫生层整条
     * delete，而非自有房的 intel 只活在 heap —— 没有这张碑，"少了哪个矿点、为什么被弃"
     * 事后无从回答（线上实证 remoteOps 4→2 查无痕迹）。原因码见
     * domain/remote/op-outcome.REMOTE_ABANDON。
     */
    remoteGraveyard?: import("../domain/remote/op-outcome").RemoteOpTombstone[];
    /**
     * 本房正在被主动放弃（territory-manager 写，值为指令 startedAt）。
     * 消费方的语义是「不要再为这房花钱」：spawn-manager 见之清空队列并跳过需求评估，
     * construction-manager 见之不再开新 site。房一失主即随整条 RoomMemory 一起消失。
     */
    releaseAt?: number;
    /**
     * A5.1：防御状态标记（recovery-execution-system 写入，kernel/consumers 读取）。
     * heap 语义——不持久化到 RawMemory（global reset 丢失可接受，下 tick 重建）。
     */
    defenseState?: {
      /** safeMode 激活需求（CRITICAL 威胁时标记）。 */
      safeModeRequested?: boolean;
      /** 标记 tick。 */
      safeModeRequestTick?: number;
      /** 请求原因（含 correlationId 供追踪）。 */
      safeModeReason?: string;
    };
  }

  /** PB 野采任务（多任务并行支持）。 */
  interface PowerFarmMission {
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
    /** collector 首次提交孵化请求的 tick（collect 宽限窗基准）。 */
    collectorSpawnedAt?: number;
  }

  interface KernelMemory {
    tier?: CpuTier;
    /** 最近一次 CpuTier 变更 tick（驻留时长观测）。 */
    tierChangedAt?: number;
    /** 最近一次 posture 变更 tick（决策质量观测）。#140：只在变更那一拍写。 */
    postureChangedAt?: number;
    /**
     * 最近一次 posture 变更的现场（#140）：`reason` 是判定走的那条分支，
     * 复盘 war 进/出时不再需要 console 考古（原先只有日志＋每拍被覆写的 changedAt）。
     */
    postureTransition?: {
      from: string;
      to: string;
      reason: string;
      tick: number;
    };
    recoveryTicks?: number;
    skipReasons?: Record<string, number>;
    /** B3-F09: 上一 500-tick 窗口的 skipReasons 快照（滑动窗口保留）。 */
    prevSkipReasons?: Record<string, number>;
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
      /**
       * 窗内逐拍均量的 CPU 速率账（telemetry 写）。
       *
       * `total` 是「每拍拍尾都采」的均值 —— 分档唯一该吃的读数；`cpuAvg10` 的采样点
       * 落在遥测+刷段的重活拍上，官服实测稳定偏高约 2.6/t。见 pickCpuUsagePerTick。
       */
      cpuRate?: {
        windowTicks: number;
        sampledTicks: number;
        unsampledTicks: number;
        total: number;
        unexplained?: number;
        unphased?: number;
        tail?: number;
        bySystem?: Record<string, number>;
        byRole?: Record<string, number>;
        byPhase?: Record<string, number>;
      };
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
      /** 最近一次系统级错误现场（单条覆盖式，运维采集通道 —— 官服无控制台历史回读）。 */
      lastError?: { label: string; msg: string; tick: number };
      /** 每房 CPU 消耗快照（最近一次采样）：roomName → CPU。
       * 来自 kernel.runCreeps 按 memory.home 归集的 globalCache.cpuByHome。
       * 供 empire-strategy / capacity 评估每房真实 CPU 成本。 */
      cpuByHome?: Record<string, number>;
      /**
       * 通勤建路实测账本快照（heap 累计值，telemetry 每轮落一次）：房名 → 计数。
       * 存在的理由与字段语义见 domain/logistics/road-build —— 纯观测，无消费者做决策。
       */
      roadBuild?: Record<string, import("../domain/logistics/road-build").RoadBuildCounters>;
      /** 贸易决策实测账本快照（terminal-manager 写 heap，本处落一份供体检读）。 */
      trade?: import("../domain/industry/trade-ledger").TradeLedger;
      /** Memory 原始字符串体积（字符数），每 100 tick 采样。
       * RawMemory.get().length — 零 JSON 解析成本，只读字符串长度。
       * 官服上限 2MB（2*1024*1024）[Fact: typings 验证]；超 1.5MB 告警。 */
      memorySize?: number;
      /** E-FINDING-09: P1 补位时延起点锚（同角色下次孵化成功时结算 EMA）。
       * 由 recordCreepDeath 写入，maintainMemory 清理已灭绝角色。 */
      deathAnchor?: Record<string, number>;
      /** #96：死亡原因的累计计数（只增不减、跨部署存活）。
       * 为什么单独存：`CreepDeath` 事件环容量按**事件总数** 500 计 ⇒ 实测只回溯 ~846 拍；
       * M11 的 `globalCache().recentCombatDeaths` 只保留 2×`fleetLossFuse.windowTicks` = **400 拍**且住 heap（换码清零）。
       * 两者都够不到"这场 war 之前那两次目击"，于是 #90 判据的「持续战损」半边不可测。
       * `natural` = 寿终（age 达名义寿命线，reserver/claimer 600−60、其余 1500−60），`combat` = 非寿终（战损/事故/回收）。 */
      deathByCause?: { natural: number; combat: number; recycled?: number };
      /** #99：战争候选漏斗 —— 最近一次 war-planning pass 的各道筛子出口计数。
       * 为什么单独存：#95「零计划零编队」的归因需要知道候选死在哪一道，而五道筛子全是裸
       * `continue`（heap 里的 scratch 换码即清，且 pass 间隔 10 拍 ⇒ 现场永远追不上）。
       * 由 intelligence 老化批每 100 拍与 `intelCoverage` 同拍写入（见 systems/intelligence.ts）。
       * ⚠️`tick` 是**被计量的那一拍**，不是快照时刻 ⇒ 它落后当前 tick 超过 2×`CONFIG.war.interval`
       * 就说明 war-planning 没在跑，这份计数是残影（与 `energyLedger.tick` 那种"创建时赋一次"的坑同类）。 */
      warFunnel?: import("../domain/military/war-planning").WarFunnelCounters;
      /** B4-F08: P1 补位时延 EMA（按角色分桶），由 spawn-manager 写入。
       * replaceLatency[role] = prev * 0.8 + latency * 0.2。 */
      replaceLatency?: Record<string, number>;
      /** C2-FINDING-01: IVM heap 使用快照（每 100 tick 采样）。 */
      heapUsed?: number;
      heapTotal?: number;
      heapLimit?: number;
      /** 方向 3 保底可观测性：recovery tier 下 kernel 直接采样的关键指标。
       * 每 10 tick 由 kernel 直接写入（不依赖 telemetry-collector P3 系统运行）。
       * 确保最需要诊断时（灾后恢复期）有最基本的数据可查。 */
      baselineBucket?: number;
      baselineTier?: string;
      baselineCreepCount?: number;
      baselineRoomCount?: number;
      baselineLastSample?: number;
      /** #105：恢复动作被拒的累计计数（key = `动作类型:失败分类`，只增不减、跨部署存活）。
       * 为什么单独存：`globalCache().recoveryActionTable` 住 heap ⇒ 每次部署归零，
       * `attempts/maxAttempts` 一起被清，所以"某类动作一直被判拒"这类结构性失效此前**从不显形**；
       * 而这一族里最值得关注的那条是故意的——GLOBAL_ROOM 的动作被显式跳过（不默认"买/建/孵"），
       * 设计越合理、没有读数就越隐蔽：物流/网络/健康维度三类失败节点都不带房名，
       * 它们的动作按构造全部走跳过分支。⇒ 本表回答"帝国级故障到底产出过几次可执行动作"。
       * 零消费者做决策（纯观测）；键集合有限 ⇒ Memory 体积有界；`lastReason` 截 120 字符。 */
      recoveryRejections?: Record<string, { count: number; lastAt: number; lastReason: string }>;
    };
    /** 方向 3 E-FINDING-04 补充：P3 长期冻结跟踪。
     * 当 P3 旁路因 bucket < conserve 最低值不生效时，记录冻结开始的 tick。
     * 冻结持续超 P3_FROZEN_ALERT_TICKS 时输出升级告警。 */
    p3FrozenSince?: number;
    /** 参数自调优状态（v7+）。tuning-engine 每 500 tick 更新。 */
    tuning?: TuningMemory;
    /**
     * 当前扩张行动（v11+，同一时刻至多一个）：expansion-manager 状态机。

     * A3.3 扩展：从二态（claiming | pioneering）升级为完整执行链路：
     *   validating → preparing → claiming → claimed → bootstrapping →
     *   economic_startup → integrating → completed

     * 向后兼容：旧二态作为 claiming/bootstrapping 的子集继续工作。
     */
    expansion?: {
      /** 执行状态（A3.3 完整状态机）。 */
      state: ExpansionExecutionState;
      /** 扩张目标房名。 */
      target: string;
      /** 孵化 claimer 与拓荒编队的 sponsor 房名。 */
      sponsor: string;
      /** 当前状态的起始 tick（超时判定基准）。 */
      startedAt: number;
      /** A3.3：关联的 planId。 */
      planId?: string;
      /** A3.3：已通过 checkpoint 数（0-5）。 */
      checkpointsPassed?: number;
      /** A3.3：预留能量。 */
      reservedEnergy?: number;
      /** A3.3：连续净流为正的 tick 数（经济激活判据）。 */
      consecutivePositiveTicks?: number;
      /** 上一次经济激活评估的 tick —— 用于把 streak 按**拍**累计而非按采样次数累计。 */
      lastEconomicEvalTick?: number;
      /** AI-2 修复：DecisionTrace 分配的 decisionId（D-{tick}-{seq}）。
       * 由 collectExpansionDecisions 在采集 DecisionRecord 时写入。
       * Phase 6 UOEM 后：decisionId 仅作为 DecisionTrace 内部引用，
       * 不再作为 outcome 匹配键（由 operationId 替代）。 */
      decisionId?: string;
      /** Phase 6 UOEM：Operation 唯一身份标识（op:{target}:{consumeTick}）。
       * 在 tryConsumePlan 时一次性铸造，写入 Memory，跨 global reset 稳定。
       * Experience Collector 用 operationId 匹配 OutcomeChannel 中的终态事件。 */
      operationId?: string;
      /** Phase 6 UOEM：Operation 生命周期起点（consume tick，不可变）。
       * 与 startedAt（mutable state timer）分离——startedAt 仍用于超时判定，
       * 但 duration 计算使用 openedAt 作为起点。 */
      openedAt?: number;
      /** Phase 6 UOEM：是否经历过 forced advance（P5/P7 milestone 传播）。
       * 终态 outcome 携带此标志，区分 COMPLETED 与 COMPLETED_FORCED。 */
      forcedAdvance?: boolean;
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
      /** 当前姿态由哪条分支维持（#140；变更那一拍另见 kernel.postureTransition）。 */
      branch?: string;
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
      /**
       * #94：`gclHeadroom` 那一项的**实际输入**（`Game.gcl.level`，缺失时按 1 判定）。
       * 为什么要落盘：这两个标量原先只存在于决策那一拍的 heap，于是
       * `expansionAllowed=false` 之后**没人能回答"当时是哪一合取项在挡"** ——
       * 七个合取项里有五项可从 Memory 复算，恰好这两项不行（线上实测 `kernel.gcl`/`kernel.bucket` 均不存在）。
       */
      gclLevel?: number;
      /** #94：`bucket ≥ expandMinBucket` 那一项的**实际输入**（`Game.cpu.bucket`，缺失时按 10000 判定）。 */
      bucket?: number;
    };
    /**
     * 失守房间记录（v11+）：房名 → 首次检测到失守的 tick。
     * maintainMemory 据此在宽限期后清除 Memory.rooms 条目。
     */
    lostRooms?: Record<string, number>;
    /**
     * 在途「放弃自有房」指令（territory-manager 唯一写者）：房名 → 指令。
     * 排空 → unclaim → 清账 全程由系统执行，人工只下这一次命令。
     */
    roomRelease?: Record<string, import("../domain/empire/room-release").RoomReleaseDirective>;
    /**
     * 已主动放弃的房（重占排除表）：房名 → 释放 tick。
     * 消费方：expansion-planner 候选硬否决、territory-manager 事后清扫与过期剪除。
     * 为什么不永久：见 CONFIG.territory.releasedExclusionTicks。
     */
    releasedRooms?: Record<string, number>;
    /**
     * 扩张就绪度专用的「长视界净流」EMA（按房）。
     *
     * 必须住 Memory 而不是 heap：heap 版每次部署丢掉 ~2500 拍的收敛历史，
     * 换码后 G3/G4 读到的是"拿当窗值播种"的假数 —— 14:43 实测因此把 plan 的
     * readySince 打回起点（部署税本只该落在 G6 上，不该顺手把就绪度也清零）。
     */
    gateNetFlow?: Record<string, number>;
    /**
     * 纯观测：自举车道每轮把"哪些房被哪一道筛子掉出去"落一次数（不参与任何判据）。
     * 存在的理由 —— 堆里的 ctx.snapshots() 从 console 读不到（console 与上传的 module code
     * 各有自己的 globalThis），想看只能落 Memory。线上出现过"有自有 spawn 判效未过"
     * 却无从判断是车道没跑、房没进候选、还是 sponsor 池空。
     */
    bootstrapDiag?: {
      tick: number;
      /** ctx.snapshots() 里有几间自有房。 */
      owned: number;
      /** 没视野被跳过的。 */
      noVision: number;
      /** 有自有 spawn（= 不需代孵，同时是防重入的唯一正当判据）。 */
      hasSpawn: number;
      /** controller 不是自己的。 */
      notMine: number;
      /** 进入代孵候选集的房数。 */
      pushed: number;
      /** 可当 sponsor 的房数（有 spawn + rcl 够 + colonyState=normal）。 */
      sponsor: number;
      /** decideBootstrapRooms 给出的决策条数。 */
      decisions: number;
    };
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
     * 布局可观测性指标（房名 → 快照；字段定义只在 `LayoutMetrics` 一处，别在这里再抄一份 ——
     * 上次这份内联副本与模块脱节，正配合"模块零调用点"把 `layoutMetrics` 变成了化石）。
     *
     * ⚠️ #82 的历史教训（写给下一个读到这行的人）：本通道曾长期**只有类型与数据、没有写者**
     * （`computeLayoutMetrics` 零调用点、dist 里连 "layoutMetrics" 字样都没有），
     * 而 Memory 里的旧值看起来像现值。所以：注释里**不再声称**"某阈值触发某评估"——
     * 那些消费者并不存在；真正的拆改评估由 layout-planner 直接读 `getDeadAssetLinks`。
     * 现在由 `recordLayoutMetrics()` 在每次规划收尾写入（只写有真实来源的字段，
     * `defenseCutComplete=false` 时两个防御字段是占位，勿当测量）。
     */
    layoutMetrics?: Record<string, import("./domain/layout/metrics").LayoutMetrics>;
    /**
     * #85：需求阶梯对 upgrader 生效的**结构钳位**（房名 → 钳位值；钳位不存在时删键，
     * 保持"缺键 = 没在压 maxCount"的语义，与 `layoutGaps` 的删除惯例一致）。
     * 写者 = spawn-manager（每拍从 `evaluateDemand` 的返回值抄一次），读者 = tuning-engine 的
     * `aggregateSignals` ⇒ 调优器由此知道"这个 ↑ 物理上落得了地吗"，不必自己复算需求分支。
     */
    demandClamps?: Record<string, number>;
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
       * 累计提交的 attacker 孵化请求数（R4 止损账本）；
       * 超 squadSize × CONFIG.war.casualtyMultiplier 判消耗战失败。
       * 计数口径：首次提交 + 前任已实际孵化的同键替换计入；TTL 过期/重试
       * 烧穿后的纯 churn 重提交不计数（否则能量紧张期止损被虚增基数误触）。
       */
      spawned?: number;
      /**
       * 槽位 key → 前任是否已实际孵化（含孵化中）。spawned 去重与替换判定
       * 的依据；随 plan 生命周期存续，收摊时随 plan 一并清除。运行时字段，
       * 无 schema 变更（遵循 R12 运行时字段先例）。
       */
      spawnedKeys?: Record<string, boolean>;
      /**
       * A5.3 运行时编队需求（遵循 R12 运行时字段先例，无 schema 版本变更）。
       * 由 war-planning-system 写入、war-planner 消费。存在时 war-planner 使用
       * A5.3 能力推导的编队替代旧 decideSquadSize/decideHealerCount；不存在时
       * 退回旧路径（兼容性）。
       */
      a5ForceReq?: {
        attacker: number;
        healer: number;
        tank: number;
        dismantler: number;
        total: number;
      };
    };
    /**
     * 战争失败目标黑名单（v27+，war-planner 写入）：核验结论 failure/unknown 的
     * 目标冷却期内不被 selectWarTarget 重选；到期由 war-planner 清理。
     */
    /**
     * Squad 级战术状态（唯一写者：systems/military/squad-state.commitSquadState）。
     * key = `squad-<sponsor>-<target>@<warPlan.since>`：带 since 是有意的 —— 换一轮行动
     * （换目标或重新立项）就从 FORMING 重来，不把上一支编队撤退时的状态继承给新仗。
     * 为什么必须落 Memory 而不是每 tick 从 warPlan.phase 现推：phase 是波次相位
     * （build/advance），不是战术状态；用它推 state 会让 evaluateTacticalAction 的
     * currentState 恒为 FORMING/MOVING，四道安全闸（regroup / retreat / disengage×2）
     * 在转换表上永远判非法（A9）。
     */
    tacticalSquadStates?: Record<string, { state: string; since: number; updatedAt: number }>;
    warBlacklist?: Record<string, number>;
    /**
     * 战损止损后的整军休战截止（v27+，war-planner 写入）：此 tick 前不创建新战争
     * 计划（黑名单只挡单目标，休战期挡跨目标添油循环）；到期后姿态仍为 war 则重估。
     */
    warStandDownUntil?: number;
    /**
     * 战争计划的情报断供计时（war-planner 写入/清除）：目标房最后一次通过授权那道
     * fact + targetFreshness 门槛之后经过的起点 tick。
     * **刻意不放在 warPlan 里**：warPlan 有两个写者（war-planner 的 legacy 路径与
     * A5.3 的 writeCompatibleWarPlan），后者每轮用全新对象字面量整体重写 plan，
     * 放在 plan 上的字段会被静默冲掉 —— 断供计时被冲零就等于永不撤军（实测 2700 tick
     * 零视野仍在授权）。按房 keyed：换目标即视为重新起算，收摊时随 demobilize 清除。
     */
    warIntelLost?: { room: string; since: number };
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
     * Phase 6 UOEM：OutcomeChannel — Memory 持久化的有界 FIFO 通道。
     * expansion-manager 在终态时 enqueue OutcomeEvent，
     * experience-collector drain() 读取并匹配 operationId。
     * cap=16，压缩字段名，≤3.2KB（冻结契约 PHASE38_B §11）。溢出可观测（不静默丢失）。 */
    outcomeEvents?: import("../kernel/outcome-channel").OutcomeChannelMemory;
    /**
     * A3.4：上一次扩张完成的 tick（Cooldown 门禁）。
     * expansion-manager 在状态机进入 completed 时写入。
     * evaluateExpansionCooldown 消费——完成后冷却窗口内不启动新扩张。
     */
    lastExpansionCompletedTick?: number;
    /**
     * 新生殖民地自举台账（expansion-manager 自举车道写，运行时字段无 schema
     * 变更）：owned 无 spawn 的房 → 冷却/波次/弃房标记。房间建成 spawn 后清除。
     */
    bootstrap?: Record<string, { until: number; waves: number; abandoned?: number }>;
    /** 帝国态势快照（empire-strategy 写，有界）：对手画像 + 命名条件。 */
    situation?: {
      tick: number;
      adversaries: Record<string, { rooms: string[]; lastSeen: number }>;
      conditions: { id: string; severity: number; detail: string }[];
    };
    /** 本次 boot 首个 tick（maintainMemory 记录）—— E2 相对宽限基准。 */
    bootTick?: number;
    /** #62：creep 命名的帝国内单调序号 —— 后缀从 `Math.random` 换成它，长 soak 才可复现。
     *  为什么必须是 Memory 而不是 heap：换码即清 heap，而名字会进目标选择的 hash
     *  （`creeps/support/targeting.ts`）与远矿替补的队列键（`domain/remote/demand.ts`）——
     *  一个跨部署归零的序号让"同初始状态 ⇒ 同名字序列"这条要求失效。
     *  ⚠️Memory 被清时序号从头开始 ⇒ 与场上活 creep 撞名，写者侧留了"撞名再取一号"的兜底。 */
    creepSeq?: number;
    /** 恢复动作烧穿重试预算的持久清单（recovery-execution 写，上限见 ESCALATIONS_CAP）。
     * 为什么落 Memory：判定它的那张 `recoveryActionTable` 是 heap，换码即清 ——
     * 不留这份清单，"哪项恢复反复失败"在部署之后就无人可查。 */
    escalations?: import("../domain/strategy/recovery-lifecycle").EscalationEntry[];
    /** 调优探索的确定性种子（`kernel/deterministic-random.ts`，由 tuning-engine 注入评估层）。
     * **缺省即真随机 ⇒ 生产行为一字不变**；只有测试夹具显式写入时才切换到可复现序列。
     * 走 Memory 而不是替换 `Math.random`：bot 在 @screeps/driver 的 isolated-vm isolate 里跑，
     * isolate 有自己的内建对象，测试进程的替换到不了它（10-01 实测同 seed 两跑世界仍分叉）。 */
    testRandomSeed?: number;
    /** 与 `testRandomSeed` 配套的调用序号（仅落种子时读写）。 */
    testRandomCalls?: number;
    /** 期望自检结果（kernel 写）：最近一次核验的违例清单。 */
    expectations?: {
      tick: number;
      violations: string[];
      /**
       * R265：违例身份留痕。事件 `ExpectationViolation` 只带总数（限流后逐拍不重报），
       * 而 `violations` 是当前 pass 快照 ⇒ 瞬态违例事后无法归因。这里按 id 跨 pass 累计。
       */
      recent?: import("../kernel/expectations").ViolationTrace[];
      e3?: Record<string, unknown>;
      memoryHistory?: { tick: number; bytes: number; roomCount: number }[];
    };
    /** P3 饥饿旁路截止 tick（expectations E2 触发，scheduler 消费）。运行时字段无 schema 变更。 */
    p3StarveBypassUntil?: number;
    /**
     * FINDING-02 修复：ESM (Emergency Survival Mode) 持久化标志。
     * 存 Memory.kernel 而非 globalCache — global reset 后首 tick 仍能正确判定
     * ESM 滞回阈值（进入 <100，退出 >=500）。运行时字段无 schema 变更。
     */
    emergencySurvival?: boolean;
    /**
     * FINDING-11 修复：迁移链快照——migrateMemory 成功执行后记录的最终版本。
     * 新 Memory（schemaVersion=0）但 checkpoint 存在时直接跳到 checkpoint，
     * 避免重跑 45 个迁移。只前进不后退（防止回滚后锁住新版本）。
     */
    migrationCheckpoint?: number;
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
     * PB 野采任务列表（v37+，power-farm-manager 唯一写者）：支持多任务并行。
     * PB 击破后（编队房内视野确认）转 collect 阶段孵 collector 捡运
     * 掉落 power；collector 消失/超时/止损时清除并回收编队。war 姿态时不建
     * （军事资源不双线，warPlan 存续即冻结新任务）。
     * 向后兼容：单任务时数组长度=1。读取代码改为遍历数组。
     */
    powerFarmMissions?: PowerFarmMission[];

    /**
     * 环境画像（P1-3，empire-strategy 每 100 tick 采样写入）：市场活跃度 +
     * 邻居竞争压力 + GCL 进度速率。供策略层调整扩张节奏/市场交易参数。
     * 无 schema 变更（kernel 可选字段，惰性创建）。
     */
    environment?: {
      /** 市场活跃度：active / moderate / thin。 */
      marketActivity: "active" | "moderate" | "thin";
      /** 邻居竞争压力：high / medium / low。 */
      neighborPressure: "high" | "medium" | "low";
      /** GCL 进度速率（progress/tick）。 */
      gclProgressRate: number;
      /** 采样 tick。 */
      tick: number;
      /** 上次采样的 GCL progress（供下次计算速率）。 */
      gclProgress: number;
    };
    /**
     * Empire Economy 瘦快照（A2 后半，empire-economy 每 100 tick 写入）：
     * 帝国级经济聚合指标——总能量/生产/净流/储备/健康度/扩张就绪度/预算。
     * 只存 Summary，不复制完整 RoomState（MEMORY_ARCHITECTURE §4）。
     */
    empireEconomy?: {
      t: number;
      te: number;
      tp: number;
      nf: number;
      tr: number;
      rb: number;
      ef: number;
      h: number;
      dr: number;
      sr: number;
      im: number;
      er: number;
      sm: number;
      eb: number;
      fb: number;
      rr: number;
      // ── A4.2 多资源维度 ──
      /** 多资源帝国健康度编码（0=critical..4=healthy）。 */
      mh: number;
      /** 是否有矿物缺口（0/1）。 */
      md: number;
      /** 瓶颈资源编码（0=energy, 1-7=U/L/K/Z/O/H/X, 99=none）。 */
      bn: number;
      /** 最差矿物健康度编码（0=critical..4=healthy, 4=无矿物数据）。 */
      wmh: number;
    };
    /**
     * A3.0 帝国议程（agenda-manager 每 100t 写入）— 跨房调拨 Operation 生命周期。
     * 只存活跃 + 归档保留期内的终态 Operation；终态超 1000t 清理。
     * 数组上限 = O(active agendas)，通常 ≤ 数条。
     */
    agendas?: unknown[];
    /**
     * A3.0 跨房资源预留表（agenda-manager 每 100t 写入）— 防超卖。
     * key = operationId, value = Reservation（含 TTL）。TTL 过期自动清除。
     */
    reservations?: Record<string, unknown>;
    /**
     * A5 跨房供给合同瘦快照（specialization-planner 写入，logistics-planner 每轮读）。
     * 瘦快照字段是缩写字母（i/s/t/r/…），类型由各读者本地声明；此处只登记「存在且是数组」，
     * 以便领土释放能按房名摘掉条目 —— 它没有 deadline，不摘就永久留在账上。
     */
    supplyContracts?: unknown[];
    /**
     * A3.2 扩张计划列表（expansion-planner 每 interval tick 写入）— 有界列表，
     * 最多 MAX_ACTIVE_PLANS(5) 个 Active Plan + 终态 Plan 保留期内条目。
     * A3.2 只产出 Plan（到 WAITING_EXECUTION），不执行 Claim/Reserve/Bootstrap。
     */
    expansionPlans?: ExpansionPlanMemory[];
    /**
     * A3.2 扩张候选 Registry（expansion-planner 每 interval tick 更新）—
     * 从 Intel 提取的候选房列表，携带评分和生命周期状态。
     * 有界（maxPoolSize=10），超出截断。
     */
    expansionCandidates?: ExpansionCandidateMemory[];
    /**
     * A3.2 扩张 Dashboard 快照（expansion-planner 每 interval tick 写入）—
     * Pressure/Readiness/Budget/Candidates/Plan 汇总，供可观测性消费。
     */
    expansionDashboard?: {
      tick: number;
      summary: string;
      /** 本轮没过的 readiness 闸门名（`G0: posture expansionAllowed` / `G1…` / `G6…`）——
       * 光有 `Readiness=NOT_READY` 判不出该去做哪件事。 */
      failedGates?: string[];
      /** 全量管线这一趟看到的候选总数（截断之前）。
       * `expansionCandidates` 是按数组尾 `slice(0, 10)` 落盘的投影 ⇒ 它的 length 是**下界**；
       * 线上实测同一趟 pass 里仪表盘串报 13、落盘表 10（差值全在被 REJECTED+BLACKLISTED
       * 折叠过的那一档）。没有这两列，读数人会把前缀当全集。 */
      poolTotal?: number;
      /** 被落盘上限切掉、Memory 里读不到的条数（`poolTotal - 已落盘条数`）。 */
      poolCut?: number;
    };
    /**
     * A4.1 远矿经济 Dashboard 快照（remote-mining-manager 每趟聚合一次）—
     * 全链路可观测性：现役/暂停运营数、总交付速率、净营收速率、健康/亏损计数、
     * 线级 CPU 合计，以及 `e/cpu` 比值。
     *
     * 这里**没有** `tp`（总产出）：账本只记交付（`delivered`），产出侧无归属仪器；
     * 要记采出量得另建仪器，不能拿交付当产出（同一名词两种量）。落这一格的来龙去脉见
     * roadmap 补218／补219（此前 `netRate` 与 `cpuPerTick` 只在 heap 与逐条日志里，
     * 读数人要手工回代才能回答"这条远矿线值多少 CPU"，而扩张闸的 CPU 缺口决策正卡在这比值上）。
     */
    remoteEconomyDashboard?: {
      /** 聚合发生的那一拍。 */
      t: number;
      /** 活跃远矿数。 */
      ao: number;
      /** 总交付速率（e/tick，按各自窗口折算后求和）。 */
      td: number;
      /** 总净营收速率（e/tick，`opNetRate` 求和；已扣未回收孵化投入与工事投入）。 */
      nv: number;
      /** 健康运营数（`opProfitable` 为真）。 */
      ho: number;
      /** 亏损运营数（现役但 `opProfitable` 为假——含窗口未满的新线）。 */
      dg: number;
      /** 暂停运营数。 */
      sp: number;
      /** 线级 CPU 合计（/tick，各 op 的 EMA 求和；跨 boot 由 `ledger.c` 带回来）。 */
      cu: number;
      /** 摘要文本（含 e/cpu 比值，CPU 为 0 时写 n/a 而不是除出 Infinity）。 */
      s: string;
    };
  }

  /** A3.3 扩展：扩张执行状态机的完整状态集合。 */
  type ExpansionExecutionState =
    | "validating" // 执行 Gate 验证中
    | "preparing" // 预留资源 + 准备 Claimer
    | "claiming" // Claimer 出发 + claimController（向后兼容旧 claiming）
    | "claimed" // Claim 成功，controller 已拥有
    | "bootstrapping" // Pioneer 到达 + 基础设施建设（向后兼容旧 pioneering）
    | "economic_startup" // 能量环路建立（harvest + transport + spawn）
    | "integrating" // 经济激活 → 帝国集成
    | "completed" // 自主运行
    | "failed" // 执行失败
    | "aborted"; // 主动终止

  /** A3.2 扩张计划的 Memory 瘦结构（只存 ID/枚举/少量数字/短 key）。 */
  interface ExpansionPlanMemory {
    /** 全局唯一 planId。 */
    pid: string;
    /** 候选房名。 */
    rn: string;
    /** Sponsor 房名。 */
    sr: string;
    /** 扩张动机。 */
    rs: string;
    /** 优先级。 */
    pr: string;
    /** 候选评分。 */
    sc: number;
    /** 估算总成本。 */
    tc: number;
    /** 回收周期（tick）。 */
    pb: number;
    /** ROI。 */
    roi: number;
    /** 风险分数。 */
    rk: number;
    /** 风险等级。 */
    rl: string;
    /** Plan 状态（受约束的枚举，不是自由字符串 —— 状态词写错曾被当成"删除计划"）。 */
    st: import("../domain/expansion/plan").PlanStatus;
    /** 创建 tick。 */
    ca: number;
    /** 更新 tick。 */
    ua: number;
    /** 批准 tick。 */
    aa?: number;
    /** 取消原因。 */
    cr?: string;
    /** 连续满足 ready 的起始 tick（防抖计时；旧档缺失即从本轮重新起算）。 */
    rd?: number;
    /** 连续不满足 ready 的起始 tick（READY 降档计时）。 */
    nd?: number;
    /** 决策摘要。 */
    ex: string;
  }

  /** A3.2 扩张候选的 Memory 瘦结构。 */
  interface ExpansionCandidateMemory {
    /** 房名（稳定 key）。 */
    rn: string;
    /** Sponsor 房名。 */
    sr: string;
    /** 房间类型。 */
    k: string;
    /** 房态。 */
    rs: string;
    /** source 数。 */
    sc?: number;
    /** 矿物类型。 */
    mn?: string;
    /** 评分。 */
    s: number;
    /** 距离。 */
    d: number;
    /** 通勤成本。 */
    pc?: number;
    /** 最后观测 tick。 */
    ls: number;
    /** 候选状态。 */
    st: string;
    /** 发现 tick。 */
    da: number;
    /** 评估 tick。 */
    ea?: number;
    /** 否决原因。 */
    vr?: string;
  }

  /** 策略参数 override 条目（empire 级，非 room 级）。 */
  interface StrategyOverrideEntry {
    /** override 值。 */
    value: number;
    /** 写入 tick（冷却检查用）。 */
    adjustedAt: number;
    /** 建议理由（诊断）。 */
    reason: string;
  }

  /** L2 体外建议暂存条目（tuning-intake-system 写入，strategy-reviewer 复核后清空）。 */
  interface IntakePendingEntry {
    /** 经钳制后的建议值。 */
    value: number;
    /** LLM 原始建议值（钳制前，诊断用）。 */
    originalValue: number;
    /** 建议理由。 */
    reason: string;
    /** 摄入 tick。 */
    receivedAt: number;
  }

  /** 参数自调优的持久化状态。 */
  interface TuningMemory {
    /** 上次调优 tick。 */
    lastTuned: number;
    /**
     * 策略参数 override（empire 级姿态参数，strategy-reviewer 写入）。
     * key = 参数路径如 "posture.minDwell"，value = StrategyOverrideEntry。
     * 消费方：empire-strategy.ts 合并到 CONFIG.posture 之上。
     */
    strategyOverrides?: Record<string, StrategyOverrideEntry>;
    /**
     * L2 体外建议暂存（自进化系统 L2）：tuning-intake-system 从 segment 6 读取
     * 外部 LLM 建议包，经护栏校验后写入此字段。strategy-reviewer 在 100t 复盘窗口
     * 复核后清空。不直接消费——需复核通过才写入 strategyOverrides。
     * key = 参数路径，value = IntakePendingEntry。
     */
    intakePending?: Record<string, IntakePendingEntry>;
    /**
     * 生成 rooms 覆盖所基于的 CONFIG.tuning.baselineVersion（P1-I）：tuning-engine
     * 每次评估前比对，不匹配即清空 rooms 覆盖（旧值可能基于过时经济假设）从新基线
     * 收敛；undefined 视为不匹配（首次运行或 v18 迁移后）。
     */
    baselineVersion?: number;
    /** 每房间的调优覆盖值。key = 房间名。 */
    rooms: Record<string, RoomTuningState>;
    /** 每房间最近一次评估的诊断快照（供控制台查看）。key = 房间名。 */
    lastEval?: Record<
      string,
      {
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
        pendingValidations?: Record<
          string,
          {
            adjustTick: number;
            expectedDirection: "improve" | "worsen";
            adjustDirection: "up" | "down";
            contractBlocked?: boolean;
          }
        >;
        /** 改进 A：本次评估时的冻结参数诊断（精简版）。 */
        frozenParams?: Record<
          string,
          {
            frozenUntil: number;
            rollbackCount: number;
            reason: string;
          }
        >;
        /**
         * P1 修复（附录 E.2）：人口合同 blocked 参数诊断 — roleCount 持续未达新边界时
         * 记录 blockedSinceTick，连续 2 个 verifyDelay 窗口仍未达 → 回滚 + 计 1 次回滚。
         */
        blockedParams?: Record<
          string,
          {
            blockedSinceTick: number;
            lastCheckedTick: number;
          }
        >;
      }
    >;
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
     * 进入当前 `state` 的 tick —— 超时/废弃计时的**唯一**合法起点。
     *
     * 为什么不能拿 `lastSeen` 当这个起点：`lastSeen` 是"最后一次看见"（视野/creep
     * 到达时刷新），而"暂停了多久"是另一件事。混用一次的后果是：恢复系统在能量危机
     * 里暂停一个已经失明的 op 时，废弃计时（staleThreshold×3）是从很久以前那次
     * "看见"起算的 —— 恰好在重新拿到视野、本可以恢复的那一刻把矿点判死。
     * 旧 Memory 无此字段时消费端回退 `lastSeen`（保持既有行为，不迁移）。
     */
    stateSince?: number;
    /**
     * 恢复系统的节流请求（**意图**，不是状态）：到期前该 op 不孵化、不扩采。
     *
     * 单写者纪律：只有 recovery-execution-system 写这个字段，只有 op-lifecycle
     * 依据它改 `state`。此前 recovery 直接写 `op.state = "paused"`，与属主的
     * "超时暂停"共用一个状态值 + 一根时钟，结果两个系统逐周期互相撤销对方的写入
     * （recovery 见 active 就暂停、属主见 creep 就恢复），且暂停即可能触发判死。
     */
    recoveryPauseUntil?: number;
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
     * 只增不减会让几个远矿房永久占满 maxNormalLaneSites 饿死自有房重建；
     * construction-manager 全局上限判定读此值（ctx.globalSiteCount + Σ siteCount < maxNormalLaneSites）。
     */
    siteCount?: number;
    /**
     * 本远矿房现存 road construction site 数（跨主房修路车道 roadSitesPerOpTotal 的记账位）。
     * 与 siteCount 同理由 road-planner 每轮实测校正（会递减）— 只增不减会让零进度残骸
     * 永久占满车道（线上实证 W37S54 挂 20/20 且 roads=0）。abandoned 直接写 0。
     */
    roadSiteCount?: number;
    /**
     * 通勤热度跨进程账本：packed 格键（x*50+y 的字符串）→ 累计被踩次数（已衰减、已过门槛）。
     * road-planner 每 roadHeatMergeTicks 合并一次 heap 增量并清空该房 heap。
     * 为什么要落在 Memory：修路落点只认「被走过」，而 heap 每次 global reset 归零 ——
     * 部署间隔短于「攒够 roadMinTileWalks 次」所需的通勤趟数时，证据永远攒不出来。
     * 记在 op 上而非 `Memory.rooms[远矿房]`：后者不在 ownedRooms 集合内，会被失房清理整条删掉。
     */
    roadHeat?: Record<string, number>;
    /** 上一次热度合并的 tick（roadHeat 的窗口时钟，与 roadHeat 同写者）。 */
    roadHeatAt?: number;
    /** 观测：最近一轮热度账里的合格格数、扫掉的残骸数、铺下的新格数（判"为什么没动工"用）。 */
    roadHeatTiles?: number;
    roadReaped?: number;
    roadLaid?: number;
    /**
     * 线外 road site 的冻结计时器（roadStaleReapTicks 窗口）。
     * roadStaleProgressSum = 上一轮「不在热度线上的 road site」进度和；本轮仍然相等即开始/继续
     * 计时（冻满才回收），不等则重新起表。两者同为 undefined 表示上一轮线外没有格。
     */
    roadStaleProgressSum?: number;
    roadStaleSince?: number;
    /**
     * v33 空转止损计时：编队全员空转（idle/flee 或 stuckTicks ≥ stallStuckTicks）
     * 的起始 tick；任一成员恢复工作立即清除。持续超过 CONFIG.remote.stallAbandonTicks
     * → 废弃运营。remote-mining-manager 唯一写者（managerInterval 采样）。
     */
    stallSince?: number;
    /**
     * 路径阻断墙标记 — 远矿通勤路径上检测到 neutral wall（非我方建造的
     * STRUCTURE_WALL）阻断通行时置 true，驱动 demand 孵 dismantler 前往拆除。
     * 有视野时每轮检测刷新；墙被拆除后清除。与 needCoreClear（InvaderCore）
     * 互不干扰：墙阻断的是通勤路径，核心阻断的是 source 采集。
     */
    needWallClear?: boolean;

    // ─── A4.1 扩展：RemoteMiningOperation 关联字段 ────────

    /**
     * A4.1：关联的 RemoteMiningOperation ID（"remote_mining:${homeRoom}:${targetRoom}"）。
     * 渐进迁移：remoteOps 保留为执行器侧扁平结构，此字段关联到
     * globalCache 中的 RemoteMiningOperationContext。undefined = 尚未关联。
     */
    operationId?: string;
    /**
     * A4.1：Remote Operation Checkpoint（"discovered"|"validated"|"prepared"|
     * "infrastructure_ready"|"mining_active"|"logistics_active"|"economic_active"）。
     * 镜像 globalCache 中 RemoteMiningOperationContext.checkpoint。
     */
    checkpoint?: string;
    /**
     * A4.1：Remote Economic Health（"healthy"|"degraded"|"unprofitable"|
     * "suspended"|"failed"）。镜像 globalCache 中
     * RemoteMiningOperationContext.economicHealth。
     */
    economicHealth?: string;
    /**
     * A4.1：预算消耗累计（能量）。镜像 globalCache 中
     * RemoteMiningOperationContext.budget.consumed。
     */
    budgetConsumed?: number;
    /**
     * 实测收支账本（v47+）— 口径见 domain/remote/op-ledger。heap 是实时累加器
     * （creeps 层只写 heap），本字段是跨 global reset 的持久层，
     * remote-mining-manager 唯一写者（每 managerInterval 回写一次）。
     * 短字段：d=delivered / s=spawnCost / r=refund / i=infraCost / w=windowStart。
     * 观测期数据，当前不参与任何开关决策。
     */
    ledger?: {
      d: number;
      s: number;
      r: number;
      i: number;
      w: number;
    };
  }

  interface Memory {
    schemaVersion?: number;
    creeps: Record<string, CreepMemory>;
    rooms: Record<string, RoomMemory>;
    kernel?: KernelMemory;
  }
}
