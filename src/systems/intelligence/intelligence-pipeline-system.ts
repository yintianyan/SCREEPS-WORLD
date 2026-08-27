/**
 * Intelligence Pipeline System — A6 智能层合并薄壳。
 *
 * R10 ADR 合并产物：将 A6.1–A6.6 六个独立 System 合并为 1 个 pipeline。
 *
 * 设计原理：
 *   - 六个 A6 System 全部是 P3 post 阶段、Shadow-Only（不执行 Game API、不修改 Strategy）
 *   - 它们有严格的 pipeline 依赖关系：experience → evaluation → prediction → calibration → intelligence-state → recommendation
 *   - interval 不同：experience=100t，其余=500t
 *   - 合并后 interval=100（取最小），内部按各阶段原始 interval 分频执行
 *   - 各阶段的 run() 逻辑完全保留，只是从独立 System 变为 pipeline 内部 stage 调用
 *   - 各阶段的 export 查询函数不变（仍从各自原文件 export）
 *
 * 安全不变式：本系统完全停止时，帝国必须照常安全运行（继承自 A6.1-A6.6 各阶段不变式）。
 *
 * 合同锚点：R10 ADR（ARCHITECTURE_FREEZE.md §15）+ A6.1-A6.6 各自合同。
 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
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

// ─── Pipeline System 定义 ──────────────────────────────────

/**
 * Intelligence Pipeline — 合并后的单一 System 注册。
 *
 * interval=100（取最小），内部按各阶段原始 interval 分频调用。
 * 优先级 P3（post 阶段，在所有业务系统之后运行）。
 */
export const intelligencePipelineSystem: System = {
  name: "intelligence-pipeline",
  priority: 3 as Priority,
  interval: STAGE_EXPERIENCE_INTERVAL, // 100 — 取最小 interval
  phase: "post",

  run(ctx: TickContext): void {
    const tick = ctx.tick;
    const phase = systemPhase("intelligence-pipeline", STAGE_EXPERIENCE_INTERVAL);

    // ── Stage 1: Experience Collector (每 100t) ──
    // 始终执行（与 pipeline interval 一致）
    experienceCollectorSystem.run(ctx);

    // ── Stage 2: Strategy Evaluation (每 500t) ──
    // 使用 pipeline phase 作为分频基准（保持与原 cadence 相似的错峰）
    if ((tick - phase) % STAGE_EVALUATION_INTERVAL === 0) {
      strategyEvaluationSystem.run(ctx);
    }

    // ── Stage 3: Prediction (每 500t) ──
    if ((tick - phase) % STAGE_PREDICTION_INTERVAL === 0) {
      predictionSystem.run(ctx);
    }

    // ── Stage 4: Calibration Resolution (每 500t) ──
    if ((tick - phase) % STAGE_CALIBRATION_INTERVAL === 0) {
      calibrationResolutionSystem.run(ctx);
    }

    // ── Stage 5: Intelligence State (每 500t) ──
    if ((tick - phase) % STAGE_INTELLIGENCE_STATE_INTERVAL === 0) {
      intelligenceStateSystem.run(ctx);
    }

    // ── Stage 6: Recommendation Engine (每 500t) ──
    if ((tick - phase) % STAGE_RECOMMENDATION_INTERVAL === 0) {
      recommendationEngineSystem.run(ctx);
    }
  },
};
