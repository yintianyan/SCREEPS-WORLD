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
    /** harvester/miner 绑定的 source。 */
    sourceId?: Id<Source>;
    /** remote-harvester 缓存的 source 旁 container ID（避免每 tick lookForAtArea）。 */
    sourceContainerId?: Id<_HasId>;
    /** 压缩的上次位置（x * 50 + y）用于卡位检测。 */
    lastPos?: number;
    /** 连续未移动的 tick 数。 */
    stuckTicks?: number;
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
     * 远矿运营 — 从本房管理的远程采矿操作。key = 目标房名。
     * 由 remote-mining-manager 每 10 tick 评估/更新。
     */
    remoteOps?: Record<string, RemoteOp>;
  }

  interface KernelMemory {
    tier?: CpuTier;
    recoveryTicks?: number;
    skipReasons?: Record<string, number>;
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
    /** 创建 tick。 */
    createdAt: number;
    /** 最近可见 tick（creep 进入或 observer 扫描时更新）。 */
    lastSeen: number;
  }

  interface Memory {
    schemaVersion?: number;
    creeps: Record<string, CreepMemory>;
    rooms: Record<string, RoomMemory>;
    kernel?: KernelMemory;
  }
}
