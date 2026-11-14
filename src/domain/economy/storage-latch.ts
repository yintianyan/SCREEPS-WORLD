/**
 * 富 storage 闩锁（Phase 2.5）。
 *
 * 单阈值 50K 会让 upgrade/lab 在 49K↔51K 之间每 tick 开合；
 * 用回差：低于 enter(50K) 关，涨到 resume(100K) 才重新开。
 */
import { flipLatch } from "../../core/scale";

export function nextStorageRichActive(
  previous: boolean | undefined,
  storageEnergy: number,
  enterThreshold: number,
  resumeThreshold: number,
): boolean {
  return flipLatch(
    previous === true,
    storageEnergy >= resumeThreshold,
    storageEnergy < enterThreshold,
    0,
    0,
    0,
  );
}

/**
 * 升级闸（Phase D）—— 按 RCL 分档。
 *
 * 关键区分：**RCL<8 的升级是刚性发育需求**（升 RCL 才能解锁 spawn/extension/lab），
 * **RCL8 的升级是可选的 GCL 复利**。两者不能用同一把尺：
 *
 * - RCL8：回差（50K 停 / 60K 复）。GCL 是长期复利，可以等 storage 回血。
 * - RCL<8：只用 `sprintStorage(50K)` 单门槛，**不带回差**。回差会在 50–60K 之间
 *   制造一段「明明够 50K 却因未达 60K 而停升级」的死区 —— 线上 W6N1（RCL7，
 *   storage 57.9K）与 W7N1（RCL6，41.6K）因此长期 0 upgrader，永远到不了 RCL8。
 *
 * 无 storage 的早期房返回 undefined（调用方回退旧行为：不节流）。
 */
export function nextUpgradeActive(
  previous: boolean | undefined,
  rcl: number,
  storageEnergy: number,
  enterThreshold: number,
  rcl8ResumeThreshold: number,
): boolean {
  if (rcl < 8) return storageEnergy >= enterThreshold;
  return nextStorageRichActive(previous, storageEnergy, enterThreshold, rcl8ResumeThreshold);
}
