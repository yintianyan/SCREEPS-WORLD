/**
 * Intelligence Pipeline System — A6 智能层合并薄壳。
 *
 * R10 ADR 合并产物：将 A6.1–A6.6 六个独立 System 合并为 1 个 pipeline。
 *
 * 设计原理：
 *   - 六个 A6 System 全部是 P3 post 阶段、Shadow-Only（不执行 Game API、不修改 Strategy）
 *   - 它们有严格的 pipeline 依赖关系：experience → evaluation → prediction →
 *     calibration → intelligence-state → recommendation
 *   - interval 不同：experience=100t，其余=500t
 *   - 合并后 interval=100（取最小），内部按各阶段原始 interval 分频执行
 *   - 各阶段的 run() 逻辑完全保留，只是从独立 System 变为 pipeline 内部 stage 调用
 *   - 各阶段的 export 查询函数不变（仍从各自原文件 export）
 *
 * Cadence 保持（Phase 6 修复）：
 *   - experience-collector 每 100t 运行（与 pipeline interval 一致，始终执行）。
 *   - 其余 5 个 500t 阶段在 (tick - phase) % 500 === 0 时运行。
 *   - pipeline interval=100 意味着每 100t 进入 run()，500t 阶段在每 5 次进入中执行 1 次。
 *   - 由于所有 500t 阶段共享同一个 phase 偏移，它们在同 tick 串行执行，
 *     保持了原始的依赖顺序（experience 先于 evaluation 先于 prediction ...）。
 *   - 不存在 cadence 死锁：pipeline interval=100 保证 500t 阶段每 5 次进入有 1 次命中。
 *   - P14 cadence 修复（AU-6）：各 stage 内部门控已改为 (tick - phase) % N === 0，
 *     与 pipeline 外层 cadence 一致。
 *
 * 错误隔离（Phase 6 修复）：
 *   - 每个 stage 独立 safeRun 包裹，一个 stage 抛错不跳过后续独立 stage。
 *   - 错误带 pipeline 名 + stage 名 + tick，不误报为整 pipeline 失败。
 *   - A6 全部 Shadow-Only：pipeline 完全停止时帝国照常安全运行（不变式保持）。
 *
 * 安全不变式：本系统完全停止时，帝国必须照常安全运行（继承自 A6.1-A6.6 各阶段不变式）。
 *
 * 合同锚点：R10 ADR（ARCHITECTURE_FREEZE.md §15）+ A6.1-A6.6 各自合同。
 */
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
 *
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
