/** Tactical Runtime Pipeline */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { safeRun } from "../kernel/safe-run";
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

/** Pipeline 名称，用于 safeRun label 和日志 */
const PIPELINE_NAME = "tactical-runtime-pipeline";

// ─── Pipeline System 定义 ──────────────────────────────────

/**
 * Tactical Runtime Pipeline — 合并后的单一 System 注册。

 * interval=1（取最小），内部按各阶段原始 interval 分频调用。
 * 优先级 P2（main 阶段，在 war-planner 之后运行）。
 */
export const tacticalRuntimePipelineSystem: System = {
  name: PIPELINE_NAME,
  priority: 2 as Priority,
  interval: STAGE_SQUAD_MOVEMENT_INTERVAL, // 1 — 取最小 interval
  phase: "main",

  run(ctx: TickContext): void {
    const tick = ctx.tick;
    const phase = systemPhase(PIPELINE_NAME, STAGE_SQUAD_MOVEMENT_INTERVAL);

    // ── Stage 1: Tactical Runtime (每 10t) — 决策层，producer ──
    // 必须先于消费者运行：产出 TacticalDecision + TacticalAbortSignal +
    // ReinforcementDemand → globalCache，供后续 stage 消费。
    // 本 tick 的 Game action 尚未执行（main 阶段在角色之前），各 stage
    // 消费的是上一 tick 的 globalCache 快照 + 本 tick 的 ctx.snapshots。
    if ((tick - phase) % STAGE_TACTICAL_RUNTIME_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/tactical-runtime`,
        () => tacticalRuntimeSystem.run(ctx),
      );
    }

    // ── Stage 2: Squad Movement (每 1t) — 消费 tactical-runtime 决策 ──
    // 始终执行（与 pipeline interval 一致）
    safeRun(
      `${PIPELINE_NAME}/squad-movement`,
      () => squadMovementSystem.run(ctx),
    );

    // ── Stage 3: Tactical Engagement (每 3t) — 消费编队状态 ──
    if ((tick - phase) % STAGE_TACTICAL_ENGAGEMENT_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/tactical-engagement`,
        () => tacticalEngagementSystem.run(ctx),
      );
    }

    // ── Stage 4: Combat Micro (每 3t) — 消费接敌评估，产出微操 intent ──
    if ((tick - phase) % STAGE_COMBAT_MICRO_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/combat-micro`,
        () => combatMicroSystem.run(ctx),
      );
    }
  },
};
