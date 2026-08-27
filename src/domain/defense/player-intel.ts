/** Player Intel Confidence */

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

/** 情报置信度等级。 */
export type IntelConfidence =
  | "CONFIRMED"  // 引擎事实或亲眼所见（如 body 解析）
  | "HIGH"       // 多源交叉验证
  | "MEDIUM"     // 单一可靠来源
  | "LOW"        // 推断或旧情报
  | "STALE"      // 过期但有参考价值
  | "UNKNOWN";   // 无情报

/** 情报来源类型。 */
export type IntelSource =
  | "OBSERVED"       // 本 tick 或近 tick 直接观察到
  | "ROOM_HISTORY"   // 房间历史记录
  | "COMBAT_LOG"     // 战斗日志
  | "PLAYER_PROFILE" // 玩家档案（如 leaderboard）
  | "ALLY_REPORT"    // 盟友报告
  | "INFERENCE"      // 推断
  | "UNKNOWN";

/** 情报类别——严格区分 Fact / Inference / Prediction。 */
export type IntelCategory = "FACT" | "INFERENCE" | "PREDICTION";

/**
 * 单条情报证据——每一个 PlayerIntel 结论必须可追溯到 Evidence。
 */
export interface IntelEvidence {
  /** 情报类别。 */
  category: IntelCategory;
  /** 情报来源。 */
  source: IntelSource;
  /** 观察 tick。 */
  observedTick: number;
  /** 相对当前 tick 的年龄（tick）。 */
  age: number;
  /** 该条证据的置信度。 */
  confidence: IntelConfidence;
  /** 证据描述（可读字符串）。 */
  evidence: string;
}

/** 玩家情报记录——由多条 Evidence 组成。 */
export interface PlayerIntelRecord {
  /** 玩家用户名。 */
  username: string;
  /** 所有情报证据列表。 */
  evidence: IntelEvidence[];
  /** 是否存在冲突情报。 */
  hasConflict: boolean;
  /** 冲突描述（如果 hasConflict=true）。 */
  conflictDescription?: string;
  /** 聚合后的置信度。 */
  aggregatedConfidence: IntelConfidence;
  /** 威胁指数（0-100，仅供参考，不直接控制 Threat Level）。 */
  threatIndex: number;
  /** 黑名单标记。 */
  blacklist: boolean;
  /** 最后活动房。 */
  lastActiveRoom?: string;
  /** 到我方核心房的线性距离。 */
  nemesisDistance?: number;
  /** 记录更新 tick。 */
  lastUpdated: number;
}

// ═══════════════════════════════════════════════════════════
// §2. Intel Freshness 常量
// ═══════════════════════════════════════════════════════════

/** 新鲜度阈值（tick）。 */
export const FRESHNESS_THRESHOLDS = {
  /** 0-500 tick: FRESH（不降级）。 */
  FRESH: 500,
  /** 500-2000 tick: RECENT（降一级）。 */
  RECENT: 2000,
  /** 2000-10000 tick: STALE（降二级）。 */
  STALE: 10000,
  /** >10000 tick: EXPIRED（降至 UNKNOWN）。 */
  EXPIRED: 10000,
} as const;

/** 不同来源的默认可信度权重（不是「永远正确」，只是初始倾向）。 */
export const SOURCE_DEFAULT_WEIGHT: Record<IntelSource, number> = {
  OBSERVED: 1.0,        // 直接观察最可靠
  COMBAT_LOG: 0.9,      // 战斗日志可靠但可能过时
  ROOM_HISTORY: 0.7,    // 房间历史有参考价值
  PLAYER_PROFILE: 0.5,  // 玩家档案可能过时
  ALLY_REPORT: 0.4,     // 盟友报告可能有偏差
  INFERENCE: 0.3,       // 推断最不可靠
  UNKNOWN: 0.1,
};

/** IntelConfidence → 数值映射（用于聚合计算）。 */
export const CONFIDENCE_VALUE: Record<IntelConfidence, number> = {
  CONFIRMED: 1.0,
  HIGH: 0.8,
  MEDIUM: 0.6,
  LOW: 0.3,
  STALE: 0.15,
  UNKNOWN: 0.0,
};

// ═══════════════════════════════════════════════════════════
// §3. Freshness 计算
// ═══════════════════════════════════════════════════════════

/**
 * 根据 age（tick）计算新鲜度等级。
 */
export function computeFreshness(age: number): "FRESH" | "RECENT" | "STALE" | "EXPIRED" {
  if (age <= FRESHNESS_THRESHOLDS.FRESH) return "FRESH";
  if (age <= FRESHNESS_THRESHOLDS.RECENT) return "RECENT";
  if (age <= FRESHNESS_THRESHOLDS.STALE) return "STALE";
  return "EXPIRED";
}

/**
 * 根据新鲜度降级 Confidence。

 * 过期情报必须降低 Confidence，禁止旧情报永久保持 HIGH。
 */
export function applyFreshnessDecay(
  confidence: IntelConfidence,
  age: number,
): IntelConfidence {
  const freshness = computeFreshness(age);

  switch (freshness) {
    case "FRESH":
      return confidence; // 不降级
    case "RECENT":
      // 降一级
      return decayOneLevel(confidence);
    case "STALE":
      // 降二级
      return decayOneLevel(decayOneLevel(confidence));
    case "EXPIRED":
      // 超过 10000 tick 的情报降至 UNKNOWN
      return "UNKNOWN";
  }
}

/** 降一级 Confidence。 */
function decayOneLevel(confidence: IntelConfidence): IntelConfidence {
  const order: IntelConfidence[] = ["CONFIRMED", "HIGH", "MEDIUM", "LOW", "STALE", "UNKNOWN"];
  const idx = order.indexOf(confidence);
  if (idx < 0 || idx >= order.length - 1) return "UNKNOWN";
  return order[idx + 1]!;
}

// ═══════════════════════════════════════════════════════════
// §4. Intel Conflict 检测
// ═══════════════════════════════════════════════════════════

/** 冲突检测结果。 */
export interface ConflictResult {
  hasConflict: boolean;
  description?: string;
  /** 冲突的证据对。 */
  conflictingPairs: [IntelEvidence, IntelEvidence][];
}

/**
 * 检测情报列表中的冲突。

 * 冲突定义：两条 FACT 级别情报描述矛盾的行为模式。
 * 例如：Intel A 说玩家和平，Intel B 说玩家最近有 Boosted Military 活动。

 * 系统不能简单覆盖其中一个，必须产生 Conflict 状态或降低 Confidence。
 */
export function detectIntelConflict(evidence: IntelEvidence[]): ConflictResult {
  const conflicts: [IntelEvidence, IntelEvidence][] = [];
  const descriptions: string[] = [];

  // 检查 FACT 级别情报之间的矛盾
  const facts = evidence.filter(e => e.category === "FACT" && e.confidence !== "UNKNOWN");
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i]!;
      const b = facts[j]!;
      // 检测矛盾关键词
      if (isContradictory(a.evidence, b.evidence)) {
        conflicts.push([a, b]);
        descriptions.push(`冲突: "${a.evidence}" vs "${b.evidence}"`);
      }
    }
  }

  // 检查 FACT 与 INFERENCE 的矛盾（降低置信度但不一定标记冲突）
  const inferences = evidence.filter(e => e.category === "INFERENCE");
  for (const fact of facts) {
    for (const inf of inferences) {
      if (isContradictory(fact.evidence, inf.evidence)) {
        // FACT 与 INFERENCE 矛盾时降低 INFERENCE 的可信度
        // 但只在描述中记录
        descriptions.push(`Fact vs Inference 矛盾: "${fact.evidence}" vs "${inf.evidence}"`);
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    description: descriptions.length > 0 ? descriptions.join("; ") : undefined,
    conflictingPairs: conflicts,
  };
}

/** 简单的矛盾检测——基于关键词匹配。 */
function isContradictory(a: string, b: string): boolean {
  const peaceKeywords = ["peace", "peaceful", "和平", "无威胁", "passive"];
  const hostileKeywords = ["attack", "boosted", "military", "siege", "assault", "攻击", "军事", "boost"];

  const aPeace = peaceKeywords.some(k => a.toLowerCase().includes(k));
  const bHostile = hostileKeywords.some(k => b.toLowerCase().includes(k));
  const bPeace = peaceKeywords.some(k => b.toLowerCase().includes(k));
  const aHostile = hostileKeywords.some(k => a.toLowerCase().includes(k));

  return (aPeace && bHostile) || (aHostile && bPeace);
}

// ═══════════════════════════════════════════════════════════
// §5. Intel Confidence 聚合
// ═══════════════════════════════════════════════════════════

/**
 * 聚合多条 Evidence 的 Confidence。

 * 算法：
 * 1. 对每条 Evidence 应用 freshness decay
 * 2. 按 source 权重加权
 * 3. 如果有冲突，整体降低一级
 * 4. FACT 证据权重高于 INFERENCE，INFERENCE 高于 PREDICTION
 * 5. 不简单 average——取加权后的最高有效值
 */
export function aggregateIntelConfidence(
  evidence: IntelEvidence[],
  hasConflict: boolean,
): IntelConfidence {
  if (evidence.length === 0) return "UNKNOWN";

  // 按类别权重
  const categoryWeight: Record<IntelCategory, number> = {
    FACT: 1.0,
    INFERENCE: 0.5,
    PREDICTION: 0.2,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const e of evidence) {
    // 应用 freshness decay
    const decayedConfidence = applyFreshnessDecay(e.confidence, e.age);
    const confidenceValue = CONFIDENCE_VALUE[decayedConfidence];

    // 来源权重 × 类别权重
    const sourceWeight = SOURCE_DEFAULT_WEIGHT[e.source];
    const catWeight = categoryWeight[e.category];
    const weight = sourceWeight * catWeight;

    weightedSum += confidenceValue * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return "UNKNOWN";

  const aggregated = weightedSum / totalWeight;

  // 冲突降级
  const finalValue = hasConflict ? aggregated * 0.6 : aggregated;

  // 映射回 Confidence 等级
  return valueToConfidence(finalValue);
}

/** 将数值映射回 IntelConfidence 等级。 */
function valueToConfidence(value: number): IntelConfidence {
  if (value >= 0.9) return "CONFIRMED";
  if (value >= 0.65) return "HIGH";
  if (value >= 0.4) return "MEDIUM";
  if (value >= 0.15) return "LOW";
  if (value > 0) return "STALE";
  return "UNKNOWN";
}

// ═══════════════════════════════════════════════════════════
// §6. Player Threat Index 评估
// ═══════════════════════════════════════════════════════════

/**
 * 评估玩家的威胁指数（0-100）。

 * ⚠ 重要：threatIndex 是 Evidence，不是 Truth。
 * 禁止用法：if (playerIntel.threatIndex > 80) threatLevel = CRITICAL

 * 正确用法：threatIndex 作为 Intent Evidence 的一部分，
 * 影响 ThreatAssessment 的 confidence 和 intent 推断，
 * 但不直接决定 Threat Level。
 */
export function evaluatePlayerThreatIndex(
  evidence: IntelEvidence[],
  hasConflict: boolean,
): number {
  if (evidence.length === 0) return 0;

  let threatSum = 0;
  let totalWeight = 0;

  for (const e of evidence) {
    const decayedConfidence = applyFreshnessDecay(e.confidence, e.age);
    const confidenceValue = CONFIDENCE_VALUE[decayedConfidence];
    const sourceWeight = SOURCE_DEFAULT_WEIGHT[e.source];

    // FACT 的威胁权重最高
    const categoryWeight = e.category === "FACT" ? 1.0
      : e.category === "INFERENCE" ? 0.5
        : 0.2;

    const weight = sourceWeight * categoryWeight * confidenceValue;
    // 从证据描述中提取威胁信号
    const threatSignal = extractThreatSignal(e.evidence);
    threatSum += threatSignal * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  let index = threatSum / totalWeight;
  // 冲突时降低威胁指数
  if (hasConflict) index *= 0.7;

  return Math.round(Math.max(0, Math.min(100, index)));
}

/** 从证据描述中提取威胁信号值（0-100）。 */
function extractThreatSignal(description: string): number {
  const desc = description.toLowerCase();
  let signal = 30; // 基准

  // 军事活动关键词
  if (desc.includes("boosted") || desc.includes("t3") || desc.includes("t2")) signal += 40;
  if (desc.includes("attack") || desc.includes("assault") || desc.includes("攻击")) signal += 30;
  if (desc.includes("siege") || desc.includes("围攻")) signal += 35;
  if (desc.includes("dismantle") || desc.includes("拆除")) signal += 20;
  if (desc.includes("claim") || desc.includes("占领")) signal += 25;
  if (desc.includes("nuke") || desc.includes("核弹")) signal += 50;
  if (desc.includes("heal") || desc.includes("治疗")) signal += 15;
  if (desc.includes("ranged") || desc.includes("远程")) signal += 15;

  // 和平信号
  if (desc.includes("peace") || desc.includes("和平")) signal -= 20;
  if (desc.includes("passive") || desc.includes("被动")) signal -= 10;
  if (desc.includes("newbie") || desc.includes("新手")) signal -= 25;

  return Math.max(0, Math.min(100, signal));
}

// ═══════════════════════════════════════════════════════════
// §7. PlayerIntelRecord 构建
// ═══════════════════════════════════════════════════════════

/**
 * 从原始情报数据构建完整的 PlayerIntelRecord。

 * 这是系统层薄壳调用的入口点：
 * 1. 接收原始 Evidence 列表
 * 2. 检测冲突
 * 3. 应用 freshness decay
 * 4. 聚合 Confidence
 * 5. 计算 threatIndex
 * 6. 返回完整的 PlayerIntelRecord
 */
export function buildPlayerIntelRecord(
  username: string,
  rawEvidence: IntelEvidence[],
  currentTick: number,
  blacklist: boolean,
  lastActiveRoom?: string,
  nemesisDistance?: number,
): PlayerIntelRecord {
  // 更新 age
  const evidence = rawEvidence.map(e => ({
    ...e,
    age: currentTick - e.observedTick,
  }));

  // 检测冲突
  const conflict = detectIntelConflict(evidence);

  // 聚合 Confidence
  const aggregatedConfidence = aggregateIntelConfidence(evidence, conflict.hasConflict);

  // 计算 threatIndex
  const threatIndex = evaluatePlayerThreatIndex(evidence, conflict.hasConflict);

  return {
    username,
    evidence,
    hasConflict: conflict.hasConflict,
    conflictDescription: conflict.description,
    aggregatedConfidence,
    threatIndex,
    blacklist,
    lastActiveRoom,
    nemesisDistance,
    lastUpdated: currentTick,
  };
}

// ═══════════════════════════════════════════════════════════
// §8. Intel GC（垃圾回收）
// ═══════════════════════════════════════════════════════════

/**
 * 清理过期的情报证据。

 * 策略：
 * - EXPIRED 证据（age > 10000）删除
 * - 保留最近 N 条证据（默认 20）
 * - 冲突证据不自动删除（需要人工或系统裁决）

 * 禁止保存完整 Player 历史无限增长，必须有 TTL 和 GC。
 */
export function gcIntelEvidence(
  evidence: IntelEvidence[],
  currentTick: number,
  maxRecords = 20,
): IntelEvidence[] {
  // 过滤掉过期证据
  const fresh = evidence.filter(e => {
    const age = currentTick - e.observedTick;
    return age <= FRESHNESS_THRESHOLDS.EXPIRED;
  });

  // 按 observedTick 降序排序，保留最近 N 条
  fresh.sort((a, b) => b.observedTick - a.observedTick);

  return fresh.slice(0, maxRecords);
}

// ═══════════════════════════════════════════════════════════
// §9. 便捷工厂函数
// ═══════════════════════════════════════════════════════════

/** 创建一条 OBSERVED FACT 证据。 */
export function makeObservedFact(
  observedTick: number,
  currentTick: number,
  description: string,
): IntelEvidence {
  return {
    category: "FACT",
    source: "OBSERVED",
    observedTick,
    age: currentTick - observedTick,
    confidence: "HIGH",
    evidence: description,
  };
}

/** 创建一条 COMBAT_LOG FACT 证据。 */
export function makeCombatLogFact(
  observedTick: number,
  currentTick: number,
  description: string,
): IntelEvidence {
  return {
    category: "FACT",
    source: "COMBAT_LOG",
    observedTick,
    age: currentTick - observedTick,
    confidence: "HIGH",
    evidence: description,
  };
}

/** 创建一条 INFERENCE 证据。 */
export function makeInference(
  observedTick: number,
  currentTick: number,
  description: string,
  confidence: IntelConfidence = "MEDIUM",
): IntelEvidence {
  return {
    category: "INFERENCE",
    source: "INFERENCE",
    observedTick,
    age: currentTick - observedTick,
    confidence,
    evidence: description,
  };
}

/** 创建一条 PREDICTION 证据。 */
export function makePrediction(
  observedTick: number,
  currentTick: number,
  description: string,
  confidence: IntelConfidence = "LOW",
): IntelEvidence {
  return {
    category: "PREDICTION",
    source: "INFERENCE",
    observedTick,
    age: currentTick - observedTick,
    confidence,
    evidence: description,
  };
}
