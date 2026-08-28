/** Specialization Planner — 专业化规划逻辑（由 empire-strategy 系统内部门控调用） */

import type { TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import {
  filterWaitingExecution,
  expireStaleOpportunities,
  approveOpportunity,
  rejectOpportunity,
  isExpired,
  type RemoteOpportunity,
} from "../domain/remote/remote-opportunity";
import {
  checkExecutionGate,
  isGatePassed,
  isGatePermanentFailure,
  type ExecutionGateInput,
  type GateResult,
} from "../domain/remote/execution-gate";
import type { RemoteMiningOperationContext } from "../domain/operation/remote-mining-op";
import {
  createRemoteMiningOp,
  updateEconomicHealth,
  filterActiveRemoteMiningOps,
  type CreateRemoteMiningOpInput,
} from "../domain/operation/remote-mining-op";
import {
  assessEconomicHealth,
  type RemoteEconomicHealthInput,
} from "../domain/remote/economic-health";
import {
  computeEmpireBalance,
  computeRemoteContribution,
  type RemoteContribution,
} from "../domain/strategy/empire-balance";
// A4.4 修复 BYPASS-009：Supply Contract 系统层接入。
import {
  createActiveSupplyContract,
  hasActiveContract,
  filterActiveContracts,
  filterTerminalContracts,
  makeContractId,
  serializeContract,
  deserializeContract,
  type SupplyContract,
  type ContractMemorySnapshot,
} from "../domain/economy/supply-contract";
import { log } from "../kernel/log";

/**
 * 专业化规划：消费 WAITING_EXECUTION Opportunities 并评估活跃远矿
 * Operation 的经济健康度、维护 Supply Contract。
 *
 * 原 interval=100 的独立系统，合并后由 empire-strategy 系统按
 * `tick % 100 === systemPhase("specialization-planner", 100)` 门控调用，
 * 调度节律与独立系统时期逐 tick 一致。
 */
export function runSpecializationPlanning(ctx: TickContext): void {
    // 1. 过期 Opportunities 清理
    const opportunities = getOpportunities();
    const freshOpps = expireStaleOpportunities(opportunities, ctx.tick);

    // 2. 评估 WAITING_EXECUTION Opportunities
    const waiting = filterWaitingExecution(freshOpps);
    const activeOps = getRemoteMiningOps();

    for (const opp of waiting) {
      // 构建 Execution Gate 输入
      const gateInput = buildGateInput(opp, activeOps, ctx.tick);
      if (!gateInput) {
        // 无法构建 Gate 输入（缺少数据）→ 跳过，下次再评估
        continue;
      }

      const result = checkExecutionGate(gateInput);

      if (isGatePassed(result)) {
        // 通过 → 标记 APPROVED → 创建 RemoteMiningOperation
        const approved = approveOpportunity(opp, ctx.tick, "execution-gate-passed");
        createOperationFromOpportunity(approved, ctx.tick);
        log.info("specialization-planner", `specialization-planner: APPROVED opportunity ${opp.id} ` +
          `(${opp.homeRoom}→${opp.targetRoom})`,);
      } else if (isGatePermanentFailure(result)) {
        // 永久失败 → REJECT
        rejectOpportunity(opp, ctx.tick, result.reason);
        log.info("specialization-planner", `specialization-planner: REJECTED opportunity ${opp.id} ` +
          `(${result.type}: ${result.reason})`,);
      }
      // WAIT/NO_BUDGET/NO_DEMAND → 保持 WAITING_EXECUTION，下次再评估
    }

    // 3. 重估活跃 Operation 的经济健康度
    const activeRemoteOps = filterActiveRemoteMiningOps(activeOps);
    for (const op of activeRemoteOps) {
      const healthInput = buildHealthInput(op, ctx.tick);
      if (!healthInput) continue;
      const assessment = assessEconomicHealth(healthInput);
      if (assessment.degraded || assessment.improved) {
        updateEconomicHealth(op, assessment.health, ctx.tick);
      }
    }

    // A4.4 修复 BYPASS-009：从 networkSnapshot 的 surplus/deficit 对创建 Supply Contract。
    // Supply Contract 是 logistics-planner 的 contract → request 链条的输入源。
    // 旧问题：createSupplyContract() 纯函数完整但从未被系统层调用 →
    //   Memory.kernel.supplyContracts 永远为空 → Planner 的 contract→request 链路不产出。
    // 修复：每 100t 从 networkSnapshot 提取 surplus/deficit 对，为每对创建 ACTIVE Contract。
    maintainSupplyContracts(ctx.tick);

    // 4. 写回 Memory
    saveOpportunities(freshOpps);
    saveRemoteMiningOps(activeOps);
}

// ─── Memory 读写辅助（系统侧薄壳独有）──────────────────

/**
 * 从 Memory 读取 Opportunities。
 * A4.1 阶段使用 heap 缓存——不写入 Memory schema（渐进迁移）。
 */
function getOpportunities(): RemoteOpportunity[] {
  // A4.1 阶段：暂从 globalCache 读取
  const cache = (global as unknown as { __remoteOpportunities?: RemoteOpportunity[] });
  return cache.__remoteOpportunities ?? [];
}

/**
 * 写回 Opportunities 到 globalCache。
 */
function saveOpportunities(opps: RemoteOpportunity[]): void {
  (global as unknown as { __remoteOpportunities?: RemoteOpportunity[] }).__remoteOpportunities = opps;
}

/**
 * 从 globalCache 读取 RemoteMiningOperations。
 */
function getRemoteMiningOps(): RemoteMiningOperationContext[] {
  const cache = (global as unknown as { __remoteMiningOps?: RemoteMiningOperationContext[] });
  return cache.__remoteMiningOps ?? [];
}

/**
 * 写回 RemoteMiningOperations 到 globalCache。
 */
function saveRemoteMiningOps(ops: RemoteMiningOperationContext[]): void {
  (global as unknown as { __remoteMiningOps?: RemoteMiningOperationContext[] }).__remoteMiningOps = ops;
}

// ─── Gate 输入构建 ──────────────────────────────────────

/**
 * 从 Opportunity + 现有 Operations 构建 Execution Gate 输入。

 * 系统侧薄壳负责从 Game/Memory 采集数据注入 Gate。
 * 返回 undefined 表示数据不足（如缺少 intel），跳过本次评估。
 */
function buildGateInput(
  opp: RemoteOpportunity,
  activeOps: readonly RemoteMiningOperationContext[],
  tick: number,
): ExecutionGateInput | undefined {
  // 从 intel 获取 source 和 room 信息
  const homeRoomMem = Memory.rooms[opp.homeRoom];
  if (!homeRoomMem?.intel) return undefined;
  const intel = homeRoomMem.intel[opp.targetRoom];
  if (!intel) return undefined;

  // 从 CONFIG 获取参数（A4.1 新增参数后续在 Phase 5 扩展 CONFIG 时添加，先用常量）
  const maxPathCost = 200;
  const maxTransportCost = 5;
  const minBudget = 500;

  return {
    opportunity: opp,
    sourceExists: (intel.sources ?? 0) > 0,
    sourceMineable: intel.status === "normal",
    roomAccessible: !(intel.sealedExits && intel.sealedExits.length > 0),
    routeValid: (intel.pathCost ?? 0) < maxPathCost,
    maxPathCost,
    pathCost: intel.pathCost ?? 0,
    threatClear: true, // A4.1：threat 信息在 remoteOps 上，此处简化（后续集成时从 remoteOps 读取）
    yieldReasonable: opp.value.worthInvesting || opp.value.netValue > 0,
    netValue: opp.value.netValue,
    investmentThreshold: 3,
    empireDemand: true, // A4.1 简化：默认有需求，后续接入 empire-balance
    transportAcceptable: opp.value.transportCost < maxTransportCost,
    transportCost: opp.value.transportCost,
    maxTransportCost,
    hasActiveOp: activeOps.some(
      o => o.sourceId === opp.sourceId && o.status !== "completed" && o.status !== "cancelled" && o.status !== "expired" && o.status !== "failed",
    ),
    budgetSufficient: true, // A4.1 简化：默认预算充足，后续接入 operation-budget
    budgetRemaining: 5000,
    minBudget,
    tick,
  };
}

// ─── 健康度评估输入构建 ─────────────────────────────────

/**
 * 从 Operation 构建 Economic Health 评估输入。

 * 系统侧薄壳负责从 Game/Memory 采集数据注入 Health 评估。
 */
function buildHealthInput(
  op: RemoteMiningOperationContext,
  _tick: number,
): RemoteEconomicHealthInput | undefined {
  // A4.1 阶段简化实现——完整实现需要从 flow-accounting 和 economic-accounting 获取数据
  // 暂返回 undefined，等 Phase 5 集成时完善
  return undefined;
}

// ─── A4.4: Supply Contract 维护 ──────────────────────────

/**
 * A4.4 修复 BYPASS-009：从 networkSnapshot 的 surplus/deficit 对维护 Supply Contract。

 * 逻辑：
 *   1. 读取 globalCache().networkSnapshot（由 agenda-manager 每 100t 写入）
 *   2. 对每个 (surplusRoom, deficitRoom, resource) 对：
 *      - 如果已有非终态 Contract → 跳过（幂等）
 *      - 否则创建 ACTIVE SupplyContract
 *   3. 清理终态 Contract（COMPLETED/CANCELLED）
 *   4. 序列化写入 Memory.kernel.supplyContracts（瘦快照）

 * Contract 参数推导：
 *   - targetRate: deficit.remaining / 100（每 tick 供应量，100t 周期铺平）
 *   - minimumReserve: surplus.capacity × 0.2（Producer 保留 20% 安全储备）
 *   - priority: 由 deficit.criticality 推导
 */
function maintainSupplyContracts(tick: number): void {
  const networkSnapshot = globalCache().networkSnapshot;
  if (!networkSnapshot) return;

  // 读取现有 Contracts（从 Memory 反序列化）
  const existing = loadContractsFromMemory();

  // 清理终态 Contract
  const activeContracts = existing.filter(c => !isContractTerminalStatus(c.status));

  // 从 networkSnapshot 提取 surplus/deficit 对
  const supplyNodes = networkSnapshot.supplyNodes;
  const demandNodes = networkSnapshot.demandNodes;

  let newContractsCreated = 0;

  for (const supply of supplyNodes) {
    for (const demand of demandNodes) {
      // 只匹配同资源类型
      if (supply.resource !== demand.resource) continue;
      // 不为同一房创建
      if (supply.room === demand.room) continue;

      // 幂等检查：已有非终态 Contract → 跳过
      if (hasActiveContract(activeContracts, supply.room, demand.room, supply.resource)) {
        continue;
      }

      // 推导 Contract 参数
      const targetRate = Math.max(1, Math.ceil(demand.remaining / 100));
      const minimumReserve = Math.max(5000, Math.floor(supply.capacity * 0.2));
      const priority = criticalityToPriority(demand.criticality);

      const contract = createActiveSupplyContract(
        supply.room,
        demand.room,
        supply.resource,
        targetRate,
        minimumReserve,
        priority,
        tick,
        undefined, // sourceRole — 后续接入 empireRole
        undefined, // targetRole
        `network-surplus-deficit-pair`,
      );

      activeContracts.push(contract);
      newContractsCreated++;
    }
  }

  // 序列化写入 Memory.kernel.supplyContracts
  saveContractsToMemory(activeContracts, tick);

  if (newContractsCreated > 0) {
    log.info("specialization-planner", `specialization-planner: created ${newContractsCreated} supply contracts ` +
      `(${activeContracts.length} active total)`,);
  }
}

/**
 * 从 Memory.kernel.supplyContracts 读取并反序列化 Contracts。
 */
function loadContractsFromMemory(): SupplyContract[] {
  if (!Memory.kernel) return [];
  const stored = (Memory.kernel as { supplyContracts?: ContractMemorySnapshot[] }).supplyContracts;
  if (!stored || !Array.isArray(stored)) return [];
  return stored.map(deserializeContract);
}

/**
 * 序列化并写入 Memory.kernel.supplyContracts（瘦快照）。
 */
function saveContractsToMemory(contracts: SupplyContract[], tick: number): void {
  if (!Memory.kernel) Memory.kernel = {};
  // 只保存非终态 Contract（终态的已被清理）
  const snapshots = contracts
    .filter(c => !isContractTerminalStatus(c.status))
    .map(serializeContract);
  (Memory.kernel as { supplyContracts?: ContractMemorySnapshot[] }).supplyContracts = snapshots;
}

/**
 * 判断 Contract 状态是否为终态。
 */
function isContractTerminalStatus(status: string): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * 从 Criticality 推导 OperationPriority。
 */
function criticalityToPriority(criticality: string): import("../domain/operation/agenda-item").OperationPriority {
  switch (criticality) {
    case "critical": return 0;
    case "high": return 1;
    case "normal": return 2;
    case "low": return 3;
    default: return 2;
  }
}

// ─── 从 Opportunity 创建 Operation ────────────────────

/**
 * 从 APPROVED Opportunity 创建 RemoteMiningOperation。
 */
function createOperationFromOpportunity(
  opp: RemoteOpportunity,
  tick: number,
): void {
  const input: CreateRemoteMiningOpInput = {
    homeRoom: opp.homeRoom,
    targetRoom: opp.targetRoom,
    sourceId: opp.sourceId,
    sourceCount: opp.sourceSnapshot.sourceCount,
    expectedYield: opp.sourceSnapshot.expectedYield,
    budgetLimit: 5000,
    priority: 2,
    deadline: tick + 10000, // 10k tick 生命周期
    tick,
    activationThreshold: 5,
  };
  const op = createRemoteMiningOp(input);
  const ops = getRemoteMiningOps();
  ops.push(op);
  saveRemoteMiningOps(ops);
}
