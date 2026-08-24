/**
 * Autonomy Age — A3.4：Colony 自治年龄追踪。
 *
 * 合同锚点：A3.4 Task Spec §28 Autonomy Age。
 *
 * 定义：Economic Activation（CP5 通过）之后连续运行的 ticks 数。
 * 用于判断 Colony 是否真正稳定——500 tick 只是最低门槛，
 * 1k/5k/10k 里程碑衡量长期稳定性。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

/** 自治年龄里程碑。 */
export const AUTONOMY_MILESTONES = {
  /** Economic Activation 刚通过 — 最低门槛。 */
  ACTIVATED: 0,
  /** 1,000 tick 稳定 — 初步稳定。 */
  STABLE_1K: 1000,
  /** 5,000 tick 稳定 — 中期稳定。 */
  STABLE_5K: 5000,
  /** 10,000 tick 稳定 — 长期稳定。 */
  STABLE_10K: 10000,
} as const;

/** 自治年龄等级。 */
export type AutonomyLevel = "new" | "emerging" | "stable" | "mature";

/** Autonomy Age 输入。 */
export interface AutonomyAgeInput {
  /** Economic Activation 通过的 tick。 */
  activatedAtTick: number;
  /** 当前 tick。 */
  currentTick: number;
  /** 连续净流为正的 tick 数（来自 expansion state）。 */
  consecutivePositiveTicks: number;
  /** 是否有中断（如 netFlow 曾经转负）。 */
  hadInterruption: boolean;
}

/** Autonomy Age 结果。 */
export interface AutonomyAgeResult {
  /** 自治年龄（ticks）。 */
  age: number;
  /** 自治等级。 */
  level: AutonomyLevel;
  /** 是否达到 1k 里程碑。 */
  reached1k: boolean;
  /** 是否达到 5k 里程碑。 */
  reached5k: boolean;
  /** 是否达到 10k 里程碑。 */
  reached10k: boolean;
  /** 下一个里程碑。 */
  nextMilestone: number | null;
  /** 距下一个里程碑还差多少 tick。 */
  ticksToNextMilestone: number;
  /** 是否被中断过。 */
  interrupted: boolean;
  /** 人类可读证据。 */
  evidence: string;
}

/**
 * 计算 Colony 的自治年龄（纯函数）。
 *
 * 年龄 = currentTick - activatedAtTick（仅在无中断时）。
 * 如果有过中断（netFlow 转负），年龄从最近一次恢复点重新计算。
 */
export function evaluateAutonomyAge(input: AutonomyAgeInput): AutonomyAgeResult {
  const age = Math.max(0, input.currentTick - input.activatedAtTick);
  const interrupted = input.hadInterruption;

  const reached1k = age >= AUTONOMY_MILESTONES.STABLE_1K;
  const reached5k = age >= AUTONOMY_MILESTONES.STABLE_5K;
  const reached10k = age >= AUTONOMY_MILESTONES.STABLE_10K;

  // 等级判定
  let level: AutonomyLevel;
  if (age >= AUTONOMY_MILESTONES.STABLE_10K) {
    level = "mature";
  } else if (age >= AUTONOMY_MILESTONES.STABLE_5K) {
    level = "stable";
  } else if (age >= AUTONOMY_MILESTONES.STABLE_1K) {
    level = "emerging";
  } else {
    level = "new";
  }

  // 下一里程碑
  let nextMilestone: number | null;
  if (!reached1k) {
    nextMilestone = AUTONOMY_MILESTONES.STABLE_1K;
  } else if (!reached5k) {
    nextMilestone = AUTONOMY_MILESTONES.STABLE_5K;
  } else if (!reached10k) {
    nextMilestone = AUTONOMY_MILESTONES.STABLE_10K;
  } else {
    nextMilestone = null;
  }

  const ticksToNextMilestone = nextMilestone !== null
    ? Math.max(0, nextMilestone - age)
    : 0;

  const evidence = [
    `AutonomyAge @${input.currentTick}`,
    `age=${age}`,
    `level=${level}`,
    `consecutivePositive=${input.consecutivePositiveTicks}`,
    interrupted ? "INTERRUPTED" : "continuous",
    nextMilestone !== null
      ? `nextMilestone=${nextMilestone} in ${ticksToNextMilestone}t`
      : "all milestones reached",
  ].join(" | ");

  return {
    age,
    level,
    reached1k,
    reached5k,
    reached10k,
    nextMilestone,
    ticksToNextMilestone,
    interrupted,
    evidence,
  };
}
