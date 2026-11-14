import { globalCache } from "../../kernel/global-cache";
import { CONFIG } from "../../config";
import { marketOutletState } from "../industry/market-outlet";
import type { RoomSnapshot } from "../../kernel/contracts";

/**
 * home mineral 停采闩锁（Phase C）。
 *
 * home mineral 总库存 ≥10K 且无 ticket 时停采；<5K 或有新 ticket 时恢复。
 * 回差避免在单阈值附近反复启停；ticket 优先保证有真实下游需求时不被库存闸饿死。
 */

/** 停采线：库存达到此值时关闭采矿（无 ticket 时）。 */
export const HOME_MINERAL_STOP_STOCK = 10000;

/** 恢复线：关闭后库存必须跌破此值才恢复（回差）。 */
export const HOME_MINERAL_RESUME_STOCK = 5000;

/**
 * 计算下一 tick 是否允许采矿。纯函数。
 *
 * - 有 ticket（lab/factory/援助/买盘）→ 始终允许；
 * - 已开启：库存 < stopStock 时继续，达到 stopStock 关闭；
 * - 已关闭：库存 < resumeStock 才恢复。
 *
 * @param previous 上一 tick 状态；undefined = 首次运行（按 resumeStock 冷启动）。
 */
export function nextHomeMineralMiningActive(
  previous: boolean | undefined,
  stock: number,
  hasDemand: boolean,
  stopStock: number = HOME_MINERAL_STOP_STOCK,
  resumeStock: number = HOME_MINERAL_RESUME_STOCK,
): boolean {
  if (hasDemand) return true;
  if (previous === true) return stock < stopStock;
  return stock < resumeStock;
}

/** Phase C：lab 侧是否真的需要该 home mineral。
 * 只看本矿的装料需求与反应计划步骤，避免「lab 要 O」把 H 的停采闸一直顶开。 */
function labNeedsHomeMineral(roomMem: unknown, roomName: string, mineral: string): boolean {
  const table = globalCache().labDemands?.byRoom[roomName];
  if (table?.loads.some(load => load.resource === mineral)) return true;

  const plan = (
    roomMem as
      | {
          industry?: {
            reactionPlan?: {
              steps?: readonly { input1?: string; input2?: string }[];
            };
          };
        }
      | undefined
  )?.industry?.reactionPlan;
  return (plan?.steps ?? []).some(step => step.input1 === mineral || step.input2 === mineral);
}

/** Phase C：home mineral 是否存在真实 ticket。
 * ticket 来源按「谁会把矿消耗/搬走」枚举：lab 供料表、市场采购需求、跨房援助/计划出口票、
 * 真实买盘、factory 当前配方组件。任一存在即允许采矿 —— 库存闸只拦「没有任何下游去向」的堆积。 */
export function hasHomeMineralDemand(
  snapshot: RoomSnapshot,
  roomMem: unknown,
  mineral: string,
  tick: number,
): boolean {
  if (labNeedsHomeMineral(roomMem, snapshot.roomName, mineral)) return true;

  const procurement = globalCache().procurementDemands?.byRoom[snapshot.roomName] ?? [];
  if (procurement.some(d => d.resource === mineral && d.deadline > tick)) return true;

  const exports = globalCache().exportNeeds?.byRoom[snapshot.roomName] ?? [];
  if (exports.some(n => n.resource === mineral && n.deadline > tick)) return true;

  const cache = globalCache().marketOrderCache;
  if (marketOutletState(mineral, cache, tick, CONFIG.market.interval + 50) === "yes") return true;

  const target = globalCache().factoryTargets?.[snapshot.roomName];
  if (target !== undefined) {
    const table = (
      globalThis as {
        COMMODITIES?: Record<string, { components?: Record<string, number> }>;
      }
    ).COMMODITIES;
    const components = table?.[target]?.components;
    if (components !== undefined && (components[mineral] ?? 0) > 0) return true;
  }

  return false;
}
