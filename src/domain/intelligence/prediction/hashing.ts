/**
 * A6.3.1 Deterministic Hashing — 预测层确定性哈希工具。
 *
 * 职责：
 *   - 提供 stableStringify（稳定 JSON 序列化）
 *   - 提供 fnv1a32Hex（FNV-1a 32-bit 哈希）
 *   - 提供 verifyPredictionDeterminism（确定性回放验证）
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * Deterministic Replay（PRED-003）：
 *   同一输入 + 同一模型版本 → 相同 hash。
 *   禁止 Math.random() / Date.now() / 无序迭代 / 浮点误差。
 *
 * Shadow-Only（PRED-001）：
 *   哈希计算不执行任何 Game API。
 *
 * 复用 A6.1/A6.2 的同构实现（baseline.ts §13）。
 */

import type { Prediction } from "./types";
import type { PredictionRingBuffer } from "./ring-buffer";

// ═══════════════════════════════════════════════════════════
// §1. Stable JSON Serialization
// ═══════════════════════════════════════════════════════════

/**
 * 稳定 JSON 序列化：按 key 排序，确保相同对象产生相同字符串。
 *
 * 确定性保证：
 *   - Object.keys 按 alphabetical 排序
 *   - Array 保持原序（调用方需保证排序一致）
 *   - 数字使用 toFixed(3) 截断浮点误差
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "number") return JSON.stringify(Number(obj.toFixed(6)));
  if (typeof obj === "boolean") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => {
    const v = (obj as Record<string, unknown>)[k];
    return JSON.stringify(k) + ":" + stableStringify(v);
  });
  return "{" + pairs.join(",") + "}";
}

// ═══════════════════════════════════════════════════════════
// §2. FNV-1a 32-bit Hash
// ═══════════════════════════════════════════════════════════

/**
 * FNV-1a 32-bit Hash → 8 字符 hex。
 *
 * 确定性：相同字符串 → 相同 hash。
 * 不使用 Math.random / Date.now。
 */
export function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════
// §3. Prediction Hash
// ═══════════════════════════════════════════════════════════

/**
 * 为 Prediction 生成稳定的 Hash。
 *
 * 算法：stableStringify(prediction 关键字段) → FNV-1a 32-bit → hex。
 *
 * 确定性保证：
 *   - 不使用 Math.random / Date.now
 *   - 字段按 alphabetical 排序
 *   - 浮点结果 toFixed(3)
 */
export function predictionHash(prediction: Prediction): string {
  const payload = stableStringify({
    confidence: Number(prediction.confidence.toFixed(3)),
    contextSignature: prediction.contextSignature,
    evidence: {
      modelParams: prediction.evidence.modelParams,
      regimeCompatibility: {
        compatible: prediction.evidence.regimeCompatibility.compatible,
        confidenceMultiplier: Number(prediction.evidence.regimeCompatibility.confidenceMultiplier.toFixed(3)),
      },
      sampleRange: prediction.evidence.sampleRange,
      sources: prediction.evidence.sources,
    },
    generatedAt: prediction.generatedAt,
    method: prediction.method,
    modelVersion: prediction.modelVersion,
    target: prediction.target,
    value: Number(prediction.value.toFixed(3)),
    window: {
      duration: prediction.window.duration,
      endTick: prediction.window.endTick,
      startTick: prediction.window.startTick,
    },
  });
  return fnv1a32Hex(payload);
}

// ═══════════════════════════════════════════════════════════
// §4. Determinism Verification
// ═══════════════════════════════════════════════════════════

/**
 * 验证 Prediction 确定性：同一输入连续 N 次，检查 hash 一致。
 *
 * PRED-003：禁止 Math.random / Date.now / wall-clock。
 * 要求 100% identical hash。
 *
 * 纯函数 — 不引用 Game/Memory。
 */
export function verifyPredictionDeterminism(
  prediction: Prediction,
  iterations = 1000,
): { deterministic: boolean; firstDivergenceAt?: number } {
  const firstHash = predictionHash(prediction);
  for (let i = 1; i < iterations; i++) {
    const h = predictionHash(prediction);
    if (h !== firstHash) {
      return { deterministic: false, firstDivergenceAt: i };
    }
  }
  return { deterministic: true };
}

/**
 * 验证 Ring Buffer 确定性：对 Buffer 中所有 Prediction 逐个验证 hash 一致性。
 *
 * PRED-003：20 scenarios × 1000 replay → 100% identical hash。
 */
export function verifyRingBufferDeterminism(
  buf: PredictionRingBuffer,
  iterations = 1000,
): {
  deterministic: boolean;
  scenariosChecked: number;
  firstDivergenceAt?: { scenarioIndex: number; iteration: number };
} {
  const predictions: Prediction[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (r) predictions.push(r);
  }

  // 按 id 排序确保遍历顺序一致
  predictions.sort((a, b) => a.id.localeCompare(b.id));

  for (let s = 0; s < predictions.length; s++) {
    const pred = predictions[s]!;
    const firstHash = predictionHash(pred);
    for (let iter = 1; iter < iterations; iter++) {
      const h = predictionHash(pred);
      if (h !== firstHash) {
        return {
          deterministic: false,
          scenariosChecked: s + 1,
          firstDivergenceAt: { scenarioIndex: s, iteration: iter },
        };
      }
    }
  }

  return { deterministic: true, scenariosChecked: predictions.length };
}
