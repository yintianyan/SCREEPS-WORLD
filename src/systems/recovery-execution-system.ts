/** Recovery Execution System */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache, publishProcurementDemands } from "../kernel/global-cache";
import { CONFIG } from "../config";
import { RECOVERY_BODY } from "../config/bodies";
import { submitRequest, hasRequest } from "../domain/spawn/queue";
import {
  type RecoveryAction,
} from "../domain/strategy/recovery-priority";
import {
  recoveryIdempotencyKey,
  shouldSubmitAction,
  createActionRecord,
  markSubmitted,
  markExecuting,
  markVerifying,
  markSucceeded,
  markFailed,
  markBlocked,
  getRetryPolicy,
  classifyFailure,
  evaluateRecoveryResult,
  evaluateRecoveryBudget,
  evaluateRecoveryUnviability,
  evaluateEscalation,
  cleanupRecoveryTable,
  computeRecoveryStats,
  isActionActive,
  type RecoveryActionTable,
  type RecoveryActionRecord,
  type RecoveryWorldSnapshot,
} from "../domain/strategy/recovery-lifecycle";
import type { FailureNode } from "../domain/strategy/failure-propagation";
import { mapAbortSignalsToRecoveryActions, type WarAbortSignal } from "../domain/military/abort-recovery";
import { recordEvent, EventKind } from "../kernel/event-log";
import type { TacticalAbortSignal } from "../domain/tactical";

/** 上次消费 warAbortSignals 的 tick（防止同一信号重复消费）。 */
let lastConsumedAbortTick = -1;

// ─── 系统定义 ──────────────────────────────────────────────

export const recoveryExecutionSystem: System = {
  name: "recovery-execution",
  priority: 1 as Priority,
  interval: 10,

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 读取 recoveryActions + warAbortSignals ──
    // A5.3.1 GAP-1 修复：消费军事止损信号，通过纯函数转换为 RecoveryAction。
    // Military 只产出 Signal（domain 纯函数 mapAbortSignalsToRecoveryActions），
    // 不执行 Recovery。本系统负责将 Signal → Action → 执行。
    // 幂等性：同一 tick 的 signal 只消费一次（lastConsumedAbortTick 去重），
    // 同一 sponsor+reason 的 action 由 recoveryIdempotencyKey 去重。
    const empireActions = g.recoveryActions ?? [];
    const warActions = consumeWarAbortSignals(g, tick);
    const tacticalActions = consumeTacticalAbortSignals(g, tick);
    const actions = [...empireActions, ...warActions, ...tacticalActions];
    if (actions.length === 0) {
      // 无 Recovery Action — 仍然需要做 Verification（检查已提交的 Action）
      verifyPendingActions(g, ctx);
      return;
    }

    // ── 2. 初始化追踪表 ──
    if (!g.recoveryActionTable) g.recoveryActionTable = new Map() as RecoveryActionTable;
    if (!g.recoveryBeforeStates) g.recoveryBeforeStates = new Map();
    const table = g.recoveryActionTable as RecoveryActionTable;

    // ── 3. 清理过期记录 ──
    g.recoveryActionTable = cleanupRecoveryTable(table, tick) as RecoveryActionTable;

    // ── 4. Recovery Budget 评估 ──
    const budget = evaluateRecoveryBudget({
      tick,
      cpuBudget: Game.cpu.bucket ?? 0,
      empireEnergyReserve: computeEmpireEnergyReserve(ctx),
      activeRecoveryCount: countActiveRecoveries(g.recoveryActionTable as RecoveryActionTable),
      maxCpuPerRecovery: 5,
      maxEnergyPerRecovery: 1000,
    });

    if (!budget.allowed) {
      // 预算不足 — 不提交新 Action，但仍验证已提交的
      verifyPendingActions(g, ctx);
      return;
    }

    // ── 5. 遍历 RecoveryActions，按优先级提交 ──
    let submittedThisTick = 0;
    const maxSubmitPerTick = 3; // 每次运行最多提交 3 个新 Action

    for (const action of actions) {
      if (submittedThisTick >= maxSubmitPerTick) break;

      // Idempotency 检查
      const check = shouldSubmitAction(
        g.recoveryActionTable as RecoveryActionTable,
        action,
        tick,
        getRetryPolicy(action.type).cooldownDuration,
      );

      if (!check.submit) {
        continue;
      }

      // 获取 Retry Policy
      const policy = getRetryPolicy(action.type);
      const maxAttempts = policy.maxAttempts;

      // 创建或更新追踪记录
      let record: RecoveryActionRecord;
      if (check.existing) {
        // 重试：复用已有记录但递增 attempts
        record = markSubmitted(check.existing, tick);
      } else {
        // 新 Action
        record = createActionRecord(action, tick, maxAttempts);
        record = markSubmitted(record, tick);
      }

      // 保存 Before-State 快照（用于后续 Verification）
      const beforeState = captureWorldSnapshot(g, action);
      (g.recoveryBeforeStates as Map<string, RecoveryWorldSnapshot>).set(
        recoveryIdempotencyKey(action),
        beforeState,
      );

      // ── 翻译并提交到执行系统 ──
      const execResult = translateAndSubmit(action, ctx, record.correlationId);

      if (execResult.submitted) {
        // 提交成功
        record = markExecuting(record, tick);
        record.executionRef = execResult.executionRef;
        (g.recoveryActionTable as RecoveryActionTable).set(
          recoveryIdempotencyKey(action),
          record,
        );
        submittedThisTick++;

        console.log(
          `[${tick}] recovery: SUBMITTED ${action.type}` +
          ` domain=${action.domain} priority=${action.priority}` +
          ` ref=${execResult.executionRef ?? "none"}` +
          ` attempt=${record.attempts}/${record.maxAttempts}` +
          ` corr=${record.correlationId}`,
        );
      } else {
        // 提交失败
        const classification = classifyFailure(execResult.reason, action.type);
        if (classification === "blocked" || classification === "threat_blocked") {
          record = markBlocked(record, tick, execResult.reason);
        } else if (classification === "non_retryable" || record.attempts >= record.maxAttempts) {
          record = markFailed(record, tick, execResult.reason, false);
        } else {
          record = markFailed(record, tick, execResult.reason, true);
        }
        (g.recoveryActionTable as RecoveryActionTable).set(
          recoveryIdempotencyKey(action),
          record,
        );
      }
    }

    // ── 6. 验证已提交的 Action ──
    verifyPendingActions(g, ctx);

    // ── 7. 更新统计 ──
    g.recoveryStats = computeRecoveryStats(g.recoveryActionTable as RecoveryActionTable, tick);

    // ── 8. 更新 Autonomy Metrics 追踪 ──
    // 将 Recovery 统计反馈给 empire-health-system 的 Autonomy Score
    const stats = g.recoveryStats;
    if (stats) {
      g.__totalFailuresDetected = (g.__totalFailuresDetected ?? 0) + submittedThisTick;
      g.__autoRecoveredFailures = (g.__autoRecoveredFailures ?? 0) + stats.succeededCount;
    }
  },
};

// ─── 翻译与提交 ────────────────────────────────────────────

interface SubmitResult {
  submitted: boolean;
  executionRef?: string;
  reason: string;
}

/**
 * 将 RecoveryAction 翻译为现有执行系统的输入格式并提交。

 * 这是本系统的核心——只做翻译和提交，不做执行。
 */
function translateAndSubmit(
  action: RecoveryAction,
  ctx: TickContext,
  correlationId: string,
): SubmitResult {
  switch (action.type) {
    case "spawn_recovery":
      return submitSpawnRecovery(action, ctx, correlationId);

    case "logistics_fix":
      return submitLogisticsFix(action, ctx, correlationId);

    case "energy_redirect":
      return submitEnergyRedirect(action, ctx, correlationId);

    case "remote_stall":
      return submitRemoteStall(action, ctx, correlationId);

    case "expansion_pause":
      return submitExpansionPause(action, ctx, correlationId);

    case "terminal_trade":
      return submitTerminalTrade(action, ctx, correlationId);

    case "cpu_conserve":
      return submitCpuConserve(action, ctx, correlationId);

    case "population_rebuild":
      return submitPopulationRebuild(action, ctx, correlationId);

    case "defense_response":
      return submitDefenseResponse(action, ctx, correlationId);

    default:
      return { submitted: false, reason: `unknown action type: ${action.type}` };
  }
}

/**
 * SPAWN_RECOVERY：提交紧急 spawn 请求到 spawn queue。

 * 翻译：RecoveryAction → SpawnRequest { role:"worker", priority:0, body:RECOVERY_BODY }
 * 幂等：submitRequest 按 key 去重
 */
function submitSpawnRecovery(
  action: RecoveryAction,
  ctx: TickContext,
  correlationId: string,
): SubmitResult {
  const room = action.targetFailureId.split(":")[1] ?? action.targetFailureId;
  const roomMem = Memory.rooms[room];
  if (!roomMem) {
    return { submitted: false, reason: `room memory not found: ${room}` };
  }

  const queue = roomMem.spawnQueue ?? [];
  const key = `recovery:worker:${room}:0`;

  // 幂等检查：已有同 key 请求
  if (hasRequest(queue, key)) {
    return { submitted: true, executionRef: key, reason: "already in queue (idempotent)" };
  }

  // 提交 P0 紧急孵化请求
  submitRequest(queue, {
    key,
    role: "worker",
    home: room,
    priority: 0,
    body: [...RECOVERY_BODY],
    memory: {
      role: "worker",
      home: room,
      mode: "acquire",
      // Correlation ID 供 A4.7 Decision Trace
      recoveryCorrelationId: correlationId,
    } as CreepMemory,
    createdAt: ctx.tick,
    expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
  roomMem.spawnQueue = queue;

  return { submitted: true, executionRef: key, reason: "spawn request submitted" };
}

/**
 * LOGISTICS_FIX：提交 hauler 替换请求到 spawn queue。

 * 翻译：RecoveryAction → SpawnRequest { role:"hauler", priority:1 }
 */
function submitLogisticsFix(
  action: RecoveryAction,
  ctx: TickContext,
  correlationId: string,
): SubmitResult {
  const room = action.targetFailureId.split(":")[1] ?? action.targetFailureId;
  const roomMem = Memory.rooms[room];
  if (!roomMem) {
    return { submitted: false, reason: `room memory not found: ${room}` };
  }

  const queue = roomMem.spawnQueue ?? [];
  const key = `recovery:hauler:${room}:0`;

  if (hasRequest(queue, key)) {
    return { submitted: true, executionRef: key, reason: "already in queue (idempotent)" };
  }

  // 选择 hauler body（基于房间 energyCapacityAvailable）
  const energyCapacity = Game.rooms[room]?.energyCapacityAvailable ?? 300;
  const body = simpleHaulerBody(energyCapacity);

  submitRequest(queue, {
    key,
    role: "hauler",
    home: room,
    priority: 1,
    body,
    memory: {
      role: "hauler",
      home: room,
      mode: "acquire",
      recoveryCorrelationId: correlationId,
    } as CreepMemory,
    createdAt: ctx.tick,
    expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
  roomMem.spawnQueue = queue;

  return { submitted: true, executionRef: key, reason: "hauler spawn request submitted" };
}

/**
 * ENERGY_REDIRECT：触发跨房能量调拨。

 * 翻译：RecoveryAction → 标记到 globalCache 供 agenda-manager 消费
 * 当前实现：通过 queueReplanEvent 通知 agenda-manager 重新规划
 */
function submitEnergyRedirect(
  action: RecoveryAction,
  ctx: TickContext,
  correlationId: string,
): SubmitResult {
  // agenda-manager 有独立 100t 周期的重规划——Recovery System 不能等 100t。
  // 直接在目标房的 spawn queue 提交 distributor 请求以加速能量分发。
  const room = action.targetFailureId.split(":")[1] ?? action.targetFailureId;
  const roomMem = Memory.rooms[room];
  if (!roomMem) {
    return { submitted: false, reason: `room memory not found: ${room}` };
  }

  // 如果房间有 storage 但没有 distributor，提交 distributor 请求
  const hasStorage = Game.rooms[room]?.storage !== undefined;
  if (!hasStorage) {
    return { submitted: false, reason: "no storage — energy redirect not applicable" };
  }

  // 统计存活 distributor
  const livingDistributors = Object.values(Game.creeps).filter(
    c => c.memory.role === "distributor" && c.memory.home === room,
  ).length;

  if (livingDistributors > 0) {
    return { submitted: false, reason: "distributor already alive — energy redirect not needed" };
  }

  const queue = roomMem.spawnQueue ?? [];
  const key = `recovery:distributor:${room}:0`;

  if (hasRequest(queue, key)) {
    return { submitted: true, executionRef: key, reason: "already in queue (idempotent)" };
  }

  submitRequest(queue, {
    key,
    role: "distributor",
    home: room,
    priority: 1,
    body: [CARRY, CARRY, MOVE, MOVE],
    memory: {
      role: "distributor",
      home: room,
      mode: "acquire",
      recoveryCorrelationId: correlationId,
    } as CreepMemory,
    createdAt: ctx.tick,
    expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
  roomMem.spawnQueue = queue;

  return { submitted: true, executionRef: key, reason: "distributor spawn for energy redirect" };
}

/**
 * REMOTE_STALL：暂停远矿运营。

 * 翻译：RecoveryAction → RemoteOp.state = "paused"
 */
function submitRemoteStall(
  action: RecoveryAction,
  _ctx: TickContext,
  _correlationId: string,
): SubmitResult {
  // remote_stall 的目标房间从 failureId 提取
  const parts = action.targetFailureId.split(":");
  const homeRoom = parts[1] ?? "";
  const targetRoom = parts[2] ?? "";

  if (!homeRoom || !targetRoom) {
    return { submitted: false, reason: "cannot determine remote target room" };
  }

  const roomMem = Memory.rooms[homeRoom];
  if (!roomMem?.remoteOps) {
    return { submitted: false, reason: "no remote ops found" };
  }

  const op = roomMem.remoteOps[targetRoom];
  if (!op || op.state !== "active") {
    return { submitted: true, executionRef: `${homeRoom}:${targetRoom}`, reason: "already paused/abandoned (idempotent)" };
  }

  op.state = "paused";
  return { submitted: true, executionRef: `${homeRoom}:${targetRoom}`, reason: "remote op paused" };
}

/**
 * EXPANSION_PAUSE：暂停扩张。

 * 翻译：RecoveryAction → Memory.kernel.expansionPausedUntil = tick + cooldown
 */
function submitExpansionPause(
  action: RecoveryAction,
  ctx: TickContext,
  _correlationId: string,
): SubmitResult {
  if (!Memory.kernel) Memory.kernel = {};

  const existing = Memory.kernel.expansionPausedUntil ?? 0;
  if (existing > ctx.tick) {
    return { submitted: true, executionRef: "expansion-pause", reason: "already paused (idempotent)" };
  }

  // 暂停 1000 tick（让 Recovery 有时间恢复）
  Memory.kernel.expansionPausedUntil = ctx.tick + 1000;

  return { submitted: true, executionRef: "expansion-pause", reason: "expansion paused for 1000t" };
}

/**
 * TERMINAL_TRADE：发布采购需求。

 * 翻译：RecoveryAction → publishProcurementDemands()
 */
function submitTerminalTrade(
  action: RecoveryAction,
  ctx: TickContext,
  correlationId: string,
): SubmitResult {
  const room = action.targetFailureId.split(":")[1] ?? action.targetFailureId;

  // 从 action.recommendation 推断需要的资源
  // 当前简化：只处理能量交易
  publishProcurementDemands(room, [{
    resource: "energy",
    amount: 5000,
    priority: 50,
    deadline: ctx.tick + 500,
    reason: `recovery:${correlationId}`,
  }], ctx.tick);

  return { submitted: true, executionRef: `procurement:${room}`, reason: "procurement demand published" };
}

/**
 * CPU_CONSERVE：标记 CPU 降级建议。

 * 翻译：RecoveryAction → 日志建议（kernel scheduler 有独立的 bucket 看门狗）
 */
function submitCpuConserve(
  _action: RecoveryAction,
  ctx: TickContext,
  _correlationId: string,
): SubmitResult {
  // Kernel scheduler 有独立的四档 bucket 看门狗——Recovery System 只记录建议
  console.log(`[${ctx.tick}] recovery: CPU_CONSERVE recommended — kernel bucket watchdog will handle`);
  return { submitted: true, executionRef: "cpu-conserve", reason: "cpu conserve recommended (kernel handles)" };
}

/**
 * POPULATION_REBUILD：提交多角色 spawn 请求。

 * 翻译：RecoveryAction → SpawnRequest { role:"harvester", priority:1 } + SpawnRequest { role:"hauler", priority:1 }
 */
function submitPopulationRebuild(
  action: RecoveryAction,
  ctx: TickContext,
  correlationId: string,
): SubmitResult {
  const room = action.targetFailureId.split(":")[1] ?? action.targetFailureId;
  const roomMem = Memory.rooms[room];
  if (!roomMem) {
    return { submitted: false, reason: `room memory not found: ${room}` };
  }

  const queue = roomMem.spawnQueue ?? [];
  const harvesterKey = `recovery:harvester:${room}:0`;
  let submitted = false;

  // 提交 harvester 请求
  if (!hasRequest(queue, harvesterKey)) {
    submitRequest(queue, {
      key: harvesterKey,
      role: "harvester",
      home: room,
      priority: 1,
      body: [WORK, CARRY, MOVE],
      memory: {
        role: "harvester",
        home: room,
        mode: "acquire",
        recoveryCorrelationId: correlationId,
      } as CreepMemory,
      createdAt: ctx.tick,
      expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
      retries: 0,
    });
    submitted = true;
  }

  roomMem.spawnQueue = queue;
  return submitted
    ? { submitted: true, executionRef: harvesterKey, reason: "population rebuild: harvester submitted" }
    : { submitted: true, executionRef: harvesterKey, reason: "already in queue (idempotent)" };
}

/**
 * DEFENSE_RESPONSE：基于 A5.1 威胁评估触发防御响应。

 * 翻译：RecoveryAction → 读取 globalCache.threatAssessments 获取威胁详情
 *   - 威胁 CRITICAL + safeModeAvailable > 0 → 标记 safeMode 需求
 *   - 威胁 ≥ HIGH + 无存活 defender → 提交 defender spawn 请求
 *   - 威胁 < HIGH → 标记给 tower-defense 系统处理（已有独立链路）

 * 不直接调用 Game API（不调 safeMode / 不调 spawnCreep）。
 * 只标记需求，由各系统自行消费。
 */
function submitDefenseResponse(
  action: RecoveryAction,
  ctx: TickContext,
  correlationId: string,
): SubmitResult {
  const g = globalCache();
  const room = action.targetFailureId.split(":")[1] ?? action.targetFailureId;
  const roomMem = Memory.rooms[room];
  if (!roomMem) {
    return { submitted: false, reason: `room memory not found: ${room}` };
  }

  // 读取 A5.1 威胁评估结果
  const threatAssessment = g.threatAssessments?.get(room);
  if (!threatAssessment) {
    // 无威胁评估数据——防御有独立链路（tower-defense），标记不重复
    return { submitted: false, reason: "no threat assessment available — tower-defense handles independently" };
  }

  const level = threatAssessment.level;
  const intent = threatAssessment.estimatedIntent.intent;
  const posture = threatAssessment.recommendedPosture;

  // CRITICAL + NUCLEAR/SIEGE + safeMode 可用 → 标记 safeMode 需求
  // 不直接调 Game.rooms[room].controller.activateSafeMode()——由 kernel 层在下一 tick 消费
  if (level === "CRITICAL" &&
      (intent === "NUCLEAR" || intent === "FULL_ASSAULT" || intent === "SIEGE") &&
       (Game.rooms[room]?.controller?.safeModeAvailable ?? 0) > 0) {
    // 标记 safeMode 需求到 room memory，供 kernel/consumers 读取
    if (!roomMem.defenseState) roomMem.defenseState = {} as RoomMemory["defenseState"];
    if (roomMem.defenseState) {
      roomMem.defenseState.safeModeRequested = true;
      roomMem.defenseState.safeModeRequestTick = ctx.tick;
      roomMem.defenseState.safeModeReason = `CRITICAL+${intent} corr=${correlationId}`;
    }
    console.log(
      `[${ctx.tick}] recovery: DEFENSE_RESPONSE safeMode requested` +
      ` room=${room} level=${level} intent=${intent} corr=${correlationId}`,
    );
    return {
      submitted: true,
      executionRef: `safe-mode:${room}`,
      reason: `safeMode requested for CRITICAL ${intent} threat`,
    };
  }

  // HIGH/CRITICAL → 提交 defender spawn 请求
  if (level === "HIGH" || level === "CRITICAL") {
    // 检查是否已有存活 defender
    const livingDefenders = Object.values(Game.creeps).filter(
      c => c.memory.role === "defender" && c.memory.home === room && !c.spawning,
    ).length;

    if (livingDefenders >= 2) {
      return { submitted: true, executionRef: `defenders-existing:${room}`, reason: `${livingDefenders} defenders already alive` };
    }

    // 提交 defender spawn 请求
    const queue = roomMem.spawnQueue ?? [];
    const key = `recovery:defender:${room}:0`;

    if (hasRequest(queue, key)) {
      return { submitted: true, executionRef: key, reason: "defender already in queue (idempotent)" };
    }

    // defender body：基于房间 energyCapacityAvailable
    const energyCapacity = Game.rooms[room]?.energyCapacityAvailable ?? 300;
    const body = simpleDefenderBody(energyCapacity);

    submitRequest(queue, {
      key,
      role: "defender",
      home: room,
      priority: 0, // P0 紧急——防御响应
      body,
      memory: {
        role: "defender",
        home: room,
        mode: "acquire",
        recoveryCorrelationId: correlationId,
      } as CreepMemory,
      createdAt: ctx.tick,
      expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
      retries: 0,
    });
    roomMem.spawnQueue = queue;

    console.log(
      `[${ctx.tick}] recovery: DEFENSE_RESPONSE defender spawned` +
      ` room=${room} level=${level} intent=${intent} posture=${posture}` +
      ` corr=${correlationId}`,
    );
    return {
      submitted: true,
      executionRef: key,
      reason: `defender spawn submitted for ${level} ${intent} threat`,
    };
  }

  // MEDIUM 或更低 → tower-defense 独立处理
  return {
    submitted: true,
    executionRef: `tower-defense:${room}`,
    reason: `threat ${level} handled by tower-defense (posture=${posture})`,
  };
}

// ─── Verification ─────────────────────────────────────────

/**
 * 验证已提交的 Action（检查 World State 是否改善）。

 * 对状态为 "executing" 的 Action：
 *   1. 检查 executionRef 是否仍然有效（spawn 请求是否还在队列 / creep 是否已出生）
 *   2. 如果已过 estimatedRecoveryTime → 进入 verifying
 *   3. 对比 Before/After World State
 */
function verifyPendingActions(g: ReturnType<typeof globalCache>, ctx: TickContext): void {
  const table = g.recoveryActionTable as RecoveryActionTable | undefined;
  if (!table || table.size === 0) return;

  const beforeStates = g.recoveryBeforeStates as Map<string, RecoveryWorldSnapshot> | undefined;
  if (!beforeStates) return;

  const tick = ctx.tick;

  for (const [key, record] of table) {
    if (record.state !== "executing" && record.state !== "verifying") continue;

    // 获取 Before-State
    const beforeState = beforeStates.get(key);
    if (!beforeState) continue;

    // 捕获 After-State
    const afterState = captureWorldSnapshot(g, {
      id: record.actionId,
      type: record.type,
      domain: record.domain,
      targetFailureId: record.failureId,
    } as RecoveryAction);

    // 检查是否过了 estimatedRecoveryTime
    const elapsed = tick - record.submittedAt;

    // 对于 executing 状态，先检查执行引用是否仍然活跃
    if (record.state === "executing") {
      const stillActive = isExecutionRefActive(record.executionRef, record.type);
      if (!stillActive && elapsed > 50) {
        // 执行引用不活跃 — 可能已完成或失败
        // 进入验证阶段
        const newRecord = markVerifying(record, tick);
        table.set(key, newRecord);
        continue;
      }
    }

    // 验证结果
    const verification = evaluateRecoveryResult({
      beforeState,
      afterState,
      action: {
        id: record.actionId,
        type: record.type,
        targetFailureId: record.failureId,
        domain: record.domain,
        priority: 0,
        estimatedCost: 0,
        estimatedBenefit: 0,
        roi: 0,
        urgent: false,
        estimatedRecoveryTime: 100,
        description: "",
        recommendation: "",
      } as RecoveryAction,
      elapsedTicks: elapsed,
    });

    // 只有在足够时间过去后才判定
    if (elapsed < 50) continue; // 至少等 50 tick 才验证

    switch (verification) {
      case "success": {
        const newRecord = markSucceeded(record, tick, verification);
        table.set(key, newRecord);
        beforeStates.delete(key);
        console.log(
          `[${tick}] recovery: SUCCEEDED ${record.type}` +
          ` domain=${record.domain} attempt=${record.attempts}` +
          ` corr=${record.correlationId}`,
        );
        break;
      }
      case "partial":
        // 部分恢复 — 继续等待
        continue;
      case "failed": {
        const policy = getRetryPolicy(record.type);
        const retryable = record.attempts < record.maxAttempts &&
          policy.classification === "retryable";
        const newRecord = markFailed(record, tick, `verification: no improvement after ${elapsed}t`, retryable);
        table.set(key, newRecord);

        // 检查是否需要 Escalation
        if (newRecord.state === "failed" || newRecord.state === "terminal") {
          const escalation = evaluateEscalation({
            failedRecord: newRecord,
            failureNode: {
              id: record.failureId,
              domain: record.domain,
              severity: "error",
              description: "",
              detectedAt: record.submittedAt,
            } as FailureNode,
            allFailures: [],
            tick,
          });

          if (escalation.shouldEscalate) {
            console.log(
              `[${tick}] recovery: ESCALATION ${record.type}` +
              ` domain=${record.domain} reason="${escalation.reason}"` +
              ` corr=${record.correlationId}`,
            );
          }

          // 检查是否需要标记为不可恢复
          if (newRecord.state === "terminal") {
            const unviability = evaluateRecoveryUnviability({
              room: record.room ?? "",
              domain: record.domain,
              totalAttempts: newRecord.attempts,
              totalInvested: 0,
              totalRecoveryTime: tick - record.submittedAt,
              tick,
            });
            if (unviability.unviable) {
              console.log(
                `[${tick}] recovery: UNVIABLE ${record.type}` +
                ` domain=${record.domain} room=${record.room ?? "global"}` +
                ` reason="${unviability.reason}"` +
                ` corr=${record.correlationId}`,
              );
            }
          }
        }
        break;
      }
      case "no_progress":
        // 提交成功但无进展 — 继续等待直到 estimatedRecoveryTime * 2
        if (elapsed > 200) {
          // 超时 — 标记失败
          const newRecord = markFailed(record, tick, "no progress after 200t", true);
          table.set(key, newRecord);
        }
        break;
    }
  }
}

/**
 * 检查执行引用是否仍然活跃。
 */
function isExecutionRefActive(executionRef: string | undefined, actionType: string): boolean {
  if (!executionRef) return false;

  // spawn 请求：检查是否还在队列
  if (actionType === "spawn_recovery" || actionType === "logistics_fix" ||
      actionType === "population_rebuild" || actionType === "energy_redirect" ||
      actionType === "defense_response") {
    // 检查是否已有对应 creep 存活
    // executionRef 格式: "recovery:role:room:index"
    const parts = executionRef.split(":");
    const role = parts[1] ?? "";
    const room = parts[2] ?? "";

    // 如果已有存活 creep → 执行引用已转化为实际行动
    const hasCreep = Object.values(Game.creeps).some(
      c => c.memory.role === role && c.memory.home === room && !c.spawning,
    );
    if (hasCreep) return true; // creep 存活 = 仍在执行

    // 检查请求是否还在队列
    const roomMem = Memory.rooms[room];
    if (roomMem?.spawnQueue) {
      return hasRequest(roomMem.spawnQueue, executionRef);
    }
    return false;
  }

  // remote_stall：检查 op.state 是否仍为 paused
  if (actionType === "remote_stall") {
    const parts = executionRef.split(":");
    const home = parts[0] ?? "";
    const target = parts[1] ?? "";
    const op = Memory.rooms[home]?.remoteOps?.[target];
    return op?.state === "paused";
  }

  return true; // 默认认为仍然活跃
}

// ─── 辅助函数 ──────────────────────────────────────────────

/**
 * 捕获当前 World State 快照（用于 Verification 的 Before/After 对比）。
 */
function captureWorldSnapshot(
  g: ReturnType<typeof globalCache>,
  action: RecoveryAction,
): RecoveryWorldSnapshot {
  const health = g.empireHealth;
  const failureGraph = g.failureGraph;
  const room = action.targetFailureId.split(":")[1];

  // 目标领域的健康度
  const dim = health?.dimensions.find(d => d.name === action.domain);
  const domainScore = dim?.score ?? 0.5;
  const domainLevel = dim?.level ?? "stable";

  // 房间级数据
  let energyAvailable: number | undefined;
  let population: number | undefined;
  if (room && Game.rooms[room]) {
    energyAvailable = Game.rooms[room]!.energyAvailable;
  }

  // 人口
  let totalPop = 0;
  for (const _ of Object.values(Game.creeps)) totalPop++;
  population = totalPop;

  // 物流投递率
  const deliveryRate = g.logisticsHealth?.deliveryRate;

  // 远矿运营数
  let activeRemoteOps = 0;
  if (room) {
    const ops = Memory.rooms[room]?.remoteOps;
    if (ops) {
      for (const op of Object.values(ops)) {
        if (op.state === "active") activeRemoteOps++;
      }
    }
  }

  return {
    healthScore: health?.score ?? 0.5,
    healthLevel: health?.level ?? "stable",
    activeFailureCount: failureGraph?.nodes.filter(n => !n.resolved).length ?? 0,
    domainScore,
    domainLevel,
    room,
    energyAvailable,
    population,
    deliveryRate,
    activeRemoteOps,
  };
}

/**
 * 计算帝国总能量储备。
 */
function computeEmpireEnergyReserve(ctx: TickContext): number {
  let total = 0;
  for (const snap of ctx.snapshots()) {
    total += snap.energyAvailable;
    if (snap.storage) {
      total += snap.storage.store.getUsedCapacity(RESOURCE_ENERGY);
    }
  }
  return total;
}

/**
 * 统计活跃 Recovery 数量。
 */
function countActiveRecoveries(table: RecoveryActionTable): number {
  let count = 0;
  for (const record of table.values()) {
    if (isActionActive(record)) count++;
  }
  return count;
}

/**
 * 简化的 hauler body 生成。
 */
function simpleHaulerBody(energyCapacity: number): BodyPartConstant[] {
  if (energyCapacity >= 400) return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
  if (energyCapacity >= 300) return [CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
  return [CARRY, CARRY, MOVE, MOVE];
}

/**
 * 简化的 defender body 生成（近战 + 远程混合）。

 * 优先 [ATTACK, MOVE] × N（高机动近战），
 * 能量充足时加入 RANGED_ATTACK 和 TOUGH 前排。
 */
function simpleDefenderBody(energyCapacity: number): BodyPartConstant[] {
  if (energyCapacity >= 600) return [TOUGH, TOUGH, ATTACK, ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE, MOVE];
  if (energyCapacity >= 400) return [TOUGH, ATTACK, ATTACK, MOVE, MOVE, MOVE];
  if (energyCapacity >= 250) return [ATTACK, ATTACK, MOVE, MOVE];
  return [ATTACK, MOVE];
}

// ─── A5.3.1 GAP-1: War Abort Signal 消费 ──────────────────

/**
 * 消费 globalCache.warAbortSignals，通过纯函数转换为 RecoveryAction。

 * 幂等性机制（双层去重）：
 *   1. tick 级去重：lastConsumedAbortTick 确保同一 tick 不重复消费
 *   2. domain 级去重：recoveryIdempotencyKey 确保同一 sponsor+reason
 *      不重复提交（A4.6 lifecycle cooldown 机制）

 * 边界：
 *   - 不直接读 Military 内部状态
 *   - 只读 globalCache.warAbortSignals（Military 写入的公开信号）
 *   - 通过 domain 纯函数 mapAbortSignalsToRecoveryActions 转换
 *   - 不执行 Recovery（只产出 Action，由 translateAndSubmit 执行）

 * @param g globalCache
 * @param tick 当前 tick
 * @returns 转换后的 RecoveryAction 列表
 */
function consumeWarAbortSignals(
  g: ReturnType<typeof globalCache>,
  tick: number,
): RecoveryAction[] {
  const signal = g.warAbortSignals;
  if (!signal) return [];

  // tick 级幂等：同一 tick 不重复消费
  if (signal.tick === lastConsumedAbortTick) return [];

  // 只消费当前或更早 tick 写入的信号（不消费未来信号）
  if (signal.tick > tick) return [];

  // 标记为已消费
  lastConsumedAbortTick = signal.tick;

  // 通过 domain 纯函数转换
  const actions = mapAbortSignalsToRecoveryActions([signal as WarAbortSignal]);

  // 记录 Decision Trace 事件
  if (actions.length > 0) {
    const action = actions[0]!;
    recordEvent(EventKind.WarOutcome, signal.targetRoom, [
      -1, // 特殊编码：Recovery triggered
      signal.spawned,
      actions.length,
    ]);
    console.log(
      `[${tick}] recovery: WAR_ABORT consumed` +
      ` reason=${signal.reason} outcome=${signal.outcome}` +
      ` sponsor=${signal.sponsor} target=${signal.targetRoom}` +
      ` → action=${action.type} priority=${action.priority}` +
      ` urgent=${action.urgent}`,
    );
  }

  // 消费后清除信号（防止下一 tick 重复消费）
  g.warAbortSignals = undefined;

  return actions;
}

// ─── A5.4.1: Tactical Abort Signal 消费 ──────────────────

/**
 * 消费 globalCache.tacticalAbortSignals，转换为 WarAbortSignal 格式后走同一管线。

 * Tactical Runtime System 将 TacticalAbortSignal 写入 globalCache.tacticalAbortSignals，
 * 本函数负责将其桥接到 warAbortSignals 管线（复用 mapAbortSignalsToRecoveryActions）。

 * 边界：
 *   - 只读 tacticalAbortSignals（Tactical Runtime 写入的公开信号）
 *   - 转换为 WarAbortSignal 格式后复用既有管线
 *   - 幂等性：通过 signalId 去重
 */
function consumeTacticalAbortSignals(
  g: ReturnType<typeof globalCache> & { tacticalAbortSignals?: TacticalAbortSignal[] },
  tick: number,
): RecoveryAction[] {
  const signals = g.tacticalAbortSignals;
  if (!signals || signals.length === 0) return [];

  const consumed = new Set<string>();
  const warSignals: WarAbortSignal[] = [];

  for (const sig of signals) {
    if (consumed.has(sig.signalId)) continue;
    consumed.add(sig.signalId);

    // TacticalAbortReason → WarAbortSignal.reason 映射
    const reasonMap: Record<string, string> = {
      SQUAD_BROKEN: "ATTRITION",
      HEALER_LOST: "ATTRITION",
      ENEMY_CAPABILITY_SURGE: "ATTRITION",
      INTEL_STALE: "PLAN_TIMEOUT",
      LOGISTICS_FAILURE: "ATTRITION",
      CASUALTY_EXCEEDED: "ATTRITION",
      OBJECTIVE_UNACHIEVABLE: "NO_TARGET",
      AUTHORIZATION_REVOKED: "POSTURE",
    };

    warSignals.push({
      tick: sig.tick,
      reason: reasonMap[sig.reason] ?? "ATTRITION",
      targetRoom: sig.operationId.replace("war-", ""),
      sponsor: "",
      spawned: 0,
      outcome: "unknown",
      operationId: sig.operationId,
    });
  }

  // 消费后清除
  g.tacticalAbortSignals = [];

  if (warSignals.length === 0) return [];

  const actions = mapAbortSignalsToRecoveryActions(warSignals);

  if (actions.length > 0) {
    console.log(
      `[${tick}] recovery: TACTICAL_ABORT consumed` +
      ` count=${warSignals.length} → actions=${actions.length}`,
    );
  }

  return actions;
}
