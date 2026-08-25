/**
 * A6.3.1 Prediction Types — 预测层基础类型定义。
 *
 * 职责：
 *   - 定义 Prediction 核心类型（target, method, status, window, evidence）
 *   - 定义 PredictionEvidence 证据类型
 *   - 定义 INSUFFICIENT_DATA / NO_PREDICTION 哨兵值
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * Shadow-Only（PRED-001）：
 *   类型定义不执行任何行为。
 *
 * PRED-004：每条 Prediction 必须携带 horizon（时间窗口）。
 * PRED-005：数据不足时返回 INSUFFICIENT_DATA，不伪造预测。
 * PRED-006：每条 Prediction 必须携带 Evidence。
 * PRED-007：每条 Prediction 必须携带 ContextSignature。
 */

import type { PredictionContext } from "./context";

// ═══════════════════════════════════════════════════════════
// §1. Prediction Target & Method
// ═══════════════════════════════════════════════════════════

/**
 * 第一阶段预测目标（7 个）。
 *
 * 来源：A6.0 A6_0_PREDICTION_ARCHITECTURE.md §1.2。
 * 第二阶段预测目标（hostile-arrival, resource-imbalance, war-escalation,
 * enemy-behavior, recovery-probability）在 A6.4+ 实现。
 */
export type PredictionTarget =
  | "energy-shortage"
  | "spawn-starvation"
  | "logistics-bottleneck"
  | "room-collapse"
  | "remote-mining-failure"
  | "expansion-readiness"
  | "cpu-pressure";

/**
 * 预测方法。
 *
 * 来源：A6.0 A6_0_PREDICTION_ARCHITECTURE.md §2.1。
 * 全部为规则 + 统计方法，禁止 ML/RL/NN。
 */
export type PredictionMethod =
  | "trend-extrapolation"
  | "threshold-projection"
  | "statistical-inference";

/**
 * 预测生命周期状态。
 *
 * PRED-008：预测基础设施只负责记录 lifecycle，不执行 recommendation。
 */
export type PredictionStatus = "active" | "fulfilled" | "expired" | "invalidated";

// ═══════════════════════════════════════════════════════════
// §2. Prediction Window (Horizon)
// ═══════════════════════════════════════════════════════════

/**
 * 预测时间窗口 — PRED-004 强制要求。
 *
 * 每条 Prediction 必须携带 horizon。
 * 上限 duration ≤ 5000 tick；下限 duration ≥ 50 tick。
 */
export interface PredictionWindow {
  /** 预测起始 tick。 */
  readonly startTick: number;
  /** 预测结束 tick。 */
  readonly endTick: number;
  /** 持续 tick 数（endTick - startTick）。 */
  readonly duration: number;
}

// ═══════════════════════════════════════════════════════════
// §3. Prediction Evidence
// ═══════════════════════════════════════════════════════════

/**
 * 预测证据 — PRED-006 强制要求。
 *
 * 每条 Prediction 必须有可追溯的证据链。
 * evidence → 数据源 → 采集 tick → 原始系统输出。
 */
export interface PredictionEvidence {
  /** 数据源引用列表（如 "netFlowHistory:1-30", "exp-12345"）。 */
  readonly sources: readonly string[];
  /** 模型参数快照（用于追溯模型版本和参数）。 */
  readonly modelParams: Readonly<Record<string, number | string>>;
  /** 生成预测时的采样范围描述。 */
  readonly sampleRange: {
    /** 最早采样 tick。 */
    readonly oldestTick: number;
    /** 最新采样 tick。 */
    readonly newestTick: number;
    /** 采样点数量。 */
    readonly count: number;
  };
  /** Regime 兼容性检查结果（PRED-007）。 */
  readonly regimeCompatibility: {
    /** 是否兼容。 */
    readonly compatible: boolean;
    /** 不兼容维度列表。 */
    readonly mismatchedDimensions: readonly string[];
    /** 置信度乘数。 */
    readonly confidenceMultiplier: number;
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Prediction Core Type
// ═══════════════════════════════════════════════════════════

/**
 * Prediction — 完整的预测结果。
 *
 * 不变式（PRED-XXX 守卫）：
 *   - PRED-004：window 必须有值（horizon 强制）
 *   - PRED-005：confidence = 0 时不产出（返回 INSUFFICIENT_DATA）
 *   - PRED-006：evidence 必须有值
 *   - PRED-007：contextSignature 必须有值
 *   - PRED-008：status 只由 infrastructure 管理 lifecycle
 */
export interface Prediction {
  /** 预测 ID（格式：P-{tick}-{seq}）。 */
  readonly id: string;
  /** 生成 tick。 */
  readonly generatedAt: number;
  /** 预测目标。 */
  readonly target: PredictionTarget;
  /** 预测时间窗口（PRED-004）。 */
  readonly window: PredictionWindow;
  /** 预测值。 */
  readonly value: number;
  /** 置信度 [0,1]（PRED-005：数据不足时为 0，不产出）。 */
  readonly confidence: number;
  /** 预测方法。 */
  readonly method: PredictionMethod;
  /** 证据链（PRED-006）。 */
  readonly evidence: PredictionEvidence;
  /** 模型版本。 */
  readonly modelVersion: number;
  /** 预测状态（PRED-008：lifecycle 管理）。 */
  status: PredictionStatus;
  /** 上下文签名（PRED-007：Regime compatibility）。 */
  readonly contextSignature: string;
  /** 生成时的上下文快照。 */
  readonly context: PredictionContext;
}

// ═══════════════════════════════════════════════════════════
// §5. Sentinel Values
// ═══════════════════════════════════════════════════════════

/**
 * 数据不足哨兵 — PRED-005。
 *
 * 当数据不足时不产出 Prediction，返回此哨兵。
 * confidence = 0 的垃圾预测不应被消费。
 */
export const INSUFFICIENT_DATA = "INSUFFICIENT_DATA" as const;

/**
 * 无预测哨兵 — 当模型无法产出有效预测时返回。
 */
export const NO_PREDICTION = "NO_PREDICTION" as const;

/**
 * 预测结果类型 — 要么是有效的 Prediction，要么是哨兵值。
 *
 * PRED-005：调用方必须检查是否为哨兵值，不得消费 confidence=0 的预测。
 */
export type PredictionResult = Prediction | typeof INSUFFICIENT_DATA | typeof NO_PREDICTION;

/**
 * 检查预测结果是否为有效 Prediction（非哨兵值）。
 *
 * PRED-005：防止 confidence=0 的垃圾预测被错误消费。
 */
export function isValidPrediction(result: PredictionResult): result is Prediction {
  return result !== INSUFFICIENT_DATA && result !== NO_PREDICTION;
}

/**
 * 检查预测结果是否为数据不足。
 */
export function isInsufficientData(result: PredictionResult): boolean {
  return result === INSUFFICIENT_DATA;
}

// ═══════════════════════════════════════════════════════════
// §6. Prediction ID Construction
// ═══════════════════════════════════════════════════════════

/**
 * 创建 Prediction ID（确定性：P-{tick}-{seq}）。
 *
 * 禁止使用 Math.random / Date.now。
 */
export function makePredictionId(tick: number, seq: number): string {
  return `P-${tick}-${seq}`;
}

// ═══════════════════════════════════════════════════════════
// §7. Prediction Status Helpers
// ═══════════════════════════════════════════════════════════

/**
 * 检查 Prediction 是否已到期（window.endTick < currentTick）。
 *
 * PRED-008：到期预测应标记为 "expired"。
 */
export function isPredictionExpired(prediction: Prediction, currentTick: number): boolean {
  return prediction.window.endTick < currentTick;
}

/**
 * 检查 Prediction 是否处于活跃状态。
 */
export function isPredictionActive(prediction: Prediction): boolean {
  return prediction.status === "active";
}
