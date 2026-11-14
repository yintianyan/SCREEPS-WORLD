/**
 * 能量流规划（FlowTask / FlowPlanner）的类型定义。
 *
 * Phase 0 只做纯数据与纯函数，不访问 Game/Memory/globalCache。
 * 设计来源：`.trae/documents/能量流任务分配机制设计（FlowTask+FlowPlanner）.md`。
 */

/** 能量流车道：core=孵化池、tower=防御、upgrade=升级链、lab/terminal=工业。 */
export type FlowLane = "core" | "tower" | "upgrade" | "lab" | "terminal";

export interface FlowPoint {
  readonly x: number;
  readonly y: number;
}

/** link 图节点 — 位置用于计算 cooldown；能量/容量字段留作后续扩展。 */
export interface FlowLinkNode {
  readonly id: string;
  readonly pos: FlowPoint;
  readonly energy?: number;
  readonly capacity?: number;
}

/**
 * 单个汇的流量需求。
 *
 * 汇是「一组结构」（如 spawn+extension 池、controller link/cc），
 * 任务执行时再由 targetSelector 解析具体结构；Phase 0 只算速率与承运人数。
 */
export interface FlowSinkDemand {
  /** 稳定任务 id 的一部分：deliver:<room>:<lane>:<groupId>。 */
  readonly groupId: string;
  readonly lane: FlowLane;
  /** 数字越小越优先：core=0、tower=1、upgrade=2、lab=3、terminal=4。 */
  readonly priority: number;
  /** 期望到达速率 e/tick（由上游需求计算，planner 只做分配）。 */
  readonly demandPerTick: number;
  /** link 中继的源（如 storage link）；无则纯 creep。 */
  readonly linkFromId?: string;
  /** link 中继的目标（如 controller link）。 */
  readonly linkToId?: string;
  /** 灌 link 的承运人往返 tick（1 格通常 6）。linkFromId 存在时使用。 */
  readonly linkFeederRoundTripTicks?: number;
  /** 该 link 源是否由 storage 经承运人灌入（默认 true）。 */
  readonly linkSourceIsStorageFed?: boolean;
  /** 源侧直送该汇的额外供给（如 source link 直供 controller），不消耗 storage。 */
  readonly externalSupplyPerTick?: number;
  /** creep 取能源 id（storage/container）。 */
  readonly creepSourceId?: string;
  /** creep 往返 tick。 */
  readonly creepRoundTripTicks?: number;
  /** Phase 2：该汇最多占用的承运人数（core 固定 1 只慢速回填，不抢 upgrade）。 */
  readonly carrierCap?: number;
}

/** 承运人池 — Phase 0 用统一池；后续按 lane/role 细分为多池。 */
export interface FlowCarrierPool {
  readonly count: number;
  readonly carry: number;
  readonly roundTripTicks: number;
}

export interface FlowPolicy {
  /** storage 保留地板；可流出量 = storageEnergy - storageFloor。 */
  readonly storageFloor: number;
  /** link 单次容量，默认 800。 */
  readonly linkCapacity?: number;
  /** 每跳损耗，默认 0.03。 */
  readonly linkLossRatio?: number;
  /** 每 lane 最多承运人数，防止一条长距流吃光全局。 */
  readonly maxCarriersPerLane?: number;
}

export interface FlowPlannerInput {
  readonly tick: number;
  readonly storageEnergy: number;
  readonly storageId?: string;
  readonly sinks: readonly FlowSinkDemand[];
  readonly links: readonly FlowLinkNode[];
  readonly carrierPool: FlowCarrierPool;
  readonly policy: FlowPolicy;
}

export interface FlowAllocation {
  readonly lane: FlowLane;
  readonly groupId: string;
  readonly via: "link" | "creep";
  readonly fromId: string;
  /** link 路径时是目标 link id；creep 时是 groupId。 */
  readonly toId: string;
  /** 到达速率 e/tick（link 已扣损耗）。 */
  readonly rate: number;
  readonly carriersNeeded: number;
  readonly priority: number;
}

export type FlowUnmetReason = "no-link" | "no-carrier" | "no-source" | "preempted";

/**
 * 未满足需求 — **诊断输出**。
 *
 * 补员的唯一 owner 是 `spawn-manager` 的 distributor/ccFill 反馈（见 demand.ts 的
 * ccFill 分支）；FlowPlanner 不据此二次发孵化请求，避免两套编制信号互相放大。
 */
export interface FlowUnmet {
  readonly lane: FlowLane;
  readonly groupId: string;
  readonly rate: number;
  readonly reason: FlowUnmetReason;
}

/**
 * 单房流量计划。
 *
 * 只输出 lane 分配与 unmet；**link 传输执行归 `link-system` 独占**（它只做单跳，
 * 且有自己的 controller target 逻辑）。FlowPlanner 不再输出可执行的 linkTransfers，
 * 也不输出 spawnNeeds —— 编制估算归 `spawn-manager` 的 estimateUpgradeFeed。
 */
export interface RoomFlowPlan {
  readonly tick: number;
  readonly allocations: readonly FlowAllocation[];
  readonly unmet: readonly FlowUnmet[];
  /** 所有 creep 车道分配的到达速率合计。 */
  readonly totalCreepRate: number;
}
