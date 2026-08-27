/** A6.3.1 ContextSignature & Regime Compatibility — 预测上下文签名与体制兼容性。 */

// ═══════════════════════════════════════════════════════════
// §1. Regime Types
// ═══════════════════════════════════════════════════════════

/**
 * 预测上下文 — 生成 ContextSignature 所需的输入。

 * 编码影响预测模型有效性的宏观状态。
 */
export interface PredictionContext {
  /** 帝国姿态（peace/fortify/war/evacuate）。 */
  readonly posture: string;
  /** 看门狗档位（healthy/guarded/conserve/recovery）。 */
  readonly watchdogTier: string;
  /** 自有房间数量。 */
  readonly roomCount: number;
  /** 最高 RCL。 */
  readonly maxRcl: number;
  /** 威胁等级（LOW/HIGH）。 */
  readonly threatLevel: string;
}

/**
 * Regime 兼容性结果。
 */
export interface RegimeCompatibility {
  /** 是否兼容。 */
  readonly compatible: boolean;
  /** 不兼容的维度列表。 */
  readonly mismatchedDimensions: string[];
  /** 严重度（0-1，0=完全兼容，1=完全不兼容）。 */
  readonly severity: number;
  /** 置信度乘数（1.0=兼容，0.5=不兼容时降权）。 */
  readonly confidenceMultiplier: number;
  /** 不可兼容的原因描述。 */
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §2. ContextSignature Construction
// ═══════════════════════════════════════════════════════════

/**
 * 为预测构建稳定的上下文签名（ContextSignature）。

 * 编码：posture-watchdogTier-roomRange-rclRange-threat
 * 不同姿态/看门狗档位/规模/威胁等级下的预测不可混合。

 * 确定性：相同输入 → 相同签名。
 */
export function buildPredictionContextSignature(ctx: PredictionContext): string {
  const roomRange = roomCountRange(ctx.roomCount);
  const rclRange = rclRangeOf(ctx.maxRcl);
  const threat = ctx.threatLevel.toLowerCase();
  return `${ctx.posture}-${ctx.watchdogTier}-${roomRange}-${rclRange}-${threat}`;
}

/**
 * 获取完整的 PredictionContext（供调用方构建）。

 * 这是一个便利函数，调用方传入原始参数，返回结构化 PredictionContext。
 */
export function makePredictionContext(input: {
  posture: string;
  watchdogTier: string;
  roomCount: number;
  maxRcl: number;
  threatLevel: string;
}): PredictionContext {
  return {
    posture: input.posture,
    watchdogTier: input.watchdogTier,
    roomCount: input.roomCount,
    maxRcl: input.maxRcl,
    threatLevel: input.threatLevel,
  };
}

// ═══════════════════════════════════════════════════════════
// §3. Regime Compatibility Check
// ═══════════════════════════════════════════════════════════

/**
 * 检查两个 PredictionContext 之间的体制兼容性。

 * 比较维度：posture, watchdogTier, room count range, rcl range, threat level。
 * 不匹配维度越多 → severity 越高 → confidenceMultiplier 越低。

 * PRED-007 守卫：
 *   - 不匹配时 confidenceMultiplier = 0.5（降权，不拒绝）
 *   - 完全匹配时 confidenceMultiplier = 1.0
 *   - 严重不匹配（≥3 维度）时 confidenceMultiplier = 0.3

 * 纯函数 — 不引用 Game/Memory。
 */
export function checkRegimeCompatibility(
  baselineCtx: PredictionContext,
  currentCtx: PredictionContext,
): RegimeCompatibility {
  const mismatched: string[] = [];

  // Posture mismatch
  if (baselineCtx.posture !== currentCtx.posture) {
    mismatched.push("posture");
  }

  // Watchdog tier mismatch
  if (baselineCtx.watchdogTier !== currentCtx.watchdogTier) {
    mismatched.push("watchdog_tier");
  }

  // Room count range mismatch
  if (roomCountRange(baselineCtx.roomCount) !== roomCountRange(currentCtx.roomCount)) {
    mismatched.push("room_count");
  }

  // RCL range mismatch
  if (rclRangeOf(baselineCtx.maxRcl) !== rclRangeOf(currentCtx.maxRcl)) {
    mismatched.push("rcl_range");
  }

  // Threat level mismatch
  if (baselineCtx.threatLevel.toLowerCase() !== currentCtx.threatLevel.toLowerCase()) {
    mismatched.push("threat_level");
  }

  const mismatchCount = mismatched.length;
  const severity = mismatchCount === 0 ? 0 : Math.min(1, mismatchCount * 0.2);
  const compatible = mismatchCount === 0;

  // 置信度乘数
  let confidenceMultiplier = 1.0;
  if (mismatchCount >= 3) {
    confidenceMultiplier = 0.3;
  } else if (mismatchCount >= 1) {
    confidenceMultiplier = 0.5;
  }

  const reason = mismatchCount === 0
    ? "compatible"
    : `mismatch: ${mismatched.join(",")}`;

  return {
    compatible,
    mismatchedDimensions: mismatched,
    severity: Number(severity.toFixed(3)),
    confidenceMultiplier: Number(confidenceMultiplier.toFixed(3)),
    reason,
  };
}

/**
 * 应用 Regime 兼容性乘数到置信度。

 * PRED-007：不匹配时降权，不拒绝。
 * 确定性：相同输入 → 相同输出。
 */
export function applyRegimeMultiplier(confidence: number, compatibility: RegimeCompatibility): number {
  return Number((confidence * compatibility.confidenceMultiplier).toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §4. Internal Helpers
// ═══════════════════════════════════════════════════════════

/** 将房间数量映射到范围标签。 */
function roomCountRange(count: number): string {
  if (count <= 1) return "single";
  if (count <= 3) return "small";
  if (count <= 6) return "medium";
  return "large";
}

/** 将 RCL 映射到范围标签。 */
function rclRangeOf(rcl: number): string {
  if (rcl <= 3) return "early";
  if (rcl <= 6) return "mid";
  return "late";
}
