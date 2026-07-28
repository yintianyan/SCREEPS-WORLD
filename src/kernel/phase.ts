/**
 * K-6 相位偏移 — 零依赖纯函数（独立文件防止导入链污染）。
 *
 * 放 kernel.ts 会让轻量消费者（telemetry-collector 等）连带引入
 * scheduler 的模块顶层 CONFIG 求值，partial-mock config 的测试直接崩。
 */

/**
 * 系统的 interval 相位偏移 — 按名称哈希稳定分散到 [0, interval)。
 * kernel.shouldRunSystem 与内部有二级采样调度的系统（如 telemetry-collector
 * 的 %50/%100 门）必须共用本函数：内部门用 (tick - phase) % N === 0 做
 * 相位相对判定 — 绝对对齐 tick % N === 0 与错峰后的运行 tick
 * （tick ≡ phase mod interval）可能无交集，采样会静默永久失效。
 */
export function systemPhase(name: string, interval: number): number {
  if (!interval || interval <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % interval;
}
