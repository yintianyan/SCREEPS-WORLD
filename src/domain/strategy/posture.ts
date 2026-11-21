import type { PostureTransitionPayload } from "../../kernel/event-log";
/** 帝国姿态评估 — Strategy 层纯函数核心：把「何时扩张/收缩/备战」从各执行系统 */

/** 单房间的战略输入摘要。 */
export interface RoomStrategyInput {
  colonyState: string;
  economyPressure: number;
  /** 最近一次房内出现威胁的 tick（无记录为 undefined）。带滞回的记忆。
   * ⚠语义契约（2026-11-21 威胁写读分轨）：这是**混合口径**（不分行凶者身份）。
   * 姿态机不再读它——war 全链只认 `lastPlayerHostileAt`。现消费者：agenda 的
   * defense-readiness 倡议（房级防御准备，对 NPC 响应是正确的）。 */
  lastHostileAt?: number;
  /** 最近一次确认由 NPC（Invader）或玩家造成的威胁 tick。
   * 与 `lastHostileAt` 同拍盖章、按行凶者身份分尺（room-state 写）。
   * `lastPlayerHostileAt` 是姿态机 war 进入/维持/退出的唯一威胁依据；
   * `lastInvaderHostileAt` 仅用于 npc-deescalate 降轨判定（war 不被 NPC 噪声续命）。 */
  lastInvaderHostileAt?: number;
  lastPlayerHostileAt?: number;
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
  /** war 可持续性耐心窗口：war 下经济压力持续超 warMaxPressure 达此值 → 降级
   * fortify（打不起就撤资）；与威胁升级同待遇立即生效不等 minDwell，压力恢复即清零。 */
  warExitPatienceTicks: number;
  /** 降级最短驻留期：fortify/war 至少维持此时长才允许回落。 */
  minDwell: number;
  /** expand 姿态要求的最低 bucket（扩张是 CPU 重投资）。 */
  expandMinBucket: number;
  /** expand 姿态要求的最高平均经济压力。 */
  expandMaxPressure: number;
  /** 扩张 CPU ROI 门禁——总 creep CPU 占 limit 比例超过此值时
   * 拒绝扩张。新增房间会带来 ~3-5 CPU/tick 的 creep 增量（harvester/
   * hauler/upgrader/builder 等），在已接近 limit 的情况下会导致 CPU 死亡螺旋。
   * 默认 0.6：留 40% 余量给系统开销 + 突发。 */
  expandMaxCpuRatio: number;
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
  expandMaxCpuRatio: 0.6,
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
  /** war 压力连续超标 tick 数：由 empire-strategy 持久化（kernel.strategy.warPressureTicks）后回传；缺失视为 0。 */
  warPressureTicks?: number;
  /** 帝国总 creep CPU 消耗（Σ cpuByHome，来自 telemetry 采样）。
   * 用于扩张 ROI 门禁：扩张会增加归属 CPU，若现有 CPU 已接近 limit
   * 的一定比例，新增房间将导致 CPU 死亡螺旋。缺省视为 0（不门禁）。 */
  totalCreepCpu?: number;
  /** 有效 CPU limit（min(cpuLimit, tickLimit)），用于计算 CPU 占比。 */
  effectiveCpuLimit?: number;
}

/** 姿态评估结果 — 姿态 + 各域指令（执行系统只消费指令）。 */
/**
 * 本次姿态由哪条分支产生。
 *
 * 立案理由（线上实测）：`finalize` 原先不带"走了哪个 return"的信息，而 war 进/出的候选分支有六条，
 * 每次复盘都要现场考古——对方量过代价：console 2 发＋`econ-ring` 1 发＋读码 5 处，
 * 最后仍只能说「起点夹在 (355,365]」。命名一律对齐**分支条件**，不对齐注释里的意图。
 */
export type PostureBranch =
  /** prev=war 且任一房 recovery/bootstrap 且无活敌 ⇒ fortify（危机撤资，经济前置）。 */
  | "war-divest-crisis"
  /** 威胁窗口内、prev=war、压力计数到达 warExitPatienceTicks ⇒ fortify（止损）。 */
  | "war-exit-patience"
  /** 威胁窗口内、prev=war、未达止损 ⇒ 继续 war（压力计数累加或清零）。 */
  | "war-sustain"
  /** prev=war 且玩家敌意已出窗、仅 invader 记忆仍在窗 ⇒ fortify（NPC 降轨：war 的
   * 进攻授权只能由玩家敌意支撑，NPC 过境只配 fortify 级别防御；不等 minDwell 立即降）。 */
  | "npc-deescalate"
  /** 威胁窗口内、prev=fortify、驻留≥warPatience 且打得起且非危机 ⇒ war（进攻授权）。 */
  | "war-enter-patience"
  /** 威胁窗口内的其余情形 ⇒ fortify（含驻留未到、危机下不开战）。 */
  | "threat-hold-fortify"
  /** 威胁已消退但最短驻留未到 ⇒ 保持原姿态（滞回防抖）。 */
  | "hold-min-dwell"
  /** 威胁已消退且静默期满 ⇒ develop。 */
  | "silence-elapsed"
  /** 无威胁记忆路径 ⇒ expand/develop 由 expandHealth 决定。 */
  | "peace";

/** 事件环里的姿态码：码值随事件持久化，只许追加、不得重排。 */
export const POSTURE_EVENT_CODE: Record<EmpirePosture | "(none)", number> = {
  develop: 0,
  expand: 1,
  fortify: 2,
  war: 3,
  "(none)": 4,
};

/** 事件环里的分支码：与 PostureBranch 一一对应，只许追加、不得重排。 */
export const POSTURE_BRANCH_EVENT_CODE: Record<PostureBranch, number> = {
  "war-divest-crisis": 0,
  "war-exit-patience": 1,
  "war-sustain": 2,
  "war-enter-patience": 3,
  "threat-hold-fortify": 4,
  "hold-min-dwell": 5,
  "silence-elapsed": 6,
  peace: 7,
  "npc-deescalate": 8,
};

/** 姿态转换事件载荷（packed 列序 [fromCode, toCode, reasonCode] 由 event-log packer 唯一定义）。 */
export function postureTransitionEventData(
  from: EmpirePosture | "(none)",
  to: EmpirePosture,
  reason: PostureBranch,
): PostureTransitionPayload {
  return {
    fromCode: POSTURE_EVENT_CODE[from],
    toCode: POSTURE_EVENT_CODE[to],
    reasonCode: POSTURE_BRANCH_EVENT_CODE[reason],
  };
}

export interface PostureResult {
  /** 本次判定走的分支。 */
  reason: PostureBranch;
  posture: EmpirePosture;
  /** 当前姿态的起始 tick。 */
  since: number;
  /** 是否允许启动新的扩张行动。 */
  expansionAllowed: boolean;
  /** 是否允许开辟新的远矿点（现役运营不受影响）。 */
  newRemoteOpsAllowed: boolean;
  /** 下一步 war 压力计数 — 调用方（empire-strategy）须持久化供下 tick 回传，否则无法跨 tick 累积。 */
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
  // CPU ROI 门禁——扩张会增加 creep CPU（新房间至少 +harvester+hauler+upgrader），
  // 若现有 CPU 已占 limit 的 expandMaxCpuRatio 以上，新房间将吃掉剩余预算触发死亡螺旋。
  const totalCreepCpu = input.totalCreepCpu ?? 0;
  const effectiveLimit = Math.max(1, input.effectiveCpuLimit ?? 20);
  const cpuRatioOk = totalCreepCpu / effectiveLimit < options.expandMaxCpuRatio;

  // ── 世界状态信号 ──
  // 威胁写读分轨（2026-11-21 批次 2）：写侧 room-state 已按行凶者身份分尺盖章
  // （lastInvaderHostileAt / lastPlayerHostileAt），读侧姿态机全链只认**玩家敌意**。
  // 病灶：混合口径 lastHostileAt 把 NPC 过境与玩家宣战记成同一件事，而 NPC 到达
  // 间隔≈威胁窗 ⇒ war 占空比≈100%（线上实证：branch 长期 war-sustain、
  // adversariesTotal=0、warPressureTicks=0，扩张门被 NPC 噪声钉死）。
  // invader-only 场景不进 war、不驻留 fortify——防御响应在 room 级
  // （tower-defense / colonyState=defense / agenda defense-readiness）独立运行，
  // 帝国姿态只对玩家敌意升级；当下有敌仍由 liveThreat 冻结新远矿/扩张。
  const playerThreatRecent = rooms.some(
    r => r.lastPlayerHostileAt !== undefined && tick - r.lastPlayerHostileAt < options.threatWindow,
  );
  // 零滞回「此刻有敌」：任一房本 tick 有真实在房威胁（已剔除盟友）。这是冻结指令的
  // 真相来源——不读滞回记忆，只读当下视线。敌人撤离即清零，自治立即恢复。
  const liveThreat = rooms.some(r => r.hasLiveThreat === true);
  // 仅 NPC 骚扰：invader 记忆在窗内且玩家敌意不在窗内。唯一用途是 war 降轨分支
  //（npc-deescalate）——war 期间玩家敌意出窗、只剩 NPC 记忆时立即降 fortify，
  // 不让 NPC 噪声续命战争机器（classifyThreatOwners 保证非 Invader 一律记 player，
  // 「来源不明」在实践中不存在，无需保守回退）。
  const invaderThreatRecent = rooms.some(
    r =>
      r.lastInvaderHostileAt !== undefined && tick - r.lastInvaderHostileAt < options.threatWindow,
  );
  const npcOnlyThreatRecent = invaderThreatRecent && !playerThreatRecent;
  const avgPressure =
    rooms.length > 0 ? rooms.reduce((sum, r) => sum + r.economyPressure, 0) / rooms.length : 1;
  const allNormal = rooms.length > 0 && rooms.every(r => r.colonyState === "normal");
  // 经济生存态：任一房 recovery/bootstrap（能量闭环退化）即视为「打不起战争」。
  // 战争是盈余活动——危机下开战只会加重能量负担、拖垮恢复。姿态机必须把经济容量
  // 作为战争的硬性前置（分析结论：posture 此前与 colonyState 解耦，导致 recovery
  // 下仍能 war，孵出纯消耗 combat creeps 反而拖死经济；energetic crisis ≠ war）。
  const anyRecovery = rooms.some(
    r => r.colonyState === "recovery" || r.colonyState === "bootstrap",
  );
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
    youngestMature &&
    cpuRatioOk; // CPU 余量不足以支撑新房间时不扩张

  // ── 危机下强行撤资（经济前置）：若上一态为 war 且当前无真实在房威胁，立即降
  // fortify —— recovery/bootstrap 是比威胁记忆更强的经济信号，战争机器烧的是存活所需的
  // 经济。统一覆盖「威胁仍在窗口」与「威胁已消退」两条路径（早于此处分流）。
  if (prevPosture === "war" && anyRecovery && !liveThreat) {
    return finalize(
      "fortify",
      prevPosture,
      since,
      tick,
      0,
      liveThreat,
      expandHealth,
      "war-divest-crisis",
    );
  }

  // ── NPC 降轨（威胁写读分轨）：prev=war 且玩家敌意已出窗、仅 invader 记忆仍在窗
  // ⇒ 立即降 fortify（不等 minDwell）。war 的进攻授权只能由玩家敌意支撑；NPC 过境
  // 只配 fortify 级别的防御姿态。之后 fortify 的回落走常规 minDwell→develop 路径，
  // NPC 记忆不再驻留 fortify（「不进 war、不驻留 fortify」统一收编）。
  // 位置：在危机撤资之后、玩家威胁链之前 —— 玩家敌意在窗时本分支不触发（npcOnly
  // 要求 playerThreatRecent=false），war 进入/维持/退出全链语义不受影响。
  if (prevPosture === "war" && npcOnlyThreatRecent) {
    return finalize(
      "fortify",
      prevPosture,
      since,
      tick,
      0,
      liveThreat,
      expandHealth,
      "npc-deescalate",
    );
  }

  // ── 威胁升级：立即生效（紧急旁路，不等驻留期）──
  if (playerThreatRecent) {
    // ── war 可持续性（止损）：打不动经济必须退 ──
    // 计数跨 tick 累积（调用方持久化回传）、压力恢复即清零；达窗口立即降级
    // fortify，不等 minDwell — 战争机器烧的是存活所需的经济。
    // （危机撤资已由上方统一早退处理；此处仅处理正常经济下的可持续止损。）
    if (prevPosture === "war") {
      const nextCounter =
        avgPressure > options.warMaxPressure ? (input.warPressureTicks ?? 0) + 1 : 0;
      if (nextCounter >= options.warExitPatienceTicks) {
        return finalize(
          "fortify",
          prevPosture,
          since,
          tick,
          0,
          liveThreat,
          expandHealth,
          "war-exit-patience",
        );
      }
      return finalize(
        "war",
        prevPosture,
        since,
        tick,
        nextCounter,
        liveThreat,
        expandHealth,
        "war-sustain",
      );
    }
    // war 授权来自「持续被打 + 打得起」的证据链，与是否存在进攻代码无关 —
    // 执行器必须听姿态的，反之不成立。
    // 危机态（recovery/bootstrap）下不发动进攻性战争——经济尚未自愈，养不起军队。
    if (
      prevPosture === "fortify" &&
      dwellElapsed >= options.warPatience &&
      avgPressure <= options.warMaxPressure &&
      !anyRecovery
    ) {
      return finalize(
        "war",
        prevPosture,
        since,
        tick,
        0,
        liveThreat,
        expandHealth,
        "war-enter-patience",
      );
    }
    return finalize(
      "fortify",
      prevPosture,
      since,
      tick,
      0,
      liveThreat,
      expandHealth,
      "threat-hold-fortify",
    );
  }

  // ── 威胁消退：降级需要最短驻留期（滞回防抖）──
  if (prevPosture === "fortify" || prevPosture === "war") {
    if (dwellElapsed < options.minDwell) {
      return finalize(
        prevPosture,
        prevPosture,
        since,
        tick,
        0,
        liveThreat,
        expandHealth,
        "hold-min-dwell",
      );
    }
    // 静默期满回 develop（不直接跳 expand，先确认经济恢复节奏）。
    return finalize(
      "develop",
      prevPosture,
      since,
      tick,
      0,
      liveThreat,
      expandHealth,
      "silence-elapsed",
    );
  }

  // ── 和平姿态选择：expand（授权殖民）需要全面健康 + 核心成熟 ──
  // 健康门已在上方统一计算为 expandHealth（含 Phase 1a「核心成熟度 + 最新房自立」防过早
  // 殖民、稳定性模型取代 100k 库存死门槛等，详见上方注释）。此处仅据其选显示姿态，
  // 扩张授权本身由 finalize 复用同一 expandHealth 推导，与姿态显示解耦。
  return finalize(
    expandHealth ? "expand" : "develop",
    prevPosture,
    since,
    tick,
    0,
    liveThreat,
    expandHealth,
    "peace",
  );
}

/**
 * 组装结果：姿态变更时刷新 since，并派生各域指令与 war 压力计数。

 * 冻结指令跟随「真实在房威胁」而非过期姿态记忆：
 *  - 有活威胁(liveThreat) → 冻结新远矿 + 扩张：防御优先，不把新物流/殖民队送进战场；
 *  - 无活威胁 → 即便姿态仍卡 war/fortify（lastPlayerHostileAt 在威胁窗口内、敌人已撤离），
 *    也恢复自治，避免一次边境路过冻结扩张却无任何产出（"恐吓税"）。
 *  现役远矿运营不受影响（newRemoteOpsAllowed 只门禁"新"远矿点，现役 op 照常）。

 * 扩张授权（expansionAllowed）= 扩张健康门(expandHealth) && 无活威胁 && 非战争态：
 *  - 不再要求 posture==="expand"——殖民是高承诺动作，授权门由"全面健康+无活敌"决定，
 *    与姿态显示解耦（fortify 记忆不封锁扩张）；
 *  - war 姿态硬性关闭扩张。威胁写读分轨后 war 只能由玩家敌意进入/维持
 *    （NPC-only 走 npc-deescalate 降 fortify），因此「非战争态」这一条即完整覆盖
 *    「玩家敌意拦扩张」的保守语义，无需再读威胁分尺；
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
  reason: PostureBranch = "peace",
): PostureResult {
  const since = posture === prevPosture ? prevSince : tick;
  const freeze = liveThreat;
  return {
    reason,
    posture,
    since,
    expansionAllowed: expandHealth && !freeze && posture !== "war",
    newRemoteOpsAllowed: !freeze,
    warPressureTicks,
  };
}
