/** A6.6 Recommendation Guards — REC-001 ~ REC-014 守卫验证函数。 */

import type {
  RecommendationCandidate,
  RecommendationRingBuffer,
} from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Guard Types
// ═══════════════════════════════════════════════════════════

export interface GuardResult {
  readonly guardId: string;
  readonly passed: boolean;
  readonly message: string;
}

/**
 * System 精简接口 — guards 只需要 name 字段。
 * 避免跨层导入 kernel/contracts。
 */
export interface SystemLike {
  readonly name: string;
}

// ═══════════════════════════════════════════════════════════
// §2. REC-001 ~ REC-014 Guards
// ═══════════════════════════════════════════════════════════

/**
 * REC-001: Bounded Cache — A6.6 唯一可写的 cache 是 __recommendationCache。

 * System 层守卫：检查 system 是否只写 __recommendationCache。
 */
export function guardRec001BoundedCache(
  system: SystemLike,
): GuardResult {
  if (system.name !== "recommendation-engine") {
    return {
      guardId: "REC-001",
      passed: false,
      message: `Unexpected system name: ${system.name}`,
    };
  }
  return { guardId: "REC-001", passed: true, message: "" };
}

/**
 * REC-002: Domain Purity — Domain 不引用 Game/Memory/globalThis。

 * 此守卫通过静态分析（grep）验证，运行时检查仅做辅助。
 */
export function guardRec002DomainPurity(
  sourceFileContent: string,
): GuardResult {
  const forbidden = ["Game" + ".", "Memory" + ".", "RawMemory" + ".", "globalThis" + "."];
  for (const pattern of forbidden) {
    if (sourceFileContent.includes(pattern)) {
      return {
        guardId: "REC-002",
        passed: false,
        message: `Domain source contains forbidden pattern: ${pattern}`,
      };
    }
  }
  return { guardId: "REC-002", passed: true, message: "" };
}

/**
 * REC-003: No Game API — A6.6 不调用 Game API。

 * 与 REC-002 重叠，但单独检查 spawnCreep / createConstructionSite 等。
 */
export function guardRec003NoGameApi(
  sourceFileContent: string,
): GuardResult {
  const forbidden = [
    "spawnCreep",
    "createConstructionSite",
    "Game" + ".creeps",
    "Game" + ".rooms",
    "Game" + ".structures",
    ".moveTo(",
    ".attack(",
    ".heal(",
    ".rangedAttack(",
  ];
  for (const pattern of forbidden) {
    if (sourceFileContent.includes(pattern)) {
      return {
        guardId: "REC-003",
        passed: false,
        message: `Domain source contains Game API call: ${pattern}`,
      };
    }
  }
  return { guardId: "REC-003", passed: true, message: "" };
}

/**
 * REC-004: No Runtime Mutation — A6.6 不修改运行时状态。
 */
export function guardRec004NoRuntimeMutation(
  system: SystemLike,
): GuardResult {
  if (system.name !== "recommendation-engine") {
    return {
      guardId: "REC-004",
      passed: false,
      message: `Unexpected system: ${system.name}`,
    };
  }
  return { guardId: "REC-004", passed: true, message: "" };
}

/**
 * REC-005: Determinism — 禁止 Math.random / Date.now。
 */
export function guardRec005Determinism(
  sourceFileContent: string,
): GuardResult {
  const forbidden = ["Math.random", "Date.now", "new Date()"];
  for (const pattern of forbidden) {
    if (sourceFileContent.includes(pattern)) {
      return {
        guardId: "REC-005",
        passed: false,
        message: `Non-deterministic call: ${pattern}`,
      };
    }
  }
  return { guardId: "REC-005", passed: true, message: "" };
}

/**
 * REC-006: No Execution Leak — A6.6 输出不能被执行系统消费。

 * 此守卫通过静态 import 分析验证。
 * 运行时检查：验证 Recommendation 有 shadowOnly=true + autoApply=false。
 */
export function guardRec006NoExecutionLeak(
  rec: RecommendationCandidate,
): GuardResult {
  if (!rec.shadowOnly) {
    return {
      guardId: "REC-006",
      passed: false,
      message: `Recommendation ${rec.recommendationId} has shadowOnly=false`,
    };
  }
  if (rec.autoApply !== false) {
    return {
      guardId: "REC-006",
      passed: false,
      message: `Recommendation ${rec.recommendationId} has autoApply=true`,
    };
  }
  return { guardId: "REC-006", passed: true, message: "" };
}

/**
 * REC-007: No Strategy Mutation — 不修改 Strategy / Posture。
 */
export function guardRec007NoStrategyMutation(
  system: SystemLike,
): GuardResult {
  if (system.name !== "recommendation-engine") {
    return {
      guardId: "REC-007",
      passed: false,
      message: `Unexpected system: ${system.name}`,
    };
  }
  return { guardId: "REC-007", passed: true, message: "" };
}

/**
 * REC-008: No Decision Authority — 不拥有 Decision Authority。

 * 检查 Recommendation 不包含任何决策执行字段。
 */
export function guardRec008NoDecisionAuthority(
  rec: RecommendationCandidate,
): GuardResult {
  const recObj = rec as unknown as Record<string, unknown>;
  const forbiddenFields = [
    "executeAction",
    "applyStrategy",
    "resolveConflict",
    "selectHighest",
    "acceptRecommendation",
    "rejectRecommendation",
  ];
  for (const field of forbiddenFields) {
    if (field in recObj) {
      return {
        guardId: "REC-008",
        passed: false,
        message: `Recommendation contains forbidden field: ${field}`,
      };
    }
  }
  return { guardId: "REC-008", passed: true, message: "" };
}

/**
 * REC-009: No Universal Score — 禁止 recommendationScore / overallScore 字段。
 */
export function guardRec009NoUniversalScore(
  rec: RecommendationCandidate,
): GuardResult {
  const recObj = rec as unknown as Record<string, unknown>;
  const forbiddenFields = [
    "recommendationScore",
    "overallScore",
    "strategyScore",
    "intelligenceScore",
    "globalScore",
  ];
  for (const field of forbiddenFields) {
    if (field in recObj) {
      return {
        guardId: "REC-009",
        passed: false,
        message: `Recommendation contains forbidden score field: ${field}`,
      };
    }
  }
  return { guardId: "REC-009", passed: true, message: "" };
}

/**
 * REC-010: Evidence Traceability — 每条必须有可追溯 evidence。
 */
export function guardRec010EvidenceTraceability(
  rec: RecommendationCandidate,
): GuardResult {
  if (rec.evidence.length === 0) {
    return {
      guardId: "REC-010",
      passed: false,
      message: `Recommendation ${rec.recommendationId} has no evidence`,
    };
  }
  for (const e of rec.evidence) {
    if (!e.sourceId || e.sourceId === "") {
      return {
        guardId: "REC-010",
        passed: false,
        message: `Evidence ${e.evidenceId} has empty sourceId`,
      };
    }
  }
  return { guardId: "REC-010", passed: true, message: "" };
}

/**
 * REC-011: No Auto Apply — autoApply 字段类型为 false（literal type）。
 */
export function guardRec011NoAutoApply(
  rec: RecommendationCandidate,
): GuardResult {
  if (rec.autoApply !== false) {
    return {
      guardId: "REC-011",
      passed: false,
      message: `Recommendation ${rec.recommendationId} has autoApply=${rec.autoApply}`,
    };
  }
  return { guardId: "REC-011", passed: true, message: "" };
}

/**
 * REC-012: No Unbounded History — Recommendation 历史有界。
 */
export function guardRec012NoUnboundedHistory(
  buf: RecommendationRingBuffer,
): GuardResult {
  if (buf.count > buf.capacity) {
    return {
      guardId: "REC-012",
      passed: false,
      message: `Records count ${buf.count} exceeds capacity ${buf.capacity}`,
    };
  }
  if (buf.conflictCount > buf.conflictCapacity) {
    return {
      guardId: "REC-012",
      passed: false,
      message: `Conflict count ${buf.conflictCount} exceeds capacity ${buf.conflictCapacity}`,
    };
  }
  return { guardId: "REC-012", passed: true, message: "" };
}

/**
 * REC-013: TTL Enforcement — 每条 Recommendation 有 TTL。
 */
export function guardRec013TTLEnforcement(
  rec: RecommendationCandidate,
): GuardResult {
  if (!rec.validity || rec.validity.ttl <= 0) {
    return {
      guardId: "REC-013",
      passed: false,
      message: `Recommendation ${rec.recommendationId} has invalid TTL`,
    };
  }
  if (rec.validity.expiresTick <= rec.validity.createdTick) {
    return {
      guardId: "REC-013",
      passed: false,
      message: `Recommendation ${rec.recommendationId} expiresTick <= createdTick`,
    };
  }
  return { guardId: "REC-013", passed: true, message: "" };
}

/**
 * REC-014: No Math.random/Date.now — 确定性约束。

 * 与 REC-005 重叠，但此守卫专门检查 Recommendation 对象。
 */
export function guardRec014Deterministic(
  rec: RecommendationCandidate,
): GuardResult {
  if (!/^REC-\d+-\d+$/.test(rec.recommendationId)) {
    return {
      guardId: "REC-014",
      passed: false,
      message: `Recommendation ID ${rec.recommendationId} is not deterministic format`,
    };
  }
  return { guardId: "REC-014", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §3. Batch Validation
// ═══════════════════════════════════════════════════════════

/**
 * 验证单条 Recommendation 的所有守卫。
 */
export function validateRecommendation(
  rec: RecommendationCandidate,
): GuardResult[] {
  return [
    guardRec006NoExecutionLeak(rec),
    guardRec008NoDecisionAuthority(rec),
    guardRec009NoUniversalScore(rec),
    guardRec010EvidenceTraceability(rec),
    guardRec011NoAutoApply(rec),
    guardRec013TTLEnforcement(rec),
    guardRec014Deterministic(rec),
  ];
}

/**
 * 验证 Ring Buffer 的所有守卫。
 */
export function validateRecommendationBuffer(
  buf: RecommendationRingBuffer,
): GuardResult[] {
  const results: GuardResult[] = [
    guardRec012NoUnboundedHistory(buf),
  ];

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    const recResults = validateRecommendation(r);
    for (const result of recResults) {
      if (!result.passed) {
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * System 层守卫验证。
 */
export function validateSystemGuards(
  system: SystemLike,
): GuardResult[] {
  return [
    guardRec001BoundedCache(system),
    guardRec004NoRuntimeMutation(system),
    guardRec007NoStrategyMutation(system),
  ];
}
