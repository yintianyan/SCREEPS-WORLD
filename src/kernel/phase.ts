/**
 * K-6 相位偏移 — 零依赖纯函数（独立文件防止导入链污染）。
 *
 * 放 kernel.ts 会让轻量消费者（telemetry-collector 等）连带引入
 * scheduler 的模块顶层 CONFIG 求值，partial-mock config 的测试直接崩。
 */

/**
 * 字符串 → [0, interval) 稳定哈希（DJB-like 变种）。
 *
 * 抽出为共享函数：systemPhase 与 roomPhase 共用同一哈希算法，
 * 避免 layout-planner 相位偏移与 systemPhase 漂移到不同哈希族
 * 导致错峰效果不可预期。
 */
function hashPhase(key: string, interval: number): number {
  if (!interval || interval <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % interval;
}

/**
 * 系统的 interval 相位偏移 — 按名称哈希稳定分散到 [0, interval)。
 * kernel.shouldRunSystem 与内部有二级采样调度的系统（如 telemetry-collector
 * 的 %50/%100 门）必须共用本函数：内部门用 (tick - phase) % N === 0 做
 * 相位相对判定 — 绝对对齐 tick % N === 0 与错峰后的运行 tick
 * （tick ≡ phase mod interval）可能无交集，采样会静默永久失效。
 */
export function systemPhase(name: string, interval: number): number {
  return hashPhase(name, interval);
}

/**
 * P1-F：房间的相位偏移 — 按房间名哈希稳定分散到 [0, interval)。
 *
 * layout-planner 用此函数为每房的 nextPlanTick 加偏移，消除「N 个房
 * 每 50 tick 在同一 tick 扎堆重规划」的 CPU 尖峰节律。
 *
 * 与 systemPhase 同算法但语义独立：systemPhase 错峰系统运行 tick，
 * roomPhase 错峰房间规划起点。两者共用 hashPhase 保证哈希族一致。
 *
 * 纯函数 — 不访问 Game/Memory，可直接单元测试。
 */
export function roomPhase(roomName: string, interval: number): number {
  return hashPhase(roomName, interval);
}
