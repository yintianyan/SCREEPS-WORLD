/** Expansion Planner 系统 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import {
  createTimeSeries,
  pushSample,
  gcTimeSeries,
} from "../domain/intelligence/prediction/time-series";
import { queryEmpirePlannerInput } from "./empire-economy";
import { evaluateExpansionPressure } from "../domain/expansion/pressure";
import { discoverCandidates } from "../domain/expansion/discovery";
import { scoreCandidates } from "../domain/expansion/scoring";
import { rankCandidates, type RankedCandidate } from "../domain/expansion/ranking";
import { estimateExpansionCost } from "../domain/expansion/cost-model";
import { evaluatePayback } from "../domain/expansion/payback";
import { evaluateRisk } from "../domain/expansion/risk";
import { computeTieredBudget } from "../domain/expansion/budget";
import { createPlan, updatePlanStatus, type ExpansionPlan } from "../domain/expansion/plan";
import {
  deduplicatePlans,
  prunePlans,
  getActivePlans,
  applyHysteresis,
  needsReevaluation,
  type PlanWithHysteresis,
} from "../domain/expansion/plan-lifecycle";
import { explainDecision } from "../domain/expansion/explanation";
import { buildExpansionDashboard } from "../domain/expansion/dashboard";
import { evaluateExpansionReadinessExtended } from "../domain/strategy/readiness";
import type { ExpansionCandidateV2 } from "../domain/expansion/candidate";
import type { RoomIntel } from "../domain/intel";

/** heap 缓存的 hysteresis 状态（Plan planId → PlanWithHysteresis）。 */
let hysteresisCache: Map<string, PlanWithHysteresis> = new Map();

/**
 * Expansion Planner 系统 — Intelligence 层薄壳。

 * 不执行任何 Expansion Action。只做评估、排序、Plan 生命周期管理。
 * A3.3 Phase 0 修复：推进 Plan 到 WAITING_EXECUTION 供 expansion-manager 消费。
 */
export const expansionPlannerSystem: System = {
  name: "expansion-planner",
  priority: 1 as Priority,
  /** 每 100 tick 执行一次（与 empire-economy 同频，在其后运行消费 Planner Input）。 */
  interval: 100,
  run(ctx: TickContext): void {
    // ── 前置：消费 empire-economy 产出的 Planner Input ──
    const plannerInput = queryEmpirePlannerInput();
    if (!plannerInput) return;

    // ── 步 1：Expansion Pressure ──
    const pressure = evaluateExpansionPressure({
      view: plannerInput.resourceView,
      budget: plannerInput.budget,
      capacityProfiles: plannerInput.capacityProfiles,
      gclLevel: Game.gcl?.level ?? 1,
      ownedRoomCount: plannerInput.resourceView.roomCount,
      candidateCount: Memory.kernel?.expansionCandidates?.length ?? 0,
      hasAdversaryPressure: false, // 简化：从 situation 派生，暂设 false
    });

    // ── 步 2：Candidate Discovery ──
    const ownedRoomNames = Array.from(ctx.snapshots()).map(s => s.roomName);
    const intelBySponsor: Record<string, Record<string, RoomIntel>> = {};
    for (const roomName of ownedRoomNames) {
      const roomMem = Memory.rooms[roomName];
      if (roomMem?.intel) {
        intelBySponsor[roomName] = roomMem.intel as Record<string, RoomIntel>;
      }
    }

    // 从 Memory 恢复已有候选
    const existingCandidates = deserializeCandidates(Memory.kernel?.expansionCandidates);
    const discoveryResult = discoverCandidates({
      ownedRoomNames,
      intelBySponsor,
      tick: ctx.tick,
      myUsername: (Game as unknown as { username?: string }).username,
      existingCandidates,
    });

    // ── 步 3：Candidate Scoring (7-Factor) ──
    const evaluable = discoveryResult.candidates.filter(c =>
      c.status === "DISCOVERED" && c.sourceCount !== undefined && !c.vetoReason,
    );
    const scored = scoreCandidates(evaluable, {}, ctx.tick);

    // 合并已评分和未评分候选
    const allCandidates = [
      ...scored,
      ...discoveryResult.candidates.filter(c => c.status !== "DISCOVERED" || c.vetoReason || c.sourceCount === undefined),
    ];

    // ── 步 4：Candidate Ranking ──
    const ranked: RankedCandidate[] = rankCandidates(allCandidates, ctx.tick);

    // ── 步 5：从 Memory 反序列化已有 Plan ──
    let plans = deserializePlans(Memory.kernel?.expansionPlans);

    // ── 步 6：重评已有 Plan（经济/Intel 变化时） ──
    plans = plans.map(p => {
      if (needsReevaluation(p, ctx.tick)) {
        // 简化重评：保持现有状态，仅更新 updatedAt
        return { ...p, updatedAt: ctx.tick };
      }
      return p;
    });

    // ── 步 7：Hysteresis 推进（EVALUATED → READY） ──
    const tieredBudget = computeTieredBudget(plannerInput.budget);
    const topCandidate = ranked[0]?.candidate;
    const cost = topCandidate ? estimateExpansionCost(topCandidate) : undefined;
    const payback = topCandidate && cost ? evaluatePayback(topCandidate, cost) : undefined;
    const risk = topCandidate && cost ? evaluateRisk(
      topCandidate, cost,
      plannerInput.budget.reserve,
      ctx.tick - topCandidate.lastSeen,
      10000,
    ) : undefined;

    // 评估 extended readiness (G12-G15)
    const extendedReadiness = evaluateExpansionReadinessExtended(
      topCandidate, cost, risk, tieredBudget,
    );
    const isReady = extendedReadiness.allPassed && plannerInput.readiness.readiness !== "NOT_READY";

    plans = plans.map(p => {
      if (p.status !== "EVALUATED" && p.status !== "READY") return p;

      // 获取或创建 hysteresis 状态
      let h = hysteresisCache.get(p.planId);
      if (!h) {
        h = { plan: p, hysteresis: { readyTicks: 0, notReadyTicks: 0, lastEvalTick: ctx.tick } };
      } else {
        h = { plan: p, hysteresis: h.hysteresis };
      }

      // 应用 hysteresis
      const result = applyHysteresis(h, isReady, ctx.tick);
      hysteresisCache.set(p.planId, result);
      return result.plan;
    });

    // ── 步 8：READY → APPROVED → WAITING_EXECUTION ──
    plans = plans.map(p => {
      if (p.status === "READY") {
        // 检查决策是否 APPROVE
        const decision = explainDecision({
          plan: p,
          pressure,
          budget: tieredBudget,
          readiness: plannerInput.readiness,
          tick: ctx.tick,
        });

        if (decision.outcome === "APPROVE") {
          let approved = updatePlanStatus(p, "APPROVED", ctx.tick);
          approved = updatePlanStatus(approved, "WAITING_EXECUTION", ctx.tick);
          console.log(`[${ctx.tick}] expansion-planner: Plan ${p.planId} APPROVED → WAITING_EXECUTION`);
          return approved;
        }
      }
      return p;
    });

    // ── 步 9：为新合格候选拉创建新 Plan ──
    if (topCandidate && topCandidate.status === "QUALIFIED" && payback?.worthwhile && cost && payback && risk) {
      const newPlan = createPlan({
        candidate: topCandidate,
        reason: "resource",
        cost,
        payback,
        risk,
        tick: ctx.tick,
      });

      const dedupResult = deduplicatePlans(plans, newPlan);
      plans = dedupResult.plans;
      if (dedupResult.deduplicated) {
        // 已有同 roomName Plan，检查是否需要更新评分
      }
    }

    // ── 步 10：清理终态 Plan ──
    plans = prunePlans(plans, ctx.tick);

    // ── 步 11：持久化到 Memory ──
    if (!Memory.kernel) Memory.kernel = {};
    Memory.kernel.expansionPlans = plans.map(serializePlan);
    Memory.kernel.expansionCandidates = allCandidates.slice(0, 10).map(serializeCandidate);

    // ── 步 12：Dashboard ──
    const dashboard = buildExpansionDashboard({
      tick: ctx.tick,
      pressure,
      readiness: plannerInput.readiness,
      budget: tieredBudget,
      candidates: allCandidates,
      plans,
    });

    // ── 写入 heap 缓存 ──
    const g = globalCache();
    g.expansionDashboard = dashboard;

    // ── A6.3 远矿收益采样寄生（复用 expansion-planner 既有 100t cadence）──
    // PRED-010：不自建采样通道，寄生在既有 cadence 中追加 1 个采样字段。
    sampleRemoteMiningForPredictions(g, ctx.tick);

    // ── 写入 Memory 瘦快照 ──
    Memory.kernel.expansionDashboard = {
      tick: ctx.tick,
      summary: dashboard.summary,
    };

    // ── 可观测性 ──
    console.log(`[${ctx.tick}] expansion-planner: ${dashboard.summary}`);
  },
};

// ─── 序列化 / 反序列化辅助 ──────────────────────────────

/** 序列化 Plan 到 Memory 瘦结构。 */
function serializePlan(plan: ExpansionPlan): ExpansionPlanMemory {
  return {
    pid: plan.planId,
    rn: plan.roomName,
    sr: plan.sponsorRoom,
    rs: plan.reason,
    pr: plan.priority,
    sc: Math.round(plan.candidateScore * 100) / 100,
    tc: plan.cost.totalCost,
    pb: plan.payback.paybackTicks === Infinity ? -1 : plan.payback.paybackTicks,
    roi: Math.round(plan.payback.roi * 100) / 100,
    rk: Math.round(plan.risk.score * 100) / 100,
    rl: plan.risk.level,
    st: plan.status,
    ca: plan.createdAt,
    ua: plan.updatedAt,
    aa: plan.approvedAt,
    cr: plan.cancelReason,
    ex: plan.explanation.slice(0, 200),
  };
}

/** 从 Memory 瘦结构反序列化 Plan。 */
function deserializePlans(stored: ExpansionPlanMemory[] | undefined): ExpansionPlan[] {
  if (!stored || !Array.isArray(stored)) return [];
  return stored.map(m => deserializePlan(m)).filter((p): p is ExpansionPlan => p !== null);
}

/** 反序列化单个 Plan。 */
function deserializePlan(m: ExpansionPlanMemory): ExpansionPlan | null {
  if (!m || typeof m !== "object") return null;
  // 重建简化的候选/成本/回收/风险对象（足够用于执行决策）
  const cost: ExpansionCostEstimate = {
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
  const payback: PaybackResult = {
    roomName: m.rn,
    totalCost: m.tc,
    expectedIncomePerTick: 0,
    paybackTicks: m.pb === -1 ? Infinity : m.pb,
    roi: m.roi,
    worthwhile: m.roi >= 1,
    evidence: "",
  };
  const risk: RiskResult = {
    roomName: m.rn,
    score: m.rk,
    level: m.rl as RiskLevel,
    dimensions: { economic: 0, operational: 0, distance: 0, recovery: 0, defense: 0 },
    evidence: "",
  };
  const candidate: ExpansionCandidateV2 = {
    roomName: m.rn,
    sponsorRoom: m.sr,
    kind: "normal",
    roomStatus: "normal",
    sourceCount: 2,
    mineral: undefined,
    terrain: { exitCount: 4, sealedExitCount: 0, wallCount: 0 },
    controller: { hasOwner: false, isMine: false, isHostileReserved: false },
    pathCost: undefined,
    lastSeen: m.ca,
    distance: 1,
    neighborRooms: [],
    score: m.sc,
    status: "QUALIFIED",
    discoveredAt: m.ca,
  };
  return {
    planId: m.pid,
    roomName: m.rn,
    sponsorRoom: m.sr,
    reason: m.rs as ExpansionReason,
    priority: m.pr as PlanPriority,
    candidateScore: m.sc,
    cost,
    payback,
    risk,
    candidate,
    status: m.st as PlanStatus,
    createdAt: m.ca,
    updatedAt: m.ua ?? m.ca,
    approvedAt: m.aa,
    cancelReason: m.cr,
    cancelConditions: [
      "claim stolen / timeout",
      "spawn not built within pioneerTimeout",
      "bootstrap net flow negative beyond threshold",
      "empire CPU below Guarded",
    ],
    dependencies: [],
    explanation: m.ex ?? "",
  };
}

/** 序列化候选到 Memory 瘦结构。 */
function serializeCandidate(c: ExpansionCandidateV2): ExpansionCandidateMemory {
  return {
    rn: c.roomName,
    sr: c.sponsorRoom,
    k: c.kind,
    rs: c.roomStatus,
    sc: c.sourceCount,
    mn: c.mineral,
    s: Math.round(c.score * 100) / 100,
    d: c.distance,
    pc: c.pathCost,
    ls: c.lastSeen,
    st: c.status,
    da: c.discoveredAt,
    ea: c.evaluatedAt,
    vr: c.vetoReason,
  };
}

/** 从 Memory 反序列化候选。 */
function deserializeCandidates(stored: ExpansionCandidateMemory[] | undefined): ExpansionCandidateV2[] {
  if (!stored || !Array.isArray(stored)) return [];
  return stored.map(m => ({
    roomName: m.rn,
    sponsorRoom: m.sr,
    kind: m.k as ExpansionCandidateV2["kind"],
    roomStatus: m.rs,
    sourceCount: m.sc,
    mineral: m.mn,
    terrain: { exitCount: 4, sealedExitCount: 0, wallCount: 0 },
    controller: { hasOwner: false, isMine: false, isHostileReserved: false },
    pathCost: m.pc,
    lastSeen: m.ls,
    distance: m.d,
    neighborRooms: [],
    score: m.s,
    status: m.st as ExpansionCandidateV2["status"],
    discoveredAt: m.da,
    evaluatedAt: m.ea,
    vetoReason: m.vr,
  }));
}

// ─── 类型导入（避免循环依赖）──
import type { ExpansionCostEstimate } from "../domain/expansion/cost-model";
import type { PaybackResult } from "../domain/expansion/payback";
import type { RiskResult, RiskLevel } from "../domain/expansion/risk";
import type { ExpansionReason } from "../domain/expansion/candidate";
import type { PlanStatus, PlanPriority } from "../domain/expansion/plan";

// ─── A6.3 远矿采样寄生 ────────────────────────────────────

/** TimeSeries 容量上限。 */
const REMOTE_MINING_TS_CAPACITY = 100;

/**
 * A6.3 远矿收益采样 — 复用 expansion-planner 既有 100t cadence。

 * PRED-010：不自建采样通道，寄生在既有 cadence 中追加 1 个采样字段。

 * 采样内容：
 *   - 远矿净收益 + 威胁计数（→ __remoteMiningHistory，预测目标 #5）

 * 从 expansionDashboard 或 Memory 中的远矿数据派生净收益。
 * global reset 后从空 TimeSeries 重建（可接受）。
 */
function sampleRemoteMiningForPredictions(
  g: ReturnType<typeof globalCache>,
  tick: number,
): void {
  // WO-11/P14：无消费者（prediction-system 不读此序列）。降频到每 500t 采样省 CPU，
  // 数据保留供未来预测目标 #5 接线。接线后恢复每 100t 采样。
  if (tick % 500 !== 0) return;

  if (!g.__remoteMiningHistory) {
    g.__remoteMiningHistory = createTimeSeries<{ netIncome: number; threatCount: number }>(
      REMOTE_MINING_TS_CAPACITY,
    );
  }

  // 从 expansionDashboard 提取远矿数据
  const dashboard = g.expansionDashboard;
  if (!dashboard) return;

  // 从 Memory.rooms 中统计活跃远矿 op 数量
  let remoteOpCount = 0;
  let threatCount = 0;
  const mem = globalThis as { Memory?: { rooms?: Record<string, { remoteOps?: unknown[] }> } };
  if (mem.Memory?.rooms) {
    for (const roomMem of Object.values(mem.Memory.rooms)) {
      if (roomMem?.remoteOps && Array.isArray(roomMem.remoteOps)) {
        remoteOpCount += roomMem.remoteOps.length;
      }
    }
  }

  // 从 threatAssessments 统计威胁数
  if (g.threatAssessments) {
    for (const _ of g.threatAssessments) {
      threatCount++;
    }
  }

  // 净收益简化：用 dashboard 的 summary 数据（如果可用）
  // dashboard.summary 是字符串，不直接可解析为数字
  // 简化：用 remoteOpCount 作为代理指标，netIncome 后续由 models 推导
  const netIncome = remoteOpCount > 0 ? 1 : 0;

  pushSample(g.__remoteMiningHistory, tick, { netIncome, threatCount });
  gcTimeSeries(g.__remoteMiningHistory, tick, REMOTE_MINING_TS_CAPACITY * 200);
}
