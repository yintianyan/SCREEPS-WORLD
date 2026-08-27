/** Expansion ROI Tracker */

/** Before/After 快照。 */
export interface EmpireSnapshot {
  /** 采样 tick。 */
  tick: number;
  /** 帝国总能量。 */
  totalEnergy: number;
  /** 帝国总生产。 */
  totalProduction: number;
  /** 帝国总净流。 */
  totalNetFlow: number;
  /** 帝国总储备。 */
  totalReserve: number;
  /** 帝国 Spawn 容量（总 energyCapacityAvailable）。 */
  spawnCapacity: number;
  /** 帝国人口总数。 */
  totalPopulation: number;
  /** 帝国房间数。 */
  roomCount: number;
  /** 经济健康度。 */
  economicHealth: string;
}

/** ROI 追踪结果。 */
export interface ExpansionRoiResult {
  /** 关联的 planId。 */
  planId: string;
  /** 扩张目标房名。 */
  roomName: string;
  /** Before 快照。 */
  before: EmpireSnapshot;
  /** After 快照。 */
  after: EmpireSnapshot;
  // ── 增量 ──
  /** 能量增益。 */
  energyGain: number;
  /** 产能增益。 */
  productionGain: number;
  /** 净流变化。 */
  netFlowChange: number;
  /** 储备增益。 */
  reserveGain: number;
  /** Spawn 容量增益。 */
  spawnCapacityGain: number;
  /** 人口增益。 */
  populationGain: number;
  // ── 判定 ──
  /** 扩张是否改善了 Empire。 */
  improved: boolean;
  /** 人类可读证据。 */
  evidence: string;
}

/**
 * 计算 Expansion ROI（纯函数）。

 * 对比 Before/After 快照，计算各维度的增量。
 * improved = 产能增益 > 0 或 净流改善 或 储备增加。
 */
export function evaluateExpansionRoi(input: {
  planId: string;
  roomName: string;
  before: EmpireSnapshot;
  after: EmpireSnapshot;
}): ExpansionRoiResult {
  const { planId, roomName, before, after } = input;

  const energyGain = after.totalEnergy - before.totalEnergy;
  const productionGain = after.totalProduction - before.totalProduction;
  const netFlowChange = after.totalNetFlow - before.totalNetFlow;
  const reserveGain = after.totalReserve - before.totalReserve;
  const spawnCapacityGain = after.spawnCapacity - before.spawnCapacity;
  const populationGain = after.totalPopulation - before.totalPopulation;

  const improved = productionGain > 0 || netFlowChange > 0 || reserveGain > 0;

  const evidence = [
    `ExpansionROI ${planId} (${roomName})`,
    `production: ${before.totalProduction} → ${after.totalProduction} (${productionGain >= 0 ? "+" : ""}${productionGain})`,
    `netFlow: ${before.totalNetFlow.toFixed(1)} → ${after.totalNetFlow.toFixed(1)} (${netFlowChange >= 0 ? "+" : ""}${netFlowChange.toFixed(1)})`,
    `reserve: ${before.totalReserve} → ${after.totalReserve} (${reserveGain >= 0 ? "+" : ""}${reserveGain})`,
    `rooms: ${before.roomCount} → ${after.roomCount}`,
    improved ? "IMPROVED" : "NO_IMPROVEMENT",
  ].join(" | ");

  return {
    planId,
    roomName,
    before,
    after,
    energyGain,
    productionGain,
    netFlowChange,
    reserveGain,
    spawnCapacityGain,
    populationGain,
    improved,
    evidence,
  };
}
