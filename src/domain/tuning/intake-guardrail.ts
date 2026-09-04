/** L2 体外建议护栏 — 对外部 LLM 写入 segment 6 的建议包做 schema 校验 + 白名单过滤 + 值域钳制（纯函数，不访问 Game/Memory）。 */

import { STRATEGY_BOUNDS, clampStrategyParam } from "./bounds";
import type { StrategyOverrideEntry } from "../strategy/strategy-reviewer";

/** 体外建议包原始结构（segment 6 的 JSON.parse 结果）。 */
export interface IntakePayload {
  /** schema 版本。 */
  v: number;
  /** 建议生成 tick（体外读取的 Game.time）。 */
  t: number;
  /** 过期 tick（建议在此时点后视为陈旧，丢弃）。 */
  exp: number;
  /** 建议列表（≤5 条）。 */
  sug: Array<{
    /** 参数路径，如 "posture.minDwell"。 */
    p: string;
    /** 建议值。 */
    v: number;
    /** 建议理由（诊断，≤100 字符）。 */
    r: string;
  }>;
}

/** 单条接受的 L2 建议。 */
export interface IntakeAccepted {
  /** 参数路径。 */
  param: string;
  /** 建议值（经钳制）。 */
  value: number;
  /** 原始建议值（钳制前）。 */
  originalValue: number;
  /** 建议理由。 */
  reason: string;
  /** 来源标记。 */
  source: "l2-external";
}

/** 单条拒绝记录（诊断用）。 */
export interface IntakeRejected {
  /** 参数路径或 "package"（整包拒绝）。 */
  param: string;
  /** 拒绝原因。 */
  reason: string;
}

/** 护栏校验结果。 */
export interface IntakeResult {
  /** 接受的建议。 */
  accepted: IntakeAccepted[];
  /** 拒绝的条目（诊断用）。 */
  rejected: IntakeRejected[];
  /** 诊断摘要。 */
  summary: string;
}

/** 建议包最大条目数（控体积）。 */
const MAX_SUGGESTIONS = 5;

/** 建议统计窗口约束：建议生成 tick 距当前 tick 不超过此值（否则视为陈旧）。 */
const MAX_ADVICE_AGE_TICKS = 10000;

/**
 * 对体外 LLM 建议包执行 6 层护栏校验。
 *
 * 护栏顺序：
 *   1. schema 校验 — v/t/exp/sug 字段存在且类型正确
 *   2. 过期检查 — currentTick > exp → 整包拒绝
 *   3. 统计窗口约束 — 建议生成 tick 距当前 tick > MAX_ADVICE_AGE_TICKS → 整包拒绝
 *   4. 白名单过滤 — p 必须在 STRATEGY_BOUNDS 中
 *   5. 值域钳制 — v 经 clampStrategyParam 钳制
 *   6. 冷却检查 — 该参数在 strategyOverrides 中且在 5000t 冷却期内 → 拒绝
 *
 * @param payload  segment 6 的 JSON.parse 结果（可能畸形）
 * @param currentTick  当前 Game.time
 * @param currentOverrides  当前 strategyOverrides（读 adjustedAt 做冷却检查）
 * @param strategyCooldownTicks  策略参数冷却 tick 数
 */
export function applyIntakeGuardrail(
  payload: unknown,
  currentTick: number,
  currentOverrides: Record<string, StrategyOverrideEntry> | undefined,
  strategyCooldownTicks: number,
): IntakeResult {
  const accepted: IntakeAccepted[] = [];
  const rejected: IntakeRejected[] = [];

  // ── 1. schema 校验 ──
  if (!isValidPayload(payload)) {
    rejected.push({ param: "package", reason: "schema_validation_failed" });
    return { accepted, rejected, summary: "intake: rejected (schema invalid)" };
  }

  const p = payload as IntakePayload;

  // ── 2. 过期检查 ──
  if (currentTick > p.exp) {
    rejected.push({ param: "package", reason: `expired (exp=${p.exp}, now=${currentTick})` });
    return { accepted, rejected, summary: "intake: rejected (expired)" };
  }

  // ── 3. 统计窗口约束 ──
  const ageTicks = currentTick - p.t;
  if (ageTicks > MAX_ADVICE_AGE_TICKS) {
    rejected.push({ param: "package", reason: `stale (age=${ageTicks}t > ${MAX_ADVICE_AGE_TICKS}t)` });
    return { accepted, rejected, summary: `intake: rejected (stale ${ageTicks}t)` };
  }

  // ── 4-6. 逐条校验 ──
  const suggestions = p.sug.slice(0, MAX_SUGGESTIONS);
  for (const sug of suggestions) {
    // 4. 白名单过滤
    if (!STRATEGY_BOUNDS[sug.p]) {
      rejected.push({ param: sug.p, reason: "not_in_whitelist" });
      continue;
    }

    // 5. 值域钳制
    const clampedValue = clampStrategyParam(sug.p, sug.v);
    if (clampedValue !== sug.v) {
      // 钳制后仍接受，但记录原始值供诊断
    }

    // 6. 冷却检查
    const existing = currentOverrides?.[sug.p];
    if (existing && currentTick - existing.adjustedAt < strategyCooldownTicks) {
      rejected.push({
        param: sug.p,
        reason: `cooldown (${currentTick - existing.adjustedAt}t < ${strategyCooldownTicks}t)`,
      });
      continue;
    }

    accepted.push({
      param: sug.p,
      value: clampedValue,
      originalValue: sug.v,
      reason: `[L2] ${sug.r}`.slice(0, 120),
      source: "l2-external",
    });
  }

  const summary = accepted.length > 0
    ? `intake: ${accepted.length} accepted, ${rejected.length} rejected`
    : `intake: 0 accepted, ${rejected.length} rejected`;

  return { accepted, rejected, summary };
}

/** schema 校验：检查 payload 是否符合 IntakePayload 结构。 */
function isValidPayload(payload: unknown): payload is IntakePayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.v !== "number" || typeof p.t !== "number" || typeof p.exp !== "number") return false;
  if (!Array.isArray(p.sug)) return false;
  for (const s of p.sug) {
    if (!s || typeof s !== "object") return false;
    const sg = s as Record<string, unknown>;
    if (typeof sg.p !== "string" || typeof sg.v !== "number" || typeof sg.r !== "string") return false;
  }
  return true;
}
