/**
 * A6.2 Evaluation Evidence — Domain 层纯函数与类型定义。
 *
 * 职责：
 *   buildEvaluationEvidence()      — 从 Evaluation 构建可追溯证据链
 *   traceEvidence()                — 追溯 Evidence 到 Experience / Outcome / Attribution
 *   validateEvidenceCompleteness() — 验证证据完整性
 *
 * Evaluation 必须可解释。
 * 任何结论必须能够追溯到：
 *   Experience → Outcome → Attribution → Metric
 * 不能出现：score = 0.72 但不知道为什么。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * Deterministic Replay：
 *   同一输入 + 同一模型版本 → 相同 evidenceHash。
 *   禁止 Math.random() / Date.now() / 无序迭代 / 浮点误差。
 */

import type {
  EvaluationDimension,
  EvaluationFinding,
  StrategyEvaluation,
  DimensionScore,
  EvidenceType,
} from "./strategy-evaluation";
import type { ExperienceRecord, Attribution, OutcomeRecord } from "./experience";

// ═══════════════════════════════════════════════════════════
// §1. Evidence Types
// ═══════════════════════════════════════════════════════════

/** 单条证据 — 可追溯到 Experience / Outcome / Attribution / Metric。 */
export interface EvaluationEvidence {
  /** 证据 ID。 */
  readonly evidenceId: string;
  /** 关联的维度。 */
  readonly dimension: EvaluationDimension;
  /** 证据类型。 */
  readonly evidenceType: EvidenceType;
  /** 来源 Experience ID（可追溯到 Experience Ring Buffer）。 */
  readonly experienceId?: string;
  /** 来源 Outcome metric（可追溯到已有系统产出）。 */
  readonly outcomeMetric?: string;
  /** 来源 Outcome value。 */
  readonly outcomeValue?: number;
  /** 来源 Attribution hash（可追溯到 A6.1 归因）。 */
  readonly attributionHash?: string;
  /** Attribution primaryCause。 */
  readonly attributionCause?: string;
  /** Attribution confidence。 */
  readonly attributionConfidence?: number;
  /** Metric 快照值。 */
  readonly metricValue?: number;
  /** Baseline 值。 */
  readonly baselineValue?: number;
  /** Delta。 */
  readonly delta?: number;
  /** 证据描述。 */
  readonly description: string;
  /** 证据 hash（确定性验证）。 */
  readonly evidenceHash: string;
}

/** 证据链 — 从 Finding 追溯到原始数据。 */
export interface EvidenceChain {
  /** 起始 Finding ID。 */
  readonly findingId: string;
  /** 关联维度。 */
  readonly dimension: EvaluationDimension;
  /** 证据链节点列表（从 Finding → DimensionScore → Experience → Outcome → Attribution）。 */
  readonly nodes: readonly EvidenceChainNode[];
  /** 链完整性。 */
  readonly complete: boolean;
  /** 缺失环节描述。 */
  readonly missingLinks: string[];
}

/** 证据链节点。 */
export interface EvidenceChainNode {
  /** 节点类型。 */
  readonly type: "finding" | "dimension_score" | "experience" | "outcome" | "attribution" | "metric" | "baseline";
  /** 节点 ID。 */
  readonly id: string;
  /** 节点描述。 */
  readonly description: string;
  /** 节点数据摘要。 */
  readonly summary: string;
}

/** 证据完整性验证结果。 */
export interface EvidenceCompleteness {
  /** 是否完整。 */
  readonly complete: boolean;
  /** 总证据数。 */
  readonly totalEvidence: number;
  /** 有追溯的 Experience 的证据数。 */
  readonly withExperience: number;
  /** 有追溯的 Outcome 的证据数。 */
  readonly withOutcome: number;
  /** 有追溯的 Attribution 的证据数。 */
  readonly withAttribution: number;
  /** 有 Baseline 的证据数。 */
  readonly withBaseline: number;
  /** 缺失列表。 */
  readonly missing: string[];
  /** 完整性分数（0-1）。 */
  readonly completenessScore: number;
}

// ═══════════════════════════════════════════════════════════
// §2. Build Evaluation Evidence
// ═══════════════════════════════════════════════════════════

/**
 * 从 Evaluation 构建可追溯证据链。
 *
 * 每个 DimensionScore 都产出一条 Evidence。
 * Evidence 可追溯到 Experience / Outcome / Attribution / Metric。
 *
 * 纯函数 — 不引用 Game/Memory。
 */
export function buildEvaluationEvidence(
  evaluation: StrategyEvaluation,
  experiences: readonly ExperienceRecord[],
): EvaluationEvidence[] {
  const evidences: EvaluationEvidence[] = [];

  for (const dim of Object.keys(evaluation.score.dimensions) as EvaluationDimension[]) {
    const score = evaluation.score.dimensions[dim];
    const evidence = buildDimensionEvidence(score, experiences);
    evidences.push(evidence);
  }

  return evidences;
}

/**
 * 为单个维度构建证据。
 */
function buildDimensionEvidence(
  score: DimensionScore,
  experiences: readonly ExperienceRecord[],
): EvaluationEvidence {
  // 追溯到 Experience
  const relevantType = dimensionToExperienceType(score.dimension);
  const relevantExp = experiences.find(e =>
    e.identity.type === relevantType && e.outcome !== undefined,
  );

  // 追溯到 Outcome
  const outcome = relevantExp?.outcome;

  // 追溯到 Attribution
  const attribution = relevantExp?.attribution;

  const description = buildEvidenceDescription(score, relevantExp, outcome, attribution);

  const evidence: EvaluationEvidence = {
    evidenceId: `EV-${score.dimension}`,
    dimension: score.dimension,
    evidenceType: score.evidenceType,
    experienceId: relevantExp?.identity.experienceId,
    outcomeMetric: outcome?.metric,
    outcomeValue: outcome?.value,
    attributionHash: attribution?.attributionHash,
    attributionCause: attribution?.primaryCause,
    attributionConfidence: attribution?.confidence,
    metricValue: score.observed,
    baselineValue: score.baseline,
    delta: score.delta,
    description,
    evidenceHash: evidenceHash(score),
  };

  return evidence;
}

// ═══════════════════════════════════════════════════════════
// §3. Trace Evidence
// ═══════════════════════════════════════════════════════════

/**
 * 追溯证据链 — 从 Finding 追溯到原始数据。
 *
 * 链路：
 *   Finding → DimensionScore → Experience → Outcome → Attribution → Metric
 *
 * 纯函数 — 不引用 Game/Memory。
 */
export function traceEvidence(
  finding: EvaluationFinding,
  evaluation: StrategyEvaluation,
  experiences: readonly ExperienceRecord[],
): EvidenceChain {
  const nodes: EvidenceChainNode[] = [];
  const missingLinks: string[] = [];

  // 节点 1: Finding
  nodes.push({
    type: "finding",
    id: finding.findingId,
    description: finding.description,
    summary: `confidence=${finding.confidence.toFixed(3)}, evidenceType=${finding.evidenceType}`,
  });

  // 节点 2: DimensionScore
  const score = evaluation.score.dimensions[finding.dimension];
  if (score) {
    nodes.push({
      type: "dimension_score",
      id: `${finding.dimension}-score`,
      description: `Dimension ${finding.dimension} score`,
      summary: `observed=${score.observed.toFixed(3)}, baseline=${score.baseline.toFixed(3)}, delta=${score.delta.toFixed(3)}, confidence=${score.confidence.toFixed(3)}`,
    });
  } else {
    missingLinks.push("dimension_score");
  }

  // 节点 3: Experience
  const relevantType = dimensionToExperienceType(finding.dimension);
  const relevantExp = experiences.find(e =>
    e.identity.type === relevantType && e.outcome !== undefined,
  );

  if (relevantExp) {
    nodes.push({
      type: "experience",
      id: relevantExp.identity.experienceId,
      description: `Experience ${relevantExp.identity.type} at tick ${relevantExp.identity.tick}`,
      summary: `decision=${relevantExp.decision.selectedAction}, lifecycle=${relevantExp.lifecycle}`,
    });
  } else {
    missingLinks.push("experience");
  }

  // 节点 4: Outcome
  if (relevantExp?.outcome) {
    nodes.push({
      type: "outcome",
      id: relevantExp.outcome.decisionId,
      description: `Outcome: ${relevantExp.outcome.metric}=${relevantExp.outcome.value}`,
      summary: `classification=${relevantExp.outcome.classification}, source=${relevantExp.outcome.source}, delay=${relevantExp.outcome.delay}`,
    });
  } else {
    missingLinks.push("outcome");
  }

  // 节点 5: Attribution
  if (relevantExp?.attribution) {
    nodes.push({
      type: "attribution",
      id: relevantExp.attribution.attributionHash,
      description: `Attribution: primaryCause=${relevantExp.attribution.primaryCause}`,
      summary: `method=${relevantExp.attribution.method}, confidence=${relevantExp.attribution.confidence.toFixed(3)}, evidence_count=${relevantExp.attribution.evidence.length}`,
    });
  } else {
    missingLinks.push("attribution");
  }

  // 节点 6: Metric
  if (score) {
    nodes.push({
      type: "metric",
      id: `${finding.dimension}-metric`,
      description: `Metric: ${score.metric}`,
      summary: `observed=${score.observed.toFixed(3)}`,
    });
  }

  // 节点 7: Baseline
  if (score) {
    nodes.push({
      type: "baseline",
      id: `${finding.dimension}-baseline`,
      description: `Baseline: source=${score.baselineSource}`,
      summary: `baseline=${score.baseline.toFixed(3)}, comparable=${score.comparable}`,
    });
  }

  return {
    findingId: finding.findingId,
    dimension: finding.dimension,
    nodes,
    complete: missingLinks.length === 0,
    missingLinks,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Validate Evidence Completeness
// ═══════════════════════════════════════════════════════════

/**
 * 验证证据完整性 — 确保每个结论都有完整的证据链。
 *
 * 禁止 score = 0.72 但不知道为什么。
 *
 * 纯函数 — 不引用 Game/Memory。
 */
export function validateEvidenceCompleteness(
  evaluation: StrategyEvaluation,
  experiences: readonly ExperienceRecord[],
): EvidenceCompleteness {
  let totalEvidence = 0;
  let withExperience = 0;
  let withOutcome = 0;
  let withAttribution = 0;
  let withBaseline = 0;
  const missing: string[] = [];

  for (const dim of Object.keys(evaluation.score.dimensions) as EvaluationDimension[]) {
    const score = evaluation.score.dimensions[dim];
    totalEvidence++;

    // 检查是否有 Experience 追溯
    const relevantType = dimensionToExperienceType(dim);
    const hasExp = experiences.some(e => e.identity.type === relevantType && e.outcome !== undefined);
    if (hasExp) {
      withExperience++;
    } else {
      missing.push(`${dim}:no_experience`);
    }

    // 检查是否有 Outcome
    if (hasExp) {
      const exp = experiences.find(e => e.identity.type === relevantType && e.outcome !== undefined);
      if (exp?.outcome) {
        withOutcome++;
      } else {
        missing.push(`${dim}:no_outcome`);
      }
    }

    // 检查是否有 Attribution
    if (hasExp) {
      const exp = experiences.find(e => e.identity.type === relevantType && e.outcome !== undefined);
      if (exp?.attribution) {
        withAttribution++;
      } else {
        missing.push(`${dim}:no_attribution`);
      }
    }

    // 检查是否有 Baseline
    if (score.comparable) {
      withBaseline++;
    } else {
      missing.push(`${dim}:baseline_incomparable`);
    }
  }

  const completenessScore = totalEvidence > 0
    ? Number(((withExperience + withOutcome + withAttribution + withBaseline) / (totalEvidence * 4)).toFixed(3))
    : 0;

  return {
    complete: missing.length === 0,
    totalEvidence,
    withExperience,
    withOutcome,
    withAttribution,
    withBaseline,
    missing,
    completenessScore,
  };
}

// ═══════════════════════════════════════════════════════════
// §5. Helper Functions
// ═══════════════════════════════════════════════════════════

function dimensionToExperienceType(dim: EvaluationDimension): string {
  const map: Record<EvaluationDimension, string> = {
    economicGrowth: "economic",
    resourceEfficiency: "logistics",
    cpuEfficiency: "spawn",
    riskLevel: "defense",
    survival: "recovery",
    expansion: "expansion",
    militaryOutcome: "war",
    recoveryCost: "recovery",
  };
  return map[dim];
}

function buildEvidenceDescription(
  score: DimensionScore,
  exp: ExperienceRecord | undefined,
  outcome: OutcomeRecord | undefined,
  attribution: Attribution | undefined,
): string {
  const parts: string[] = [];
  parts.push(`Dimension ${score.dimension}: observed=${score.observed.toFixed(3)}, baseline=${score.baseline.toFixed(3)}, delta=${score.delta.toFixed(3)}`);
  if (exp) {
    parts.push(`experience=${exp.identity.experienceId}(${exp.identity.type})`);
  }
  if (outcome) {
    parts.push(`outcome=${outcome.metric}=${outcome.value}(${outcome.classification})`);
  }
  if (attribution) {
    parts.push(`attribution=${attribution.primaryCause}(conf=${attribution.confidence.toFixed(2)})`);
  }
  if (!score.comparable) {
    parts.push(`INCOMPARABLE: ${score.incompatibilityReason ?? "context mismatch"}`);
  }
  return parts.join(" | ");
}

/**
 * 证据 Hash — 确定性验证。
 */
function evidenceHash(score: DimensionScore): string {
  const payload = stableStringify({
    dimension: score.dimension,
    observed: Number(score.observed.toFixed(4)),
    baseline: Number(score.baseline.toFixed(4)),
    delta: Number(score.delta.toFixed(4)),
    evidenceType: score.evidenceType,
    evidenceIds: score.evidenceIds,
  });
  return fnv1a32Hex(payload);
}

/**
 * 稳定 JSON 序列化：按 key 排序，确保相同对象产生相同字符串。
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
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

/**
 * FNV-1a 32-bit Hash → 8 字符 hex。
 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
