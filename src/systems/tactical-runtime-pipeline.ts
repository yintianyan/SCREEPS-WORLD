/**
 * Tactical Runtime Pipeline — A5.4 战术运行时合并薄壳。
 *
 * R10 ADR 合并产物：将 A5.4.1–A5.4.4 四个独立 System 合并为 1 个 pipeline。
 *
 * 设计原理：
 *   - 四个战术 System 全部是 P2 main 阶段，仅在 war 姿态下有实际工作量
 *   - 它们有严格的 pipeline 依赖关系：
 *     tactical-runtime(10t) → squad-movement(1t) → tactical-engagement(3t) → combat-micro(3t)
 *   - interval 不同：tactical-runtime=10t, squad-movement=1t, tactical-engagement=3t, combat-micro=3t
 *   - 合并后 interval=1（取最小），内部按各阶段原始 interval 分频执行
 *   - 各阶段的 run() 逻辑完全保留，只是从独立 System 变为 pipeline 内部 stage 调用
 *
 * 注意：combat-micro-system 原本未注册（import 了但没 register），合并后正式纳入。
 *      这不改变运行时行为——它的 run() 在非 war 姿态下是 no-op。
 *
 * 合同锚点：R10 ADR（ARCHITECTURE_FREEZE.md §15）+ A5.4.1-A5.4.4 各自合同。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { systemPhase } from "../kernel/phase";

// 各阶段 System 定义（保留原文件中的 run 逻辑）
import { tacticalRuntimeSystem } from "./tactical-runtime-system";
import { squadMovementSystem } from "./squad-movement-runtime";
import { tacticalEngagementSystem } from "./tactical-engagement-runtime";
import { combatMicroSystem } from "./combat-micro-runtime";

// ─── 各阶段原始 interval ──────────────────────────────────

/** A5.4.1 tactical-runtime interval=10 */
const STAGE_TACTICAL_RUNTIME_INTERVAL = 10;
/** A5.4.2 squad-movement interval=1 */
const STAGE_SQUAD_MOVEMENT_INTERVAL = 1;
/** A5.4.3 tactical-engagement interval=3 */
const STAGE_TACTICAL_ENGAGEMENT_INTERVAL = 3;
/** A5.4.4 combat-micro interval=3 */
const STAGE_COMBAT_MICRO_INTERVAL = 3;

// ─── Pipeline System 定义 ──────────────────────────────────

/**
 * Tactical Runtime Pipeline — 合并后的单一 System 注册。
 *
 * interval=1（取最小），内部按各阶段原始 interval 分频调用。
 * 优先级 P2（main 阶段，在 war-planner 之后运行）。
 */
export const tacticalRuntimePipelineSystem: System = {
  name: "tactical-runtime-pipeline",
  priority: 2 as Priority,
  interval: STAGE_SQUAD_MOVEMENT_INTERVAL, // 1 — 取最小 interval
  phase: "main",

  run(ctx: TickContext): void {
    const tick = ctx.tick;
    const phase = systemPhase("tactical-runtime-pipeline", STAGE_SQUAD_MOVEMENT_INTERVAL);

    // ── Stage 1: Squad Movement (每 1t — 与 pipeline interval 一致) ──
    // 始终执行
    squadMovementSystem.run(ctx);

    // ── Stage 2: Tactical Engagement (每 3t) ──
    if ((tick - phase) % STAGE_TACTICAL_ENGAGEMENT_INTERVAL === 0) {
      tacticalEngagementSystem.run(ctx);
    }

    // ── Stage 3: Combat Micro (每 3t) ──
    if ((tick - phase) % STAGE_COMBAT_MICRO_INTERVAL === 0) {
      combatMicroSystem.run(ctx);
    }

    // ── Stage 4: Tactical Runtime (每 10t) ──
    if ((tick - phase) % STAGE_TACTICAL_RUNTIME_INTERVAL === 0) {
      tacticalRuntimeSystem.run(ctx);
    }
  },
};
