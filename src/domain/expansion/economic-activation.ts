/**
 * Economic Activation — A3.3 Phase 1：经济激活判据。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §3 执行闭环 +
 * A3.3 Task Spec Economic Activation 判据。
 *
 * 核心使命：定义「扩张完成」的判据——不是 claimController 成功，
 * 而是新房间经济指标达标且自主运行。
 *
 * 三段判据：
 *   1. Energy Loop Active   — Harvest → Transport → Spawn 环路运转
 *   2. Net Energy Positive   — 能量净流为正（生产 > 消耗）
 *   3. Self-Sustaining       — 连续 N tick 自主运行（无需外部输血）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

/** 经济激活评估输入。 */
export interface EconomicActivationInput {
  /** 新房间的能量生产（harvest 总量/tick）。 */
  energyProduction: number;
  /** 新房间的能量消耗（spawn + build + repair）。 */
  energyConsumption: number;
  /** 外部输血量（从 sponsor 房运来的能量）。 */
  externalEnergyInflow: number;
  /** 连续净流为正的 tick 数。 */
  consecutivePositiveTicks: number;
  /** 是否有活跃 harvester。 */
  hasHarvester: boolean;
  /** 是否有活跃 transporter。 */
  hasTransporter: boolean;
  /** 是否有活跃 upgrader（可选，非必需）。 */
  hasUpgrader: boolean;
  /** Spawn 是否正在孵化（说明在自产自销）。 */
  spawnActive: boolean;
  /** 当前 tick。 */
  tick: number;
}

/** 经济激活评估结果。 */
export interface EconomicActivationResult {
  /** 是否已激活。 */
  activated: boolean;
  /** 能量净流（生产 - 消耗）。 */
  netFlow: number;
  /** 是否自给自足（无外部输血）。 */
  selfSustaining: boolean;
  /** 能量环路是否活跃。 */
  energyLoopActive: boolean;
  /** 连续净流为正的 tick 数。 */
  consecutivePositiveTicks: number;
  /** 还需多少 tick 才能激活。 */
  ticksToActivation: number;
  /** 激活判据详情。 */
  criteria: {
    energyLoop: { passed: boolean; evidence: string };
    netPositive: { passed: boolean; evidence: string };
    selfSustaining: { passed: boolean; evidence: string };
  };
  /** 人类可读证据。 */
  evidence: string;
  /** 激活进度百分比。 */
  progress: number;
}

/** 自主运行所需连续净流为正的 tick 数。 */
const SELF_SUSTAINING_TICKS = 500;

/**
 * 评估经济激活状态（纯函数）。
 *
 * 激活条件（三段全满足）：
 *   1. Energy Loop Active: hasHarvester && hasTransporter && spawnActive
 *   2. Net Energy Positive: netFlow > 0（连续 SELF_SUSTAINING_TICKS）
 *   3. Self-Sustaining: externalEnergyInflow === 0 且净流仍为正
 */
export function evaluateEconomicActivation(input: EconomicActivationInput): EconomicActivationResult {
  const netFlow = input.energyProduction - input.energyConsumption;
  const energyLoopActive = input.hasHarvester && input.hasTransporter && input.spawnActive;
  const netPositive = netFlow > 0;
  const selfSustaining = input.externalEnergyInflow === 0 && netPositive;

  const criteria = {
    energyLoop: {
      passed: energyLoopActive,
      evidence: `harvester=${input.hasHarvester} transporter=${input.hasTransporter} spawn=${input.spawnActive}`,
    },
    netPositive: {
      passed: netPositive,
      evidence: `production=${input.energyProduction} consumption=${input.energyConsumption} net=${netFlow}`,
    },
    selfSustaining: {
      passed: selfSustaining,
      evidence: `externalInflow=${input.externalEnergyInflow} (need 0 for self-sustaining)`,
    },
  };

  const allCriteriaPassed = energyLoopActive && netPositive && selfSustaining;
  const activated = allCriteriaPassed && input.consecutivePositiveTicks >= SELF_SUSTAINING_TICKS;

  const ticksToActivation = activated
    ? 0
    : Math.max(0, SELF_SUSTAINING_TICKS - input.consecutivePositiveTicks);

  // 进度计算
  let progress = 0;
  if (energyLoopActive) progress += 20;
  if (netPositive) progress += 30;
  if (selfSustaining) progress += 20;
  progress += Math.min(30, (input.consecutivePositiveTicks / SELF_SUSTAINING_TICKS) * 30);

  const evidence = [
    `EconomicActivation @${input.tick}`,
    `netFlow=${netFlow.toFixed(1)}/tick`,
    `energyLoop=${energyLoopActive ? "ACTIVE" : "INACTIVE"}`,
    `selfSustaining=${selfSustaining}`,
    `consecutivePositive=${input.consecutivePositiveTicks}/${SELF_SUSTAINING_TICKS}`,
    activated ? "ACTIVATED" : `ticksToActivation=${ticksToActivation}`,
  ].join(" | ");

  return {
    activated,
    netFlow,
    selfSustaining,
    energyLoopActive,
    consecutivePositiveTicks: input.consecutivePositiveTicks,
    ticksToActivation,
    criteria,
    evidence,
    progress: Math.round(progress),
  };
}

/**
 * 检查是否需要外部输血。
 *
 * 当 netFlow < 0 或 externalEnergyInflow > 0 时，房间仍需要外部支持。
 */
export function needsExternalSupport(input: EconomicActivationInput): boolean {
  const netFlow = input.energyProduction - input.energyConsumption;
  return netFlow < 0 || input.externalEnergyInflow > 0;
}

/**
 * 计算所需的外部输血量（如果需要）。
 */
export function calculateRequiredSupport(input: EconomicActivationInput): number {
  const netFlow = input.energyProduction - input.energyConsumption;
  if (netFlow >= 0) return 0;
  // 需要覆盖缺口 + 一点缓冲
  return Math.abs(netFlow) + 50;
}
