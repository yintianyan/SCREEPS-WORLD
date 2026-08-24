/**
 * Resource Imbalance Detection — A2 后半·步 6：跨房资源余缺检测 + 调拨候选。
 *
 * 合同锚点：ECONOMY §1.2 调拨门控（surplus → deficit 的 Transfer Request 候选）。
 *
 * 定位：Empire 每个周期从 EmpireResourceView 中发现 surplus 房与 deficit 房，
 * 生成 ResourceImbalance 列表（只检测，不执行调拨）。
 *
 * 严格禁止（A2 后半红线）：
 *   - 不执行跨房运输、不下 terminal 订单、不绕过 Request Pool
 *   - 只产出 TransferCandidate 候选列表，供下一阶段（A3）消费
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { EmpireResourceView } from "./resource-view";
import type { RoomEconomicProfile } from "../economy/room-profile";
import { canExportEnergy, needsEnergyAid } from "../economy/room-profile";

/**
 * 单条调拨候选（surplus → deficit 的配对建议）。
 *
 * 不变量：
 *   - from 房间 canExportEnergy=true（满足调拨门控前置）
 *   - to 房间 needsEnergyAid=true（满足受援侧门控）
 *   - amount = min(from 可调拨量, to 缺口量)
 *   - 不执行——只供 Planning Input 消费
 */
export interface TransferCandidate {
  /** 调出房。 */
  fromRoom: string;
  /** 调入房。 */
  toRoom: string;
  /** 资源类型（当前仅 energy；mineral 互济在 mineral-logistics.ts）。 */
  resource: "energy";
  /** 建议调拨量。 */
  amount: number;
  /** 调出房可调拨量。 */
  fromSurplus: number;
  /** 调入房缺口量。 */
  toDeficit: number;
}

/**
 * 资源余缺检测结果。
 */
export interface ResourceImbalanceResult {
  /** 采样 tick。 */
  tick: number;
  /** 是否存在余缺不均。 */
  hasImbalance: boolean;
  /** 调拨候选列表（已排序：缺口大的优先）。 */
  candidates: TransferCandidate[];
  /** surplus 房间数。 */
  surplusCount: number;
  /** deficit 房间数。 */
  deficitCount: number;
}

/**
 * 计算房间的可调拨余量（surplus）。
 *
 * 门控前置（ECONOMY §1.2）：
 *   - canExportEnergy=true 才有 surplus
 *   - surplus = storageEnergy × exportRatio（保守估值，不抽干）
 *
 * 纯函数。
 */
export function computeSurplus(profile: RoomEconomicProfile, exportRatio = 0.3): number {
  if (!canExportEnergy(profile)) return 0;
  return Math.floor(profile.storageEnergy * exportRatio);
}

/**
 * 计算房间的缺口量（deficit）。
 *
 * 门控前置（ECONOMY §1.2）：
 *   - needsEnergyAid=true 才有 deficit
 *   - deficit = 保守估计的援助量（riskBuffer × p0p1Consumption 近似，上限 5000）
 *
 * 纯函数。
 */
export function computeDeficit(profile: RoomEconomicProfile): number {
  if (!needsEnergyAid(profile)) return 0;
  // 缺口量保守估计：至少 1000（紧急援助），上限 5000（防单次抽干 surplus 房）
  if (profile.estimatedIncome > 0) {
    // 有产能但入不敷出 → 援助量 = 预计 200 tick 的缺口
    const gap = Math.abs(profile.netFlow) * 200;
    return Math.max(1000, Math.min(5000, Math.round(gap)));
  }
  // 无产能 → 基础援助量
  return 2000;
}

/**
 * 检测跨房资源余缺并生成调拨候选。
 *
 * 算法：
 *   1. 遍历 profiles，分出 surplus 房列表和 deficit 房列表
 *   2. 按缺口量降序排列 deficit 房
 *   3. 对每个 deficit 房，从 surplus 池中按余量降序匹配
 *   4. 生成 TransferCandidate（amount = min(surplus, deficit)）
 *
 * 纯函数 — 不执行调拨，不写状态。
 *
 * @param profiles 各房 RoomEconomicProfile
 * @param view EmpireResourceView（用于 hasImbalance 交叉验证）
 * @param tick 当前 tick
 * @param exportRatio surplus 抽取比例（默认 0.3，不抽干）
 */
export function detectImbalance(
  profiles: readonly RoomEconomicProfile[],
  view: EmpireResourceView,
  tick: number,
  exportRatio = 0.3,
): ResourceImbalanceResult {
  // 分离 surplus 和 deficit
  const surplusList: { room: string; amount: number }[] = [];
  const deficitList: { room: string; amount: number }[] = [];

  for (const p of profiles) {
    const surplus = computeSurplus(p, exportRatio);
    const deficit = computeDeficit(p);
    if (surplus > 0) surplusList.push({ room: p.roomName, amount: surplus });
    if (deficit > 0) deficitList.push({ room: p.roomName, amount: deficit });
  }

  // 按缺口量降序（缺口大的优先匹配）
  deficitList.sort((a, b) => b.amount - a.amount);
  // 按余量降序（余量大的优先供给）
  surplusList.sort((a, b) => b.amount - a.amount);

  const candidates: TransferCandidate[] = [];

  // 贪心匹配：每个 deficit 房从 surplus 池中取
  // 使用剩余余量追踪（不修改原数组）
  const surplusRemaining = new Map<string, number>(
    surplusList.map(s => [s.room, s.amount]),
  );

  for (const d of deficitList) {
    for (const s of surplusList) {
      const remaining = surplusRemaining.get(s.room) ?? 0;
      if (remaining <= 0) continue;
      if (s.room === d.room) continue; // 不自配

      const amount = Math.min(remaining, d.amount);
      if (amount <= 0) continue;

      candidates.push({
        fromRoom: s.room,
        toRoom: d.room,
        resource: "energy",
        amount,
        fromSurplus: s.amount,
        toDeficit: d.amount,
      });

      surplusRemaining.set(s.room, remaining - amount);
      // deficit 的 amount 不从原始对象减（原始对象只记初始缺口），
      // 匹配继续到下一个 surplus 房直到缺口填满或 surplus 耗尽
      // 但为避免无限匹配，我们标记已匹配量
      break; // 每个 deficit 房匹配一个 surplus 房（简化：不做多源合并）
    }
  }

  const hasImbalance = surplusList.length > 0 && deficitList.length > 0;

  return {
    tick,
    hasImbalance,
    candidates,
    surplusCount: surplusList.length,
    deficitCount: deficitList.length,
  };
}

/**
 * 将调拨候选转换为帝国级 TransportRequest 候选（步 11 Request Scope 联动）。
 *
 * A2 后半只生成候选请求——不执行运输。
 * A3 阶段的 logistics 系统消费这些候选请求（scope="empire"）。
 *
 * 纯函数 — 不写状态、不触 Game/Memory。
 */
export function candidatesToEmpireRequests(
  candidates: readonly TransferCandidate[],
): import("../assignment/request-pool").TransportRequest[] {
  return candidates.map(c => ({
    key: `empire:${c.fromRoom}:${c.toRoom}:energy`,
    resource: "energy" as const,
    amount: c.amount,
    priority: 1 as 0 | 1 | 2 | 3,
    scope: "empire" as import("../assignment/request-pool").RequestScope,
    targetRoom: c.toRoom,
  }));
}
