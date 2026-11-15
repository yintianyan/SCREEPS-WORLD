/** AgendaItem 类型定义 */

/**
 * 操作类型（扩展新增：claim + colonize + remote_mining）。

 * - supply:        资源调拨（已实现）
 * - claim:         获取 Controller 所有权（新增）
 * - colonize:      建立经济——从 Spawn 到 Autonomous Room（新增）
 * - remote_mining: 远矿采集运营（新增）
 */
export type OperationType = "supply" | "claim" | "colonize" | "remote_mining";

/** 操作状态机九态（AgendaItem 生命周期）。 */
export type OperationStatus =
  | "planned"
  | "ready"
  | "running"
  | "verifying"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "expired";

/** 操作优先级（0=最高 survival / 1=high / 2=normal / 3=low）。 */
export type OperationPriority = 0 | 1 | 2 | 3;

/**
 * 资源类型 — 从 energy-only 扩展为多资源联合类型。

 * 规划路径：`"energy" | MineralResourceType | CommodityResourceType`。
 * 第一步：加入 `MineralConstant`（7 种基础矿物）。
 * 后续阶段加入矿物化合物 / 商品类型。

 * `MineralConstant` 是 Screeps 引擎全局 `declare type`（无需 import）：
 *   RESOURCE_UTRIUM | RESOURCE_LEMERGIUM | RESOURCE_KEANIUM |
 *   RESOURCE_ZYNTHIUM | RESOURCE_OXYGEN | RESOURCE_HYDROGEN | RESOURCE_CATALYST

 * 向后兼容：`"energy"` 仍是合法值，现有代码零改动。
 */
export type ResourceType = "energy" | MineralConstant;

/**
 * OperationContext — AgendaItem 的运行时上下文。

 * 瘦结构：只存必要字段，终态归档后删除。
 * 不存完整路径/历史/运行时索引。
 */
export interface OperationContext {
  /** 幂等键："supply:${from}:${to}:${resource}"。 */
  id: string;
  /** 操作类型。 */
  type: OperationType;
  /** 当前状态。 */
  status: OperationStatus;
  /** 源房名（调出方）。 */
  sourceRoom: string;
  /** 目标房名（调入方）。 */
  targetRoom: string;
  /** 请求总量。 */
  requestedAmount: number;
  /** 已送达量。 */
  deliveredAmount: number;
  /** 已预留量（Reservation 跟踪）。 */
  reservedAmount: number;
  /** 优先级。 */
  priority: OperationPriority;
  /** 资源类型。 */
  resource: ResourceType;
  /** 截止 tick（超时 → expired）。 */
  deadline: number;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近状态变更 tick。 */
  updatedAt: number;
  /** 当前重试次数。 */
  retries: number;
  /** 最大重试次数。 */
  maxRetries: number;
  /** 失败冷却到期 tick（重试上限到达后进入冷却）。 */
  cooldownUntil?: number;
  /** 上次错误原因（诊断用，终态归档时清除）。 */
  lastError?: string;
  /**
   * Operation 进入 running 时记录的 target 房 storage 能量基线。
   * 验证阶段用 currentEnergy - baseline 计算实际增量。
   * -1 表示未设置（Operation 尚未进入 running）。
   */
  baselineEnergy?: number;
  /**
   * 分配给本 Operation 的 carrier creep 名称（spawn 成功后填充）。
   * 用于 carrier 死亡检测和重规划。
   */
  carrierName?: string;
  /**
   * 绑定载体连续在端房之外 idle 的 agenda 趟数（每趟 100 拍）。
   * 用于识别「活得着但回不了家」的失联载体：2 趟后摘绑定并重绑/补孵。
   */
  carrierIdleTicks?: number;
}

/**
 * 生成幂等键：supply:${from}:${to}:${resource}。
 * 同一对 (from, to, resource) 只允许一个活跃 Operation。
 */
export function makeOperationId(
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
): string {
  return `supply:${sourceRoom}:${targetRoom}:${resource}`;
}

/**
 * 创建新 OperationContext（初始状态 = planned）。

 * 纯函数 — 不访问 Game/Memory。
 */
export function createOperation(
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
  requestedAmount: number,
  priority: OperationPriority,
  deadline: number,
  tick: number,
  maxRetries = 3,
): OperationContext {
  return {
    id: makeOperationId(sourceRoom, targetRoom, resource),
    type: "supply",
    status: "planned",
    sourceRoom,
    targetRoom,
    requestedAmount,
    deliveredAmount: 0,
    reservedAmount: 0,
    priority,
    resource,
    deadline,
    createdAt: tick,
    updatedAt: tick,
    retries: 0,
    maxRetries,
  };
}

/**
 * 判断操作是否处于终态（归档后可删除）。
 */
export function isTerminalStatus(status: OperationStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "expired"
  );
}

/**
 * 判断操作是否活跃（非终态）。
 */
export function isActive(op: OperationContext): boolean {
  return !isTerminalStatus(op.status);
}

/**
 * 判断操作是否已超时（当前 tick > deadline）。
 */
export function isExpired(op: OperationContext, tick: number): boolean {
  return tick > op.deadline;
}

// ─── claim + colonize Operation 创建 ──────────────────

/**
 * 创建 Claim Operation（获取 Controller 所有权）。



/**
 * 创建 Colonize Operation（建立经济——从 Spawn 到 Autonomous Room）。


// ─── remote_mining Operation ────────────────────

/**
 * 生成 Remote Mining Operation 的幂等键。
 * 格式："remote_mining:${homeRoom}:${targetRoom}"
 * 同一对 (homeRoom, targetRoom) 只允许一个活跃远矿 Operation。
 */
export function makeRemoteMiningOperationId(homeRoom: string, targetRoom: string): string {
  return `remote_mining:${homeRoom}:${targetRoom}`;
}
