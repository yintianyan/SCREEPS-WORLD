import type { ColonyState } from "../../kernel/contracts";

/**
 * 殖民相位（Colony Phase）—— 每房经济状态的唯一权威来源。
 *
 * 设计意图：替代散落各处的经济判断（crisis.ts / computeColonyState / 局部阈值），
 * 每 tick 每房计算一个统一的殖民相位，映射为 ColonyState 供所有系统消费。
 *
 * 核心信号：总储备趋势（reserveDelta = 收入 − 支出）。持续入不敷出 = crisis。
 * 这比「source 是否满」可靠——<5W harvester 下 source 再生(10/tick)快于采集，source 常满，
 * 不能当失败信号；而总储备只在采集(+)与孵化/建造/升级/维修(−)时变化，其趋势直接反映经济盈亏。
 */

export type ColonyPhase = "bootstrap" | "growth" | "crisis" | "recovery" | "steady";

/** 单次评估的输入信号（由 room-observer 从快照 + creep 统计得出）。 */
export interface PhaseInput {
  /** 总储备 = energyAvailable + 所有 container + storage 的能量。 */
  reserve: number;
  /** 立即可用于孵化的能量（spawn+extension），用于观测记录。 */
  spendable: number;
  /** harvester + worker 数量。 */
  harvesterCount: number;
  sourceCount: number;
  rcl: number;
}

/** 跨 tick 持久化的相位状态（存入 room memory）。 */
export interface PhaseState {
  phase: ColonyPhase;
  /** 上次观测的总储备，用于算 reserveDelta；首次观测为 undefined。 */
  prevReserve?: number;
  /** 0..100 的「赤字分数」，持续入不敷出时累加，用于迟滞。 */
  drainScore: number;
}

/** evaluateColonyPhase 的返回值：新状态 + 本次观测信号（供记录/调参）。 */
export interface PhaseResult extends PhaseState {
  reserveDelta: number;
}

export interface PhaseOptions {
  /** 赤字分数达到此值进入 crisis。 */
  drainEnterScore: number;
  /** 赤字分数降到此值退出 crisis（进入 recovery）。 */
  drainExitScore: number;
  /** recovery 降到此值彻底脱离（进入 growth/bootstrap/steady）。 */
  recoveryClearScore: number;
  /** 赤字时每次评估的分数增加量（进入 crisis 的步长）。 */
  scoreStep: number;
  /** 盈余时每次评估的分数减少量（退出 crisis 的步长，P0-2）。
   * 默认大于 scoreStep，使恢复比下降更快，打破临界振荡。 */
  recoveryStep: number;
}

export const DEFAULT_PHASE_OPTIONS: PhaseOptions = {
  drainEnterScore: 100,
  drainExitScore: 40,
  recoveryClearScore: 10,
  scoreStep: 20,
  recoveryStep: 30,
};

/**
 * 计算殖民相位（纯函数，带迟滞）。
 *
 * 相位优先级：
 *   crisis（赤字分数高）> recovery（脱离中）> steady（RCL8 且满员）> bootstrap（harvester 不足）> growth。
 * crisis/recovery 之间用赤字分数迟滞，避免在临界点抖动。
 */
export function evaluateColonyPhase(
  input: PhaseInput,
  prev: PhaseState,
  options: PhaseOptions = DEFAULT_PHASE_OPTIONS,
): PhaseResult {
  // 首次观测无基线，reserveDelta 记 0（不判为赤字）。
  const reserveDelta = prev.prevReserve === undefined ? 0 : input.reserve - prev.prevReserve;

  const draining = reserveDelta < 0;
  // P0-2：非对称步长 — 盈余时用 recoveryStep（> scoreStep）加速退出，打破临界振荡。
  const delta = draining ? options.scoreStep : -options.recoveryStep;
  const drainScore = Math.max(0, Math.min(options.drainEnterScore, prev.drainScore + delta));

  const understaffed = input.harvesterCount < Math.max(1, input.sourceCount);
  const inCrisisBand = prev.phase === "crisis" || prev.phase === "recovery";

  let phase: ColonyPhase;
  if (drainScore >= options.drainEnterScore) {
    phase = "crisis";
  } else if (inCrisisBand && drainScore >= options.drainExitScore) {
    phase = "crisis";
  } else if (inCrisisBand && drainScore > options.recoveryClearScore) {
    phase = "recovery";
  } else if (input.rcl >= 8 && !understaffed) {
    phase = "steady";
  } else if (understaffed) {
    phase = "bootstrap";
  } else {
    phase = "growth";
  }

  return { phase, prevReserve: input.reserve, drainScore, reserveDelta };
}

/**
 * 将殖民相位映射为 ColonyState（plan §5.4 统一状态）。
 *
 * 映射规则：
 *   defense       ← 有敌对单位（优先级最高）
 *   bootstrap     ← phase bootstrap（采集者不足）
 *   recovery      ← phase crisis 或 recovery（经济赤字或恢复中）
 *   normal        ← phase growth 或 steady（健康运行）
 *
 * 纯函数 — 不访问 Game/Memory，接收显式参数。
 */
export function phaseToColonyState(
  phase: ColonyPhase,
  hasHostiles: boolean,
): ColonyState {
  if (hasHostiles) return "defense";
  if (phase === "bootstrap") return "bootstrap";
  if (phase === "crisis" || phase === "recovery") return "recovery";
  return "normal";
}
