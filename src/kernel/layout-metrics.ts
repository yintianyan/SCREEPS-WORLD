/** 布局指标 Memory 持久化设施（纯函数已下沉 domain/layout/metrics.ts）。 */
import type { LayoutMetrics, DefenseCutInfo } from "../domain/layout/metrics";

export type { LayoutMetrics, DefenseCutInfo } from "../domain/layout/metrics";

/** 将指标落盘到 Memory.kernel.layoutMetrics[roomName]：仅变化时写入（稳定状态不产生
 * 序列化抖动，与 recordLayoutGaps 同策略）；房间无指标时删除条目（不留历史）。 */
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
