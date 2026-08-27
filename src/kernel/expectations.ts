/** 期望自检 — 帝国的「自我体感」：对运行时序不变式做周期性断言。 */
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
  /** 本次 boot 首 tick（kernel 注入）；缺省按无限老处理（兼容测试）。 */
  bootTick?: number;
  statsLastSample?: number;
  systemLastRun: Readonly<Record<string, number>>;
  p3Systems: readonly P3SystemRef[];
}): ExpectationResult {
  const violations: ExpectationViolation[] = [];
  let p3Starved = false;

  // E2 相对宽限基准：reset 后系统需数个 interval 才能各跑一遍。
  const bootAge = input.tick - (input.bootTick ?? -Infinity);

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
  if (bootAge >= P3_BOOT_GRACE_TICKS) {
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
