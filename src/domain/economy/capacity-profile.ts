/** Capacity Model */

import type { RoomEconomicProfile } from "./room-profile";
import { NOMINAL_INCOME_PER_SOURCE } from "./accounting";

/**
 * Room Capacity Profile — 产能维度剖面。

 * 五域容量（ECONOMY §2.1 + GOAL_POLICY_PLAN §4 五域预算下钻）：
 * - Energy Production：source 产能 × 效率系数（Income 上界）
 * - Energy Storage：storage/terminal/link 总容量（储备上界）
 * - Spawn Capacity：spawn+extension 总容量（孵化吞吐上界）
 * - Logistics Capacity：hauler 运力 × 趟频率（物流吞吐上界，近似）
 * - Construction Capacity：builder 编制 × 单趟建造量（建造吞吐上界，近似）

 * 效率系数从实测收入速率 ÷ 名义产能 EMA 平滑（ECONOMY §2.1）。
 * 本模型只组装剖面，不做预算分配（分配在 Empire Budget，步 9）。
 */
export interface RoomCapacityProfile {
  /** 房间名。 */
  roomName: string;

  // ── Energy Production Capacity ──
  /** source 数。 */
  sourceCount: number;
  /** 名义产能（source 数 × 10 能量/tick）。 */
  nominalCapacity: number;
  /** 效率系数（0..1，来自 EconomyQuery.efficiency）。 */
  efficiency: number;
  /** 有效产能 = 名义 × 效率（能量/tick，= estimateIncome）。 */
  effectiveCapacity: number;
  /** 产能利用率 = estimatedIncome / nominalCapacity（0..1，与 efficiency 同值）。 */
  utilization: number;

  // ── Energy Storage Capacity ──
  /** storage 容量（无 storage 为 0）。 */
  storageCapacity: number;
  /** terminal 能量容量（无 terminal 为 0）。 */
  terminalCapacity: number;
  /** link 总容量（无 link 为 0）。 */
  linkCapacity: number;
  /** 储备总容量 = storage + terminal + link。 */
  totalReserveCapacity: number;
  /** 当前储备水位比例（0..1）。 */
  reserveUtilization: number;

  // ── Spawn Capacity ──
  /** spawn + extension 总容量（= energyCapacityAvailable）。 */
  spawnCapacity: number;
  /** 当前可用比例（= energyAvailable / energyCapacityAvailable，0..1）。 */
  spawnUtilization: number;
  /** spawn 数。 */
  spawnCount: number;

  // ── Logistics Capacity（近似）──
  /** hauler 编制（从 harvesterCount 近似，实际由 demand 产出）。 */
  haulerCount: number;
  /** 参考运力（6 CARRY = 300，CONFIG.economy.referenceCarryCapacity）。 */
  referenceCarry: number;
  /** 近似物流吞吐 = haulerCount × referenceCarry / 50（每 tick，粗估）。 */
  logisticsThroughput: number;

  // ── Construction Capacity（近似）──
  /** builder 编制（从 harvesterCount 近似，实际由 demand 产出）。 */
  builderCount: number;
  /** 近似建造吞吐 = builderCount × 50（每 tick，5 WORK × 10 = 50，粗估）。 */
  constructionThroughput: number;

  // ── 派生 ──
  /**
   * 产能瓶颈类型（五域中利用率最高者）。
   * 用于 Empire 判断房间发展受限在哪个环节。
   */
  bottleneck: "production" | "storage" | "spawn" | "logistics" | "construction" | "none";
}

/**
 * 组装 Room Capacity Profile。

 * 输入：
 * - profile: RoomEconomicProfile（已组装的经济剖面，步 1 产出）
 * - haulerCount / builderCount: 人口编制（由调用方从 demand 或 census 采集）
 * - terminalCapacity / linkCapacity: 结构容量（由调用方从 snapshot 采集）
 * - spawnCount: spawn 数量
 * - referenceCarry: 参考运力（CONFIG.economy.referenceCarryCapacity）

 * 纯函数 — 不引用 Game/Memory。
 */
export function buildRoomCapacityProfile(
  profile: RoomEconomicProfile,
  haulerCount: number,
  builderCount: number,
  terminalCapacity: number,
  linkCapacity: number,
  spawnCount: number,
  referenceCarry: number,
): RoomCapacityProfile {
  const sourceCount = profile.sourceCount;
  const nominalCapacity = sourceCount * NOMINAL_INCOME_PER_SOURCE;
  const efficiency = profile.efficiency;
  const effectiveCapacity = profile.estimatedIncome;
  const utilization = nominalCapacity > 0
    ? Math.max(0, Math.min(1, effectiveCapacity / nominalCapacity))
    : 0;

  const storageCapacity = profile.storageCapacity;
  const totalReserveCapacity = storageCapacity + terminalCapacity + linkCapacity;
  const reserveUtilization = totalReserveCapacity > 0
    ? Math.max(0, Math.min(1, profile.contractReserve / totalReserveCapacity))
    : 0;

  const spawnCapacity = profile.energyCapacityAvailable;
  const spawnUtilization = spawnCapacity > 0
    ? Math.max(0, Math.min(1, profile.energyAvailable / spawnCapacity))
    : 0;

  const logisticsThroughput = Math.round((haulerCount * referenceCarry) / 50);
  const constructionThroughput = builderCount * 50;

  // 瓶颈判定：五域中利用率/占比最高者。
  // production: efficiency < 0.5（产能利用率低）
  // storage: reserveUtilization > 0.9（接近满载）
  // spawn: spawnUtilization < 0.2（spawn 口袋空）
  // logistics: logisticsThroughput < effectiveCapacity（物流跟不上产能）
  // construction: constructionThroughput < effectiveCapacity（建造跟不上产能）
  // none: 无明显瓶颈
  let bottleneck: RoomCapacityProfile["bottleneck"] = "none";
  if (efficiency < 0.5 && nominalCapacity > 0) {
    bottleneck = "production";
  } else if (reserveUtilization > 0.9) {
    bottleneck = "storage";
  } else if (spawnUtilization < 0.2 && spawnCapacity > 0) {
    bottleneck = "spawn";
  } else if (logisticsThroughput < effectiveCapacity && effectiveCapacity > 0) {
    bottleneck = "logistics";
  } else if (constructionThroughput < effectiveCapacity && effectiveCapacity > 0) {
    bottleneck = "construction";
  }

  return {
    roomName: profile.roomName,
    sourceCount,
    nominalCapacity,
    efficiency,
    effectiveCapacity,
    utilization,
    storageCapacity,
    terminalCapacity,
    linkCapacity,
    totalReserveCapacity,
    reserveUtilization,
    spawnCapacity,
    spawnUtilization,
    spawnCount,
    haulerCount,
    referenceCarry,
    logisticsThroughput,
    builderCount,
    constructionThroughput,
    bottleneck,
  };
}
