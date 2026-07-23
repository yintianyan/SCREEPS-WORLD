/** 内核、系统和角色共享的核心契约。 */

export type Priority = 0 | 1 | 2 | 3 | 4;

/** 由 bucket 水位驱动并带滞回的 CPU 性能档位。 */
export type CpuTier = "healthy" | "guarded" | "conserve" | "recovery";

/** 殖民地生命周期状态 — 驱动孵化和建造门禁。 */
export type ColonyState = "bootstrap" | "recovery" | "normal" | "defense";

/** 所有角色共享的 creep 行为模式。 */
export type CreepMode = "acquire" | "work" | "idle" | "flee";

/** assignment-service 可分发的任务类型。 */
export type TaskKind =
  | "harvest"
  | "haul"
  | "fill"
  | "upgrade"
  | "build"
  | "repair"
  | "reserve";

export interface System {
  readonly name: string;
  readonly priority: Priority;
  /** 最多每 N tick 运行一次（1 = 每 tick）。 */
  readonly interval?: number;
  run(ctx: TickContext): void;
}

export interface CreepRole {
  readonly name: string;
  readonly priority: Priority;
  run(creep: Creep, ctx: TickContext): void;
}

/**
 * CPU 预算 — 判断工作是否可以开始的唯一真相来源。
 * 硬上限是最后防线；软上限限流非 P0 工作。
 */
export interface Budget {
  readonly tier: CpuTier;
  readonly softLimit: number;
  readonly hardLimit: number;
  canStart(priority: Priority): boolean;
  isExhausted(): boolean;
  spent(): number;
}

/** 每 tick 每房执行一次的扫描；供所有系统和角色消费。 */
export interface RoomSnapshot {
  readonly roomName: string;
  readonly rcl: number;
  readonly controller: StructureController | undefined;
  readonly spawns: readonly StructureSpawn[];
  readonly extensions: readonly StructureExtension[];
  readonly towers: readonly StructureTower[];
  readonly containers: readonly StructureContainer[];
  readonly roads: readonly StructureRoad[];
  readonly walls: readonly StructureWall[];
  readonly ramparts: readonly StructureRampart[];
  readonly storage: StructureStorage | undefined;
  /** controller 旁 1 格内的 container（upgrader 站桩升级的能量来源）。无则 undefined。 */
  readonly controllerContainer: StructureContainer | undefined;
  /** 房间内所有 link 结构。RCL5+ 解锁，link 系统用于瞬时能量传输。 */
  readonly links: readonly StructureLink[];
  readonly sources: readonly Source[];
  readonly constructionSites: readonly ConstructionSite[];
  readonly myConstructionSites: readonly ConstructionSite[];
  readonly hostileCreeps: readonly Creep[];
  /**
   * 真正的威胁 creep（hostileCreeps 中具备 ATTACK/RANGED_ATTACK/HEAL/WORK/CLAIM 且非联盟者）。
   * 防御决策（逃跑 / 停建造 / 抢占 / 开火 / safe mode）应消费此字段而非 hostileCreeps，
   * 避免过境 scout / reserver 冻结经济。
   */
  readonly threatCreeps: readonly Creep[];
  readonly energyAvailable: number;
  readonly energyCapacityAvailable: number;
  /** 可接收能量的结构（有空闲容量的 spawn + extension + tower + controller container）。 */
  readonly fillTargets: readonly (StructureSpawn | StructureExtension | StructureTower | StructureContainer)[];
  /** 当房间没有 spawn 或没有可采集的 creep 时为 true。 */
  readonly needsRecovery: boolean;
  /** 每个.source ID 对应的已分配 creep 数量（用于免全局扫描的负载均衡）。 */
  readonly sourceOccupancy: ReadonlyMap<string, number>;
  /**
   * 已存在但尚未计入 sourceOccupancy 的 harvester/worker 数量。
   * 包括：(1) 已存活但尚未分配 sourceId 的新 harvester，(2) 正在孵化中的 harvester/worker。
   * 由 Kernel 预构建，供 room-state 的 harvesterCount 使用，避免替换期间的假 bootstrap。
   */
  readonly pendingHarvesters: number;
  /**
   * 本房 creep 身上携带的能量总和（memory.home 归属本房）。
   * 用于让 room-state 的 reserve 计入在途能量，避免物流搬运造成危机信号抖动（P1-5 ①）。
   * 由 Kernel 复用 Game.creeps 遍历结果预构建；缺省视为 0。
   */
  readonly creepEnergy?: number;
  /** 房间内的 mineral（供布局验证使用）。 */
  readonly minerals: readonly Mineral[];
  /** 房间内所有 lab 结构。RCL6+ 解锁，用于化合物反应和 creep boost。 */
  readonly labs: readonly StructureLab[];
  /** 房间 terminal（RCL6+ 解锁）。用于多房间资源调度。 */
  readonly terminal: StructureTerminal | undefined;
  /** 房间 extractor（RCL6+ 解锁）。用于 mineral 采集。 */
  readonly extractor: StructureExtractor | undefined;
  /** 房间 factory（RCL7+ 解锁）。用于商品压缩/生产。 */
  readonly factory: StructureFactory | undefined;
  /** 地上掉落的能量资源（FIND_DROPPED_RESOURCES 中类型为 energy 的）。 */
  readonly droppedEnergy: readonly Resource[];
  /**
   * 预计算的关键维修目标（血量 < 50% 的 spawn/extension/tower/container）。
   * 在 buildRoomSnapshot 中一次遍历得出，供 tower-defense 和 builder actions 复用，
   * 避免各模块重复迭代 snapshot.spawns/extensions/towers/containers。
   */
  readonly criticalRepairTarget?: AnyStructure | undefined;
}

/** 传递给每个系统和角色的不可变单 tick 上下文。 */
export interface TickContext {
  readonly tick: number;
  readonly budget: Budget;
  /** 全局活跃建造 site 总数 — 在 buildSnapshots 阶段预计算，供 construction-manager 消费。 */
  readonly globalSiteCount: number;
  getSnapshot(roomName: string): RoomSnapshot | undefined;
  snapshots(): Iterable<RoomSnapshot>;
}
