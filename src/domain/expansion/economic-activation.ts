/** Economic Activation */

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
  /** Spawn 是否在役（本房自有 spawn）。注意：**不要**写成"bay 此刻空闲"——
   *  幼房赶工期 bay 几乎连轴，而本判据的消费方每 100 拍才采样一次，
   *  那样会在房子最活跃的时候把经济环判成不活跃。 */
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
 * 累计「连续净流为正」的**拍数**。
 *
 * 单位必须是拍而不是评估次数：expansion-manager 每 CONFIG.expansion.interval(=100) 拍才走一次
 * 这里。按次数 +1 的话，`SELF_SUSTAINING_TICKS = 500` 实际要求 500 次**连续**为正的采样
 * = 50,000 拍不间断，而 integrating 的预算只有 pioneerTimeout×3 = 60,000 拍 —— 中间任何一次
 * 采样落到孵化/施工的能量谷值就清零重算 ⇒ 自然完成路径（`activated` → `canHandover`）
 * 按构造几乎走不到，扩张只能靠 6 万拍后的超时强推收成 COMPLETED_FORCED。
 */
export function advancePositiveStreak(
  prev: number,
  elapsedTicks: number,
  netFlowPositive: boolean,
): number {
  if (!netFlowPositive) return 0;
  return prev + Math.max(0, elapsedTicks);
}

/** carrier 单趟往返的有效搬运率近似（energy/tick）。 */
const CARRIER_FLOW_PER_LINE = 50;

/**
 * 外部输血率（energy/tick）—— 只算**持续的跨房搬运**。
 *
 * 这里曾经还有一项「幼房 worker/builder 的当前背包能量 × 25/t」，量纲是错的：
 * 背包里此刻有多少能量是**存量**，且那份能量是本房自己采集的，与"是否还在被 sponsor 喂"
 * 没有因果关系（写它的注释自己就承认是"一次性，不持续"）。它的量级 ≈7 只先锋 ⇒ 175/t，
 * 比幼房整房流量（账本 `ws` 实测 +3.35/t）大两个数量级，于是 `selfSustaining` 在
 * 幼房有施工队的整个期间恒假 —— CP5 的自然路径（→ COMPLETED）按构造走不到。
 * 只有 carrier 线路（home=sponsor、remoteTarget=本房）才是真正的持续外部流。
 */
export function externalInflowPerTick(carrierLineCount: number): number {
  return Math.max(0, carrierLineCount) * CARRIER_FLOW_PER_LINE;
}

/**
 * 评估经济激活状态（纯函数）。

 * 激活条件（三段全满足）：
 *   1. Energy Loop Active: hasHarvester && hasTransporter && spawnActive
 *   2. Net Energy Positive: netFlow > 0（连续 SELF_SUSTAINING_TICKS）
 *   3. Self-Sustaining: externalEnergyInflow === 0 且净流仍为正
 */
export function evaluateEconomicActivation(
  input: EconomicActivationInput,
): EconomicActivationResult {
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
