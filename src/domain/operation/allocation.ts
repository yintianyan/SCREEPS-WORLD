/**
 * Allocation Policy — A3.0 多对多资源分配策略
 *（ECONOMY §1.2 跨房调拨权）。
 *
 * 给定 surplus 房间列表和 deficit 房间列表，
 * 计算最优的 (source, target, amount) 三元组列表。
 *
 * 策略：
 *   1. 按紧急度排序 deficit（riskBuffer 升序）
 *   2. 按富余度排序 surplus（transferable 降序）
 *   3. 贪心分配：从最紧急的 deficit 开始，从最富余的 surplus 取
 *   4. 安全储备保护：不抽干 source（transferable 已扣除安全线）
 *   5. 单 source 不超载：同时最多服务 N 个 deficit（默认 2）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { RoomRegistryEntry } from "../strategy/room-registry";
import type { OperationPriority } from "./agenda-item";

/** 单条分配计划。 */
export interface AllocationPlan {
  /** 源房名。 */
  sourceRoom: string;
  /** 目标房名。 */
  targetRoom: string;
  /** 分配量。 */
  amount: number;
  /** 优先级（由 deficit 紧急度推导）。 */
  priority: OperationPriority;
}

/** 单个 source 同时服务的最大 deficit 数。 */
const MAX_DEFICITS_PER_SOURCE = 2;

/** 单次调拨最小量（低于此量不调拨，不值得跨房运输成本）。 */
const MIN_TRANSFER_AMOUNT = 1000;

/**
 * 计算分配计划 — 贪心多对多分配。
 *
 * @param surplusRooms 可对外输出的房间（按 transferable 降序排列）
 * @param deficitRooms 需要援助的房间（按 riskBuffer 升序排列）
 * @param inTransitByTarget 已在途量 by target room（排除已在调拨中的量）
 * @returns 分配计划列表
 */
export function allocateMultiRoom(
  surplusRooms: readonly RoomRegistryEntry[],
  deficitRooms: readonly RoomRegistryEntry[],
  inTransitByTarget: ReadonlyMap<string, number> = new Map(),
): AllocationPlan[] {
  const plans: AllocationPlan[] = [];

  // 复制 surplus 可用量（分配时递减）
  const available = new Map<string, number>();
  const sourceLoad = new Map<string, number>(); // 每个 source 已服务的 deficit 数
  for (const s of surplusRooms) {
    available.set(s.roomName, s.transferable);
    sourceLoad.set(s.roomName, 0);
  }

  // deficit 已按紧急度排序（riskBuffer 升序）
  for (const deficit of deficitRooms) {
    const inTransit = inTransitByTarget.get(deficit.roomName) ?? 0;

    // deficit 量 = |storageCapacity × safetyRatio - storageEnergy| 或按缺口推导
    // 这里使用 riskBuffer 的倒数作为需求强度代理：
    // 缺口越大 = riskBuffer 越小 → 需求越大
    const targetNeed = estimateDeficitAmount(deficit, inTransit);
    if (targetNeed < MIN_TRANSFER_AMOUNT) continue;

    let remaining = targetNeed;

    // 从最富余的 source 开始分配
    for (const source of surplusRooms) {
      if (remaining < MIN_TRANSFER_AMOUNT) break;
      const srcLoad = sourceLoad.get(source.roomName) ?? 0;
      if (srcLoad >= MAX_DEFICITS_PER_SOURCE) continue;

      const srcAvail = available.get(source.roomName) ?? 0;
      if (srcAvail < MIN_TRANSFER_AMOUNT) continue;

      const allocate = Math.min(remaining, srcAvail);
      if (allocate < MIN_TRANSFER_AMOUNT) continue;

      plans.push({
        sourceRoom: source.roomName,
        targetRoom: deficit.roomName,
        amount: allocate,
        priority: derivePriority(deficit),
      });

      available.set(source.roomName, srcAvail - allocate);
      remaining -= allocate;
      sourceLoad.set(source.roomName, srcLoad + 1);

      if (remaining < MIN_TRANSFER_AMOUNT) break;
    }
  }

  return plans;
}

/**
 * 估算 deficit 需求量。
 *
 * 基于 riskBuffer 和 estimatedIncome 推导：
 *   need ≈ max(0, safetyTarget - storageEnergy - inTransit)
 *   safetyTarget = storageCapacity × 0.3（最低安全水位）
 *
 * 对于无 storage 的 candidate 房：
 *   need ≈ estimatedIncome × 500（约 500 tick 的收入量，作为种子能量）
 */
function estimateDeficitAmount(
  deficit: RoomRegistryEntry,
  inTransit: number,
): number {
  if (deficit.hasStorage && deficit.storageCapacity > 0) {
    const safetyTarget = deficit.storageCapacity * 0.3;
    const need = Math.max(0, safetyTarget - deficit.storageEnergy - inTransit);
    return Math.floor(need);
  }
  // 无 storage 的 candidate 房 — 给种子能量
  const seedNeed = Math.max(0, deficit.estimatedIncome * 500 - inTransit);
  return Math.floor(Math.min(seedNeed, 10000)); // 上限 10k
}

/**
 * 从 deficit 紧急度推导操作优先级。
 * riskBuffer < 100 → P0（生存级）
 * riskBuffer < 400 → P1（高危）
 * riskBuffer < 1000 → P2（正常）
 * else → P3（低）
 */
function derivePriority(deficit: RoomRegistryEntry): OperationPriority {
  if (deficit.isStruggling) return 0; // recovery/bootstrap → P0
  if (deficit.riskBuffer < 100) return 0;
  if (deficit.riskBuffer < 400) return 1;
  if (deficit.riskBuffer < 1000) return 2;
  return 3;
}

/**
 * 计算指定 source 房的活跃分配总量。
 * 用于更新 transferable 前扣除已在途量。
 */
export function sumAllocationsBySource(
  plans: readonly AllocationPlan[],
  sourceRoom: string,
): number {
  let sum = 0;
  for (const p of plans) {
    if (p.sourceRoom === sourceRoom) sum += p.amount;
  }
  return sum;
}

/**
 * 计算指定 target 房的活跃分配总量。
 */
export function sumAllocationsByTarget(
  plans: readonly AllocationPlan[],
  targetRoom: string,
): number {
  let sum = 0;
  for (const p of plans) {
    if (p.targetRoom === targetRoom) sum += p.amount;
  }
  return sum;
}
