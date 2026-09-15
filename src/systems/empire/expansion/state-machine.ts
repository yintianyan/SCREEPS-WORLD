/** Expansion 执行状态机 — preparing→claiming→claimed→bootstrapping→economic_startup→integrating→completed 的推进与止损。 */
import { CONFIG } from "../../../config";
import { selectBody } from "../../../config/bodies";
import type { TickContext } from "../../../kernel/contracts";
import { log } from "../../../kernel/log";
import type { ExpansionResult } from "../../../domain/expansion/uoem-types";
import type { ExecutionState } from "../../../domain/expansion/execution-state";
import { getExecutionProgress } from "../../../domain/expansion/execution-state";
import { evaluateCheckpoint } from "../../../domain/expansion/checkpoint";
import {
  evaluateEconomicActivation,
  type EconomicActivationInput,
} from "../../../domain/expansion/economic-activation";
import {
  evaluateEmpireIntegration,
  canHandover,
  type EmpireIntegrationInput,
} from "../../../domain/expansion/empire-integration";
import { tryReserve } from "../../../domain/expansion/resource-reservation";
import { hasRequest, submitRequest, buildSpawnRequest } from "../../../domain/spawn/queue";
import { querySquad, globalCache } from "../../../kernel/global-cache";
import { selectAnchors } from "../../../domain/layout/anchor-selection";
import { computeDistanceField } from "../../../domain/layout/terrain-analysis";
import { packPos } from "../../../domain/layout/types";
import { COMPACT_CORE_V2 } from "../../../domain/layout/templates/compact-core-v2";
import {
  blacklistTarget,
  emitMilestone,
  enqueueTerminalOutcome,
  reclaimExpeditionCreeps,
} from "./uoem-events";
import { getAvailableBudget, updatePlanStatus } from "./plan-adapter";

type ExpansionState = NonNullable<KernelMemory["expansion"]>;

/**
 * 核心函数：推进执行状态机。

 * 从当前状态出发，检查转换条件，推进到下一个状态。
 * 覆盖完整链路：preparing → claiming → claimed → bootstrapping →
 * economic_startup → integrating → completed
 */
export function advanceExecutionStateMachine(
  ctx: TickContext,
  expansion: ExpansionState,
  spawningAllowed: boolean,
): void {
  switch (expansion.state) {
    case "validating":
      // Gate 验证已在 tryConsumePlan 中完成，直接推进
      expansion.state = "preparing";
      expansion.startedAt = ctx.tick;
      log.info("expansion", `[${ctx.tick}] expansion: validating → preparing`);
      break;

    case "preparing":
      advancePreparing(ctx, expansion, spawningAllowed);
      break;

    case "claiming":
      advanceClaiming(ctx, expansion, spawningAllowed);
      break;

    case "claimed": {
      // Checkpoint 1: Claimed — 直接推进到 bootstrapping
      expansion.state = "bootstrapping";
      expansion.startedAt = ctx.tick;
      expansion.checkpointsPassed = Math.max(expansion.checkpointsPassed ?? 0, 1);
      // 选锚点 + 写 layout
      const claimedRoom = Game.rooms[expansion.target];
      if (claimedRoom) {
        if (!seedLayoutAnchor(claimedRoom)) {
          log.info(
            "expansion",
            `[${ctx.tick}] expansion: no viable anchor in ${expansion.target}, aborting`,
          );
          abortExpansion(ctx, expansion, "ABANDONED");
          return;
        }
      }
      submitPioneers(ctx, expansion);
      log.info("expansion", `[${ctx.tick}] expansion: claimed → bootstrapping (CP1 passed)`);
      break;
    }

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
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: ${expansion.target} already completed, cleaning up`,
      );
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
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: 未知状态 ${expansion.state}（target=${expansion.target}），清理扩张记录`,
      );
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.expansion = undefined;
      break;
  }

  // 写入 Execution Dashboard 到 globalCache
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

function advancePreparing(
  ctx: TickContext,
  expansion: ExpansionState,
  spawningAllowed: boolean,
): void {
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
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: reserved ${expansion.reservedEnergy} energy for ${expansion.target}`,
      );
    } else {
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: resource reservation failed: ${reserveResult.failReason}`,
      );
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
    log.info("expansion", `[${ctx.tick}] expansion: preparing → claiming`);
  }

  // 超时检查
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.claimTimeout) {
    log.info("expansion", `[${ctx.tick}] expansion: preparing timed out, aborting`);
    abortExpansion(ctx, expansion, "TIMED_OUT");
  }
}

// ── claiming ────────────────────────────────────────────────

function advanceClaiming(
  ctx: TickContext,
  expansion: ExpansionState,
  spawningAllowed: boolean,
): void {
  const targetRoom = Game.rooms[expansion.target];

  // 占领成功 → 进入 claimed
  if (targetRoom?.controller?.my) {
    expansion.state = "claimed";
    expansion.startedAt = ctx.tick;
    // UOEM: P1 是 Milestone（CLAIMED），不进 OutcomeChannel
    emitMilestone(expansion, "CLAIMED", ctx.tick);
    log.info("expansion", `[${ctx.tick}] expansion: claiming → claimed`);
    return;
  }

  // 被他人抢占 → 立即放弃
  if (targetRoom?.controller?.owner && !targetRoom.controller.my) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: ${expansion.target} taken by ${targetRoom.controller.owner.username}, aborting`,
    );
    // abortExpansion 内部统一做 blacklist + reclaim + enqueue
    abortExpansion(ctx, expansion, "STOLEN");
    return;
  }

  // 超时 → 放弃
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.claimTimeout) {
    log.info("expansion", `[${ctx.tick}] expansion: claim ${expansion.target} timed out, aborting`);
    abortExpansion(ctx, expansion, "TIMED_OUT");
    return;
  }

  // Claimer 阵亡且无 pending → 幂等重派
  const claimerAlive = querySquad({ role: "claimer", remoteTarget: expansion.target }).length > 0;
  if (!claimerAlive) {
    const dangerUntil = Memory.rooms[expansion.sponsor]?.remoteOps?.[expansion.target]?.dangerUntil;
    if (dangerUntil !== undefined && ctx.tick < dangerUntil) {
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: ${expansion.target} hostile (claimer lost), aborting`,
      );
      // abortExpansion 内部统一做 blacklist + reclaim + enqueue
      abortExpansion(ctx, expansion, "LOST");
      return;
    }
    if (!spawningAllowed) return;
    submitClaimer(expansion.sponsor, expansion.target, ctx.tick);
  }
}

// ── bootstrapping（旧 pioneering 的升级版）──────────────────

function advanceBootstrapping(
  ctx: TickContext,
  expansion: ExpansionState,
  spawningAllowed: boolean,
): void {
  const targetRoom = Game.rooms[expansion.target];

  // 失守/失明检查（与旧 advancePioneering 相同逻辑）
  if (!targetRoom?.controller?.my) {
    // UOEM: terminal outcome 只由 abortExpansion 产生一次
    // P2/P3 的 LOST/STOLEN 直接传给 abortExpansion，不在前面调 record
    if (!targetRoom) {
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: lost vision of ${expansion.target} during bootstrapping, aborting`,
      );
      abortExpansion(ctx, expansion, "LOST");
    } else {
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: lost ${expansion.target} during bootstrapping, aborting`,
      );
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
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: bootstrapping → economic_startup (CP2 passed)`,
      );
      return;
    }
  }

  // 威胁止损
  const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
    filter: c =>
      !CONFIG.defense.allies.includes(c.owner?.username ?? "") &&
      c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK),
  });
  if (hostiles.length > 0) {
    const squadAlive = querySquad({ home: expansion.target }).some(
      e => e.role === "worker" || e.role === "builder",
    );
    if (!squadAlive) {
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: ${expansion.target} squad wiped by hostiles, aborting`,
      );
      // UOEM: terminal outcome 只由 abortExpansion 产生一次
      abortExpansion(ctx, expansion, "LOST");
      return;
    }
  }

  // 超时
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.pioneerTimeout) {
    log.info("expansion", `[${ctx.tick}] expansion: bootstrapping ${expansion.target} timed out`);
    // UOEM: P5 是 Milestone（FORCED_ADVANCE），不进 OutcomeChannel
    emitMilestone(expansion, "FORCED_ADVANCE", ctx.tick);
    // 不直接 abort — 如果 spawn 已建成，尝试推进到 economic_startup
    if (spawns.length > 0) {
      expansion.state = "economic_startup";
      expansion.startedAt = ctx.tick;
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: forcing bootstrapping → economic_startup (spawn exists)`,
      );
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

// ── economic_startup（能量环路建立）──────────────

function advanceEconomicStartup(ctx: TickContext, expansion: ExpansionState): void {
  const targetRoom = Game.rooms[expansion.target];

  if (!targetRoom?.controller?.my) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: lost ${expansion.target} during economic_startup, aborting`,
    );
    // UOEM: terminal outcome 只由 abortExpansion 产生一次
    abortExpansion(ctx, expansion, "LOST");
    return;
  }

  // 检查 harvester/物流活跃度。
  // Phantom Transporter Bug 修复：系统不存在 "transporter" 角色，实际运输由 hauler
  // 和 distributor 承担。此处检查 hauler 或 distributor 存在即为物流活跃。
  const harvesterActive = querySquad({ home: expansion.target, role: "harvester" }).length > 0;
  const logisticsActive = querySquad({ home: expansion.target }).some(
    e => e.role === "hauler" || e.role === "distributor",
  );

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
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: CP3 (Energy Loop) passed for ${expansion.target}`,
    );
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
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: CP4 (Basic Infra) passed for ${expansion.target}`,
    );
  }

  // CP3 + CP4 都通过 → 进入 integrating
  if (cp3.passed && cp4.passed) {
    expansion.state = "integrating";
    expansion.startedAt = ctx.tick;
    log.info("expansion", `[${ctx.tick}] expansion: economic_startup → integrating`);
    return;
  }

  // 超时检查（economic_startup 阶段给更长的时间）
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.pioneerTimeout * 2) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: economic_startup timed out for ${expansion.target}`,
    );
    // 如果至少 energy loop 活跃，尝试强行推进
    if (cp3.passed) {
      // UOEM: P7 是 Milestone（FORCED_ADVANCE），不进 OutcomeChannel
      emitMilestone(expansion, "FORCED_ADVANCE", ctx.tick);
      expansion.state = "integrating";
      expansion.startedAt = ctx.tick;
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: forcing economic_startup → integrating (energy loop active)`,
      );
      return;
    }
    abortExpansion(ctx, expansion, "TIMED_OUT");
  }
}

// ── integrating（经济激活 + 帝国集成）────────────

function advanceIntegrating(ctx: TickContext, expansion: ExpansionState): void {
  const targetRoom = Game.rooms[expansion.target];

  if (!targetRoom?.controller?.my) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: lost ${expansion.target} during integrating, aborting`,
    );
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
    hasTransporter: querySquad({ home: expansion.target }).some(
      e => e.role === "hauler" || e.role === "distributor",
    ),
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

  log.info(
    "expansion",
    `[${ctx.tick}] expansion: integrating ${expansion.target} — ${econResult.evidence}`,
  );

  // 评估帝国集成（从真实系统状态验证，不硬编码）
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
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: integrating → completed (CP5 passed) — ${expansion.target} is now AUTONOMOUS`,
    );
    // UOEM: P8 终态 COMPLETED，直接调 enqueueTerminalOutcome
    enqueueTerminalOutcome(expansion, ctx.tick, "COMPLETED");
    // 记录完成 tick，供 Cooldown 门禁消费
    if (!Memory.kernel) Memory.kernel = {};
    Memory.kernel.lastExpansionCompletedTick = ctx.tick;
    // 标记 Plan 为 COMPLETED
    updatePlanStatus(expansion.planId ?? "", "COMPLETED");
    // 释放预留资源（预留对象未持久化到 expansion，仅 log 标记；
    // tryReserve 的预留有 tick 过期机制，不释放也会自然过期）
    if (expansion.reservedEnergy && expansion.reservedEnergy > 0) {
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: releasing ${expansion.reservedEnergy} reserved energy for ${expansion.target}`,
      );
    }
    // 清理扩张状态
    Memory.kernel.expansion = undefined;
    return;
  }

  // 超时检查（integrating 阶段给最长的时间）
  const integratingTimeout = CONFIG.expansion.pioneerTimeout * 3;
  if (ctx.tick - expansion.startedAt > integratingTimeout) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: integrating timed out for ${expansion.target} (netFlow=${econResult.netFlow})`,
    );
    // 如果经济至少在正方向，仍然算成功
    if (econResult.netFlow > 0 && integrationResult.integrated) {
      expansion.state = "completed";
      expansion.checkpointsPassed = 5;
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: forcing integrating → completed (net positive + integrated)`,
      );
      // UOEM: P9 终态 COMPLETED_FORCED（经历过 forced advance 的超时强推完成）
      enqueueTerminalOutcome(expansion, ctx.tick, "COMPLETED_FORCED");
      updatePlanStatus(expansion.planId ?? "", "COMPLETED");
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.expansion = undefined;
      return;
    }
    abortExpansion(ctx, expansion, "TIMED_OUT");
  }
}

/**
 * 终止扩张行动的统一清理函数。
 * UOEM: 直接接收 ExpansionResult，调用 enqueueTerminalOutcome（唯一终态出口）。
 * blacklistTarget/reclaimExpeditionCreeps 在此统一执行，调用方不需重复。
 */
function abortExpansion(
  ctx: TickContext,
  expansion: ExpansionState,
  outcome: ExpansionResult,
): void {
  // UOEM: 唯一终态写入 — enqueueTerminalOutcome 幂等去重
  enqueueTerminalOutcome(expansion, ctx.tick, outcome);
  // 释放预留资源（预留对象未持久化到 expansion，仅 log 标记；
  // tryReserve 的预留有 tick 过期机制，不释放也会自然过期）
  if (expansion.reservedEnergy && expansion.reservedEnergy > 0) {
    log.info(
      "expansion",
      `[${ctx.tick}] expansion: releasing ${expansion.reservedEnergy} reserved energy (abort)`,
    );
  }
  blacklistTarget(expansion.target, ctx.tick);
  reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
  // 标记 Plan 为 CANCELLED
  if (expansion.planId) {
    updatePlanStatus(expansion.planId, "CANCELLED");
  }
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.expansion = undefined;
}

/** 向 sponsor 队列提交 claimer 请求（稳定 key，幂等）。 */
function submitClaimer(sponsor: string, target: string, tick: number): void {
  const roomMem = Memory.rooms[sponsor];
  if (!roomMem) return;
  const queue = roomMem.spawnQueue ?? [];
  const key = `claimer:${sponsor}:${target}`;
  if (hasRequest(queue, key)) return;

  const capacity = Game.rooms[sponsor]?.energyCapacityAvailable ?? 650;
  submitRequest(
    queue,
    buildSpawnRequest(tick, {
      key,
      role: "claimer",
      home: sponsor,
      priority: 2,
      body: selectBody("claimer", capacity),
      memory: { role: "claimer", home: sponsor, mode: "acquire", remoteTarget: target },
    }),
  );
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

/**
 * 检查房间是否被纳入 Empire Economy 统计。
 * 经济统计由 empire-economy 系统 按 owned rooms 轮询，
 * 只要房间有 snapshot 且 controller.my 即被纳入。
 */
function isRoomInEconomyStats(ctx: TickContext, roomName: string): boolean {
  // empire-economy 遍历所有 owned rooms — 只要 snapshot 存在且 controller.my 就算纳入
  const snap = ctx.getSnapshot(roomName);
  return snap !== undefined && snap.controller?.my === true;
}

/**
 * 检查房间 Spawn 是否被 Spawn Manager 统一调度。
 * spawn-manager 遍历所有 owned rooms 的 spawnQueue，
 * 只要房间有 Memory.rooms[roomName].spawnQueue 就算被管理。
 */
function isSpawnManaged(ctx: TickContext, roomName: string): boolean {
  // spawn-manager 覆盖所有有 spawnQueue 的 owned rooms
  const snap = ctx.getSnapshot(roomName);
  return (
    snap !== undefined &&
    snap.controller?.my === true &&
    Memory.rooms[roomName]?.spawnQueue !== undefined
  );
}

/**
 * 检查房间是否被 Defense 系统覆盖。
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
  const harvesterParts = harvesters.reduce(
    (sum, c) => sum + c.body.filter(p => p.type === WORK).length,
    0,
  );
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
