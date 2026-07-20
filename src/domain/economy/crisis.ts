import type { RoomSnapshot } from "../../kernel/contracts";

/**
 * 能量危机检测。
 *
 * colonyState/budget tier 仅基于 CPU bucket，无法感知能量塌方。本模块提供一个独立的、
 * 带迟滞的能量危机信号，供 spawn/construction/assignment 在危机时收缩 discretionary 消耗、
 * 优先保住经济引擎 harvester，避免「弱 harvester→低能量→孵不起好 harvester」的死亡螺旋。
 */

export interface CrisisOptions {
  /** source 能量高于此比例视为采集不足（harvester 失效）。 */
  sourceFullRatio: number;
  /** energyAvailable 低于 capacity×此比例视为储备低。 */
  energyThresholdRatio: number;
  /** 储备阈值的固定上限（避免高 RCL 大容量下阈值过高）。 */
  energyThresholdCap: number;
  /** 危机分数达到此值进入危机。 */
  enterScore: number;
  /** 危机分数降到此值退出危机（< enterScore 形成迟滞）。 */
  exitScore: number;
  /** 每次评估的分数变化量。 */
  scoreStep: number;
}

export const DEFAULT_CRISIS_OPTIONS: CrisisOptions = {
  sourceFullRatio: 0.85,
  energyThresholdRatio: 0.4,
  energyThresholdCap: 400,
  enterScore: 100,
  exitScore: 40,
  scoreStep: 10,
};

export interface CrisisState {
  crisisScore: number;
  energyCrisis: boolean;
}

/**
 * 评估能量危机状态（纯函数，带迟滞）。
 *
 * 触发信号：所有 source 普遍接近满（harvester 采集不足）且能量储备低。
 * 有效采矿时 source 会被抽到低位，故「source 持续高满 + 储备低」= harvester 失效。
 *
 * 迟滞：危机分数满足条件 +scoreStep、不满足 -scoreStep（夹在 0..enterScore），
 * 达到 enterScore 进入危机，降到 exitScore 退出，避免在临界点反复抖动。
 */
export function evaluateEnergyCrisis(
  snapshot: RoomSnapshot,
  prev: CrisisState,
  options: CrisisOptions = DEFAULT_CRISIS_OPTIONS,
): CrisisState {
  const sourcesFull =
    snapshot.sources.length > 0 &&
    snapshot.sources.every(
      s => s.energyCapacity > 0 && s.energy / s.energyCapacity >= options.sourceFullRatio,
    );

  const energyThreshold = Math.min(
    Math.floor(snapshot.energyCapacityAvailable * options.energyThresholdRatio),
    options.energyThresholdCap,
  );
  const lowEnergy = snapshot.energyAvailable < energyThreshold;

  const crisisCondition = sourcesFull && lowEnergy;
  const delta = crisisCondition ? options.scoreStep : -options.scoreStep;
  const crisisScore = Math.max(0, Math.min(options.enterScore, prev.crisisScore + delta));

  let energyCrisis = prev.energyCrisis;
  if (!energyCrisis && crisisScore >= options.enterScore) energyCrisis = true;
  else if (energyCrisis && crisisScore <= options.exitScore) energyCrisis = false;

  return { crisisScore, energyCrisis };
}
