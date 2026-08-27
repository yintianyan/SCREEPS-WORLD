/** Empire Economic Balance */

// ─── 帝国资源平衡 ─────────────────────────────────────────

/**
 * Room Economic Summary — 单个房间的经济摘要。
 */
export interface RoomEconomicSummary {
  roomName: string;
  /** 角色类型。 */
  role: string;
  /** 本地产出（e/tick）。 */
  localProduction: number;
  /** 远矿产出贡献（e/tick）。 */
  remoteContribution: number;
  /** 本地消费（e/tick：spawn + build + upgrade + tower）。 */
  localConsumption: number;
  /** 净产出 = localProduction + remoteContribution - localConsumption。 */
  netProduction: number;
  /** storage 储量。 */
  storageEnergy: number;
  /** terminal 储量。 */
  terminalEnergy: number;
}

/**
 * Remote Contribution — 远矿对孵化房的产出贡献摘要。
 */
export interface RemoteContribution {
  homeRoom: string;
  /** 远矿总产出（e/tick）。 */
  totalProduction: number;
  /** 远矿总交付（e/tick）。 */
  totalDelivered: number;
  /** 活跃远矿数。 */
  activeOps: number;
  /** 远矿净价值合计（e/tick）。 */
  totalNetValue: number;
}

/**
 * Empire Balance — 帝国级资源平衡表。
 */
export interface EmpireBalance {
  /** 统计 tick。 */
  tick: number;

  // ── 帝国总量 ──
  /** 帝国总产出（e/tick）。 */
  totalProduction: number;
  /** 帝国总消费（e/tick）。 */
  totalConsumption: number;
  /** 帝国净产出（e/tick）。 */
  netProduction: number;
  /** 帝国总储备（能量）。 */
  totalReserve: number;

  // ── 远矿贡献 ──
  /** 远矿总产出（e/tick）。 */
  remoteProduction: number;
  /** 远矿总交付（e/tick）。 */
  remoteDelivered: number;
  /** 远矿净价值（e/tick）。 */
  remoteNetValue: number;
  /** 活跃远矿数。 */
  activeRemoteOps: number;

  // ── 扩张压力 ──
  /** 是否有扩张压力（netProduction < 0 或远矿运力不足）。 */
  expansionPressure: boolean;
  /** 扩张压力原因。 */
  pressureReason: string;

  // ── 经济健康度 ──
  /** 帝国经济健康度。 */
  health: EmpireEconomicHealth;
  /** 健康度原因。 */
  healthReason: string;
}

/**
 * 帝国经济健康度。
 */
export type EmpireEconomicHealth =
  | "thriving"
  | "stable"
  | "strained"
  | "critical";

// ─── 计算 ──────────────────────────────────────────────

/**
 * 计算帝国级资源平衡。

 * 纯函数 — 不访问 Game/Memory。

 * @param tick 当前 tick
 * @param roomSummaries 各房间经济摘要
 * @param remoteContributions 远矿贡献列表
 * @param config 健康度参数
 */
export function computeEmpireBalance(
  tick: number,
  roomSummaries: readonly RoomEconomicSummary[],
  remoteContributions: readonly RemoteContribution[],
  config: EmpireBalanceConfig,
): EmpireBalance {
  // 帝国总量
  let totalProduction = 0;
  let totalConsumption = 0;
  let totalReserve = 0;

  for (const room of roomSummaries) {
    totalProduction += room.localProduction + room.remoteContribution;
    totalConsumption += room.localConsumption;
    totalReserve += room.storageEnergy + room.terminalEnergy;
  }

  // 远矿贡献
  let remoteProduction = 0;
  let remoteDelivered = 0;
  let remoteNetValue = 0;
  let activeRemoteOps = 0;
  for (const rc of remoteContributions) {
    remoteProduction += rc.totalProduction;
    remoteDelivered += rc.totalDelivered;
    remoteNetValue += rc.totalNetValue;
    activeRemoteOps += rc.activeOps;
  }

  const netProduction = totalProduction - totalConsumption;

  // 扩张压力
  const expansionPressure = netProduction < 0 ||
    (remoteProduction > 0 && remoteDelivered < remoteProduction * config.deliveryEfficiencyThreshold);
  const pressureReason = netProduction < 0
    ? `net-production-negative-${netProduction.toFixed(1)}`
    : expansionPressure
      ? `remote-delivery-below-${config.deliveryEfficiencyThreshold}`
      : "no-pressure";

  // 经济健康度
  const health = classifyEmpireHealth(netProduction, totalReserve, activeRemoteOps, config);
  const healthReason = classifyEmpireHealthReason(netProduction, totalReserve, health);

  return {
    tick,
    totalProduction,
    totalConsumption,
    netProduction,
    totalReserve,
    remoteProduction,
    remoteDelivered,
    remoteNetValue,
    activeRemoteOps,
    expansionPressure,
    pressureReason,
    health,
    healthReason,
  };
}

// ─── 健康度参数 ──────────────────────────────────────────

/**
 * Empire Balance Config — 健康度评估参数。
 */
export interface EmpireBalanceConfig {
  /** THRIVING 净产出阈值（e/tick）。 */
  thrivingThreshold: number;
  /** STABLE 净产出阈值（e/tick）。 */
  stableThreshold: number;
  /** CRITICAL 储备阈值（能量）。 */
  criticalReserveThreshold: number;
  /** 远矿交付效率阈值。 */
  deliveryEfficiencyThreshold: number;
}

/**
 * 默认参数。
 */
export const DEFAULT_EMPIRE_BALANCE_CONFIG: EmpireBalanceConfig = {
  thrivingThreshold: 20,
  stableThreshold: 5,
  criticalReserveThreshold: 10000,
  deliveryEfficiencyThreshold: 0.7,
};

/**
 * 判定帝国经济健康度。
 * 纯函数。
 */
export function classifyEmpireHealth(
  netProduction: number,
  totalReserve: number,
  activeRemoteOps: number,
  config: EmpireBalanceConfig,
): EmpireEconomicHealth {
  if (netProduction >= config.thrivingThreshold && totalReserve >= config.criticalReserveThreshold) {
    return "thriving";
  }
  if (netProduction >= config.stableThreshold && totalReserve >= config.criticalReserveThreshold) {
    return "stable";
  }
  if (totalReserve < config.criticalReserveThreshold) {
    return "critical";
  }
  return "strained";
}

/**
 * 生成健康度原因描述。
 * 纯函数。
 */
export function classifyEmpireHealthReason(
  netProduction: number,
  totalReserve: number,
  health: EmpireEconomicHealth,
): string {
  switch (health) {
    case "thriving":
      return `net-${netProduction.toFixed(1)}-reserve-${totalReserve}-thriving`;
    case "stable":
      return `net-${netProduction.toFixed(1)}-reserve-${totalReserve}-stable`;
    case "strained":
      return `net-${netProduction.toFixed(1)}-reserve-${totalReserve}-strained`;
    case "critical":
      return `reserve-${totalReserve}-below-critical-${0}`;
  }
}

// ─── 远矿贡献计算 ──────────────────────────────────────

/**
 * 从各远矿 Operation 的经济数据计算对某孵化房的远矿贡献。

 * 纯函数。
 */
export function computeRemoteContribution(
  homeRoom: string,
  remoteOps: readonly {
    homeRoom: string;
    productionRate: number;
    deliveryRate: number;
    netValue: number;
    active: boolean;
  }[],
): RemoteContribution {
  const myOps = remoteOps.filter(
    o => o.homeRoom === homeRoom && o.active,
  );
  return {
    homeRoom,
    totalProduction: myOps.reduce((sum, o) => sum + o.productionRate, 0),
    totalDelivered: myOps.reduce((sum, o) => sum + o.deliveryRate, 0),
    activeOps: myOps.length,
    totalNetValue: myOps.reduce((sum, o) => sum + o.netValue, 0),
  };
}
