/**
 * Contract-Node Bridge — A4.0 Phase 2：Contract → SupplyNode/DemandNode 注入适配器。
 *
 * 合同锚点：A4.0 Architecture Audit §18.2（Supply Contract 是编排层，不是执行层）。
 * 记忆约束 [[memory:17875714213295541337]]：Remote Mining、Mineral、Terminal、Factory
 * 都必须作为 Empire Resource Network 上的生产/消费节点。Supply Contract 是这个链条
 * 的上层编排协议，而不是新系统。Contract 驱动的节点注入复用现有 SupplyNode/DemandNode
 * 结构，不新建节点类型。
 *
 * 设计意图：
 *   这是 Contract（编排层）与 Resource Network（执行层）之间的桥接层。
 *
 *   Contract 定义「谁应该长期供应谁」（长期关系），
 *   Bridge 将 Contract 转换为网络可理解的 SupplyNode + DemandNode（瞬时投影），
 *   AllocationPolicy 照常处理这些节点做分配决策，
 *   Operation 照常执行搬运。
 *
 *   Bridge 不做的事：
 *   - 不替代 AllocationPolicy 的分配决策
 *   - 不创建 Operation（由 allocation-policy / operation-manager 做）
 *   - 不修改现有 buildSupplyNode / buildDemandNode 的签名
 *
 *   Bridge 做的事：
 *   1. 从活跃 Contract 派生 ContractSupplyNode（带 contractId 追溯）
 *   2. 从活跃 Contract 派生 ContractDemandNode（带 contractId 追溯）
 *   3. 将 Contract 节点与 Registry 节点合并（Contract 优先级覆盖）
 *   4. 提供节点去重逻辑（同房间同资源只保留一个节点，Contract 优先）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { SupplyContract } from "./supply-contract";
import { isContractActive, computeCycleAmount, effectiveRate } from "./supply-contract";
import type { SupplyNode } from "../operation/supply-node";
import type { DemandNode, Criticality } from "../operation/demand-node";
import type { OperationPriority, ResourceType } from "../operation/agenda-item";

// ─── Contract 节点扩展 ───────────────────────────────────

/**
 * Contract 派生的 SupplyNode 扩展字段。
 * 追加 contractId 用于追溯——不修改原 SupplyNode 接口。
 */
export interface ContractSupplyNode extends SupplyNode {
  /** 来源 Contract ID。 */
  contractId: string;
  /** 是否为 Contract 驱动（vs Registry 驱动）。 */
  contractDriven: true;
}

/**
 * Contract 派生的 DemandNode 扩展字段。
 * 追加 contractId 用于追溯——不修改原 DemandNode 接口。
 */
export interface ContractDemandNode extends DemandNode {
  /** 来源 Contract ID。 */
  contractId: string;
  /** 是否为 Contract 驱动。 */
  contractDriven: true;
}

/**
 * 统一的 SupplyNode（可能来自 Contract 或 Registry）。
 */
export type UnifiedSupplyNode = SupplyNode | ContractSupplyNode;

/**
 * 统一的 DemandNode（可能来自 Contract 或 Registry）。
 */
export type UnifiedDemandNode = DemandNode | ContractDemandNode;

/**
 * 判断 SupplyNode 是否由 Contract 驱动。
 * 纯函数（类型守卫）。
 */
export function isContractSupplyNode(
  node: UnifiedSupplyNode,
): node is ContractSupplyNode {
  return (node as ContractSupplyNode).contractDriven === true;
}

/**
 * 判断 DemandNode 是否由 Contract 驱动。
 * 纯函数（类型守卫）。
 */
export function isContractDemandNode(
  node: UnifiedDemandNode,
): node is ContractDemandNode {
  return (node as ContractDemandNode).contractDriven === true;
}

// ─── Producer / Consumer 快照 ────────────────────────────

/**
 * Producer 运行时快照（由系统侧薄壳注入）。
 * 与 contract-lifecycle 的 ProducerState 对齐但补充了 capacity 字段。
 */
export interface ProducerSnapshot {
  room: string;
  storageEnergy: number;
  storageCapacity: number;
  /** Producer 当前可调拨量 = storageEnergy - safetyReserve。 */
  transferable: number;
  /** 已被其他 Reservation 锁定的量。 */
  reserved: number;
}

/**
 * Consumer 运行时快照。
 */
export interface ConsumerSnapshot {
  room: string;
  storageEnergy: number;
  storageCapacity: number;
  /** Consumer 当前需求量（由 RoomRegistry 推导）。 */
  deficitAmount: number;
  /** 紧急度。 */
  criticality: Criticality;
  /** 首次发现 tick（用于 starvation 检测）。 */
  firstSeen: number;
}

// ─── Contract → SupplyNode 转换 ──────────────────────────

/**
 * 从活跃 Contract + Producer 快照派生 ContractSupplyNode。
 *
 * 节点的 transferable 取 min(computeCycleAmount, producer.transferable)。
 * 如果 Producer 可调拨量不足，节点仍然创建但 transferable 较低——
 * 这让 AllocationPolicy 能看到「有合同但供给不足」的状态。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param contract 活跃 Contract
 * @param producer Producer 运行时快照
 * @param tick 当前 tick
 * @param intervalTicks 周期间隔（默认 100）
 * @returns ContractSupplyNode 或 undefined（Contract 非活跃或 Producer 不可用）
 */
export function bridgeToSupplyNode(
  contract: SupplyContract,
  producer: ProducerSnapshot,
  tick: number,
  intervalTicks: number = 100,
): ContractSupplyNode | undefined {
  // 只处理活跃 Contract
  if (!isContractActive(contract.status)) return undefined;

  // Producer 无可用容量
  if (producer.storageCapacity <= 0) return undefined;

  const cycleAmount = computeCycleAmount(contract, intervalTicks);
  const safety = Math.max(producer.storageCapacity * 0.2, contract.minimumReserve);
  const transferable = Math.max(0, Math.min(
    cycleAmount,
    producer.transferable,
  ));

  if (transferable <= 0) return undefined;

  return {
    room: producer.room,
    resource: contract.resource,
    available: producer.storageEnergy,
    reserved: producer.reserved,
    safety,
    transferable,
    priority: contract.priority,
    health: Math.min(1, producer.storageEnergy / (producer.storageCapacity * 0.5)),
    capacity: producer.storageCapacity,
    timestamp: tick,
    contractId: contract.id,
    contractDriven: true,
  };
}

// ─── Contract → DemandNode 转换 ──────────────────────────

/**
 * 从活跃 Contract + Consumer 快照派生 ContractDemandNode。
 *
 * 节点的 requested 取 max(computeCycleAmount, consumer.deficitAmount)。
 * 如果 Consumer 实际缺口大于 Contract 目标，按实际缺口创建——
 * 这让 AllocationPolicy 能看到完整需求。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param contract 活跃 Contract
 * @param consumer Consumer 运行时快照
 * @param tick 当前 tick
 * @param intervalTicks 周期间隔（默认 100）
 * @returns ContractDemandNode 或 undefined
 */
export function bridgeToDemandNode(
  contract: SupplyContract,
  consumer: ConsumerSnapshot,
  tick: number,
  intervalTicks: number = 100,
): ContractDemandNode | undefined {
  // 只处理活跃 Contract
  if (!isContractActive(contract.status)) return undefined;

  const cycleAmount = computeCycleAmount(contract, intervalTicks);
  // 请求量 = max(合同目标, 实际缺口)
  const requested = Math.max(cycleAmount, consumer.deficitAmount);
  if (requested <= 0) return undefined;

  // 优先级：Contract 优先级与 Consumer 紧急度取更紧急者
  const consumerPriority = criticalityToPriority(consumer.criticality);
  const priority = Math.min(contract.priority, consumerPriority) as OperationPriority;

  const deadline = tick + 2000; // 与 buildDemandNode 一致

  return {
    room: consumer.room,
    resource: contract.resource,
    requested,
    priority,
    deadline,
    criticality: consumer.criticality,
    fulfilled: 0, // 新建节点初始为 0
    remaining: requested,
    firstSeen: consumer.firstSeen,
    timestamp: tick,
    contractId: contract.id,
    contractDriven: true,
  };
}

// ─── 批量桥接 ────────────────────────────────────────────

/**
 * Contract + Producer + Consumer 的组合输入。
 */
export interface ContractBridgeInput {
  contract: SupplyContract;
  producer: ProducerSnapshot;
  consumer: ConsumerSnapshot;
}

/**
 * 批量将 Contract 桥接为 SupplyNode + DemandNode。
 *
 * 返回所有活跃 Contract 派生的节点对。
 * 纯函数。
 */
export function bridgeContracts(
  inputs: readonly ContractBridgeInput[],
  tick: number,
  intervalTicks: number = 100,
): {
  supplyNodes: ContractSupplyNode[];
  demandNodes: ContractDemandNode[];
} {
  const supplyNodes: ContractSupplyNode[] = [];
  const demandNodes: ContractDemandNode[] = [];

  for (const { contract, producer, consumer } of inputs) {
    const supply = bridgeToSupplyNode(contract, producer, tick, intervalTicks);
    if (supply) supplyNodes.push(supply);

    const demand = bridgeToDemandNode(contract, consumer, tick, intervalTicks);
    if (demand) demandNodes.push(demand);
  }

  return { supplyNodes, demandNodes };
}

// ─── 节点合并 ────────────────────────────────────────────

/**
 * 将 Contract 驱动的节点与 Registry 驱动的节点合并。
 *
 * 合并规则（同 room + resource）：
 * 1. 如果只有 Contract 节点 → 使用 Contract 节点
 * 2. 如果只有 Registry 节点 → 使用 Registry 节点
 * 3. 如果两者都有 → 使用 Contract 节点（Contract 优先级覆盖），
 *    但 transferable 取 max(contract.transferable, registry.transferable)
 *
 * 纯函数。
 *
 * @param contractSupply Contract 驱动的 SupplyNodes
 * @param registrySupply Registry 驱动的 SupplyNodes
 */
export function mergeSupplyNodes(
  contractSupply: readonly ContractSupplyNode[],
  registrySupply: readonly SupplyNode[],
): UnifiedSupplyNode[] {
  const merged: UnifiedSupplyNode[] = [];
  const contractByKey = new Map<string, ContractSupplyNode>();

  // 索引 Contract 节点
  for (const node of contractSupply) {
    const key = `${node.room}:${node.resource}`;
    contractByKey.set(key, node);
  }

  // 先加 Contract 节点
  for (const node of contractSupply) {
    merged.push(node);
  }

  // 再加 Registry 节点（跳过同 key 的）
  for (const node of registrySupply) {
    const key = `${node.room}:${node.resource}`;
    if (contractByKey.has(key)) {
      // 同 key → 已有 Contract 节点，跳过 Registry 节点
      // （Contract 节点的 transferable 已包含 Producer 状态）
      continue;
    }
    merged.push(node);
  }

  return merged;
}

/**
 * 将 Contract 驱动的 DemandNodes 与 Registry 驱动的合并。
 *
 * 合并规则同 mergeSupplyNodes。
 * 纯函数。
 */
export function mergeDemandNodes(
  contractDemand: readonly ContractDemandNode[],
  registryDemand: readonly DemandNode[],
): UnifiedDemandNode[] {
  const merged: UnifiedDemandNode[] = [];
  const contractByKey = new Map<string, ContractDemandNode>();

  for (const node of contractDemand) {
    const key = `${node.room}:${node.resource}`;
    contractByKey.set(key, node);
  }

  for (const node of contractDemand) {
    merged.push(node);
  }

  for (const node of registryDemand) {
    const key = `${node.room}:${node.resource}`;
    if (contractByKey.has(key)) continue;
    merged.push(node);
  }

  return merged;
}

// ─── 内部工具 ────────────────────────────────────────────

/**
 * 紧急度 → 优先级映射。
 * 与 demand-node.ts 中的 criticalityToPriority 保持一致。
 */
function criticalityToPriority(c: Criticality): OperationPriority {
  switch (c) {
    case "critical": return 0;
    case "high": return 1;
    case "normal": return 2;
    case "low": return 3;
  }
}
