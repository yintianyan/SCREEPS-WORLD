/** Empire Health */

// ─── 类型定义 ──────────────────────────────────────────────

/** 帝国综合健康度等级。 */
export type EmpireHealthLevel = "healthy" | "stable" | "degraded" | "critical";

/** 单维度健康度等级（与 EmpireHealthLevel 对齐，供聚合用）。 */
export type DimensionHealth = "healthy" | "stable" | "degraded" | "critical";

/** 单维度评分结果。 */
export interface HealthDimensionScore {
  /** 维度名。 */
  name: string;
  /** 健康度等级。 */
  level: DimensionHealth;
  /** 0..1 分数（1 = 完全健康）。 */
  score: number;
  /** 人类可读证据。 */
  evidence: string;
}

/** Empire Health 评估输入。 */
export interface EmpireHealthInput {
  // ── 各维度输入 ──
  /** Energy 维度（从 EmpireEconomicHealth 映射）。 */
  energyHealth: DimensionHealth;
  /** Energy 分数（0..1）。 */
  energyScore: number;
  /** Minerals 维度（从 MultiResourceEmpireHealth 映射）。 */
  mineralHealth: DimensionHealth;
  /** Minerals 分数（0..1）。 */
  mineralScore: number;
  /** Logistics 维度（从 LogisticsHealthResult 映射）。 */
  logisticsHealth: DimensionHealth;
  /** Logistics 分数（0..1）。 */
  logisticsScore: number;
  /** Network 维度（从 NetworkHealthResult 映射）。 */
  networkHealth: DimensionHealth;
  /** Network 分数（0..1）。 */
  networkScore: number;
  /** Colony 维度（聚合各 Colony StabilityScore）。 */
  colonyHealth: DimensionHealth;
  /** Colony 分数（0..1）。 */
  colonyScore: number;
  /** Threat 维度。 */
  threatHealth: DimensionHealth;
  /** Threat 分数（0..1）。 */
  threatScore: number;
  /** Spawn 维度。 */
  spawnHealth: DimensionHealth;
  /** Spawn 分数（0..1）。 */
  spawnScore: number;
  /** CPU 维度。 */
  cpuHealth: DimensionHealth;
  /** CPU 分数（0..1）。 */
  cpuScore: number;

  // ── 滞回输入 ──
  /** 上一次评估的健康度等级（首次为 undefined）。 */
  prevLevel?: EmpireHealthLevel;
  /** 上一次评估的分数（首次为 undefined）。 */
  prevScore?: number;
  /** 当前 tick。 */
  tick: number;
}

/** Empire Health 评估结果。 */
export interface EmpireHealthResult {
  /** 综合健康度等级。 */
  level: EmpireHealthLevel;
  /** 综合分数（0..1）。 */
  score: number;
  /** 各维度评分。 */
  dimensions: HealthDimensionScore[];
  /** 最差维度名。 */
  worstDimension: string;
  /** 瓶颈维度名（限制帝国的最差维度）。 */
  bottleneck: string;
  /** 是否正在恢复中（从 degraded/critical 向上恢复）。 */
  recovering: boolean;
  /** 人类可读证据链。 */
  evidence: string;
  /** 采样 tick。 */
  tick: number;
}

// ─── 维度权重 ──────────────────────────────────────────────

/**
 * 各维度权重（总和 = 1.0）。

 * Energy 权重最高（0.25）——能量是帝国生命线。
 * Logistics 次之（0.18）——物流中断直接导致经济瘫痪。
 * Colony 权重 0.15——殖民失败影响扩张。
 * Network/CPU/Spawn 各 0.10——基础设施维度。
 * Mineral/Threat 各 0.06——辅助维度。
 */
const DIMENSION_WEIGHTS: Record<string, number> = {
  energy: 0.25,
  logistics: 0.18,
  colony: 0.15,
  network: 0.10,
  cpu: 0.10,
  spawn: 0.10,
  mineral: 0.06,
  threat: 0.06,
};

// ─── Hysteresis 阈值 ──────────────────────────────────────

/**
 * Hysteresis 阈值（0..1 分数）。

 * 进入 DEGRADED：< 0.70（分数低于 70% → 降级）
 * 恢复到 STABLE：> 0.80（分数高于 80% → 升级）
 * 进入 CRITICAL：< 0.40（分数低于 40% → 降级）
 * 恢复到 DEGRADED：> 0.55（分数高于 55% → 升级）
 * 进入 HEALTHY：> 0.90（分数高于 90% → 升级）
 * 降级到 STABLE：< 0.85（分数低于 85% → 降级）
 */
const HYSTERESIS = {
  enterDegraded: 0.70,
  recoverToStable: 0.80,
  enterCritical: 0.40,
  recoverToDegraded: 0.55,
  enterHealthy: 0.90,
  downgradeFromHealthy: 0.85,
} as const;

// ─── 健康度等级排序 ────────────────────────────────────────

const HEALTH_RANK: Record<DimensionHealth, number> = {
  healthy: 4,
  stable: 3,
  degraded: 2,
  critical: 1,
};

const RANK_TO_HEALTH: Record<number, DimensionHealth> = {
  4: "healthy",
  3: "stable",
  2: "degraded",
  1: "critical",
};

// ─── 评估函数 ──────────────────────────────────────────────

/**
 * 评估帝国综合健康度（纯函数）。

 * 逻辑：
 *   1. 各维度已有等级和分数，加权汇总得到综合分数。
 *   2. 综合等级 = 最差维度的等级（短板效应）。
 *   3. 但如果加权分数远高于最差维度，用分数修正（防一个维度拖垮全局）。
 *   4. 应用 Hysteresis：进入降级立即生效，恢复需超过恢复阈值。

 * @param input 各维度健康度 + 滞回输入
 * @returns 综合健康度结果
 */
export function evaluateEmpireHealth(input: EmpireHealthInput): EmpireHealthResult {
  // ── 1. 构建维度评分列表 ──
  const dimensions: HealthDimensionScore[] = [
    { name: "energy", level: input.energyHealth, score: input.energyScore, evidence: `score=${input.energyScore.toFixed(2)}` },
    { name: "mineral", level: input.mineralHealth, score: input.mineralScore, evidence: `score=${input.mineralScore.toFixed(2)}` },
    { name: "logistics", level: input.logisticsHealth, score: input.logisticsScore, evidence: `score=${input.logisticsScore.toFixed(2)}` },
    { name: "network", level: input.networkHealth, score: input.networkScore, evidence: `score=${input.networkScore.toFixed(2)}` },
    { name: "colony", level: input.colonyHealth, score: input.colonyScore, evidence: `score=${input.colonyScore.toFixed(2)}` },
    { name: "threat", level: input.threatHealth, score: input.threatScore, evidence: `score=${input.threatScore.toFixed(2)}` },
    { name: "spawn", level: input.spawnHealth, score: input.spawnScore, evidence: `score=${input.spawnScore.toFixed(2)}` },
    { name: "cpu", level: input.cpuHealth, score: input.cpuScore, evidence: `score=${input.cpuScore.toFixed(2)}` },
  ];

  // ── 2. 加权汇总分数 ──
  let weightedScore = 0;
  for (const dim of dimensions) {
    const weight = DIMENSION_WEIGHTS[dim.name] ?? 0;
    weightedScore += dim.score * weight;
  }

  // ── 3. 找最差维度（短板效应）──
  let worstRank = Infinity;
  let worstDim = "";
  for (const dim of dimensions) {
    const rank = HEALTH_RANK[dim.level];
    if (rank < worstRank) {
      worstRank = rank;
      worstDim = dim.name;
    }
  }

  // ── 4. 综合等级：用分数 + 最差维度共同决定 ──
  // 如果最差维度是 critical 但加权分数还行，降级为 degraded（防一个维度拖垮全局）。
  // 但如果 ≥ 2 个维度是 critical，直接 critical。
  const criticalCount = dimensions.filter(d => d.level === "critical").length;
  const degradedCount = dimensions.filter(d => d.level === "degraded" || d.level === "critical").length;

  let rawLevel: EmpireHealthLevel;
  if (criticalCount >= 2 || weightedScore < 0.30) {
    rawLevel = "critical";
  } else if (worstRank <= HEALTH_RANK.degraded && weightedScore < HYSTERESIS.enterDegraded) {
    rawLevel = "degraded";
  } else if (worstRank <= HEALTH_RANK.stable || weightedScore < HYSTERESIS.recoverToStable) {
    rawLevel = "stable";
  } else if (weightedScore >= HYSTERESIS.enterHealthy && worstRank >= HEALTH_RANK.stable) {
    rawLevel = "healthy";
  } else {
    rawLevel = "stable";
  }

  // ── 5. Hysteresis：与上次等级比较 ──
  const prevLevel = input.prevLevel;
  const finalLevel = applyHysteresis(prevLevel, rawLevel, weightedScore);

  // ── 6. 恢复中标记 ──
  const recovering =
    (prevLevel === "critical" && finalLevel !== "critical") ||
    (prevLevel === "degraded" && (finalLevel === "stable" || finalLevel === "healthy"));

  // ── 7. 瓶颈维度：权重最高且非 healthy 的维度 ──
  let bottleneck = worstDim;
  let maxWeightedImpact = 0;
  for (const dim of dimensions) {
    if (dim.level === "healthy") continue;
    const weight = DIMENSION_WEIGHTS[dim.name] ?? 0;
    const impact = weight * (1 - dim.score);
    if (impact > maxWeightedImpact) {
      maxWeightedImpact = impact;
      bottleneck = dim.name;
    }
  }

  // ── 8. 证据链 ──
  const dimSummary = dimensions
    .map(d => `${d.name}=${d.level}(${d.score.toFixed(2)})`)
    .join(", ");
  const evidence = [
    `EmpireHealth @${input.tick}`,
    `level=${finalLevel} score=${weightedScore.toFixed(3)}`,
    `prev=${prevLevel ?? "(none)"}`,
    `worst=${worstDim} bottleneck=${bottleneck}`,
    `critical=${criticalCount} degraded=${degradedCount}`,
    recovering ? "RECOVERING" : "stable",
    `dims: ${dimSummary}`,
  ].join(" | ");

  return {
    level: finalLevel,
    score: weightedScore,
    dimensions,
    worstDimension: worstDim,
    bottleneck,
    recovering,
    evidence,
    tick: input.tick,
  };
}

// ─── Hysteresis 辅助 ──────────────────────────────────────

/**
 * 应用滞回逻辑：降级立即生效，恢复需超过恢复阈值。

 * 规则：
 *   - 降级（healthy→stable→degraded→critical）：立即生效，不需要阈值确认。
 *   - 升级（critical→degraded→stable→healthy）：需分数超过恢复阈值。
 *   - 同等级不变：保持。

 * @param prevLevel 上一次等级（undefined = 首次评估）
 * @param rawLevel 本次原始评估等级
 * @param score 本次加权分数
 * @returns 滞回后的最终等级
 */
function applyHysteresis(
  prevLevel: EmpireHealthLevel | undefined,
  rawLevel: EmpireHealthLevel,
  score: number,
): EmpireHealthLevel {
  // 首次评估：直接使用原始等级
  if (prevLevel === undefined) return rawLevel;

  // 降级：立即生效
  if (HEALTH_RANK[rawLevel] < HEALTH_RANK[prevLevel]) {
    return rawLevel;
  }

  // 升级：需要超过恢复阈值
  if (HEALTH_RANK[rawLevel] > HEALTH_RANK[prevLevel]) {
    switch (prevLevel) {
      case "critical":
        // critical → degraded: score > recoverToDegraded (0.55)
        if (score > HYSTERESIS.recoverToDegraded) return "degraded";
        return "critical";
      case "degraded":
        // degraded → stable: score > recoverToStable (0.80)
        if (score > HYSTERESIS.recoverToStable) return "stable";
        return "degraded";
      case "stable":
        // stable → healthy: score > enterHealthy (0.90)
        if (score > HYSTERESIS.enterHealthy) return "healthy";
        return "stable";
      default:
        return rawLevel;
    }
  }

  // 同等级：保持
  return prevLevel;
}

// ─── 维度映射辅助 ──────────────────────────────────────────

/**
 * 从 EconomicHealthResult 映射到 DimensionHealth。

 * EconomicHealth 的五档 → DimensionHealth 的四档：
 *   critical → critical
 *   deficit → degraded
 *   stable → stable
 *   growing → healthy
 *   healthy → healthy
 */
export function mapEconomicHealth(health: string): DimensionHealth {
  switch (health) {
    case "critical": return "critical";
    case "deficit": return "degraded";
    case "stable": return "stable";
    case "growing":
    case "healthy":
      return "healthy";
    default:
      return "stable";
  }
}

/**
 * 从 ResourceHealthStatus 映射到 DimensionHealth。

 * Mineral 维度的四档 → DimensionHealth 的四档：
 *   critical → critical
 *   deficit → degraded
 *   surplus → stable
 *   balanced → healthy
 */
export function mapResourceHealth(health: string): DimensionHealth {
  switch (health) {
    case "critical": return "critical";
    case "deficit": return "degraded";
    case "surplus": return "stable";
    case "balanced":
    case "healthy":
      return "healthy";
    default:
      return "stable";
  }
}

/**
 * 从 LogisticsHealthResult 的 level 字段映射到 DimensionHealth。
 */
export function mapLogisticsHealth(level: string): DimensionHealth {
  switch (level) {
    case "critical": return "critical";
    case "degraded": return "degraded";
    case "stable": return "stable";
    case "healthy":
      return "healthy";
    default:
      return "stable";
  }
}

/**
 * 从 NetworkHealthResult 的 level 字段映射到 DimensionHealth。
 */
export function mapNetworkHealth(level: string): DimensionHealth {
  switch (level) {
    case "critical": return "critical";
    case "degraded": return "degraded";
    case "stable": return "stable";
    case "healthy":
      return "healthy";
    default:
      return "stable";
  }
}

/**
 * 从 Colony StabilityScore 的 level 字段映射到 DimensionHealth。

 * Colony 的四档 → DimensionHealth 的四档：
 *   CRITICAL → critical
 *   DEGRADED → degraded
 *   GOOD → stable
 *   EXCELLENT → healthy
 */
export function mapColonyHealth(level: string): DimensionHealth {
  switch (level) {
    case "CRITICAL": return "critical";
    case "DEGRADED": return "degraded";
    case "GOOD": return "stable";
    case "EXCELLENT":
      return "healthy";
    default:
      return "degraded";
  }
}

/**
 * 从 EmpirePosture 映射到 Threat 维度的 DimensionHealth。

 * 姿态 → 威胁健康度：
 *   war → critical（战争状态 = 最高威胁）
 *   fortify → degraded（设防 = 有威胁记忆）
 *   develop → stable（正常发展）
 *   expand → healthy（扩张 = 零威胁 + 经济健康）
 */
export function mapThreatHealth(posture: string): DimensionHealth {
  switch (posture) {
    case "war": return "critical";
    case "fortify": return "degraded";
    case "develop": return "stable";
    case "expand":
      return "healthy";
    default:
      return "stable";
  }
}

/**
 * 从 CpuTier 映射到 CPU 维度的 DimensionHealth。

 * Bucket 四档 → CPU 健康度：
 *   recovery → critical
 *   conserve → degraded
 *   guarded → stable
 *   healthy → healthy
 */
export function mapCpuHealth(tier: string): DimensionHealth {
  switch (tier) {
    case "recovery": return "critical";
    case "conserve": return "degraded";
    case "guarded": return "stable";
    case "healthy":
      return "healthy";
    default:
      return "stable";
  }
}

/**
 * 从 Spawn 状态映射到 Spawn 维度的 DimensionHealth。

 * @param spawnAvailable 是否有可用 spawn
 * @param spawnStarvationCount 最近 spawn 饥饿次数
 */
export function mapSpawnHealth(spawnAvailable: boolean, spawnStarvationCount: number): DimensionHealth {
  if (!spawnAvailable) return "critical";
  if (spawnStarvationCount >= 10) return "critical";
  if (spawnStarvationCount >= 3) return "degraded";
  if (spawnStarvationCount >= 1) return "stable";
  return "healthy";
}

/**
 * 从 DimensionHealth 映射到 0..1 分数。

 * healthy → 1.0
 * stable → 0.75
 * degraded → 0.5
 * critical → 0.1
 */
export function dimensionScore(level: DimensionHealth): number {
  switch (level) {
    case "healthy": return 1.0;
    case "stable": return 0.75;
    case "degraded": return 0.5;
    case "critical": return 0.1;
    default: return 0.5;
  }
}