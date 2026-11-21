/** 系统相位偏移 — 零依赖纯函数（独立文件防止导入链污染）：放 kernel.ts 会让 */

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

/** 房间的相位偏移 — 按房间名哈希稳定分散到 [0, interval)。
 * layout-planner 用此为每房 nextPlanTick 加偏移，消除「N 个房每 50 tick 在同一
 * tick 扎堆重规划」的 CPU 尖峰节律。与 systemPhase 同算法但语义独立（错峰系统
 * 运行 tick vs 错峰房间规划起点），共用 hashPhase 保证哈希族一致。纯函数。 */
export function roomPhase(roomName: string, interval: number): number {
  return hashPhase(roomName, interval);
}

/**
 * 低频内部门 —— cadence 无关的「距上次执行 ≥ interval」判定（与 heap 钟配对使用：
 * gate 放行且真正执行后，调用方才把钟拨到本拍；被预算拒掉时**不拨钟**，下个运行拍重试）。
 *
 * 为什么不能用 `tick % interval === phase`：系统的**运行拍序列**由 cadence 覆盖层
 * （CONFIG.cpu.cadenceOverrides）错峰到某个剩余类，绝对取模门要求 tick 同时落在
 * 另一个剩余类 —— 两个类可能**永无交集**，门静默永久失效。
 * 实证：2026-10-23 G6 把 empire-strategy 覆盖为每 5 拍（运行拍 ≡4 mod 5）后，其内部
 * 绝对门 env（tick%100===0，≡0 mod 5）与 specialization-planner（tick%100===16，
 * ≡1 mod 5）双双永无命中 —— 随 11-19 重构战役部署生效起，环境画像与专业化规划
 * （供给合同清理/pb 清扫/networkSnapshot 消费链）静默停摆 58 万拍（2026-11-21 线上
 * 实测：env.tick 与 supplyContracts 僵尸 ca=83316316 双双冻结）。room-observer 同案
 * 在册（其修法是锁死 cadence=1）；本门是对任何 cadence 都可命中的通用形。
 * lastTick 缺失（boot/global reset）⇒ 立即放行：采样与规划均幂等，早跑无害。
 */
export function cadenceSafeGate(
  lastTick: number | undefined,
  tick: number,
  interval: number,
): boolean {
  return lastTick === undefined || tick - lastTick >= interval;
}
