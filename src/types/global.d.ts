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
    /** 危路急救锁定目标（与 repairTargetId 分离 — 共享缓存会被常规修路/
     * 工事维修写入非危路目标，急救接手会越过链上更紧急的修复）。 */
    urgentRoadId?: Id<_HasId>;
    /** harvester/miner 绑定的 source。 */
    sourceId?: Id<Source>;
    /** remote-harvester 缓存的 source 旁 container ID（避免每 tick lookForAtArea）。 */
    sourceContainerId?: Id<_HasId>;
    /**
     * 远矿 container 的建 site 失败冷却到期 tick（RM-1，P0-A 收编后由 remote-mining-manager 写入）—
     * ERR_FULL/位置冲突等持久失败时放行 dropEnergy，冷却后重试。
     * 冷却只阻断 create 路径（申请），不阻断 build 路径（已有 site 照常建造）。 */
    containerSiteCooldown?: number;
    /**
     * RM-1 / P0-A：远矿 harvester 满载且无 container 时申请建 site 的标记。
     * 由 creep 在 buildSourceContainer execute 写入；remote-mining-manager
     * 消费后清除（成功创建 site 或失败写冷却）。申请期间 resolve 跳过本候选，
     * creep 走 dropEnergy 释放产能，等待 manager 每 managerInterval tick 处理。
     * sourceId 已存于 creep.memory.sourceId，manager 据此定位建 site 位置。 */
    needContainer?: boolean;
    /** 压缩的上次位置（x * 50 + y）用于卡位检测。 */
    lastPos?: number;
    /** 连续未移动的 tick 数。 */
    stuckTicks?: number;
    /**
     * P1-E 档 2：上次 PathFinder.search 重寻路 tick（plan.md §5.7.5）。
     * 同一 creep 两次重寻路间隔 ≥ dynamicRepathInterval，冷却内沿旧路径走一步，
     * 旧路径空则 getDirectionTo 直走降级。absent = 0 → 视为「很久未重算」→
     * 冷却不生效（与改造前行为一致）。per-creep 运行时状态，无需迁移。
     */
    lastRepathAt?: number;
    /** 当前紧凑任务分配。 */
    assignment?: CreepAssignment;
    /** 用于稳定孵化 key 生成和替换跟踪的索引。 */
    spawnIndex?: number;
    /** B1：标记为待回收 — spawn-manager 引导其走向最近 spawn 并 recycleCreep。 */
    recycle?: boolean;
    /**
     * 远程角色目标房 — 远矿/扩张时的工作房间。
     * 设置后 ensureHome 根据 mode + role 决定导航目标：
     *   remoteHauler work 模式 → home（存能），acquire 模式 → remoteTarget（取能）
     *   remoteHarvester/reserver → 始终 remoteTarget
     */
    remoteTarget?: string;
    /** remoteHauler 缓存的远矿 containerId — 避免 每 tick room.find。 */
    remoteContainerId?: Id<StructureContainer>;
    /**
     * Distributor 水位分级档位（0-3）。
     * 由 distributor gate 每 tick 根据 storage 水位计算，
     * 供 withdrawStorageForDistribution 限取和 getDistributorFillTarget 过滤目标使用。
     */
    distributorTier?: 0 | 1 | 2 | 3;
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
     * 经济压力梯度信号 (0.0–1.0)，从 drainScore 派生。
     * 0.0 = 完全健康，1.0 = 完全危机。
     * 各子系统用此信号做梯度缩放，替代二值 crisis/normal 开关。
     *   - demand: 缩放 upgrader/builder 目标数量
     *   - construction: 调整建造能量门禁阈值
     *   - tower: 调整修墙能量门槛
     */
    economyPressure?: number;
    controllerDowngradeRisk?: boolean;
    /**
     * 上一 tick 是否处于紧急状态（P1-2 边沿触发用）。
     * assignment-service 仅在「正常 → 紧急」上升沿失效普通任务，
     * 持续紧急期间不重复失效，避免每 tick 清空 assignment 抖动。
     */
    wasEmergency?: boolean;
    /**
     * 上次触发任务抢占的 tick（TD-018 冷却机制）。
     * assignment-service 在抢占触发后写入，距上次抢占至少间隔 20 tick 才能再次触发，
     * 防止房间在紧急/正常之间快速交替时每个上升沿都 invalidate assignment。
     */
    lastPreemptTick?: number;
    /**
     * 最近一次房内出现威胁 creep 的 tick（v12+，room-state 写入）。
     * 受袭记忆：驱动防御姿态（如 wall/rampart 目标血量升档）—
     * 防御深度用真实威胁校准，而非静态假设。
     */
    lastHostileAt?: number;
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
      harvesterCount: number;
      sourceCount: number;
      rcl: number;
    };
    /**
     * Storage 能量超过 storageFullThreshold 时为 true。
     * 由 room-state 每 tick 计算，供 spawn-manager 限采 + demand 加速消费。
     */
    storageNearFull?: boolean;
    spawnQueue?: SpawnRequest[];
    /**
     * 孵化请求黑名单（SP-2）：key → 冷却到期 tick。
     * cleanQueue 因重试上限清除的请求 key 在冷却期内不得重建 —
     * 打破「5 次失败 → 删除 → demand 重建 → 再 5 次」的翻炒循环。
     * 与 construction 的 segment blocked 黑名单同型（范本先例）。
     */
    spawnBlacklist?: Record<string, number>;
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
       * P1-F：4-stage 规划分片状态（v17+）。
       * - 0：空闲（等待 nextPlanTick）或未启动规划
       * - 1：stage 0 已完成（prep），待跑 stage 1（核心结构）
       * - 2：stage 1 已完成，待跑 stage 2（物流结构）
       * - 3：stage 2 已完成，待跑 stage 3（道路 + 收尾）
       *
       * 跨 tick 中间产物放 globalCache（distance field 等大对象不进 Memory）。
       * global reset 丢失 planStageData 时，下 tick 检测 planStage>0 但无 data
       * → 重置为 0 重新开始（最多损失一个规划周期）。
       */
      planStage?: 0 | 1 | 2 | 3;
      // 冷数据 overrides / blocked 已迁移到 RawMemory segment 0（见 kernel/segment-store.ts）。
      // 保留可选字段用于 v3→v4 迁移兼容。
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
    /**
     * Builder pressure 迟滞状态（TD-016）。
     * full: 经济健康，builder 满目标；shrinking: 经济承压，builder 线性收缩。
     * 进入收缩：pressure > 0.35；退出收缩：pressure <= 0.25；带内保持不变。
     */
    builderPressureState?: 'full' | 'shrinking';
    /**
     * Distributor 扩编需求首次出现的 tick（升编趋势确认）。
     * 需求持续超过 CONFIG.spawn.distributorScaleUpDelay 才允许超出现有编制扩编；
     * 需求回落即清除。防止 spawn 孵化瞬间的 fillTargets 尖峰催生过量 distributor。
     */
    distScaleUpSince?: number;
    /**
     * 远矿运营 — 从本房管理的远程采矿操作。key = 目标房名。
     * 由 remote-mining-manager 每 10 tick 评估/更新。
     */
    remoteOps?: Record<string, RemoteOp>;
  }

  interface KernelMemory {
    tier?: CpuTier;
    recoveryTicks?: number;
    skipReasons?: Record<string, number>;
    /**
     * 最近一次 generatePixel 的 tick（自愿放血协议）。
     * pixel 吃光整个 bucket（10000），宽限窗口内 scheduler 把 tier 地板
     * 抬到 conserve — 防止看门狗把自愿放血误判为 CPU 失控进入 recovery，
     * 冻结 P2 经济角色数百 tick。
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
     * 当前扩张行动（v11+，同一时刻至多一个）。
     * expansion-manager 的状态机：claiming（claimer 在途）→ pioneering（拓荒编队建 spawn）。
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
     * 帝国姿态（v13+，empire-strategy 每 tick 评估写入）。
     * Strategy 层的全局真相源：执行系统（扩张/远矿/未来进攻）只消费
     * 此处的指令，不得自行裁决「是否该扩张/开战」。
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
    };
    /**
     * 失守房间记录（v11+）：房名 → 首次检测到失守的 tick。
     * maintainMemory 据此在宽限期后清除 Memory.rooms 条目，
     * 防止失守房的队列/布局/情报数据永久滞留。
     */
    lostRooms?: Record<string, number>;
  }

  /** 参数自调优的持久化状态。 */
  interface TuningMemory {
    /** 上次调优 tick。 */
    lastTuned: number;
    /**
     * 生成当前 rooms 覆盖所基于的 CONFIG.tuning.baselineVersion（P1-I）。
     * tuning-engine 每次评估前比对：不匹配时清空 rooms 覆盖（旧值可能
     * 基于过时经济假设），写入当前 CONFIG 值，自调优从新基线重新收敛。
     * undefined 视为不匹配（首次运行或 v18 迁移后）。
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
      /** 本次评估产生的趋势记录（P1-1 调整置信度）。 */
      trend?: Record<string, "up" | "down" | "none">;
    }>;
  }

  /**
   * 单个远矿运营记录（存 RoomMemory.remoteOps，短字段、有界）。
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
     * InvaderCore 压制冷却截止 tick。
     * 压制判定不能只依赖当 tick 视野：发现核心 → 回收 creep → 视野消失 →
     * 瞬时检测集合清空 → 孵化恢复 → 新 creep 送死，形成
     * 「孵化→发现→回收→失明→再孵化」死循环。持久化后冷却期内孵化保持冻结；
     * 到期恢复孵化探测，若核心仍在（新 creep 带回视野）则续期。
     * 有视野且确认核心消失时立即清除（提前解封）。
     */
    blockedUntil?: number;
    /**
     * 普通威胁冷却截止 tick（RM-2，与 blockedUntil 同款双轨）。
     * 有视野见威胁写入/续期；有视野确认清空立即清除；无视野时冷却期内
     * 维持威胁态 — 防「威胁 → 失明 → 恢复孵化 → 送死」循环送兵。
     */
    threatUntil?: number;
    /**
     * P1-G：危险冷却到期 tick（v16+，从 intel.dangerUntil 迁移至此）。
     * 远矿房出现威胁（hostile creep / InvaderCore）或被敌方预定时由
     * remote-mining-manager 唯一写入。冷却期内该房不作为远矿/扩张候选（止损）。
     * 迁移原因：intel 的写者除 remote-mining-manager 外还有 room-observer
     * 透传链（domain/intel.ts 的 prev 保留逻辑），双写者加一个写者就崩；
     * remoteOps 的唯一写者本就是 remote-mining-manager，字段搬家后单一写者。
     */
    dangerUntil?: number;
    /**
     * 经济重估：netScore 首次跌破门槛的 tick（A-3/B-6）。
     * active op 每轮维护重算 netScore/haulerNeed（用当前 pathCost + body 运力）；
     * 连续低于门槛超过宽限期才废弃 —— 抗抖动，防单次波动误撤边际 op。
     * netScore 回升到门槛以上时清除。
     */
    lowScoreSince?: number;
    /**
     * P0-A：本远矿房我方创建的 container construction site 数量（v15+）。
     * 由 remote-mining-manager 每 managerInterval tick 用 lookForAtArea 实测校正 —
     * site 建成（变结构）/被移除/失效时递减，新建时递增。
     * 只增不减会导致几个远矿房永久占满 maxGlobalSites 饿死自有房重建。
     * construction-manager 的全局上限判定读此值：ctx.globalSiteCount + Σ siteCount < maxGlobalSites。
     */
    siteCount?: number;
  }

  interface Memory {
    schemaVersion?: number;
    creeps: Record<string, CreepMemory>;
    rooms: Record<string, RoomMemory>;
    kernel?: KernelMemory;
  }
}
