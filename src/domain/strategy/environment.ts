/**
 * 环境画像（P1-3）— 纯函数，不访问 Game/Memory。
 *
 * 采集三类环境信号供 empire-strategy 消费：
 *   1. 市场可用性：buy/sell 单数量 + credits 余额 → 判断市场活跃度
 *   2. 邻居密度：intel 中有 owner 的邻房比例 → 判断竞争压力
 *   3. GCL 趋势：level + progress 变化率 → 判断扩张节奏
 *
 * 设计决策：纯函数 + 由调用方注入运行时数据（Game.market / Game.gcl / intel），
 * 不直接访问 Game 使其可测试。empire-strategy 低频调用（每 100 tick），
 * getAllOrders 是 CPU 大户（官服 ~0.5-1 CPU），不可每 tick 调。
 */

/** 市场快照输入。 */
export interface MarketSnapshotInput {
  /** Game.market.getAllOrders() 返回的订单数组长度。 */
  totalOrders: number;
  /** 其中 buy 单数量。 */
  buyOrders: number;
  /** 其中 sell 单数量。 */
  sellOrders: number;
  /** Game.market.credits。 */
  credits: number;
}

/** 邻居密度输入。 */
export interface NeighborDensityInput {
  /** 所有邻房总数。 */
  totalNeighbors: number;
  /** 其中有 owner（被玩家占据）的邻房数。 */
  ownedNeighbors: number;
}

/** GCL 趋势输入。 */
export interface GclTrendInput {
  /** 当前 GCL level。 */
  level: number;
  /** 当前 progress。 */
  progress: number;
  /** 上次采样的 tick（用于计算变化率，缺失视为首次采样）。 */
  prevTick?: number;
  /** 上次采样的 progress。 */
  prevProgress?: number;
}

/** 环境画像输出。 */
export interface EnvironmentProfile {
  /** 市场活跃度：active（>100 单 + credits>1M）/ moderate（>20 单）/ thin（其余）。 */
  marketActivity: "active" | "moderate" | "thin";
  /** 邻居竞争压力：high（>50% 被占）/ medium（>20%）/ low（其余）。 */
  neighborPressure: "high" | "medium" | "low";
  /** GCL 进度速率（progress/tick），缺失时为 0。 */
  gclProgressRate: number;
  /** 采样 tick。 */
  tick: number;
}

/**
 * 计算环境画像（P1-3 纯函数）。
 *
 * 消费方（empire-strategy）按画像调整策略参数——如市场活跃时提高矿物出售
 * 意愿、邻居密度高时收紧扩张半径、GCL 速率快时放宽远矿上限。
 *
 * @param tick  当前 tick。
 * @param market  市场快照。
 * @param density  邻居密度。
 * @param gcl  GCL 趋势。
 */
export function evaluateEnvironment(
  tick: number,
  market: MarketSnapshotInput,
  density: NeighborDensityInput,
  gcl: GclTrendInput,
): EnvironmentProfile {
  // 市场活跃度分级。
  let marketActivity: EnvironmentProfile["marketActivity"];
  if (market.totalOrders > 100 && market.credits > 1_000_000) {
    marketActivity = "active";
  } else if (market.totalOrders > 20) {
    marketActivity = "moderate";
  } else {
    marketActivity = "thin";
  }

  // 邻居竞争压力分级。
  const ownedRatio = density.totalNeighbors > 0
    ? density.ownedNeighbors / density.totalNeighbors
    : 0;
  let neighborPressure: EnvironmentProfile["neighborPressure"];
  if (ownedRatio > 0.5) {
    neighborPressure = "high";
  } else if (ownedRatio > 0.2) {
    neighborPressure = "medium";
  } else {
    neighborPressure = "low";
  }

  // GCL 进度速率（progress delta / tick delta）。
  let gclProgressRate = 0;
  if (gcl.prevTick !== undefined && gcl.prevProgress !== undefined) {
    const tickDelta = tick - gcl.prevTick;
    if (tickDelta > 0) {
      const progressDelta = gcl.progress - gcl.prevProgress;
      // 只计正增长（降级/重置不反映正常速率）。
      gclProgressRate = Math.max(0, progressDelta / tickDelta);
    }
  }

  return {
    marketActivity,
    neighborPressure,
    gclProgressRate,
    tick,
  };
}
