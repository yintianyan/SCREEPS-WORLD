/**
 * 帝国姿态评估 — Strategy 层纯函数核心：把「何时扩张/收缩/备战」从各执行系统
 * 的局部门禁收拢为单一状态机（develop 固本→expand 扩张→fortify 设防→war 战争），
 * 执行系统只消费指令、不自作主张；war 姿态是进攻唯一授权来源（ES-1：防御系统
 * 尚未消费姿态，「防御升档」是未接线规划项）。迁移与 CPU tier 同款哲学：威胁
 * 升级立即生效（紧急旁路），降级需静默期 + 最短驻留期（滞回防抖）。
 */

/** 单房间的战略输入摘要。 */
export interface RoomStrategyInput {
  colonyState: string;
  economyPressure: number;
  /** 最近一次房内出现威胁的 tick（无记录为 undefined）。带滞回的记忆。 */
  lastHostileAt?: number;
  /** 本 tick 房内是否存在真实在房威胁（snapshot.threatCreeps 非空的透传）。
   * 与 lastHostileAt 互补：lastHostileAt 是「威胁窗口内即算近期」的滞回记忆，
   * hasLiveThreat 是零滞回的「此刻是否有敌」。新远矿/扩张冻结跟随它，避免被
   * 已过期的威胁记忆收割「恐吓税」（见 evaluateEmpirePosture 内 finalize 注释）。 */
  hasLiveThreat?: boolean;
  rcl: number;
  /** 本房 storage 能量（无 storage 记 0）— 供殖民门判断核心成熟度。 */
  storageEnergy: number;
}

/** 帝国姿态。 */
export type EmpirePosture = "develop" | "expand" | "fortify" | "war";

/** 姿态评估选项。 */
export interface PostureOptions {
  /** 威胁记忆窗口（最近敌情判定）。与 CONFIG.defense.siegeMemoryTicks(10000) 刻意解耦
   * 取更短值：活跃帝国周期性遇 invader，窗口过长会令扩张近乎永久冻结；新目击仍即时
   * fortify（紧急旁路），缩短窗口只加快威胁散去后的恢复、不削弱在袭响应。 */
  threatWindow: number;
  /** fortify → war 的耐心窗口：设防状态持续超过此时长且敌情未消 → 升战争。 */
  warPatience: number;
  /** war 可持续性耐心窗口（R4）：war 下经济压力持续超 warMaxPressure 达此值 → 降级
   * fortify（打不起就撤资）；与威胁升级同待遇立即生效不等 minDwell，压力恢复即清零。 */
  warExitPatienceTicks: number;
  /** 降级最短驻留期：fortify/war 至少维持此时长才允许回落。 */
  minDwell: number;
  /** expand 姿态要求的最低 bucket（扩张是 CPU 重投资）。 */
  expandMinBucket: number;
  /** expand 姿态要求的最高平均经济压力。 */
  expandMaxPressure: number;
  /** war 姿态要求的最高平均经济压力（打不起就不打）。 */
  warMaxPressure: number;
  /** 殖民门（Phase 1a）：sponsor 房最低 RCL — 须成熟到拥有 terminal + 多 spawn + 收入余量。 */
  colonizeSponsorRcl: number;
  /** 殖民门：sponsor 房库存地板（饿死防护，非代孵能力门槛）。
   *  旧版 colonizeSponsorEnergy=100000（≈ bootstrap 实际成本的 50 倍）对「不囤货的自治帝国」
   *  结构性锁死扩张；新版改用稳定性模型（见 evaluateEmpirePosture 内 sponsorReady 注释），
   *  本值仅作「sponsor 真饿死时不新增殖民投资」的兜底，量级取 bootstrap 成本的若干倍。 */
  colonizeSponsorFloor: number;
  /** 殖民门：所有己方房 RCL 须 ≥ 此值（最新/最嫩房已自立，不再是拖累）。 */
  colonizeYoungestFloorRcl: number;
}

export const DEFAULT_POSTURE_OPTIONS: PostureOptions = {
  threatWindow: 3000,
  warPatience: 5000,
  warExitPatienceTicks: 1000,
  minDwell: 1000,
  expandMinBucket: 7000,
  expandMaxPressure: 0.4,
  warMaxPressure: 0.4,
  colonizeSponsorRcl: 7,
  colonizeSponsorFloor: 8000,
  colonizeYoungestFloorRcl: 5,
};

/** 姿态评估输入。 */
export interface PostureInput {
  tick: number;
  rooms: readonly RoomStrategyInput[];
  gclLevel: number;
  bucket: number;
  /** 上一次评估结果（滞回基准）；首次评估为 undefined。 */
  prev?: { posture: EmpirePosture; since: number };
  /** war 压力连续超标 tick 数（R4）：由 empire-strategy 持久化（kernel.strategy.warPressureTicks）后回传；缺失视为 0。 */
  warPressureTicks?: number;
}

/** 姿态评估结果 — 姿态 + 各域指令（执行系统只消费指令）。 */
export interface PostureResult {
  posture: EmpirePosture;
  /** 当前姿态的起始 tick。 */
  since: number;
  /** 是否允许启动新的扩张行动。 */
  expansionAllowed: boolean;
  /** 是否允许开辟新的远矿点（现役运营不受影响）。 */
  newRemoteOpsAllowed: boolean;
  /** 下一步 war 压力计数（R4）— 调用方（empire-strategy）须持久化供下 tick 回传，否则无法跨 tick 累积。 */
  warPressureTicks: number;
}

/**
 * 评估帝国姿态（纯函数，带滞回）。
 */
export function evaluateEmpirePosture(
  input: PostureInput,
  options: PostureOptions = DEFAULT_POSTURE_OPTIONS,
): PostureResult {
  const { tick, rooms, gclLevel, bucket, prev } = input;

  // ── 世界状态信号 ──
  const threatRecent = rooms.some(
    r => r.lastHostileAt !== undefined && tick - r.lastHostileAt < options.threatWindow,
  );
  // 零滞回「此刻有敌」：任一房本 tick 有真实在房威胁（已剔除盟友）。这是冻结指令的
  // 真相来源——不读滞回记忆，只读当下视线。敌人撤离即清零，自治立即恢复。
  const liveThreat = rooms.some(r => r.hasLiveThreat === true);
  const avgPressure = rooms.length > 0
    ? rooms.reduce((sum, r) => sum + r.economyPressure, 0) / rooms.length
    : 1;
  const allNormal = rooms.length > 0 && rooms.every(r => r.colonyState === "normal");
  const gclHeadroom = gclLevel > rooms.length;

  const prevPosture = prev?.posture ?? "develop";
  const since = prev?.since ?? tick;
  const dwellElapsed = tick - since;

  // 扩张健康门（独立于姿态机，恐吓税修复）：殖民是高承诺动作，仅在全面健康时授权，
  // 但与姿态显示解耦——近期受袭记忆(fortify)不再封锁扩张（对齐 newRemoteOpsAllowed
  // 跟随 liveThreat）。liveThreat / war 门禁在 finalize 叠加（有活敌 / 战争中不打殖民）。
  const sponsorReady = rooms.some(
    r =>
      r.rcl >= options.colonizeSponsorRcl &&
      r.colonyState === "normal" &&
      !r.hasLiveThreat &&
      r.storageEnergy >= options.colonizeSponsorFloor,
  );
  const youngestMature = rooms.every(r => r.rcl >= options.colonizeYoungestFloorRcl);
  const expandHealth =
    gclHeadroom &&
    allNormal &&
    bucket >= options.expandMinBucket &&
    avgPressure <= options.expandMaxPressure &&
    sponsorReady &&
    youngestMature;

  // ── 威胁升级：立即生效（紧急旁路，不等驻留期）──
  if (threatRecent) {
    // ── war 可持续性（R4 止损）：打不动经济必须退 ──
    // 计数跨 tick 累积（调用方持久化回传）、压力恢复即清零；达窗口立即降级
    // fortify，不等 minDwell — 战争机器烧的是存活所需的经济。
    if (prevPosture === "war") {
      const nextCounter =
        avgPressure > options.warMaxPressure ? (input.warPressureTicks ?? 0) + 1 : 0;
      if (nextCounter >= options.warExitPatienceTicks) {
        return finalize("fortify", prevPosture, since, tick, 0, liveThreat, expandHealth);
      }
      return finalize("war", prevPosture, since, tick, nextCounter, liveThreat, expandHealth);
    }
    // war 授权来自「持续被打 + 打得起」的证据链，与是否存在进攻代码无关 —
    // 执行器必须听姿态的，反之不成立。
    if (
      prevPosture === "fortify" &&
      dwellElapsed >= options.warPatience &&
      avgPressure <= options.warMaxPressure
    ) {
      return finalize("war", prevPosture, since, tick, 0, liveThreat, expandHealth);
    }
    return finalize("fortify", prevPosture, since, tick, 0, liveThreat, expandHealth);
  }

  // ── 威胁消退：降级需要最短驻留期（滞回防抖）──
  if (prevPosture === "fortify" || prevPosture === "war") {
    if (dwellElapsed < options.minDwell) {
      return finalize(prevPosture, prevPosture, since, tick, 0, liveThreat, expandHealth);
    }
    // 静默期满回 develop（不直接跳 expand，先确认经济恢复节奏）。
    return finalize("develop", prevPosture, since, tick, 0, liveThreat, expandHealth);
  }

  // ── 和平姿态选择：expand（授权殖民）需要全面健康 + 核心成熟 ──
  // 健康门已在上方统一计算为 expandHealth（含 Phase 1a「核心成熟度 + 最新房自立」防过早
  // 殖民、稳定性模型取代 100k 库存死门槛等，详见上方注释）。此处仅据其选显示姿态，
  // 扩张授权本身由 finalize 复用同一 expandHealth 推导，与姿态显示解耦。
  return finalize(expandHealth ? "expand" : "develop", prevPosture, since, tick, 0, liveThreat, expandHealth);
}

/**
 * 组装结果：姿态变更时刷新 since，并派生各域指令与 war 压力计数。
 *
 * 冻结指令跟随「真实在房威胁」而非过期姿态记忆：
 *  - 有活威胁(liveThreat) → 冻结新远矿 + 扩张：防御优先，不把新物流/殖民队送进战场；
 *  - 无活威胁 → 即便姿态仍卡 war/fortify（lastHostileAt 在威胁窗口内、敌人已撤离），
 *    也恢复自治，避免一次边境路过冻结扩张却无任何产出（"恐吓税"）。
 *  现役远矿运营不受影响（newRemoteOpsAllowed 只门禁"新"远矿点，现役 op 照常）。
 *
 * 扩张授权（expansionAllowed）= 扩张健康门(expandHealth) && 无活威胁 && 非战争态：
 *  - 不再要求 posture==="expand"——殖民是高承诺动作，授权门由"全面健康+无活敌"决定，
 *    与姿态显示解耦（fortify 记忆不封锁扩张）；
 *  - war 姿态仍硬性关闭扩张（战争是主动冲突，不应同时殖民）；
 *  - liveThreat 门禁保留（有活敌不打殖民，防御优先于速度）。
 */
function finalize(
  posture: EmpirePosture,
  prevPosture: EmpirePosture,
  prevSince: number,
  tick: number,
  warPressureTicks: number = 0,
  liveThreat: boolean = false,
  expandHealth: boolean = false,
): PostureResult {
  const since = posture === prevPosture ? prevSince : tick;
  const freeze = liveThreat;
  return {
    posture,
    since,
    expansionAllowed: expandHealth && !freeze && posture !== "war",
    newRemoteOpsAllowed: !freeze,
    warPressureTicks,
  };
}
