/**
 * Expansion Cooldown & Rate Limit — A3.4：防止扩张级联。
 *
 * 合同锚点：A3.4 Task Spec §24 Cascade Prevention + §25 Rate Limit。
 *
 * 两个机制：
 *   1. Cooldown — 一次扩张 COMPLETED 后，在冷却窗口内不启动新扩张。
 *   2. Rate Limit — 单位时间内的活跃扩张数量上限（默认 1）。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

/** Cooldown 配置。 */
export interface CooldownConfig {
  /** 扩张完成后到下一次允许扩张的冷却 tick 数。 */
  cooldownTicks: number;
  /** 同时允许的活跃扩张数量上限。 */
  maxConcurrentExpansions: number;
}

/** 默认配置。 */
export const DEFAULT_COOLDOWN_CONFIG: CooldownConfig = {
  cooldownTicks: 10000,
  maxConcurrentExpansions: 1,
};

/** Cooldown 评估输入。 */
export interface CooldownInput {
  /** 上一次扩张完成的 tick（undefined = 从未完成过扩张）。 */
  lastCompletedTick?: number;
  /** 当前活跃扩张数量。 */
  activeExpansionCount: number;
  /** 当前 tick。 */
  currentTick: number;
  /** 配置。 */
  config?: CooldownConfig;
}

/** Cooldown 评估结果。 */
export interface CooldownResult {
  /** 是否允许新扩张。 */
  allowed: boolean;
  /** 被阻止的原因。 */
  blockedReason: string | null;
  /** 冷却剩余 tick（0 = 已过冷却）。 */
  remainingCooldown: number;
  /** 当前活跃扩张数。 */
  activeCount: number;
  /** 最大允许活跃扩张数。 */
  maxConcurrent: number;
  /** 人类可读证据。 */
  evidence: string;
}

/**
 * 评估是否允许启动新扩张（纯函数）。
 *
 * 阻止条件：
 *   1. 在冷却窗口内（lastCompletedTick + cooldownTicks > currentTick）
 *   2. 活跃扩张数已达上限
 */
export function evaluateExpansionCooldown(input: CooldownInput): CooldownResult {
  const config = input.config ?? DEFAULT_COOLDOWN_CONFIG;

  // 检查并发上限
  if (input.activeExpansionCount >= config.maxConcurrentExpansions) {
    return {
      allowed: false,
      blockedReason: "rate_limit",
      remainingCooldown: 0,
      activeCount: input.activeExpansionCount,
      maxConcurrent: config.maxConcurrentExpansions,
      evidence: `Cooldown @${input.currentTick}: blocked by rate_limit (active=${input.activeExpansionCount}/${config.maxConcurrentExpansions})`,
    };
  }

  // 检查冷却窗口
  if (input.lastCompletedTick !== undefined) {
    const elapsed = input.currentTick - input.lastCompletedTick;
    const remaining = Math.max(0, config.cooldownTicks - elapsed);
    if (remaining > 0) {
      return {
        allowed: false,
        blockedReason: "cooldown",
        remainingCooldown: remaining,
        activeCount: input.activeExpansionCount,
        maxConcurrent: config.maxConcurrentExpansions,
        evidence: `Cooldown @${input.currentTick}: blocked by cooldown (remaining=${remaining}t, lastCompleted=${input.lastCompletedTick})`,
      };
    }
  }

  return {
    allowed: true,
    blockedReason: null,
    remainingCooldown: 0,
    activeCount: input.activeExpansionCount,
    maxConcurrent: config.maxConcurrentExpansions,
    evidence: `Cooldown @${input.currentTick}: allowed (active=${input.activeExpansionCount}/${config.maxConcurrentExpansions}, cooldown=passed)`,
  };
}
