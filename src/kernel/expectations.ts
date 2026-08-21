/**
 * 期望自检 — 帝国的「自我体感」：对运行时序不变式做周期性断言。
 *
 * 背景（P3 饥饿 ~13h 事故）：前馈判据自锁冻结了整个 P3 家族，而受害者之一
 * 恰是观测者自身 —— stats 冻结后没有任何内部通道能发现「系统没在跑」，
 * 直到人类外部轮询才暴露。本模块把「应该发生的事」显式化为期望并逐期核验：
 *
 *   E1 遥测新鲜度：stats.lastSample 距今不得超过 TELEMETRY_STALE_TICKS。
 *   E2 P3 存活：healthy/guarded 档下每个 P3 系统应在 interval × GRACE 内
 *      至少完整执行一次（boot 宽限期内豁免）。
 *
 * 违例处置（韧性梯度：检测 → 降级 → 自动旁路）：
 *   - 全部违例写入 Memory.kernel.expectations + ExpectationViolation 事件
 *     （可观测，供外部采集器/人类告警）；
 *   - E2 触发时设置 p3StarveBypassUntil —— scheduler.canStart 对前馈拒绝
 *     加旁路窗口（软/硬上限仍然生效），打破「冻结保证 max 不回落」的自锁。
 */
import type { EventKind } from "./event-log";

/** 遥测新鲜度阈值（采样间隔 10t，500t ≈ 50 个采样周期仍无更新即判停摆）。 */
export const TELEMETRY_STALE_TICKS = 500;
/** P3 存活宽限倍数（相对名义 interval）。 */
export const P3_GRACE_MULTIPLIER = 3;
/** boot 宽限：reset 后系统尚未各跑一遍的容忍窗。 */
export const P3_BOOT_GRACE_TICKS = 1500;
/** 饥饿旁路窗口时长（每次违例续期；软/硬上限不受旁路影响）。 */
export const P3_BYPASS_WINDOW_TICKS = 1200;

export interface ExpectationViolation {
  id: string;
  detail: string;
}

export interface ExpectationResult {
  violations: ExpectationViolation[];
  /** 任一 P3 系统存活违例 → true（调用方设置旁路与事件）。 */
  p3Starved: boolean;
}

export interface P3SystemRef {
  name: string;
  interval?: number;
}

export function evaluateExpectations(input: {
  tick: number;
  statsLastSample?: number;
  systemLastRun: Readonly<Record<string, number>>;
  p3Systems: readonly P3SystemRef[];
}): ExpectationResult {
  const violations: ExpectationViolation[] = [];
  let p3Starved = false;

  // E1 遥测新鲜度。
  const sampleAge = input.statsLastSample !== undefined
    ? input.tick - input.statsLastSample
    : Infinity;
  if (sampleAge > TELEMETRY_STALE_TICKS) {
    violations.push({
      id: "telemetryStale",
      detail: "lastSample age=" + (Number.isFinite(sampleAge) ? sampleAge : "never"),
    });
  }

  // E2 P3 存活（boot 宽限后生效）。
  if (input.tick > P3_BOOT_GRACE_TICKS) {
    for (const s of input.p3Systems) {
      const interval = Math.max(s.interval ?? 1, 1);
      const grace = interval * P3_GRACE_MULTIPLIER + P3_BOOT_GRACE_TICKS;
      const last = input.systemLastRun[s.name];
      const age = last === undefined ? Infinity : input.tick - last;
      if (age > grace) {
        violations.push({
          id: "p3Starved:" + s.name,
          detail: "age=" + (Number.isFinite(age) ? age : "never") + " grace=" + grace,
        });
        p3Starved = true;
      }
    }
  }

  return { violations, p3Starved };
}
