/** A6.5 Conflict Detection — 跨模型预测冲突检测。 */

import type { Prediction } from "../prediction/types";
import type { PredictionContext } from "../prediction/context";
import { checkRegimeCompatibility } from "../prediction/context";
import { stableStringify, fnv1a32Hex } from "../prediction/hashing";
import type { PredictionConflict, ConflictType } from "./types";
import { TEMPORAL_CONFLICT_THRESHOLD } from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Conflict Rule Registry
// ═══════════════════════════════════════════════════════════

/**
 * 逻辑冲突规则。
 */
interface ConflictRule {
  readonly ruleId: string;
  readonly targetA: string;
  readonly targetB: string;
  readonly conditionA: (p: Prediction) => boolean;
  readonly conditionB: (p: Prediction) => boolean;
  readonly severity: number;
  readonly description: string;
}

/**
 * 已注册的逻辑冲突规则。

 * 当两条活跃预测分别匹配 targetA/targetB 且 conditionA/conditionB 均满足时，
 * 标记为 logical conflict。
 */
const CONFLICT_RULES: ConflictRule[] = [
  {
    ruleId: "energy-vs-expansion",
    targetA: "energy-shortage",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5,
    conditionB: (p) => p.confidence > 0.5,
    severity: 0.8,
    description: "Energy shortage predicted but expansion readiness also high",
  },
  {
    ruleId: "collapse-vs-expansion",
    targetA: "room-collapse",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5,
    conditionB: (p) => p.confidence > 0.5,
    severity: 0.9,
    description: "Room collapse predicted but expansion readiness also high",
  },
  {
    ruleId: "remote-fail-vs-expansion",
    targetA: "remote-mining-failure",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5,
    conditionB: (p) => p.confidence > 0.5,
    severity: 0.8,
    description: "Remote mining failure predicted but expansion readiness also high",
  },
  {
    ruleId: "cpu-vs-expansion",
    targetA: "cpu-pressure",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5,
    conditionB: (p) => p.confidence > 0.5,
    severity: 0.7,
    description: "CPU pressure predicted but expansion readiness also high",
  },
];

// ═══════════════════════════════════════════════════════════
// §2. Conflict Detection
// ═══════════════════════════════════════════════════════════

/**
 * 检测活跃预测之间的冲突。

 * 纯函数 — Shadow-Only（REL-011: 不解决冲突）。

 * @param activePredictions - 当前活跃预测列表
 * @param currentContext - 当前 PredictionContext
 * @param currentTick - 当前 tick
 * @returns 冲突列表（可能为空）
 */
export function detectConflicts(
  activePredictions: readonly Prediction[],
  currentContext: PredictionContext,
  currentTick: number,
): PredictionConflict[] {
  const conflicts: PredictionConflict[] = [];

  // ── 1. 逻辑冲突检测 ──
  conflicts.push(...detectLogicalConflicts(activePredictions, currentTick));

  // ── 2. Temporal 不一致检测 ──
  conflicts.push(...detectTemporalConflicts(activePredictions, currentTick));

  // ── 3. Regime 冲突检测 ──
  conflicts.push(...detectRegimeConflicts(activePredictions, currentContext, currentTick));

  // 按 conflictId 排序确保确定性
  conflicts.sort((a, b) => a.conflictId.localeCompare(b.conflictId));

  return conflicts;
}

// ═══════════════════════════════════════════════════════════
// §3. Logical Conflict Detection
// ═══════════════════════════════════════════════════════════

/**
 * 检测逻辑冲突 — 互斥预测对。
 */
function detectLogicalConflicts(
  predictions: readonly Prediction[],
  currentTick: number,
): PredictionConflict[] {
  const conflicts: PredictionConflict[] = [];

  for (const rule of CONFLICT_RULES) {
    const matchingA = predictions.filter(
      p => p.target === rule.targetA && p.status === "active" && rule.conditionA(p),
    );
    const matchingB = predictions.filter(
      p => p.target === rule.targetB && p.status === "active" && rule.conditionB(p),
    );

    if (matchingA.length > 0 && matchingB.length > 0) {
      // 取第一条匹配的（确定性：按 ID 排序）
      matchingA.sort((a, b) => a.id.localeCompare(b.id));
      matchingB.sort((a, b) => a.id.localeCompare(b.id));
      const predA = matchingA[0]!;
      const predB = matchingB[0]!;

      const severity = Number(
        (rule.severity * predA.confidence * predB.confidence).toFixed(6),
      );

      const conflict = makeConflict(
        rule.ruleId,
        "logical",
        [predA.id, predB.id],
        rule.description,
        severity,
        currentTick,
      );
      conflicts.push(conflict);
    }
  }

  return conflicts;
}

// ═══════════════════════════════════════════════════════════
// §4. Temporal Conflict Detection
// ═══════════════════════════════════════════════════════════

/**
 * 检测 Temporal 不一致 — 同一目标多条 active 预测的 value 差异过大。
 */
function detectTemporalConflicts(
  predictions: readonly Prediction[],
  currentTick: number,
): PredictionConflict[] {
  const conflicts: PredictionConflict[] = [];

  // 按 target 分组
  const byTarget = new Map<string, Prediction[]>();
  for (const p of predictions) {
    if (p.status !== "active") continue;
    const group = byTarget.get(p.target);
    if (group) {
      group.push(p);
    } else {
      byTarget.set(p.target, [p]);
    }
  }

  for (const [target, group] of byTarget) {
    if (group.length < 2) continue;

    // 按 ID 排序确保确定性
    group.sort((a, b) => a.id.localeCompare(b.id));

    // 对每对预测检查 value 差异
    for (let i = 0; i < group.length - 1; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const denominator = Math.max(Math.abs(a.value), Math.abs(b.value), 1);
        const diff = Math.abs(a.value - b.value) / denominator;

        if (diff > TEMPORAL_CONFLICT_THRESHOLD) {
          const severity = Number(
            Math.min(diff, 1).toFixed(6),
          );
          const conflict = makeConflict(
            `temporal-${target}`,
            "temporal",
            [a.id, b.id],
            `Temporal inconsistency in ${target}: values differ by ${(diff * 100).toFixed(1)}%`,
            severity,
            currentTick,
          );
          conflicts.push(conflict);
        }
      }
    }
  }

  return conflicts;
}

// ═══════════════════════════════════════════════════════════
// §5. Regime Conflict Detection
// ═══════════════════════════════════════════════════════════

/**
 * 检测 Regime 冲突 — 活跃预测的 contextSignature 与当前 Regime 不匹配。

 * 复用 A6.3 checkRegimeCompatibility()。
 */
function detectRegimeConflicts(
  predictions: readonly Prediction[],
  currentContext: PredictionContext,
  currentTick: number,
): PredictionConflict[] {
  const conflicts: PredictionConflict[] = [];

  for (const p of predictions) {
    if (p.status !== "active") continue;

    const compat = checkRegimeCompatibility(p.context, currentContext);
    if (!compat.compatible) {
      const severity = Number(compat.severity.toFixed(6));
      const conflict = makeConflict(
        `regime-${p.id}`,
        "regime",
        [p.id],
        `Prediction ${p.id} regime mismatch: ${compat.reason}`,
        severity,
        currentTick,
      );
      conflicts.push(conflict);
    }
  }

  return conflicts;
}

// ═══════════════════════════════════════════════════════════
// §6. Conflict Construction
// ═══════════════════════════════════════════════════════════

/**
 * 构建冲突对象（含确定性 hash）。
 */
function makeConflict(
  ruleId: string,
  type: ConflictType,
  predictionIds: string[],
  description: string,
  severity: number,
  detectedAt: number,
): PredictionConflict {
  // predictionIds 排序确保确定性
  const sortedIds = [...predictionIds].sort();

  const conflictId = `${ruleId}-${sortedIds.join("+")}`;

  const hashInput = {
    conflictId,
    type,
    predictionIds: sortedIds,
    description,
    severity,
    detectedAt,
  };

  const conflictHash = fnv1a32Hex(stableStringify(hashInput));

  return {
    conflictId,
    type,
    predictionIds: sortedIds,
    description,
    severity,
    detectedAt,
    conflictHash,
  };
}
