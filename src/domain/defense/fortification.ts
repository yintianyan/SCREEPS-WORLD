/**
 * 防御工事角色分类 — 纯函数，决定每个 wall/rampart 属于哪个维护档位。
 * 背景：统一目标血量是维护经济最大浪费源 — RCL5-6 把 ~75 个 rampart 全灌到 1M
 * （≈75 万能量）与升级争夺盈余，而多数（extension/container 叠盾）防御价值远低于
 * 周界割集。分层：周界全额、核心折扣、低值资产只保新生地板。
 * 分类优先级（先命中先归类）：wall → perimeter（不衰减一次投资）；min-cut 割集
 * → perimeter（敌人必啃的门）；核心结构位 → core；container → utility；未知位置：
 * 有 min-cut 情报 → utility（散盾无防线价值），无情报（扇区 fallback 房）→
 * perimeter（出口封锁 rampart 保守全额维护）。
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
 * 从快照 + min-cut 持久化数据构建分类上下文；每次维修决策构建一次
 * （O(结构数)，~100 项），无需跨 tick 缓存。minCutPositions 为扁平坐标
 * [x0,y0,x1,y1,...]，无数据传 undefined。
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
 * 分类单个防御工事；constructedWall 恒为 perimeter（不衰减的一次性路径封锁投资）。
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

/**
 * 受袭姿态判定（R3：战时闭环 — 帝国姿态 → 防御投资升档的统一口径）：
 * 本房真实受袭记忆（lastHostileAt 距今 < siegeMemoryTicks）恒触发升档 — 防御深度
 * 用真实威胁校准（既有行为不变）；帝国 war 姿态全局备战 — 本房未受袭也按受袭目标
 * 维护。fortify 不全局升档：单房一次 invader 目击不应烧全帝国墙血预算
 * （与 posture.ts 的 threatWindow 解耦同理）。posture 由调用方注入（纯函数不读 Memory）。
 */
export function resolveUnderSiege(
  posture: "develop" | "expand" | "fortify" | "war" | undefined,
  lastHostileAt: number | undefined,
  tick: number,
  siegeMemoryTicks: number,
): boolean {
  if (lastHostileAt !== undefined && tick - lastHostileAt < siegeMemoryTicks) return true;
  return posture === "war";
}
