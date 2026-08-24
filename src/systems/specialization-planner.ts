/**
 * Specialization Planner System — A4.0/A4.1 系统侧薄壳。
 *
 * 合同锚点：A4.1 Architecture Audit §3.2（A4.0 纯函数层完整但系统层缺失）。
 * 记忆约束 [[memory:17875714213295541337]]：Remote Mining 必须作为 Empire
 * Resource Network 上的 Resource Production Operation。
 *
 * 设计意图：
 *   A4.0 建立了完整的纯函数层（Empire Room Role / Supply Contract / Remote
 *   Opportunity / Contract-Node Bridge），但没有系统侧薄壳来驱动它们。
 *   specialization-planner 是连接 Opportunity → Execution → Operation 的系统侧入口。
 *
 *   职责（每 100 tick 运行一次，P1）：
 *   1. 评估 WAITING_EXECUTION Opportunities → Execution Gate 验证
 *   2. APPROVED → 在 remote-mining-manager 中创建 remoteOps
 *   3. REJECTED → 记录原因
 *   4. 定期重估 Active Operations 的经济健康度
 *   5. 过期 Opportunities 清理
 *
 *   不做的事：
 *   - 不替代 remote-mining-manager 的执行链
 *   - 不直接调用 spawnCreep
 *   - 不直接创建 construction site
 *   - 不修改 RoomEconomicProfile（由 empire-economy 计算）
 *
 * 硬约束：模块顶层禁止访问 Game / Memory（SYSTEM_BOUNDARIES §2.3-3）。
 */

import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
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

/**
 * Specialization Planner System — P1, interval=100。
 *
 * 每 100 tick 运行一次，消费 WAITING_EXECUTION Opportunities 并评估
 * 活跃远矿 Operation 的经济健康度。
 */
export const specializationPlannerSystem: System = {
  name: "specialization-planner",
  priority: 1 as Priority,
  interval: 100,
  run(ctx: TickContext): void {
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
        console.log(
          `[${ctx.tick}] specialization-planner: APPROVED opportunity ${opp.id} ` +
          `(${opp.homeRoom}→${opp.targetRoom})`,
        );
      } else if (isGatePermanentFailure(result)) {
        // 永久失败 → REJECT
        rejectOpportunity(opp, ctx.tick, result.reason);
        console.log(
          `[${ctx.tick}] specialization-planner: REJECTED opportunity ${opp.id} ` +
          `(${result.type}: ${result.reason})`,
        );
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

    // 4. 写回 Memory
    saveOpportunities(freshOpps);
    saveRemoteMiningOps(activeOps);
  },
};

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
 *
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
 *
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
