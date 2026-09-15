/** Expansion UOEM 事件/遥测/黑名单 — Milestone 与 Terminal Outcome 分离的唯一出口。 */
import { CONFIG } from "../../../config";
import { EventKind, recordEvent } from "../../../kernel/event-log";
import { log } from "../../../kernel/log";
import {
  makeOperationId,
  type ExpansionResult,
  type OutcomeEvent,
} from "../../../domain/expansion/uoem-types";
import { getOutcomeChannel, enqueueOutcome, makeEventId } from "../../../kernel/outcome-channel";
import {
  appendOutcome,
  evaluateExpansionRhythm,
  type ExpansionOutcomeKind,
} from "../../../domain/expansion/rhythm";
import { querySquad, globalCache } from "../../../kernel/global-cache";
import { cancelRequestsByHome } from "../../../domain/spawn/queue";
import {
  recordExpansionCompleted,
  recordExpansionFailed,
  recordPlanningDecision,
} from "../../../telemetry";

type ExpansionState = NonNullable<KernelMemory["expansion"]>;

/** ExpansionOutcome 事件编码（与 event-log 注释对齐）。 */
const PHASE_CLAIM = 0;
const PHASE_PIONEER = 1;
const OUTCOME_SUCCESS = 0;
const OUTCOME_STOLEN = 1;
const OUTCOME_TIMEOUT = 2;
const OUTCOME_LOST = 3;
const OUTCOME_ABORTED = 4;

/** 事件序列号（用于 makeEventId）。heap only — reset 后从 0 重启可接受。 */
let __uoemEventSeq = 0;

/**
 * 发射 MilestoneEvent — 非终态事件，不进入 OutcomeChannel。
 * P1 claim 成功、P5 forced advance、P7 forced success 调用此函数。
 */
export function emitMilestone(expansion: ExpansionState, milestone: string, tick: number): void {
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

  // 保留事件序号推进副作用（原 MilestoneEvent 构造为死代码已移除，seq 递增行为保持不变）
  makeEventId(tick, ++__uoemEventSeq);
}

/**
 * 入队终态 OutcomeEvent — 唯一终态出口。
 * P2/P3/P4/P6/P8/P9/A1/B1 调用此函数。
 * 同一 operationId 只接受第一条（幂等去重）。
 */
export function enqueueTerminalOutcome(
  expansion: ExpansionState,
  tick: number,
  result: ExpansionResult,
): void {
  const operationId =
    expansion.operationId ??
    makeOperationId(expansion.target, expansion.openedAt ?? expansion.startedAt);
  const openedAt = expansion.openedAt ?? expansion.startedAt;

  // recordEvent 保留（eventLog 不变）
  const phaseCode =
    expansion.state === "claiming" || expansion.state === "preparing" ? PHASE_CLAIM : PHASE_PIONEER;
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
    log.info(
      "expansion",
      `[${tick}] expansion: duplicate terminal outcome rejected for ${operationId}`,
    );
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
    log.info(
      "expansion",
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
    log.info(
      "expansion",
      `[${tick}] expansion: ${result.consecutiveFailures} 连败 — 暂停扩张 ${result.pauseTicks} tick`,
    );
  }
}

function codeToKind(code: number): ExpansionOutcomeKind {
  return (["success", "stolen", "timeout", "lost", "aborted"] as const)[code] ?? "aborted";
}

function kindToCode(kind: ExpansionOutcomeKind): number {
  return (["success", "stolen", "timeout", "lost", "aborted"] as const).indexOf(kind);
}

export function blacklistTarget(roomName: string, tick: number): void {
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

export function pruneBlacklist(tick: number): void {
  const bl = Memory.kernel?.expansionBlacklist;
  if (!bl) return;
  for (const [room, retryAt] of Object.entries(bl)) {
    if (tick >= retryAt) delete bl[room];
  }
}
