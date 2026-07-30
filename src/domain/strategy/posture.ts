/**
 * 帝国姿态评估 — Strategy 层的纯函数核心。
 *
 * 解决的架构缺口：此前「何时扩张/何时收缩/何时备战」散落在各执行系统的
 * 局部门禁里（expansion 看 GCL、remote 看 RCL）— 功能上线即自动开启，
 * 帝国没有统一的战略判断。本模块把这些裁决收拢为单一姿态状态机：
 * 执行系统只消费指令，不自作主张；进攻能力未来接入时必须插进这个插座，
 * 禁止「代码写完即开战」。
 *
 * 姿态语义：
 *   develop — 固本：发展经济与 RCL，不开新远矿点、不扩张。默认姿态。
 *   expand  — 扩张：经济全面健康 + GCL 有余量 + CPU 富余 + 无近期威胁。
 *   fortify — 设防：出现敌对活动 — 暂停扩张与新远矿点（收缩姿态）。
 *   war     — 战争：威胁持续超过耐心窗口且经济扛得住。
 *
 * ES-1 诚实化：fortify/war 当前的全部效果是「关扩张 + 关新远矿」—
 * 防御系统（defense-planner/tower-defense/fortification）尚未消费姿态，
 * 「防御投资升档」是未接线的规划项，不是现状。进攻执行器未来接入时
 * war 姿态是唯一授权来源（代码存在不等于战争开始）。
 *
 * 迁移规则（与 CPU tier 同款哲学）：
 *   升级（威胁方向）立即生效 — 紧急旁路，不等驻留期；
 *   降级（安全方向）需要静默期 + 最短驻留期 — 滞回防抖。
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
  /** 威胁记忆窗口：任一房 lastHostileAt 距今小于此值即视为「近期有敌情」。
   * 只影响"是否冻结扩张/新远矿"，与 CONFIG.defense.siegeMemoryTicks（墙体升档，
   * 10000）刻意解耦并取更短值：墙可为防御纵深保持高血更久，但经济扩张不该被一波
   * 已击退的 invader 冻结上万 tick——活跃帝国周期性遇 invader 是常态，窗口过长会
   * 令扩张近乎永久冻结。任何新目击仍即时 fortify（紧急旁路），故缩短此窗口只加快
   * 威胁散去后的扩张恢复，不削弱在袭响应。 */
  threatWindow: number;
  /** fortify → war 的耐心窗口：设防状态持续超过此时长且敌情未消 → 升战争。 */
  warPatience: number;
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
    // fortify 持续超过耐心窗口且经济扛得住 → 战争姿态。
    // 注意：war 的授权来自「持续被打 + 打得起」的证据链，
    // 与是否存在进攻代码无关 — 执行器必须听姿态的，反之不成立。
    if (
      (prevPosture === "fortify" || prevPosture === "war") &&
      dwellElapsed >= options.warPatience &&
      avgPressure <= options.warMaxPressure
    ) {
      return finalize("war", prevPosture, since, tick);
    }
    if (prevPosture === "war") {
      return finalize("war", prevPosture, since, tick);
    }
    return finalize("fortify", prevPosture, since, tick);
  }

  // ── 威胁消退：降级需要最短驻留期（滞回防抖）──
  if (prevPosture === "fortify" || prevPosture === "war") {
    if (dwellElapsed < options.minDwell) {
      return finalize(prevPosture, prevPosture, since, tick);
    }
    // 静默期满 — 回落到固本（不直接跳 expand，先确认经济恢复节奏）。
    return finalize("develop", prevPosture, since, tick);
  }

  // ── 和平姿态选择：expand（授权殖民）需要全面健康 + 核心成熟 ──
  // Phase 1a：在原经济健康门上叠加"核心成熟度 + 最新房自立"，防止过早殖民
  //（历史教训：RCL4 嫩房只要 colonyState=normal 就触发殖民 → W6N3 失败、W8N4 硬上）。
  //   - sponsorReady：至少一个房 RCL≥colonizeSponsorRcl 且 storage 盈余 → 能快速代孵新房；
  //   - youngestMature：所有己方房 RCL≥colonizeYoungestFloorRcl → 上一个新房已自立、不再分兵。
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

/** 组装结果：姿态变更时刷新 since，并派生各域指令。 */
function finalize(
  posture: EmpirePosture,
  prevPosture: EmpirePosture,
  prevSince: number,
  tick: number,
): PostureResult {
  const since = posture === prevPosture ? prevSince : tick;
  return {
    posture,
    since,
    expansionAllowed: posture === "expand",
    newRemoteOpsAllowed: posture === "develop" || posture === "expand",
  };
}
