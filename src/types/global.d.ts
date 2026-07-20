export {};

declare global {
  type CreepMode = "acquire" | "work" | "idle" | "flee";
  type ColonyState = "bootstrap" | "recovery" | "normal" | "defense";

  interface CreepAssignment {
    id: string;
    kind: "harvest" | "haul" | "fill" | "upgrade" | "build" | "repair" | "reserve";
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
    /** 遗留 working 标志 — 保留用于迁移兼容。 */
    working?: boolean;
    /** 稳定工作目标 id；目标不存在时清除。 */
    targetId?: Id<_HasId>;
    /** harvester/miner 绑定的 source。 */
    sourceId?: Id<Source>;
    /** 压缩的上次位置（x * 50 + y）用于卡位检测。 */
    lastPos?: number;
    /** 连续未移动的 tick 数。 */
    stuckTicks?: number;
    /** 当前紧凑任务分配。 */
    assignment?: CreepAssignment;
    /** 用于稳定孵化 key 生成和替换跟踪的索引。 */
    spawnIndex?: number;
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
  }

  interface RoomMemory {
    colonyState?: ColonyState;
    controllerDowngradeRisk?: boolean;
    spawnQueue?: SpawnRequest[];
    buildQueue?: BuildTask[];
    lastRcl?: number;
    layout?: {
      version: number;
      templateId: string;
      state: "proposed" | "accepted" | "building" | "blocked" | "manual";
      anchor?: number;
      revision: number;
      nextPlanTick: number;
    };
  }

  interface KernelMemory {
    tier?: "healthy" | "guarded" | "conserve" | "recovery";
    recoveryTicks?: number;
    skipReasons?: Record<string, number>;
  }

  interface Memory {
    schemaVersion?: number;
    creeps: Record<string, CreepMemory>;
    rooms: Record<string, RoomMemory>;
    kernel?: KernelMemory;
  }
}
