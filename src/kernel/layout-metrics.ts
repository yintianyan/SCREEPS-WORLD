/**
 * 布局可观测性指标（漏洞 #11）：为布局系统提供消费方驱动的反馈通道 — 死资产率、
 * link 利用率、拆改次数、MVC 缺口、防御完整性；每个指标都有明确的告警阈值和消费
 * 决策（见文档 §3.8「消费方」表），避免「系统在运行但无法证明决策是否改善」。
 * 落盘策略（plan §7）：存 Memory.kernel.layoutMetrics[roomName]，仅变化时写入；
 * 不进 segment — 重开后从 0 重采可接受。纯函数输入全参数注入，便于单测。
 */
import type { RoomSnapshot } from "./contracts";
import type { StructureGaps } from "../domain/layout/gaps";
import { MINCUT_ALGO_VERSION } from "../domain/layout/min-cut-defense";

/** 布局可观测性指标快照。 */
export interface LayoutMetrics {
  /** 死资产率 = deadLinks / totalLinks（0-1）。> 0.5 触发拆改评估。 */
  readonly deadAssetRate: number;
  /** link 利用率 = sum(energy) / sum(capacity)（0-1）。< 0.3 触发 link 网络审查。 */
  readonly linkUtilization: number;
  /** 累计拆改次数（单调递增）。增长但 deadAssetRate 不降 → 拆改机制失效告警。 */
  readonly dismantleCount: number;
  /** MVC 缺口数（当前，> 0 表示有未闭合的最小可用配置缺口）。 */
  readonly mvcGapCount: number;
  /** link 几何受限标记（controller+storage link 都放不下时为 true）。 */
  readonly linkConstrained: boolean;
  /** 防御完整性：min-cut 割集中 wall 占比（0-1）。< 0.7 防线弱点过多告警。 */
  readonly defenseWallRatio: number;
  /** 防御算法版本戳（监控 v3 部署进度，旧值表示缓存未失效）。 */
  readonly defenseAlgoVersion: string;
  /** rampart 割集弱点数（共格/走廊路 rampart 割集，需 tower 火力覆盖）。> 5 告警。 */
  readonly defenseRampartWeakPoints: number;
}

/** 防御指标采集输入（从 Memory.rooms[roomName].minCut 读取后注入）。 */
export interface DefenseCutInfo {
  /** min-cut 割集位置列表（complete=true 时有效）。空数组表示无缓存或未完成。 */
  readonly cutPositions: ReadonlyArray<{ x: number; y: number }>;
}

/**
 * 计算布局可观测性指标（纯函数，数据源全参数注入便于单测）。
 * 防御完整性：wallRatio = 割集中已建成 wall 位置数 / 割集总数；rampartWeakPoints =
 * 割集中已建成 rampart 位置数（弱点 = rampart 不挡通行）；未建成的割集位置不计入
 * 弱点（尚未施工，不算防线缺陷）。
 */
export function computeLayoutMetrics(
  snapshot: RoomSnapshot,
  gaps: StructureGaps,
  deadLinkCount: number,
  dismantleCount: number,
  linkConstrained: boolean,
  defenseCut: DefenseCutInfo,
): LayoutMetrics {
  // ── link 指标 ──
  const totalLinks = snapshot.links.length;
  let totalEnergy = 0;
  let totalCapacity = 0;
  for (const link of snapshot.links) {
    totalEnergy += link.store.getUsedCapacity(RESOURCE_ENERGY);
    totalCapacity += link.store.getCapacity(RESOURCE_ENERGY);
  }
  const deadAssetRate = totalLinks > 0 ? deadLinkCount / totalLinks : 0;
  const linkUtilization = totalCapacity > 0 ? totalEnergy / totalCapacity : 0;

  // ── MVC 缺口 ──
  const mvcGapCount = Object.keys(gaps).length;

  // ── 防御完整性 ──
  const { wallRatio, rampartWeakPoints } = computeDefenseMetrics(snapshot, defenseCut);

  return {
    deadAssetRate,
    linkUtilization,
    dismantleCount,
    mvcGapCount,
    linkConstrained,
    defenseWallRatio: wallRatio,
    defenseAlgoVersion: MINCUT_ALGO_VERSION,
    defenseRampartWeakPoints: rampartWeakPoints,
  };
}

/**
 * 计算防御完整性指标（被 computeLayoutMetrics 内部调用）。
 * wallRatio 高 = 防线主体是 wall（真正阻挡通行）；低 = 主体是 rampart（不挡通行，
 * 仅拖延）→ 弱点。rampartWeakPoints 位置因共格需求只能用 rampart，需 tower 火力覆盖。
 * 未建成的割集位置不计入弱点 — 只表示进度未完成，不算缺陷。
 */
function computeDefenseMetrics(
  snapshot: RoomSnapshot,
  defenseCut: DefenseCutInfo,
): { wallRatio: number; rampartWeakPoints: number } {
  const positions = defenseCut.cutPositions;
  if (positions.length === 0) return { wallRatio: 0, rampartWeakPoints: 0 };

  const cutSet = new Set<number>();
  for (const p of positions) cutSet.add(p.x * 50 + p.y);

  let wallInCut = 0;
  let rampartInCut = 0;
  for (const w of snapshot.walls) {
    if (cutSet.has(w.pos.x * 50 + w.pos.y)) wallInCut++;
  }
  for (const r of snapshot.ramparts) {
    if (cutSet.has(r.pos.x * 50 + r.pos.y)) rampartInCut++;
  }

  return {
    wallRatio: wallInCut / positions.length,
    rampartWeakPoints: rampartInCut,
  };
}

/** 将指标落盘到 Memory.kernel.layoutMetrics[roomName]：仅变化时写入（稳定状态不产生
 * 序列化抖动，与 recordLayoutGaps 同策略，plan §7）；房间无指标时删除条目（不留历史）。 */
export function recordLayoutMetrics(roomName: string, metrics: LayoutMetrics): void {
  Memory.kernel ??= {};
  const store = Memory.kernel.layoutMetrics ??= {};
  const prev = store[roomName];

  if (prev === undefined) {
    store[roomName] = { ...metrics };
    return;
  }

  if (
    prev.deadAssetRate === metrics.deadAssetRate &&
    prev.linkUtilization === metrics.linkUtilization &&
    prev.dismantleCount === metrics.dismantleCount &&
    prev.mvcGapCount === metrics.mvcGapCount &&
    prev.linkConstrained === metrics.linkConstrained &&
    prev.defenseWallRatio === metrics.defenseWallRatio &&
    prev.defenseAlgoVersion === metrics.defenseAlgoVersion &&
    prev.defenseRampartWeakPoints === metrics.defenseRampartWeakPoints
  ) {
    return;
  }

  store[roomName] = { ...metrics };
}

/** 从 Memory.rooms[roomName].minCut 读取割集位置并解包为 {x,y}[]（defense-planner 以
 * 扁平数组 [x1,y1,x2,y2,...] 存入，跨 global reset 存活）。无缓存或 complete=false 返回空数组。 */
export function readDefenseCutPositions(roomName: string): DefenseCutInfo {
  const minCutMem = Memory.rooms[roomName]?.minCut;
  if (!minCutMem || !minCutMem.complete) return { cutPositions: [] };
  const positions: { x: number; y: number }[] = [];
  const flat = minCutMem.positions;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    positions.push({ x: flat[i]!, y: flat[i + 1]! });
  }
  return { cutPositions: positions };
}
