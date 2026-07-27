/**
 * 防御工事角色分类 — 纯函数，决定每个 wall/rampart 属于哪个维护档位。
 *
 * 背景：统一目标血量是维护经济的最大浪费源 — RCL5-6 把 ~75 个 rampart
 * 全部灌到 1M（≈75 万能量）与 controller 升级直接争夺盈余，
 * 而其中大多数（extension 叠盾、container 叠盾）的防御价值远低于周界割集。
 * 分层后：周界全额、核心折扣、低值资产只保新生地板。
 *
 * 分类优先级（先命中先归类）：
 *   1. constructedWall → perimeter（wall 天然是路径封锁物，不衰减，一次性投资）
 *   2. min-cut 割集位置 → perimeter（敌人必啃的门）
 *   3. 核心结构位置（spawn/extension/storage/tower/link）→ core
 *   4. container 位置 → utility
 *   5. 未知位置：有 min-cut 情报 → utility（割集外的散盾无防线价值）；
 *      无 min-cut 情报（扇区防御 fallback 房）→ perimeter（出口封锁 rampart
 *      不在任何结构位上，保守按周界全额维护，避免防线降档）。
 */
import type { FortificationRole, RoomSnapshot } from "../../kernel/contracts";

/** 打包坐标为单数字 key（与 defense-planner 的 minCut 存储口径一致）。 */
export function packFortXY(x: number, y: number): number {
  return x * 50 + y;
}

/** 分类上下文 — 三个位置集合，由 buildFortificationContext 预建。 */
export interface FortificationContext {
  /** min-cut 割集位置（来自 Memory.rooms[*].minCut.positions）。 */
  readonly minCutSet: ReadonlySet<number>;
  /** 核心结构位置（spawn/extension/storage/tower/link）。 */
  readonly coreSet: ReadonlySet<number>;
  /** 低值资产位置（container）。 */
  readonly utilitySet: ReadonlySet<number>;
}

/**
 * 从快照 + min-cut 持久化数据构建分类上下文。
 * 每次维修决策构建一次（O(结构数)，~100 项），无需跨 tick 缓存。
 *
 * @param minCutPositions Memory 中的扁平坐标数组 [x0,y0,x1,y1,...]，无数据传 undefined
 */
export function buildFortificationContext(
  snapshot: Pick<RoomSnapshot, "spawns" | "extensions" | "towers" | "links" | "containers" | "storage">,
  minCutPositions: readonly number[] | undefined,
): FortificationContext {
  const minCutSet = new Set<number>();
  if (minCutPositions) {
    for (let i = 0; i + 1 < minCutPositions.length; i += 2) {
      minCutSet.add(packFortXY(minCutPositions[i]!, minCutPositions[i + 1]!));
    }
  }

  const coreSet = new Set<number>();
  for (const s of snapshot.spawns) coreSet.add(packFortXY(s.pos.x, s.pos.y));
  for (const s of snapshot.extensions) coreSet.add(packFortXY(s.pos.x, s.pos.y));
  for (const s of snapshot.towers) coreSet.add(packFortXY(s.pos.x, s.pos.y));
  for (const s of snapshot.links) coreSet.add(packFortXY(s.pos.x, s.pos.y));
  if (snapshot.storage) coreSet.add(packFortXY(snapshot.storage.pos.x, snapshot.storage.pos.y));

  const utilitySet = new Set<number>();
  for (const c of snapshot.containers) utilitySet.add(packFortXY(c.pos.x, c.pos.y));

  return { minCutSet, coreSet, utilitySet };
}

/**
 * 分类单个防御工事。
 *
 * @param isWall constructedWall 恒为 perimeter（不衰减的一次性路径封锁投资）
 */
export function classifyFortification(
  x: number,
  y: number,
  isWall: boolean,
  ctx: FortificationContext,
): FortificationRole {
  if (isWall) return "perimeter";
  const packed = packFortXY(x, y);
  if (ctx.minCutSet.has(packed)) return "perimeter";
  if (ctx.coreSet.has(packed)) return "core";
  if (ctx.utilitySet.has(packed)) return "utility";
  // 未知位置：有 min-cut 情报时，割集外的散盾无防线价值 → utility；
  // 无情报（扇区防御房）时保守按周界 → 出口封锁 rampart 不降档。
  return ctx.minCutSet.size > 0 ? "utility" : "perimeter";
}
