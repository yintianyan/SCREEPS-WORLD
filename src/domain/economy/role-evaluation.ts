/** Role Evaluation */

import type { EmpireRoomRole } from "./empire-role";
import type { RoomEconomicProfile } from "./room-profile";
import type { RoomCapacityProfile } from "./capacity-profile";

// ─── 输入类型 ─────────────────────────────────────────────

/**
 * Role Evaluation Input — 角色评估所需的房间特征输入。

 * 从 RoomEconomicProfile + RoomCapacityProfile + 地理/远矿数据组装。
 * 调用方（系统侧薄壳）负责采集各字段并注入。
 */
export interface RoleEvaluationInput {
  /** 房间名。 */
  roomName: string;
  /** 经济剖面（步 1 产出）。 */
  profile: RoomEconomicProfile;
  /** 产能剖面（步 3 产出）。 */
  capacity: RoomCapacityProfile;

  // ── 地理特征（由系统侧从 Room Registry 计算）──
  /**
   * 帝国其他房间的平均线性距离（Chebyshev）。
   * 值低 = 位于帝国地理中心 → SUPPORT 优势。
   * 无其他房时为 0。
   */
  avgDistanceToOthers: number;
  /**
   * 帝国其他房间数量。
   * 用于判断是否是单房帝国（单房时地理中心无意义）。
   */
  otherRoomCount: number;
  /**
   * 是否有 terminal。
   * 有 terminal → SUPPORT 优势（可做转运枢纽）。
   */
  hasTerminal: boolean;

  // ── 远矿特征（由系统侧从 remoteOps 采集）──
  /**
   * 活跃远矿运营数量（remoteOps 中 state=active 的数量）。
   * 值高 → REMOTE 优势。
   */
  activeRemoteOps: number;
  /**
   * 远矿总净收益（Σ remoteOp.netScore）。
   * 值高 → REMOTE 优势。
   */
  remoteNetScore: number;
  /**
   * 远矿产出占本房估计收入的比例（0..1）。
   * remoteNetScore / (estimatedIncome + remoteNetScore)。
   * 值高 → REMOTE 优势。
   */
  remoteProductionRatio: number;

  // ── 帝国均值（由系统侧从所有 profiles 计算）──
  /**
   * 帝国平均估计收入。
   * 用于判断本房产能是否高于均值（PRODUCTION 比较优势）。
   */
  empireAvgIncome: number;
  /**
   * 帝国平均效率系数。
   * 用于判断本房效率是否高于均值。
   */
  empireAvgEfficiency: number;

  /** 当前 tick（供证据记录）。 */
  tick: number;
}

// ─── 评分结果 ─────────────────────────────────────────────

/**
 * 单维度评分。
 */
export interface RoleDimensionScore {
  /** 维度名。 */
  dimension: string;
  /** 得分（0..1）。 */
  score: number;
  /** 人类可读证据。 */
  evidence: string;
}

/**
 * 单角色评分结果。
 */
export interface RoleScore {
  /** 角色。 */
  role: EmpireRoomRole;
  /** 总分（0..1，加权汇总）。 */
  totalScore: number;
  /** 是否通过前置条件门控。 */
  prerequisitesMet: boolean;
  /** 各维度评分。 */
  dimensions: RoleDimensionScore[];
  /** 人类可读证据汇总。 */
  evidence: string;
}

/**
 * Role Evaluation Result — 房间角色评估完整结果。
 */
export interface RoleEvaluationResult {
  /** 房间名。 */
  roomName: string;
  /** 采样 tick。 */
  tick: number;
  /** 四角色评分。 */
  scores: Record<EmpireRoomRole, RoleScore>;
  /** 推荐角色（总分最高且前置条件通过）。 */
  recommendedRole: EmpireRoomRole;
  /** 推荐角色的总分。 */
  recommendedScore: number;
  /** 是否有角色变更（推荐角色与当前角色不同）。 */
  hasRoleChange: boolean;
  /** 人类可读摘要。 */
  summary: string;
}

// ─── 权重定义 ─────────────────────────────────────────────

/**
 * 各角色的维度权重（总和 = 1.0）。

 * 设计理念：
 * - CORE 重储备 + 稳定性（高 RCL + 高 storageRatio + 高 riskBuffer + 正 netFlow）
 * - PRODUCTION 重产能（高 efficiency + 高 estimatedIncome + 高 sourceCount）
 * - SUPPORT 重地理位置（低 avgDistance + hasTerminal + 高 otherRoomCount）
 * - REMOTE 重远矿贡献（高 activeRemoteOps + 高 remoteNetScore + 高 remoteProductionRatio）
 */
const ROLE_WEIGHTS: Record<EmpireRoomRole, Record<string, number>> = {
  core: {
    rcl: 0.20,
    storage: 0.20,
    stability: 0.25,
    netFlow: 0.20,
    riskBuffer: 0.15,
  },
  production: {
    efficiency: 0.30,
    income: 0.25,
    sourceCount: 0.15,
    stability: 0.15,
    capacityUtilization: 0.15,
  },
  support: {
    terminal: 0.25,
    centrality: 0.30,
    connectivity: 0.20,
    stability: 0.15,
    storage: 0.10,
  },
  remote: {
    activeOps: 0.25,
    netScore: 0.25,
    productionRatio: 0.25,
    stability: 0.15,
    capacity: 0.10,
  },
};

// ─── 前置条件门控 ─────────────────────────────────────────

/**
 * 判定角色的前置条件是否满足。

 * 硬门控——不满足时该角色分数直接为 0。
 * 纯函数。
 */
export function meetsPrerequisites(
  role: EmpireRoomRole,
  input: RoleEvaluationInput,
): boolean {
  const { profile } = input;

  // 所有角色都要求 colonyState = normal（困难房不能有职能）
  if (profile.isStruggling) return false;

  switch (role) {
    case "core":
      // RCL ≥ 6 + 有 storage + 正净流
      return profile.rcl >= 6 && profile.hasStorage && profile.netFlowPositive;

    case "production":
      // RCL ≥ 4 + 有 storage + 有产能
      return profile.rcl >= 4 && profile.hasStorage && profile.estimatedIncome > 0;

    case "support":
      // RCL ≥ 4 + 有 storage（terminal 非硬性要求——RCL6 可建）
      return profile.rcl >= 4 && profile.hasStorage;

    case "remote":
      // 有活跃远矿 + 远矿净收益为正
      return input.activeRemoteOps > 0 && input.remoteNetScore > 0;
  }
}

// ─── 维度评分函数 ─────────────────────────────────────────

/** clamp 到 [0,1]。 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** RCL 评分：RCL 8 = 1.0, RCL 6 = 0.8, RCL 4 = 0.4, RCL < 4 = 0。 */
function scoreRcl(rcl: number): RoleDimensionScore {
  const score = rcl >= 8 ? 1.0 : rcl >= 7 ? 0.9 : rcl >= 6 ? 0.8 : rcl >= 5 ? 0.6 : rcl >= 4 ? 0.4 : 0;
  return { dimension: "rcl", score, evidence: `rcl=${rcl}` };
}

/** 储备水位评分：storageRatio ≥ 0.5 = 1.0, 按 ratio 线性递减。 */
function scoreStorage(profile: RoomEconomicProfile): RoleDimensionScore {
  if (!profile.hasStorage) {
    return { dimension: "storage", score: 0, evidence: "no storage" };
  }
  const score = clamp01(profile.storageRatio * 2); // ratio 0.5 → 1.0
  return { dimension: "storage", score, evidence: `storageRatio=${profile.storageRatio.toFixed(2)}` };
}

/** 稳定性评分：非困难态 + 无降级风险 + 无活威胁 = 高分。 */
function scoreStability(profile: RoomEconomicProfile): RoleDimensionScore {
  let score = 0.5; // 基础分
  if (!profile.isStruggling) score += 0.2;
  if (!profile.controllerDowngradeRisk) score += 0.15;
  if (!profile.hasLiveThreat) score += 0.15;
  score = clamp01(score);
  const evidence = [
    `struggling=${profile.isStruggling}`,
    `downgrade=${profile.controllerDowngradeRisk}`,
    `threat=${profile.hasLiveThreat}`,
  ].join(" ");
  return { dimension: "stability", score, evidence };
}

/** 净流评分：净流 > 0 且值越高越好。 */
function scoreNetFlow(profile: RoomEconomicProfile): RoleDimensionScore {
  if (!profile.netFlowPositive) {
    return { dimension: "netFlow", score: 0, evidence: `netFlow=${profile.netFlow.toFixed(1)} (negative)` };
  }
  // netFlow 0-20 e/tick 线性映射到 0.5-1.0
  const score = clamp01(0.5 + Math.min(0.5, profile.netFlow / 40));
  return { dimension: "netFlow", score, evidence: `netFlow=${profile.netFlow.toFixed(1)}` };
}

/** 风险缓冲评分：riskBuffer ≥ 1000 = 1.0, 线性递减到 0。 */
function scoreRiskBuffer(profile: RoomEconomicProfile): RoleDimensionScore {
  const score = clamp01(profile.riskBuffer / 1000);
  return { dimension: "riskBuffer", score, evidence: `riskBuffer=${Math.round(profile.riskBuffer)}` };
}

/** 效率评分：与帝国均值比较。 */
function scoreEfficiency(input: RoleEvaluationInput): RoleDimensionScore {
  const eff = input.profile.efficiency;
  const avg = input.empireAvgEfficiency || 0;
  // 高于均值 → 高分；低于均值 → 低分
  const score = avg > 0
    ? clamp01(0.5 + (eff - avg) / (2 * avg))
    : clamp01(eff);
  return { dimension: "efficiency", score, evidence: `eff=${eff.toFixed(2)} avg=${avg.toFixed(2)}` };
}

/** 产能评分：与帝国均值比较。 */
function scoreIncome(input: RoleEvaluationInput): RoleDimensionScore {
  const income = input.profile.estimatedIncome;
  const avg = input.empireAvgIncome || 0;
  // 高于均值 → 高分
  const score = avg > 0
    ? clamp01(0.5 + (income - avg) / (2 * avg))
    : clamp01(income / 20);
  return { dimension: "income", score, evidence: `income=${income.toFixed(1)} avg=${avg.toFixed(1)}` };
}

/** source 数评分：2 source = 1.0, 1 source = 0.5。 */
function scoreSourceCount(profile: RoomEconomicProfile): RoleDimensionScore {
  const score = profile.sourceCount >= 2 ? 1.0 : profile.sourceCount === 1 ? 0.5 : 0;
  return { dimension: "sourceCount", score, evidence: `sources=${profile.sourceCount}` };
}

/** 产能利用率评分：utilization 越接近 1.0 越好（但不超 0.9 — 满载 = 无余量）。 */
function scoreCapacityUtilization(capacity: RoomCapacityProfile): RoleDimensionScore {
  const util = capacity.utilization;
  // 0.5-0.8 为最佳区间（高效但不饱和）
  let score: number;
  if (util >= 0.5 && util <= 0.8) score = 1.0;
  else if (util > 0.8) score = 0.7; // 饱和——无扩展余量
  else if (util >= 0.3) score = 0.5;
  else score = 0.3;
  return { dimension: "capacityUtilization", score, evidence: `utilization=${util.toFixed(2)}` };
}

/** terminal 评分：有 terminal = 1.0, 无 = 0。 */
function scoreTerminal(input: RoleEvaluationInput): RoleDimensionScore {
  const score = input.hasTerminal ? 1.0 : 0;
  return { dimension: "terminal", score, evidence: `terminal=${input.hasTerminal}` };
}

/** 地理中心性评分：avgDistance 越低越好。 */
function scoreCentrality(input: RoleEvaluationInput): RoleDimensionScore {
  if (input.otherRoomCount === 0) {
    return { dimension: "centrality", score: 0, evidence: "no other rooms" };
  }
  // avgDistance 0-3 线性映射到 1.0-0.2
  const score = clamp01(Math.max(0.2, 1.0 - input.avgDistanceToOthers / 4));
  return {
    dimension: "centrality",
    score,
    evidence: `avgDist=${input.avgDistanceToOthers.toFixed(1)} others=${input.otherRoomCount}`,
  };
}

/** 连通性评分：otherRoomCount 越多 → SUPPORT 越有价值。 */
function scoreConnectivity(input: RoleEvaluationInput): RoleDimensionScore {
  const score = clamp01(input.otherRoomCount / 4); // 4+ 其他房 = 1.0
  return { dimension: "connectivity", score, evidence: `others=${input.otherRoomCount}` };
}

/** 活跃远矿数评分。 */
function scoreActiveOps(input: RoleEvaluationInput): RoleDimensionScore {
  const score = clamp01(input.activeRemoteOps / 3); // 3+ 远矿 = 1.0
  return { dimension: "activeOps", score, evidence: `ops=${input.activeRemoteOps}` };
}

/** 远矿净收益评分。 */
function scoreRemoteNetScore(input: RoleEvaluationInput): RoleDimensionScore {
  // netScore 0-30 e/tick 线性映射到 0-1.0
  const score = clamp01(input.remoteNetScore / 30);
  return { dimension: "netScore", score, evidence: `netScore=${input.remoteNetScore.toFixed(1)}` };
}

/** 远矿产出占比评分。 */
function scoreRemoteProductionRatio(input: RoleEvaluationInput): RoleDimensionScore {
  const score = clamp01(input.remoteProductionRatio);
  return { dimension: "productionRatio", score, evidence: `ratio=${input.remoteProductionRatio.toFixed(2)}` };
}

/** 远矿产能评分：有远矿时 storage 余量越大越好。 */
function scoreRemoteCapacity(profile: RoomEconomicProfile): RoleDimensionScore {
  if (!profile.hasStorage) {
    return { dimension: "capacity", score: 0, evidence: "no storage" };
  }
  // storageRatio 低于 0.8 = 有消化远矿产出的余量
  const score = profile.storageRatio < 0.8 ? 1.0 : 0.4;
  return { dimension: "capacity", score, evidence: `storageRatio=${profile.storageRatio.toFixed(2)}` };
}

// ─── 角色评分函数 ─────────────────────────────────────────

/**
 * 计算 CORE 角色评分。
 * 纯函数。
 */
function scoreCoreRole(input: RoleEvaluationInput): RoleScore {
  const dims: RoleDimensionScore[] = [
    scoreRcl(input.profile.rcl),
    scoreStorage(input.profile),
    scoreStability(input.profile),
    scoreNetFlow(input.profile),
    scoreRiskBuffer(input.profile),
  ];

  const weights = ROLE_WEIGHTS.core;
  const totalScore = dims.reduce(
    (sum, d) => sum + d.score * (weights[d.dimension] ?? 0),
    0,
  );

  const evidence = `CORE score=${totalScore.toFixed(2)} | ${dims.map(d => `${d.dimension}=${d.score.toFixed(2)}`).join(" ")}`;

  return {
    role: "core",
    totalScore: clamp01(totalScore),
    prerequisitesMet: true, // 已由 meetsPrerequisites 门控
    dimensions: dims,
    evidence,
  };
}

/**
 * 计算 PRODUCTION 角色评分。
 * 纯函数。
 */
function scoreProductionRole(input: RoleEvaluationInput): RoleScore {
  const dims: RoleDimensionScore[] = [
    scoreEfficiency(input),
    scoreIncome(input),
    scoreSourceCount(input.profile),
    scoreStability(input.profile),
    scoreCapacityUtilization(input.capacity),
  ];

  const weights = ROLE_WEIGHTS.production;
  const totalScore = dims.reduce(
    (sum, d) => sum + d.score * (weights[d.dimension] ?? 0),
    0,
  );

  const evidence = `PRODUCTION score=${totalScore.toFixed(2)} | ${dims.map(d => `${d.dimension}=${d.score.toFixed(2)}`).join(" ")}`;

  return {
    role: "production",
    totalScore: clamp01(totalScore),
    prerequisitesMet: true,
    dimensions: dims,
    evidence,
  };
}

/**
 * 计算 SUPPORT 角色评分。
 * 纯函数。
 */
function scoreSupportRole(input: RoleEvaluationInput): RoleScore {
  const dims: RoleDimensionScore[] = [
    scoreTerminal(input),
    scoreCentrality(input),
    scoreConnectivity(input),
    scoreStability(input.profile),
    scoreStorage(input.profile),
  ];

  const weights = ROLE_WEIGHTS.support;
  const totalScore = dims.reduce(
    (sum, d) => sum + d.score * (weights[d.dimension] ?? 0),
    0,
  );

  const evidence = `SUPPORT score=${totalScore.toFixed(2)} | ${dims.map(d => `${d.dimension}=${d.score.toFixed(2)}`).join(" ")}`;

  return {
    role: "support",
    totalScore: clamp01(totalScore),
    prerequisitesMet: true,
    dimensions: dims,
    evidence,
  };
}

/**
 * 计算 REMOTE 角色评分。
 * 纯函数。
 */
function scoreRemoteRole(input: RoleEvaluationInput): RoleScore {
  const dims: RoleDimensionScore[] = [
    scoreActiveOps(input),
    scoreRemoteNetScore(input),
    scoreRemoteProductionRatio(input),
    scoreStability(input.profile),
    scoreRemoteCapacity(input.profile),
  ];

  const weights = ROLE_WEIGHTS.remote;
  const totalScore = dims.reduce(
    (sum, d) => sum + d.score * (weights[d.dimension] ?? 0),
    0,
  );

  const evidence = `REMOTE score=${totalScore.toFixed(2)} | ${dims.map(d => `${d.dimension}=${d.score.toFixed(2)}`).join(" ")}`;

  return {
    role: "remote",
    totalScore: clamp01(totalScore),
    prerequisitesMet: true,
    dimensions: dims,
    evidence,
  };
}

// ─── 主函数 ───────────────────────────────────────────────

/**
 * 评估房间的 Empire Room Role。

 * 对四个角色分别计算评分，推荐分数最高且通过前置条件的角色。

 * 纯函数 — 不引用 Game/Memory。
 * 频率：每 100 tick（与 empire-economy 同频）。

 * @param input 房间特征输入
 * @param currentRole 当前角色（用于检测变更，可选）
 */
export function evaluateRoomRole(
  input: RoleEvaluationInput,
  currentRole?: EmpireRoomRole,
): RoleEvaluationResult {
  const { roomName, tick } = input;

  // 对每个角色：先检查前置条件，通过才计算评分
  const roles: EmpireRoomRole[] = ["core", "production", "support", "remote"];
  const scores: Record<EmpireRoomRole, RoleScore> = {} as Record<EmpireRoomRole, RoleScore>;

  for (const role of roles) {
    if (!meetsPrerequisites(role, input)) {
      scores[role] = {
        role,
        totalScore: 0,
        prerequisitesMet: false,
        dimensions: [],
        evidence: `${role.toUpperCase()} PREREQUISITES NOT MET`,
      };
      continue;
    }

    switch (role) {
      case "core": scores[role] = scoreCoreRole(input); break;
      case "production": scores[role] = scoreProductionRole(input); break;
      case "support": scores[role] = scoreSupportRole(input); break;
      case "remote": scores[role] = scoreRemoteRole(input); break;
    }
  }

  // 推荐角色 = 分数最高
  let recommendedRole: EmpireRoomRole = "core"; // 默认 fallback
  let recommendedScore = 0;
  for (const role of roles) {
    if (scores[role].totalScore > recommendedScore) {
      recommendedScore = scores[role].totalScore;
      recommendedRole = role;
    }
  }

  // 如果所有角色分数都为 0（前置条件全不满足），fallback 到 core
  // — 这是安全默认，表示「房间尚未准备好承担任何职能」
  if (recommendedScore === 0) {
    recommendedRole = "core";
    recommendedScore = 0;
  }

  const hasRoleChange = currentRole !== undefined && currentRole !== recommendedRole;

  const summary = [
    `RoleEval @${tick} ${roomName}`,
    `recommended=${recommendedRole}(${recommendedScore.toFixed(2)})`,
    `core=${scores.core.totalScore.toFixed(2)}`,
    `prod=${scores.production.totalScore.toFixed(2)}`,
    `supp=${scores.support.totalScore.toFixed(2)}`,
    `remote=${scores.remote.totalScore.toFixed(2)}`,
    hasRoleChange ? `CHANGE: ${currentRole}→${recommendedRole}` : "no change",
  ].join(" | ");

  return {
    roomName,
    tick,
    scores,
    recommendedRole,
    recommendedScore,
    hasRoleChange,
    summary,
  };
}
