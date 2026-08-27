/** K-6 相位偏移 — 零依赖纯函数（独立文件防止导入链污染）：放 kernel.ts 会让 */

/** 字符串 → [0, interval) 稳定哈希（DJB-like 变种）。
 * systemPhase 与 roomPhase 共用同一哈希算法，避免两处相位偏移漂移到
 * 不同哈希族导致错峰效果不可预期。 */
function hashPhase(key: string, interval: number): number {
  if (!interval || interval <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % interval;
}

/** 系统的 interval 相位偏移 — 按名称哈希稳定分散到 [0, interval)。
 * kernel.shouldRunSystem 与内部有二级采样调度的系统（如 telemetry-collector 的
 * %50/%100 门）必须共用本函数：内部门用 (tick - phase) % N === 0 做相位相对判定 —
 * 绝对对齐 tick % N === 0 与错峰后的运行 tick 可能无交集，采样会静默永久失效。 */
export function systemPhase(name: string, interval: number): number {
  return hashPhase(name, interval);
}

/** P1-F：房间的相位偏移 — 按房间名哈希稳定分散到 [0, interval)。
 * layout-planner 用此为每房 nextPlanTick 加偏移，消除「N 个房每 50 tick 在同一
 * tick 扎堆重规划」的 CPU 尖峰节律。与 systemPhase 同算法但语义独立（错峰系统
 * 运行 tick vs 错峰房间规划起点），共用 hashPhase 保证哈希族一致。纯函数。 */
export function roomPhase(roomName: string, interval: number): number {
  return hashPhase(roomName, interval);
}
