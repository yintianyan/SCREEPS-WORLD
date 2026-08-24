/**
 * Expansion Observability Dashboard — A3.2 Phase 1：可观测性数据组装。
 *
 * 合同锚点：AGENTS.md 自治可审计前提 + DATA_FLOW §3 可观测性。
 *
 * 定位：把 Pressure / Readiness / Budget / Candidates / Plan 汇总为一个
 * 结构化 Dashboard 对象，供 global-cache.ts 写入、控制台/log 消费。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExpansionPressureResult } from "./pressure";
import type { TieredExpansionBudget } from "./budget";
import type { ExpansionCandidateV2 } from "./candidate";
import type { ExpansionPlan } from "./plan";
import type { DecisionExplanation } from "./explanation";
import type { ExpansionReadinessResult } from "../strategy/readiness";

/** 扩张 Dashboard 数据。 */
export interface ExpansionDashboard {
  /** 采样 tick。 */
  tick: number;
  // ── 压力 ──
  pressure: {
    level: ExpansionPressureResult["level"];
    score: number;
    dimensions: ExpansionPressureResult["dimensions"];
  };
  // ── 就绪度 ──
  readiness: {
    readiness: ExpansionReadinessResult["readiness"];
    evidence: string;
    failedGates: string[];
  };
  // ── 预算 ──
  budget: {
    available: number;
    total: number;
    coreInvaded: boolean;
  };
  // ── 候选 ──
  candidates: {
    total: number;
    qualified: number;
    rejected: number;
    unknown: number;
    topRoom?: string;
    topScore?: number;
  };
  // ── 计划 ──
  plans: {
    active: number;
    waitingExecution: number;
    topPlanId?: string;
    topPlanRoom?: string;
    topPlanStatus?: string;
    topPlanExplanation?: DecisionExplanation;
  };
  // ── 摘要 ──
  summary: string;
}

/**
 * 组装扩张 Dashboard 数据（纯函数）。
 */
export function buildExpansionDashboard(input: {
  tick: number;
  pressure: ExpansionPressureResult;
  readiness: ExpansionReadinessResult;
  budget: TieredExpansionBudget;
  candidates: readonly ExpansionCandidateV2[];
  plans: readonly ExpansionPlan[];
  topExplanation?: DecisionExplanation;
}): ExpansionDashboard {
  const { tick, pressure, readiness, budget, candidates, plans, topExplanation } = input;

  // 候选统计
  let qualified = 0, rejected = 0, unknown = 0;
  let topRoom: string | undefined;
  let topScore = 0;
  for (const c of candidates) {
    switch (c.status) {
      case "QUALIFIED": qualified++; if (c.score > topScore) { topScore = c.score; topRoom = c.roomName; } break;
      case "REJECTED": rejected++; break;
      case "UNKNOWN": unknown++; break;
      case "BLACKLISTED": rejected++; break;
    }
  }

  // Plan 统计
  const activePlans = plans.filter(p =>
    p.status === "DISCOVERED" || p.status === "EVALUATED" || p.status === "READY" || p.status === "APPROVED" || p.status === "WAITING_EXECUTION"
  );
  const waitingExecution = plans.filter(p => p.status === "WAITING_EXECUTION");
  const topPlan = activePlans[0];

  // Failed gates
  const failedGates = readiness.gates.filter(g => !g.passed).map(g => g.name);

  const summary = [
    `Expansion Dashboard @${tick}`,
    `Pressure=${pressure.level}(${pressure.score.toFixed(2)})`,
    `Readiness=${readiness.readiness}`,
    `Budget=${budget.availableExpansion}/${budget.totalEnergy}${budget.coreInvaded ? " INVADED" : ""}`,
    `Candidates=${candidates.length}(Q=${qualified},R=${rejected},U=${unknown})`,
    `Plans=${activePlans.length} active, ${waitingExecution.length} waiting`,
    topPlan ? `Top=${topPlan.roomName}(${topPlan.status})` : "No active plan",
  ].join(" | ");

  return {
    tick,
    pressure: {
      level: pressure.level,
      score: pressure.score,
      dimensions: pressure.dimensions,
    },
    readiness: {
      readiness: readiness.readiness,
      evidence: readiness.evidence,
      failedGates,
    },
    budget: {
      available: budget.availableExpansion,
      total: budget.totalEnergy,
      coreInvaded: budget.coreInvaded,
    },
    candidates: {
      total: candidates.length,
      qualified,
      rejected,
      unknown,
      topRoom,
      topScore: topScore > 0 ? topScore : undefined,
    },
    plans: {
      active: activePlans.length,
      waitingExecution: waitingExecution.length,
      topPlanId: topPlan?.planId,
      topPlanRoom: topPlan?.roomName,
      topPlanStatus: topPlan?.status,
      topPlanExplanation: topExplanation,
    },
    summary,
  };
}
