/**
 * Supply Contract — A4.0 Phase 2：长期供应契约模型。
 *
 * 合同锚点：A4.0 Architecture Audit §18.2（Supply Contract 是编排层，不是执行层）。
 *
 * 设计意图：
 *   Supply Contract 是现有 SupplyNode → DemandNode → AllocationPolicy → Operation → Logistics
 *   链条的**上层编排协议**，不是新的独立系统。
 *
 *   Contract 定义「谁应该长期供应谁」（长期关系），
 *   AllocationPolicy 仍然决定「本周期供应多少」（瞬时分配），
 *   Operation 仍然是单次执行单元，
 *   Logistics 仍然通过 Request Pool + assignment-service 搬运。
 *
 *   Contract 的作用：
 *   1. 定义长期供应关系（source/target/rate/reserve/priority/status）
 *   2. 每周期由 Contract 驱动注入 SupplyNode/DemandNode（通过 contract-node-bridge 适配器）
 *   3. 监控健康度——Producer 失败时 DEGRADE，Consumer 不再需要时 COMPLETED
 *   4. 提供可解释的长期经济关系视图（Dashboard）
 *
 *   Contract **不**做的事：
 *   - 不替代 AllocationPolicy 的分配决策
 *   - 不替代 Operation 的执行逻辑
 *   - 不替代 Logistics 的搬运机制
 *   - 不新增 OperationType——Contract 驱动的仍是 type="supply" Operation
 *
 * 纯函数律（DEP_GRAPH §3-5，SYSTEM_BOUNDARIES §2.3-3）：
 *   - 不引用 Game / Memory / RawMemory（lint 红线）
 *   - 全部输入由参数注入
 *   - 不写任何状态——只读计算
 */

import type { EmpireRoomRole } from "./empire-role";
import type { OperationPriority, ResourceType } from "../operation/agenda-item";

// ─── Contract 状态机 ──────────────────────────────────────

/**
 * Supply Contract Status — 契约生命周期六态。
 *
 * 状态流转（详见 contract-lifecycle.ts）：
 *   PROPOSED → ACTIVE → DEGRADED → SUSPENDED → COMPLETED
 *                    ↘                ↗
 *                     → CANCELLED ←──
 *
 * - PROPOSED: 已提议但未激活（等待条件满足或人工裁决）
 * - ACTIVE: 活跃——每周期注入 SupplyNode/DemandNode 驱动调拨
 * - DEGRADED: 降级——Producer 经济状况不佳，降低 targetRate
 * - SUSPENDED: 暂停——Producer 严重故障或 Consumer 暂时不需要
 * - COMPLETED: 完成——Consumer 已自给自足或需求永久消失
 * - CANCELLED: 取消——因不可恢复原因终止（房失守/角色变更等）
 */
export type ContractStatus =
  | "proposed"
  | "active"
  | "degraded"
  | "suspended"
  | "completed"
  | "cancelled";

/**
 * 所有 Contract 状态值（用于遍历/初始化）。
 */
export const CONTRACT_STATUSES: readonly ContractStatus[] = [
  "proposed",
  "active",
  "degraded",
  "suspended",
  "completed",
  "cancelled",
] as const;

/**
 * 判定 Contract 状态是否活跃（注入节点 / 驱动 Operation）。
 * 纯函数。
 */
export function isContractActive(status: ContractStatus): boolean {
  return status === "active" || status === "degraded";
}

/**
 * 判定 Contract 状态是否终态（可归档删除）。
 * 纯函数。
 */
export function isContractTerminal(status: ContractStatus): boolean {
  return status === "completed" || status === "cancelled";
}

// ─── Contract 模型 ────────────────────────────────────────

/**
 * Supply Contract — 长期供应契约。
 *
 * 定义两个房间之间的长期资源供应关系。
 * Contract 的 source 房每周期通过 contract-node-bridge 适配器
 * 注入为 SupplyNode，target 房注入为 DemandNode。
 *
 * 字段设计原则：
 * - 存储在 Memory.kernel.supplyContracts（瘦快照，只存 ID + 数字 + 枚举）
 * - 不存完整路径/历史/运行时索引
 * - 终态后归档删除（与 OperationContext 同模式）
 */
export interface SupplyContract {
  /** 幂等键："contract:${source}:${target}:${resource}"。 */
  id: string;
  /** 源房名（producer / 调出方）。 */
  sourceRoom: string;
  /** 目标房名（consumer / 调入方）。 */
  targetRoom: string;
  /** 资源类型（当前 energy，未来可扩展矿物等）。 */
  resource: ResourceType;

  // ── 供应参数 ──
  /**
   * 目标供应速率（能量/tick）。
   * Producer 每周期应向 Consumer 供应的速率参考。
   * AllocationPolicy 仍根据瞬时供需决定实际调拨量——targetRate 是指导值不是硬约束。
   * DEGRADED 状态下乘以 degradedRateMultiplier。
   */
  targetRate: number;
  /**
   * Producer 最低保留量。
   * Producer 的 storage 低于此值时 Contract 进入 DEGRADED。
   * 保护 Producer 不被过度抽离。
   */
  minimumReserve: number;
  /** 操作优先级（影响 AllocationPolicy 的排序和 Operation 创建）。 */
  priority: OperationPriority;

  // ── 生命周期 ──
  /** 当前状态。 */
  status: ContractStatus;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近状态变更 tick。 */
  updatedAt: number;
  /** 激活 tick（进入 ACTIVE 状态的 tick，用于稳定性统计）。 */
  activatedAt: number | undefined;
  /** 终态 tick（COMPLETED 或 CANCELLED 的 tick，用于归档清理）。 */
  terminatedAt: number | undefined;

  // ── 运行时追踪（每周期更新）──
  /**
   * 累计已供应量（通过本 Contract 驱动的 Operation deliveredAmount 之和）。
   * 用于评估 Contract 的长期经济价值。
   */
  totalDelivered: number;
  /** 最近一次注入节点的 tick。 */
  lastInjectionTick: number | undefined;
  /**
   * 连续未满足周期数。
   * Producer 连续 N 周期无法满足 targetRate → 考虑降级或暂停。
   */
  consecutiveShortfall: number;
  /**
   * 降级速率乘数（DEGRADED 状态下 targetRate × 此值）。
   * 默认 0.5（降级时只供应一半目标速率）。
   */
  degradedRateMultiplier: number;

  // ── 角色上下文（影响决策）──
  /** Source 房的 Empire Room Role（创建时记录，用于变更检测）。 */
  sourceRole: EmpireRoomRole | undefined;
  /** Target 房的 Empire Room Role。 */
  targetRole: EmpireRoomRole | undefined;

  /** 人类可读的创建原因（供 Dashboard 展示）。 */
  reason: string;
}

// ─── Contract ID 生成 ────────────────────────────────────

/**
 * 生成 Contract 幂等键："contract:${source}:${target}:${resource}"。
 * 同一对 (source, target, resource) 只允许一个非终态 Contract。
 * 纯函数。
 */
export function makeContractId(
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
): string {
  return `contract:${sourceRoom}:${targetRoom}:${resource}`;
}

// ─── Contract 创建 ────────────────────────────────────────

/**
 * 创建新 Supply Contract（初始状态 = PROPOSED）。
 *
 * Contract 创建后需要由 contract-lifecycle 的 activateContract() 激活。
 * 直接创建为 ACTIVE 也可——用 createAndActivateContract()。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param sourceRoom 源房名（producer）
 * @param targetRoom 目标房名（consumer）
 * @param resource 资源类型
 * @param targetRate 目标供应速率（能量/tick）
 * @param minimumReserve Producer 最低保留量
 * @param priority 操作优先级
 * @param tick 当前 tick
 * @param sourceRole Source 房角色（可选）
 * @param targetRole Target 房角色（可选）
 * @param reason 创建原因
 */
export function createSupplyContract(
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
  targetRate: number,
  minimumReserve: number,
  priority: OperationPriority,
  tick: number,
  sourceRole?: EmpireRoomRole,
  targetRole?: EmpireRoomRole,
  reason: string = "role-based-specialization",
): SupplyContract {
  return {
    id: makeContractId(sourceRoom, targetRoom, resource),
    sourceRoom,
    targetRoom,
    resource,
    targetRate,
    minimumReserve,
    priority,
    status: "proposed",
    createdAt: tick,
    updatedAt: tick,
    activatedAt: undefined,
    terminatedAt: undefined,
    totalDelivered: 0,
    lastInjectionTick: undefined,
    consecutiveShortfall: 0,
    degradedRateMultiplier: 0.5,
    sourceRole,
    targetRole,
    reason,
  };
}

/**
 * 创建并立即激活的 Supply Contract（初始状态 = ACTIVE）。
 * 便捷函数——等效于 createSupplyContract() + activateContract()。
 * 纯函数。
 */
export function createActiveSupplyContract(
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
  targetRate: number,
  minimumReserve: number,
  priority: OperationPriority,
  tick: number,
  sourceRole?: EmpireRoomRole,
  targetRole?: EmpireRoomRole,
  reason: string = "role-based-specialization",
): SupplyContract {
  const contract = createSupplyContract(
    sourceRoom, targetRoom, resource, targetRate, minimumReserve,
    priority, tick, sourceRole, targetRole, reason,
  );
  return {
    ...contract,
    status: "active",
    activatedAt: tick,
  };
}

// ─── 有效供应速率 ─────────────────────────────────────────

/**
 * 计算 Contract 的有效供应速率。
 * ACTIVE 状态 = targetRate，DEGRADED 状态 = targetRate × degradedRateMultiplier。
 * 非活跃状态 = 0。
 * 纯函数。
 */
export function effectiveRate(contract: SupplyContract): number {
  switch (contract.status) {
    case "active": return contract.targetRate;
    case "degraded": return contract.targetRate * contract.degradedRateMultiplier;
    default: return 0;
  }
}

// ─── 周期供应量计算 ───────────────────────────────────────

/**
 * 计算本周期 Contract 应注入的供应量。
 *
 * 这是 Contract 传给 contract-node-bridge 的指导值——
 * bridge 将其转换为 SupplyNode.transferable 和 DemandNode.requested。
 * AllocationPolicy 仍根据瞬时供需决定实际分配量。
 *
 * 纯函数。
 *
 * @param contract 供应契约
 * @param intervalTicks 周期间隔 tick 数（默认 100，与 empire-economy 同频）
 */
export function computeCycleAmount(
  contract: SupplyContract,
  intervalTicks: number = 100,
): number {
  const rate = effectiveRate(contract);
  return Math.max(0, Math.floor(rate * intervalTicks));
}

// ─── 交付记录 ─────────────────────────────────────────────

/**
 * 更新 Contract 的交付追踪。
 *
 * 每周期由系统侧薄壳调用——传入本周期通过本 Contract 驱动的
 * Operation 的 deliveredAmount 之和。
 *
 * 纯函数 — 返回新 Contract 对象。
 */
export function recordDelivery(
  contract: SupplyContract,
  deliveredAmount: number,
  tick: number,
): SupplyContract {
  const totalDelivered = contract.totalDelivered + deliveredAmount;
  const targetAmount = computeCycleAmount(contract);
  const shortfall = deliveredAmount < targetAmount;

  return {
    ...contract,
    totalDelivered,
    lastInjectionTick: tick,
    updatedAt: tick,
    consecutiveShortfall: shortfall
      ? contract.consecutiveShortfall + 1
      : 0,
  };
}

// ─── 去重 / 查询 ─────────────────────────────────────────

/**
 * 查找同 key 的非终态 Contract。
 * 纯函数。
 */
export function findActiveContract(
  contracts: readonly SupplyContract[],
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
): SupplyContract | undefined {
  const id = makeContractId(sourceRoom, targetRoom, resource);
  return contracts.find(c => c.id === id && !isContractTerminal(c.status));
}

/**
 * 检查是否已存在同 key 的非终态 Contract。
 * 纯函数。
 */
export function hasActiveContract(
  contracts: readonly SupplyContract[],
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType,
): boolean {
  return findActiveContract(contracts, sourceRoom, targetRoom, resource) !== undefined;
}

/**
 * 过滤出所有活跃 Contract（ACTIVE 或 DEGRADED）。
 * 纯函数。
 */
export function filterActiveContracts(
  contracts: readonly SupplyContract[],
): SupplyContract[] {
  return contracts.filter(c => isContractActive(c.status));
}

/**
 * 过滤出所有终态 Contract（可归档删除）。
 * 纯函数。
 */
export function filterTerminalContracts(
  contracts: readonly SupplyContract[],
): SupplyContract[] {
  return contracts.filter(c => isContractTerminal(c.status));
}

/**
 * 获取指定 source 房的所有活跃 Contract。
 * 纯函数。
 */
export function getContractsBySource(
  contracts: readonly SupplyContract[],
  sourceRoom: string,
): SupplyContract[] {
  return contracts.filter(c =>
    c.sourceRoom === sourceRoom && isContractActive(c.status),
  );
}

/**
 * 获取指定 target 房的所有活跃 Contract。
 * 纯函数。
 */
export function getContractsByTarget(
  contracts: readonly SupplyContract[],
  targetRoom: string,
): SupplyContract[] {
  return contracts.filter(c =>
    c.targetRoom === targetRoom && isContractActive(c.status),
  );
}

// ─── 序列化 / 反序列化 ───────────────────────────────────

/**
 * A4.2: ResourceType 短码编解码。
 *
 * 编码方案（无冲突）：
 * - `"energy"` → `"E"`（大写，不与 mineral 单字母冲突）
 * - MineralConstant（如 `"U"`, `"L"`, `"K"`, `"Z"`, `"O"`, `"H"`, `"X"`）→ 直接存原值
 *
 * 纯函数。
 */

/** 将 ResourceType 编码为短码。纯函数。 */
export function serializeResourceCode(resource: ResourceType): string {
  return resource === "energy" ? "E" : resource;
}

/** 将短码解码为 ResourceType。纯函数。 */
export function deserializeResourceCode(code: string): ResourceType {
  if (code === "E") return "energy";
  // 矿物短码直接作为 MineralConstant 返回
  return code as ResourceType;
}

/**
 * Supply Contract 瘦快照（存入 Memory.kernel.supplyContracts）。
 * 只存必要字段——数字 + 枚举 + ID。
 * 纯函数。
 */
export interface ContractMemorySnapshot {
  /** 幂等键。 */
  i: string;
  /** sourceRoom。 */
  s: string;
  /** targetRoom。 */
  t: string;
  /** resource code（E=energy）。 */
  r: string;
  /** targetRate ×10。 */
  tr: number;
  /** minimumReserve。 */
  mr: number;
  /** priority。 */
  p: number;
  /** status code。 */
  st: string;
  /** createdAt。 */
  ca: number;
  /** updatedAt。 */
  ua: number;
  /** activatedAt。 */
  ac: number | undefined;
  /** terminatedAt。 */
  tm: number | undefined;
  /** totalDelivered。 */
  td: number;
  /** lastInjectionTick。 */
  li: number | undefined;
  /** consecutiveShortfall。 */
  cs: number;
  /** degradedRateMultiplier ×100。 */
  dm: number;
  /** sourceRole code（可选）。 */
  sr: string | undefined;
  /** targetRole code（可选）。 */
  tr2: string | undefined;
  /** reason（截断到 40 字符）。 */
  rs: string;
}

/**
 * 将 SupplyContract 序列化为 Memory 瘦快照。
 * 纯函数。
 */
export function serializeContract(c: SupplyContract): ContractMemorySnapshot {
  // 内联 roleToCode 逻辑避免循环依赖
  const roleCode = (r: EmpireRoomRole | undefined): string | undefined => {
    if (!r) return undefined;
    return r === "core" ? "C" : r === "production" ? "P" : r === "support" ? "S" : "R";
  };
  const statusCode = (s: ContractStatus): string => {
    switch (s) {
      case "proposed": return "P";
      case "active": return "A";
      case "degraded": return "D";
      case "suspended": return "S";
      case "completed": return "C";
      case "cancelled": return "X";
    }
  };
  return {
    i: c.id,
    s: c.sourceRoom,
    t: c.targetRoom,
    r: serializeResourceCode(c.resource),
    tr: Math.round(c.targetRate * 10),
    mr: Math.round(c.minimumReserve),
    p: c.priority,
    st: statusCode(c.status),
    ca: c.createdAt,
    ua: c.updatedAt,
    ac: c.activatedAt,
    tm: c.terminatedAt,
    td: Math.round(c.totalDelivered),
    li: c.lastInjectionTick,
    cs: c.consecutiveShortfall,
    dm: Math.round(c.degradedRateMultiplier * 100),
    sr: roleCode(c.sourceRole),
    tr2: roleCode(c.targetRole),
    rs: c.reason.slice(0, 40),
  };
}

/**
 * 从 Memory 瘦快照反序列化 SupplyContract。
 * 纯函数。
 */
export function deserializeContract(s: ContractMemorySnapshot): SupplyContract {
  const codeToRole = (c: string | undefined): EmpireRoomRole | undefined => {
    if (!c) return undefined;
    switch (c) {
      case "C": return "core";
      case "P": return "production";
      case "S": return "support";
      case "R": return "remote";
      default: return undefined;
    }
  };
  const codeToStatus = (c: string): ContractStatus => {
    switch (c) {
      case "P": return "proposed";
      case "A": return "active";
      case "D": return "degraded";
      case "S": return "suspended";
      case "C": return "completed";
      case "X": return "cancelled";
      default: return "proposed";
    }
  };
  return {
    id: s.i,
    sourceRoom: s.s,
    targetRoom: s.t,
    resource: deserializeResourceCode(s.r),
    targetRate: s.tr / 10,
    minimumReserve: s.mr,
    priority: s.p as OperationPriority,
    status: codeToStatus(s.st),
    createdAt: s.ca,
    updatedAt: s.ua,
    activatedAt: s.ac,
    terminatedAt: s.tm,
    totalDelivered: s.td,
    lastInjectionTick: s.li,
    consecutiveShortfall: s.cs,
    degradedRateMultiplier: s.dm / 100,
    sourceRole: codeToRole(s.sr),
    targetRole: codeToRole(s.tr2),
    reason: s.rs,
  };
}
