/** L2 体外建议摄入系统 — 低频（每 1000 tick）从 segment 6 读取外部 LLM 建议包，
 * 经 intake-guardrail 六层护栏校验后，接受的建议写入 Memory.kernel.tuning.intakePending
 * （不直接写 strategyOverrides — 需经 strategy-reviewer 复核后才采纳）。
 *
 * 边界遵守 LLM_BOUNDARY.md：
 *   - 只读 segment 6（体外写入区）
 *   - 不直接执行 LLM 建议的值
 *   - 体外建议 → intakePending → strategy-reviewer 复核 → strategyOverrides → 生效
 *
 * 生命周期：
 *   1. segment 6 有数据 → JSON.parse → applyIntakeGuardrail
 *   2. accepted → 写入 intakePending（覆盖式，每批替换）
 *   3. strategy-reviewer 在 100t 复盘窗口中复核 intakePending（与 L1 建议合并/拒绝）
 *   4. 复核后 intakePending 清空
 */

import type { Priority, System, TickContext } from "../kernel/contracts";
import { CONFIG } from "../config";
import { SEGMENT_L2_INTAKE } from "../kernel/segment-store";
import { applyIntakeGuardrail } from "../domain/tuning/intake-guardrail";
import type { IntakeAccepted } from "../domain/tuning/intake-guardrail";
import type { StrategyOverrideEntry } from "../domain/strategy/strategy-reviewer";
import { EventKind, recordEvent } from "../kernel/event-log";
import { log } from "../kernel/log";
import { safeRun } from "../kernel/safe-run";

/** L2 摄入系统运行间隔（tick）。 */
const INTAKE_INTERVAL = 1000;

/** 策略参数冷却 tick（与 strategy-reviewer 一致）。 */
const STRATEGY_COOLDOWN_TICKS = 5000;

export const tuningIntakeSystem: System = {
  name: "tuning-intake",
  priority: 3 as Priority,
  interval: INTAKE_INTERVAL,
  phase: "main",

  run(ctx: TickContext): void {
    // conserve/recovery 下跳过 — LLM 建议在 CPU 紧张时不可信且不紧急
    if (ctx.budget.tier === "conserve" || ctx.budget.tier === "recovery") return;

    safeRun("tuning-intake", () => {
      // ── 1. 读取 segment 6 ──
      const raw = RawMemory.segments[SEGMENT_L2_INTAKE];
      if (raw === undefined) return; // 未激活或未写入 — 无操作

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        log.warn("tuning-intake", "segment 6 JSON parse failed — skipping");
        recordEvent(EventKind.L2Intake, "", [0, 1]); // accepted=0, rejected=1
        return;
      }

      // ── 2. 空包检测 ──
      if (payload === null || payload === undefined) return;

      // ── 3. 护栏校验 ──
      const currentOverrides = Memory.kernel?.tuning?.strategyOverrides;
      const result = applyIntakeGuardrail(
        payload,
        ctx.tick,
        currentOverrides,
        STRATEGY_COOLDOWN_TICKS,
      );

      // ── 4. 写入 intakePending ──
      if (result.accepted.length > 0) {
        if (!Memory.kernel) Memory.kernel = {};
        if (!Memory.kernel.tuning) {
          Memory.kernel.tuning = { lastTuned: 0, rooms: {} };
        }
        // 覆盖式写入 — 每批 L2 建议替换上一批
        const intakeMap: Record<string, IntakePendingEntry> = {};
        for (const acc of result.accepted) {
          intakeMap[acc.param] = {
            value: acc.value,
            originalValue: acc.originalValue,
            reason: acc.reason,
            receivedAt: ctx.tick,
          };
        }
        Memory.kernel.tuning.intakePending = intakeMap;
      } else {
        // 无接受建议 → 清空 intakePending（避免上批残留被反复复核）
        if (Memory.kernel?.tuning?.intakePending) {
          delete Memory.kernel.tuning.intakePending;
        }
      }

      // ── 5. 事件 + 日志 ──
      recordEvent(EventKind.L2Intake, "", [result.accepted.length, result.rejected.length]);
      if (result.accepted.length > 0) {
        log.info("tuning-intake", result.summary);
      } else if (result.rejected.length > 0) {
        log.warn("tuning-intake", result.summary);
      }
    }, false);
  },
};

/** intakePending 条目类型（与 global.d.ts IntakePendingEntry 对齐）。 */
export interface IntakePendingEntry {
  /** 经钳制后的建议值。 */
  value: number;
  /** LLM 原始建议值（钳制前，诊断用）。 */
  originalValue: number;
  /** 建议理由。 */
  reason: string;
  /** 摄入 tick。 */
  receivedAt: number;
}
