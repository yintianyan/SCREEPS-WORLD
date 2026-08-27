/** Autonomy Metrics */

// ─── Autonomy Score ───────────────────────────────────────

/** Autonomy Score 输入。 */
export interface AutonomyScoreInput {
  // ── 经济闭环 ──
  /** 经济闭环是否运转（生产→消费→补充）。 */
  economicLoopActive: boolean;
  /** 生产→消费的闭环率（0..1，1 = 完全闭环）。 */
  economicLoopRate: number;

  // ── 失败恢复 ──
  /** 检测到的失败总数。 */
  totalFailuresDetected: number;
  /** 自动恢复的失败数。 */
  autoRecoveredFailures: number;
  /** 当前活跃失败数。 */
  activeFailures: number;

  // ── 人工干预 ──
  /** 最近 10000 tick 内的人工干预次数。 */
  manualInterventions: number;

  // ── 稳态维持 ──
  /** 连续稳态的 tick 数（EmpireHealth 未降级的连续时长）。 */
  consecutiveStableTicks: number;
  /** 上一次降级的 tick（undefined = 从未降级）。 */
  lastDegradedTick?: number;

  // ── 扰动恢复 ──
  /** 最近 10000 tick 内的扰动次数。 */
  perturbationCount: number;
  /** 最近 10000 tick 内的恢复总时间（tick）。 */
  totalRecoveryTime: number;

  // ── 通用 ──
  /** 当前 tick。 */
  tick: number;
  /** 帝国总房间数。 */
  roomCount: number;
}

/** Autonomy Score 结果。 */
export interface AutonomyScoreResult {
  /** 综合自治分数（0..100）。 */
  score: number;
  /** 自治等级。 */
  level: AutonomyLevel;
  /** 经济闭环得分（0..100）。 */
  economicLoopScore: number;
  /** 失败恢复得分（0..100）。 */
  failureRecoveryScore: number;
  /** 人工干预得分（0..100）。 */
  manualInterventionScore: number;
  /** 稳态维持得分（0..100）。 */
  stabilityScore: number;
  /** 扰动恢复得分（0..100）。 */
  perturbationRecoveryScore: number;
  /** 人类可读证据。 */
  evidence: string;
  /** 采样 tick。 */
  tick: number;
}

/** 自治等级。 */
export type AutonomyLevel = "full" | "high" | "moderate" | "low" | "none";

// ─── No-Progress 检测 ─────────────────────────────────────

/** No-Progress 检测输入。 */
export interface NoProgressInput {
  // ── 经济指标趋势 ──
  /** 最近 N tick 的净能量流序列（旧→新）。 */
  netFlowHistory: number[];
  /** 最近 N tick 的总储备序列。 */
  totalReserveHistory: number[];
  /** 最近 N tick 的总人口序列。 */
  populationHistory: number[];

  // ── 失败趋势 ──
  /** 最近 N tick 的活跃失败数序列。 */
  failureCountHistory: number[];

  // ── 通用 ──
  /** 当前 tick。 */
  tick: number;
  /** 检测窗口（tick）。 */
  window: number;
}

/** No-Progress 检测结果。 */
export interface NoProgressResult {
  /** 是否检测到 No-Progress。 */
  detected: boolean;
  /** 卡住的维度。 */
  stuckDimensions: string[];
  /** 持续时间（tick）。 */
  duration: number;
  /** 严重度（0..1）。 */
  severity: number;
  /** 人类可读证据。 */
  evidence: string;
}

// ─── Thrashing 检测 ───────────────────────────────────────

/** Thrashing 检测输入。 */
export interface ThrashingInput {
  // ── 健康度等级历史 ──
  /** 最近 N 次评估的 EmpireHealthLevel 序列（旧→新）。 */
  healthLevelHistory: string[];
  /** 最近 N 次评估的 tick 序列。 */
  healthLevelTicks: number[];

  // ── 姿态历史 ──
  /** 最近 N 次姿态变更序列。 */
  postureHistory: string[];
  /** 最近 N 次姿态变更的 tick 序列。 */
  postureTicks: number[];

  // ── 失败恢复循环 ──
  /** 最近 N tick 内同一失败领域的出现/恢复次数。 */
  failureDomainCycles: Record<string, number>;

  // ── 通用 ──
  /** 当前 tick。 */
  tick: number;
  /** 检测窗口（tick）。 */
  window: number;
}

/** Thrashing 检测结果。 */
export interface ThrashingResult {
  /** 是否检测到 Thrashing。 */
  detected: boolean;
  /** Thrashing 类型。 */
  type: "health_oscillation" | "posture_oscillation" | "failure_cycle" | "none";
  /** 振荡频率（次/1000 tick）。 */
  frequency: number;
  /** 严重度（0..1）。 */
  severity: number;
  /** 涉及的领域/维度。 */
  affectedAreas: string[];
  /** 人类可读证据。 */
  evidence: string;
}

// ─── Autonomy Score 计算 ──────────────────────────────────

/**
 * 计算 Autonomy Score（纯函数）。

 * 五维加权：
 *   - 经济闭环率（25%）：闭环运转 + 闭环率高 = 高分
 *   - 失败恢复率（25%）：自动恢复 / 检测到的失败
 *   - 人工干预（20%）：零干预 = 满分，每次干预扣分
 *   - 稳态维持（15%）：连续稳态时间长 = 高分
 *   - 扰动恢复（15%）：恢复快 = 高分

 * @param input 自治指标输入
 * @returns 自治分数结果
 */
export function computeAutonomyScore(input: AutonomyScoreInput): AutonomyScoreResult {
  // ── 1. 经济闭环得分 ──
  const economicLoopScore = input.economicLoopActive
    ? Math.round(input.economicLoopRate * 100)
    : 0;

  // ── 2. 失败恢复得分 ──
  const recoveryRate = input.totalFailuresDetected > 0
    ? input.autoRecoveredFailures / input.totalFailuresDetected
    : 1; // 无失败 = 满分
  // 活跃失败数惩罚
  const activePenalty = Math.min(30, input.activeFailures * 5);
  const failureRecoveryScore = Math.max(0, Math.round(recoveryRate * 100 - activePenalty));

  // ── 3. 人工干预得分 ──
  // 零干预 = 100，每次干预 -10（最低 0）
  const manualInterventionScore = Math.max(0, 100 - input.manualInterventions * 10);

  // ── 4. 稳态维持得分 ──
  // 10000 tick 稳态 = 满分
  const stabilityScore = Math.min(100, Math.round(
    (input.consecutiveStableTicks / 10000) * 100,
  ));

  // ── 5. 扰动恢复得分 ──
  let perturbationRecoveryScore: number;
  if (input.perturbationCount === 0) {
    // 无扰动 = 满分（但可能意味着没有挑战）
    perturbationRecoveryScore = 100;
  } else {
    // 平均恢复时间
    const avgRecoveryTime = input.totalRecoveryTime / input.perturbationCount;
    // 500 tick 恢复 = 满分，5000 tick = 0 分
    perturbationRecoveryScore = Math.max(0, Math.round(
      100 * (1 - (avgRecoveryTime - 500) / 4500),
    ));
  }

  // ── 加权汇总 ──
  const score = Math.round(
    economicLoopScore * 0.25 +
    failureRecoveryScore * 0.25 +
    manualInterventionScore * 0.20 +
    stabilityScore * 0.15 +
    perturbationRecoveryScore * 0.15,
  );

  // ── 等级映射 ──
  let level: AutonomyLevel;
  if (score >= 90) level = "full";
  else if (score >= 70) level = "high";
  else if (score >= 50) level = "moderate";
  else if (score >= 30) level = "low";
  else level = "none";

  // ── 证据链 ──
  const evidence = [
    `AutonomyScore @${input.tick}`,
    `score=${score} level=${level}`,
    `econLoop=${economicLoopScore} failRecovery=${failureRecoveryScore}`,
    `manual=${manualInterventionScore} stability=${stabilityScore}`,
    `perturbation=${perturbationRecoveryScore}`,
    `activeFailures=${input.activeFailures} recovered=${input.autoRecoveredFailures}/${input.totalFailuresDetected}`,
    `stableTicks=${input.consecutiveStableTicks} perturbations=${input.perturbationCount}`,
  ].join(" | ");

  return {
    score,
    level,
    economicLoopScore,
    failureRecoveryScore,
    manualInterventionScore,
    stabilityScore,
    perturbationRecoveryScore,
    evidence,
    tick: input.tick,
  };
}

// ─── No-Progress 检测 ─────────────────────────────────────

/**
 * 检测系统是否卡住（No-Progress）（纯函数）。

 * 判定逻辑：
 *   - 净能量流连续 N tick 无正增长 → economic_stall
 *   - 总储备连续 N tick 无增长 → reserve_stall
 *   - 总人口连续 N tick 无增长 → population_stall
 *   - 活跃失败数连续 N tick 不减少 → failure_persistent

 * @param input No-Progress 检测输入
 * @returns No-Progress 检测结果
 */
export function detectNoProgress(input: NoProgressInput): NoProgressResult {
  const stuckDimensions: string[] = [];
  let maxDuration = 0;

  // ── 1. 净能量流停滞 ──
  if (input.netFlowHistory.length >= input.window) {
    const recent = input.netFlowHistory.slice(-input.window);
    const hasImprovement = recent.some((v, i) => i > 0 && v > recent[i - 1]!);
    const allNegative = recent.every(v => v <= 0);
    if (!hasImprovement || allNegative) {
      stuckDimensions.push("net_flow");
      maxDuration = Math.max(maxDuration, input.window);
    }
  }

  // ── 2. 储备停滞 ──
  if (input.totalReserveHistory.length >= input.window) {
    const recent = input.totalReserveHistory.slice(-input.window);
    const first = recent[0] ?? 0;
    const last = recent[recent.length - 1] ?? 0;
    const growth = last - first;
    if (growth <= 0) {
      stuckDimensions.push("reserve");
      maxDuration = Math.max(maxDuration, input.window);
    }
  }

  // ── 3. 人口停滞 ──
  if (input.populationHistory.length >= input.window) {
    const recent = input.populationHistory.slice(-input.window);
    const first = recent[0] ?? 0;
    const last = recent[recent.length - 1] ?? 0;
    if (last <= first) {
      stuckDimensions.push("population");
      maxDuration = Math.max(maxDuration, input.window);
    }
  }

  // ── 4. 失败持续 ──
  if (input.failureCountHistory.length >= input.window) {
    const recent = input.failureCountHistory.slice(-input.window);
    const first = recent[0] ?? 0;
    const last = recent[recent.length - 1] ?? 0;
    if (last >= first && last > 0) {
      stuckDimensions.push("failures");
      maxDuration = Math.max(maxDuration, input.window);
    }
  }

  const detected = stuckDimensions.length > 0;
  const severity = detected
    ? Math.min(1, stuckDimensions.length * 0.25 + (maxDuration / input.window) * 0.25)
    : 0;

  const evidence = [
    `NoProgress @${input.tick}`,
    `detected=${detected}`,
    `stuck=${stuckDimensions.join(",") || "none"}`,
    `duration=${maxDuration}`,
    `severity=${severity.toFixed(2)}`,
  ].join(" | ");

  return {
    detected,
    stuckDimensions,
    duration: maxDuration,
    severity,
    evidence,
  };
}

// ─── Thrashing 检测 ───────────────────────────────────────

/**
 * 检测系统是否在振荡（Thrashing）（纯函数）。

 * 判定逻辑：
 *   - 健康度等级在窗口内跳动 ≥ 4 次 → health_oscillation
 *   - 姿态在窗口内切换 ≥ 3 次 → posture_oscillation
 *   - 同一失败领域在窗口内出现/恢复 ≥ 3 次 → failure_cycle

 * @param input Thrashing 检测输入
 * @returns Thrashing 检测结果
 */
export function detectThrashing(input: ThrashingInput): ThrashingResult {
  let detected = false;
  let type: ThrashingResult["type"] = "none";
  let frequency = 0;
  let severity = 0;
  const affectedAreas: string[] = [];

  // ── 1. 健康度振荡 ──
  if (input.healthLevelHistory.length >= 4) {
    let changes = 0;
    for (let i = 1; i < input.healthLevelHistory.length; i++) {
      if (input.healthLevelHistory[i] !== input.healthLevelHistory[i - 1]) {
        changes++;
      }
    }
    if (changes >= 4) {
      detected = true;
      type = "health_oscillation";
      frequency = (changes / input.window) * 1000;
      severity = Math.min(1, changes / 10);
      affectedAreas.push("health");
    }
  }

  // ── 2. 姿态振荡 ──
  if (input.postureHistory.length >= 3) {
    let changes = 0;
    for (let i = 1; i < input.postureHistory.length; i++) {
      if (input.postureHistory[i] !== input.postureHistory[i - 1]) {
        changes++;
      }
    }
    if (changes >= 3) {
      detected = true;
      if (type === "none") type = "posture_oscillation";
      frequency = Math.max(frequency, (changes / input.window) * 1000);
      severity = Math.max(severity, Math.min(1, changes / 8));
      affectedAreas.push("posture");
    }
  }

  // ── 3. 失败循环 ──
  let maxCycles = 0;
  let cyclingDomain = "";
  for (const [domain, cycles] of Object.entries(input.failureDomainCycles)) {
    if (cycles >= 3) {
      detected = true;
      if (type === "none") type = "failure_cycle";
      frequency = Math.max(frequency, (cycles / input.window) * 1000);
      severity = Math.max(severity, Math.min(1, cycles / 6));
      affectedAreas.push(domain);
      if (cycles > maxCycles) {
        maxCycles = cycles;
        cyclingDomain = domain;
      }
    }
  }

  if (!detected) {
    return {
      detected: false,
      type: "none",
      frequency: 0,
      severity: 0,
      affectedAreas: [],
      evidence: `Thrashing @${input.tick} | not detected`,
    };
  }

  const evidence = [
    `Thrashing @${input.tick}`,
    `detected=${detected}`,
    `type=${type}`,
    `frequency=${frequency.toFixed(1)}/1000t`,
    `severity=${severity.toFixed(2)}`,
    `areas=${affectedAreas.join(",")}`,
    cyclingDomain ? `worst=${cyclingDomain}(${maxCycles}cycles)` : "",
  ].filter(Boolean).join(" | ");

  return {
    detected,
    type,
    frequency,
    severity,
    affectedAreas,
    evidence,
  };
}

// ─── 综合自治状态 ──────────────────────────────────────────

/** 综合自治状态。 */
export interface AutonomyStatus {
  /** Autonomy Score。 */
  score: AutonomyScoreResult;
  /** No-Progress 检测结果。 */
  noProgress: NoProgressResult;
  /** Thrashing 检测结果。 */
  thrashing: ThrashingResult;
  /** 综合自治判定。 */
  autonomous: boolean;
  /** 人类可读摘要。 */
  summary: string;
}

/**
 * 综合判定帝国是否处于自治状态（纯函数）。

 * 自治 = Autonomy Score ≥ 50 + 无 No-Progress + 无 Thrashing

 * @param score Autonomy Score 结果
 * @param noProgress No-Progress 检测结果
 * @param thrashing Thrashing 检测结果
 * @returns 综合自治状态
 */
export function evaluateAutonomyStatus(
  score: AutonomyScoreResult,
  noProgress: NoProgressResult,
  thrashing: ThrashingResult,
): AutonomyStatus {
  const autonomous =
    score.score >= 50 &&
    !noProgress.detected &&
    !thrashing.detected;

  const summary = [
    `AutonomyStatus @${score.tick}`,
    `autonomous=${autonomous}`,
    `score=${score.score}(${score.level})`,
    noProgress.detected ? `NO_PROGRESS:${noProgress.stuckDimensions.join(",")}` : "progressing",
    thrashing.detected ? `THRASHING:${thrashing.type}` : "stable",
  ].join(" | ");

  return {
    score,
    noProgress,
    thrashing,
    autonomous,
    summary,
  };
}
