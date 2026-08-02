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
  /**
   * 最满 source 的填充率 (0..1)。> srcRatioTrap 持续 = source 满载但采不动。
   *
   * P0-1 信号（病灶 1）：双维度（drainScore/liquidityScore）在 spawn 口袋健康时
   * 看不到采集塌方 — harvester body 退化导致单体采集能力塌方，但 source 持续
   * 满载（3000/3000）、spendableRatio > 0.5（hauler 持续补 spawn），drainScore
   * 走主动消费豁免路径不计赤字。srcRatio + storageDrainRate 双条件强制 crisis
   * 通道绕过迟滞，专治这一失明路径。NaN（source 数据缺失）按 0 处理（保守不触发）。
   */
  srcRatio: number;
  /**
   * Storage 单 tick 净流出（E，负值=流失）。无 storage 时为 0。
   *
   * 作为 storageDrainAccum 的累积源（P0-1 修正后）：
   * srcRatio>0.9 期间每 tick 流失量累加到 storageDrainAccum，回填抵消。
   * 旧的单 tick drainRate<-2 持续判定已被累积量判定替代 — 实测 storage
   * 流失是稀疏大脉冲，单 tick 差分大部分=0 无法持续触发。
   */
  storageDrainRate: number;
  /**
   * P2-3：Storage 水位（0..1，usedCapacity/capacity）。无 storage 时为 undefined。
   *
   * 满仓豁免指标：forceCrisis 通道在 storage 高水位（> forceCrisisStorageHigh）时
   * 不触发 — 满仓时 storage 流失是正常消费（upgrader 取能），不是采集失败。
   * 避免"满仓 → crisis → upgrader 冻结 → link 死锁"的正反馈循环。
   */
  storageRatio?: number;
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
  /**
   * 危机带（crisis/recovery）内已持续的评估次数 — 最短驻留时间用。
   * 进带时从 1 起计，出带归 0。旧 Memory 无此字段时按 0 处理（v14 迁移回填）。
   */
  bandTicks?: number;
  /**
   * srcRatio > srcRatioTrap + storageDrainAccum > storageDrainAccumThreshold
   * 持续成立的评估次数（P0-1）。任一条件不再满足时立即归零（防残留累积）。
   * 达 srcStallEnterTicks 后强制 crisis，绕过 drainScore 迟滞。
   */
  srcStallTicks?: number;
  /**
   * P0-1：srcRatio>0.9 期间 storage 的累积净流失量（E，正值=累积失血）。
   * 流失累加、回填抵消（max(0) 不为负）；srcRatio≤0.9 时归零。
   * 替代旧的单 tick drainRate<-2 判定 — 实测 storage 流失是稀疏大脉冲
   * （每~235tick一次-800，大部分tick静止），单 tick 差分大部分=0，
   * srcStallTicks 反复归零无法累积。累积量能捕获间歇性失血。
   */
  storageDrainAccum?: number;
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
  /**
   * 偿付赤字计分门槛：仅当 spendableRatio 低于此值时，储备下降才累加 drainScore。
   * spawn 口袋健康（extension 基本满员）时的储备下降是升级/建造的主动投资，
   * 不是生产崩溃 — 把两者同等计为赤字正是 TD-003 极限环的根因之一：
   * normal 恢复支出 → 记赤字 → 入 recovery → 收缩支出 → 记盈余 → 秒退 → 循环。
   * 真正的生产崩溃（采集断档）最终必然拖垮 spawn 口袋，届时计分照常启动；
   * 采集者直接死绝的场景由 understaffed → bootstrap 兜底，不依赖本分数。
   */
  drainSpendableFloor: number;
  /**
   * 危机带最短驻留评估次数：进入 crisis/recovery 后至少停留此久才能回 normal。
   * 打破极限环的第二道闸：recovery 收缩支出后分数快速清零（recoveryStep=40，
   * 最快 4 次评估从 150 → 0），若立即回 normal 则支出立刻恢复、赤字重新累积。
   * 驻留窗口强制殖民地在 recovery 中攒出能量缓冲，回 normal 后有垫层可烧。
   * 副作用：真危机的恢复期至少 minBandTicks tick — 这是刻意的保守取舍。
   * 同时它保证 crisis 退出必经 recovery 带，不再出现 30→0 直切 normal。
   */
  minBandTicks: number;
  /**
   * P0-1：srcRatio 强制 crisis 通道的填充率阈值。
   * srcRatio > 此值视为 source 满载（采不动）。默认 0.9 — 略低于 1.0
   * 给 harvester 通勤周期留余量，避免 source 短暂回血造成抖动。
   */
  srcRatioTrap: number;
  /**
   * P0-1：srcRatio 满载 + storage 流失双条件持续多少次评估后强制 crisis。
   * 默认 50 tick — 私服快照显示失明路径持续 31000 tick，50 tick 内可观测到
   * 真实失血而不误伤正常通勤/孵化脉冲（正常 source 满载不会持续 50 tick）。
   */
  srcStallEnterTicks: number;
  /**
   * P0-1：storage 累积净流失触发阈值（E）。
   * srcRatio>0.9 期间 storageDrainAccum 超过此值视为采集已塌方、储备单向流失。
   * 默认 1000 — 实测 crisis 房每~235tick一次-800 脉冲，1.2 次即达阈值；
   * 正常房 srcRatio 不持续>0.9，accum 归零不误触发。
   */
  storageDrainAccumThreshold: number;
  /**
   * P2-3：forceCrisis 满仓豁免阈值（0..1）。storageRatio 超过此值时 forceCrisis 不触发。
   * 满仓时 storage 流失是正常消费（upgrader 取能），不是采集失败。
   * 0.8 = storage 80% 以上不触发 forceCrisis。
   */
  forceCrisisStorageHigh: number;
}

export const DEFAULT_PHASE_OPTIONS: PhaseOptions = {
  // 迟滞带加宽：进入 crisis 需 150 分（10 tick @step15），退出需降到 30（4 tick @step40）。
  // 旧值 100/40 在 ec=300 时 4 tick 即触发，导致 phase 在 growth↔crisis 间高频振荡。
  drainEnterScore: 150,
  drainExitScore: 30,
  recoveryClearScore: 5,
  // 非对称步长：进入慢（15/tick），退出快（40/tick）——交替场景下净 -25/tick，快速脱困。
  scoreStep: 15,
  recoveryStep: 40,
  // 流动性陷阱收紧：ec=300 时 spendableRatio<0.3 太容易触发（spawn 空=常态）。
  // 0.15 → ec=300 时需 spendable<45 才触发；0.8 → container 80%+ 才算积压。
  liquiditySpendableRatio: 0.15,
  liquidityFrozenRatio: 0.8,
  // 非对称步长：陷阱累积慢（15/tick），恢复快（50/tick）——交替场景下净 -35/tick。
  liquidityStep: 15,
  liquidityRecoveryStep: 50,
  // 主动消费豁免：spendableRatio ≥ 0.5（spawn 口袋过半）时储备下降不计赤字。
  // 0.5 给 spawn 补能延迟留余量：孵化脉冲后 hauler 回填需数 tick，健康房常态在 0.5 以上。
  drainSpendableFloor: 0.5,
  // 最短驻留 100 次评估（room-state 每 tick 评估 → 100 tick）：
  // 覆盖一轮 creep 孵化 + 通勤周期，让 recovery 期真正攒出缓冲，而非形式性过场。
  minBandTicks: 100,
  // P0-1：srcRatio 强制 crisis 通道阈值（病灶 1 — 采集塌方失明）。
  // 私服快照显示 srcRatio=1.0 + storage 流失 12 E/tick 持续 31000 tick 仍判 normal。
  srcRatioTrap: 0.9,
  srcStallEnterTicks: 50,
  storageDrainAccumThreshold: 1000,
  // P2-3：满仓豁免 — storage 80% 以上时 forceCrisis 不触发。
  // 满仓时 storage 流失是正常消费（upgrader 取能），不是采集失败。
  forceCrisisStorageHigh: 0.8,
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

  // ── P0-1：srcRatio 强制 crisis 通道（病灶 1 — 采集塌方失明）──
  // 累积净流失判定：srcRatio>0.9 期间累积 storage 流失量，超阈值视为采集塌方。
  // 替代旧的单 tick drainRate<-2 判定 — 实测 storage 流失是稀疏大脉冲
  // （每~235tick一次-800，大部分tick静止），单 tick 差分大部分=0，
  // srcStallTicks 反复归零永远到不了 50。累积量能捕获间歇性失血。
  // 流失累加、回填抵消（max(0) 不为负）；srcRatio≤0.9 时归零（采集正常）。
  // NaN（source 数据缺失）> 0.9 为 false → 保守按 0 处理不触发。
  const srcRatioHigh = input.srcRatio > options.srcRatioTrap;
  const drainAccumDelta = -input.storageDrainRate; // 流失为正（storageDrainRate 负=流失）
  const storageDrainAccum = srcRatioHigh
    ? Math.max(0, (prev.storageDrainAccum ?? 0) + drainAccumDelta)
    : 0;
  // P2-3：满仓豁免 — storage 高水位时流失是正常消费，不是采集失败。
  // 避免"满仓 → crisis → upgrader 冻结 → link 死锁"的正反馈循环。
  const storageHigh = (input.storageRatio ?? 0) > options.forceCrisisStorageHigh;
  const srcStalled = srcRatioHigh
    && storageDrainAccum > options.storageDrainAccumThreshold
    && !storageHigh;
  // 任一条件不再满足时立即归零，防残留累积导致误触发。
  const newStallTicks = srcStalled ? (prev.srcStallTicks ?? 0) + 1 : 0;
  const forceCrisis = newStallTicks >= options.srcStallEnterTicks;

  // ── 偿付能力维度：drainScore ──
  // 主动消费豁免（TD-003 根因 A）：spawn 口袋健康时的储备下降是升级/建造投资，
  // 只有「储备下降 且 可孵化能量吃紧」才视为生产端失血。
  const draining = reserveDelta < 0 && input.spendableRatio < options.drainSpendableFloor;
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
  // 危机带驻留计数（TD-003 根因 B）：带内每次评估 +1，用于最短驻留判定。
  const bandTicksSoFar = inCrisisBand ? (prev.bandTicks ?? 0) : 0;
  const dwellSatisfied = bandTicksSoFar >= options.minBandTicks;

  // P0-1：强制 crisis 通道优先（绕过迟滞），但只覆盖 phase 字段 —
  // 保留 drainScore/liquidityScore 既有计算，让迟滞分数按真实信号自然演化。
  // 这样 srcRatio 通道恢复时（forceCrisis=false），若 drainScore 仍未清会自然过渡到
  // crisis/recovery，若已清则走 recovery 带（dwellSatisfied 兜底），不会秒退 normal。
  if (forceCrisis) {
    return {
      phase: "crisis",
      prevReserve: input.reserve,
      drainScore,
      liquidityScore,
      bandTicks: bandTicksSoFar + 1,
      reserveDelta,
      srcStallTicks: newStallTicks,
      storageDrainAccum,
    };
  }

  let phase: ColonyPhase;
  if (crisisScore >= options.drainEnterScore) {
    phase = "crisis";
  } else if (inCrisisBand && crisisScore >= options.drainExitScore) {
    phase = "crisis";
  } else if (inCrisisBand && (crisisScore > options.recoveryClearScore || !dwellSatisfied)) {
    // 分数已清但驻留未满 → 停在 recovery 攒缓冲，防止秒退回 normal 后
    // 支出立刻恢复、赤字重新累积的极限环；同时兜住 recoveryStep 过大
    // 导致分数从迟滞带直接跳 0、crisis 直切 normal 的路径。
    phase = "recovery";
  } else if (input.rcl >= 8 && !understaffed) {
    phase = "steady";
  } else if (understaffed) {
    phase = "bootstrap";
  } else {
    phase = "growth";
  }

  const stillInBand = phase === "crisis" || phase === "recovery";
  const bandTicks = stillInBand ? bandTicksSoFar + 1 : 0;

  return { phase, prevReserve: input.reserve, drainScore, liquidityScore, bandTicks, reserveDelta, srcStallTicks: newStallTicks, storageDrainAccum };
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
