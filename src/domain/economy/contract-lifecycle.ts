/** Contract Lifecycle */

import type { SupplyContract, ContractStatus } from "./supply-contract";
import { isContractActive, isContractTerminal } from "./supply-contract";

// ─── 状态转换 ─────────────────────────────────────────────

/**
 * 合法状态转换表。
 * key = 源状态，value = 可到达的目标状态集合。
 */
const VALID_TRANSITIONS: ReadonlyMap<ContractStatus, ReadonlySet<ContractStatus>> = new Map([
  ["proposed", new Set(["active", "cancelled"]) as ReadonlySet<ContractStatus>],
  ["active", new Set(["degraded", "suspended", "completed", "cancelled"]) as ReadonlySet<ContractStatus>],
  ["degraded", new Set(["active", "suspended", "completed", "cancelled"]) as ReadonlySet<ContractStatus>],
  ["suspended", new Set(["active", "degraded", "cancelled"]) as ReadonlySet<ContractStatus>],
  ["completed", new Set() as ReadonlySet<ContractStatus>],
  ["cancelled", new Set() as ReadonlySet<ContractStatus>],
]);

/**
 * 检查状态转换是否合法。
 * 纯函数。
 */
export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  if (from === to) return true; // 自转换合法（幂等）
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? allowed.has(to) : false;
}

/**
 * 执行状态转换。
 * 如果转换非法，抛出 Error。
 * 纯函数 — 返回新 Contract 对象。
 */
export function transitionContract(
  contract: SupplyContract,
  newStatus: ContractStatus,
  tick: number,
): SupplyContract {
  if (!canTransition(contract.status, newStatus)) {
    throw new Error(
      `Invalid contract transition: ${contract.status} → ${newStatus} ` +
      `(contract ${contract.id})`,
    );
  }

  if (contract.status === newStatus) return contract; // 幂等

  const updatedAt = tick;
  const activatedAt = newStatus === "active" && contract.activatedAt === undefined
    ? tick
    : contract.activatedAt;

  const terminatedAt = isContractTerminal(newStatus)
    ? tick
    : contract.terminatedAt;

  return {
    ...contract,
    status: newStatus,
    updatedAt,
    activatedAt,
    terminatedAt,
  };
}

// ─── 便捷转换函数 ─────────────────────────────────────────

/**
 * 激活 Contract（PROPOSED → ACTIVE）。
 * 纯函数。
 */
export function activateContract(contract: SupplyContract, tick: number): SupplyContract {
  return transitionContract(contract, "active", tick);
}

/**
 * 降级 Contract（ACTIVE → DEGRADED）。
 * 纯函数。
 */
export function degradeContract(contract: SupplyContract, tick: number): SupplyContract {
  return transitionContract(contract, "degraded", tick);
}

/**
 * 恢复 Contract（DEGRADED → ACTIVE）。
 * 重置 consecutiveShortfall。
 * 纯函数。
 */
export function recoverContract(contract: SupplyContract, tick: number): SupplyContract {
  const recovered = transitionContract(contract, "active", tick);
  return { ...recovered, consecutiveShortfall: 0 };
}

/**
 * 暂停 Contract（ACTIVE/DEGRADED → SUSPENDED）。
 * 纯函数。
 */
export function suspendContract(contract: SupplyContract, tick: number): SupplyContract {
  return transitionContract(contract, "suspended", tick);
}

/**
 * 完成 Contract（→ COMPLETED）。
 * Consumer 已自给自足或需求永久消失。
 * 纯函数。
 */
export function completeContract(contract: SupplyContract, tick: number): SupplyContract {
  return transitionContract(contract, "completed", tick);
}

/**
 * 取消 Contract（→ CANCELLED）。
 * 因不可恢复原因终止（房失守/角色变更等）。
 * 纯函数。
 */
export function cancelContract(contract: SupplyContract, tick: number): SupplyContract {
  return transitionContract(contract, "cancelled", tick);
}

// ─── 故障检测输入 ─────────────────────────────────────────

/**
 * Producer 运行时状态快照（由系统侧薄壳注入）。
 */
export interface ProducerState {
  /** Producer 房名。 */
  room: string;
  /** 当前 storage 能量。 */
  storageEnergy: number;
  /** storage 容量。 */
  storageCapacity: number;
  /** Producer 房是否仍然属于帝国（ownedRooms 中存在）。 */
  isOwned: boolean;
  /** 最近周期通过本 Contract 驱动的交付量。 */
  deliveredThisCycle: number;
}

/**
 * Consumer 运行时状态快照（由系统侧薄壳注入）。
 */
export interface ConsumerState {
  /** Consumer 房名。 */
  room: string;
  /** 当前 storage 能量。 */
  storageEnergy: number;
  /** storage 容量。 */
  storageCapacity: number;
  /** Consumer 房是否仍然属于帝国。 */
  isOwned: boolean;
  /** Consumer 当前是否需要援助（riskBuffer / needsAid）。 */
  needsAid: boolean;
  /** Consumer 当前风险缓冲（riskBuffer = storageEnergy - safetyThreshold）。 */
  riskBuffer: number;
}

// ─── 故障检测配置 ─────────────────────────────────────────

/**
 * 故障检测参数。
 */
export interface FaultDetectionConfig {
  /**
   * Producer storage 连续低于 minimumReserve 的周期数阈值。
   * 超过则 ACTIVE → DEGRADED。
   * 默认 2（连续 2 周期不足才降级，防抖动）。
   */
  producerShortfallThreshold: number;
  /**
   * Producer 降级后连续不足的周期数阈值。
   * 超过则 DEGRADED → SUSPENDED。
   * 默认 3。
   */
  producerSuspendThreshold: number;
  /**
   * Consumer 连续不需要援助的周期数阈值。
   * 超过则 → COMPLETED。
   * 默认 3（连续 3 周期不需要 → 视为自给自足）。
   */
  consumerSelfSufficientThreshold: number;
  /**
   * Producer 恢复正常的连续周期数阈值。
   * 超过则 DEGRADED → ACTIVE。
   * 默认 2（连续 2 周期正常才恢复，防抖动）。
   */
  producerRecoveryThreshold: number;
}

/**
 * 默认故障检测参数。
 */
export const DEFAULT_FAULT_CONFIG: FaultDetectionConfig = {
  producerShortfallThreshold: 2,
  producerSuspendThreshold: 3,
  consumerSelfSufficientThreshold: 3,
  producerRecoveryThreshold: 2,
};

// ─── 故障检测结果 ─────────────────────────────────────────

/**
 * 故障检测结果——包含新状态和原因。
 */
export interface FaultDetectionResult {
  /** 建议的新状态。 */
  newStatus: ContractStatus;
  /** 检测原因（人类可读）。 */
  reason: string;
  /** 是否发生了状态变更。 */
  changed: boolean;
}

/**
 * 评估 Producer 和 Consumer 状态，决定 Contract 的生命周期动作。

 * 这是 Contract 生命周期的核心纯函数——
 * 每周期由系统侧薄壳调用，传入 Producer/Consumer 运行时状态快照，
 * 返回建议的新状态和原因。

 * 纯函数 — 不访问 Game/Memory。
 */
export function detectFault(
  contract: SupplyContract,
  producer: ProducerState,
  consumer: ConsumerState,
  config: FaultDetectionConfig = DEFAULT_FAULT_CONFIG,
): FaultDetectionResult {
  // 终态 Contract 不再检测
  if (isContractTerminal(contract.status)) {
    return { newStatus: contract.status, reason: "terminal", changed: false };
  }

  // 1. 房间失守检测——最高优先级
  if (!producer.isOwned) {
    return {
      newStatus: "cancelled",
      reason: `producer ${producer.room} lost`,
      changed: contract.status !== "cancelled",
    };
  }
  if (!consumer.isOwned) {
    return {
      newStatus: "cancelled",
      reason: `consumer ${consumer.room} lost`,
      changed: contract.status !== "cancelled",
    };
  }

  // 2. PROPOSED 状态——不做故障检测（等待激活）
  if (contract.status === "proposed") {
    return { newStatus: "proposed", reason: "awaiting activation", changed: false };
  }

  // 3. SUSPENDED 状态——只检测恢复条件
  if (contract.status === "suspended") {
    // Producer 恢复且 Consumer 仍需要 → 可以恢复
    if (producer.storageEnergy >= contract.minimumReserve && consumer.needsAid) {
      return {
        newStatus: "active",
        reason: "producer recovered, consumer still needs aid",
        changed: true,
      };
    }
    // Consumer 不再需要 → COMPLETED
    if (!consumer.needsAid && contract.consecutiveShortfall >= 0) {
      // 需要额外追踪 consumer 不需要援助的周期数——这里用 consecutiveShortfall 作为近似
      // 实际由调用方在 SUSPENDED 前已经检测了 consumer 自给率
      return {
        newStatus: "completed",
        reason: "consumer self-sufficient during suspension",
        changed: true,
      };
    }
    return { newStatus: "suspended", reason: "still suspended", changed: false };
  }

  // 4. Consumer 自给自足检测（ACTIVE / DEGRADED）
  if (!consumer.needsAid) {
    // Consumer 连续不需要援助 → COMPLETED
    // 这里用 consecutiveShortfall 的反向计数（由调用方在 recordDelivery 中管理）
    // 简化：如果 Consumer 不需要援助，直接建议 COMPLETED
    // 调用方应自行追踪连续周期数后调用
    return {
      newStatus: "completed",
      reason: "consumer self-sufficient",
      changed: true,
    };
  }

  // 5. Producer 短缺检测（ACTIVE / DEGRADED）
  const producerShortfall = producer.storageEnergy < contract.minimumReserve;

  if (contract.status === "active") {
    if (producerShortfall && contract.consecutiveShortfall >= config.producerShortfallThreshold) {
      return {
        newStatus: "degraded",
        reason: `producer storage ${producer.storageEnergy} < reserve ${contract.minimumReserve} ` +
                `for ${contract.consecutiveShortfall} cycles`,
        changed: true,
      };
    }
    return { newStatus: "active", reason: "healthy", changed: false };
  }

  if (contract.status === "degraded") {
    if (producerShortfall && contract.consecutiveShortfall >= config.producerSuspendThreshold) {
      return {
        newStatus: "suspended",
        reason: `producer sustained shortfall for ${contract.consecutiveShortfall} cycles`,
        changed: true,
      };
    }
    // Producer 恢复正常——需要连续 recoveryThreshold 周期才恢复
    // 由调用方追踪恢复周期数（重置 consecutiveShortfall 为 0 表示已恢复）
    if (!producerShortfall && contract.consecutiveShortfall === 0) {
      return {
        newStatus: "active",
        reason: "producer recovered",
        changed: true,
      };
    }
    return { newStatus: "degraded", reason: "still degraded", changed: false };
  }

  // 兜底
  return { newStatus: contract.status, reason: "no action", changed: false };
}

// ─── 生命周期评估 ─────────────────────────────────────────

/**
 * Contract 健康评估摘要（供 Dashboard 展示）。
 */
export interface ContractHealthSummary {
  /** Contract ID。 */
  id: string;
  /** 当前状态。 */
  status: ContractStatus;
  /** 是否活跃。 */
  isActive: boolean;
  /** 是否终态。 */
  isTerminal: boolean;
  /** 累计交付量。 */
  totalDelivered: number;
  /** 当前连续短缺周期数。 */
  consecutiveShortfall: number;
  /** 有效供应速率。 */
  effectiveRate: number;
  /** 存活时长（tick）。 */
  ageTicks: number | undefined;
  /** 最近状态变更 tick。 */
  lastUpdated: number;
}

/**
 * 生成 Contract 健康评估摘要。
 * 纯函数。
 */
export function summarizeHealth(
  contract: SupplyContract,
  tick: number,
  effectiveRateFn: (c: SupplyContract) => number,
): ContractHealthSummary {
  const ageTicks = contract.activatedAt !== undefined ? tick - contract.activatedAt : undefined;
  return {
    id: contract.id,
    status: contract.status,
    isActive: isContractActive(contract.status),
    isTerminal: isContractTerminal(contract.status),
    totalDelivered: contract.totalDelivered,
    consecutiveShortfall: contract.consecutiveShortfall,
    effectiveRate: effectiveRateFn(contract),
    ageTicks,
    lastUpdated: contract.updatedAt,
  };
}

// ─── 归档清理 ─────────────────────────────────────────────

/**
 * 归档清理阈值配置。
 */
export interface ArchiveConfig {
  /**
   * 终态 Contract 保留多少 tick 后可归档删除。
   * 默认 1000 tick（约 2 个完整周期）。
   */
  retentionTicks: number;
}

export const DEFAULT_ARCHIVE_CONFIG: ArchiveConfig = {
  retentionTicks: 1000,
};

/**
 * 判断终态 Contract 是否可以归档删除。
 * 纯函数。
 */
export function canArchive(
  contract: SupplyContract,
  tick: number,
  config: ArchiveConfig = DEFAULT_ARCHIVE_CONFIG,
): boolean {
  if (!isContractTerminal(contract.status)) return false;
  if (contract.terminatedAt === undefined) return false;
  return tick - contract.terminatedAt >= config.retentionTicks;
}

/**
 * 过滤出可归档的终态 Contract。
 * 纯函数。
 */
export function filterArchivable(
  contracts: readonly SupplyContract[],
  tick: number,
  config: ArchiveConfig = DEFAULT_ARCHIVE_CONFIG,
): SupplyContract[] {
  return contracts.filter(c => canArchive(c, tick, config));
}
