# A6.6 Evidence Model — 证据模型与证据链

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码

---

## 一、Evidence Chain 完整链路

### 1.1 从 Recommendation 到原始数据的完整追溯链

```
RecommendationCandidate
    ↓ evidence[]
EvidenceItem
    ↓ source
IntelligenceState (A6.5)
    ↓ components
ModelReliabilityAssessment / PredictionConflict / DataSufficiency / ...
    ↓ predictions[]
Prediction (A6.3)
    ↓ evidence
PredictionEvidence
    ↓ sources[]
TimeSeries / ExperienceRecord
    ↓
Evaluation (A6.2)
    ↓ findings[]
EvaluationFinding
    ↓ evidenceIds[]
DimensionScore
    ↓
Experience (A6.1)
    ↓ decisionRef
DecisionRecord (A4.7)
    ↓ inputSnapshotHash
DecisionSnapshot
    ↓
原始 Game State（tick 时刻快照）
```

### 1.2 关键约束

**Recommendation 不得出现 "AI thinks this is good" 这种不可解释输出。**

每条 Recommendation 必须包含：
- 至少 1 条 Evidence Item
- 每个 Evidence Item 必须有 source（指向 A6.1–A6.5 的具体产出）
- source 必须可追溯到上游数据

---

## 二、EvidenceItem 类型设计

### 2.1 核心类型

```typescript
interface EvidenceItem {
  /** 证据 ID（确定性生成） */
  readonly evidenceId: string;
  /** 证据来源（A6.1–A6.5 的具体模块） */
  readonly source: EvidenceSource;
  /** 来源产出 ID（如 predictionId, evaluationHash, experienceId） */
  readonly sourceId: string;
  /** 证据类型 */
  readonly type: EvidenceType;
  /** 证据值（数值或描述） */
  readonly value: string;
  /** 证据置信度（继承自上游） */
  readonly confidence: number;
  /** 采集 tick */
  readonly collectedAt: number;
  /** 可追溯指针 */
  readonly trace: EvidenceTrace;
}

type EvidenceSource =
  | "A6.1-Experience"
  | "A6.1-Outcome"
  | "A6.1-Attribution"
  | "A6.2-Evaluation"
  | "A6.2-Baseline"
  | "A6.2-Finding"
  | "A6.3-Prediction"
  | "A6.4-Calibration"
  | "A6.4-Profile"
  | "A6.5-Reliability"
  | "A6.5-Conflict"
  | "A6.5-DataSufficiency"
  | "A6.5-Freshness";

type EvidenceType =
  | "OBSERVED"      // 直接观察到的结果
  | "ATTRIBUTED"    // 经过归因
  | "INFERRED"      // 推导判断
  | "PREDICTED"     // 预测值
  | "CALIBRATED"    // 校准结果
  | "RELIABILITY"  // 可靠性评估
  | "CONFLICT"     // 冲突标记
  | "DATA_GAP";     // 数据缺失

interface EvidenceTrace {
  /** 上游模块 */
  readonly upstream: string;
  /** 上游产出类型 */
  readonly upstreamType: string;
  /** 上游产出 hash（用于确定性验证） */
  readonly upstreamHash: string;
}
```

### 2.2 最少 Evidence 集合

| Recommendation 类型 | 最少 Evidence 数 | 必须来源 |
|---------------------|-------------------|---------|
| Economic | 2 | A6.2 Evaluation + A6.3 Prediction |
| Expansion | 2 | A6.2 Evaluation + A6.3 Prediction 或 A6.1 Experience |
| Defense | 2 | A6.2 riskLevel + A6.3 或 A6.5 |
| Military | 3 | A6.2 militaryOutcome + A6.1 war Experience + A6.5 Reliability |
| Logistics | 2 | A6.2 resourceEfficiency + A6.3 或 A6.5 |
| Spawn | 1 | A6.3 spawn-starvation Prediction |
| Recovery | 2 | A6.2 recoveryCost + A6.1 recovery Experience |
| Posture | 3 | A6.2 全维度 + A6.5 IntelligenceState + A6.4 Calibration |

### 2.3 DATA GAP 处理

当所需来源不存在时：

```typescript
// 不伪造证据，标记 DATA_GAP
EvidenceItem {
  evidenceId: "E-gap-{tick}-{seq}",
  source: "A6.3-Prediction",
  sourceId: "NONE",
  type: "DATA_GAP",
  value: "logistics-bottleneck prediction not implemented",
  confidence: 0,
  collectedAt: tick,
  trace: { upstream: "A6.3", upstreamType: "Prediction", upstreamHash: "N/A" },
}
```

**DATA_GAP 证据的 confidence = 0。** 含 DATA_GAP 证据的 Recommendation confidence 降级。

---

## 三、Confidence 传播规则

### 3.1 核心原则

**Recommendation confidence ≤ 最低 Evidence confidence。**

```
recommendation.confidence = min(evidence[i].confidence for all i)
```

### 3.2 低 confidence Prediction 不得产生高 confidence Recommendation

| Prediction confidence | Recommendation confidence 上限 |
|----------------------|------------------------------|
| 0.9 | ≤ 0.9 |
| 0.5 | ≤ 0.5 |
| 0.3 | ≤ 0.3（可能产出 NO_RECOMMENDATION） |
| 0.0（INSUFFICIENT_DATA） | 0.0 → NO_RECOMMENDATION |

### 3.3 Calibration 修正

如果 A6.4 显示模型 OVERCONFIDENT：

```
calibratedConfidence = rawConfidence × calibrationMultiplier
// OVERCONFIDENT: multiplier < 1
// UNDERCONFIDENT: multiplier > 1
// WELL_CALIBRATED: multiplier = 1
```

### 3.4 Reliability 修正

如果 A6.5 显示模型可靠性低：

```
effectiveConfidence = calibratedConfidence × reliabilityFactor
// driftDetected: factor < 1
// sampleSufficiency = INSUFFICIENT: factor = 0.5
// regimeFit = false: factor = 0.7
```

---

## 四、Evidence Quality 矩阵

### 4.1 Evidence Quality 评估

| 来源 | 类型 | 默认 Confidence | 可追溯 | 完整性 |
|------|------|----------------|--------|--------|
| A6.1 Experience | OBSERVED | 高（已完成归因） | ✅ DecisionRecord | ✅ |
| A6.1 Outcome | OBSERVED | 高（事实级） | ✅ DecisionRecord | ✅ |
| A6.1 Attribution | ATTRIBUTED | 中（推理可能有误） | ✅ Experience | ✅ |
| A6.2 Evaluation | INFERRED | 各维度独立 | ✅ Finding → Experience | ✅ |
| A6.2 Baseline | OBSERVED | 高（历史统计） | ✅ | ✅ |
| A6.3 Prediction | PREDICTED | 模型自评 | ✅ PredictionEvidence | ✅ |
| A6.4 Calibration | CALIBRATED | 高（历史验证） | ✅ ResolutionResult | ✅ |
| A6.5 Reliability | RELIABILITY | 高（聚合评估） | ✅ IntelligenceState | ✅ |
| A6.5 Conflict | CONFLICT | 中（标记非裁决） | ✅ PredictionConflict | ✅ |

### 4.2 Evidence 数量上限

| Recommendation | Evidence 数量上限 | 理由 |
|----------------|-----------------|------|
| 单条 Recommendation | ≤ 10 | 防止证据爆炸 |
| Evidence 遍历 | ≤ 100 items/run | CPU 约束 |

---

## 五、Evidence Hash 与确定性

### 5.1 Evidence 确定性

```typescript
// Evidence Item hash
evidenceHash = fnv1a32Hex(stableStringify({
  evidenceId,
  source,
  sourceId,
  type,
  value,
  confidence: confidence.toFixed(6),
  collectedAt,
}))
```

### 5.2 Recommendation Hash

```typescript
recommendationHash = fnv1a32Hex(stableStringify({
  category: sortedString,
  target: sortedString,
  evidence: evidence.map(e => e.evidenceHash).sort(),  // sorted
  expectedBenefit: expectedBenefit?.toFixed(6) ?? "N/A",
  expectedCost: expectedCost?.toFixed(6) ?? "N/A",
  confidence: confidence.toFixed(6),
  urgency: urgency,
  contextSignature: contextSignature,
  shadowOnly: true,
  autoApply: false,
}))
```

### 5.3 确定性验证

- 同一输入 → 同一 Recommendation hash
- 100× replay → hash 一致
- 禁止 Math.random / Date.now / 无序遍历

---

## 六、Evidence 链不可断性

### 6.1 断链检测

每条 Evidence 必须有 `trace.upstreamHash`。如果上游 hash 不可获取：
- 标记 `trace.upstreamHash = "UNAVAILABLE"`
- 降低 Evidence confidence 到 0.5
- 在 Recommendation 中标注 "evidence trace incomplete"

### 6.2 上游过期处理

如果上游数据已过期（Ring Buffer 淘汰）：
- Evidence 保留（Evidence 本身不依赖上游存活）
- 但标注 "upstream expired, evidence is historical"
- Recommendation confidence 不受影响（Evidence 记录了采集时的快照）

---

## 七、结论

**A6.6 的 Evidence Model 确保每条 Recommendation 可解释、可审计、可反事实验证。**

核心原则：
1. 每条 Recommendation 至少有 1 条可追溯 Evidence
2. Recommendation confidence ≤ 最低 Evidence confidence
3. DATA_GAP 不伪造证据，产出 NO_RECOMMENDATION
4. Evidence 确定性可验证
5. Evidence 链不断裂
