import type { ColonyState } from "../../kernel/contracts";
import { CONFIG } from "../../config";

/**
 * 殖民相位（Colony Phase）— 每房经济状态的唯一权威来源，替代散落各处的
 * 经济判断（crisis.ts / computeColonyState / 局部阈值），每 tick 每房算一个
 * 统一相位映射为 ColonyState 供所有系统消费。核心信号是总储备趋势
 * （reserveDelta = 收入 − 支出）：<5W harvester 下 source 再生(10/tick)快于采集、
 * source 常满，不能当失败信号，而总储备趋势直接反映经济盈亏。
 */

export type ColonyPhase = "bootstrap" | "growth" | "crisis" | "recovery" | "steady";

/** 单次评估的输入信号（由 room-observer 从快照 + creep 统计得出）。 */
export interface PhaseInput {
  /** 总储备 = energyAvailable + 所有 container + storage 的能量。 */
  reserve: number;
  /** 立即可用于孵化的能量（spawn+extension），用于观测记录。 */
  spendable: number;
  /**
   * 可达能量占比 = spendable / energyCapacity（0..1）— 流动性维度核心信号：
   * 低值（< liquiditySpendableRatio）= spawn 实际破产，即使总储备很高。
   */
  spendableRatio: number;
  /**
   * 冻结能量占比 = 最满 container 的填充率（0..1）。与低 spendableRatio
   * 同时出现 = 流动性陷阱（W37S58 实测：spendableRatio≈5%、frozenRatio≈94%、
   * 0 hauler → 永久死锁）。
   */
  frozenRatio: number;
  /** harvester + worker 数量。 */
  harvesterCount: number;
  sourceCount: number;
  rcl: number;
  /**
   * 最满 source 的填充率（0..1）。> srcRatioTrap 持续 = source 满载但采不动。
   * P0-1 病灶 1：双维度分数看不到采集塌方（harvester 退化致采集塌方但 source
   * 持续满载、spawn 健康）— srcRatio + storageDrainRate 双条件强制 crisis 通道
   * 绕过迟滞。NaN（数据缺失）按 0 处理（保守不触发）。
   */
  srcRatio: number;
  /**
   * Storage 单 tick 净流出（E，负值=流失）；无 storage 时为 0。作为
   * storageDrainAccum 的累积源（P0-1）：srcRatio>0.9 期间流失累加、回填抵消。
   * 旧单 tick drainRate<-2 判定已弃 — 流失是稀疏大脉冲，单 tick 差分
   * 大部分=0 无法持续触发。
   */
  storageDrainRate: number;
  /**
   * P2-3：Storage 水位（0..1）。满仓豁免：forceCrisis 在 storage 高水位
   * （> forceCrisisStorageHigh）时不触发 — 满仓时流失是正常消费（upgrader 取能），
   * 避免「满仓 → crisis → upgrader 冻结 → link 死锁」正反馈。无 storage 为 undefined。
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
   * 0..100 的「流动性分数」（流动性维度），流动性陷阱（spawn 破产 + 能量冻在
   * container）持续时累加。与 drainScore 独立：W37S58 drainScore=0（总储备在涨）
   * 但 liquidityScore 爆表。
   */
  liquidityScore: number;
  /** 危机带（crisis/recovery）内已持续的评估次数 — 最短驻留时间用；进带从 1 起计，出带归 0。旧 Memory 无此字段按 0（v14 迁移回填）。 */
  bandTicks?: number;
  /** P0-1：srcRatio 满载 + storage 流失双条件持续的评估次数；任一条件不满足立即归零，达 srcStallEnterTicks 后强制 crisis 绕过迟滞。 */
  srcStallTicks?: number;
  /**
   * P0-1：srcRatio>0.9 期间 storage 累积净流失量（正值=失血）。流失累加、
   * 回填抵消（max(0) 不为负）、srcRatio≤0.9 归零。替代旧单 tick 判定 —
   * 流失是稀疏大脉冲（每~235tick 一次 -800），单 tick 差分大部分=0，
   * 累积量才能捕获间歇性失血。
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
  /** 盈余时每次评估的分数减少量（P0-2）；默认大于 scoreStep，恢复比下降更快，打破临界振荡。 */
  recoveryStep: number;
  /**
   * 流动性陷阱阈值：spendableRatio 低于此视为 spawn 破产（可达能量不足）。
   * W37S58 实测≈5%；健康房物流正常时 hauler 持续补 spawn，远高于此。
   */
  liquiditySpendableRatio: number;
  /** 流动性陷阱阈值：frozenRatio 高于此视为能量积压。与低 spendableRatio 同时成立才判定 — 单独 container 满是正常物流中转。 */
  liquidityFrozenRatio: number;
  /** 流动性陷阱时每次评估的分数增加量。 */
  liquidityStep: number;
  /** 流动性恢复时每次评估的分数减少量（> liquidityStep，非对称迟滞防振荡）。 */
  liquidityRecoveryStep: number;
  /**
   * 偿付赤字计分门槛：仅当 spendableRatio 低于此值时，储备下降才累加 drainScore —
   * spawn 口袋健康（extension 基本满员）时的储备下降是升级/建造的主动投资，
   * 不是生产崩溃；两者同等计分正是 TD-003 极限环根因之一（normal 恢复支出 →
   * 记赤字 → 收缩支出 → 记盈余 → 秒退 → 循环）。采集者死绝场景由
   * understaffed → bootstrap 兜底，不依赖本分数。
   */
  drainSpendableFloor: number;
  /**
   * 危机带最短驻留评估次数：进入 crisis/recovery 后至少停留此久才能回 normal —
   * 打破极限环第二道闸（recovery 收缩支出后分数秒清，立即回 normal 则支出恢复、
   * 赤字重积）。副作用：真危机恢复期至少 minBandTicks tick（刻意保守），且
   * crisis 退出必经 recovery 带。
   */
  minBandTicks: number;
  /** P0-1：srcRatio 强制 crisis 通道的填充率阈值（默认 0.9 — 略低于 1.0 给 harvester 通勤留余量，避免 source 短暂回血抖动）。 */
  srcRatioTrap: number;
  /**
   * P0-1：双条件持续多少次评估后强制 crisis。默认 50 tick — 私服快照显示失明路径
   * 持续 31000 tick，50 tick 内可观测真实失血而不误伤正常通勤/孵化脉冲。
   */
  srcStallEnterTicks: number;
  /**
   * P0-1：storage 累积净流失触发阈值。默认 1000 — 实测 crisis 房每~235tick 一次
   * -800，1.2 次即达；正常房 srcRatio 不持续>0.9，accum 归零不误触发。
   */
  storageDrainAccumThreshold: number;
  /** P2-3：forceCrisis 满仓豁免阈值 — storageRatio 超过此值不触发（满仓时流失是正常消费，不是采集失败）。默认 0.8。 */
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
 * 计算殖民相位（纯函数，带迟滞）。双维度危机模型（方案 C）：
 * 偿付维度 drainScore（reserveDelta<0 持续 → 生产崩溃）与流动性维度
 * liquidityScore（spendableRatio 低且 frozenRatio 高持续 → 物流死锁，W37S58
 * 根因 — 旧模型只量总财富不量流动性，总储备在涨但 94% 冻在 container、
 * spawn 仅 5% 可达仍判 growth）；任一爆表即危机。
 * 相位优先级：crisis > recovery > steady > bootstrap > growth，
 * crisis/recovery 间用 crisisScore 迟滞防临界抖动。
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
  // 替代旧单 tick drainRate<-2 判定 — 实测流失是稀疏大脉冲（每~235tick 一次
  // -800，大部分 tick 静止），单 tick 差分=0，srcStallTicks 反复归零到不了 50；
  // 累积量才能捕获间歇性失血。流失累加、回填抵消；srcRatio≤0.9 归零（采集正常）。
  // NaN（source 数据缺失）>0.9 为 false → 保守按 0 不触发。
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
  // 两者必须同时成立：单独 container 满是正常物流中转（hauler 正在搬）；
  // 单独 spawn 空是孵化脉冲消耗（马上被 hauler 补回）。同时持续 = 搬运能力不足 = 真死锁。
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
 * 将殖民相位映射为 ColonyState（plan §5.4 统一状态）：defense ← 有敌对单位
 * （优先级最高）；bootstrap ← 采集者不足；recovery ← crisis/recovery；
 * normal ← growth/steady。
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

/**
 * 脆弱新房（claim-secure）护栏谓词 — 「先保级再发展」的前置护栏核心判定。
 *
 * 判定：RCL<4（无 storage 缓冲，能量池薄，一旦 builder 抢能量 controller 极易降级）
 * + controller 临近降级（ticksToDowngrade 低于进入阈值）。
 * RCL4+ 房间已有 storage 缓冲，降级由既有 emergency 豁免（upgraderGate /
 * dynamicStorageLimit 的 isEmergency）处理，不在此列。
 *
 * 用途：room-state 用 {@link computeClaimSecure} 带迟滞写入 roomMem.claimSecure；
 * construction-manager 据此抑制非必要建造、upgrader 据此放宽取能地板。
 */
export function isClaimSecure(rcl: number, ticksToDowngrade: number | undefined): boolean {
  if (rcl >= 4) return false;
  if (ticksToDowngrade === undefined) return false;
  return ticksToDowngrade < CONFIG.economy.claimSecureEnterTtd;
}

/**
 * 带迟滞的 claimSecure 状态记忆（供 room-state 每 tick 持久化到 roomMem.claimSecure）。
 * 进入阈值 claimSecureEnterTtd，退出阈值 claimSecureExitTtd — 双门槛防「保级/发展」
 * 在临界 ttd 高频振荡（与 controllerDowngradeRisk 同款迟滞；ttd 最大值为控制器升级
 * 重置值 20000，故退出阈值取 20000 确保 upgrader 一旦保住 controller 即解除护栏）。
 */
export function computeClaimSecure(
  rcl: number,
  ticksToDowngrade: number | undefined,
  prev: boolean,
): boolean {
  if (rcl >= 4) return false;
  if (ticksToDowngrade === undefined) return false;
  if (prev) return ticksToDowngrade < CONFIG.economy.claimSecureExitTtd;
  return ticksToDowngrade < CONFIG.economy.claimSecureEnterTtd;
}
