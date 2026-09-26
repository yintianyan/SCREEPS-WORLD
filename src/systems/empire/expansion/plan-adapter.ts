/** Expansion Plan 适配层 — Plan 消费门禁、Gate 采集、Memory 瘦结构序列化。 */
import type { TickContext } from "../../../kernel/contracts";
import { log } from "../../../kernel/log";
import { makeOperationId } from "../../../domain/expansion/uoem-types";
import type { ExpansionPlan, PlanStatus } from "../../../domain/expansion/plan";
import {
  validateExecutionGate,
  type ExecutionGateInput,
} from "../../../domain/expansion/execution-gate";
import { getRoomIntel } from "../../intelligence";
import { pruneBlacklist } from "./uoem-events";

/**
 * 从 expansionPlans[] 中消费 WAITING_EXECUTION Plan。
 * 退役 V1 Evaluator 的自主评选——统一以 Plan 为唯一真相源。
 */
export function tryConsumePlan(ctx: TickContext): void {
  pruneBlacklist(ctx.tick);

  // 从 Memory 读取 Plan 列表
  if (!Memory.kernel) Memory.kernel = {};
  const plans = Memory.kernel.expansionPlans ?? [];
  const waitingPlan = plans.find(p => p.st === "WAITING_EXECUTION");
  if (!waitingPlan) return;

  // 反序列化 Plan 为可执行格式（简化版：直接用 Memory 瘦结构）
  const plan = deserializePlanMemory(waitingPlan);
  if (!plan) return;

  // 执行 Gate 验证（TOCTOU 防护）
  const gateInput: ExecutionGateInput = {
    plan,
    budget: getTieredBudget(ctx),
    isEmpireReady: Memory.kernel!.strategy?.expansionAllowed === true,
    alreadyOwned: isRoomOwned(plan.roomName),
    hasConcurrentOp: false, // 简化：检查是否有同类 Operation
    hasOtherExpansion: Memory.kernel!.expansion !== undefined,
    intelStale: isIntelStale(plan.roomName, ctx.tick),
    threatEscalated: false, // 简化：检查威胁升级
    targetClaimable: isTargetClaimable(plan.roomName),
    candidateValid: true, // 简化：候选仍然有效
  };

  const gateResult = validateExecutionGate(gateInput);
  if (!gateResult.allPassed) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion-manager: Gate failed for ${plan.roomName}: ${gateResult.evidence}`,
    );
    // 硬失败（计划本身不成立 / 目标根本不可 claim）→ 取消这条 Plan，让它进
    // rebuildCooldown 冷却期。原写法是 "EXECUTING"：既与上一行注释的意图相反，
    // 又因为"执行中"曾被 prunePlans 判为非在途而被当场删账 → 冷却从未生效，
    // 同一个不可 claim 的目标被逐周期重新立项。
    if (
      gateResult.failedGates.includes("GATE_PLAN_VALID") ||
      gateResult.failedGates.includes("GATE_TARGET_CLAIMABLE") ||
      gateResult.failedGates.includes("GATE_NOT_OWNED")
    ) {
      updatePlanStatus(plan.planId, "CANCELLED");
    }
    return;
  }

  // GCL 余量检查
  const gclLevel = Game.gcl?.level ?? 1;
  const ownedCount = Array.from(ctx.snapshots()).filter(s => s.controller?.my).length;
  if (gclLevel <= ownedCount) return;

  // 在途核弹目标排除——核弹 50k tick 不可取消，
  // 对有在途核弹的房扩张 = 落地时自伤。排除所有在途核弹目标。
  const nukesInFlight = Memory.kernel?.nukesInFlight ?? {};
  const nukesForTarget = nukesInFlight[plan.roomName] ?? [];
  const liveNukes = nukesForTarget.filter(landAt => landAt > ctx.tick);
  if (liveNukes.length > 0) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: ${plan.roomName} has ${liveNukes.length} nuke(s) in flight, skipping`,
    );
    return;
  }

  // 标记 Plan 为 EXECUTING —— 本条计划已被接管，之后的终态（COMPLETED / CANCELLED）
  // 由 state-machine 按 planId 回写。它必须在 ACTIVE_STATUSES 里，否则这条记录会在
  // 下一个 planner 周期被抹掉，终态回写全部落空（见 plan-lifecycle 的注释）。
  updatePlanStatus(plan.planId, "EXECUTING");

  // 初始化扩张状态
  if (!Memory.kernel) Memory.kernel = {};
  // UOEM：铸造 operationId（consume 时一次性，跨 reset 稳定）
  const operationId = makeOperationId(plan.roomName, ctx.tick);
  Memory.kernel.expansion = {
    state: "preparing",
    target: plan.roomName,
    sponsor: plan.sponsorRoom,
    startedAt: ctx.tick,
    planId: plan.planId,
    checkpointsPassed: 0,
    reservedEnergy: 0,
    consecutivePositiveTicks: 0,
    operationId,
    openedAt: ctx.tick, // UOEM：immutable lifecycle anchor
    forcedAdvance: false,
  };

  log.info(
    "expansion",
    `[${ctx.tick}] expansion-manager: consuming plan ${plan.planId} for ${plan.roomName} (sponsor=${plan.sponsorRoom})`,
  );
}

/** 检查房间是否已被拥有。 */
function isRoomOwned(roomName: string): boolean {
  const room = Game.rooms[roomName];
  return !!room?.controller?.my;
}

/** 检查 Intel 是否过期。 */
function isIntelStale(roomName: string, tick: number): boolean {
  // 从未观测过 = 不算过期（让 Gate 验证去做）；有记录按观察年龄判定。
  const entry = getRoomIntel(roomName);
  return entry !== undefined && tick - entry.observedAt > 10000;
}

/** 检查目标房是否可 claim。 */
function isTargetClaimable(roomName: string): boolean {
  const room = Game.rooms[roomName];
  if (!room?.controller) return false;
  // 不能 claim 已拥有的 controller
  if (room.controller.owner) return false;
  // 不能 claim 被敌方 reservation 的 controller
  if (room.controller.reservation && !room.controller.my) return false;
  return true;
}

/** 获取 Tiered Budget（简化版）。 */
function getTieredBudget(
  _ctx: TickContext,
): import("../../../domain/expansion/budget").TieredExpansionBudget {
  // 从 globalCache 获取或构建简化版
  const totalEnergy = Object.values(Game.rooms)
    .filter(r => r.controller?.my)
    .reduce((sum, r) => sum + (r.storage?.store[RESOURCE_ENERGY] ?? 0), 0);
  const coreReserve = Math.floor(totalEnergy * 0.5);
  return {
    totalEnergy,
    coreReserve,
    availableExpansion: Math.floor(totalEnergy * 0.3),
    emergencyReserve: Math.floor(totalEnergy * 0.1),
    operationalReserve: Math.floor(totalEnergy * 0.1),
    coreInvaded: false,
    tick: Game.time,
    evidence: "simplified",
  };
}

/** 获取可用扩张预算。 */
export function getAvailableBudget(ctx: TickContext): number {
  return getTieredBudget(ctx).availableExpansion;
}

/** 从 Memory 瘦结构反序列化 Plan。 */
function deserializePlanMemory(m: ExpansionPlanMemory): ExpansionPlan | null {
  if (!m || typeof m !== "object") return null;
  const cost = {
    roomName: m.rn,
    totalCost: m.tc,
    claimerCost: 650,
    pioneerCost: 0,
    spawnCost: 5000,
    travelCost: 0,
    infrastructureCost: 0,
    bootstrapEnergy: 0,
    evidence: "",
  };
  const payback = {
    roomName: m.rn,
    totalCost: m.tc,
    expectedIncomePerTick: 0,
    paybackTicks: m.pb === -1 ? Infinity : m.pb,
    roi: m.roi,
    worthwhile: m.roi >= 1,
    evidence: "",
  };
  const risk = {
    roomName: m.rn,
    score: m.rk,
    level: m.rl as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    dimensions: { economic: 0, operational: 0, distance: 0, recovery: 0, defense: 0 },
    evidence: "",
  };
  const candidate = {
    roomName: m.rn,
    sponsorRoom: m.sr,
    kind: "normal" as const,
    roomStatus: "normal" as const,
    sourceCount: 2,
    mineral: undefined,
    terrain: { exitCount: 4, sealedExitCount: 0, wallCount: 0 },
    controller: { hasOwner: false, isMine: false, isHostileReserved: false },
    pathCost: undefined,
    lastSeen: m.ca,
    distance: 1,
    neighborRooms: [],
    score: m.sc,
    status: "QUALIFIED" as const,
    discoveredAt: m.ca,
  };
  return {
    planId: m.pid,
    roomName: m.rn,
    sponsorRoom: m.sr,
    reason: m.rs as ExpansionPlan["reason"],
    priority: m.pr as "P0" | "P1" | "P2" | "P3",
    candidateScore: m.sc,
    cost,
    payback,
    risk,
    candidate,
    status: m.st,
    createdAt: m.ca,
    updatedAt: m.ua ?? m.ca,
    approvedAt: m.aa,
    cancelReason: m.cr,
    cancelConditions: [],
    dependencies: [],
    explanation: m.ex ?? "",
  };
}

/** 更新 Plan 状态到 Memory。 */
export function updatePlanStatus(planId: string, status: PlanStatus): void {
  if (!planId) return;
  const plans = Memory.kernel?.expansionPlans;
  if (!plans) return;
  const plan = plans.find(p => p.pid === planId);
  if (plan) {
    plan.st = status;
    plan.ua = Game.time;
  }
}
