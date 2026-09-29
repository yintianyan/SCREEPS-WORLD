/** Expansion Observability Dashboard */

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
  let qualified = 0,
    rejected = 0,
    unknown = 0;
  let topRoom: string | undefined;
  let topScore = 0;
  for (const c of candidates) {
    switch (c.status) {
      case "QUALIFIED":
        qualified++;
        if (c.score > topScore) {
          topScore = c.score;
          topRoom = c.roomName;
        }
        break;
      case "REJECTED":
        rejected++;
        break;
      case "UNKNOWN":
        unknown++;
        break;
      case "BLACKLISTED":
        rejected++;
        break;
    }
  }

  // Plan 统计
  const activePlans = plans.filter(
    p =>
      p.status === "DISCOVERED" ||
      p.status === "EVALUATED" ||
      p.status === "READY" ||
      p.status === "APPROVED" ||
      p.status === "WAITING_EXECUTION",
  );
  const waitingExecution = plans.filter(p => p.status === "WAITING_EXECUTION");
  const topPlan = activePlans[0];

  // Failed gates：除名字外必须带上**实测值与判据**。只有代号时 "G4: net flow" 分不清
  // 「差一点」与「差一个数量级」，而这两者要做的动作没有交集（真实事故：扩张闸连续 7 小时
  // 报 `Blocked=G3+G6`，而同一份 Memory 里的 failedGates 数组其实是 4 道 —— 读数的人
  // 据此只查了 CPU 与健康度）。名字仍保持 `Gn:` 开头，summary 那一行按前缀取代号。
  const failedGates = readiness.gates
    .filter(g => !g.passed)
    .map(g => `${g.name}(v=${g.value}|${g.condition})`);

  const summary = [
    `Expansion Dashboard @${tick}`,
    `Pressure=${pressure.level}(${pressure.score.toFixed(2)})`,
    `Readiness=${readiness.readiness}`,
    // 卡在哪几道闸要写进这一行：`Readiness=NOT_READY` 单独存在时不区分「正在打仗」
    // （G0 posture）、「有活威胁」（G1）与「CPU 余量不足」（G6），而这三种 NOT_READY
    // 要做的动作互相没有交集。取闸门名的代号前缀，整行仍是给人读的一行。
    `Blocked=${failedGates.length ? failedGates.map(g => g.split(":")[0]?.trim() ?? g).join("+") : "none"}`,
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
