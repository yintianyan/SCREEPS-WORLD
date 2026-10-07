/** Empire Resource View */

import type { RoomEconomicProfile } from "../economy/room-profile";
import { canExportEnergy, needsEnergyAid } from "../economy/room-profile";

/**
 * Empire Resource View — 帝国级资源聚合只读视图。

 * 由各房 RoomEconomicProfile 聚合派生。包含：
 * - 总量指标：energy / production / consumption / netFlow
 * - 分类统计：core/production/candidate/struggling 各类房间数
 * - Imbalance 信号：surplus rooms / deficit rooms
 * - 风险信号：struggling 房间数 + 最差 riskBuffer

 * 不变量：
 * - 所有字段从 profiles 数组派生，不访问 Game/Memory
 * - 空数组（无房间）时总量为 0，分类为 0，health 为 Critical
 */
export interface EmpireResourceView {
  /** 采样 tick（调用方传入）。 */
  tick: number;
  /** 房间总数。 */
  roomCount: number;

  // ── 总量指标 ──
  /** 帝国总能量（Σ storageEnergy）。 */
  totalEnergy: number;
  /** 帝国总估计收入（Σ estimatedIncome，能量/tick）。 */
  totalProduction: number;
  /** 帝国总净流（Σ netFlow，能量/tick，可负）。 */
  totalNetFlow: number;
  /** 帝国总合同储备（Σ contractReserve）。 */
  totalReserve: number;
  /** 帝国总风险缓冲（min of riskBuffer——短板效应：最差的房决定帝国抗断供能力）。 */
  minRiskBuffer: number;
  /** 帝国平均效率系数。 */
  avgEfficiency: number;

  // ── 分类统计 ──
  /** core 房间数。 */
  coreRooms: number;
  /** production 房间数。 */
  productionRooms: number;
  /** candidate 房间数。 */
  candidateRooms: number;
  /** struggling 房间数。 */
  strugglingRooms: number;
  /**
   * struggling 房名单。只有计数时，读到 `G2` 红的人必须回源码重算才知道是
   * 哪间房关掉了扩张（G2/G3/G5 同出一枚 economicClass，见 room-profile.ts:202-217）。
   */
  strugglingRoomNames: string[];

  // ── Imbalance 信号 ──
  /** 可输出能量的房间（canExportEnergy=true）名单。 */
  surplusRooms: string[];
  /** 需要能量援助的房间（needsEnergyAid=true）名单。 */
  deficitRooms: string[];
  /** 是否存在 Imbalance（surplus + deficit 同时非空）。 */
  hasImbalance: boolean;

  // ── 风险信号 ──
  /** 是否有困难房（struggling > 0）。 */
  hasStruggling: boolean;
  /** 最差房间的经济压力（max economyPressure）。 */
  maxPressure: number;
  /** 是否有房间有活威胁。 */
  hasLiveThreat: boolean;

  // ── 派生 ──
  /**
   * 帝国净流健康度：totalNetFlow > 0 → true。
   * ECONOMY §2.3：本土净流为正是一切对外援助/扩张的前置。
   */
  empireNetFlowPositive: boolean;
  /**
   * 帝国收支平衡度（0..1）：totalProduction > 0 时 =
   * clamp(1 − max(0, −totalNetFlow)/totalProduction) —— **只在赤字方向扣分**。
   *
   * 含义：净流 ≥ 0 ⇒ 1（账面不为负即视为平衡）；净流为负时按占产量的比例扣分。
   * 旧式带绝对值，把"结余很大"也判成不平衡：官服实测 netFlow=17.7/t 而产量≈20/t ⇒
   * 自给度 0.11 ⇒ health 封顶 stable ⇒ 扩张 G3 恒红（2026-09-29 收成只剩这一道闸）。
   * 帝国能造出盈余正是对外扩张的前提，把它当病征是符号错误，不是经济问题。
   * ⚠️ 这个名字仍然名不副实：它量的是**收支平衡**，不是"原料自产"。拆成两个字段属
   * 单独一条码（改判决输入时不顺手做语义拆分），别把两者混为一谈。
   */
  empireSelfSufficiency: number;
}

/**
 * 聚合各房 RoomEconomicProfile 为 Empire Resource View。

 * 纯函数 — 不引用 Game/Memory。
 * 频率：每 N tick（100–500，与 Empire 姿态/容量同频或更低）。

 * @param profiles 各房的 RoomEconomicProfile（由调用方从 RoomSnapshot + Memory 组装）
 * @param tick 当前 tick
 */
export function buildEmpireResourceView(
  profiles: readonly RoomEconomicProfile[],
  tick: number,
): EmpireResourceView {
  const roomCount = profiles.length;

  // 空数组安全
  if (roomCount === 0) {
    return {
      tick,
      roomCount: 0,
      totalEnergy: 0,
      totalProduction: 0,
      totalNetFlow: 0,
      totalReserve: 0,
      minRiskBuffer: 0,
      avgEfficiency: 0,
      coreRooms: 0,
      productionRooms: 0,
      candidateRooms: 0,
      strugglingRooms: 0,
      strugglingRoomNames: [],
      surplusRooms: [],
      deficitRooms: [],
      hasImbalance: false,
      hasStruggling: false,
      maxPressure: 0,
      hasLiveThreat: false,
      empireNetFlowPositive: false,
      empireSelfSufficiency: 0,
    };
  }

  let totalEnergy = 0;
  let totalProduction = 0;
  let totalNetFlow = 0;
  let totalReserve = 0;
  let minRiskBuffer = Infinity;
  let effSum = 0;
  let effCount = 0;
  let coreRooms = 0;
  let productionRooms = 0;
  let candidateRooms = 0;
  let strugglingRooms = 0;
  let maxPressure = 0;
  let hasLiveThreat = false;

  const surplusRooms: string[] = [];
  const deficitRooms: string[] = [];
  const strugglingRoomNames: string[] = [];

  for (const p of profiles) {
    totalEnergy += p.storageEnergy;
    totalProduction += p.estimatedIncome;
    totalNetFlow += p.netFlow;
    totalReserve += p.contractReserve;
    // 短板效应照旧，但**没有 storage 的房不参与 min**：riskBuffer 的分子是 storageEnergy（RCL4 才有结构），
    // 幼房的缓冲实际躺在 container 与 spawn 池里（线上实测 W38S56 `rb=0` 同时 ea=529/550、房内 7,085 能量）。
    // 用一个"结构性 0"去当帝国的短板，会把 health 判成 stable ⇒ 扩张闸 G3 恒红，
    // 而它红的原因与帝国真实储备无关（同刻 te=885,885、gate netFlow=+29.4/t）。
    // 阈值一个没动：只是不再把"测不了的东西"当成最差的那一环；全部房都没有 storage 时行为逐字不变（min→0）。
    if (p.hasStorage && p.riskBuffer < minRiskBuffer) minRiskBuffer = p.riskBuffer;
    if (p.estimatedIncome > 0 || p.efficiency > 0) {
      effSum += p.efficiency;
      effCount++;
    }

    switch (p.economicClass) {
      case "core":
        coreRooms++;
        break;
      case "production":
        productionRooms++;
        break;
      case "candidate":
        candidateRooms++;
        break;
      case "struggling":
        strugglingRooms++;
        strugglingRoomNames.push(p.roomName);
        break;
    }

    if (p.economyPressure > maxPressure) maxPressure = p.economyPressure;
    if (p.hasLiveThreat) hasLiveThreat = true;

    if (canExportEnergy(p)) surplusRooms.push(p.roomName);
    if (needsEnergyAid(p)) deficitRooms.push(p.roomName);
  }

  // minRiskBuffer：空数组已处理；有房但全部未核算（riskBuffer=0）则为 0
  if (!Number.isFinite(minRiskBuffer)) minRiskBuffer = 0;

  const hasImbalance = surplusRooms.length > 0 && deficitRooms.length > 0;
  const hasStruggling = strugglingRooms > 0;
  const empireNetFlowPositive = totalNetFlow > 0;
  const empireSelfSufficiency =
    totalProduction > 0
      ? Math.max(0, Math.min(1, 1 - Math.max(0, -totalNetFlow) / totalProduction))
      : 0;

  return {
    tick,
    roomCount,
    totalEnergy,
    totalProduction,
    totalNetFlow,
    totalReserve,
    minRiskBuffer,
    avgEfficiency: effCount > 0 ? effSum / effCount : 0,
    coreRooms,
    productionRooms,
    candidateRooms,
    strugglingRooms,
    strugglingRoomNames,
    surplusRooms,
    deficitRooms,
    hasImbalance,
    hasStruggling,
    maxPressure,
    hasLiveThreat,
    empireNetFlowPositive,
    empireSelfSufficiency,
  };
}
