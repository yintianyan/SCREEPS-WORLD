/** 内核、系统和角色共享的核心契约。 */

export type Priority = 0 | 1 | 2 | 3 | 4;

/** 由 bucket 水位驱动并带滞回的 CPU 性能档位。 */
export type CpuTier = "healthy" | "guarded" | "conserve" | "recovery";

/** 殖民地生命周期状态 — 驱动孵化和建造门禁。 */
export type ColonyState = "bootstrap" | "recovery" | "normal" | "defense";

/** 所有角色共享的 creep 行为模式。 */
export type CreepMode = "acquire" | "work" | "idle" | "flee";

/**
 * 防御工事角色分层 — 决定 wall/rampart 的维护目标档位。
 * perimeter: min-cut 割集 / 出口封锁线 — 敌人必啃的门，全额目标；
 * core: 核心结构叠盾（spawn/extension/storage/tower/link）— 只需撑过「周界已破 →
 *   塔与 defender 处理」的窗口，全额的一个折扣档；
 * utility: 低值资产叠盾（container 等）— 保护对象价值低于全额维护成本，仅维持新生急救地板。
 */
export type FortificationRole = "perimeter" | "core" | "utility";

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
  /** 执行阶段：main（缺省）在角色之前，post 在所有角色之后 —
   * 供「消费角色执行期产出的 per-tick 数据」的系统使用（如 traffic-manager 解算移动意图）。 */
  readonly phase?: "main" | "post";
  /**
   * Recovery / 关键基建缺失豁免自报钩子（P1-F）。
   * 返回 true 时，kernel 在 budget 拦截前将其优先级等效提升为 P1，确保紧急重建
   * 路径在任何 CPU 档位下都能运行。kernel 只读此钩子，不硬编码系统名
   * （plan.md §2.1：内核不感知具体业务）。
   * 典型实现：construction-manager（buildQueue 有 P0 queued 关键基建）/
   * layout-planner（任一 snapshot 命中 assessEmergencyRebuild().any）。
   */
  readonly recoveryEligible?: (ctx: TickContext) => boolean;
  run(ctx: TickContext): void;
}

export interface CreepRole {
  readonly name: string;
  readonly priority: Priority;
  /**
   * Recovery 豁免自报（R3a）：recovery 时 P2+ 角色默认被 colony-state 门禁跳过；
   * 声明 true 的角色视为「生存/脱困路径」，recovery 时仍执行并以 P1 等效优先级
   * 通过 CPU budget。kernel 只读此标志，不感知具体角色名。
   * 典型实现：builder（重建被毁基建）/ mineralMiner（矿物收入不耗能量）。
   * 注意：bootstrap 一律不豁免（保命孵化优先）。
   */
  readonly recoveryEligible?: boolean;
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
  /** 真正的威胁 creep（hostileCreeps 中具备 ATTACK/RANGED_ATTACK/HEAL/WORK/CLAIM 且非联盟者）。
   * 防御决策应消费此字段而非 hostileCreeps，避免过境 scout/reserver 冻结经济。 */
  readonly threatCreeps: readonly Creep[];
  /** 小队威胁在场（M11 威胁分级：≥2 武装或武装+治疗组合）。
   * 触发战时集结避险与 defender 双编制 P0 响应。 */
  readonly squadThreat: boolean;
  readonly energyAvailable: number;
  readonly energyCapacityAvailable: number;
  /** 可接收能量的结构（有空闲容量的 spawn + extension + tower + controller container）。 */
  readonly fillTargets: readonly (StructureSpawn | StructureExtension | StructureTower | StructureContainer)[];
  /** 当房间没有 spawn 或没有可采集的 creep 时为 true。 */
  readonly needsRecovery: boolean;
  /** 每个.source ID 对应的已分配 creep 数量（用于免全局扫描的负载均衡）。 */
  readonly sourceOccupancy: ReadonlyMap<string, number>;
  /** 已存在但尚未计入 sourceOccupancy 的 harvester/worker 数量：
   * 已存活未分配 sourceId 的 + 孵化中的。Kernel 预构建，供 room-state 的
   * harvesterCount 使用，避免替换期间的假 bootstrap。 */
  readonly pendingHarvesters: number;
  /** 本房 creep 身上携带的能量总和（memory.home 归属本房）。
   * room-state 的 reserve 计入在途能量，避免物流搬运造成危机信号抖动（P1-5 ①）。
   * Kernel 复用 Game.creeps 遍历预构建；缺省视为 0。 */
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
  /** 房间 observer（RCL8 解锁，可选 — 多数房间/测试快照不存在）。用于远程房间视野（intel 采集）。 */
  readonly observer?: StructureObserver | undefined;
  /** 房间 powerSpawn（RCL8 解锁，可选 — 多数房间/测试快照不存在）。用于 processPower 积累 GPL。 */
  readonly powerSpawn?: StructurePowerSpawn | undefined;
  /** 房间 nuker（RCL8 解锁，可选）。核打击威慑结构，占用 3×3（放置器按单格候选，与 spawn 同级处理）。 */
  readonly nuker?: StructureNuker | undefined;
  /** 地上掉落的能量资源（FIND_DROPPED_RESOURCES 中类型为 energy 的）。 */
  readonly droppedEnergy: readonly Resource[];
  /** 含能量的坟墓（creep 死亡遗留）。坟墓消失后能量转掉落堆继续衰减 —
   * 与掉落能量同属「衰减中的遗留资源」，hauler 应优先于 container 回收大额堆。 */
  readonly tombstones: readonly Tombstone[];
  /** 含能量的废墟（建筑被毁/拆除遗留，如全拆重建时 storage 库存整体进入 ruin）。
   * 有 decay 期限，到期资源灭失 — 大额废墟是限时可回收的库存。 */
  readonly ruins: readonly Ruin[];
  /** 预计算的关键维修目标（血量 < 50% 的 spawn/extension/tower/container）。
   * buildRoomSnapshot 一次遍历得出，供 tower-defense 和 builder actions 复用，
   * 避免各模块重复迭代。 */
  readonly criticalRepairTarget?: AnyStructure | undefined;
  /** 本房 nuke 落点预警（FIND_NUKES，自有房视野内常量查询）。可选 — 旧测试
   * mock 缺省视为无警报；消费者统一用 `?.length` 判空（审计缺口 1 感知层）。 */
  readonly incomingNukes?: readonly Nuke[];
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
