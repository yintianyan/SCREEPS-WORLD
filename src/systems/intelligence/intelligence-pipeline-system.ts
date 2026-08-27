/** Intelligence Pipeline System */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { safeRun } from "../../kernel/safe-run";
import { systemPhase } from "../../kernel/phase";

// 各阶段 System 定义（保留原文件中的 run 逻辑）
import { experienceCollectorSystem } from "./experience-collector-system";
import { strategyEvaluationSystem } from "./strategy-evaluation-system";
import { predictionSystem } from "./prediction-system";
import { calibrationResolutionSystem } from "./calibration-resolution-system";
import { intelligenceStateSystem } from "./intelligence-state-system";
import { recommendationEngineSystem } from "./recommendation-engine-system";

// ─── 各阶段原始 interval ──────────────────────────────────

/** A6.1 experience-collector interval=100 */
const STAGE_EXPERIENCE_INTERVAL = 100;
/** A6.2 strategy-evaluation interval=500 */
const STAGE_EVALUATION_INTERVAL = 500;
/** A6.3 prediction interval=500 */
const STAGE_PREDICTION_INTERVAL = 500;
/** A6.4 calibration-resolution interval=500 */
const STAGE_CALIBRATION_INTERVAL = 500;
/** A6.5 intelligence-state interval=500 */
const STAGE_INTELLIGENCE_STATE_INTERVAL = 500;
/** A6.6 recommendation-engine interval=500 */
const STAGE_RECOMMENDATION_INTERVAL = 500;

/** Pipeline 名称，用于 safeRun label 和日志 */
const PIPELINE_NAME = "intelligence-pipeline";

// ─── Pipeline System 定义 ──────────────────────────────────

/**
 * Intelligence Pipeline — 合并后的单一 System 注册。

 * interval=100（取最小），内部按各阶段原始 interval 分频调用。
 * 优先级 P3（post 阶段，在所有业务系统之后运行）。
 */
export const intelligencePipelineSystem: System = {
  name: PIPELINE_NAME,
  priority: 3 as Priority,
  interval: STAGE_EXPERIENCE_INTERVAL, // 100 — 取最小 interval
  phase: "post",

  run(ctx: TickContext): void {
    const tick = ctx.tick;
    const phase = systemPhase(PIPELINE_NAME, STAGE_EXPERIENCE_INTERVAL);

    // ── Stage 1: Experience Collector (每 100t) ──
    // 始终执行（与 pipeline interval 一致）
    // experience-collector 是后续阶段的 producer：采集 Outcome → finalize Experience。
    // 它必须先于 evaluation/prediction/calibration/recommendation 运行，
    // 因为后者消费 experience ring buffer 的产出。
    safeRun(
      `${PIPELINE_NAME}/experience-collector`,
      () => experienceCollectorSystem.run(ctx),
    );

    // ── Stage 2: Strategy Evaluation (每 500t) ──
    // 消费 experience ring buffer 产出，评估策略效果。
    // 使用 pipeline phase 作为分频基准（保持与原 cadence 相似的错峰）。
    if ((tick - phase) % STAGE_EVALUATION_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/strategy-evaluation`,
        () => strategyEvaluationSystem.run(ctx),
      );
    }

    // ── Stage 3: Prediction (每 500t) ──
    // 消费 experience + evaluation 产出，预测未来趋势。
    if ((tick - phase) % STAGE_PREDICTION_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/prediction`,
        () => predictionSystem.run(ctx),
      );
    }

    // ── Stage 4: Calibration Resolution (每 500t) ──
    // 消费 prediction 产出，校准预测偏差。
    if ((tick - phase) % STAGE_CALIBRATION_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/calibration-resolution`,
        () => calibrationResolutionSystem.run(ctx),
      );
    }

    // ── Stage 5: Intelligence State (每 500t) ──
    // 消费 calibration 产出，综合构建智能状态。
    if ((tick - phase) % STAGE_INTELLIGENCE_STATE_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/intelligence-state`,
        () => intelligenceStateSystem.run(ctx),
      );
    }

    // ── Stage 6: Recommendation Engine (每 500t) ──
    // 消费 intelligence state，产出推荐（Shadow-Only，不进入执行路径）。
    if ((tick - phase) % STAGE_RECOMMENDATION_INTERVAL === 0) {
      safeRun(
        `${PIPELINE_NAME}/recommendation-engine`,
        () => recommendationEngineSystem.run(ctx),
      );
    }
  },
};
