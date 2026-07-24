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
  /**
   * 可达能量占比 = spendable / energyCapacity（0..1）。
   * 流动性维度核心信号：spawn 口袋里能花的钱占总容量的比例。
   * 低值（< liquiditySpendableRatio）= spawn 实际破产，即使总储备很高。
   */
  spendableRatio: number;
  /**
   * 冻结能量占比 = 最满 container 的填充率（0..1）。
   * 高值（> liquidityFrozenRatio）= 能量积压在 container 里搬不走。
   * 与低 spendableRatio 同时出现 = 「富得流油却花不出去」的流动性陷阱
   * （W37S58 实测：spendableRatio≈5%，frozenRatio≈94%，0 hauler → 永久死锁）。
   */
  frozenRatio: number;
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
  /** 0..100 的「赤字分数」（偿付能力维度），持续入不敷出时累加，用于迟滞。 */
  drainScore: number;
  /**
   * 0..100 的「流动性分数」（流动性维度），持续流动性陷阱时累加，用于迟滞。
   * 流动性陷阱 = spendableRatio 低（spawn 破产）且 frozenRatio 高（能量冻在 container）。
   * 与 drainScore 独立：W37S58 的 drainScore=0（总储备还在涨）但 liquidityScore 爆表。
   */
  liquidityScore: number;
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
  /**
   * 流动性陷阱阈值：spendableRatio 低于此值视为 spawn 破产（可达能量不足）。
   * W37S58 实测 spendableRatio≈5%；健康房间物流正常时 hauler 持续补 spawn，远高于此。
   */
  liquiditySpendableRatio: number;
  /**
   * 流动性陷阱阈值：frozenRatio 高于此值视为能量积压在 container（搬不走）。
   * 与低 spendableRatio 同时成立才判定陷阱——单独 container 满是正常物流中转，不是危机。
   */
  liquidityFrozenRatio: number;
  /** 流动性陷阱时每次评估的分数增加量。 */
  liquidityStep: number;
  /** 流动性恢复时每次评估的分数减少量（> liquidityStep，非对称迟滞防振荡）。 */
  liquidityRecoveryStep: number;
}

export const DEFAULT_PHASE_OPTIONS: PhaseOptions = {
  drainEnterScore: 100,
  drainExitScore: 40,
  recoveryClearScore: 10,
  scoreStep: 20,
  recoveryStep: 30,
  liquiditySpendableRatio: 0.3,
  liquidityFrozenRatio: 0.6,
  liquidityStep: 25,
  liquidityRecoveryStep: 30,
};

/**
 * 计算殖民相位（纯函数，带迟滞）。
 *
 * 双维度危机模型（方案 C）：
 *   - 偿付能力维度 drainScore：总储备趋势（reserveDelta < 0 持续）→ 生产崩溃。
 *   - 流动性维度 liquidityScore：spendableRatio 低且 frozenRatio 高持续 → 物流死锁
 *     （能量冻在 container，spawn 破产，W37S58 根因）。
 *   crisisScore = max(drainScore, liquidityScore)，任一维度爆表即危机。
 *   这修复了旧模型「只量总财富不量流动性」的失明：W37S58 总储备在涨（drainScore=0）
 *   但 94% 能量冻在 container、spawn 只有 5% 可达，旧模型判为 growth，永久死锁。
 *
 * 相位优先级：
 *   crisis（crisisScore 高）> recovery（脱离中）> steady（RCL8 且满员）> bootstrap（harvester 不足）> growth。
 * crisis/recovery 之间用 crisisScore 迟滞，避免在临界点抖动。
 */
export function evaluateColonyPhase(
  input: PhaseInput,
  prev: PhaseState,
  options: PhaseOptions = DEFAULT_PHASE_OPTIONS,
): PhaseResult {
  // 首次观测无基线，reserveDelta 记 0（不判为赤字）。
  const reserveDelta = prev.prevReserve === undefined ? 0 : input.reserve - prev.prevReserve;

  // ── 偿付能力维度：drainScore ──
  const draining = reserveDelta < 0;
  // P0-2：非对称步长 — 盈余时用 recoveryStep（> scoreStep）加速退出，打破临界振荡。
  const delta = draining ? options.scoreStep : -options.recoveryStep;
  const drainScore = Math.max(0, Math.min(options.drainEnterScore, prev.drainScore + delta));

  // ── 流动性维度：liquidityScore ──
  // 流动性陷阱 = spawn 破产（可达能量占比低）且能量积压（最满 container 填充率高）。
  // 两者必须同时成立：单独 container 满是正常物流中转（hauler 正在搬），不是危机；
  // 单独 spawn 空是孵化脉冲消耗（马上被 hauler 补回），也不是危机。
  // 只有「container 满 + spawn 空」持续存在 = 搬运能力不足/缺失 = 真死锁。
  const liquidityTrap =
    input.spendableRatio < options.liquiditySpendableRatio &&
    input.frozenRatio > options.liquidityFrozenRatio;
  const liquidityDelta = liquidityTrap ? options.liquidityStep : -options.liquidityRecoveryStep;
  const prevLiquidity = prev.liquidityScore ?? 0;
  const liquidityScore = Math.max(0, Math.min(options.drainEnterScore, prevLiquidity + liquidityDelta));

  // ── 合并双维度：任一爆表即危机 ──
  const crisisScore = Math.max(drainScore, liquidityScore);

  const understaffed = input.harvesterCount < Math.max(1, input.sourceCount);
  const inCrisisBand = prev.phase === "crisis" || prev.phase === "recovery";

  let phase: ColonyPhase;
  if (crisisScore >= options.drainEnterScore) {
    phase = "crisis";
  } else if (inCrisisBand && crisisScore >= options.drainExitScore) {
    phase = "crisis";
  } else if (inCrisisBand && crisisScore > options.recoveryClearScore) {
    phase = "recovery";
  } else if (input.rcl >= 8 && !understaffed) {
    phase = "steady";
  } else if (understaffed) {
    phase = "bootstrap";
  } else {
    phase = "growth";
  }

  return { phase, prevReserve: input.reserve, drainScore, liquidityScore, reserveDelta };
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
