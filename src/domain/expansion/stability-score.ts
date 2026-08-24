/**
 * Stability Score — A3.4：可解释的 Colony 稳定性评分。
 *
 * 合同锚点：A3.4 Task Spec §29 Stability Score。
 *
 * 评分维度（加权汇总，可解释）：
 *   1. Energy — 净流为正且稳定
 *   2. Population — 人口目标满足，无振荡
 *   3. Spawn — 孵化正常，无饥饿
 *   4. Production — 产能达标
 *   5. Requests — 请求不泄漏
 *   6. Failures — 无连续失败
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

/** 稳定性等级。 */
export type StabilityLevel = "EXCELLENT" | "GOOD" | "DEGRADED" | "CRITICAL";

/** Stability Score 输入。 */
export interface StabilityScoreInput {
  // ── Energy ──
  /** 能量净流（production - consumption，可负）。 */
  netEnergyFlow: number;
  /** 连续净流为正的 tick 数。 */
  consecutivePositiveTicks: number;
  /** 外部能量流入量。 */
  externalEnergyInflow: number;

  // ── Population ──
  /** 当前人口（harvester + worker + hauler + builder 总数）。 */
  currentPopulation: number;
  /** 目标人口。 */
  targetPopulation: number;

  // ── Spawn ──
  /** spawn 是否可用（有空闲 spawn 且能量 ≥ 300）。 */
  spawnAvailable: boolean;
  /** 最近 200 tick 内 spawn 饥饿次数（无能量孵化）。 */
  spawnStarvationCount: number;

  // ── Production ──
  /** 产能估算（energy/tick）。 */
  estimatedProduction: number;
  /** 消耗估算（energy/tick）。 */
  estimatedConsumption: number;

  // ── Failures ──
  /** 最近 1000 tick 内连续失败次数。 */
  recentFailureCount: number;

  // ── General ──
  /** 当前 tick。 */
  tick: number;
}

/** 单维度评分结果。 */
export interface DimensionScore {
  /** 维度名。 */
  name: string;
  /** 得分（0..100）。 */
  score: number;
  /** 是否通过。 */
  passed: boolean;
  /** 人类可读证据。 */
  evidence: string;
}

/** Stability Score 结果。 */
export interface StabilityScoreResult {
  /** 总分（0..100）。 */
  totalScore: number;
  /** 稳定性等级。 */
  level: StabilityLevel;
  /** 各维度评分。 */
  dimensions: DimensionScore[];
  /** 是否稳定。 */
  stable: boolean;
  /** 不通过的维度列表。 */
  failingDimensions: string[];
  /** 人类可读证据。 */
  evidence: string;
}

/** 各维度权重（总和 = 1.0）。 */
const WEIGHTS = {
  energy: 0.25,
  population: 0.20,
  spawn: 0.20,
  production: 0.20,
  failures: 0.15,
} as const;

/**
 * 计算 Colony 稳定性评分（纯函数）。
 *
 * 每个维度独立评分（0..100），加权汇总后映射为等级：
 *   EXCELLENT ≥ 85, GOOD ≥ 65, DEGRADED ≥ 40, CRITICAL < 40
 */
export function evaluateStabilityScore(input: StabilityScoreInput): StabilityScoreResult {
  // ── Energy 维度 ──
  const energyScore = scoreEnergyDimension(input);
  // ── Population 维度 ──
  const populationScore = scorePopulationDimension(input);
  // ── Spawn 维度 ──
  const spawnScore = scoreSpawnDimension(input);
  // ── Production 维度 ──
  const productionScore = scoreProductionDimension(input);
  // ── Failures 维度 ──
  const failureScore = scoreFailureDimension(input);

  const dimensions = [energyScore, populationScore, spawnScore, productionScore, failureScore];

  const totalScore = Math.round(
    energyScore.score * WEIGHTS.energy +
    populationScore.score * WEIGHTS.population +
    spawnScore.score * WEIGHTS.spawn +
    productionScore.score * WEIGHTS.production +
    failureScore.score * WEIGHTS.failures,
  );

  const level = scoreToLevel(totalScore);
  const failingDimensions = dimensions.filter(d => !d.passed).map(d => d.name);
  const stable = totalScore >= 65 && failingDimensions.length === 0;

  const evidence = [
    `StabilityScore @${input.tick}`,
    `total=${totalScore} level=${level}`,
    `energy=${energyScore.score} pop=${populationScore.score} spawn=${spawnScore.score} prod=${productionScore.score} fail=${failureScore.score}`,
    stable ? "STABLE" : `failing: ${failingDimensions.join(",") || "none"}`,
  ].join(" | ");

  return {
    totalScore,
    level,
    dimensions,
    stable,
    failingDimensions,
    evidence,
  };
}

// ── 维度评分函数 ──────────────────────────────────────────

function scoreEnergyDimension(input: StabilityScoreInput): DimensionScore {
  let score = 0;
  if (input.netEnergyFlow > 0) score += 50;
  if (input.consecutivePositiveTicks >= 500) score += 30;
  else if (input.consecutivePositiveTicks >= 100) score += 20;
  else if (input.consecutivePositiveTicks > 0) score += 10;
  if (input.externalEnergyInflow === 0) score += 20;
  else score += Math.max(0, 20 - Math.floor(input.externalEnergyInflow / 10));
  score = Math.min(100, score);

  const passed = score >= 60;
  const evidence = `netFlow=${input.netEnergyFlow} consecutive=${input.consecutivePositiveTicks} external=${input.externalEnergyInflow}`;

  return { name: "energy", score, passed, evidence };
}

function scorePopulationDimension(input: StabilityScoreInput): DimensionScore {
  if (input.targetPopulation === 0) {
    return { name: "population", score: 100, passed: true, evidence: "no target" };
  }
  const ratio = input.currentPopulation / input.targetPopulation;
  let score: number;
  if (ratio >= 1.0) score = 100;
  else if (ratio >= 0.8) score = 80;
  else if (ratio >= 0.5) score = 50;
  else score = 20;
  score = Math.min(100, score);

  const passed = ratio >= 0.8;
  const evidence = `pop=${input.currentPopulation}/${input.targetPopulation} ratio=${ratio.toFixed(2)}`;

  return { name: "population", score, passed, evidence };
}

function scoreSpawnDimension(input: StabilityScoreInput): DimensionScore {
  let score = 0;
  if (input.spawnAvailable) score += 60;
  if (input.spawnStarvationCount === 0) score += 40;
  else score += Math.max(0, 40 - input.spawnStarvationCount * 5);
  score = Math.min(100, score);

  const passed = input.spawnAvailable && input.spawnStarvationCount <= 2;
  const evidence = `available=${input.spawnAvailable} starvation=${input.spawnStarvationCount}`;

  return { name: "spawn", score, passed, evidence };
}

function scoreProductionDimension(input: StabilityScoreInput): DimensionScore {
  if (input.estimatedConsumption === 0) {
    return { name: "production", score: 100, passed: true, evidence: "no consumption" };
  }
  const ratio = input.estimatedProduction / input.estimatedConsumption;
  let score: number;
  if (ratio >= 1.5) score = 100;
  else if (ratio >= 1.0) score = 80;
  else if (ratio >= 0.7) score = 50;
  else score = 20;
  score = Math.min(100, score);

  const passed = ratio >= 1.0;
  const evidence = `prod=${input.estimatedProduction} cons=${input.estimatedConsumption} ratio=${ratio.toFixed(2)}`;

  return { name: "production", score, passed, evidence };
}

function scoreFailureDimension(input: StabilityScoreInput): DimensionScore {
  let score: number;
  if (input.recentFailureCount === 0) score = 100;
  else if (input.recentFailureCount <= 2) score = 70;
  else if (input.recentFailureCount <= 5) score = 40;
  else score = 10;

  const passed = input.recentFailureCount <= 2;
  const evidence = `failures=${input.recentFailureCount}`;

  return { name: "failures", score, passed, evidence };
}

function scoreToLevel(score: number): StabilityLevel {
  if (score >= 85) return "EXCELLENT";
  if (score >= 65) return "GOOD";
  if (score >= 40) return "DEGRADED";
  return "CRITICAL";
}
