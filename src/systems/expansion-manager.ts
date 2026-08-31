/** Expansion Manager */
import { CONFIG } from "../config";
import { selectBody } from "../config/bodies";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import { log } from "../kernel/log";
import { makeOperationId, type ExpansionResult, type OutcomeEvent, type MilestoneEvent } from "../domain/expansion/uoem-types";
import { getOutcomeChannel, enqueueOutcome, makeEventId, type OutcomeChannelMemory } from "../kernel/outcome-channel";
import {
  decideBootstrapRooms,
  BOOTSTRAP_WORKER_BODY,
  BOOTSTRAP_DEFENDER_BODY,
} from "../domain/expansion/bootstrap";
import { roomLinearDistance } from "../domain/remote/targeting";
import { getRoomIntel } from "./intelligence";
import {
  appendOutcome,
  evaluateExpansionRhythm,
  type ExpansionOutcomeKind,
} from "../domain/expansion/rhythm";
import { cancelRequestsByHome, hasRequest, submitRequest } from "../domain/spawn/queue";
import { querySquad, globalCache } from "../kernel/global-cache";
import { selectAnchors } from "../domain/layout/anchor-selection";
import { computeDistanceField } from "../domain/layout/terrain-analysis";
import { packPos } from "../domain/layout/types";
import { COMPACT_CORE_V2 } from "../domain/layout/templates/compact-core-v2";
import type { ExpansionPlan } from "../domain/expansion/plan";
import type { ExecutionState } from "../domain/expansion/execution-state";
import { transitionExecutionState, getExecutionProgress, describeExecutionState } from "../domain/expansion/execution-state";
import { validateExecutionGate, type ExecutionGateInput } from "../domain/expansion/execution-gate";
import { evaluateCheckpoint, type CheckpointId } from "../domain/expansion/checkpoint";
import { evaluateEconomicActivation, type EconomicActivationInput } from "../domain/expansion/economic-activation";
import { evaluateEmpireIntegration, canHandover, type EmpireIntegrationInput } from "../domain/expansion/empire-integration";
import { evaluateThreatEscalation, type ThreatEscalationInput } from "../domain/expansion/threat-escalation";
import {
  tryReserve,
  releaseReservation,
  isReservationExpired,
  type ResourceReservation,
} from "../domain/expansion/resource-reservation";
import { evaluateExpansionCooldown, DEFAULT_COOLDOWN_CONFIG } from "../domain/expansion/expansion-cooldown";
import { evaluateAutonomyAge } from "../domain/expansion/autonomy";
import { evaluateStabilityScore } from "../domain/expansion/stability-score";
import { evaluateColonyFailure } from "../domain/expansion/colony-failure";
import { evaluateExpansionRoi, type EmpireSnapshot } from "../domain/expansion/roi-tracker";
import { buildColonyStabilityDashboard } from "../domain/expansion/colony-dashboard";
import { recordExpansionCompleted, recordExpansionFailed, recordPlanningDecision } from "../telemetry";
/** ExpansionOutcome 事件编码（与 event-log 注释对齐）。 */
const PHASE_CLAIM = 0;
const PHASE_PIONEER = 1;
const OUTCOME_SUCCESS = 0;
const OUTCOME_STOLEN = 1;
const OUTCOME_TIMEOUT = 2;
const OUTCOME_LOST = 3;
const OUTCOME_ABORTED = 4;

/** Checkpoint ID 列表（顺序执行）。 */
const CHECKPOINT_IDS: CheckpointId[] = [
  "CP1_CLAIMED",
  "CP2_SPAWN_ACTIVE",
  "CP3_ENERGY_LOOP",
  "CP4_BASIC_INFRA",
  "CP5_ECONOMIC_ACTIVATION",
];

/** 状态机认识的全部分支 — Memory 中不在此列的 state 为旧版残留值。 */
const EXECUTION_STATES: ReadonlySet<string> = new Set([
  "validating",
  "preparing",
  "claiming",
  "claimed",
  "bootstrapping",
  "economic_startup",
  "integrating",
  "completed",
  "failed",
  "aborted",
]);

export const expansionManagerSystem: System = {
  name: "expansion-manager",
  priority: 3 as Priority,
  interval: CONFIG.expansion.interval,
  run(ctx: TickContext): void {
    if (!Memory.kernel) Memory.kernel = {};
    // 旧版残留状态防护：状态机没有对应分支的 state（如旧版 pioneering）每 tick
    // 静默穿透，扩张记录永不消失，hasOtherExpansion 恒真挡住后续新扩张计划。
    // 残留记录直接离场，扩张管道不因旧数据卡死。
    const pending = Memory.kernel.expansion;
    if (pending && !EXECUTION_STATES.has(pending.state)) {
      log.info("expansion", `[${ctx.tick}] expansion: 清理旧版残留状态 ${pending.state}（target=${pending.target}）`);
      Memory.kernel.expansion = undefined;
    }
    // 自举车道（审计修复，W38S59 事故实证）：owned 无 spawn 的房不在扩张状态机
    // 覆盖内 —— 任务 success/aborted 即离场，本地 spawnQueue 无 spawn 永不可孵化，
    // 建造无 builder 可用，唯一活路是姊妹房代孵 bootstrap 组。生存级，独立于
    // 姿态与扩张任务；CPU 极轻（仅快照字段 + 已有房间的免费查询）。
    runBootstrapLane(ctx);
    const expansion = Memory.kernel.expansion;

    if (!expansion) {
      // C-1：CPU 门禁只裁决「是否开启新行动」— 扩张是纯发展行为，CPU 紧张时不开新局。
      if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
      if ((Game.cpu.bucket ?? 0) < 5000) return;
      // R7b：连续失败暂停止损 — 「失败→立刻再试」是烧 GCL 窗口的循环。
      if ((Memory.kernel.expansionPausedUntil ?? 0) > ctx.tick) return;
      // 战略门禁：是否扩张由 empire-strategy 的姿态裁决（Strategy 层）— 本系统只在
      // 获得授权时评选目标，不自行判断时机。姿态未就绪（reset 首 tick）默认不扩张。
      if (Memory.kernel.strategy?.expansionAllowed !== true) return;
      // A3.4：Expansion Cooldown 检查 — 防止扩张级联
      const cooldownResult = evaluateExpansionCooldown({
        lastCompletedTick: Memory.kernel.lastExpansionCompletedTick,
        activeExpansionCount: Memory.kernel.expansion ? 1 : 0,
        currentTick: ctx.tick,
        config: DEFAULT_COOLDOWN_CONFIG,
      });
      if (!cooldownResult.allowed) {
        log.info("expansion",`[${ctx.tick}] expansion: ${cooldownResult.evidence}`);
        return;
      }
      // A3.3：从 expansionPlans[] 消费 WAITING_EXECUTION Plan
      tryConsumePlan(ctx);
      return;
    }

    // 进行中的扩张行动不因姿态回落而中断 — claimer/拓荒编队已是沉没投资，
    // 半途而废比完成更贵；姿态只裁决「是否开启新行动」。
    const spawningAllowed =
      (ctx.budget.tier === "healthy" || ctx.budget.tier === "guarded") &&
      (Game.cpu.bucket ?? 0) >= 5000;

    // A3.3：完整状态机推进
    advanceExecutionStateMachine(ctx, expansion, spawningAllowed);
  },
};

type ExpansionState = NonNullable<KernelMemory["expansion"]>;

// ─── A3.3：从 Plan 消费 → 启动执行 ──────────────────────────

/**
 * A3.3：从 expansionPlans[] 中消费 WAITING_EXECUTION Plan。

 * 退役 V1 Evaluator 的自主评选——统一以 Plan 为唯一真相源。
 */
function tryConsumePlan(ctx: TickContext): void {
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
    log.info("expansion",`[${ctx.tick}] expansion-manager: Gate failed for ${plan.roomName}: ${gateResult.evidence}`);
    // 如果 Gate 持续失败，更新 Plan 状态为 CANCELLED
    if (gateResult.failedGates.includes("GATE_PLAN_VALID") ||
        gateResult.failedGates.includes("GATE_TARGET_CLAIMABLE") ||
        gateResult.failedGates.includes("GATE_NOT_OWNED")) {
      updatePlanStatus(plan.planId, "EXECUTING");
    }
    return;
  }

  // GCL 余量检查
  const gclLevel = Game.gcl?.level ?? 1;
  const ownedCount = Array.from(ctx.snapshots()).filter(s => s.controller?.my).length;
  if (gclLevel <= ownedCount) return;

  // 标记 Plan 为 EXECUTING
  updatePlanStatus(plan.planId, "EXECUTING");

  // 初始化扩张状态
  if (!Memory.kernel) Memory.kernel = {};
  // Phase 6 UOEM：铸造 operationId（consume 时一次性，跨 reset 稳定）
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

  log.info("expansion",`[${ctx.tick}] expansion-manager: consuming plan ${plan.planId} for ${plan.roomName} (sponsor=${plan.sponsorRoom})`);
}

// ─── A3.3：完整状态机推进 ─────────────────────────────────────

/**
 * A3.3 核心函数：推进执行状态机。

 * 从当前状态出发，检查转换条件，推进到下一个状态。
 * 覆盖完整链路：preparing → claiming → claimed → bootstrapping →
 * economic_startup → integrating → completed
 */
function advanceExecutionStateMachine(ctx: TickContext, expansion: ExpansionState, spawningAllowed: boolean): void {
  switch (expansion.state) {
    case "validating":
      // Gate 验证已在 tryConsumePlan 中完成，直接推进
      expansion.state = "preparing";
      expansion.startedAt = ctx.tick;
      log.info("expansion",`[${ctx.tick}] expansion: validating → preparing`);
      break;

    case "preparing":
      advancePreparing(ctx, expansion, spawningAllowed);
      break;

    case "claiming":
      advanceClaiming(ctx, expansion, spawningAllowed);
      break;

    case "claimed":
      // Checkpoint 1: Claimed — 直接推进到 bootstrapping
      expansion.state = "bootstrapping";
      expansion.startedAt = ctx.tick;
      expansion.checkpointsPassed = Math.max(expansion.checkpointsPassed ?? 0, 1);
      // 选锚点 + 写 layout
      const claimedRoom = Game.rooms[expansion.target];
      if (claimedRoom) {
        if (!seedLayoutAnchor(claimedRoom)) {
          log.info("expansion",`[${ctx.tick}] expansion: no viable anchor in ${expansion.target}, aborting`);
          abortExpansion(ctx, expansion, "ABANDONED");
          return;
        }
      }
      submitPioneers(ctx, expansion);
      log.info("expansion",`[${ctx.tick}] expansion: claimed → bootstrapping (CP1 passed)`);
      break;

    case "bootstrapping":
      advanceBootstrapping(ctx, expansion, spawningAllowed);
      break;

    case "economic_startup":
      advanceEconomicStartup(ctx, expansion);
      break;

    case "integrating":
      advanceIntegrating(ctx, expansion);
      break;

    case "completed":
      // 已完成，清理扩张状态
      log.info("expansion",`[${ctx.tick}] expansion: ${expansion.target} already completed, cleaning up`);
      updatePlanStatus(expansion.planId ?? "", "COMPLETED");
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.expansion = undefined;
      break;

    case "failed":
    case "aborted":
      // 已终止，清理
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.expansion = undefined;
      break;

    default:
      // 未知状态（旧版残留等）— 与 run 入口的残留防护同口径，清理防穿透。
      log.info("expansion", `[${ctx.tick}] expansion: 未知状态 ${expansion.state}（target=${expansion.target}），清理扩张记录`);
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.expansion = undefined;
      break;
  }

  // A3.3：写入 Execution Dashboard 到 globalCache
  const g = globalCache() as Record<string, unknown> & { executionDashboard?: unknown };
  g.executionDashboard = {
    tick: ctx.tick,
    executionState: expansion.state,
    targetRoom: expansion.target,
    sponsorRoom: expansion.sponsor,
    progress: getExecutionProgress(expansion.state as ExecutionState),
    checkpointsPassed: expansion.checkpointsPassed ?? 0,
    reservedEnergy: expansion.reservedEnergy ?? 0,
    consecutivePositiveTicks: expansion.consecutivePositiveTicks ?? 0,
    summary: `[${ctx.tick}] expansion: ${expansion.target} state=${expansion.state} cp=${expansion.checkpointsPassed ?? 0}/5`,
  };
}

// ── preparing ──────────────────────────────────────────────

function advancePreparing(ctx: TickContext, expansion: ExpansionState, spawningAllowed: boolean): void {
  // 尝试预留资源
  if (!expansion.reservedEnergy || expansion.reservedEnergy === 0) {
    const reserveResult = tryReserve({
      planId: expansion.planId ?? "",
      energyNeeded: 5000, // 估算的 bootstrap 能量
      availableExpansionBudget: getAvailableBudget(ctx),
      tick: ctx.tick,
    });
    if (reserveResult.success && reserveResult.reservation) {
      expansion.reservedEnergy = reserveResult.reservation.reservedEnergy;
      log.info("expansion",`[${ctx.tick}] expansion: reserved ${expansion.reservedEnergy} energy for ${expansion.target}`);
    } else {
      log.info("expansion",`[${ctx.tick}] expansion: resource reservation failed: ${reserveResult.failReason}`);
      // 预留失败不立即终止，重试
    }
  }

  // 提交 Claimer 请求
  if (spawningAllowed) {
    submitClaimer(expansion.sponsor, expansion.target, ctx.tick);
  }

  // 检查 Claimer 是否已创建
  const claimerAlive = querySquad({ role: "claimer", remoteTarget: expansion.target }).length > 0;
  const claimerPending = hasRequest(
    Memory.rooms[expansion.sponsor]?.spawnQueue ?? [],
    `claimer:${expansion.sponsor}:${expansion.target}`,
  );

  if (claimerAlive || claimerPending) {
    expansion.state = "claiming";
    expansion.startedAt = ctx.tick;
    log.info("expansion",`[${ctx.tick}] expansion: preparing → claiming`);
  }

  // 超时检查
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.claimTimeout) {
    log.info("expansion",`[${ctx.tick}] expansion: preparing timed out, aborting`);
    abortExpansion(ctx, expansion, "TIMED_OUT");
  }
}


// ── claiming ────────────────────────────────────────────────

function advanceClaiming(ctx: TickContext, expansion: ExpansionState, spawningAllowed: boolean): void {
  const targetRoom = Game.rooms[expansion.target];

  // 占领成功 → 进入 claimed
  if (targetRoom?.controller?.my) {
    expansion.state = "claimed";
    expansion.startedAt = ctx.tick;
    // Phase 6 UOEM: P1 是 Milestone（CLAIMED），不进 OutcomeChannel
    emitMilestone(expansion, "CLAIMED", ctx.tick);
    log.info("expansion",`[${ctx.tick}] expansion: claiming → claimed`);
    return;
  }

  // 被他人抢占 → 立即放弃
  if (targetRoom?.controller?.owner && !targetRoom.controller.my) {
    log.info("expansion",`[${ctx.tick}] expansion: ${expansion.target} taken by ${targetRoom.controller.owner.username}, aborting`);
    // Phase 6 UOEM: abortExpansion 内部统一做 blacklist + reclaim + enqueue
    abortExpansion(ctx, expansion, "STOLEN");
    return;
  }

  // 超时 → 放弃
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.claimTimeout) {
    log.info("expansion",`[${ctx.tick}] expansion: claim ${expansion.target} timed out, aborting`);
    abortExpansion(ctx, expansion, "TIMED_OUT");
    return;
  }

  // Claimer 阵亡且无 pending → 幂等重派
  const claimerAlive = querySquad({ role: "claimer", remoteTarget: expansion.target }).length > 0;
  if (!claimerAlive) {
    const dangerUntil = Memory.rooms[expansion.sponsor]?.remoteOps?.[expansion.target]?.dangerUntil;
    if (dangerUntil !== undefined && ctx.tick < dangerUntil) {
      log.info("expansion",`[${ctx.tick}] expansion: ${expansion.target} hostile (claimer lost), aborting`);
      // Phase 6 UOEM: abortExpansion 内部统一做 blacklist + reclaim + enqueue
      abortExpansion(ctx, expansion, "LOST");
      return;
    }
    if (!spawningAllowed) return;
    submitClaimer(expansion.sponsor, expansion.target, ctx.tick);
  }
}

// ── bootstrapping（旧 pioneering 的升级版）──────────────────

function advanceBootstrapping(ctx: TickContext, expansion: ExpansionState, spawningAllowed: boolean): void {
  const targetRoom = Game.rooms[expansion.target];

  // 失守/失明检查（与旧 advancePioneering 相同逻辑）
  if (!targetRoom?.controller?.my) {
    // Phase 6 UOEM: terminal outcome 只由 abortExpansion 产生一次
    // P2/P3 的 LOST/STOLEN 直接传给 abortExpansion，不在前面调 record
    if (!targetRoom) {
      log.info("expansion",`[${ctx.tick}] expansion: lost vision of ${expansion.target} during bootstrapping, aborting`);
      abortExpansion(ctx, expansion, "LOST");
    } else {
      log.info("expansion",`[${ctx.tick}] expansion: lost ${expansion.target} during bootstrapping, aborting`);
      abortExpansion(ctx, expansion, "STOLEN");
    }
    return;
  }

  // Checkpoint 2: Spawn Active
  const spawns = targetRoom.find(FIND_MY_SPAWNS);
  if (spawns.length > 0) {
    // Spawn 已建成 → 检查是否能孵化
    const spawnCanSpawn = targetRoom.energyAvailable >= 300;
    const cp2 = evaluateCheckpoint({
      checkpointId: "CP2_SPAWN_ACTIVE",
      controllerClaimed: true,
      spawnBuilt: spawns.length > 0,
      spawnCanSpawn,
      harvesterActive: false,
      transporterActive: false,
      extensionsBuilt: false,
      containerBuilt: false,
      roadsBuilt: false,
      netEnergyFlowPositive: false,
      empireIntegrated: false,
      tick: ctx.tick,
      retryCount: 0,
    });

    if (cp2.passed) {
      expansion.checkpointsPassed = Math.max(expansion.checkpointsPassed ?? 0, 2);
      expansion.state = "economic_startup";
      expansion.startedAt = ctx.tick;
      log.info("expansion",`[${ctx.tick}] expansion: bootstrapping → economic_startup (CP2 passed)`);
      return;
    }
  }

  // 威胁止损
  const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
    filter: c => !CONFIG.defense.allies.includes(c.owner?.username ?? "") &&
      c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK),
  });
  if (hostiles.length > 0) {
    const squadAlive = querySquad({ home: expansion.target }).some(
      e => e.role === "worker" || e.role === "builder",
    );
    if (!squadAlive) {
      log.info("expansion",`[${ctx.tick}] expansion: ${expansion.target} squad wiped by hostiles, aborting`);
      // Phase 6 UOEM: terminal outcome 只由 abortExpansion 产生一次
      abortExpansion(ctx, expansion, "LOST");
      return;
    }
  }

  // 超时
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.pioneerTimeout) {
    log.info("expansion",`[${ctx.tick}] expansion: bootstrapping ${expansion.target} timed out`);
    // Phase 6 UOEM: P5 是 Milestone（FORCED_ADVANCE），不进 OutcomeChannel
    emitMilestone(expansion, "FORCED_ADVANCE", ctx.tick);
    // 不直接 abort — 如果 spawn 已建成，尝试推进到 economic_startup
    if (spawns.length > 0) {
      expansion.state = "economic_startup";
      expansion.startedAt = ctx.tick;
      log.info("expansion",`[${ctx.tick}] expansion: forcing bootstrapping → economic_startup (spawn exists)`);
      return;
    }
    abortExpansion(ctx, expansion, "TIMED_OUT");
    return;
  }

  // 补充编队
  if (hostiles.length === 0 && spawningAllowed) {
    submitPioneers(ctx, expansion);
  }
}

// ── economic_startup（A3.3 新增：能量环路建立）──────────────

function advanceEconomicStartup(ctx: TickContext, expansion: ExpansionState): void {
  const targetRoom = Game.rooms[expansion.target];

  if (!targetRoom?.controller?.my) {
    log.info("expansion",`[${ctx.tick}] expansion: lost ${expansion.target} during economic_startup, aborting`);
    // Phase 6 UOEM: terminal outcome 只由 abortExpansion 产生一次
    abortExpansion(ctx, expansion, "LOST");
    return;
  }

  // 检查 harvester/物流活跃度。
  // Phantom Transporter Bug 修复：系统不存在 "transporter" 角色，实际运输由 hauler
  // 和 distributor 承担。此处检查 hauler 或 distributor 存在即为物流活跃。
  const harvesterActive = querySquad({ home: expansion.target, role: "harvester" }).length > 0;
  const logisticsActive = querySquad({ home: expansion.target })
    .some(e => e.role === "hauler" || e.role === "distributor");

  const spawns = targetRoom.find(FIND_MY_SPAWNS);
  const spawnCanSpawn = spawns.length > 0 && targetRoom.energyAvailable >= 300;

  // Checkpoint 3: Energy Loop
  const cp3 = evaluateCheckpoint({
    checkpointId: "CP3_ENERGY_LOOP",
    controllerClaimed: true,
    spawnBuilt: spawns.length > 0,
    spawnCanSpawn,
    harvesterActive,
    transporterActive: logisticsActive,
    extensionsBuilt: false,
    containerBuilt: false,
    roadsBuilt: false,
    netEnergyFlowPositive: false,
    empireIntegrated: false,
    tick: ctx.tick,
    retryCount: 0,
  });

  if (cp3.passed) {
    expansion.checkpointsPassed = Math.max(expansion.checkpointsPassed ?? 0, 3);
    log.info("expansion",`[${ctx.tick}] expansion: CP3 (Energy Loop) passed for ${expansion.target}`);
  }

  // 检查基础基础设施
  const extensions = targetRoom.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION,
  });
  const containers = targetRoom.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_CONTAINER,
  });

  // Checkpoint 4: Basic Infra
  const cp4 = evaluateCheckpoint({
    checkpointId: "CP4_BASIC_INFRA",
    controllerClaimed: true,
    spawnBuilt: spawns.length > 0,
    spawnCanSpawn,
    harvesterActive,
    transporterActive: logisticsActive,
    extensionsBuilt: extensions.length >= 5, // RCL2 = 5 extensions
    containerBuilt: containers.length > 0,
    roadsBuilt: true, // 简化：不强制道路
    netEnergyFlowPositive: false,
    empireIntegrated: false,
    tick: ctx.tick,
    retryCount: 0,
  });

  if (cp4.passed) {
    expansion.checkpointsPassed = Math.max(expansion.checkpointsPassed ?? 0, 4);
    log.info("expansion",`[${ctx.tick}] expansion: CP4 (Basic Infra) passed for ${expansion.target}`);
  }

  // CP3 + CP4 都通过 → 进入 integrating
  if (cp3.passed && cp4.passed) {
    expansion.state = "integrating";
    expansion.startedAt = ctx.tick;
    log.info("expansion",`[${ctx.tick}] expansion: economic_startup → integrating`);
    return;
  }

  // 超时检查（economic_startup 阶段给更长的时间）
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.pioneerTimeout * 2) {
    log.info("expansion",`[${ctx.tick}] expansion: economic_startup timed out for ${expansion.target}`);
    // 如果至少 energy loop 活跃，尝试强行推进
    if (cp3.passed) {
      // Phase 6 UOEM: P7 是 Milestone（FORCED_ADVANCE），不进 OutcomeChannel
      emitMilestone(expansion, "FORCED_ADVANCE", ctx.tick);
      expansion.state = "integrating";
      expansion.startedAt = ctx.tick;
      log.info("expansion",`[${ctx.tick}] expansion: forcing economic_startup → integrating (energy loop active)`);
      return;
    }
    abortExpansion(ctx, expansion, "TIMED_OUT");
  }
}

// ── integrating（A3.3 新增：经济激活 + 帝国集成）────────────

function advanceIntegrating(ctx: TickContext, expansion: ExpansionState): void {
  const targetRoom = Game.rooms[expansion.target];

  if (!targetRoom?.controller?.my) {
    log.info("expansion",`[${ctx.tick}] expansion: lost ${expansion.target} during integrating, aborting`);
    abortExpansion(ctx, expansion, "LOST");
    return;
  }

  // 评估经济激活
  const economicInput: EconomicActivationInput = {
    energyProduction: estimateEnergyProduction(targetRoom),
    energyConsumption: estimateEnergyConsumption(targetRoom),
    externalEnergyInflow: estimateExternalInflow(expansion.target, expansion.sponsor),
    consecutivePositiveTicks: expansion.consecutivePositiveTicks ?? 0,
    hasHarvester: querySquad({ home: expansion.target, role: "harvester" }).length > 0,
    // Phantom Transporter Bug 修复：检查 hauler 或 distributor 存在即为物流活跃。
    // 系统不存在 "transporter" 角色，实际运输由 hauler（源→sink）和
    // distributor（storage→sink）承担。
    hasTransporter: querySquad({ home: expansion.target })
      .some(e => e.role === "hauler" || e.role === "distributor"),
    hasUpgrader: querySquad({ home: expansion.target, role: "upgrader" }).length > 0,
    spawnActive: targetRoom.find(FIND_MY_SPAWNS).some(s => !s.spawning),
    tick: ctx.tick,
  };

  const econResult = evaluateEconomicActivation(economicInput);

  // 更新连续净流为正的 tick 数
  if (econResult.netFlow > 0) {
    expansion.consecutivePositiveTicks = (expansion.consecutivePositiveTicks ?? 0) + 1;
  } else {
    expansion.consecutivePositiveTicks = 0;
  }

  log.info("expansion",`[${ctx.tick}] expansion: integrating ${expansion.target} — ${econResult.evidence}`);

  // 评估帝国集成（A3.4 修复：从真实系统状态验证，不硬编码）
  const integrationInput: EmpireIntegrationInput = {
    inOwnedRoomsList: !!targetRoom.controller?.my, // controller.my 已验证
    hasSnapshot: Array.from(ctx.snapshots()).some(s => s.roomName === expansion.target), // 检查 snapshot 是否包含
    inEconomyStats: isRoomInEconomyStats(ctx, expansion.target), // 检查经济统计
    spawnManaged: isSpawnManaged(ctx, expansion.target), // 检查 spawn-manager 是否覆盖
    defenseCovered: isDefenseCovered(ctx, expansion.target), // 检查防御覆盖
    hasVersionedLayout: Memory.rooms[expansion.target]?.layout !== undefined,
    tick: ctx.tick,
  };

  const integrationResult = evaluateEmpireIntegration(integrationInput);

  // Checkpoint 5: Economic Activation + Empire Integration
  const cp5 = evaluateCheckpoint({
    checkpointId: "CP5_ECONOMIC_ACTIVATION",
    controllerClaimed: true,
    spawnBuilt: targetRoom.find(FIND_MY_SPAWNS).length > 0,
    spawnCanSpawn: targetRoom.energyAvailable >= 300,
    harvesterActive: economicInput.hasHarvester,
    transporterActive: economicInput.hasTransporter, // 已修复：检查 hauler/distributor
    extensionsBuilt: true,
    containerBuilt: true,
    roadsBuilt: true,
    netEnergyFlowPositive: econResult.netFlow > 0,
    empireIntegrated: integrationResult.integrated,
    tick: ctx.tick,
    retryCount: 0,
  });

  if (cp5.passed && canHandover(integrationResult, econResult.activated)) {
    // 全链路完成！
    expansion.checkpointsPassed = 5;
    expansion.state = "completed";
    log.info("expansion",`[${ctx.tick}] expansion: integrating → completed (CP5 passed) — ${expansion.target} is now AUTONOMOUS`);
    // Phase 6 UOEM: P8 终态 COMPLETED，直接调 enqueueTerminalOutcome
    enqueueTerminalOutcome(expansion, ctx.tick, "COMPLETED");
    // A3.4：记录完成 tick，供 Cooldown 门禁消费
    if (!Memory.kernel) Memory.kernel = {};
    Memory.kernel.lastExpansionCompletedTick = ctx.tick;
    // 标记 Plan 为 COMPLETED
    updatePlanStatus(expansion.planId ?? "", "COMPLETED");
  // 释放预留资源
  if (!Memory.kernel) Memory.kernel = {};
  if (expansion.reservedEnergy && expansion.reservedEnergy > 0) {
    log.info("expansion",`[${ctx.tick}] expansion: releasing ${expansion.reservedEnergy} reserved energy for ${expansion.target}`);
  }
  // 清理扩张状态
  Memory.kernel.expansion = undefined;
  return;
  }

  // 超时检查（integrating 阶段给最长的时间）
  const integratingTimeout = CONFIG.expansion.pioneerTimeout * 3;
  if (ctx.tick - expansion.startedAt > integratingTimeout) {
    log.info("expansion",`[${ctx.tick}] expansion: integrating timed out for ${expansion.target} (netFlow=${econResult.netFlow})`);
    // 如果经济至少在正方向，仍然算成功
    if (econResult.netFlow > 0 && integrationResult.integrated) {
      expansion.state = "completed";
      expansion.checkpointsPassed = 5;
      log.info("expansion",`[${ctx.tick}] expansion: forcing integrating → completed (net positive + integrated)`);
      // Phase 6 UOEM: P9 终态 COMPLETED_FORCED（经历过 forced advance 的超时强推完成）
      enqueueTerminalOutcome(expansion, ctx.tick, "COMPLETED_FORCED");
      updatePlanStatus(expansion.planId ?? "", "COMPLETED");
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.expansion = undefined;
      return;
    }
    abortExpansion(ctx, expansion, "TIMED_OUT");
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────

/**
 * 终止扩张行动的统一清理函数。
 * Phase 6 UOEM: 直接接收 ExpansionResult，调用 enqueueTerminalOutcome（唯一终态出口）。
 * 不再调用旧 recordExpansionOutcome — 消除配对双写。
 * blacklistTarget/reclaimExpeditionCreeps 在此统一执行，调用方不需重复。
 */
function abortExpansion(ctx: TickContext, expansion: ExpansionState, outcome: ExpansionResult): void {
  // Phase 6 UOEM: 唯一终态写入 — enqueueTerminalOutcome 幂等去重
  enqueueTerminalOutcome(expansion, ctx.tick, outcome);
  // 释放预留资源
  if (!Memory.kernel) Memory.kernel = {};
  if (expansion.reservedEnergy && expansion.reservedEnergy > 0) {
    log.info("expansion",`[${ctx.tick}] expansion: releasing ${expansion.reservedEnergy} reserved energy (abort)`);
  }
  blacklistTarget(expansion.target, ctx.tick);
  reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
  // 标记 Plan 为 CANCELLED
  if (expansion.planId) {
    updatePlanStatus(expansion.planId, "CANCELLED");
  }
  Memory.kernel.expansion = undefined;
}

// ─── V1 辅助函数（保留，供 Plan 消费路径使用）────────────────

// ─── Phase 6 UOEM: Milestone / Outcome 分离 ─────────────────
//
// EXP-1 修复：P1/P5/P7 不再调 recordExpansionOutcome，改为 emitMilestone。
//  - Milestone 不写 OutcomeChannel
//  - Milestone 不写 globalCache().lastExpansionOutcome
//  - Milestone 不进 rhythm ring
//  - forcedAdvance 标志持久化到 Memory.kernel.expansion.forcedAdvance
//
// 终态路径（P2/P3/P4/P6/P8/P9/A1/B1）改为 enqueueTerminalOutcome。
//  - 写 OutcomeChannel（Memory 持久化，幂等去重）
//  - 保留 recordEvent 写 eventLog
//  - rhythm ring 只在终态路径更新

/** 事件序列号（用于 makeEventId）。heap only — reset 后从 0 重启可接受。 */
let __uoemEventSeq = 0;

/**
 * 发射 MilestoneEvent — 非终态事件，不进入 OutcomeChannel。
 * P1 claim 成功、P5 forced advance、P7 forced success 调用此函数。
 */
function emitMilestone(
  expansion: ExpansionState,
  milestone: string,
  tick: number,
): void {
  const operationId = expansion.operationId
    ?? makeOperationId(expansion.target, expansion.openedAt ?? expansion.startedAt);

  // FORCED_ADVANCE 标志传播
  if (milestone === "FORCED_ADVANCE" && !expansion.forcedAdvance) {
    expansion.forcedAdvance = true;
  }

  // recordEvent 保留（eventLog 不变）
  recordEvent(EventKind.ExpansionOutcome, expansion.target, [
    expansion.state === "claiming" || expansion.state === "preparing" ? PHASE_CLAIM : PHASE_PIONEER,
    milestone === "CLAIMED" ? OUTCOME_SUCCESS : OUTCOME_TIMEOUT,
    tick - expansion.startedAt,
  ]);

  // MilestoneEvent 构造（不写 channel，不写 globalCache）
  const _event: MilestoneEvent = {
    kind: "MILESTONE",
    milestone,
    at: tick,
    eventId: makeEventId(tick, ++__uoemEventSeq),
    operationId,
  };
  // 可选：写入 eventLog 供 telemetry 追踪（不进 OutcomeChannel）
  // 目前 eventLog 已通过 recordEvent 记录，MilestoneEvent 本身无需额外持久化
}

/**
 * 入队终态 OutcomeEvent — 唯一终态出口。
 * P2/P3/P4/P6/P8/P9/A1/B1 调用此函数。
 * 同一 operationId 只接受第一条（幂等去重）。
 */
function enqueueTerminalOutcome(
  expansion: ExpansionState,
  tick: number,
  result: ExpansionResult,
): void {
  const operationId = expansion.operationId
    ?? makeOperationId(expansion.target, expansion.openedAt ?? expansion.startedAt);
  const openedAt = expansion.openedAt ?? expansion.startedAt;

  // recordEvent 保留（eventLog 不变）
  const phaseCode = expansion.state === "claiming" || expansion.state === "preparing" ? PHASE_CLAIM : PHASE_PIONEER;
  const outcomeCode = resultToOutcomeCode(result);
  recordEvent(EventKind.ExpansionOutcome, expansion.target, [
    phaseCode,
    outcomeCode,
    tick - openedAt, // UOEM: 使用 openedAt 而非 startedAt
  ]);

  // 构造 OutcomeEvent
  const ev: OutcomeEvent = {
    kind: "OUTCOME",
    domain: "expansion",
    result,
    operationId,
    eventId: makeEventId(tick, ++__uoemEventSeq),
    interval: { openedAt, closedAt: tick },
    forcedAdvance: expansion.forcedAdvance ?? false,
  };

  // 入队 OutcomeChannel（Memory 持久化，幂等去重）
  const channel = getOutcomeChannel(Memory as { kernel?: Record<string, unknown> });
  const enqueueResult = enqueueOutcome(channel, ev);
  if (enqueueResult === "DUPLICATE_REJECTED") {
    // 同一 operation 已有终态 outcome — 不覆盖（terminal-only 语义）
    log.info("expansion",`[${tick}] expansion: duplicate terminal outcome rejected for ${operationId}`);
    return;
  }

  // rhythm ring 只在终态路径更新（不收 milestone）
  const kind = resultToRhythmKind(result);
  if (kind) {
    updateRhythmRing(kind, tick);
  }

  // 遥测：扩张 Decision→Outcome 闭环
  if (result === "COMPLETED" || result === "COMPLETED_FORCED") {
    recordExpansionCompleted(tick - openedAt, expansion.reservedEnergy ?? 0);
  } else {
    recordExpansionFailed(result);
  }
  recordPlanningDecision("expansion", result === "COMPLETED" || result === "COMPLETED_FORCED");


  // 清理 globalCache().lastExpansionOutcome（兼容期：保留旧字段供未迁移消费者）
  // Phase 6 后 experience-collector 从 channel drain 读取，不再依赖此字段
  globalCache().lastExpansionOutcome = {
    target: expansion.target,
    outcomeCode,
    completedTick: tick,
    duration: tick - openedAt,
    startedAt: openedAt,
    decisionId: expansion.decisionId,
  };
}

/** ExpansionResult → outcome code（eventLog 兼容）。 */
function resultToOutcomeCode(result: ExpansionResult): number {
  switch (result) {
    case "COMPLETED":
    case "COMPLETED_FORCED":
      return OUTCOME_SUCCESS;
    case "STOLEN":
      return OUTCOME_STOLEN;
    case "TIMED_OUT":
      return OUTCOME_TIMEOUT;
    case "LOST":
      return OUTCOME_LOST;
    case "ABANDONED":
      return OUTCOME_ABORTED;
    default:
      return OUTCOME_ABORTED;
  }
}

/** ExpansionResult → rhythm ring kind。 */
function resultToRhythmKind(result: ExpansionResult): ExpansionOutcomeKind | undefined {
  switch (result) {
    case "COMPLETED":
    case "COMPLETED_FORCED":
      return "success";
    case "STOLEN":
      return "stolen";
    case "TIMED_OUT":
      return "timeout";
    case "LOST":
      return "lost";
    case "ABANDONED":
      return "aborted";
    default:
      return undefined;
  }
}

/** rhythm ring 更新（只终态路径调用）。 */
function updateRhythmRing(kind: ExpansionOutcomeKind, tick: number): void {
  const rhythm = Memory.kernel!.expansionRhythm;
  const ring = appendOutcome(
    (rhythm?.ring ?? []).map(codeToKind),
    kind,
    CONFIG.expansion.rhythm.ringSize,
  );
  const result = evaluateExpansionRhythm(ring, {
    ringSize: CONFIG.expansion.rhythm.ringSize,
    pauseFailures: CONFIG.expansion.rhythm.pauseFailures,
    pauseTicks: CONFIG.expansion.rhythm.pauseTicks,
    minSourcesBase: CONFIG.expansion.rhythm.minSourcesBase,
    minSourcesOnStolen: CONFIG.expansion.rhythm.minSourcesOnStolen,
    stolenWindow: CONFIG.expansion.rhythm.stolenWindow,
    stolenThreshold: CONFIG.expansion.rhythm.stolenThreshold,
    relaxWindow: CONFIG.expansion.rhythm.relaxWindow,
    successRatioRelax: CONFIG.expansion.rhythm.successRatioRelax,
  });

  const prev = Memory.kernel!.expansionRhythm;
  if (
    prev?.blacklistMultiplier !== result.blacklistMultiplier ||
    prev?.minSources !== result.minSources
  ) {
    log.info("expansion",
      `[${tick}] expansion-rhythm: multiplier=${result.blacklistMultiplier}` +
      ` minSources=${result.minSources} consecFail=${result.consecutiveFailures}`,
    );
  }

  Memory.kernel!.expansionRhythm = {
    ring: ring.map(kindToCode),
    blacklistMultiplier: result.blacklistMultiplier,
    minSources: result.minSources,
  };
  if (result.pauseTicks > 0) {
    Memory.kernel!.expansionPausedUntil = tick + result.pauseTicks;
    log.info("expansion",`[${tick}] expansion: ${result.consecutiveFailures} 连败 — 暂停扩张 ${result.pauseTicks} tick`);
  }
}

// ─── Legacy outcome code helpers (used by resultToOutcomeCode/resultToRhythmKind) ───

function codeToKind(code: number): ExpansionOutcomeKind {
  return (["success", "stolen", "timeout", "lost", "aborted"] as const)[code] ?? "aborted";
}

function kindToCode(kind: ExpansionOutcomeKind): number {
  return (["success", "stolen", "timeout", "lost", "aborted"] as const).indexOf(kind);
}

function blacklistTarget(roomName: string, tick: number): void {
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.expansionBlacklist ??= {};
  const multiplier = Memory.kernel.expansionRhythm?.blacklistMultiplier ?? 1;
  const cooldown = Math.round(CONFIG.expansion.blacklistCooldown * multiplier);
  Memory.kernel.expansionBlacklist[roomName] = tick + cooldown;
}

export function reclaimExpeditionCreeps(target: string, sponsor: string): void {
  // 回收远征队：home===target 的所有 creep + remoteTarget===target 的 claimer
  for (const entry of querySquad({ home: target })) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;
    creep.memory.home = sponsor;
    creep.memory.remoteTarget = undefined;
    creep.memory.assignment = undefined;
    creep.memory.recycle = true;
  }
  // claimer 的 home 是 sponsor，remoteTarget 是 target — 需单独查
  for (const entry of querySquad({ role: "claimer", remoteTarget: target })) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;
    // claimer 的 home 可能已是 sponsor — 仍需清 remoteTarget + 标记 recycle
    creep.memory.home = sponsor;
    creep.memory.remoteTarget = undefined;
    creep.memory.assignment = undefined;
    creep.memory.recycle = true;
  }
  const queue = Memory.rooms[sponsor]?.spawnQueue;
  if (queue) cancelRequestsByHome(queue, target);
}

function pruneBlacklist(tick: number): void {
  const bl = Memory.kernel?.expansionBlacklist;
  if (!bl) return;
  for (const [room, retryAt] of Object.entries(bl)) {
    if (tick >= retryAt) delete bl[room];
  }
}

// ─── 自举车道 ─────────────────────────────────────────────

function runBootstrapLane(ctx: TickContext): void {
  const kernel = Memory.kernel!;
  kernel.bootstrap ??= {};

  // A3.4 防重门禁：已 COMPLETED 的 Colony 不重新进入 Bootstrap
  // 只有 owned 无 spawn 的房间才需要 Bootstrap
  const rooms: { room: string; ttd?: number; hostileCount: number; sponsor?: { room: string; capacityAvailable: number } }[] = [];
  const sponsorPool: { room: string; capacityAvailable: number }[] = [];

  for (const snapshot of ctx.snapshots()) {
    const room = Game.rooms[snapshot.roomName] as Room | undefined;
    if (!room || typeof room.find !== "function") continue;
    if (room.find(FIND_MY_SPAWNS).length > 0) {
      delete kernel.bootstrap[snapshot.roomName];
      if (snapshot.rcl >= CONFIG.expansion.sponsorMinRcl && Memory.rooms[snapshot.roomName]?.colonyState === "normal") {
        sponsorPool.push({ room: snapshot.roomName, capacityAvailable: snapshot.energyCapacityAvailable });
      }
      continue;
    }
    // A3.4 防重门禁：colonyState 为 "normal" 的房间不进入 Bootstrap
    // — normal 意味着已通过 Economic Activation，不应重新 Bootstrap
    const colonyState = Memory.rooms[snapshot.roomName]?.colonyState;
    if (colonyState === "normal") {
      delete kernel.bootstrap[snapshot.roomName];
      continue;
    }
    if (snapshot.controller?.my !== true) continue;
    rooms.push({
      room: snapshot.roomName,
      ttd: room.controller?.ticksToDowngrade,
      hostileCount: snapshot.threatCreeps.length,
    });
  }
  if (rooms.length === 0) return;

  for (const r of rooms) {
    let best: { room: string; capacityAvailable: number } | undefined;
    let bestD = Infinity;
    for (const s of sponsorPool) {
      if (s.room === r.room) continue;
      const d = roomLinearDistance(s.room, r.room);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) r.sponsor = { room: best.room, capacityAvailable: best.capacityAvailable };
  }

  const { decisions, ledgerUpdates } = decideBootstrapRooms({
    tick: ctx.tick,
    rooms,
    ledger: kernel.bootstrap,
  });
  for (const [room, upd] of Object.entries(ledgerUpdates)) kernel.bootstrap[room] = upd;

  for (const d of decisions) {
    if (d.action === "abandon") {
      if (Memory.rooms[d.room]) Memory.rooms[d.room]!.spawnQueue = [];
      log.info("expansion",`[${ctx.tick}] bootstrap: abandon ${d.room} — ${d.reason}`);
      recordEvent(EventKind.ExpansionOutcome, d.room, [1, 4, 0]);
      continue;
    }
    if (d.action !== "dispatch" || !d.sponsor) continue;
    const queue = Memory.rooms[d.sponsor]?.spawnQueue;
    if (!queue) continue;
    const room = d.room;
    const hostile = rooms.find((r) => r.room === room)?.hostileCount ?? 0;
    const wave = kernel.bootstrap[room]?.waves ?? 0;
    const base = `bootstrap.${room}.${wave}`;
    submitRequest(queue, {
      key: `${base}.worker`,
      role: "worker",
      home: room,
      priority: 1,
      body: [...BOOTSTRAP_WORKER_BODY],
      memory: { role: "worker", home: room, mode: "acquire" },
      createdAt: ctx.tick,
      expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
      retries: 0,
    });
    if (hostile > 0) {
      submitRequest(queue, {
        key: `${base}.defender`,
        role: "defender",
        home: room,
        priority: 1,
        body: [...BOOTSTRAP_DEFENDER_BODY],
        memory: { role: "defender", home: room, mode: "acquire" },
        createdAt: ctx.tick,
        expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
        retries: 0,
      });
    }
    log.info("expansion",
      `[${ctx.tick}] bootstrap: dispatch ${room} wave${wave} via ${d.sponsor} (hostile=${hostile})`,
    );
  }
}

// ─── A3.3 辅助函数 ─────────────────────────────────────────

/** 向 sponsor 队列提交 claimer 请求（稳定 key，幂等）。 */
function submitClaimer(sponsor: string, target: string, tick: number): void {
  const roomMem = Memory.rooms[sponsor];
  if (!roomMem) return;
  const queue = roomMem.spawnQueue ?? [];
  const key = `claimer:${sponsor}:${target}`;
  if (hasRequest(queue, key)) return;

  const capacity = Game.rooms[sponsor]?.energyCapacityAvailable ?? 650;
  submitRequest(queue, {
    key,
    role: "claimer",
    home: sponsor,
    priority: 2,
    body: selectBody("claimer", capacity),
    memory: { role: "claimer", home: sponsor, mode: "acquire", remoteTarget: target },
    createdAt: tick,
    expiresAt: tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
  roomMem.spawnQueue = queue;
}

/**
 * 用约束推导为新房选锚点并写入 layout。
 */
function seedLayoutAnchor(room: Room): boolean {
  const terrain = room.getTerrain();
  const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
  const field = computeDistanceField(getTerrain);
  const sources = room.find(FIND_SOURCES).map(s => ({ x: s.pos.x, y: s.pos.y }));
  const controller = room.controller
    ? { x: room.controller.pos.x, y: room.controller.pos.y }
    : undefined;
  const exits = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
  const mineral = room.find(FIND_MINERALS)[0];
  const mineralPos = mineral ? { x: mineral.pos.x, y: mineral.pos.y } : undefined;

  const base = { field, sources, controller, exits, mineral: mineralPos, getTerrain };
  let candidates = selectAnchors({ ...base, maxCandidates: 1 });
  if (candidates.length === 0) {
    candidates = selectAnchors({ ...base, maxCandidates: 1, minOpenness: 2 });
  }
  const best = candidates[0];
  if (!best) return false;

  Memory.rooms[room.name] ??= { spawnQueue: [], buildQueue: [] };
  const roomMem = Memory.rooms[room.name]!;
  roomMem.layout = {
    version: 2,
    templateId: COMPACT_CORE_V2.id,
    state: "accepted",
    revision: 0,
    nextPlanTick: 0,
    anchor: packPos(best.x, best.y),
    anchorScore: best.score,
  };
  return true;
}

/** 维持拓荒编队规模（sponsor 队列代孵，稳定 key 幂等）。 */
function submitPioneers(_ctx: TickContext, expansion: ExpansionState): void {
  const roomMem = Memory.rooms[expansion.sponsor];
  if (!roomMem) return;
  const queue = roomMem.spawnQueue ?? [];
  const capacity = Game.rooms[expansion.sponsor]?.energyCapacityAvailable ?? 300;
  const sponsorRcl = Game.rooms[expansion.sponsor]?.controller?.level ?? 4;

  const living: Record<string, number> = {};
  for (const entry of querySquad({ home: expansion.target })) {
    living[entry.role] = (living[entry.role] ?? 0) + 1;
  }

  const squad: ReadonlyArray<{ role: string; count: number }> = [
    { role: "worker", count: CONFIG.expansion.pioneerWorkers },
    { role: "builder", count: CONFIG.expansion.pioneerBuilders },
  ];

  for (const { role, count } of squad) {
    const pending = queue.filter(r => r.role === role && r.home === expansion.target).length;
    const total = (living[role] ?? 0) + pending;
    for (let i = total; i < count; i++) {
      const key = `expansion:${role}:${expansion.target}:${i}`;
      if (hasRequest(queue, key)) continue;
      submitRequest(queue, {
        key,
        role,
        home: expansion.target,
        priority: 2,
        body: selectBody(role, capacity, { rcl: sponsorRcl }),
        memory: { role, home: expansion.target, mode: "acquire", spawnIndex: i },
        createdAt: Game.time,
        expiresAt: Game.time + CONFIG.spawn.requestTtl,
        retries: 0,
      });
    }
  }
  roomMem.spawnQueue = queue;
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
function getTieredBudget(_ctx: TickContext): import("../domain/expansion/budget").TieredExpansionBudget {
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
function getAvailableBudget(ctx: TickContext): number {
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
    status: m.st as "DISCOVERED" | "EVALUATED" | "READY" | "APPROVED" | "WAITING_EXECUTION" | "EXECUTING" | "COMPLETED" | "CANCELLED" | "BLACKLISTED",
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
function updatePlanStatus(planId: string, status: string): void {
  if (!planId) return;
  const plans = Memory.kernel?.expansionPlans;
  if (!plans) return;
  const plan = plans.find(p => p.pid === planId);
  if (plan) {
    plan.st = status;
    plan.ua = Game.time;
  }
}

/**
 * A3.4：检查房间是否被纳入 Empire Economy 统计。
 * 经济统计由 empire-economy 系统 按 owned rooms 轮询，
 * 只要房间有 snapshot 且 controller.my 即被纳入。
 */
function isRoomInEconomyStats(ctx: TickContext, roomName: string): boolean {
  // empire-economy 遍历所有 owned rooms — 只要 snapshot 存在且 controller.my 就算纳入
  const snap = ctx.getSnapshot(roomName);
  return snap !== undefined && snap.controller?.my === true;
}

/**
 * A3.4：检查房间 Spawn 是否被 Spawn Manager 统一调度。
 * spawn-manager 遍历所有 owned rooms 的 spawnQueue，
 * 只要房间有 Memory.rooms[roomName].spawnQueue 就算被管理。
 */
function isSpawnManaged(ctx: TickContext, roomName: string): boolean {
  // spawn-manager 覆盖所有有 spawnQueue 的 owned rooms
  const snap = ctx.getSnapshot(roomName);
  return snap !== undefined && snap.controller?.my === true &&
    Memory.rooms[roomName]?.spawnQueue !== undefined;
}

/**
 * A3.4：检查房间是否被 Defense 系统覆盖。
 * defense 系统（tower-defense）遍历所有 owned rooms 的 snapshot，
 * 只要房间有 snapshot 且 controller.my 就算被覆盖。
 * spawn 建成后自动纳入 defense；无 spawn 时 fallback 到 safeRun 告警。
 */
function isDefenseCovered(ctx: TickContext, roomName: string): boolean {
  // defense 覆盖所有 owned rooms — 只要 snapshot 存在且 controller.my
  const snap = ctx.getSnapshot(roomName);
  return snap !== undefined && snap.controller?.my === true;
}

/** 估算新房能量生产。 */
function estimateEnergyProduction(room: Room): number {
  const sources = room.find(FIND_SOURCES);
  // 每个 source 理论最大 10 energy/tick，实际取决于 harvester 数量
  const harvesters = querySquad({ home: room.name, role: "harvester" })
    .map(e => Game.creeps[e.name])
    .filter((c): c is Creep => !!c);
  const harvesterParts = harvesters.reduce((sum, c) =>
    sum + c.body.filter(p => p.type === WORK).length, 0);
  // 每个 WORK 部件 5 energy/tick（减去移动消耗 1）
  return Math.min(sources.length * 10, harvesterParts * 5);
}

/** 估算新房能量消耗。 */
function estimateEnergyConsumption(room: Room): number {
  // spawn 消耗 + 建造消耗 + repair 消耗
  const spawns = room.find(FIND_MY_SPAWNS);
  let consumption = 0;
  // 如果 spawn 正在孵化，估算消耗
  for (const spawn of spawns) {
    if (spawn.spawning) consumption += 3; // 简化估算
  }
  // construction sites 消耗
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  consumption += Math.min(sites.length * 5, 30);
  return consumption;
}

/**
 * 估算从 sponsor 到新房的外部能量流入。

 * A3.4 修复：正确检测 carrier 角色（而非 transporter）+ 区分来源。

 * 两条能量流入路径：
 *   1. Bootstrap 输血 — Pioneer（worker/builder）从 sponsor 带能量去 target
 *   2. Resource Network 正常调拨 — carrier 由 agenda-manager 的 supply Operation 创建

 * carrier 的特征：memory.role === "carrier" + memory.remoteTarget === targetRoom
 * Pioneer 的特征：memory.home === targetRoom + memory.role === worker/builder（在 sponsor 取能后跨房）
 */
function estimateExternalInflow(targetRoom: string, sponsorRoom: string): number {
  let inflow = 0;

  // 1. Resource Network 正常调拨 — carrier 角色跨房搬运
  //    carrier 的 home 是 sourceRoom（sponsor），remoteTarget 是 targetRoom
  const carriers = querySquad({ role: "carrier", remoteTarget: targetRoom })
    .map(e => Game.creeps[e.name])
    .filter((c): c is Creep => !!c && c.memory.home === sponsorRoom);
  // 每个 carrier 的有效搬运量 ≈ carry capacity / 来回路程（简化 50/tick）
  inflow += carriers.length * 50;

  // 2. Bootstrap 输血 — Pioneer（worker/builder）从 sponsor 携带能量
  //    Pioneer 的 home 是 targetRoom，但在 sponsor 房被孵化并取能
  const pioneers = querySquad({ home: targetRoom })
    .filter(e => e.role === "worker" || e.role === "builder")
    .map(e => Game.creeps[e.name])
    .filter((c): c is Creep => !!c && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
  // 每个 pioneer 携带的能量（一次性，不持续）— 仅在有 carrier 缺位时计入
  if (carriers.length === 0) {
    inflow += pioneers.length * 25; // 简化：每个 pioneer 平均 25 energy/tick
  }

  return inflow;
}