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
  readonly storage: StructureStorage | undefined;
  readonly sources: readonly Source[];
  readonly constructionSites: readonly ConstructionSite[];
  readonly myConstructionSites: readonly ConstructionSite[];
  readonly hostileCreeps: readonly Creep[];
  readonly energyAvailable: number;
  readonly energyCapacityAvailable: number;
  /** 可接收能量的结构（有空闲容量的 spawn + extension）。 */
  readonly fillTargets: readonly (StructureSpawn | StructureExtension)[];
  /** 当房间没有 spawn 或没有可采集的 creep 时为 true。 */
  readonly needsRecovery: boolean;
  /** 每个.source ID 对应的已分配 creep 数量（用于免全局扫描的负载均衡）。 */
  readonly sourceOccupancy: ReadonlyMap<string, number>;
  /** 房间内的 mineral（供布局验证使用）。 */
  readonly minerals: readonly Mineral[];
}

/** 传递给每个系统和角色的不可变单 tick 上下文。 */
export interface TickContext {
  readonly tick: number;
  readonly budget: Budget;
  readonly colonyState: ColonyState;
  getSnapshot(roomName: string): RoomSnapshot | undefined;
  snapshots(): Iterable<RoomSnapshot>;
}
