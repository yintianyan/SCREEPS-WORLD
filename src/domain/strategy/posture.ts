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
  /** 最近一次房内出现威胁的 tick（无记录为 undefined）。 */
  lastHostileAt?: number;
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
  /** 殖民门（Phase 1a）：至少存在一个「成熟 sponsor」房——RCL ≥ 此值。 */
  colonizeSponsorRcl: number;
  /** 殖民门：成熟 sponsor 房要求的最低 storage 能量（能快速代孵新房）。 */
  colonizeSponsorEnergy: number;
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
  colonizeSponsorEnergy: 100000,
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
  const avgPressure = rooms.length > 0
    ? rooms.reduce((sum, r) => sum + r.economyPressure, 0) / rooms.length
    : 1;
  const allNormal = rooms.length > 0 && rooms.every(r => r.colonyState === "normal");
  const gclHeadroom = gclLevel > rooms.length;

  const prevPosture = prev?.posture ?? "develop";
  const since = prev?.since ?? tick;
  const dwellElapsed = tick - since;

  // ── 威胁升级：立即生效（紧急旁路，不等驻留期）──
  if (threatRecent) {
    // ── war 可持续性（R4 止损）：打不动经济必须退 ──
    // 计数跨 tick 累积（调用方持久化回传）、压力恢复即清零；达窗口立即降级
    // fortify，不等 minDwell — 战争机器烧的是存活所需的经济。
    if (prevPosture === "war") {
      const nextCounter =
        avgPressure > options.warMaxPressure ? (input.warPressureTicks ?? 0) + 1 : 0;
      if (nextCounter >= options.warExitPatienceTicks) {
        return finalize("fortify", prevPosture, since, tick, 0);
      }
      return finalize("war", prevPosture, since, tick, nextCounter);
    }
    // war 授权来自「持续被打 + 打得起」的证据链，与是否存在进攻代码无关 —
    // 执行器必须听姿态的，反之不成立。
    if (
      prevPosture === "fortify" &&
      dwellElapsed >= options.warPatience &&
      avgPressure <= options.warMaxPressure
    ) {
      return finalize("war", prevPosture, since, tick, 0);
    }
    return finalize("fortify", prevPosture, since, tick);
  }

  // ── 威胁消退：降级需要最短驻留期（滞回防抖）──
  if (prevPosture === "fortify" || prevPosture === "war") {
    if (dwellElapsed < options.minDwell) {
      return finalize(prevPosture, prevPosture, since, tick);
    }
    // 静默期满回 develop（不直接跳 expand，先确认经济恢复节奏）。
    return finalize("develop", prevPosture, since, tick);
  }

  // ── 和平姿态选择：expand（授权殖民）需要全面健康 + 核心成熟 ──
  // Phase 1a：叠加「核心成熟度 + 最新房自立」防过早殖民（历史教训：RCL4 嫩房
  // colonyState=normal 即触发殖民 → W6N3 失败、W8N4 硬上）。
  const sponsorReady = rooms.some(
    r => r.rcl >= options.colonizeSponsorRcl && r.storageEnergy >= options.colonizeSponsorEnergy,
  );
  const youngestMature = rooms.every(r => r.rcl >= options.colonizeYoungestFloorRcl);
  const canExpand =
    gclHeadroom &&
    allNormal &&
    bucket >= options.expandMinBucket &&
    avgPressure <= options.expandMaxPressure &&
    sponsorReady &&
    youngestMature;

  return finalize(canExpand ? "expand" : "develop", prevPosture, since, tick);
}

/** 组装结果：姿态变更时刷新 since，并派生各域指令与 war 压力计数。 */
function finalize(
  posture: EmpirePosture,
  prevPosture: EmpirePosture,
  prevSince: number,
  tick: number,
  warPressureTicks: number = 0,
): PostureResult {
  const since = posture === prevPosture ? prevSince : tick;
  return {
    posture,
    since,
    expansionAllowed: posture === "expand",
    newRemoteOpsAllowed: posture === "develop" || posture === "expand",
    warPressureTicks,
  };
}
